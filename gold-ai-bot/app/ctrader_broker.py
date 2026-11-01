"""cTrader Open API adapter, DEMO ONLY.

Safety, in layers:
  1. The host is a constant: demo.ctraderapi.com. There is no setting, flag or
     argument that points this code at the live server.
  2. On connect, the account list for the access token is fetched and the
     configured account must be there, must report isLive = false, and must be
     on CTRADER_DEMO_ACCOUNT_ALLOWLIST. Anything else raises before a single
     order message can be built.
  3. The bot checks demo_verified and account.is_live again on every cycle,
     and the risk engine checks them again before every order.

Transport: the official SDK runs on Twisted. The reactor runs in a background
thread; each request is bridged to an asyncio future. The SDK sends the
heartbeats itself.

NOT YET VERIFIED AGAINST A REAL SERVER from this repo. Run
`python -m app.main check` against your demo account first (week 1) and
compare every number it prints with what cTrader shows.
"""

from __future__ import annotations

import asyncio
import logging
import threading
import time
from datetime import datetime, timedelta, timezone

from .config import Settings
from .models import (TIMEFRAME_MINUTES, AccountState, BrokerError, Candle, ClosedTrade,
                     LiveAccountRefused, OrderRequest, OrderResult, OrderTimeout, Position,
                     Quote, SymbolSpec, Timeframe)

log = logging.getLogger("gold-ai-bot.ctrader")

DEMO_HOST = "demo.ctraderapi.com"
PORT = 5035
PRICE_SCALE = 100_000      # cTrader prices are integers in 1/100000
VOLUME_SCALE = 100         # cTrader volumes are integers in 1/100 of a unit
FILL_WAIT_S = 10.0
_COMMISSION = {1: "USD_PER_MILLION_USD", 2: "USD_PER_LOT", 3: "PERCENTAGE_OF_VALUE",
               4: "QUOTE_CCY_PER_LOT"}

_reactor_started = threading.Event()


def _start_reactor() -> None:
    from twisted.internet import reactor
    if _reactor_started.is_set():
        return
    threading.Thread(target=reactor.run, kwargs={"installSignalHandlers": False},
                     name="twisted-reactor", daemon=True).start()
    _reactor_started.set()


def _ts(ms: int) -> datetime:
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc)


class CTraderBroker:
    def __init__(self, settings: Settings):
        self.s = settings
        self.demo_verified = False
        self._is_live = True  # assume live until the server says otherwise
        self.account_id = settings.ctrader_account_id
        self._client = None
        self._loop: asyncio.AbstractEventLoop | None = None
        self._connected: asyncio.Event | None = None
        self._spots: dict[int, tuple[float, float, datetime]] = {}
        self._fill_waiters: dict[str, asyncio.Future] = {}
        self._money_digits = 2
        self._currency = ""
        self._leverage = 100.0
        self._assets: dict[int, str] = {}
        self._symbols_by_name: dict[str, object] = {}
        self._symbol_names: dict[int, str] = {}
        self._spec: SymbolSpec | None = None
        self._conversion_cache: dict[tuple[str, str], list] = {}

    # ---- transport -------------------------------------------------------------
    async def _req(self, message, timeout: float = 10.0):
        from twisted.internet import reactor
        from ctrader_open_api import Protobuf
        loop = self._loop
        fut: asyncio.Future = loop.create_future()

        def ok(msg):
            loop.call_soon_threadsafe(lambda: fut.done() or fut.set_result(msg))

        def fail(failure):
            loop.call_soon_threadsafe(
                lambda: fut.done() or fut.set_exception(BrokerError(str(failure.value))))

        def send():
            d = self._client.send(message, responseTimeoutInSeconds=timeout)
            d.addCallbacks(ok, fail)

        reactor.callFromThread(send)
        msg = await asyncio.wait_for(fut, timeout + 3)
        payload = Protobuf.extract(msg)
        name = type(payload).__name__
        if name in ("ProtoOAErrorRes", "ProtoErrorRes"):
            raise BrokerError(f"{payload.errorCode}: {getattr(payload, 'description', '')}")
        if name == "ProtoOAOrderErrorEvent":
            raise BrokerError(f"order error {payload.errorCode}: {payload.description}")
        return payload

    def _on_message(self, _client, message) -> None:
        """Runs on the reactor thread. Spot prices and execution events."""
        from ctrader_open_api import Protobuf
        try:
            payload = Protobuf.extract(message)
        except Exception:  # noqa: BLE001
            return
        name = type(payload).__name__
        if name == "ProtoOASpotEvent":
            old = self._spots.get(payload.symbolId, (0.0, 0.0, None))
            bid = payload.bid / PRICE_SCALE if payload.HasField("bid") else old[0]
            ask = payload.ask / PRICE_SCALE if payload.HasField("ask") else old[1]
            self._spots[payload.symbolId] = (bid, ask, datetime.now(timezone.utc))
        elif name in ("ProtoOAExecutionEvent", "ProtoOAOrderErrorEvent"):
            coid = payload.order.clientOrderId if name == "ProtoOAExecutionEvent" \
                and payload.HasField("order") else ""
            fut = self._fill_waiters.get(coid)
            if fut is not None and self._loop:
                self._loop.call_soon_threadsafe(lambda: fut.done() or fut.set_result(payload))

    # ---- connect and verify ----------------------------------------------------
    async def list_accounts(self) -> list[tuple[int, bool, int]]:
        """(ctidTraderAccountId, isLive, traderLogin) for every account the token
        can see. Setup helper only: authorises nothing for trading."""
        from ctrader_open_api.messages import OpenApiMessages_pb2 as M
        await self._open_transport()
        s = self.s
        await self._req(M.ProtoOAApplicationAuthReq(clientId=s.ctrader_client_id,
                                                    clientSecret=s.ctrader_client_secret))
        res = await self._req(
            M.ProtoOAGetAccountListByAccessTokenReq(accessToken=s.ctrader_access_token))
        return [(a.ctidTraderAccountId, a.isLive, a.traderLogin) for a in res.ctidTraderAccount]

    async def _open_transport(self) -> None:
        from twisted.internet import reactor
        from ctrader_open_api import Client, TcpProtocol
        if self._client is not None:  # reconnecting: retire the old service first
            reactor.callFromThread(self._client.stopService)
        self._loop = asyncio.get_running_loop()
        self._connected = asyncio.Event()
        _start_reactor()
        self._client = Client(DEMO_HOST, PORT, TcpProtocol)
        self._client.setConnectedCallback(
            lambda _c: self._loop.call_soon_threadsafe(self._connected.set))
        self._client.setDisconnectedCallback(self._on_disconnect)
        self._client.setMessageReceivedCallback(self._on_message)
        reactor.callFromThread(self._client.startService)
        await asyncio.wait_for(self._connected.wait(), 20)

    async def connect(self) -> None:
        from ctrader_open_api.messages import OpenApiMessages_pb2 as M
        s = self.s
        if self.account_id not in s.ctrader_demo_allowlist:
            raise LiveAccountRefused(
                f"account {self.account_id} is not on CTRADER_DEMO_ACCOUNT_ALLOWLIST")
        await self._open_transport()
        await self._req(M.ProtoOAApplicationAuthReq(clientId=s.ctrader_client_id,
                                                    clientSecret=s.ctrader_client_secret))
        accounts = await self._req(
            M.ProtoOAGetAccountListByAccessTokenReq(accessToken=s.ctrader_access_token))
        acct = next((a for a in accounts.ctidTraderAccount
                     if a.ctidTraderAccountId == self.account_id), None)
        if acct is None:
            raise LiveAccountRefused(f"account {self.account_id} is not authorised for this token")
        if acct.isLive:
            raise LiveAccountRefused(f"account {self.account_id} is a LIVE account: refusing")
        self._is_live = bool(acct.isLive)
        await self._req(M.ProtoOAAccountAuthReq(ctidTraderAccountId=self.account_id,
                                                accessToken=s.ctrader_access_token))
        await self._load_reference_data()
        self.demo_verified = True
        log.info("connected to cTrader DEMO account %s (%s)", self.account_id, self._currency)

    def _on_disconnect(self, _client, reason) -> None:
        log.warning("cTrader disconnected: %s", reason)
        self.demo_verified = False  # cycles stop until connect() verifies again

    async def disconnect(self) -> None:
        from twisted.internet import reactor
        self.demo_verified = False
        if self._client is not None:
            reactor.callFromThread(self._client.stopService)

    async def _load_reference_data(self) -> None:
        from ctrader_open_api.messages import OpenApiMessages_pb2 as M
        aid = self.account_id
        trader = (await self._req(M.ProtoOATraderReq(ctidTraderAccountId=aid))).trader
        self._money_digits = trader.moneyDigits or 2
        self._leverage = (trader.leverageInCents or 10000) / 100
        assets = await self._req(M.ProtoOAAssetListReq(ctidTraderAccountId=aid))
        self._assets = {a.assetId: a.name for a in assets.asset}
        self._currency = self._assets.get(trader.depositAssetId, "?")
        symbols = await self._req(M.ProtoOASymbolsListReq(ctidTraderAccountId=aid))
        self._symbols_by_name = {x.symbolName: x for x in symbols.symbol}
        self._symbol_names = {x.symbolId: x.symbolName for x in symbols.symbol}
        light = self._symbols_by_name.get(self.s.ctrader_symbol_name)
        if light is None:
            raise BrokerError(f"symbol {self.s.ctrader_symbol_name} not found; "
                              "set CTRADER_SYMBOL_NAME to your broker's name for gold")
        full = (await self._req(M.ProtoOASymbolByIdReq(ctidTraderAccountId=aid,
                                                       symbolId=[light.symbolId]))).symbol[0]
        self._spec = self._to_spec(light, full)
        await self._subscribe([light.symbolId])

    def _to_spec(self, light, full) -> SymbolSpec:
        ctype = _COMMISSION.get(full.commissionType, "NONE")
        # preciseTradingCommissionRate: 10^5 scale for percentage, 10^8 otherwise
        # (cTrader docs). Printed by `check` so it can be compared with the broker.
        rate = full.preciseTradingCommissionRate
        rate = rate / (1e5 if ctype == "PERCENTAGE_OF_VALUE" else 1e8) if rate else 0.0
        min_stop = 0.0
        if full.slDistance:
            if full.distanceSetIn == 2:  # percentage of price; resolved at check time
                log.warning("slDistance is a percentage (%s); not applied", full.slDistance)
            else:
                min_stop = full.slDistance / 10 ** full.digits
        return SymbolSpec(
            symbol="XAUUSD", broker_symbol_id=light.symbolId, digits=full.digits,
            quote_currency=self._assets.get(light.quoteAssetId, "USD"),
            units_per_lot=full.lotSize / VOLUME_SCALE, min_units=full.minVolume / VOLUME_SCALE,
            max_units=full.maxVolume / VOLUME_SCALE, step_units=full.stepVolume / VOLUME_SCALE,
            min_stop_distance=min_stop, commission_type=ctype if rate else "NONE",
            commission_rate=rate)

    async def _subscribe(self, symbol_ids: list[int]) -> None:
        from ctrader_open_api.messages import OpenApiMessages_pb2 as M
        new = [i for i in symbol_ids if i not in self._spots]
        if not new:
            return
        await self._req(M.ProtoOASubscribeSpotsReq(ctidTraderAccountId=self.account_id,
                                                   symbolId=new))
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline and not all(
                self._spots.get(i, (0, 0))[0] > 0 and self._spots.get(i, (0, 0))[1] > 0
                for i in new):
            await asyncio.sleep(0.2)

    # ---- Broker interface --------------------------------------------------------
    async def account(self) -> AccountState:
        from ctrader_open_api.messages import OpenApiMessages_pb2 as M
        trader = (await self._req(M.ProtoOATraderReq(ctidTraderAccountId=self.account_id))).trader
        scale = 10 ** (trader.moneyDigits or self._money_digits)
        balance = trader.balance / scale
        pnl = await self._req(M.ProtoOAGetPositionUnrealizedPnLReq(
            ctidTraderAccountId=self.account_id))
        pscale = 10 ** (pnl.moneyDigits or self._money_digits)
        unreal = sum(p.netUnrealizedPnL for p in pnl.positionUnrealizedPnL) / pscale
        recon = await self._req(M.ProtoOAReconcileReq(ctidTraderAccountId=self.account_id))
        used = sum(p.usedMargin / 10 ** (p.moneyDigits or self._money_digits)
                   for p in recon.position)
        return AccountState(account_id=self.account_id, is_live=self._is_live or not self.demo_verified,
                            currency=self._currency, balance=balance, equity=balance + unreal,
                            leverage=self._leverage, used_margin=used)

    async def symbol_spec(self, symbol: str) -> SymbolSpec:
        if self._spec is None:
            raise BrokerError("not connected")
        return self._spec

    async def candles(self, symbol: str, timeframe: Timeframe, count: int) -> list[Candle]:
        from ctrader_open_api.messages import OpenApiMessages_pb2 as M
        from ctrader_open_api.messages import OpenApiModelMessages_pb2 as MM
        minutes = TIMEFRAME_MINUTES[timeframe]
        now = datetime.now(timezone.utc)
        frm = now - timedelta(minutes=minutes * (count + 1) * 2 + 3 * 24 * 60)  # covers weekends
        res = await self._req(M.ProtoOAGetTrendbarsReq(
            ctidTraderAccountId=self.account_id, symbolId=self._spec.broker_symbol_id,
            period=MM.ProtoOATrendbarPeriod.Value(timeframe),
            fromTimestamp=int(frm.timestamp() * 1000), toTimestamp=int(now.timestamp() * 1000),
            count=count + 1), timeout=20)
        out = []
        for b in res.trendbar:
            t = datetime.fromtimestamp(b.utcTimestampInMinutes * 60, tz=timezone.utc)
            if t + timedelta(minutes=minutes) > now:
                continue  # still forming
            low = b.low
            out.append(Candle(time=t, open=(low + b.deltaOpen) / PRICE_SCALE,
                              high=(low + b.deltaHigh) / PRICE_SCALE, low=low / PRICE_SCALE,
                              close=(low + b.deltaClose) / PRICE_SCALE, volume=b.volume))
        out.sort(key=lambda c: c.time)
        return out[-count:]

    async def quote(self, symbol: str) -> Quote:
        sid = self._spec.broker_symbol_id
        if sid not in self._spots:
            raise BrokerError("no spot price yet")
        bid, ask, t = self._spots[sid]
        return Quote(bid=bid, ask=ask, time=t)

    async def conversion_rate(self, from_ccy: str, to_ccy: str) -> float:
        """Walks the conversion chain cTrader returns, using live mid prices."""
        from ctrader_open_api.messages import OpenApiMessages_pb2 as M
        if from_ccy == to_ccy:
            return 1.0
        ids = {v: k for k, v in self._assets.items()}
        key = (from_ccy, to_ccy)
        if key not in self._conversion_cache:
            res = await self._req(M.ProtoOASymbolsForConversionReq(
                ctidTraderAccountId=self.account_id, firstAssetId=ids[from_ccy],
                lastAssetId=ids[to_ccy]))
            self._conversion_cache[key] = list(res.symbol)
            await self._subscribe([x.symbolId for x in res.symbol])
        rate, current = 1.0, ids[from_ccy]
        for sym in self._conversion_cache[key]:
            bid, ask, _ = self._spots.get(sym.symbolId, (0.0, 0.0, None))
            if bid <= 0 or ask <= 0:
                raise BrokerError(f"no price for conversion symbol {sym.symbolName}")
            mid = (bid + ask) / 2
            if sym.baseAssetId == current:
                rate, current = rate * mid, sym.quoteAssetId
            elif sym.quoteAssetId == current:
                rate, current = rate / mid, sym.baseAssetId
            else:
                raise BrokerError("broken conversion chain")
        if current != ids[to_ccy]:
            raise BrokerError("conversion chain did not reach the account currency")
        return rate

    async def place_market_order(self, req: OrderRequest) -> OrderResult:
        from ctrader_open_api.messages import OpenApiMessages_pb2 as M
        from ctrader_open_api.messages import OpenApiModelMessages_pb2 as MM
        if not self.demo_verified:
            raise BrokerError("demo account not verified: refusing to send an order")
        spec = self._spec
        # Market orders take stop and target as distances (1/100000 of price).
        def rel(dist: float) -> int:
            return int(round(round(dist, spec.digits) * PRICE_SCALE))
        msg = M.ProtoOANewOrderReq(
            ctidTraderAccountId=self.account_id, symbolId=spec.broker_symbol_id,
            orderType=MM.ProtoOAOrderType.Value("MARKET"),
            tradeSide=MM.ProtoOATradeSide.Value(req.side),
            volume=int(round(req.units * VOLUME_SCALE)),
            relativeStopLoss=rel(abs(req.entry_reference - req.stop_loss)),
            relativeTakeProfit=rel(abs(req.take_profit - req.entry_reference)),
            label=req.client_order_id, clientOrderId=req.client_order_id,
            comment="gold-ai-bot demo")
        waiter = self._loop.create_future()
        self._fill_waiters[req.client_order_id] = waiter
        try:
            try:
                first = await self._req(msg, timeout=10)
            except asyncio.TimeoutError as e:
                raise OrderTimeout("no response to new order") from e
            except BrokerError as e:
                if "timeout" in str(e).lower() or "cancel" in str(e).lower():
                    raise OrderTimeout(str(e)) from e
                return OrderResult(status="REJECTED", reason=str(e))
            ev = first
            names = MM.ProtoOAExecutionType.Name
            while names(ev.executionType) not in ("ORDER_FILLED", "ORDER_REJECTED",
                                                  "ORDER_CANCELLED", "ORDER_EXPIRED"):
                try:
                    ev = await asyncio.wait_for(waiter, FILL_WAIT_S)
                except asyncio.TimeoutError as e:
                    raise OrderTimeout("accepted but no fill event") from e
                waiter = self._loop.create_future()
                self._fill_waiters[req.client_order_id] = waiter
                if type(ev).__name__ == "ProtoOAOrderErrorEvent":
                    return OrderResult(status="REJECTED", reason=ev.description)
            if names(ev.executionType) != "ORDER_FILLED":
                return OrderResult(status="REJECTED", reason=names(ev.executionType))
            return OrderResult(status="FILLED", position_id=str(ev.position.positionId),
                               fill_price=ev.position.price)
        finally:
            self._fill_waiters.pop(req.client_order_id, None)

    async def close_position(self, position_id: str) -> None:
        from ctrader_open_api.messages import OpenApiMessages_pb2 as M
        pos = next((p for p in await self._reconcile_positions()
                    if str(p.positionId) == position_id), None)
        if pos is None:
            return
        await self._req(M.ProtoOAClosePositionReq(ctidTraderAccountId=self.account_id,
                                                  positionId=pos.positionId,
                                                  volume=pos.tradeData.volume))

    async def _reconcile_positions(self):
        from ctrader_open_api.messages import OpenApiMessages_pb2 as M
        return list((await self._req(M.ProtoOAReconcileReq(
            ctidTraderAccountId=self.account_id))).position)

    async def open_positions(self) -> list[Position]:
        from ctrader_open_api.messages import OpenApiMessages_pb2 as M
        from ctrader_open_api.messages import OpenApiModelMessages_pb2 as MM
        raw = await self._reconcile_positions()
        pnl = await self._req(M.ProtoOAGetPositionUnrealizedPnLReq(
            ctidTraderAccountId=self.account_id))
        pscale = 10 ** (pnl.moneyDigits or self._money_digits)
        unreal = {p.positionId: p.netUnrealizedPnL / pscale for p in pnl.positionUnrealizedPnL}
        out = []
        for p in raw:
            td = p.tradeData
            out.append(Position(
                position_id=str(p.positionId),
                symbol=self._symbol_names.get(td.symbolId, str(td.symbolId)),
                side=MM.ProtoOATradeSide.Name(td.tradeSide), units=td.volume / VOLUME_SCALE,
                entry_price=p.price, stop_loss=p.stopLoss if p.HasField("stopLoss") else None,
                take_profit=p.takeProfit if p.HasField("takeProfit") else None,
                label=td.label, open_time=_ts(td.openTimestamp),
                unrealized_net=unreal.get(p.positionId, 0.0)))
        return out

    async def pending_order_labels(self) -> list[str]:
        from ctrader_open_api.messages import OpenApiMessages_pb2 as M
        res = await self._req(M.ProtoOAReconcileReq(ctidTraderAccountId=self.account_id))
        return [o.tradeData.label or o.clientOrderId for o in res.order]

    async def closed_trades(self, since: datetime) -> list[ClosedTrade]:
        """Closing deals, net of swap and BOTH commissions (open and close)."""
        from ctrader_open_api.messages import OpenApiMessages_pb2 as M
        from ctrader_open_api.messages import OpenApiModelMessages_pb2 as MM
        now = datetime.now(timezone.utc)
        deals, start = [], since - timedelta(days=7)  # earlier window finds opening deals
        while start < now:
            end = min(start + timedelta(days=7), now)  # API window is at most one week
            res = await self._req(M.ProtoOADealListReq(
                ctidTraderAccountId=self.account_id, fromTimestamp=int(start.timestamp() * 1000),
                toTimestamp=int(end.timestamp() * 1000), maxRows=1000), timeout=20)
            deals += list(res.deal)
            start = end
        opening = {d.positionId: d for d in deals if not d.HasField("closePositionDetail")
                   and MM.ProtoOADealStatus.Name(d.dealStatus) in ("FILLED", "PARTIALLY_FILLED")}
        labels = {p.position_id: p.label for p in await self.open_positions()}
        out = []
        for d in deals:
            if not d.HasField("closePositionDetail"):
                continue
            cd = d.closePositionDetail
            scale = 10 ** (cd.moneyDigits or d.moneyDigits or self._money_digits)
            close_t = _ts(d.executionTimestamp)
            if close_t < since:
                continue
            o = opening.get(d.positionId)
            open_comm = abs(o.commission) / 10 ** (o.moneyDigits or self._money_digits) if o else 0.0
            closed_side = MM.ProtoOATradeSide.Name(d.tradeSide)
            out.append(ClosedTrade(
                position_id=str(d.positionId), symbol="XAUUSD",
                side="BUY" if closed_side == "SELL" else "SELL",  # closing deal is the opposite side
                units=cd.closedVolume / VOLUME_SCALE, entry_price=cd.entryPrice,
                exit_price=d.executionPrice, open_time=_ts(o.executionTimestamp) if o else None,
                close_time=close_t, gross=cd.grossProfit / scale,
                commission=-(abs(cd.commission) / scale + open_comm),  # always a cost
                swap=cd.swap / scale, label=labels.get(str(d.positionId), "")))
        return out

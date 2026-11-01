"""The broker interface, plus a paper broker for tests and offline replays.

Every broker call the bot makes goes through this interface, so the risk
engine, execution and recovery logic can be tested without cTrader, without
the internet and without an AI bill. ctrader_broker.py is the real adapter.
"""

from __future__ import annotations

import itertools
from datetime import datetime
from typing import Protocol

from .models import (AccountState, Candle, ClosedTrade, OrderRequest, OrderResult,
                     OrderTimeout, Position, Quote, SymbolSpec, Timeframe)


class Broker(Protocol):
    demo_verified: bool

    async def connect(self) -> None: ...
    async def disconnect(self) -> None: ...
    async def account(self) -> AccountState: ...
    async def symbol_spec(self, symbol: str) -> SymbolSpec: ...
    async def candles(self, symbol: str, timeframe: Timeframe, count: int) -> list[Candle]:
        """Closed bars only, oldest first. The bar still forming is never returned."""
    async def quote(self, symbol: str) -> Quote: ...
    async def conversion_rate(self, from_ccy: str, to_ccy: str) -> float:
        """Units of to_ccy per 1 unit of from_ccy."""
    async def place_market_order(self, req: OrderRequest) -> OrderResult:
        """May raise OrderTimeout: then the order may or may not exist."""
    async def close_position(self, position_id: str) -> None: ...
    async def open_positions(self) -> list[Position]: ...
    async def pending_order_labels(self) -> list[str]: ...
    async def closed_trades(self, since: datetime) -> list[ClosedTrade]: ...


def round_turn_commission_per_unit(spec: SymbolSpec, price: float) -> float:
    """Estimated commission for opening AND closing one unit, in quote currency.
    cTrader charges per side, so the per-side rate is doubled. XAUUSD is quoted
    in USD, so USD-denominated commission is already in quote currency."""
    r = spec.commission_rate
    per_side = {
        "NONE": 0.0,
        "USD_PER_LOT": r / spec.units_per_lot,
        "QUOTE_CCY_PER_LOT": r / spec.units_per_lot,
        "USD_PER_MILLION_USD": r * price / 1_000_000,
        "PERCENTAGE_OF_VALUE": price * r / 100,
    }[spec.commission_type]
    return 2 * per_side


class PaperBroker:
    """Fills at the quote, applies stops and targets bar by bar (the stop wins
    when one bar touches both), and charges commission. fail_next lets tests
    simulate the failures that matter: 'reject', 'timeout_absent' (the order
    never landed), 'timeout_filled' (it landed but the ack was lost) and
    'no_stop' (filled without its stop attached)."""

    def __init__(self, spec: SymbolSpec, *, balance: float = 4000.0, currency: str = "ZAR",
                 quote_to_account: float = 17.5, leverage: float = 100.0,
                 account_id: int = 1, is_live: bool = False):
        self.spec = spec
        self.balance = balance
        self.currency = currency
        self.quote_to_account = quote_to_account
        self.leverage = leverage
        self.account_id = account_id
        self.is_live = is_live
        self.demo_verified = False
        self.fail_next: list[str] = []
        self.orders_received: list[OrderRequest] = []
        self._m15: list[Candle] = []
        self._h1: list[Candle] = []
        self._quote: Quote | None = None
        self._positions: dict[str, Position] = {}
        self._closed: list[ClosedTrade] = []
        self._ids = itertools.count(1001)

    # ---- market feed (driven by tests or the replay command) -----------------
    def set_market(self, m15: list[Candle], h1: list[Candle], quote: Quote) -> None:
        self._m15, self._h1, self._quote = list(m15), list(h1), quote

    def advance(self, bar: Candle, now: datetime) -> None:
        """Apply one new bar to open positions. Exits fill at the stop or target
        price exactly; a real stop can fill worse (gaps, news)."""
        for pid, p in list(self._positions.items()):
            hit = None
            if p.side == "BUY":
                if p.stop_loss is not None and bar.low <= p.stop_loss:
                    hit = p.stop_loss
                elif p.take_profit is not None and bar.high >= p.take_profit:
                    hit = p.take_profit
            else:
                if p.stop_loss is not None and bar.high >= p.stop_loss:
                    hit = p.stop_loss
                elif p.take_profit is not None and bar.low <= p.take_profit:
                    hit = p.take_profit
            if hit is not None:
                self._close(pid, hit, now)

    def _close(self, pid: str, price: float, now: datetime) -> None:
        p = self._positions.pop(pid)
        sign = 1 if p.side == "BUY" else -1
        gross = (price - p.entry_price) * sign * p.units * self.quote_to_account
        commission = -round_turn_commission_per_unit(self.spec, p.entry_price) * p.units \
            * self.quote_to_account
        t = ClosedTrade(position_id=pid, symbol=p.symbol, side=p.side, units=p.units,
                        entry_price=p.entry_price, exit_price=price, open_time=p.open_time,
                        close_time=now, gross=round(gross, 2), commission=round(commission, 2),
                        swap=0.0, label=p.label)
        self.balance += t.net
        self._closed.append(t)

    def _unrealized(self, p: Position) -> float:
        q = self._quote
        if q is None:
            return 0.0
        move = (q.bid - p.entry_price) if p.side == "BUY" else (p.entry_price - q.ask)
        return move * p.units * self.quote_to_account

    # ---- Broker interface ----------------------------------------------------
    async def connect(self) -> None:
        if self.is_live:
            from .models import LiveAccountRefused
            raise LiveAccountRefused("paper broker configured as live: refusing")
        self.demo_verified = True

    async def disconnect(self) -> None:
        self.demo_verified = False

    async def account(self) -> AccountState:
        unreal = sum(self._unrealized(p) for p in self._positions.values())
        margin = sum(p.units * p.entry_price * self.quote_to_account / self.leverage
                     for p in self._positions.values())
        return AccountState(account_id=self.account_id, is_live=self.is_live,
                            currency=self.currency, balance=round(self.balance, 2),
                            equity=round(self.balance + unreal, 2), leverage=self.leverage,
                            used_margin=round(margin, 2))

    async def symbol_spec(self, symbol: str) -> SymbolSpec:
        return self.spec

    async def candles(self, symbol: str, timeframe: Timeframe, count: int) -> list[Candle]:
        bars = self._m15 if timeframe == "M15" else self._h1
        return bars[-count:]

    async def quote(self, symbol: str) -> Quote:
        if self._quote is None:
            from .models import BrokerError
            raise BrokerError("no quote yet")
        return self._quote

    async def conversion_rate(self, from_ccy: str, to_ccy: str) -> float:
        if from_ccy == to_ccy:
            return 1.0
        if from_ccy == self.spec.quote_currency and to_ccy == self.currency:
            return self.quote_to_account
        from .models import BrokerError
        raise BrokerError(f"no conversion {from_ccy}->{to_ccy}")

    async def place_market_order(self, req: OrderRequest) -> OrderResult:
        self.orders_received.append(req)
        mode = self.fail_next.pop(0) if self.fail_next else ""
        if mode == "reject":
            return OrderResult(status="REJECTED", reason="simulated broker rejection")
        if mode == "timeout_absent":
            raise OrderTimeout("simulated: no ack, order never landed")
        q = self._quote
        fill = q.ask if req.side == "BUY" else q.bid
        # Stops are sent as distances (cTrader market orders take relative SL/TP),
        # so they move with the fill price.
        sl_d = abs(req.entry_reference - req.stop_loss)
        tp_d = abs(req.take_profit - req.entry_reference)
        sign = 1 if req.side == "BUY" else -1
        pid = str(next(self._ids))
        self._positions[pid] = Position(
            position_id=pid, symbol=req.symbol, side=req.side, units=req.units,
            entry_price=fill, stop_loss=None if mode == "no_stop" else fill - sign * sl_d,
            take_profit=fill + sign * tp_d, label=req.client_order_id, open_time=q.time)
        if mode == "timeout_filled":
            raise OrderTimeout("simulated: order filled but the ack was lost")
        return OrderResult(status="FILLED", position_id=pid, fill_price=fill)

    async def close_position(self, position_id: str) -> None:
        p = self._positions[position_id]
        q = self._quote
        self._close(position_id, q.bid if p.side == "BUY" else q.ask, q.time)

    async def open_positions(self) -> list[Position]:
        return [p.model_copy(update={"unrealized_net": round(self._unrealized(p), 2)})
                for p in self._positions.values()]

    async def pending_order_labels(self) -> list[str]:
        return []

    async def closed_trades(self, since: datetime) -> list[ClosedTrade]:
        return [t for t in self._closed if t.close_time >= since]

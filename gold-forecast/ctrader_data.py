"""Read-only client for the cTrader remote MCP *data* profile.

Only the `data` profile is used (https://mcp.ctrader.com/data/mcp): it exposes
read-only tools, so nothing here can place, amend or close a trade. The bearer
token is injected by the session's network proxy, never stored in this repo.

Prices from get_trendbars / get_spot_prices arrive as integers in 1e-5 units
(e.g. 414128000 -> 4141.28).
"""
import json
import time

import pandas as pd
import requests

URL = "https://mcp.ctrader.com/data/mcp"
PRICE_SCALE = 100_000
PERIOD_MIN = {"M_1": 1, "M_5": 5, "M_15": 15, "M_30": 30, "H_1": 60, "H_4": 240, "D_1": 1440}
MAX_WINDOW_MIN = 30 * 1440  # server cap: 30 days per call
MAX_BARS = 1000             # server cap: 1000 bars per call


class CTraderData:
    def __init__(self):
        self.sid = None
        self.n = 0
        self._post({"jsonrpc": "2.0", "id": self._id(), "method": "initialize",
                    "params": {"protocolVersion": "2025-06-18", "capabilities": {},
                               "clientInfo": {"name": "gold-forecast", "version": "1.0"}}})
        self._post({"jsonrpc": "2.0", "method": "notifications/initialized"})

    def _id(self):
        self.n += 1
        return self.n

    def _post(self, payload):
        h = {"Content-Type": "application/json", "Accept": "application/json, text/event-stream"}
        if self.sid:
            h["Mcp-Session-Id"] = self.sid
        for attempt in range(4):
            try:
                r = requests.post(URL, headers=h, data=json.dumps(payload), timeout=60)
                r.raise_for_status()
                break
            except requests.RequestException:
                if attempt == 3:
                    raise
                time.sleep(2 ** (attempt + 1))
        self.sid = r.headers.get("Mcp-Session-Id", self.sid)
        if not r.text.strip():
            return None
        if r.headers.get("Content-Type", "").startswith("text/event-stream"):
            out = None
            for line in r.text.splitlines():
                if line.startswith("data:"):
                    out = json.loads(line[5:].strip())
            return out
        return r.json()

    def call(self, name, args=None):
        res = self._post({"jsonrpc": "2.0", "id": self._id(), "method": "tools/call",
                          "params": {"name": name, "arguments": args or {}}})
        if "error" in res:
            raise RuntimeError(res["error"])
        r = res["result"]
        if r.get("isError"):
            raise RuntimeError(r.get("content"))
        if r.get("structuredContent") is not None:
            return r["structuredContent"]
        return json.loads("".join(c.get("text", "") for c in r.get("content", [])))

    def symbol_id(self, name="XAUUSD"):
        syms = self.call("get_symbols")
        items = next(v for v in syms.values() if isinstance(v, list)) if isinstance(syms, dict) else syms
        return next(s["symbolId"] for s in items if s["symbolName"] == name)

    def spot(self, symbol_id):
        p = self.call("get_spot_prices", {"symbolId": [symbol_id]})["prices"][0]
        return {"bid": p["bid"] / PRICE_SCALE, "ask": p["ask"] / PRICE_SCALE,
                "time_utc": pd.to_datetime(p["timestamp"], unit="ms", utc=True)}

    def bars(self, symbol_id, period, start_utc, end_utc=None):
        """All bars with open time in [start_utc, end_utc), paging backwards within server caps."""
        end = pd.Timestamp(end_utc or pd.Timestamp.now(tz="UTC"))
        start = pd.Timestamp(start_utc)
        step = pd.Timedelta(minutes=min(MAX_WINDOW_MIN, int(PERIOD_MIN[period] * MAX_BARS * 0.97)))
        rows, to = [], end
        while to > start:
            frm = max(start, to - step)
            res = self.call("get_trendbars", {"symbolId": symbol_id, "period": period,
                                              "fromTimestamp": str(int(frm.timestamp() * 1000)),
                                              "toTimestamp": str(int(to.timestamp() * 1000)),
                                              "count": MAX_BARS})
            rows.extend(res.get("trendbars", []))
            to = frm
            time.sleep(0.15)
        if not rows:
            return pd.DataFrame(columns=["time_utc", "open", "high", "low", "close", "volume"])
        df = pd.DataFrame(rows).drop_duplicates("timestamp").sort_values("timestamp")
        df["time_utc"] = pd.to_datetime(df["timestamp"], unit="ms", utc=True)
        for c in ("open", "high", "low", "close"):
            df[c] = df[c] / PRICE_SCALE
        df = df[(df.time_utc >= start) & (df.time_utc < end)]
        return df[["time_utc", "open", "high", "low", "close", "volume"]].reset_index(drop=True)

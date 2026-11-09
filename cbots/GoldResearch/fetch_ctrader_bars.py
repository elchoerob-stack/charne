#!/usr/bin/env python3
"""
Download M1 bid bars for one symbol from the cTrader remote MCP server (your broker's own
price feed, read-only tool `get_trendbars`) and write the harness's M1 bid/ask CSV:

    epoch_minute, bid o/h/l/c, ask o/h/l/c, source flag "C"

cTrader trendbars are BID prices. The ask is bid + a spread that depends on the hour of the
New York clock, taken from a real account's measured EURUSD spread distribution (75th
percentile, Gianniskas/mt5-m1-bars-us500-eurusd-xauusd spreads_summary.csv, May 2026) plus
0.15 pip. That makes it ~0.3-0.5 pip in normal hours and ~4 pips in the 17:00 New York
rollover hour. Commission is added separately by the harness.

Authentication: the network proxy adds the Authorization header for mcp.ctrader.com; this
script never holds a token. Only the read-only tool get_trendbars is called.

Usage: python3 fetch_ctrader_bars.py <symbolId> <pip> 2016-09-01 2026-11-09 out.csv cache_dir
"""
import json
import os
import ssl
import sys
import time
import urllib.request
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

URL = "https://mcp.ctrader.com/trading/mcp"
CA = "/root/.ccr/ca-bundle.crt"
CTX = ssl.create_default_context(cafile=CA) if os.path.exists(CA) else ssl.create_default_context()
NY = ZoneInfo("America/New_York")

# 75th-percentile EURUSD spread in points (0.1 pip) by UTC hour, measured in May (New York = UTC-4)
P75_POINTS_BY_UTC_HOUR_MAY = {0: 2.616, 1: 3.105, 2: 2.458, 3: 2.508, 4: 2.525, 5: 3.583, 6: 2.429, 7: 2.15,
                              8: 2.683, 9: 2.032, 10: 2.129, 11: 2.129, 12: 2.0, 13: 2.481, 14: 2.35, 15: 2.167,
                              16: 2.453, 17: 2.486, 18: 2.558, 19: 2.279, 20: 4.614, 21: 39.346, 22: 3.366, 23: 2.844}
SPREAD_PIPS_BY_NY_HOUR = {(h - 4) % 24: v / 10 + 0.15 for h, v in P75_POINTS_BY_UTC_HOUR_MAY.items()}


class Mcp:
    def __init__(self):
        self.sid, self.n = None, 0
        self.rpc("initialize", {"protocolVersion": "2025-06-18", "capabilities": {},
                                "clientInfo": {"name": "charne-research", "version": "1.0"}})
        self.rpc("notifications/initialized", notify=True)

    def rpc(self, method, params=None, notify=False):
        body = {"jsonrpc": "2.0", "method": method}
        if params is not None:
            body["params"] = params
        if not notify:
            self.n += 1
            body["id"] = self.n
        req = urllib.request.Request(URL, data=json.dumps(body).encode(), method="POST")
        req.add_header("Content-Type", "application/json")
        req.add_header("Accept", "application/json, text/event-stream")
        req.add_header("MCP-Protocol-Version", "2025-06-18")
        if self.sid:
            req.add_header("Mcp-Session-Id", self.sid)
        with urllib.request.urlopen(req, context=CTX, timeout=90) as r:
            self.sid = r.headers.get("Mcp-Session-Id") or self.sid
            raw, ctype = r.read().decode("utf-8", "replace"), r.headers.get("Content-Type", "")
        if notify or not raw.strip():
            return None
        if "text/event-stream" in ctype:
            msgs = [json.loads(l[5:]) for l in raw.splitlines() if l.startswith("data:") and l[5:].strip()]
            return msgs[-1] if msgs else None
        return json.loads(raw)

    def trendbars(self, symbol_id, frm, to):
        r = self.rpc("tools/call", {"name": "get_trendbars", "arguments": {
            "symbolId": symbol_id, "period": "M_1", "fromTimestamp": frm, "toTimestamp": to, "count": 1000}})
        res = r.get("result", {})
        if res.get("isError"):
            raise RuntimeError(res["content"][0]["text"][:300])
        return json.loads(res["content"][0]["text"]).get("trendbars", [])


def main():
    sym, pip = int(sys.argv[1]), float(sys.argv[2])
    d0 = datetime.fromisoformat(sys.argv[3]).replace(tzinfo=timezone.utc)
    d1 = datetime.fromisoformat(sys.argv[4]).replace(tzinfo=timezone.utc)
    out, cache = sys.argv[5], sys.argv[6]
    os.makedirs(cache, exist_ok=True)
    mcp, step = Mcp(), timedelta(hours=16)          # 960 minutes per call, under the 1000-bar cap
    month = d0.replace(day=1)
    while month < d1:
        nxt = (month + timedelta(days=32)).replace(day=1)
        path = os.path.join(cache, f"{sym}_{month:%Y-%m}.json")
        if not os.path.exists(path) or month + timedelta(days=40) > d1:
            bars, t = {}, max(month, d0)
            while t < min(nxt, d1):
                if t.weekday() != 5:                    # FX is shut on Saturdays (UTC)
                    for attempt in range(6):
                        try:
                            for b in mcp.trendbars(sym, t.strftime("%Y-%m-%dT%H:%M:%SZ"), min(t + step, nxt).strftime("%Y-%m-%dT%H:%M:%SZ")):
                                bars[b["timestamp"] // 60000] = (b["open"], b["high"], b["low"], b["close"])
                            break
                        except Exception as e:
                            time.sleep(min(60, 3 * 2 ** attempt))
                            if attempt == 5:
                                print("gave up on", t, e, flush=True)
                            try:
                                mcp = Mcp()
                            except Exception:
                                pass
                    time.sleep(0.1)
                t += step
            with open(path + ".tmp", "w") as f:
                json.dump(bars, f)
            os.replace(path + ".tmp", path)
            print(f"{month:%Y-%m}: {len(bars)} bars", flush=True)
        month = nxt
    n = 0
    with open(out, "w") as f:
        month = d0.replace(day=1)
        while month < d1:
            bars = json.load(open(os.path.join(cache, f"{sym}_{month:%Y-%m}.json")))
            for k in sorted(bars, key=int):
                m = int(k)
                o, h, l, c = (x * 1e-5 for x in bars[k])
                ny_hour = datetime.fromtimestamp(m * 60, timezone.utc).astimezone(NY).hour
                s = SPREAD_PIPS_BY_NY_HOUR[ny_hour] * pip
                f.write(f"{m},{o:.5f},{h:.5f},{l:.5f},{c:.5f},{o+s:.5f},{h+s:.5f},{l+s:.5f},{c+s:.5f},C\n")
                n += 1
            month = (month + timedelta(days=32)).replace(day=1)
    print(f"{n} minutes written to {out}")


if __name__ == "__main__":
    main()

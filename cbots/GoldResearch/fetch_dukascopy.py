#!/usr/bin/env python3
"""
Download Dukascopy 1-minute BID and ASK candles and write the M1 bid/ask CSV the research
harness reads (same layout as the gold file):

    epoch_minute, bid o/h/l/c, ask o/h/l/c, source flag "K"

Source: https://datafeed.dukascopy.com/datafeed/<SYMBOL>/<YYYY>/<MM-1>/<DD>/{BID,ASK}_candles_min_1.bi5
(one LZMA file per UTC day and side; 24-byte records: seconds, open, close, low, high as
integers x 1/point, volume as float). Minutes with no ticks (volume 0) are dropped.

Usage: python3 fetch_dukascopy.py EURUSD 2016-09-01 2026-11-07 out.csv [point=1e-5] [cache_dir] [threads=2]
Requests go out one at a time, 0.35 s apart (a 429 pauses for 2 minutes). Each file is cached, so a re-run only fetches what is missing; days that still
fail are listed and left out. Standard library only. Needs access to datafeed.dukascopy.com.
"""
import concurrent.futures as cf
import lzma
import os
import ssl
import struct
import sys
import threading
import time
import urllib.request
from datetime import date, timedelta, datetime, timezone

CA = "/root/.ccr/ca-bundle.crt"
CTX = ssl.create_default_context(cafile=CA) if os.path.exists(CA) else ssl.create_default_context()


CACHE = None
FAILED = []
PAUSE = 0.35            # seconds between requests: Dukascopy answers 429 to bursts
_lock = threading.Lock()
_next_ok = [0.0]


def _polite_get(url):
    """One request at a time across threads, PAUSE apart; a 429 pauses everyone for 2 minutes."""
    for attempt in range(30):
        with _lock:
            wait = _next_ok[0] - time.time()
            if wait > 0:
                time.sleep(wait)
            _next_ok[0] = time.time() + PAUSE
        try:
            return urllib.request.urlopen(url, context=CTX, timeout=60).read()
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return b""
            if e.code == 429:
                with _lock:
                    _next_ok[0] = max(_next_ok[0], time.time() + 120)
                continue
            time.sleep(min(60, 2 ** attempt))
        except Exception:
            time.sleep(min(60, 2 ** attempt))
    return None


def fetch(symbol, d, side):
    name = f"{symbol}_{d.isoformat()}_{side}.bi5"
    path = os.path.join(CACHE, name) if CACHE else None
    if path and os.path.exists(path):
        raw = open(path, "rb").read()
    else:
        url = f"https://datafeed.dukascopy.com/datafeed/{symbol}/{d.year}/{d.month - 1:02d}/{d.day:02d}/{side}_candles_min_1.bi5"
        raw = _polite_get(url)
        if raw is None:
            FAILED.append(name)
            return []
        if path:
            with open(path + ".tmp", "wb") as f:
                f.write(raw)
            os.replace(path + ".tmp", path)
    if not raw:
        return []
    data = lzma.decompress(raw)
    return [struct.unpack(">IIIIIf", data[i:i + 24]) for i in range(0, len(data) - 23, 24)]


def day_rows(symbol, d, point):
    bid, ask = fetch(symbol, d, "BID"), fetch(symbol, d, "ASK")
    if not bid or not ask:
        return d, []
    a_by = {r[0]: r for r in ask}
    base = int(datetime(d.year, d.month, d.day, tzinfo=timezone.utc).timestamp()) // 60
    out = []
    for b in bid:
        a = a_by.get(b[0])
        if a is None or (b[5] <= 0 and a[5] <= 0):
            continue
        # record = (sec, open, close, low, high, vol) -> o, h, l, c
        bo, bc, bl, bh = (x * point for x in b[1:5])
        ao, ac, al, ah = (x * point for x in a[1:5])
        if min(bo, bh, bl, bc, ao, ah, al, ac) <= 0 or ac < bc:
            continue
        out.append(f"{base + b[0] // 60},{bo:.5f},{bh:.5f},{bl:.5f},{bc:.5f},{ao:.5f},{ah:.5f},{al:.5f},{ac:.5f},K")
    return d, out


def main():
    symbol, start, end, out = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
    point = float(sys.argv[5]) if len(sys.argv) > 5 else 1e-5
    global CACHE
    CACHE = sys.argv[6] if len(sys.argv) > 6 else None
    threads = int(sys.argv[7]) if len(sys.argv) > 7 else 2
    if CACHE:
        os.makedirs(CACHE, exist_ok=True)
    d0, d1 = date.fromisoformat(start), date.fromisoformat(end)
    days = [d0 + timedelta(i) for i in range((d1 - d0).days + 1)]
    days = [d for d in days if d.weekday() != 5]          # no FX trading on Saturdays (UTC)
    results, done = {}, 0
    with cf.ThreadPoolExecutor(threads) as ex:
        for d, rows in ex.map(lambda x: day_rows(symbol, x, point), days):
            results[d] = rows
            done += 1
            if done % 250 == 0:
                print(f"{done}/{len(days)} days ({d})", flush=True)
    n = 0
    with open(out, "w") as f:
        for d in days:
            for line in results[d]:
                f.write(line + "\n")
                n += 1
    print(f"{n} minutes written to {out}")
    if FAILED:
        print(f"{len(FAILED)} files still missing after retries (re-run to fetch them): {FAILED[:10]}")


if __name__ == "__main__":
    main()

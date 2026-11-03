#!/usr/bin/env python3
"""
Builds the M1 bid/ask gold file the GoldGuard backtester reads.

Sources (public GitHub repos, cloned separately; see README.md):
  dypoi   Dypoi/XAUUSD_Dataset: XAUUSD_M1_YYYYMMDD_YYYYMMDD.csv, bid AND ask OHLC,
          UTC, continuous 2016-09 .. 2026-09-01. Primary source.
  parshant parshant65-lang/Gold-XAUUSD-1m-2020-2025-Historical-Data: daily mid-price
          M1 files, UTC, to late Oct 2026, but with holes in 2025 (Mar, Apr, Jun,
          Jul-Sep). Used only to extend past the end of the primary source. Its
          spread is synthesised from the primary source's median spread for the same
          UTC hour over the last 120 days.

Alignment was checked: on shared minutes in Jun-Aug 2026 the two agree to a median
$0.07 with no time shift ($5-7 off with a one-hour shift either way).

Output CSV (no header): epoch_minute, bid o/h/l/c, ask o/h/l/c, source flag (D/P)

Usage: python3 prepare_data.py <dypoi_dir> <parshant_dir> <out.csv> [start YYYY-MM-DD]
Standard library only.
"""
import csv
import glob
import statistics
import sys
from collections import defaultdict
from datetime import datetime, timezone


def epoch_min(ts: str) -> int:
    t = datetime.strptime(ts, "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)
    return int(t.timestamp()) // 60


def main():
    dypoi, parshant, out = sys.argv[1], sys.argv[2], sys.argv[3]
    start = epoch_min((sys.argv[4] if len(sys.argv) > 4 else "2022-09-01") + " 00:00:00")
    rows = {}
    for f in sorted(glob.glob(dypoi + "/XAUUSD_M1_*.csv")):
        with open(f) as fh:
            for x in csv.DictReader(fh):
                m = epoch_min(x["timestamp"])
                if m < start:
                    continue
                b = [float(x[k]) for k in ("open_bid", "high_bid", "low_bid", "close_bid")]
                a = [float(x[k]) for k in ("open_ask", "high_ask", "low_ask", "close_ask")]
                if min(b + a) <= 0 or b[2] > min(b[0], b[3]) or b[1] < max(b[0], b[3]):
                    continue
                rows[m] = (b, a, "D")
    last_primary = max(rows)
    # Typical spread by UTC hour over the primary source's last 120 days
    by_hour = defaultdict(list)
    for m, (b, a, _) in rows.items():
        if m > last_primary - 120 * 1440:
            by_hour[(m // 60) % 24].append(a[3] - b[3])
    spread = {h: statistics.median(v) for h, v in by_hour.items()}
    added = 0
    for f in sorted(glob.glob(parshant + "/XAUUSD/1m/*/*/*.csv")):
        with open(f) as fh:
            for x in csv.DictReader(fh):
                m = epoch_min(x["datetime_utc"])
                if m <= last_primary:
                    continue
                mid = [float(x[k]) for k in ("open", "high", "low", "close")]
                h = spread.get((m // 60) % 24, statistics.median(spread.values())) / 2
                rows[m] = ([p - h for p in mid], [p + h for p in mid], "P")
                added += 1
    with open(out, "w", newline="") as fh:
        w = csv.writer(fh)
        for m in sorted(rows):
            b, a, src = rows[m]
            w.writerow([m] + ["%.3f" % p for p in b + a] + [src])
    first = datetime.fromtimestamp(min(rows) * 60, timezone.utc)
    last = datetime.fromtimestamp(max(rows) * 60, timezone.utc)
    print(f"{len(rows)} minutes, {first:%Y-%m-%d %H:%M} -> {last:%Y-%m-%d %H:%M} UTC; "
          f"{added} extension minutes after {datetime.fromtimestamp(last_primary * 60, timezone.utc):%Y-%m-%d %H:%M} "
          f"with synthetic spread (median ${statistics.median(spread.values()):.2f})")


if __name__ == "__main__":
    main()

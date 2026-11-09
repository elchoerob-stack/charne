"""Score the frozen projection against what XAUUSD actually did.

    python3 check.py                       # latest forecast_*.json and its workbook
    python3 check.py forecast_2026-11-10.json XAUUSD_MTF_Forecast_2026-11-10.xlsx

Pulls the actual H1 bars for the forecast session from cTrader (read-only data
profile), writes them into the yellow ACTUAL columns of the Forecast Timeline,
recalculates the workbook, logs the day on the Scorecard once the session is
complete, and prints a scorecard. Safe to run mid-session: only bars that have
closed are filled.
"""
import glob
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from openpyxl import load_workbook
from openpyxl.styles import Font

from build_workbook import add_timeline_chart
from ctrader_data import CTraderData

HERE = Path(__file__).parent
SAST = pd.Timedelta(hours=2)


def recalc(path):
    hits = glob.glob("/root/.claude/skills/**/xlsx/scripts/recalc.py", recursive=True)
    if hits:
        out = subprocess.run([sys.executable, hits[0], str(path), "300"], capture_output=True, text=True,
                             cwd=str(Path(hits[0]).parent))
        return out.stdout.strip() or out.stderr.strip()
    # fallback: round-trip through LibreOffice, which recalculates on load
    tmp = Path(path).parent / "_recalc"
    tmp.mkdir(exist_ok=True)
    subprocess.run(["soffice", "--headless", "--calc", "--convert-to", "xlsx", "--outdir", str(tmp), str(path)],
                   capture_output=True, timeout=300)
    (tmp / Path(path).name).replace(path)
    tmp.rmdir()
    return "recalculated via soffice convert"


def main(fjson=None, xlsx=None):
    fjson = Path(fjson) if fjson else sorted(HERE.glob("forecast_*.json"))[-1]
    F = json.loads(fjson.read_text())
    day = fjson.stem.split("_")[1]
    xlsx = Path(xlsx) if xlsx else HERE / f"XAUUSD_MTF_Forecast_{day}.xlsx"
    bars = [pd.Timestamp(b) for b in F["bars_utc"]]
    now = pd.Timestamp.now(tz="UTC")

    ct = CTraderData()
    sid = ct.symbol_id(F["symbol"])
    act = ct.bars(sid, "H_1", bars[0], bars[-1] + pd.Timedelta(hours=1))
    act = act[act.time_utc + pd.Timedelta(hours=1) <= now]          # closed bars only
    by_t = {t: r for t, r in zip(act.time_utc, act.itertuples(index=False))}

    wb = load_workbook(xlsx)
    ws = wb["Forecast Timeline"]
    first = F["timeline_first_row"]
    blue = Font(name="Arial", color="0000FF")
    rows = []
    for i, b in enumerate(bars):
        r = first + i
        bar = by_t.get(b)
        if bar is None:
            continue
        for c, v in zip("NOP", (bar.close, bar.high, bar.low)):
            ws[f"{c}{r}"] = round(float(v), 2)
            ws[f"{c}{r}"].font = blue
        proj = F["anchor"] + F["projected_move"][i]
        sig = F["sigma"][i]
        rows.append(dict(i=i, end_sast=(b + pd.Timedelta(hours=1)).tz_convert(None) + SAST, close=bar.close,
                         high=bar.high, low=bar.low, proj=proj,
                         in50=abs(bar.close - proj) <= F["z50"] * sig, in80=abs(bar.close - proj) <= F["z80"] * sig))
    n = len(rows)
    if n == 0:
        print(f"No closed bars yet for the {day} session (first bar opens {bars[0].tz_convert(None) + SAST:%a %H:%M} SAST).")
        return
    a = F["anchor"]
    err = np.array([abs(x["close"] - x["proj"]) for x in rows])
    rw = np.array([abs(x["close"] - a) for x in rows])
    ratio = err.mean() / rw.mean() if rw.mean() > 0 else float("nan")
    c50 = np.mean([x["in50"] for x in rows])
    c80 = np.mean([x["in80"] for x in rows])
    last = rows[-1]
    proj_close = a + F["projected_move"][-1]
    hi, lo = max(x["high"] for x in rows), min(x["low"] for x in rows)
    complete = n == len(bars)
    dir_ok = np.sign(last["close"] - a) == np.sign(proj_close - a)
    pre = [x for x in rows if 0 < x["end_sast"].hour <= 15]
    post = [x for x in rows if x not in pre]

    if complete:
        sc = wb["Scorecard"]
        r = F["log_first_row"]
        while sc[f"A{r}"].value not in (None, day):
            r += 1
        vals = [day, n, round(ratio, 3), round(c50, 3), round(c80, 3), "Correct" if dir_ok else "Wrong",
                round(proj_close, 2), round(last["close"], 2), round(F["proj_high"], 2), round(hi, 2),
                round(F["proj_low"], 2), round(lo, 2)]
        fmts = ["@", "0", "0.00", "0.0%", "0.0%", "@"] + ["#,##0.00"] * 6
        for j, (v, fm) in enumerate(zip(vals, fmts), 1):
            c = sc.cell(row=r, column=j, value=v)
            c.font, c.number_format = blue, fm
    ws._charts = []
    ymin = min(F["chart_y"][0], int(lo // 25 * 25))
    ymax = max(F["chart_y"][1], int(hi // 25 * 25 + 25))
    add_timeline_chart(ws, first - 1, F["timeline_last_row"], ymin, ymax)
    wb.save(xlsx)
    print(recalc(xlsx))

    t = lambda x: x["end_sast"].strftime("%H:%M")
    verdict = sum([ratio < 1, 0.25 <= c50 <= 0.75, c80 >= 0.6] + ([dir_ok] if complete else []))
    print(f"\n## XAUUSD {day}: {n}/{len(bars)} hours scored (to {t(last)} SAST)")
    print(f"Anchor {a:.2f} | projected close {proj_close:.2f} | actual at {t(last)}: {last['close']:.2f} "
          f"({last['close'] - a:+.2f})")
    print(f"Mean |error| {err.mean():.2f} vs random walk {rw.mean():.2f} -> ratio {ratio:.2f} "
          f"({'PASS' if ratio < 1 else 'FAIL'}: beat random walk)")
    print(f"Inside 50% band {c50:.0%} ({'PASS' if 0.25 <= c50 <= 0.75 else 'FAIL'}), "
          f"inside 80% band {c80:.0%} ({'PASS' if c80 >= 0.6 else 'FAIL'})")
    print(f"Direction: {'PASS' if dir_ok else 'FAIL'}{'' if complete else ' (provisional, session not finished)'}")
    print(f"High {hi:.2f} vs projected {F['proj_high']:.2f} | Low {lo:.2f} vs projected {F['proj_low']:.2f}")
    if pre:
        e = np.mean([abs(x['close'] - x['proj']) for x in pre]); w = np.mean([abs(x['close'] - a) for x in pre])
        print(f"Before CPI: model {e:.2f} vs random walk {w:.2f}")
    if post:
        e = np.mean([abs(x['close'] - x['proj']) for x in post]); w = np.mean([abs(x['close'] - a) for x in post])
        print(f"After CPI:  model {e:.2f} vs random walk {w:.2f}")
    print(f"Tests passed: {verdict} / {4 if complete else 3}")
    print("\nhour  projected  actual   error  in50 in80")
    for x in rows:
        print(f"{t(x)}  {x['proj']:9.2f} {x['close']:8.2f} {x['close'] - x['proj']:+7.2f}  "
              f"{'Y' if x['in50'] else '-'}    {'Y' if x['in80'] else '-'}")


if __name__ == "__main__":
    main(*sys.argv[1:3])

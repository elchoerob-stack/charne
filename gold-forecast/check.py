"""Score the frozen projection and the pre-registered targets against what XAUUSD actually did.

    python3 check.py                 # latest forecast/targets/layout for the workbook day
    python3 check.py 2026-11-10      # a specific day (optional 2nd arg: folder holding the files)

Pulls the forecast session's actual H1 bars (and M1 bars, to time-stamp level
touches and scenario steps) from cTrader's read-only data profile, writes them
into the yellow cells, recalculates, logs the day on the Scorecard once the
session is complete, and prints the result. Safe to run mid-session: only bars
that have closed are used.
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
BLUE = Font(name="Arial", color="0000FF")


def recalc(path):
    hits = glob.glob("/root/.claude/skills/**/xlsx/scripts/recalc.py", recursive=True)
    if hits:
        out = subprocess.run([sys.executable, hits[0], str(path), "300"], capture_output=True, text=True,
                             cwd=str(Path(hits[0]).parent))
        return out.stdout.strip() or out.stderr.strip()
    tmp = Path(path).parent / "_recalc"          # fallback: LibreOffice round-trip recalculates on load
    tmp.mkdir(exist_ok=True)
    subprocess.run(["soffice", "--headless", "--calc", "--convert-to", "xlsx", "--outdir", str(tmp), str(path)],
                   capture_output=True, timeout=300)
    (tmp / Path(path).name).replace(path)
    tmp.rmdir()
    return "recalculated via soffice convert"


def hm(ts):
    return (ts.tz_convert(None) + SAST).strftime("%a %H:%M")


def first_touch(m1, price, up, after=None):
    sub = m1 if after is None else m1[m1.time_utc >= after]
    hit = sub[sub.high >= price] if up else sub[sub.low <= price]
    return hit.time_utc.iloc[0] if len(hit) else None


def scenario(s, h1, m1):
    """Trigger on a 1h CLOSE; targets on the first M1 trade through after the trigger;
    invalidation on a later 1h CLOSE back through the invalidation level."""
    up = s["key"] == "bull"
    tp = s["trigger"]["price"]
    trig = h1[h1.close > tp] if up else h1[h1.close < tp]
    res = dict(trigger=None, targets=[None, None, None], inval=None, text="Not triggered", status="Not triggered")
    if trig.empty:
        return res
    t_bar = trig.time_utc.iloc[0]
    t_time = t_bar + pd.Timedelta(hours=1)                         # the bar has to close
    res["trigger"] = t_time
    after = h1[h1.time_utc > t_bar]
    ip = s["invalidation"]["price"]
    inv = after[after.close < ip] if up else after[after.close > ip]
    res["inval"] = inv.time_utc.iloc[0] + pd.Timedelta(hours=1) if len(inv) else None
    for i, t in enumerate(s["targets"]):
        res["targets"][i] = first_touch(m1, t["price"], up, after=t_time)
    hits = [(f"T{i+1}", x) for i, x in enumerate(res["targets"]) if x is not None
            and (res["inval"] is None or x <= res["inval"])]
    parts = [f"Triggered {hm(t_time)}"] + [f"{k} hit {hm(x)}" for k, x in hits]
    if res["inval"] is not None:
        parts.append(f"invalidated {hm(res['inval'])}")
    res["text"] = " -> ".join(parts)
    return res


def main(day=None, base=None):
    base = Path(base) if base else HERE
    if day is None:
        day = sorted(base.glob("forecast_*.json"))[-1].stem.split("_")[1]
    F = json.loads((base / f"forecast_{day}.json").read_text())
    T = json.loads((base / f"targets_{day}.json").read_text())
    Lay = json.loads((base / f"layout_{day}.json").read_text())
    xlsx = base / Lay["workbook"]
    bars = [pd.Timestamp(b) for b in F["bars_utc"]]
    start, end = bars[0], bars[-1] + pd.Timedelta(hours=1)
    now = pd.Timestamp.now(tz="UTC")

    ct = CTraderData()
    sid = ct.symbol_id(F["symbol"])
    h1 = ct.bars(sid, "H_1", start, end)
    h1 = h1[h1.time_utc + pd.Timedelta(hours=1) <= now].reset_index(drop=True)      # closed bars only
    if h1.empty:
        print(f"No closed bars yet for the {day} session (first bar opens {hm(start)} SAST).")
        return
    m1 = ct.bars(sid, "M_1", start, min(end, h1.time_utc.iloc[-1] + pd.Timedelta(hours=1)))
    expected = sum(1 for b in bars if b + pd.Timedelta(hours=1) <= now)
    have = set(h1.time_utc)
    missing = [hm(b) for b in bars if b + pd.Timedelta(hours=1) <= now and b not in have]

    wb = load_workbook(xlsx)
    ws = wb["Forecast Timeline"]
    first = Lay["timeline"]["first"]
    by_t = {t: r for t, r in zip(h1.time_utc, h1.itertuples(index=False))}
    rows = []
    for i, b in enumerate(bars):
        bar = by_t.get(b)
        if bar is None:
            continue
        r = first + i
        for c, v in zip("NOP", (bar.close, bar.high, bar.low)):
            ws[f"{c}{r}"] = round(float(v), 2)
            ws[f"{c}{r}"].font = BLUE
        proj = F["anchor"] + F["projected_move"][i]
        sig = F["sigma"][i]
        rows.append(dict(i=i, end_sast=(b + pd.Timedelta(hours=1)).tz_convert(None) + SAST, close=bar.close,
                         high=bar.high, low=bar.low, proj=proj,
                         in50=abs(bar.close - proj) <= F["z50"] * sig, in80=abs(bar.close - proj) <= F["z80"] * sig))
    n = len(rows)
    complete = n == len(bars)
    a = F["anchor"]
    hi, lo = float(h1.high.max()), float(h1.low.min())

    # targets sheet: level first touches and scenario steps (yellow cells)
    tg = wb["Targets"]
    TL = Lay["targets"]
    lv_first, _ = TL["levels"]
    touched = []
    for k, L in enumerate(T["levels"]):
        t = first_touch(m1, L["price"], L["price"] > a)
        tg[f"H{lv_first + k}"] = hm(t) if t is not None else ("not touched" if complete else "")
        tg[f"H{lv_first + k}"].font = BLUE
        touched.append(1.0 if lo <= L["price"] <= hi else 0.0)
    sc_out = {}
    for s in T["scenarios"]:
        res = scenario(s, h1, m1)
        sc_out[s["key"]] = res
        rr = TL["scenarios"][s["key"]]
        cells = [(rr["trigger"], res["trigger"])] + list(zip(rr["targets"], res["targets"])) + [(rr["inval"], res["inval"])]
        for row, t in cells:
            tg[f"F{row}"] = hm(t) if t is not None else ("-" if complete else "")
            tg[f"F{row}"].font = BLUE
        tg[f"B{rr['outcome']}"] = res["text"] + ("" if complete else "  (session still running)")
        tg[f"B{rr['outcome']}"].font = BLUE

    # Python mirror of the eight tests (the sheet computes the same with formulas)
    err = np.array([abs(x["close"] - x["proj"]) for x in rows])
    rw = np.array([abs(x["close"] - a) for x in rows])
    ratio = err.mean() / rw.mean() if rw.mean() > 0 else float("nan")
    c50 = float(np.mean([x["in50"] for x in rows]))
    c80 = float(np.mean([x["in80"] for x in rows]))
    brier = float(np.mean([(L["p_touch"] - t) ** 2 for L, t in zip(T["levels"], touched)]))
    actual = {"T1": ratio, "T2": c50, "T3": c80, "T4": rows[-1]["close"], "T5": hi, "T6": lo, "T7": brier, "T8": hi - lo}
    results = {}
    for t in T["tests"]:
        v = actual[t["id"]]
        results[t["id"]] = (v, (t["lo"] is None or v >= t["lo"]) and (t["hi"] is None or v <= t["hi"]))
    passed = sum(ok for _, ok in results.values())

    if complete:
        sc = wb["Scorecard"]
        r = Lay["log_first_row"]
        while sc[f"A{r}"].value not in (None, day):
            r += 1
        vals = [day, n, round(ratio, 3), round(c50, 3), round(c80, 3), "Correct" if results["T4"][1] else "Wrong",
                round(a + F["projected_move"][-1], 2), round(rows[-1]["close"], 2), round(F["proj_high"], 2), round(hi, 2),
                round(F["proj_low"], 2), round(lo, 2), f"{passed} / 8"]
        fmts = ["@", "0", "0.00", "0.0%", "0.0%", "@"] + ["#,##0.00"] * 6 + ["@"]
        for j, (v, fm) in enumerate(zip(vals, fmts), 1):
            c = sc.cell(row=r, column=j, value=v)
            c.font, c.number_format = BLUE, fm

    # charts: redraw from the updated timeline, widening the axis if price left the range
    tl = Lay["timeline"]
    ymin = min(tl["chart_y"][0], int(lo // 25 * 25))
    ymax = max(tl["chart_y"][1], int(hi // 25 * 25 + 25))
    ws._charts = []
    add_timeline_chart(ws, tl["first"] - 1, tl["last"], ymin, ymax)
    dash = wb["Dashboard"]
    dash._charts = []
    add_timeline_chart(ws, tl["first"] - 1, tl["last"], ymin, ymax, place_ws=dash, at=Lay["dashboard_chart"], size=(9.5, 30))
    wb.save(xlsx)
    print(recalc(xlsx))

    t_ = lambda x: x["end_sast"].strftime("%H:%M")
    state = "FINAL" if complete else f"PROVISIONAL ({n}/{len(bars)} hours)"
    print(f"\n## XAUUSD {day} - {state}, data to {t_(rows[-1])} SAST")
    print(f"Feed check: {n}/{expected} closed hourly bars, {len(m1)} minute bars" + (f"; MISSING {missing}" if missing else "; no gaps"))
    print(f"Anchor {a:.2f} | last close {rows[-1]['close']:.2f} ({rows[-1]['close'] - a:+.2f}) | "
          f"high {hi:.2f} / low {lo:.2f} (projected {F['proj_high']:.2f} / {F['proj_low']:.2f})")
    print("\nTest  result      actual        pass if                                     hist")
    for t in T["tests"]:
        v, ok = results[t["id"]]
        word = ("PASS" if ok else "FAIL") if complete else ("on track" if ok else "off track")
        fmt = (f"{v:.2f}" if t["id"] == "T1" else f"{v:.1%}" if t["id"] in ("T2", "T3")
               else f"{v:.3f}" if t["id"] == "T7" else f"{v:,.2f}")
        print(f"{t['id']:4s}  {word:10s}  {fmt:>12s}  {t['rule'][:44]:44s}  {t['hist_pass']:.0%}")
    verdict = "better than a typical day" if passed >= 6 else "par" if passed == 5 else "below par"
    print(f"\nTests {'passed' if complete else 'on track'}: {passed} / 8 (par 5) -> {verdict if complete else 'provisional'}")
    for s in T["scenarios"]:
        print(f"{s['key'].upper():4s}: {sc_out[s['key']]['text']}")
    print(f"Levels touched: {int(sum(touched))}/{len(T['levels'])}, Brier {brier:.3f} (coin flip 0.25)")
    pre = [x for x in rows if 0 < x["end_sast"].hour <= 15]
    post = [x for x in rows if x not in pre]
    for name, grp in (("Before 15:30", pre), ("After 15:30", post)):
        if grp:
            e = np.mean([abs(x['close'] - x['proj']) for x in grp])
            w = np.mean([abs(x['close'] - a) for x in grp])
            print(f"{name}: model |error| {e:.2f} vs random walk {w:.2f}")


if __name__ == "__main__":
    main(*sys.argv[1:3])

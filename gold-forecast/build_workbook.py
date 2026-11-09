"""Write the gold MTF analysis + Tuesday projection workbook (and a frozen forecast JSON)."""
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from openpyxl import Workbook
from openpyxl.chart import LineChart, Reference
from openpyxl.comments import Comment
from openpyxl.formatting.rule import CellIsRule, FormulaRule
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter as col

import analysis as A

HERE = Path(__file__).parent
FONT = "Arial"
NAVY = "1F3864"
F_IN = Font(name=FONT, color="0000FF")             # hardcoded input / raw data
F_FX = Font(name=FONT, color="000000")             # formula
F_LINK = Font(name=FONT, color="008000")           # cross-sheet link
F_B = Font(name=FONT, bold=True)
F_H = Font(name=FONT, bold=True, color="FFFFFF")
F_T = Font(name=FONT, bold=True, size=14, color=NAVY)
F_NOTE = Font(name=FONT, italic=True, color="595959", size=9)
FILL_H = PatternFill("solid", fgColor=NAVY)
FILL_Y = PatternFill("solid", fgColor="FFFF00")
FILL_KEY = PatternFill("solid", fgColor="DDEBF7")
FILL_ANCHOR = PatternFill("solid", fgColor="FCE4D6")
THIN = Side(style="thin", color="BFBFBF")
BOX = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)
PX = '#,##0.00'
MOVE = '+#,##0.00;-#,##0.00;0.00'
DT = 'ddd dd mmm hh:mm'
PCT = '0.0%'

DATA_SHEET = {"M_1": "Data 1m", "M_5": "Data 5m", "M_15": "Data 15m", "M_30": "Data 30m",
              "H_1": "Data 1h", "H_4": "Data 4h", "D_1": "Data 1D"}
CPI_SAST_HOUR = 15   # US data window: 08:30 ET = 13:30 UTC = 15:30 SAST (winter)
# High-impact scheduled events by forecast day (bar = 0-based hourly bar of the session, 14 = 15:00-16:00 SAST)
EVENTS = {"2026-11-10": dict(name="US CPI (Oct)", short="US CPI 15:30", bar=14)}
EVENT = None


def q(name):
    return f"'{name}'"


def header(ws, row, labels, widths=None):
    for i, h in enumerate(labels, 1):
        c = ws.cell(row=row, column=i, value=h)
        c.font, c.fill, c.border = F_H, FILL_H, BOX
        c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    if widths:
        for i, w in enumerate(widths, 1):
            ws.column_dimensions[col(i)].width = w


def put(ws, ref, value, font=F_FX, fmt=None, fill=None, bold=False, comment=None):
    c = ws[ref]
    c.value = value
    c.font = Font(name=FONT, color=font.color, bold=bold or font.bold, italic=font.italic, size=font.size)
    if fmt:
        c.number_format = fmt
    if fill:
        c.fill = fill
    if comment:
        c.comment = Comment(comment, "gold-forecast")
    return c


def title(ws, text, sub=None):
    put(ws, "A1", text, F_T)
    if sub:
        put(ws, "A2", sub, F_NOTE)


# ----------------------------------------------------------------- Settings
SET = {}


def settings_sheet(wb):
    ws = wb.create_sheet("Settings")
    title(ws, "Settings", "Blue cells are inputs. Indicator periods feed every formula in the Data sheets.")
    rows = [("EMA fast (bars)", A.P["ema_fast"], "ema_fast"),
            ("EMA mid (bars)", A.P["ema_mid"], "ema_mid"),
            ("EMA slow (bars)", A.P["ema_slow"], "ema_slow"),
            ("ATR period (Wilder)", A.P["atr"], "atr"),
            ("RSI period (Wilder)", A.P["rsi"], "rsi"),
            ("RSI bullish above", 55, "rsi_bull"),
            ("RSI bearish below", 45, "rsi_bear"),
            ("EMA-mid slope look-back (bars)", 10, "slope_lb"),
            ("Score >= this is Bullish (max 6)", 3, "score_bull"),
            ("z-score for 50% band", 0.674, "z50"),
            ("z-score for 80% band", 1.2816, "z80")]
    header(ws, 4, ["Setting", "Value", "Note"], [38, 12, 90])
    for i, (lab, v, key) in enumerate(rows, 5):
        put(ws, f"A{i}", lab)
        put(ws, f"B{i}", v, F_IN)
        SET[key] = f"Settings!$B${i}"
    put(ws, "C14", "0.674 / 1.2816 = normal quantiles for central 50% / 80% intervals", F_NOTE)
    put(ws, "C15", "Score >= threshold is Bullish, <= -threshold is Bearish, otherwise Neutral.", F_NOTE)
    r = len(rows) + 7
    put(ws, f"A{r}", "Python-side parameters (fixed; for reference only)", F_B)
    for i, (lab, v) in enumerate([("Swing fractal: bars each side (4h uses 2)", A.P["swing_n"]),
                                   ("FVG minimum size (x ATR of that timeframe)", A.P["fvg_min_atr"]),
                                   ("Analog days averaged (K nearest)", A.P["k_analogs"]),
                                   ("Hourly bars in the pattern fingerprint", A.P["path_bars"]),
                                   ("Sessions in the volatility profile", A.P["profile_sessions"]),
                                   ("Sessions walked forward in the backtest", A.P["backtest_sessions"])], r + 1):
        put(ws, f"A{i}", lab)
        put(ws, f"B{i}", v, F_IN)


# ----------------------------------------------------------------- data sheets
def data_sheet(wb, period, df, sh=None, sl=None, events=(), gaps=()):
    ws = wb.create_sheet(DATA_SHEET[period])
    labels = ["Time (SAST)", "Open", "High", "Low", "Close", "Volume (ticks)", "EMA fast", "EMA mid",
              "EMA slow", "True range", "ATR", "Gain", "Loss", "Avg gain", "Avg loss", "RSI",
              "Swing", "Structure", "Fair value gap"]
    header(ws, 1, labels, [17, 10, 10, 10, 10, 9, 10, 10, 10, 9, 9, 8, 8, 9, 9, 7, 11, 22, 40])
    ws.freeze_panes = "B2"
    ev = {}
    for e in events:
        ev.setdefault(e["bar"], []).append(f"{e['kind']} @ {e['level']:.2f}")
    fv = {}
    for g in gaps:
        fv.setdefault(g["bar"], []).append(f"{g['side']} FVG {g['bottom']:.2f}-{g['top']:.2f} ({g['state']})")
    fast, mid, slow = SET["ema_fast"], SET["ema_mid"], SET["ema_slow"]
    atr, rsi = SET["atr"], SET["rsi"]
    for i, r in enumerate(df.itertuples(index=False)):
        n = i + 2
        row = [r.time_sast.to_pydatetime(), r.open, r.high, r.low, r.close, int(r.volume)]
        for j, v in enumerate(row, 1):
            c = ws.cell(row=n, column=j, value=v)
            c.font = F_IN
            c.number_format = 'yyyy-mm-dd hh:mm' if j == 1 else (PX if j < 6 else '0')
        if i == 0:
            f = [f"=E{n}", f"=E{n}", f"=E{n}", f"=C{n}-D{n}", f"=J{n}", "=0", "=0", "=0", "=0",
                 f"=IF(O{n}=0,IF(N{n}=0,50,100),100-100/(1+N{n}/O{n}))"]
        else:
            p = n - 1
            f = [f"=G{p}+(E{n}-G{p})*2/({fast}+1)", f"=H{p}+(E{n}-H{p})*2/({mid}+1)",
                 f"=I{p}+(E{n}-I{p})*2/({slow}+1)",
                 f"=MAX(C{n}-D{n},ABS(C{n}-E{p}),ABS(D{n}-E{p}))", f"=K{p}+(J{n}-K{p})/{atr}",
                 f"=MAX(E{n}-E{p},0)", f"=MAX(E{p}-E{n},0)",
                 f"=N{p}+(L{n}-N{p})/{rsi}", f"=O{p}+(M{n}-O{p})/{rsi}",
                 f"=IF(O{n}=0,IF(N{n}=0,50,100),100-100/(1+N{n}/O{n}))"]
        for j, v in enumerate(f, 7):
            c = ws.cell(row=n, column=j, value=v)
            c.font = F_FX
            c.number_format = '0.0' if j == 16 else PX
        if sh is not None and sh[i]:
            ws.cell(row=n, column=17, value="Swing high").font = F_FX
        if sl is not None and sl[i]:
            ws.cell(row=n, column=17, value="Swing low").font = F_FX
        if i in ev:
            ws.cell(row=n, column=18, value="; ".join(ev[i])).font = F_FX
        if i in fv:
            ws.cell(row=n, column=19, value="; ".join(fv[i])).font = F_FX
    return ws


# ----------------------------------------------------------------- MTF trend
def mtf_sheet(wb, R):
    ws = wb.create_sheet("MTF Trend", 1)
    title(ws, "XAUUSD multi-timeframe trend - 1m to 4h (daily for context)",
          f"Last closed bars as at {R['cutoff'].tz_convert(None) + A.SAST:%a %d %b %Y %H:%M} SAST. "
          "Columns C-P are live formulas on the Data sheets; R-W come from the Python structure scan.")
    labels = ["Timeframe", "Data rows", "Close", "EMA fast", "EMA mid", "EMA slow", "RSI", "ATR",
              "EMA-mid slope", "Close > EMA fast", "Close > EMA mid", "Close > EMA slow", "EMA stack",
              "Slope", "RSI signal", "Score (-6..+6)", "Verdict", "Swing sequence", "Last BOS / CHoCH",
              "Event time (SAST)", "Event level", "Dealing-range 50%", "Premium / Discount", "Weight"]
    header(ws, 4, labels, [13, 8, 10, 10, 10, 10, 7, 8, 10, 9, 9, 9, 9, 7, 8, 9, 10, 21, 16, 19, 10, 11, 11, 8])
    ws.row_dimensions[4].height = 42
    weights = {"M_1": 0.5, "M_5": 1, "M_15": 1.5, "M_30": 2, "H_1": 2.5, "H_4": 3, "D_1": 0}
    order = A.TF + ["D_1"]
    for k, p in enumerate(order):
        r = 5 + k
        s = q(DATA_SHEET[p])
        put(ws, f"A{r}", A.TF_LABEL[p] + (" (context)" if p == "D_1" else ""), bold=True)
        put(ws, f"B{r}", f"=COUNTA({s}!$A:$A)", F_LINK, '0')
        for c_, src in zip("CDEFGH", "EGHIPK"):
            put(ws, f"{c_}{r}", f"=INDEX({s}!${src}:${src},$B{r})", F_LINK, '0.0' if src == "P" else PX)
        put(ws, f"I{r}", f"=E{r}-INDEX({s}!$H:$H,$B{r}-{SET['slope_lb']})", F_LINK, MOVE)
        put(ws, f"J{r}", f"=IF(C{r}>D{r},1,-1)")
        put(ws, f"K{r}", f"=IF(C{r}>E{r},1,-1)")
        put(ws, f"L{r}", f"=IF(C{r}>F{r},1,-1)")
        put(ws, f"M{r}", f"=IF(AND(D{r}>E{r},E{r}>F{r}),1,IF(AND(D{r}<E{r},E{r}<F{r}),-1,0))")
        put(ws, f"N{r}", f"=SIGN(I{r})")
        put(ws, f"O{r}", f"=IF(G{r}>{SET['rsi_bull']},1,IF(G{r}<{SET['rsi_bear']},-1,0))")
        put(ws, f"P{r}", f"=SUM(J{r}:O{r})", fmt='+0;-0;0')
        put(ws, f"Q{r}", f'=IF(P{r}>={SET["score_bull"]},"Bullish",IF(P{r}<=-{SET["score_bull"]},"Bearish","Neutral"))', bold=True)
        if p in R["tfs"]:
            t = R["tfs"][p]
            put(ws, f"R{r}", t["seq"])
            e = t["last_event"]
            if e:
                put(ws, f"S{r}", e["kind"])
                put(ws, f"T{r}", t["df"].time_sast[e["bar"]].to_pydatetime(), fmt=DT)
                put(ws, f"U{r}", float(e["level"]), fmt=PX)
            if not np.isnan(t["range_hi"]):
                put(ws, f"V{r}", float((t["range_hi"] + t["range_lo"]) / 2), fmt=PX,
                    comment=f"Midpoint of last swing high {t['range_hi']:.2f} and last swing low {t['range_lo']:.2f}")
                put(ws, f"W{r}", f'=IF(C{r}>V{r},"Premium","Discount")')
        put(ws, f"X{r}", weights[p], F_IN, '0.0')
    r = 5 + len(order) + 1
    put(ws, f"A{r}", "Weighted bias (higher timeframes weigh more; daily weight 0 = context only)", F_B)
    put(ws, f"P{r}", f"=SUMPRODUCT(P5:P{r-2},X5:X{r-2})/SUM(X5:X{r-2})", fmt='+0.00;-0.00;0.00', bold=True)
    put(ws, f"Q{r}", f'=IF(P{r}>=1.5,"Bullish",IF(P{r}<=-1.5,"Bearish","Neutral"))', bold=True)
    refs = dict(all_row=r, d1_row=4 + len(order))
    ws[f"P{r}"].fill = FILL_KEY
    ws[f"Q{r}"].fill = FILL_KEY
    green, red = PatternFill("solid", fgColor="C6EFCE"), PatternFill("solid", fgColor="FFC7CE")
    rng = f"Q5:Q{r}"
    ws.conditional_formatting.add(rng, CellIsRule(operator="equal", formula=['"Bullish"'], fill=green))
    ws.conditional_formatting.add(rng, CellIsRule(operator="equal", formula=['"Bearish"'], fill=red))
    for rr in range(5, 5 + len(order)):
        for cc in "JKLMNO":
            ws.conditional_formatting.add(f"{cc}{rr}", CellIsRule(operator="greaterThan", formula=["0"], fill=green))
            ws.conditional_formatting.add(f"{cc}{rr}", CellIsRule(operator="lessThan", formula=["0"], fill=red))
    ws.freeze_panes = "B5"
    r += 2
    put(ws, f"A{r}", "How to read", F_B)
    notes = [
        "Score = sum of six +1/-1 votes: close vs each EMA, EMA stack (fast>mid>slow = +1, reverse = -1, else 0), slope of the mid EMA, RSI vs 55/45.",
        "Swing sequence compares the last two fractal swing highs and lows (HH+HL bullish, LH+LL bearish).",
        "BOS = a close through the last swing in the direction of the trend; CHoCH = the first close through it against the trend.",
        "Premium / Discount = close above / below the midpoint of the latest swing range (ICT equilibrium).",
    ]
    for i, t in enumerate(notes, r + 1):
        put(ws, f"A{i}", t, F_NOTE)
    return refs


# ----------------------------------------------------------------- analogs / profile / backtest
def analogs_sheet(wb, R):
    ws = wb.create_sheet("Analogs")
    title(ws, "Pattern match - the 20 past days whose set-up looked most like Monday",
          "Fingerprint at each day's close: last 24 hourly closes, last 5 daily moves, position in 20-day range, "
          "stretch from 20-day EMA, day range (all in daily-ATR units). Rows show what the NEXT day did.")
    labels = ["Rank", "Analog day (SAST)", "Distance", "Next-day close (ATR)", "Next-day high (ATR)",
              "Next-day low (ATR)"] + [f"Bar {i}" for i in range(1, A.BARS_PER_SESSION + 1)]
    header(ws, 4, labels, [6, 14, 9, 11, 11, 11] + [7] * A.BARS_PER_SESSION)
    ws.row_dimensions[4].height = 30
    sess = R["sess"]
    picks = R["fc"]["picks"]
    for k, p in enumerate(picks):
        r = 5 + k
        put(ws, f"A{r}", k + 1)
        put(ws, f"B{r}", (sess.end[p["d"]].tz_convert(None) + A.SAST).to_pydatetime(), F_IN, 'ddd dd mmm yy')
        put(ws, f"C{r}", float(p["dist"]), F_IN, '0.000')
        put(ws, f"D{r}", float(p["path"][-1]), F_IN, '+0.00;-0.00')
        put(ws, f"E{r}", float(p["hi"]), F_IN, '+0.00;-0.00')
        put(ws, f"F{r}", float(p["lo"]), F_IN, '+0.00;-0.00')
        for j, v in enumerate(p["path"]):
            put(ws, f"{col(7 + j)}{r}", float(v), F_IN, '+0.00;-0.00')
    last = 4 + len(picks)
    rm, rmed, rup = last + 2, last + 3, last + 4
    put(ws, f"A{rm}", "Mean - this is the projected path", F_B)
    put(ws, f"A{rmed}", "Median", F_B)
    put(ws, f"A{rup}", "Share of analogs closing up", F_B)
    for j in range(4, 7 + A.BARS_PER_SESSION):
        c = col(j)
        put(ws, f"{c}{rm}", f"=AVERAGE({c}5:{c}{last})", fmt='+0.00;-0.00', fill=FILL_KEY, bold=True)
        put(ws, f"{c}{rmed}", f"=MEDIAN({c}5:{c}{last})", fmt='+0.00;-0.00')
    put(ws, f"D{rup}", f'=COUNTIF(D5:D{last},">0")/COUNT(D5:D{last})', fmt=PCT, bold=True)
    ws.freeze_panes = "C5"
    rng = f"G5:{col(6 + A.BARS_PER_SESSION)}{last}"
    ws.conditional_formatting.add(rng, CellIsRule(operator="greaterThan", formula=["0"], font=Font(name=FONT, color="006100")))
    ws.conditional_formatting.add(rng, CellIsRule(operator="lessThan", formula=["0"], font=Font(name=FONT, color="9C0006")))
    return dict(mean_row=rm, median_row=rmed, up_row=rup, first_bar_col="G",
                last_bar_col=col(6 + A.BARS_PER_SESSION))


def profile_sheet(wb, R, bar_end_sast):
    ws = wb.create_sheet("Vol Profile")
    title(ws, "Intraday volatility profile - how far gold typically travels by each hour",
          f"Root-mean-square move from the prior close at each hourly bar, last {A.P['profile_sessions']} sessions, "
          "in daily-ATR units. Sets the width of the projection bands.")
    header(ws, 4, ["Bar #", "Hour ends (SAST)", "RMS move from prior close (ATR)", "Typical move ($, today's ATR)",
                   "Mean |hourly change| (ATR)", "Mean |hourly change| ($)"], [7, 15, 16, 16, 16, 16])
    ws.row_dimensions[4].height = 45
    _, X = A.vol_profile(R["h1"], R["sess"], R["last_i"])
    hourly = np.abs(np.diff(np.c_[np.zeros(len(X)), X], axis=1)).mean(axis=0)
    for i in range(A.BARS_PER_SESSION):
        r = 5 + i
        put(ws, f"A{r}", i + 1)
        put(ws, f"B{r}", bar_end_sast[i], fmt='hh:mm')
        put(ws, f"C{r}", float(R["sigma"][i]), F_IN, '0.000')
        put(ws, f"D{r}", f"=C{r}*'Forecast Timeline'!$B$5", F_LINK, PX)
        put(ws, f"E{r}", float(hourly[i]), F_IN, '0.000')
        put(ws, f"F{r}", f"=E{r}*'Forecast Timeline'!$B$5", F_LINK, PX)
    ws.conditional_formatting.add(f"F5:F{4 + A.BARS_PER_SESSION}",
                                  FormulaRule(formula=[f"F5>=LARGE($F$5:$F${4 + A.BARS_PER_SESSION},4)"],
                                              fill=PatternFill("solid", fgColor="F8CBAD")))
    put(ws, f"A{6 + A.BARS_PER_SESSION}", "Shaded = the four most volatile hours of a typical day.", F_NOTE)
    return 5


def backtest_sheet(wb, R):
    ws = wb.create_sheet("Backtest")
    bt = R["bt"]
    title(ws, f"Walk-forward backtest of the pattern model - last {len(bt)} sessions",
          "Each day was forecast using only data available at the previous close, exactly as Tuesday's was. "
          "Moves in daily-ATR units.")
    first, last = 16, 15 + len(bt)
    s = [("Days tested", f"=COUNT(A{first}:A{last})", '0'),
         ("Direction hit rate (projected vs actual close)", f"=AVERAGE(E{first}:E{last})", PCT),
         ("Base rate: share of up days", f"=AVERAGE(K{first}:K{last})", PCT),
         ("Standard error of a hit rate at this sample size", f"=SQRT(0.25/B4)", PCT),
         ("Mean abs error of hourly path - pattern model", f"=AVERAGE(F{first}:F{last})", '0.000'),
         ("Mean abs error - random walk (no change)", f"=AVERAGE(G{first}:G{last})", '0.000'),
         ("Error ratio (model / random walk; < 1 = skill)", "=B8/B9", '0.000'),
         ("Average 50% band coverage (target 50%)", f"=AVERAGE(H{first}:H{last})", PCT),
         ("Average 80% band coverage (target 80%)", f"=AVERAGE(I{first}:I{last})", PCT)]
    for i, (lab, f, fmt) in enumerate(s, 4):
        put(ws, f"A{i}", lab)
        put(ws, f"B{i}", f, fmt=fmt, bold=True)
    put(ws, "C10", '=IF(B10<1,"Path beats random walk","Path does NOT beat random walk - treat the centre line as a coin-flip")', bold=True)
    put(ws, "C5", '=IF(ABS(B5-0.5)<2*B7,"Not distinguishable from 50/50","Statistically different from 50/50")')
    put(ws, "C11", '=IF(AND(B11>0.4,B11<0.6),"Calibrated",IF(B11>=0.6,"Bands a little wide (conservative)","Bands too narrow"))')
    put(ws, "C12", '=IF(AND(B12>0.7,B12<0.9),"Calibrated",IF(B12>=0.9,"Bands too wide","Bands too narrow"))')
    header(ws, 15, ["Day (SAST)", "Daily ATR ($)", "Projected close (ATR)", "Actual close (ATR)", "Direction hit",
                    "Path MAE (ATR)", "Random-walk MAE (ATR)", "In 50% band", "In 80% band",
                    "Analogs up", "Actual up"], [44, 12, 12, 12, 10, 12, 13, 10, 10, 10, 10])
    ws.row_dimensions[15].height = 32
    for i, b in enumerate(bt.itertuples(index=False)):
        r = first + i
        vals = [(b.date.tz_convert(None) + A.SAST).to_pydatetime(), b.atr, b.fc_final, b.act_final, int(b.dir_hit),
                b.mae, b.mae_rw, b.cov50, b.cov80, b.p_up, int(b.act_final > 0)]
        fmts = ['ddd dd mmm yy', PX, '+0.00;-0.00', '+0.00;-0.00', '0', '0.000', '0.000', PCT, PCT, PCT, '0']
        for j, (v, fm) in enumerate(zip(vals, fmts), 1):
            put(ws, f"{col(j)}{r}", float(v) if not hasattr(v, "year") else v, F_IN, fm)
    ws.freeze_panes = "A16"


# ----------------------------------------------------------------- forecast timeline
CHART_Y = []


def chart_range(R):
    lo = min(float(R["anchor"]) - 2.2 * float(R["sigma"].max() * R["atr_now"]), float(R["day"]["pdl"]))
    hi = max(float(R["anchor"]) + 2.2 * float(R["sigma"].max() * R["atr_now"]), float(R["day"]["pdh"]))
    return [int(lo // 25 * 25), int(hi // 25 * 25 + 25)]


def add_timeline_chart(ws, H, last, ymin, ymax, place_ws=None, at=None, size=(11, 26)):
    """Projection, bands and actuals (data on the timeline sheet; optionally drawn on another sheet).
    check.py clears and re-adds it after writing actuals so the chart always matches the data."""
    ch = LineChart()
    ch.title = "Projection vs actual (SAST)"
    ch.height, ch.width = size
    ch.y_axis.title = "XAUUSD ($)"
    ch.y_axis.number_format = '#,##0'
    ch.x_axis.number_format = 'hh:mm'
    ch.x_axis.title = "Hour ends (SAST)"
    ch.y_axis.scaling.min = ymin
    ch.y_axis.scaling.max = ymax
    ch.y_axis.delete = False
    ch.x_axis.delete = False
    series = [("I", "1F3864", None, 28000), ("J", "8EA9DB", "dash", 12700), ("K", "8EA9DB", "dash", 12700),
              ("L", "BFBFBF", "sysDot", 12700), ("M", "BFBFBF", "sysDot", 12700), ("N", "ED7D31", None, 31750)]
    for c_, color, dash, w in series:
        ch.add_data(Reference(ws, min_col=ord(c_) - 64, min_row=H, max_row=last), titles_from_data=True)
        s = ch.series[-1]
        s.graphicalProperties.line.solidFill = color
        s.graphicalProperties.line.width = w
        if dash:
            s.graphicalProperties.line.dashStyle = dash
        s.smooth = False
    ch.set_categories(Reference(ws, min_col=3, min_row=H + 1, max_row=last))
    ch.legend.position = "b"
    (place_ws or ws).add_chart(ch, at or f"A{last + 3}")


def timeline_sheet(wb, R, AN, bars_utc, cpi_note):
    ws = wb.create_sheet("Forecast Timeline", 1)
    fc_day = (bars_utc[0] + pd.Timedelta(hours=1)).tz_convert(None) + A.SAST
    title(ws, f"XAUUSD hourly projection - {fc_day:%A %d %B %Y} (SAST)",
          "Frozen at Monday's close. Yellow columns are the actuals - check.py fills them from cTrader; "
          "everything to their right recalculates.")
    p = [("Anchor: Monday close ($)", float(R["anchor"]), F_IN, PX,
          "Source: cTrader XAUUSD demo feed, close of the last H1 bar of Monday's session (bid)."),
         ("Daily ATR(14) at the anchor ($)", float(R["atr_now"]), F_IN, PX,
          "Wilder ATR over H1-derived sessions (01:00-00:00 SAST)."),
         ("z for 50% band", f"={SET['z50']}", F_LINK, '0.000', None),
         ("z for 80% band", f"={SET['z80']}", F_LINK, '0.000', None),
         ("Forecast frozen at (SAST)", (R["cutoff"].tz_convert(None) + A.SAST).to_pydatetime(), F_IN, 'ddd dd mmm hh:mm',
          "Only bars that had closed by this time were used."),
         ("Analogs closing up", f"=Analogs!$D${AN['up_row']}", F_LINK, PCT, None),
         ("Projected session high ($)", f"=$B$4+Analogs!$E${AN['median_row']}*$B$5", F_LINK, PX,
          "Median of the analogs' next-day highs, scaled to today's ATR."),
         ("Projected session low ($)", f"=$B$4+Analogs!$F${AN['median_row']}*$B$5", F_LINK, PX,
          "Median of the analogs' next-day lows, scaled to today's ATR."),
         ("Projected close ($)", f"=I{14 + A.BARS_PER_SESSION}", F_FX, PX, None)]
    for i, (lab, v, f, fmt, cm) in enumerate(p, 4):
        put(ws, f"A{i}", lab, bold=True)
        put(ws, f"B{i}", v, f, fmt, comment=cm)
    for i in (4, 10, 11, 12):
        ws[f"B{i}"].fill = FILL_KEY
    put(ws, "D4", "Backtest reality check:", F_B)
    put(ws, "D5", "='Backtest'!C10", F_LINK)
    put(ws, "D6", '="Direction hit rate "&TEXT(Backtest!B5,"0%")&" over "&Backtest!B4&" days (base rate up "&TEXT(Backtest!B6,"0%")&")"', F_LINK)
    put(ws, "D7", '="80% band held "&TEXT(Backtest!B12,"0%")&" of hourly closes; 50% band held "&TEXT(Backtest!B11,"0%")', F_LINK)
    put(ws, "D8", cpi_note, Font(name=FONT, bold=True, color="C00000"))
    put(ws, "D9", "Use the bands and levels as a volatility map, not the centre line as a trade signal.", F_NOTE)

    H = 14
    labels = ["Bar #", "Hour starts (SAST)", "Hour ends (SAST)", "Session", "Phase", "Scheduled / note",
              "Projected move ($)", "Typical move 1 sigma ($)", "Projected close ($)", "50% band low",
              "50% band high", "80% band low", "80% band high", "ACTUAL close", "ACTUAL high", "ACTUAL low",
              "Error ($)", "|Error| ($)", "Random-walk |error| ($)", "Inside 50%?", "Inside 80%?", "Direction OK?"]
    header(ws, H, labels, [32, 19, 12, 10, 9, 34, 10, 10, 11, 10, 10, 10, 10, 11, 11, 11, 9, 9, 11, 9, 9, 10])
    ws.row_dimensions[H].height = 45
    notes = {0: "Asian open (thin liquidity)", 8: "London open", 11: "LBMA gold AM auction 12:30",
             12: "US NFIB small business 13:00 (minor)",
             15: "US cash equities open 16:30",
             16: "LBMA gold PM auction 17:00", 22: "NY close / daily break 00:00"}
    if EVENT:
        notes[EVENT["bar"]] = f"{EVENT['name']} 15:30 - HIGH IMPACT"
    mrow = AN["mean_row"]
    for i, b in enumerate(bars_utc):
        r = H + 1 + i
        st = b.tz_convert(None) + A.SAST
        en = st + pd.Timedelta(hours=1)
        hu = b.hour
        sess = "Asia" if (hu >= 23 or hu < 7) else ("London" if hu < 12 else "New York")
        put(ws, f"A{r}", i + 1)
        put(ws, f"B{r}", st.to_pydatetime(), fmt='ddd hh:mm')
        put(ws, f"C{r}", en.to_pydatetime(), fmt='ddd hh:mm')
        put(ws, f"D{r}", sess)
        put(ws, f"E{r}", "Before 15:30" if en.hour <= CPI_SAST_HOUR and en.hour != 0 else "After 15:30")
        if i in notes:
            put(ws, f"F{r}", notes[i], Font(name=FONT, color="C00000", bold=True) if "HIGH IMPACT" in notes[i] else F_FX)
        put(ws, f"G{r}", f"=INDEX(Analogs!${AN['first_bar_col']}${mrow}:${AN['last_bar_col']}${mrow},$A{r})*$B$5", F_LINK, MOVE)
        put(ws, f"H{r}", f"=INDEX('Vol Profile'!$C$5:$C${4 + A.BARS_PER_SESSION},$A{r})*$B$5", F_LINK, PX)
        put(ws, f"I{r}", f"=$B$4+G{r}", fmt=PX, bold=True)
        put(ws, f"J{r}", f"=I{r}-$B$6*H{r}", fmt=PX)
        put(ws, f"K{r}", f"=I{r}+$B$6*H{r}", fmt=PX)
        put(ws, f"L{r}", f"=I{r}-$B$7*H{r}", fmt=PX)
        put(ws, f"M{r}", f"=I{r}+$B$7*H{r}", fmt=PX)
        for c_ in "NOP":
            ws[f"{c_}{r}"].fill = FILL_Y
            ws[f"{c_}{r}"].number_format = PX
            ws[f"{c_}{r}"].font = F_IN
        put(ws, f"Q{r}", f'=IF(N{r}="","",N{r}-I{r})', fmt=MOVE)
        put(ws, f"R{r}", f'=IF(N{r}="","",ABS(Q{r}))', fmt=PX)
        put(ws, f"S{r}", f'=IF(N{r}="","",ABS(N{r}-$B$4))', fmt=PX)
        put(ws, f"T{r}", f'=IF(N{r}="","",IF(AND(N{r}>=J{r},N{r}<=K{r}),"Yes","No"))')
        put(ws, f"U{r}", f'=IF(N{r}="","",IF(AND(N{r}>=L{r},N{r}<=M{r}),"Yes","No"))')
        put(ws, f"V{r}", f'=IF(N{r}="","",IF(SIGN(N{r}-$B$4)=SIGN(I{r}-$B$4),"Yes","No"))')
        for c_ in range(1, 23):
            ws.cell(row=r, column=c_).border = BOX
        if "HIGH IMPACT" in notes.get(i, ""):
            for c_ in range(1, 7):
                ws.cell(row=r, column=c_).fill = PatternFill("solid", fgColor="FCE4D6")
    last = H + len(bars_utc)
    green, red = PatternFill("solid", fgColor="C6EFCE"), PatternFill("solid", fgColor="FFC7CE")
    ws.conditional_formatting.add(f"T{H+1}:V{last}", CellIsRule(operator="equal", formula=['"Yes"'], fill=green))
    ws.conditional_formatting.add(f"T{H+1}:V{last}", CellIsRule(operator="equal", formula=['"No"'], fill=red))
    ws.freeze_panes = f"D{H+1}"

    CHART_Y[:] = chart_range(R)
    add_timeline_chart(ws, H, last, *CHART_Y)
    return H + 1, last


def scorecard_sheet(wb, first, last):
    ws = wb.create_sheet("Scorecard", 2)
    title(ws, "Scorecard - how close did the actuals run to the projection?",
          "Detailed error measures. Fills in automatically as the yellow actuals arrive on the Forecast Timeline.")
    T = "'Forecast Timeline'!"
    rg = lambda c_: f"{T}${c_}${first}:${c_}${last}"
    header(ws, 4, ["Measure", "Value"], [52, 16])
    rows = [
        ("Hours scored (of 23)", f"=COUNT({rg('N')})", '0', None, None),
        ("Mean |error| of projected path ($)", f'=IF(B5=0,"",AVERAGE({rg("R")}))', PX, None, None),
        ("Mean |error| of random walk / no change ($)", f'=IF(B5=0,"",AVERAGE({rg("S")}))', PX, None, None),
        ("Error ratio (projection / random walk)", '=IF(OR(B5=0,B7=0),"",B6/B7)', '0.00',
         "Beat random walk: ratio < 1.00", '=IF(B8="","",IF(B8<1,"PASS","FAIL"))'),
        ("Share of hourly closes inside 50% band", f'=IF(B5=0,"",COUNTIF({rg("T")},"Yes")/B5)', PCT,
         "50% band calibrated: 25% to 75%", '=IF(B9="","",IF(AND(B9>=0.25,B9<=0.75),"PASS","FAIL"))'),
        ("Share of hourly closes inside 80% band", f'=IF(B5=0,"",COUNTIF({rg("U")},"Yes")/B5)', PCT,
         "80% band holds: at least 60%", '=IF(B10="","",IF(B10>=0.6,"PASS","FAIL"))'),
        ("Hours on the right side of the anchor", f'=IF(B5=0,"",COUNTIF({rg("V")},"Yes")/B5)', PCT, None, None),
        ("Projected close move ($)", f"={T}$I${last}-{T}$B$4", MOVE, None, None),
        ("Actual move at last scored hour ($)", f'=IF(B5=0,"",INDEX({rg("N")},MATCH(9.99E+307,{rg("N")}))-{T}$B$4)', MOVE,
         "Day direction called correctly", '=IF(B5<23,"(pending)",IF(SIGN(B13)=SIGN(B12),"PASS","FAIL"))'),
        ("Projected session high ($)", f"={T}$B$10", PX, None, None),
        ("Actual session high so far ($)", f'=IF(B5=0,"",MAX({rg("O")}))', PX, None, None),
        ("Projected session low ($)", f"={T}$B$11", PX, None, None),
        ("Actual session low so far ($)", f'=IF(B5=0,"",MIN({rg("P")}))', PX, None, None),
        ("Mean |error| before 15:30 ($)", f'=IFERROR(AVERAGEIFS({rg("R")},{rg("E")},"Before 15:30"),"")', PX, None, None),
        ("Mean |error| after 15:30 ($)", f'=IFERROR(AVERAGEIFS({rg("R")},{rg("E")},"After 15:30"),"")', PX, None, None),
        ("Random-walk |error| before 15:30 ($)", f'=IFERROR(AVERAGEIFS({rg("S")},{rg("E")},"Before 15:30"),"")', PX, None, None),
        ("Random-walk |error| after 15:30 ($)", f'=IFERROR(AVERAGEIFS({rg("S")},{rg("E")},"After 15:30"),"")', PX, None, None),
    ]
    for i, (lab, f, fmt, test, res) in enumerate(rows, 5):
        put(ws, f"A{i}", lab)
        put(ws, f"B{i}", f, F_LINK if "!" in f else F_FX, fmt)
    o = 5 + len(rows) + 1
    put(ws, f"A{o}", "Pass / fail tests (T1-T8)", F_B)
    put(ws, f"B{o}", "=Targets!$B$15", F_LINK, fill=FILL_KEY, bold=True)
    put(ws, f"A{o+1}", "The eight tests, thresholds and historical pass rates are on the Targets sheet. One day is n = 1: "
                       "the Daily Log below accumulates days so the record becomes meaningful.", F_NOTE)
    lg = o + 3
    put(ws, f"A{lg}", "Daily log (check.py appends one row per scored day)", F_B)
    for j, h in enumerate(["Day", "Hours", "Error ratio", "In 50%", "In 80%", "Direction", "Proj. close", "Actual close",
                           "Proj. high", "Actual high", "Proj. low", "Actual low", "Tests passed"], 1):
        c = ws.cell(row=lg + 1, column=j, value=h)
        c.font, c.fill, c.border = F_H, FILL_H, BOX
    for j in range(3, 14):
        ws.column_dimensions[col(j)].width = 12
    return lg + 2


# ----------------------------------------------------------------- key levels
def levels_sheet(wb, R, sess_start_sast, sess_end_sast):
    ws = wb.create_sheet("Key Levels", 3)
    title(ws, "Key levels for Tuesday - price ladder",
          "Day levels and pivots are formulas on the 1h data; swing, FVG and range levels come from the structure scan.")
    D = "'Data 1h'!"
    put(ws, "A4", "Monday session start (SAST)", bold=True)
    put(ws, "B4", sess_start_sast, F_IN, 'ddd dd mmm hh:mm')
    put(ws, "A5", "Monday session end (SAST)", bold=True)
    put(ws, "B5", sess_end_sast, F_IN, 'ddd dd mmm hh:mm')
    put(ws, "A6", "PDH (Mon high)", bold=True)
    put(ws, "B6", f'=_xlfn.MAXIFS({D}$C:$C,{D}$A:$A,">="&$B$4,{D}$A:$A,"<"&$B$5)', F_LINK, PX)
    put(ws, "A7", "PDL (Mon low)", bold=True)
    put(ws, "B7", f'=_xlfn.MINIFS({D}$D:$D,{D}$A:$A,">="&$B$4,{D}$A:$A,"<"&$B$5)', F_LINK, PX)
    put(ws, "A8", "PDC (Mon close)", bold=True)
    put(ws, "B8", f"=INDEX({D}$E:$E,MATCH($B$5-1/48,{D}$A:$A,1))", F_LINK, PX)
    piv = [("Pivot P", "=(B6+B7+B8)/3"), ("R1", "=2*F4-B7"), ("S1", "=2*F4-B6"), ("R2", "=F4+(B6-B7)"),
           ("S2", "=F4-(B6-B7)"), ("R3", "=B6+2*(F4-B7)"), ("S3", "=B7-2*(B6-F4)")]
    put(ws, "E3", "Classic daily pivots (Tue)", F_B)
    for i, (lab, f) in enumerate(piv, 4):
        put(ws, f"E{i}", lab, bold=True)
        put(ws, f"F{i}", f, fmt=PX)
    pd_ = R["day"]
    P_ = (pd_["pdh"] + pd_["pdl"] + pd_["pdc"]) / 3
    pyv = {"Pivot P": P_, "R1": 2 * P_ - pd_["pdl"], "S1": 2 * P_ - pd_["pdh"], "R2": P_ + pd_["pdh"] - pd_["pdl"],
           "S2": P_ - (pd_["pdh"] - pd_["pdl"]), "R3": pd_["pdh"] + 2 * (P_ - pd_["pdl"]),
           "S3": pd_["pdl"] - 2 * (pd_["pdh"] - P_)}
    ladder = []
    for L in R["levels"]:
        f = None
        if L["level"].startswith("PDH"):
            f = "=$B$6"
        elif L["level"].startswith("PDL"):
            f = "=$B$7"
        elif L["level"].startswith("PDC"):
            f = "=$B$8"
        ladder.append((L["level"], L["price"], f, L["kind"], L["tf"]))
    for i, (lab, _) in enumerate(piv):
        ladder.append((f"Daily pivot {lab}", pyv[lab], f"=$F${4 + i}", "Pivot", "1D"))
    ladder.append(("ANCHOR - Monday close (projection start)", float(R["anchor"]) + 1e-6, "='Forecast Timeline'!$B$4", "Anchor", ""))
    ladder.sort(key=lambda x: -x[1])
    H = 13
    header(ws, H, ["Level", "Price ($)", "Type", "TF", "Distance from anchor ($)", "Distance (daily ATR)",
                   "Above / below", "Touched on Tue?"], [62, 16, 9, 6, 16, 12, 11, 11])
    ws.column_dimensions["C"].width = 12
    ws.row_dimensions[H].height = 32
    T = "'Forecast Timeline'!"
    for i, (lab, px, f, kind, tf) in enumerate(ladder):
        r = H + 1 + i
        put(ws, f"A{r}", lab, bold=kind == "Anchor")
        put(ws, f"B{r}", f if f else round(px, 2), F_FX if f else F_IN, PX)
        put(ws, f"C{r}", kind)
        put(ws, f"D{r}", tf)
        put(ws, f"E{r}", f"=B{r}-{T}$B$4", F_LINK, MOVE)
        put(ws, f"F{r}", f"=E{r}/{T}$B$5", F_LINK, '+0.00;-0.00;0.00')
        put(ws, f"G{r}", f'=IF(ABS(E{r})<0.005,"-",IF(E{r}>0,"Above","Below"))')
        put(ws, f"H{r}", f'=IF(COUNT({T}$O$15:$O$37)=0,"",'
                         f'IF(AND(B{r}<=MAX({T}$O$15:$O$37),B{r}>=MIN({T}$P$15:$P$37)),"Yes","No"))')
        if kind == "Anchor":
            for c_ in range(1, 9):
                ws.cell(row=r, column=c_).fill = FILL_ANCHOR
    last = H + len(ladder)
    green = PatternFill("solid", fgColor="C6EFCE")
    ws.conditional_formatting.add(f"H{H+1}:H{last}", CellIsRule(operator="equal", formula=['"Yes"'], fill=green))
    ws.freeze_panes = f"B{H+1}"


# ----------------------------------------------------------------- markers
def markers_sheet(wb, R):
    ws = wb.create_sheet("Markers", 4)
    title(ws, "Markers - structure, swings and fair value gaps by timeframe",
          "Most recent first within each timeframe. Every marker is also tagged on its bar in the Data sheets.")
    header(ws, 4, ["Timeframe", "Time (SAST)", "Marker", "Level / zone", "Detail"], [10, 17, 16, 22, 60])
    r = 5
    for p in reversed(A.TF):
        t = R["tfs"][p]
        df = t["df"]
        rows = []
        for e in t["events"][-10:]:
            rows.append((df.time_sast[e["bar"]], e["kind"], f"{e['level']:.2f}",
                         f"Close {df.close[e['bar']]:.2f} through swing from {df.time_sast[e['swing_bar']]:%d %b %H:%M}"))
        for i in np.where(t["sh"])[0][-6:]:
            rows.append((df.time_sast[i], "Swing high", f"{df.high[i]:.2f}", ""))
        for i in np.where(t["sl"])[0][-6:]:
            rows.append((df.time_sast[i], "Swing low", f"{df.low[i]:.2f}", ""))
        for g in [g for g in t["gaps"] if g["state"] != "filled"][-8:]:
            rows.append((df.time_sast[g["bar"]], f"{g['side']} FVG", f"{g['bottom']:.2f} - {g['top']:.2f}",
                         f"{g['state']}; size {g['top'] - g['bottom']:.2f}"))
        rows.sort(key=lambda x: x[0], reverse=True)
        for tm, mk, lv, dt in rows:
            put(ws, f"A{r}", A.TF_LABEL[p], bold=True)
            put(ws, f"B{r}", tm.to_pydatetime(), fmt='ddd dd mmm hh:mm')
            color = "006100" if ("up" in mk or "Bullish" in mk or "low" in mk) else "9C0006"
            put(ws, f"C{r}", mk, Font(name=FONT, color=color, bold="BOS" in mk or "CHoCH" in mk))
            put(ws, f"D{r}", lv, F_IN)
            put(ws, f"E{r}", dt)
            r += 1
        r += 1
    ws.freeze_panes = "A5"


# ----------------------------------------------------------------- user-friendly layer
F_SEC = Font(name=FONT, bold=True, size=12, color=NAVY)
F_LINKTXT = Font(name=FONT, color="0563C1", underline="single")
GREEN, RED = PatternFill("solid", fgColor="C6EFCE"), PatternFill("solid", fgColor="FFC7CE")
AMBER = PatternFill("solid", fgColor="FFEB9C")
TILE = PatternFill("solid", fgColor="F2F2F2")
TAB = {"Dashboard": NAVY, "Targets": "70AD47", "Forecast Timeline": "70AD47", "Scorecard": "70AD47",
       "MTF Trend": "5B9BD5", "Key Levels": "5B9BD5", "Markers": "5B9BD5", "Guide": "FFC000",
       "Analogs": "A5A5A5", "Vol Profile": "A5A5A5", "Backtest": "A5A5A5", "Settings": "A5A5A5"}


def link(ws, ref, sheet, text):
    put(ws, ref, f'=HYPERLINK("#\'{sheet}\'!A1","{text}")', F_LINKTXT)


def sast(ts):
    return (pd.Timestamp(ts).tz_convert(None) + A.SAST)


def targets_sheet(wb, T, first, last):
    ws = wb.create_sheet("Targets")
    made = sast(T["created_utc"])
    title(ws, "Tuesday targets - what we are testing",
          f"Locked {made:%a %d %b %H:%M} SAST, before Tuesday's first bar, from the frozen Monday-close data "
          f"(model {T['model_version']}, forecast SHA-256 {T['forecast_sha256'][:12]}...). Results fill in automatically.")
    for c_, w in zip("ABCDEFGHI", [44, 50, 12, 12, 14, 16, 16, 15, 11]):
        ws.column_dimensions[c_].width = w
    TL = "'Forecast Timeline'!"
    N, O, Pc = (f"{TL}${c}${first}:${c}${last}" for c in "NOP")
    hours = "Scorecard!$B$5"

    # A. tests
    put(ws, "A5", "A.  Eight pass/fail tests  -  par is 5 of 8 (the average day over the last 200)", F_SEC)
    header(ws, 6, ["Test", "Pass if", "Low", "High", "Passed historically", "Actual", "Result"])
    ws.row_dimensions[6].height = 30
    actual = {"T1": ("=Scorecard!$B$8", '0.00'), "T2": ("=Scorecard!$B$9", PCT), "T3": ("=Scorecard!$B$10", PCT),
              "T4": (f'=IF({hours}=0,"",INDEX({N},MATCH(9.99E+307,{N})))', PX),
              "T5": ("=Scorecard!$B$15", PX), "T6": ("=Scorecard!$B$17", PX), "T7": (None, '0.000'),
              "T8": (f'=IF({hours}=0,"",Scorecard!$B$15-Scorecard!$B$17)', PX)}
    fmt_lohi = {"T1": '0.00', "T2": PCT, "T3": PCT, "T7": '0.000'}
    rows = {}
    for i, t in enumerate(T["tests"]):
        r = 7 + i
        rows[t["id"]] = r
        put(ws, f"A{r}", f"{t['id']}  {t['name']}", bold=True)
        put(ws, f"B{r}", t["rule"])
        for c_, v in (("C", t["lo"]), ("D", t["hi"])):
            if v is not None:
                put(ws, f"{c_}{r}", v, F_IN, fmt_lohi.get(t["id"], PX))
        put(ws, f"E{r}", t["hist_pass"], F_IN, '0%')
        f, fm = actual[t["id"]]
        if f:
            put(ws, f"F{r}", f, F_LINK, fm)
        cond = f'AND(OR(C{r}="",F{r}>=C{r}),OR(D{r}="",F{r}<=D{r}))'
        put(ws, f"G{r}", f'=IF(F{r}="","Pending",IF({hours}<23,IF({cond},"On track","Off track"),IF({cond},"PASS","FAIL")))', bold=True)
        for c_ in "ABCDEFG":
            ws[f"{c_}{r}"].border = BOX
            ws[f"{c_}{r}"].alignment = Alignment(vertical="center", wrap_text=c_ in "AB")
    g = f"G7:G{6 + len(T['tests'])}"
    ws.conditional_formatting.add(g, CellIsRule(operator="equal", formula=['"PASS"'], fill=GREEN))
    ws.conditional_formatting.add(g, CellIsRule(operator="equal", formula=['"On track"'], fill=GREEN))
    ws.conditional_formatting.add(g, CellIsRule(operator="equal", formula=['"FAIL"'], fill=RED))
    ws.conditional_formatting.add(g, CellIsRule(operator="equal", formula=['"Off track"'], fill=AMBER))
    put(ws, "A15", "Tests passed", F_B)
    put(ws, "B15", f'=IF({hours}=0,"Waiting for Tuesday\'s bars",IF({hours}<23,COUNTIF({g},"On track")&" of 8 on track (provisional, "&{hours}&"/23 hours)",'
                   f'COUNTIF({g},"PASS")&" of 8 passed"))', bold=True, fill=FILL_KEY)
    put(ws, "C15", f'=IF({hours}<23,"",IF(COUNTIF({g},"PASS")>=6,"Better than a typical day",IF(COUNTIF({g},"PASS")=5,"Par - a typical day","Below par")))', bold=True)
    dist = T["hist_pass_counts"]
    put(ws, "A16", "Over the last 200 days the number of tests passed was: " +
        ", ".join(f"{k}: {float(v):.0%}" for k, v in dist.items()) +
        ". T1, T4, T5 and T6 are the 'skill' tests (about 50% historically); T3, T7 and T8 check the risk map.", F_NOTE)
    ws.merge_cells("A16:G16")
    ws["A16"].alignment = Alignment(wrap_text=True)
    ws.row_dimensions[16].height = 28

    # B. scenarios
    put(ws, "A18", "B.  Scenario plan  -  triggers, targets, invalidation", F_SEC)
    header(ws, 19, ["Step", "Rule", "Price ($)", "From anchor ($)", "Chance traded Tue *", "Actual: reached at (SAST)", "Status"])
    ws.row_dimensions[19].height = 30
    r = 20
    sc_rows = {}
    for s in T["scenarios"]:
        fill = PatternFill("solid", fgColor="E2EFDA" if s["key"] == "bull" else "FCE4D6")
        put(ws, f"A{r}", s["name"], Font(name=FONT, bold=True, size=11, color="375623" if s["key"] == "bull" else "C00000"))
        ws.merge_cells(f"A{r}:G{r}")
        ws[f"A{r}"].fill = fill
        put(ws, f"A{r+1}", s["why"], F_NOTE)
        ws.merge_cells(f"A{r+1}:G{r+1}")
        ws[f"A{r+1}"].alignment = Alignment(wrap_text=True, vertical="top")
        ws.row_dimensions[r + 1].height = 30
        steps = [("Trigger", s["trigger"]["rule"], s["trigger"]["price"], None)]
        steps += [(x["name"], "first trade at or through this price after the trigger", x["price"], x["p_touch"]) for x in s["targets"]]
        steps += [("Invalidation", s["invalidation"]["rule"], s["invalidation"]["price"], None)]
        rr = []
        for j, (step, rule, px, p) in enumerate(steps):
            q = r + 2 + j
            rr.append(q)
            put(ws, f"A{q}", step, bold=j == 0)
            put(ws, f"B{q}", rule)
            put(ws, f"C{q}", px, F_IN, PX)
            put(ws, f"D{q}", f"=C{q}-{TL}$B$4", F_LINK, MOVE)
            if p is not None:
                put(ws, f"E{q}", p, F_IN, '0%')
            ws[f"F{q}"].fill = FILL_Y
            ws[f"F{q}"].font = F_IN
            for c_ in "ABCDEFG":
                ws[f"{c_}{q}"].border = BOX
        q = r + 2 + len(steps)
        put(ws, f"A{q}", "Outcome", bold=True)
        ws[f"B{q}"].fill = FILL_Y
        ws.merge_cells(f"B{q}:G{q}")
        put(ws, f"B{q}", "Waiting for Tuesday's bars", F_IN)
        sc_rows[s["key"]] = dict(name=r, trigger=rr[0], targets=rr[1:4], inval=rr[4], outcome=q)
        r = q + 2
    put(ws, f"A{r}", T["neutral"]["name"], Font(name=FONT, bold=True, size=11, color="7F6000"))
    ws.merge_cells(f"A{r}:G{r}")
    ws[f"A{r}"].fill = PatternFill("solid", fgColor="FFF2CC")
    put(ws, f"A{r+1}", T["neutral"]["rule"], F_NOTE)
    ws.merge_cells(f"A{r+1}:G{r+1}")
    put(ws, f"A{r+2}", "* Chance the price trades at that level at any time on Tuesday, measured from Monday's close (how far gold travelled the "
                       f"next day over the last {T['trail_sessions']} sessions). Not conditional on the trigger.", F_NOTE)
    ws.merge_cells(f"A{r+2}:G{r+2}")

    # C. level touch probabilities
    r += 4
    put(ws, f"A{r}", "C.  Level touch probabilities  -  scored with a Brier score (test T7)", F_SEC)
    header(ws, r + 1, ["Level", "", "Price ($)", "From anchor ($)", "Distance (ATR)", "Chance touched Tue",
                       "Touched? (1 = yes)", "First touch (SAST)", "Squared error"])
    ws.merge_cells(f"A{r+1}:B{r+1}")
    ws.row_dimensions[r + 1].height = 30
    lv_first = r + 2
    for i, L in enumerate(T["levels"]):
        q = lv_first + i
        put(ws, f"A{q}", L["label"])
        ws.merge_cells(f"A{q}:B{q}")
        put(ws, f"C{q}", L["price"], F_IN, PX)
        put(ws, f"D{q}", f"=C{q}-{TL}$B$4", F_LINK, MOVE)
        put(ws, f"E{q}", f"=D{q}/{TL}$B$5", F_LINK, '+0.00;-0.00')
        put(ws, f"F{q}", L["p_touch"], F_IN, '0%')
        put(ws, f"G{q}", f'=IF(COUNT({O})=0,"",IF(AND(C{q}<=MAX({O}),C{q}>=MIN({Pc})),1,0))', F_LINK, '0')
        ws[f"H{q}"].fill = FILL_Y
        ws[f"H{q}"].font = F_IN
        put(ws, f"I{q}", f'=IF(G{q}="","",(F{q}-G{q})^2)', fmt='0.000')
        for c_ in "ABCDEFGHI":
            ws[f"{c_}{q}"].border = BOX
    lv_last = lv_first + len(T["levels"]) - 1
    from openpyxl.formatting.rule import DataBarRule
    ws.conditional_formatting.add(f"F{lv_first}:F{lv_last}", DataBarRule(start_type="num", start_value=0, end_type="num",
                                                                         end_value=1, color="5B9BD5"))
    ws.conditional_formatting.add(f"G{lv_first}:G{lv_last}", CellIsRule(operator="equal", formula=["1"], fill=GREEN))
    b_row = lv_last + 1
    put(ws, f"A{b_row}", "Brier score (0 = perfect, 0.25 = coin flip)", F_B)
    put(ws, f"I{b_row}", f'=IF(COUNT(I{lv_first}:I{lv_last})=0,"",AVERAGE(I{lv_first}:I{lv_last}))', fmt='0.000', bold=True, fill=FILL_KEY)
    put(ws, f"A{b_row+1}", f"Walk-forward over 200 days these probabilities scored a Brier of {T['calibration_brier']:.3f} "
                           "(calibration table on the Backtest sheet).", F_NOTE)
    ws[f"F{rows['T7']}"] = f"=I{b_row}"
    ws[f"F{rows['T7']}"].font = F_FX
    ws[f"F{rows['T7']}"].number_format = '0.000'
    ws.freeze_panes = "A5"
    return dict(tests=rows, scenarios=sc_rows, levels=(lv_first, lv_last), brier=f"I{b_row}", overall="B15", verdict="C15")


def short_label(label):
    import re
    names = label.split(" / ")
    s = names[0]
    s = re.sub(r" - previous day (high|low|close) \(Mon\)", r" Mon \1", s)
    s = re.sub(r" - previous week (high|low|close)", r" last week \1", s)
    s = re.sub(r"\d{4}\.\d{2}-\d{4}\.\d{2} ", "", s)
    s = re.sub(r" \(untaken\)", "", s)
    s = re.sub(r" \d{2}:\d{2}$", "", s)
    s = s.replace("(partly mitigated)", "(part-filled)").replace("dealing-range 50% (equilibrium)", "range 50%")
    return s + (f"  +{len(names) - 1}" if len(names) > 1 else "")


def tile(ws, c, r, label, value, sub, fmt=None):
    c1, c2 = col(c), col(c + 1)
    for k, (v, f) in enumerate([(label, Font(name=FONT, bold=True, size=8, color="7F7F7F")),
                                (value, Font(name=FONT, bold=True, size=16, color=NAVY)),
                                (sub, Font(name=FONT, size=8, color="595959"))]):
        rr = r + k
        ws.merge_cells(f"{c1}{rr}:{c2}{rr}")
        cell = ws[f"{c1}{rr}"]
        cell.value, cell.font = v, f
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        if k == 1 and fmt:
            cell.number_format = fmt
        for cc in (c1, c2):
            ws[f"{cc}{rr}"].fill = TILE
    ws.row_dimensions[r + 1].height = 30
    return f"{c1}{r+1}"


def dashboard_sheet(wb, R, T, TR, MR, first, last, chart_y):
    ws = wb.create_sheet("Dashboard", 0)
    for c in range(1, 13):
        ws.column_dimensions[col(c)].width = 13
    day = sast(pd.Timestamp(R["cutoff"])) + pd.Timedelta(hours=1)
    day = day + pd.Timedelta(days=2) if day.weekday() == 5 else day
    put(ws, "A1", f"XAUUSD  -  game plan for {day:%A %d %B %Y}", Font(name=FONT, bold=True, size=18, color=NAVY))
    put(ws, "A2", f"Frozen at Monday's close ({sast(R['cutoff']):%a %H:%M} SAST) from cTrader data; targets locked "
                  f"{sast(T['created_utc']):%H:%M} SAST, before the open. Model {T['model_version']}. Times are SAST.", F_NOTE)
    for i, (sheet, text) in enumerate([("Targets", "Targets >"), ("Forecast Timeline", "Timeline >"), ("Scorecard", "Scorecard >"),
                                       ("MTF Trend", "MTF Trend >"), ("Key Levels", "Key Levels >"), ("Markers", "Markers >"),
                                       ("Guide", "Guide >")]):
        link(ws, f"{col(1 + i)}3", sheet, text)
    TL, MT, TG = "'Forecast Timeline'!", "'MTF Trend'!", "Targets!"
    put(ws, "A5", "THE SET-UP", F_SEC)
    v = [tile(ws, 1, 6, "MONDAY CLOSE (ANCHOR)", f"={TL}$B$4", f'="daily ATR $"&TEXT({TL}$B$5,"0")', PX),
         tile(ws, 3, 6, "INTRADAY TREND 1m-4h", f"={MT}$Q${MR['all_row']}", f'="weighted score "&TEXT({MT}$P${MR["all_row"]},"+0.0;-0.0")'),
         tile(ws, 5, 6, "DAILY TREND", f"={MT}$Q${MR['d1_row']}", f'="score "&TEXT({MT}$P${MR["d1_row"]},"+0;-0;0")&" - price under daily EMA50"'),
         tile(ws, 7, 6, "PATTERN (20 ANALOGS)", f'=TEXT({TL}$B$9,"0%")&" up"', "centre line = coin flip (Backtest)"),
         tile(ws, 9, 6, "PROJECTED RANGE", f'=TEXT({TL}$B$11,"#,##0")&" - "&TEXT({TL}$B$10,"#,##0")',
              f'="close near "&TEXT({TL}$B$12,"#,##0")'),
         tile(ws, 11, 6, "EVENT RISK", EVENT["short"] if EVENT else "None flagged",
              "bands after 15:30 likely too narrow" if EVENT else "check the calendar before trading")]
    for ref in v[1:3]:
        ws.conditional_formatting.add(ref, CellIsRule(operator="equal", formula=['"Bullish"'], fill=GREEN))
        ws.conditional_formatting.add(ref, CellIsRule(operator="equal", formula=['"Bearish"'], fill=RED))
    put(ws, "A10", "LIVE STATUS  (updates when check.py runs)", F_SEC)
    sb, sr = TR["scenarios"]["bull"]["outcome"], TR["scenarios"]["bear"]["outcome"]
    tile(ws, 1, 11, "HOURS SCORED", '=Scorecard!$B$5&" / 23"', "of Tuesday's hourly bars")
    tile(ws, 3, 11, "LAST PRICE", f'=IF({TG}$F${TR["tests"]["T4"]}="","-",{TG}$F${TR["tests"]["T4"]})', "latest hourly close", PX)
    tile(ws, 5, 11, "MOVE VS ANCHOR", '=IF(Scorecard!$B$5=0,"-",Scorecard!$B$13)', "dollars from Monday's close", MOVE)
    tile(ws, 7, 11, "TESTS", f"={TG}$B$15", f"={TG}$C$15")
    tile(ws, 9, 11, "BULL SCENARIO", f"={TG}$B${sb}", "trigger: 1h close above " + f"{T['scenarios'][0]['trigger']['price']:,.2f}")
    tile(ws, 11, 11, "BEAR SCENARIO", f"={TG}$B${sr}", "trigger: 1h close below " + f"{T['scenarios'][1]['trigger']['price']:,.2f}")
    for c_ in ("G12", "I12", "K12"):
        ws[c_].font = Font(name=FONT, bold=True, size=10, color=NAVY)

    # scenario plan (left) and nearest levels (right)
    put(ws, "A15", "SCENARIO PLAN", F_SEC)
    put(ws, "H15", "LEVELS NEAREST THE OPEN", F_SEC)
    hdr = lambda cells: [setattr(ws[c], "font", F_H) or setattr(ws[c], "fill", FILL_H) for c in cells]
    for c_, t in zip("ADEF", ["Step", "Price", "Chance *", "Reached at"]):
        put(ws, f"{c_}16", t, F_H)
    ws.merge_cells("A16:C16")
    hdr(["A16", "B16", "C16", "D16", "E16", "F16"])
    r = 17
    for s in T["scenarios"]:
        rows = TR["scenarios"][s["key"]]
        label = "BULL" if s["key"] == "bull" else "BEAR"
        color = "375623" if s["key"] == "bull" else "C00000"
        up = s["key"] == "bull"
        steps = ([(f"{label} trigger: 1h close {'above' if up else 'below'}", rows["trigger"])]
                 + [(f"{label} {x['name']}", tr) for x, tr in zip(s["targets"], rows["targets"])]
                 + [(f"{label} invalidation: 1h close {'below' if up else 'above'}", rows["inval"])])
        for name, tr in steps:
            put(ws, f"A{r}", name, Font(name=FONT, color=color, bold="trigger" in name))
            ws.merge_cells(f"A{r}:C{r}")
            put(ws, f"D{r}", f"={TG}$C${tr}", F_LINK, PX)
            if " T" in name:
                put(ws, f"E{r}", f"={TG}$E${tr}", F_LINK, '0%')
            put(ws, f"F{r}", f'=IF({TG}$F${tr}="","",{TG}$F${tr})', F_LINK)
            r += 1
        r += 1
    put(ws, f"A{r}", "* chance the price trades there at any time Tuesday (from Monday's close)", F_NOTE)
    for c_, t in zip("HJKL", ["Level", "Price", "Chance", "Touched?"]):
        put(ws, f"{c_}16", t, F_H)
    ws.merge_cells("H16:I16")
    hdr(["H16", "I16", "J16", "K16", "L16"])
    lv_first, lv_last = TR["levels"]
    lv = T["levels"]
    above = [i for i, L in enumerate(lv) if L["side"] == "above"][-6:]
    below = [i for i, L in enumerate(lv) if L["side"] == "below"][:6]
    rr = 17
    for i in above + [None] + below:
        if i is None:
            put(ws, f"H{rr}", "MONDAY CLOSE (anchor)", F_B)
            ws.merge_cells(f"H{rr}:I{rr}")
            put(ws, f"J{rr}", f"={TL}$B$4", F_LINK, PX)
            for c_ in "HIJKL":
                ws[f"{c_}{rr}"].fill = FILL_ANCHOR
        else:
            tr = lv_first + i
            put(ws, f"H{rr}", short_label(lv[i]["label"]), comment=lv[i]["label"] if " / " in lv[i]["label"] else None)
            ws.merge_cells(f"H{rr}:I{rr}")
            put(ws, f"J{rr}", f"={TG}$C${tr}", F_LINK, PX)
            put(ws, f"K{rr}", f"={TG}$F${tr}", F_LINK, '0%')
            put(ws, f"L{rr}", f'=IF({TG}$G${tr}="","",IF({TG}$G${tr}=1,"Yes","No"))', F_LINK)
        rr += 1
    ws.conditional_formatting.add(f"L17:L{rr}", CellIsRule(operator="equal", formula=['"Yes"'], fill=GREEN))
    ws.conditional_formatting.add(f"K17:K{rr}", __import__("openpyxl.formatting.rule", fromlist=["DataBarRule"]).DataBarRule(
        start_type="num", start_value=0, end_type="num", end_value=1, color="5B9BD5"))

    top = max(r, rr) + 2
    put(ws, f"A{top}", "PROJECTION VS ACTUAL", F_SEC)
    chart_at = f"A{top + 1}"
    add_timeline_chart(wb["Forecast Timeline"], first - 1, last, *chart_y, place_ws=ws, at=chart_at, size=(9.5, 30))
    h = top + 21
    put(ws, f"A{h}", "HOW TO USE TOMORROW", F_SEC)
    steps = ["1. Before the open: read the set-up tiles and the two scenarios. Bull needs a 1h CLOSE above the resistance cluster; "
             "bear needs a 1h CLOSE below the support gap. Between them, expect rotation until " +
             (f"{EVENT['name']} at 15:30." if EVENT else "the 15:30 US data window."),
             "2. During the day: ask Claude for a live check (or run check.py). It fills the yellow actuals and every tile, test and "
             "touched level updates. Scheduled checks run at 19:05 SAST and 00:10 SAST.",
             "3. After 00:00: the Targets sheet shows the final pass count against par (5 of 8) and the day is added to the Scorecard log.",
             "This is statistical analysis of past price behaviour - a map of likely ranges and levels, not financial advice or a trade signal."]
    for i, t in enumerate(steps, h + 1):
        put(ws, f"A{i}", t, F_NOTE if i == h + len(steps) else F_FX)
        ws.merge_cells(f"A{i}:L{i}")
        ws[f"A{i}"].alignment = Alignment(wrap_text=True, vertical="top")
        ws.row_dimensions[i].height = 28
    ws.page_setup.orientation = "landscape"
    ws.page_setup.fitToWidth, ws.page_setup.fitToHeight = 1, 0
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    return chart_at


def guide_sheet(wb, R, T, bt_summary, mtf_lines):
    ws = wb.active
    ws.title = "Guide"
    ws.column_dimensions["A"].width = 26
    ws.column_dimensions["B"].width = 110
    cut = sast(R["cutoff"])
    title(ws, "Guide - how this workbook works",
          f"XAUUSD from cTrader (demo feed, bid), read-only. Frozen {cut:%a %d %b %Y %H:%M} SAST. All times SAST (UTC+2).")
    r = 5
    put(ws, f"A{r}", "Start here", F_SEC); r += 1
    for t in ["Open the Dashboard first: the set-up, live status, scenario plan and nearest levels on one screen.",
              "Targets holds what we are testing: eight pass/fail tests, the bull/bear scenario plan and level probabilities.",
              "Everything updates by itself when the actual bars are filled in (check.py, or ask Claude for a live check)."]:
        put(ws, f"B{r}", t); r += 1
    r += 1
    put(ws, f"A{r}", "Sheets", F_SEC); r += 1
    directory = [
        ("Dashboard", "One-screen game plan and live status."),
        ("Targets", "The eight tests with thresholds and historical pass rates, scenario triggers/targets, level touch probabilities."),
        ("Forecast Timeline", "Tuesday hour by hour: projected price, 50% and 80% bands, events, yellow ACTUAL columns, errors, chart."),
        ("Scorecard", "Detailed error measures (before/after 15:30) and the daily log that builds a track record."),
        ("MTF Trend", "1m, 5m, 15m, 30m, 1h, 4h and daily: EMA stack, slope, RSI, trend score, structure, premium/discount."),
        ("Key Levels", "Full price ladder: day, week and session levels, pivots, untaken swings, open FVGs, round numbers."),
        ("Markers", "BOS / CHoCH, swing points and open fair value gaps for every timeframe."),
        ("Analogs", "The 20 past days most like Monday and what each did next (the pattern)."),
        ("Vol Profile", "How far gold typically travels by each hour - sets the band width."),
        ("Backtest", "The method walked forward over 200 days, plus the calibration of the touch probabilities."),
        ("Settings", "Indicator periods and band z-scores (blue cells can be changed)."),
    ]
    for s, d in directory:
        link(ws, f"A{r}", s, s)
        put(ws, f"B{r}", d); r += 1
    put(ws, f"A{r}", "Data 1m ... 1D")
    put(ws, f"B{r}", "Raw OHLCV with live indicator formulas and marker tags (grey tabs at the end)."); r += 2
    put(ws, f"A{r}", "Colours", F_SEC); r += 1
    for k, d, f, fill in [("Blue text", "raw data or a fixed input", F_IN, None), ("Black text", "formula", F_FX, None),
                          ("Green text", "formula pulling from another sheet", F_LINK, None),
                          ("Yellow fill", "actuals - filled from cTrader by check.py", F_FX, FILL_Y),
                          ("Tabs", "navy = dashboard, green = decision sheets, blue = analysis, grey = engine, dark = data", F_FX, None)]:
        put(ws, f"A{r}", k, f, fill=fill)
        put(ws, f"B{r}", d); r += 1
    r += 1
    put(ws, f"A{r}", "Read at Monday's close", F_SEC); r += 1
    for t in mtf_lines:
        put(ws, f"B{r}", t.strip()); r += 1
    r += 1
    put(ws, f"A{r}", "Glossary", F_SEC); r += 1
    for k, d in [("ATR", "Average True Range - the typical daily travel (Wilder, 14). Distances in 'ATR' are multiples of it."),
                 ("EMA fast/mid/slow", "Exponential moving averages, 20/50/200 bars."),
                 ("RSI", "Relative Strength Index (14). Above 55 counts as bullish momentum, below 45 bearish."),
                 ("BOS", "Break of structure: a candle closes through the last swing in the direction of the trend."),
                 ("CHoCH", "Change of character: the first close through the last swing AGAINST the trend."),
                 ("FVG", "Fair value gap: a 3-candle imbalance where candle 1 and 3 do not overlap. 'Open' = not yet traded back into."),
                 ("PDH / PDL / PDC", "Previous day high / low / close (Monday). PWH / PWL / PWC = previous week."),
                 ("Premium / Discount", "Price above / below the 50% (equilibrium) of the latest swing range."),
                 ("Liquidity sweep", "Price trades just through an obvious high/low, then closes back inside (Monday vs PWH)."),
                 ("Analog", "A past day whose set-up looked like today's; their next days form the projected path."),
                 ("Random walk", "The 'no change' forecast: tomorrow's price = today's close. A model must beat it to show skill."),
                 ("50% / 80% band", "Ranges that should contain the hourly close about half / four-fifths of the time."),
                 ("Brier score", "Accuracy of probability calls: average of (probability - outcome)^2. 0 is perfect, 0.25 is a coin flip."),
                 ("Par", "The number of tests a typical day passes (5 of 8 over the last 200 days).")]:
        put(ws, f"A{r}", k, bold=True)
        put(ws, f"B{r}", d); r += 1
    r += 1
    put(ws, f"A{r}", "Method", F_SEC); r += 1
    for t in ["Each past day (2 years of 1h bars) gets a fingerprint at its close: last 24 hourly closes, last 5 daily moves, position in "
              "the 20-day range, stretch from the 20-day EMA and the day's range, all in daily-ATR units.",
              "The 20 most similar days are found; the average of their next-day hourly paths, scaled to today's ATR, is the centre line.",
              "Bands = typical travel by hour over the last 120 sessions x 0.674 (50%) or 1.28 (80%).",
              f"Level probabilities = how often the next day travelled that far from the close over the last {T['trail_sessions']} sessions."]:
        put(ws, f"B{r}", t); r += 1
    r += 1
    put(ws, f"A{r}", "Honest caveats", F_SEC); r += 1
    for t in bt_summary + [(f"{EVENT['name']} prints at 15:30 SAST Tuesday; the model ignores scheduled news, so post-15:30 bands are "
                            "probably too narrow." if EVENT else "No high-impact event flagged for this day - check the calendar."),
                           "Not financial advice and not a trade signal. Demo-feed prices can differ slightly from your live CFI / MT5 feed."]:
        put(ws, f"B{r}", t); r += 1
    for row in ws.iter_rows(min_row=5, max_row=r, min_col=2, max_col=2):
        for c in row:
            c.alignment = Alignment(wrap_text=True, vertical="top")


def backtest_calibration(wb, T):
    ws = wb["Backtest"]
    put(ws, "M3", "Touch-probability calibration (walk-forward, 200 days)", F_B)
    for i, h in enumerate(["Predicted bin", "Predictions", "Avg predicted", "Actually touched"]):
        c = ws.cell(row=4, column=13 + i, value=h)
        c.font, c.fill, c.border = F_H, FILL_H, BOX
        ws.column_dimensions[col(13 + i)].width = 14
    for j, rw in enumerate(T["calibration"]):
        r = 5 + j
        put(ws, f"M{r}", f"{int(rw['bin']) * 10}-{int(rw['bin']) * 10 + 10}%")
        put(ws, f"N{r}", int(rw["n"]), F_IN, '0')
        put(ws, f"O{r}", rw["pred"], F_IN, '0%')
        put(ws, f"P{r}", rw["actual"], F_IN, '0%')
    r = 5 + len(T["calibration"])
    put(ws, f"M{r}", "Brier", bold=True)
    put(ws, f"P{r}", T["calibration_brier"], F_IN, '0.000', bold=True)
    put(ws, f"M{r+1}", "Calibrated if 'Avg predicted' is close to 'Actually touched' in every row.", F_NOTE)


def localise(wb, prev_day, next_day):
    """The sheet text is written for a Monday-close -> Tuesday forecast; swap in the real day names."""
    p, n = f"{prev_day:%A}", f"{next_day:%A}"
    swap = [("Monday", p), ("MONDAY", p.upper()), ("Tuesday", n), ("(Mon)", f"({p[:3]})"), ("Mon high", f"{p[:3]} high"),
            ("Mon low", f"{p[:3]} low"), ("Mon close", f"{p[:3]} close"), ("Mon open", f"{p[:3]} open"),
            ("Tue *", f"{n[:3]} *"), ("Tue?", f"{n[:3]}?"), ("(Tue)", f"({n[:3]})")]
    if (p, n) == ("Monday", "Tuesday"):
        return
    import re
    table = dict(swap)
    pat = re.compile("|".join(re.escape(k) for k, _ in sorted(swap, key=lambda x: -len(x[0]))))
    dated = re.compile(r"\b\d{1,2} [A-Z][a-z]+ \d{4}\b")          # computed titles carry real dates
    for ws in wb.worksheets:
        if ws.title.startswith("Data"):
            continue
        for row in ws.iter_rows():
            for c in row:
                if isinstance(c.value, str) and not dated.search(c.value) and pat.search(c.value):
                    c.value = pat.sub(lambda m: table[m.group(0)], c.value)


def finish(wb):
    for ws in wb.worksheets:
        ws.sheet_view.showGridLines = ws.title.startswith("Data")
        ws.sheet_properties.tabColor = TAB.get(ws.title, "595959")
        if ws.title not in ("Dashboard",) and not ws.title.startswith("Data"):
            link(ws, "A3", "Dashboard", "<< Back to Dashboard")


# ----------------------------------------------------------------- main
def build(cutoff, out):
    R = A.run(cutoff)
    sess, li = R["sess"], R["last_i"]
    # first bar after the daily break; Friday's close reopens on Sunday night
    next_start = sess.end[li] + pd.Timedelta(hours=2) + pd.Timedelta(days=2 if sess.end[li].weekday() == 4 else 0)
    bars_utc = [next_start + pd.Timedelta(hours=h) for h in range(A.BARS_PER_SESSION)]
    bar_end_sast = [(b + pd.Timedelta(hours=1)).tz_convert(None).to_pydatetime() + A.SAST for b in bars_utc]
    day = (bars_utc[0] + pd.Timedelta(hours=1)).tz_convert(None) + A.SAST
    outdir = Path(out).parent
    global EVENT
    EVENT = EVENTS.get(f"{day:%Y-%m-%d}")
    prev_day = sess.end[li].tz_convert(None) + A.SAST            # last bar of the anchor session, in SAST

    bt = R["bt"]
    hit, base = bt.dir_hit.mean(), (bt.act_final > 0).mean()
    ratio = bt.mae.mean() / bt.mae_rw.mean()
    bt_summary = [
        f"Backtest, last {len(bt)} sessions: direction hit rate {hit:.0%} vs {base:.0%} up-days base rate "
        f"(standard error about {np.sqrt(.25 / len(bt)):.0%}) - not distinguishable from a coin flip.",
        f"Hourly path error was {ratio:.2f}x a random walk's ({'better' if ratio < 1 else 'worse'} than assuming no change). "
        "So the centre line has no proven edge; treat it as a neutral-ish drift.",
        f"Bands are reasonably calibrated: the 50% band held {bt.cov50.mean():.0%} and the 80% band {bt.cov80.mean():.0%} "
        "of hourly closes - this, plus the levels, is the useful part.",
    ]
    tf = R["tfs"]
    mtf_lines = []
    for p in reversed(A.TF):
        t = tf[p]
        L = t["last"]
        score = ((1 if L.close > L.ema_fast else -1) + (1 if L.close > L.ema_mid else -1) + (1 if L.close > L.ema_slow else -1)
                 + (1 if L.ema_fast > L.ema_mid > L.ema_slow else (-1 if L.ema_fast < L.ema_mid < L.ema_slow else 0))
                 + int(np.sign(L.ema_mid - t["df"].ema_mid.iloc[-11]))
                 + (1 if L.rsi > 55 else (-1 if L.rsi < 45 else 0)))
        e = t["last_event"]
        mtf_lines.append(f"{A.TF_LABEL[p]}: score {score:+d}, {t['seq']}" + (f", last {e['kind']} at {e['level']:.2f}" if e else ""))
    D = R["d1"].iloc[-1]
    mtf_lines.append(f"1D (context): close {D.close:.2f} vs EMA20 {D.ema_fast:.2f} / EMA50 {D.ema_mid:.2f} / EMA200 "
                     f"{D.ema_slow:.2f}, RSI {D.rsi:.0f} - "
                     + ("the daily trend is still down, so the intraday strength is a bounce into daily resistance."
                        if D.ema_fast < D.ema_mid < D.ema_slow else "daily trend not aligned down."))
    fc = R["fc"]
    mtf_lines.append(f"Pattern: {fc['p_up']:.0%} of the 20 analogs closed up next day; mean path ends "
                     f"{fc['center'][-1] * R['atr_now']:+.2f} $ from the anchor; median analog range "
                     f"{fc['lo'] * R['atr_now']:+.0f} / {fc['hi'] * R['atr_now']:+.0f} $.")

    # the frozen forecast is written once and never overwritten
    fc_frozen = dict(symbol="XAUUSD", source="cTrader remote MCP data profile (demo feed, bid)",
                     cutoff_utc=str(R["cutoff"]), anchor=float(R["anchor"]), atr=float(R["atr_now"]),
                     bars_utc=[str(b) for b in bars_utc],
                     projected_move=[float(x * R["atr_now"]) for x in fc["center"]],
                     sigma=[float(x * R["atr_now"]) for x in R["sigma"]],
                     z50=0.674, z80=1.2816, p_up=float(fc["p_up"]),
                     proj_high=float(R["anchor"] + fc["hi"] * R["atr_now"]),
                     proj_low=float(R["anchor"] + fc["lo"] * R["atr_now"]),
                     timeline_first_row=15, timeline_last_row=14 + A.BARS_PER_SESSION, log_first_row=None, chart_y=None,
                     backtest=dict(n=len(bt), hit=float(hit), base_up=float(base), mae_ratio=float(ratio),
                                   cov50=float(bt.cov50.mean()), cov80=float(bt.cov80.mean())),
                     analogs=[str((sess.end[p["d"]].tz_convert(None) + A.SAST).date()) for p in fc["picks"]])
    jpath = outdir / f"forecast_{day:%Y-%m-%d}.json"
    tpath = outdir / f"targets_{day:%Y-%m-%d}.json"
    if jpath.exists():                                   # frozen: verify, never overwrite
        old = json.loads(jpath.read_text())
        for k in ("anchor", "projected_move", "sigma", "proj_high", "proj_low", "bars_utc"):
            if old[k] != fc_frozen[k]:
                raise SystemExit(f"frozen forecast differs on '{k}' - refusing to continue")
    else:
        fc_frozen["chart_y"] = chart_range(R)
        jpath.write_text(json.dumps(fc_frozen, indent=1))
    if not tpath.exists():                               # targets are locked once, right after the forecast
        import targets as TG_
        tpath.write_text(json.dumps(TG_.build_targets(R, jpath), indent=1))
    T = json.loads(tpath.read_text())

    wb = Workbook()
    guide_sheet(wb, R, T, bt_summary, mtf_lines)
    settings_sheet(wb)
    for p in A.TF:
        t = tf[p]
        data_sheet(wb, p, t["df"], t["sh"], t["sl"], t["events"], t["gaps"])
    data_sheet(wb, "D_1", R["d1"])
    AN = analogs_sheet(wb, R)
    profile_sheet(wb, R, bar_end_sast)
    backtest_sheet(wb, R)
    backtest_calibration(wb, T)
    cpi = (f"{EVENT['name']} at 15:30 SAST: expect a volatility spike the bands do not model." if EVENT
           else "No high-impact event flagged - check the calendar before trading.")
    first, last = timeline_sheet(wb, R, AN, bars_utc, cpi)
    log_row = scorecard_sheet(wb, first, last)
    MR = mtf_sheet(wb, R)
    li_sess = R["h1"][R["h1"].session == sess.session[li]]
    levels_sheet(wb, R, (li_sess.time_utc.iloc[0].tz_convert(None) + A.SAST).to_pydatetime(),
                 (li_sess.time_utc.iloc[-1].tz_convert(None) + A.SAST + pd.Timedelta(hours=1)).to_pydatetime())
    markers_sheet(wb, R)
    TR = targets_sheet(wb, T, first, last)
    dash_chart = dashboard_sheet(wb, R, T, TR, MR, first, last, CHART_Y)
    order = ["Dashboard", "Targets", "Forecast Timeline", "Scorecard", "MTF Trend", "Key Levels", "Markers", "Guide",
             "Analogs", "Vol Profile", "Backtest", "Settings"] + [DATA_SHEET[p] for p in A.TF + ["D_1"]]
    wb._sheets = [wb[n] for n in order]
    wb.active = 0
    for ws in wb.worksheets:
        ws.sheet_view.tabSelected = ws.title == "Dashboard"
    finish(wb)
    localise(wb, prev_day, day)
    wb.save(out)

    layout = dict(workbook=Path(out).name, timeline=dict(first=first, last=last, chart_y=CHART_Y),
                  log_first_row=log_row, dashboard_chart=dash_chart, targets=TR)
    (outdir / f"layout_{day:%Y-%m-%d}.json").write_text(json.dumps(layout, indent=1))
    return R, fc_frozen, jpath


if __name__ == "__main__":
    cutoff = sys.argv[1] if len(sys.argv) > 1 else "2026-11-09T22:00:00Z"
    out = sys.argv[2] if len(sys.argv) > 2 else str(HERE / "XAUUSD_MTF_Forecast_2026-11-10.xlsx")
    R, frozen, jpath = build(cutoff, out)
    print("wrote", out, "| frozen:", jpath.name, "+", jpath.name.replace("forecast", "targets"))

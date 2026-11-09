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
CPI_SAST_HOUR = 15   # US CPI 08:30 ET = 13:30 UTC = 15:30 SAST


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
    return ws


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


def add_timeline_chart(ws, H, last, ymin, ymax):
    """Projection, bands and actuals. Re-added by check.py because openpyxl drops charts on re-save."""
    ch = LineChart()
    ch.title = "Projection vs actual (SAST)"
    ch.height, ch.width = 11, 26
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
    ws.add_chart(ch, f"A{last + 3}")


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
             14: "US CPI (Oct) 15:30 - HIGH IMPACT", 15: "US cash equities open 16:30",
             16: "LBMA gold PM auction 17:00", 22: "NY close / daily break 00:00"}
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
        put(ws, f"E{r}", "Pre-CPI" if en.hour <= CPI_SAST_HOUR and en.hour != 0 else "Post-CPI")
        if i in notes:
            put(ws, f"F{r}", notes[i], Font(name=FONT, color="C00000", bold=True) if "CPI" in notes[i] else F_FX)
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
        if "CPI" in notes.get(i, ""):
            for c_ in range(1, 7):
                ws.cell(row=r, column=c_).fill = PatternFill("solid", fgColor="FCE4D6")
    last = H + len(bars_utc)
    green, red = PatternFill("solid", fgColor="C6EFCE"), PatternFill("solid", fgColor="FFC7CE")
    ws.conditional_formatting.add(f"T{H+1}:V{last}", CellIsRule(operator="equal", formula=['"Yes"'], fill=green))
    ws.conditional_formatting.add(f"T{H+1}:V{last}", CellIsRule(operator="equal", formula=['"No"'], fill=red))
    ws.freeze_panes = f"D{H+1}"

    lo = min(float(R["anchor"]) - 2.2 * float(R["sigma"].max() * R["atr_now"]), float(R["day"]["pdl"]))
    hi = max(float(R["anchor"]) + 2.2 * float(R["sigma"].max() * R["atr_now"]), float(R["day"]["pdh"]))
    CHART_Y[:] = [int(lo // 25 * 25), int(hi // 25 * 25 + 25)]
    add_timeline_chart(ws, H, last, *CHART_Y)
    return H + 1, last


def scorecard_sheet(wb, first, last):
    ws = wb.create_sheet("Scorecard", 2)
    title(ws, "Scorecard - how close did the actuals run to the projection?",
          "Criteria were fixed BEFORE Tuesday traded. Fills in automatically as the yellow actuals arrive.")
    T = "'Forecast Timeline'!"
    rg = lambda c_: f"{T}${c_}${first}:${c_}${last}"
    header(ws, 4, ["Measure", "Value", "Pre-registered test", "Result"], [52, 14, 44, 12])
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
        ("Mean |error| before CPI ($)", f'=IFERROR(AVERAGEIFS({rg("R")},{rg("E")},"Pre-CPI"),"")', PX, None, None),
        ("Mean |error| after CPI ($)", f'=IFERROR(AVERAGEIFS({rg("R")},{rg("E")},"Post-CPI"),"")', PX, None, None),
        ("Random-walk |error| before CPI ($)", f'=IFERROR(AVERAGEIFS({rg("S")},{rg("E")},"Pre-CPI"),"")', PX, None, None),
        ("Random-walk |error| after CPI ($)", f'=IFERROR(AVERAGEIFS({rg("S")},{rg("E")},"Post-CPI"),"")', PX, None, None),
    ]
    for i, (lab, f, fmt, test, res) in enumerate(rows, 5):
        put(ws, f"A{i}", lab)
        put(ws, f"B{i}", f, F_LINK if "!" in f else F_FX, fmt)
        if test:
            put(ws, f"C{i}", test)
            put(ws, f"D{i}", res, bold=True)
    o = 5 + len(rows) + 1
    put(ws, f"A{o}", "Overall: tests passed (of 4)", F_B)
    put(ws, f"B{o}", f'=IF(B5=0,"",COUNTIF(D5:D{o-2},"PASS")&" / 4")', bold=True, fill=FILL_KEY)
    put(ws, f"C{o}", f'=IF(B5=0,"Waiting for Tuesday\'s actuals",IF(COUNTIF(D5:D{o-2},"PASS")>=3,"Projection held up","Projection did not hold up - a valid result"))', bold=True)
    green, red = PatternFill("solid", fgColor="C6EFCE"), PatternFill("solid", fgColor="FFC7CE")
    ws.conditional_formatting.add(f"D5:D{o}", CellIsRule(operator="equal", formula=['"PASS"'], fill=green))
    ws.conditional_formatting.add(f"D5:D{o}", CellIsRule(operator="equal", formula=['"FAIL"'], fill=red))
    put(ws, f"A{o+1}", "One day is n = 1: a PASS or FAIL here is anecdote. The Daily Log below accumulates days so the "
                       "record becomes meaningful; the Backtest sheet is the 200-day version.", F_NOTE)
    lg = o + 3
    put(ws, f"A{lg}", "Daily log (check.py appends one row per scored day)", F_B)
    for j, h in enumerate(["Day", "Hours", "Error ratio", "In 50%", "In 80%", "Direction", "Proj. close", "Actual close",
                           "Proj. high", "Actual high", "Proj. low", "Actual low"], 1):
        c = ws.cell(row=lg + 1, column=j, value=h)
        c.font, c.fill, c.border = F_H, FILL_H, BOX
    for j in range(5, 13):
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


# ----------------------------------------------------------------- read me
def readme_sheet(wb, R, bt_summary, mtf_lines):
    ws = wb.active
    ws.title = "Read Me"
    ws.column_dimensions["A"].width = 120
    cut = R["cutoff"].tz_convert(None) + A.SAST
    lines = [
        ("XAUUSD (gold) - multi-timeframe analysis and Tuesday hourly projection", F_T),
        (f"Data: cTrader XAUUSD (demo account feed, bid prices), pulled read-only through the cTrader remote MCP data profile. "
         f"Frozen at {cut:%a %d %b %Y %H:%M} SAST (Monday's close). All times are SAST (UTC+2).", F_FX),
        ("", F_FX),
        ("Sheets", F_B),
        ("MTF Trend - 1m, 5m, 15m, 30m, 1h, 4h (+daily context): EMA stack, slope, RSI, a -6..+6 trend score, swing sequence, last BOS/CHoCH, premium/discount.", F_FX),
        ("Forecast Timeline - Tuesday hour by hour: projected price with 50% and 80% bands, scheduled events, yellow ACTUAL columns, error columns, chart.", F_FX),
        ("Scorecard - tests fixed before Tuesday traded, pass/fail, and a daily log that accumulates over time.", F_FX),
        ("Key Levels - price ladder: PDH/PDL/PDC, previous week, Monday's Asia/London/NY session extremes, daily pivots, untaken swings, open FVGs, round numbers.", F_FX),
        ("Markers - BOS/CHoCH, swing points and open fair value gaps for every timeframe.", F_FX),
        ("Analogs - the 20 past days whose set-up looked most like Monday's, and what each did the next day (the 'pattern').", F_FX),
        ("Vol Profile - how far gold typically travels by each hour of the day; sets band width.", F_FX),
        ("Backtest - the same projection method walked forward over the last 200 sessions, scored against a random walk.", F_FX),
        ("Data 1m ... Data 1D - raw OHLCV with live indicator formulas and marker tags. Settings - indicator periods and band z-scores.", F_FX),
        ("", F_FX),
        ("Colour code: blue text = raw data / hardcoded input, black = formula, green = formula pulling from another sheet, "
         "yellow fill = actuals to be filled (check.py does this from cTrader).", F_FX),
        ("", F_FX),
        ("Read at Monday's close", F_B),
    ] + [(l, F_FX) for l in mtf_lines] + [
        ("", F_FX),
        ("How the projection works", F_B),
        ("1. Each past trading day (2 years of 1h bars) gets a fingerprint at its close: shape of the last 24 hourly closes, last 5 daily moves, "
         "position in the 20-day range, stretch from the 20-day EMA and the day's range, all in daily-ATR units.", F_FX),
        ("2. The 20 days most similar to Monday are selected. Their next-day hourly paths are averaged and scaled to today's ATR = the centre line.", F_FX),
        ("3. Bands come from the typical travel by hour over the last 120 sessions (Vol Profile), times 0.674 (50%) or 1.28 (80%).", F_FX),
        ("", F_FX),
        ("Honest caveats", F_B),
    ] + [(l, F_FX) for l in bt_summary] + [
        ("US CPI (October) prints at 15:30 SAST on Tuesday. The model does not know about scheduled news, so the bands after 15:30 are "
         "probably too narrow; the scorecard splits the errors before and after CPI to show this.", Font(name=FONT, bold=True, color="C00000")),
        ("This is statistical analysis of past price behaviour, not financial advice and not a trade signal. Demo-feed prices can differ "
         "slightly from your live CFI / MT5 feed.", F_FX),
    ]
    for i, (t, f) in enumerate(lines, 1):
        c = ws.cell(row=i, column=1, value=t)
        c.font = f
        c.alignment = Alignment(wrap_text=True, vertical="top")


# ----------------------------------------------------------------- main
def build(cutoff, out):
    R = A.run(cutoff)
    sess, li = R["sess"], R["last_i"]
    # first bar after the daily break; Friday's close reopens on Sunday night
    next_start = sess.end[li] + pd.Timedelta(hours=2) + pd.Timedelta(days=2 if sess.end[li].weekday() == 4 else 0)
    bars_utc = [next_start + pd.Timedelta(hours=h) for h in range(A.BARS_PER_SESSION)]
    bar_end_sast = [(b + pd.Timedelta(hours=1)).tz_convert(None).to_pydatetime() + A.SAST for b in bars_utc]

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
        mtf_lines.append(f"{A.TF_LABEL[p]:>4}: score {score:+d}, {t['seq']}, last {e['kind'] if e else '-'} at "
                         f"{e['level']:.2f}" if e else f"{A.TF_LABEL[p]}: score {score:+d}, {t['seq']}")
    D = R["d1"].iloc[-1]
    mtf_lines.append(f"  1D (context): close {D.close:.2f} vs EMA20 {D.ema_fast:.2f} / EMA50 {D.ema_mid:.2f} / EMA200 "
                     f"{D.ema_slow:.2f}, RSI {D.rsi:.0f} - "
                     + ("the daily trend is still down, so the intraday strength is a bounce into daily resistance."
                        if D.ema_fast < D.ema_mid < D.ema_slow else "daily trend not aligned down."))
    fc = R["fc"]
    mtf_lines.append(f"Pattern: {fc['p_up']:.0%} of the 20 analogs closed up next day; mean path ends "
                     f"{fc['center'][-1] * R['atr_now']:+.2f} $ from the anchor; median analog range "
                     f"{fc['lo'] * R['atr_now']:+.0f} / {fc['hi'] * R['atr_now']:+.0f} $.")

    wb = Workbook()
    readme_sheet(wb, R, bt_summary, mtf_lines)
    settings_sheet(wb)
    for p in A.TF:
        t = tf[p]
        data_sheet(wb, p, t["df"], t["sh"], t["sl"], t["events"], t["gaps"])
    data_sheet(wb, "D_1", R["d1"])
    AN = analogs_sheet(wb, R)
    profile_sheet(wb, R, bar_end_sast)
    backtest_sheet(wb, R)
    cpi = "US CPI (Oct) at 15:30 SAST: expect a volatility spike the bands do not model."
    first, last = timeline_sheet(wb, R, AN, bars_utc, cpi)
    log_row = scorecard_sheet(wb, first, last)
    mtf_sheet(wb, R)
    li_sess = R["h1"][R["h1"].session == sess.session[li]]
    levels_sheet(wb, R, (li_sess.time_utc.iloc[0].tz_convert(None) + A.SAST).to_pydatetime(),
                 (li_sess.time_utc.iloc[-1].tz_convert(None) + A.SAST + pd.Timedelta(hours=1)).to_pydatetime())
    markers_sheet(wb, R)
    order = ["Read Me", "MTF Trend", "Forecast Timeline", "Scorecard", "Key Levels", "Markers", "Analogs",
             "Vol Profile", "Backtest", "Settings"] + [DATA_SHEET[p] for p in A.TF + ["D_1"]]
    wb._sheets = [wb[n] for n in order]
    wb.active = 2
    for ws in wb.worksheets:
        ws.sheet_view.showGridLines = ws.title.startswith("Data")
    wb.save(out)

    frozen = dict(symbol="XAUUSD", source="cTrader remote MCP data profile (demo feed, bid)",
                  cutoff_utc=str(R["cutoff"]), anchor=float(R["anchor"]), atr=float(R["atr_now"]),
                  bars_utc=[str(b) for b in bars_utc],
                  projected_move=[float(x * R["atr_now"]) for x in fc["center"]],
                  sigma=[float(x * R["atr_now"]) for x in R["sigma"]],
                  z50=0.674, z80=1.2816, p_up=float(fc["p_up"]),
                  proj_high=float(R["anchor"] + fc["hi"] * R["atr_now"]),
                  proj_low=float(R["anchor"] + fc["lo"] * R["atr_now"]),
                  timeline_first_row=first, timeline_last_row=last, log_first_row=log_row, chart_y=CHART_Y,
                  backtest=dict(n=len(bt), hit=float(hit), base_up=float(base), mae_ratio=float(ratio),
                                cov50=float(bt.cov50.mean()), cov80=float(bt.cov80.mean())),
                  analogs=[str((sess.end[p["d"]].tz_convert(None) + A.SAST).date()) for p in fc["picks"]])
    day = (bars_utc[0] + pd.Timedelta(hours=1)).tz_convert(None) + A.SAST
    jpath = Path(out).parent / f"forecast_{day:%Y-%m-%d}.json"
    jpath.write_text(json.dumps(frozen, indent=1))
    return R, frozen, jpath


if __name__ == "__main__":
    cutoff = sys.argv[1] if len(sys.argv) > 1 else "2026-11-09T22:00:00Z"
    out = sys.argv[2] if len(sys.argv) > 2 else str(HERE / "XAUUSD_MTF_Forecast_2026-11-10.xlsx")
    R, frozen, jpath = build(cutoff, out)
    print("wrote", out, "and", jpath)
    print(json.dumps({k: v for k, v in frozen.items() if k not in ("bars_utc", "projected_move", "sigma")}, indent=1))

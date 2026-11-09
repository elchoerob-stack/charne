# gold-forecast

XAUUSD multi-timeframe analysis (1m → 4h, daily for context) in Excel, plus a
next-day hourly projection that is frozen at the close and scored against the
actuals afterwards.

Data comes from the cTrader remote MCP **data** profile (`/data/mcp`): read-only,
so nothing here can place or change a trade. The bearer token is injected by the
session's network proxy and is never stored in this repo.

## Files

| File | What it is |
|---|---|
| `XAUUSD_MTF_Forecast_<day>.xlsx` | The workbook. Opens on **Dashboard**; **Targets** holds the tests, scenarios and level probabilities; **Guide** explains every sheet |
| `forecast_<day>.json` | The projection, frozen at the cutoff (never overwritten) |
| `targets_<day>.json` | The targets, locked straight after the forecast, with its SHA-256 |
| `layout_<day>.json` | Where `check.py` writes in the workbook |
| `data/XAUUSD_*.csv` | The bar snapshot the forecast was built from |
| `fetch.py` | Pull bars for every timeframe from cTrader |
| `analysis.py` | Indicators, swings, BOS/CHoCH, FVGs, levels, analog model, walk-forward backtest |
| `targets.py` | Level touch probabilities, scenario plan, tests T1-T8 with historical pass rates |
| `build_workbook.py` | Freezes forecast -> locks targets -> writes the workbook |
| `check.py` | Fills actual H1/M1 bars, times level touches and scenario steps, scores T1-T8, logs the day |
| `ROADMAP.md` | What it would take to make this platform grade |

## Run (one day)

```bash
python3 fetch.py                                   # after the 00:00 SAST close
python3 build_workbook.py 2026-11-09T22:00:00Z     # cutoff = that close, in UTC
python3 check.py                                   # any time during / after the forecast day
```

Recalculate after building (`recalc.py` from the xlsx skill, or open in Excel).
High-impact events for a day go in `EVENTS` in `build_workbook.py`.

## Method in one paragraph

Each past trading day gets a fingerprint at its close (shape of the last 24
hourly closes, last 5 daily moves, position in the 20-day range, stretch from
the 20-day EMA, day range — all in daily-ATR units). The 20 most similar days
are found; the average of what they did *the next day* is the centre line,
scaled to today's ATR. Bands are the typical travel by hour over the last 120
sessions × 0.674 (50%) or 1.28 (80%). The same procedure walked forward over 200
sessions gives the honest baseline in the Backtest sheet.

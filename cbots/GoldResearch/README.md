# Gold strategy research (9 November 2026)

**The question:** can any gold (XAUUSD) strategy reach a Profit Factor of 1.8 without
being curve-fitted? GoldGuard v3 managed 1.18 out of sample.

**Short answer:**

- **One family reaches it:** daily trend-following, meaning a 40-day breakout with an ATR trailing stop.
  - **PF 2.2 on 2016–2022** (in-sample) and **3.4 on 2023–2026** (out of sample).
  - cbot-gate, which splits by closing date and counts dollars, makes these 2.0 and 3.6.
  - The settings around it are profitable too, so it is not one lucky setting.
- **It trades about 5 times a year**, so the gate can't pass it yet (21 out-of-sample trades; it needs 100).
- **It holds for weeks.** Over 10 years at 0.5% risk it made **+13%**.
- **A high PF is not the same as high returns.** Nothing that trades often reached 1.8 once costs were in.

The cBot is in [`../GoldTrend/`](../GoldTrend/).

## Data

10 years of M1 **bid and ask** prices, Sep 2016 – Oct 2026 (3.6 million minutes). The
source is the same as GoldGuard's backtester ([Dypoi/XAUUSD_Dataset](https://github.com/Dypoi/XAUUSD_Dataset)),
with the 2016–2022 files added. Build it with `../GoldGuard/backtest/prepare_data.py ... 2016-09-01`.

The 10 years cover every kind of market gold has had:

| Period | What gold did |
|---|---|
| 2016–2018 | Range ($1,150–1,370) |
| 2019 – Aug 2020 | Bull (to $2,075) |
| Aug 2020 – 2022 | Bear and chop (to $1,620) |
| 2023–2026 | The big bull (above $4,000) |

## Method

- **Discovery (in-sample):** Sep 2016 – Dec 2022. All choices were made on this period only.
- **Out-of-sample:** Jan 2023 – Oct 2026. Run **once**, for finalists named before the run (see `run_oos.py`).
- **Variants counted: 59** (33 in stage 1, 26 in stage 2). The project total including GoldGuard is 262.
- **Fills:**
  - Buys fill at the ask, sells at the bid.
  - Stops and targets are checked on each M1 high and low; if both are hit in the same minute, the stop counts first.
  - Commission is $0.07/oz.
  - Swap is charged every night: longs pay the Fed funds rate plus 2% a year.
- **Clock:** the server clock is New York time + 7h (rollover at 17:00 New York), so daily bars match a normal broker's.
- **Scoring:** results are in R (multiples of the initial risk). Equity is compounded at 0.5% risk per trade.

## What the research said, and what the data said

| Idea | Where it came from | Claimed | 2016–2022 here |
|---|---|---|---|
| London breakout of the Asian range | [mql5 blog, 3.7-year test](https://www.mql5.com/en/blogs/post/777540): rules used exactly as published | PF 1.38 (2023–26) | **PF 1.00** (1,053 trades) |
| Same, only in the daily-trend direction | my addition | – | PF 1.12 (526 trades) |
| New York 08:30 opening-range breakout | vendor EA claims (PF 1.69–2.88 on 23–171 trades) | – | **PF 0.83–0.93** |
| Gold rises in Asian hours | [Wei, SSRN 2025](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=7257240) (2024–26 data only) | most of gold's return | **PF 0.78–0.81** after spread |
| ICT "Judas swing" / Power of Three | [18-year test](https://www.mql5.com/en/blogs/post/778873): no edge (48.9%, 50.0%) | – | not traded |
| Intraday momentum (morning predicts afternoon) | [Gao et al.](https://c.mql5.com/forextsd/forum/173/intraday_momentum_-_the_first_half-hour_return_predicts_the_last_half-hour_return.pdf), commodity follow-ups | works in some futures | **PF 0.95–0.96** |
| Mean reversion (RSI(2), Connors) | equity-index classic | – | **PF 0.68–1.15**: gold does not mean-revert on these timeframes |
| Daily trend-following (Donchian + ATR trail) | time-series momentum (Moskowitz–Ooi–Pedersen 2012; [gold market-timing survey](https://quantpedia.com/an-extensive-test-of-market-timing-strategies-in-the-gold-market/)) | – | **PF 1.32–5.35** with a 3 ATR trail; 0.99–1.70 with a channel exit |
| H4 trend-following, with the daily trend | same | – | PF 0.98–1.32 |
| **GoldGuard v3 (refined)** | this repo | PF 1.18 OOS (2025–26) | **PF 0.88** (483 trades, 26.6% DD) |

Full output: [`results/stage1_discovery.txt`](results/stage1_discovery.txt).

## Stage 2: is the trend result one lucky setting?

24 nearby settings were tried on the discovery period only:

- Breakout lengths of 20, 30, 40 and 55 days.
- Trailing stops of 2.5, 3 and 4 ATR.
- Both directions, and long only.

With a 2.5 or 3 ATR trail, **every one of the 16 settings was profitable**. PF ran from 1.32 to 5.35. The 4 ATR trail was weaker (0.90–2.33).
The finalist is the **middle** of that group, not the best of it: a **40-day breakout with a 3 ATR trail, both
directions**. Output: [`results/stage2_trend_plateau.txt`](results/stage2_trend_plateau.txt).

## Stage 3: out-of-sample, run once

| Finalist | Period | Trades | PF | Avg R | Win | Max DD |
|---|---|---|---|---|---|---|
| **A: 40-day breakout, 3 ATR trail, both sides** | 2016–2022 | 30 | 2.18 | +0.34 | 57% | 1.1% |
| | **2023–2026** | 20 | **3.37** | +0.77 | 50% | 1.1% |
| | All 10 years | 50 | **2.69** | +0.51 | 54% | 1.1% |
| B: same, long only | 2016–2022 / 2023–2026 | 17 / 13 | 4.27 / 7.60 | | | |
| C: London breakout + daily trend | 2016–2022 / 2023–2026 | 526 / 435 | 1.12 / 1.23 | +0.06 / +0.11 | | 7.6% |

- **A, year by year (trades / PF):** 2016 1 winner · 2017 5/0.32 · 2018 4/7.57 · 2019 4/1.99 · 2020 5/16.6 · 2021 4/0.58 · 2022 7/1.79 · 2023 6/0.62 · 2024 4/3.09 · 2025 5/15.0 · 2026 5/3.13.
  - **Losing years: 2017, 2021, 2023.** Gold went sideways in all three.
- **Cost stress** (swap markup doubled, commission doubled): A's PF falls to 1.92 in-sample and 3.21 out of sample.
- **The whole stage-2 group, out of sample:** median PF 3.62, lowest 1.71. 92% of settings were at 1.8 or above.

Output: [`results/stage3_out_of_sample.txt`](results/stage3_out_of_sample.txt).

### cbot-gate on A: **INCONCLUSIVE** (too few trades)

| Check | Value | Needs |
|---|---|---|
| Out-of-sample trades | **21** | ≥ 100 |
| OOS Profit Factor | 3.57 | ≥ 1.30 |
| PF retention | 1.78 | ≥ 0.70 |
| Walk-forward efficiency | 3.10 | ≥ 0.50 |
| Bootstrap P(PF < 1) | 3.3% | ≤ 10% |
| PF without best 2 trades | 1.66 | ≥ 1.00 |
| PF with $5 extra cost per trade | 2.99 | ≥ 1.10 |
| Max DD / Monte Carlo 95th pct DD | 1.1% / 2.0% | ≤ 20% / 30% |

Every check passes except the trade count. The t-statistic of the mean trade is only 1.69:
the edge is likely, not proven.

```
| 2026-11-09 | GoldTrend XAUUSD D1 | A: 40d breakout, 2.5 ATR stop, 3 ATR chandelier, both sides | INCONCLUSIVE | OOS PF 3.57 | 21 trades | WFE 3.10 | variants tested: 59 |
| 2026-11-09 | London breakout + D1 EMA100 | published rules + daily trend filter (reference C) | FAIL | OOS PF 1.23 | 435 trades | WFE 3.32 | variants tested: 59 |
| 2026-11-09 | GoldGuard XAUUSD m15 | v3 refined, rerun on 2016-2022 | FAIL | PF 0.88 | 483 trades | - | variants tested: 203 |
```

Reference C (the London breakout with the trend filter) **fails** the gate: OOS PF 1.23, below 1.30, and 0.94 without its best 22 trades.
Reports: [`results/gate_report_trend_A.md`](results/gate_report_trend_A.md), [`results/gate_report_london_C.md`](results/gate_report_london_C.md).

## Excluding the COVID years (2020–2021)

Added at your request. Trades **opened** between 1 Jan 2020 and 31 Dec 2021 are left out of the scoring.
The strategies still run through those years, so their indicators and open positions are unaffected.
A narrower window, Mar 2020 – Jun 2021 (the acute phase), was checked as well.
The out-of-sample period (2023–2026) has no COVID years in it, so it doesn't change.
Output: [`results/stage4_ex_covid.txt`](results/stage4_ex_covid.txt).

| Strategy | 2016–22 all | 2016–22 ex 2020–21 | Ex Mar 20 – Jun 21 | Inside 2020–21 |
|---|---|---|---|---|
| **A: 40-day breakout, 3 ATR trail** | 30 trades, PF 2.18 | 21 trades, **PF 1.93** | 25 trades, PF 1.91 | 9 trades, PF 3.42 |
| Trend group (16 settings), median | – | **PF 2.15** (lowest 1.33) | – | – |
| C: London breakout + daily trend | 526, PF 1.12 | 307, PF 1.15 | 363, PF 1.11 | 219, PF 1.07 |
| H4 trend, long only, n55 | 90, PF 1.32 | 57, PF 1.40 | 73, PF 1.25 | 33, PF 1.20 |
| **GoldGuard v3 (refined)** | 483, PF 0.88 | 258, **PF 1.02** | 322, PF 0.98 | 225, PF 0.72 |
| NY opening range, Asian drift, mean reversion, momentum | 0.68–0.96 | 0.68–1.01 | | |

What changes:

- **The trend bot gets slightly worse without COVID, not better.**
  - 2020 was one of its best years: gold trended hard to $2,075.
  - It still clears 1.8 in-sample (1.93), and 2.61 over all 10 years.
  - cbot-gate is still INCONCLUSIVE on trade count (21 OOS).
  - Its in-sample t-statistic falls to 0.95, so on fewer trades the evidence is thinner.
  - Gate report: [`results/gate_report_trend_A_ex_covid.md`](results/gate_report_trend_A_ex_covid.md).
- **GoldGuard v3 was hurt by COVID** (PF 0.72 inside the window). Without it, it breaks even (PF 1.02). It still fails.
- **Nothing new reaches 1.8.** The ranking of strategies is the same with or without those years.

```
| 2026-11-09 | GoldTrend XAUUSD D1 | A, trades opened 2020-2021 excluded | INCONCLUSIVE | OOS PF 3.57 | 21 trades | WFE 5.18 | variants tested: 59 |
```

## High-frequency round (stage 5): many trades, PF 1.2–1.8

You asked for many trades with PF between 1.2 and 1.8. I fixed 26 variants and the selection rule in
`run_hf.py` before running anything:

- **Variants:**
  - The London breakout with each trend filter (EMA50, EMA100, SMA200), each exit (published, 1.5R, trailing runner), and both order types (OCO, or only the with-trend order).
  - A range-compression filter.
  - Previous-day high/low breakouts.
  - H1 Donchian breakouts with the daily trend.
- **Rule:** among variants with at least 60 trades a year and PF ≥ 1.10 on 2016–22, take the two best on 2016–22 without 2020–21. Then run only those two on 2023–26, once.

| Result | |
|---|---|
| Variants meeting the rule | 2 of 26 |
| Selected | London breakout + EMA100, published exits (the same as reference C) and the 1.5R-target version |
| Best one, 2016–22 / ex 2020–21 / **2023–26** | PF 1.12 / 1.15 / **1.23**, 83–114 trades a year |
| Best one, 10 years ex 2020–21 | 742 trades, **PF 1.20**, +39% at 0.5% risk, max DD 7.6% |
| 1.5R-target version, 2023–26 | PF 1.09 |
| Everything else | PF 0.86–1.08 (previous-day breakouts 0.97–1.00, H1 Donchian 0.93–1.08, one-sided orders worse than OCO) |

No refinement beat the published rules plus the trend filter. It stays the only high-frequency gold
strategy here with an edge, and it sits at the bottom of the 1.2–1.8 band. cbot-gate still says
**FAIL** (OOS PF 1.23 < 1.30, PF 0.94 without its best 22 trades).
Output: [`results/stage5_high_frequency.txt`](results/stage5_high_frequency.txt).

```
| 2026-11-09 | London breakout + D1 EMA100 | stage 5 re-selection (published exits, OCO) | FAIL | OOS PF 1.23 | 435 trades | WFE 3.32 | variants tested: 85 |
```

## Read this before you get excited

1. **PF is not return.**
   - At 0.5% risk, A turned $10,000 into $11,347 over 10 years (+1.3% a year), because it trades ~5 times a year.
   - The London breakout (PF 1.17) made more money (+44%) because it trades ~95 times a year.
   - Higher risk scales the returns and the drawdowns together. Your risk rules decide that, not the backtest.
2. **It needs a big account.**
   - The stop is 2.5 daily ATRs: $32/oz in 2017, but **$277/oz in 2026**.
   - The broker's minimum is 0.01 lot = 1 oz. At 0.5% risk that 1 oz needs **about $55,000** today ($26,000 at 2025 volatility).
   - On a smaller account the bot skips every trade and says why.
3. **It holds over weekends** (median 15 days, longest 82). That breaks GoldGuard's Friday-flat rule on purpose. Weekend gaps can fill a stop worse than planned. Swap is modelled but your broker's rate will differ.
4. **2023–2026 was a historic gold bull run.** The out-of-sample PF of 3.4 is flattered by it. The long-only version (PF 7.6) is a bet on that continuing, so I didn't pick it.
   - The honest number to plan on is the 2016–2022 PF of about 2.
   - Expect losing years like 2017, 2021 and 2023.
5. **5 trades a year means a demo forward test takes years** to say anything statistically. The backtest is the evidence you have.
6. **This is a simulator, not cTrader.** Re-run it in cTrader (tick data, starting balance $100,000) and compare it with stage 3 before trusting it.

## Reproduce

```bash
# data: see ../GoldGuard/backtest/README.md, but start at 2016-09-01
python3 prepare_data.py XAUUSD_Dataset Gold-XAUUSD-1m-2020-2025-Historical-Data xau_m1_10y.csv 2016-09-01
python3 run_is.py  xau_m1_10y.csv     # stage 1: 33 variants, discovery only
python3 run_is2.py xau_m1_10y.csv     # stage 2: trend neighbourhood, discovery only
python3 run_oos.py xau_m1_10y.csv     # stage 3: finalists, out-of-sample, once
python3 export_logs.py xau_m1_10y.csv # trade logs for cbot-gate + account-size table
python3 run_excl.py xau_m1_10y.csv    # every variant re-scored without trades opened in 2020-2021
python3 run_hf.py xau_m1_10y.csv      # stage 5: high-frequency round, selection rule fixed in code
```

Needs Python 3 with numpy and pandas. The first load caches the data as `.npz` (≈250 MB).

## Files

| File | What |
|---|---|
| `core.py` | Data loading (server clock), bars, indicators, the M1 bid/ask trade simulator, statistics |
| `families.py` | Every strategy family tested |
| `run_is.py`, `run_is2.py`, `run_oos.py` | The three stages, each with its variants listed in code |
| `run_excl.py` | The COVID-years exclusion (stage 4) |
| `run_hf.py` | The high-frequency round (stage 5) |
| `export_logs.py` | Trade logs in cbot-gate format and the account-size table |
| `export_lb.py` | The London-breakout trades for the GoldBreakout cBot's replay test |
| `export_d1.py` | Daily bars and signals for the cBot's parity test |
| `results/` | Raw output of every stage, trade logs for A and C (cbot-gate format), both gate reports, the account-size table |

# GoldGuard v3 backtester

A simulator that replays the cBot on 1-minute gold data with real bid and ask prices.
It is not cTrader's own backtester. It compiles the bot's `HarmonicMath` and
`ExitMath` classes straight from `GoldGuard_XAUUSD_v3.cs`, so the pattern and exit
logic is the bot's own code. Entry signals, gates and risk rules are a line-for-line
port of the robot. Its defaults match the bot's defaults.

## Data

| Period | Source | Prices |
|---|---|---|
| Sep 2022 – 1 Sep 2026 | [Dypoi/XAUUSD_Dataset](https://github.com/Dypoi/XAUUSD_Dataset) | M1 **bid and ask**, UTC, continuous apart from real market closures |
| 2 Sep – 28 Oct 2026 | [parshant65-lang/Gold-XAUUSD-1m-2020-2025-Historical-Data](https://github.com/parshant65-lang/Gold-XAUUSD-1m-2020-2025-Historical-Data) | M1 mid. Spread added from the first source's median for the same UTC hour |

- The second source has gaps in 2025: 22–31 March, 5–30 April, 14–30 June, and 12 July – 17 September. That's why it is only used after the first source ends.
- On shared minutes in June–August 2026 the two sources agree to a median of $0.07, with no time offset.
- Median spread in the first source: $0.33 in 2023, $0.38 in 2024, $0.58 in 2025, $0.69 in 2026.

## How it fills orders

- Bars are built from **bid** prices, as cTrader charts are.
- Entries are at the next M15 bar's open: buys at the **ask**, sells at the **bid**.
- Stops and take-profits are checked against each M1 bar's high and low. A gap through a level fills at the bar's open. If a stop and a take-profit both fall inside one minute, the **stop is taken first**.
- Break-even, the trail and the runner update on each M1 **close**. cTrader updates on every tick, so live trailing can only be tighter.
- Commission is $0.07 per oz per round trip (about $7 per 100-oz lot). **Swap is not modelled.** Overnight runners would pay it.
- Positions are sized at 0.5% of equity in 1-oz steps, from a $10,000 start. The halts, the Friday flat and the other risk constants are identical to the bot's.

## Reproduce

```bash
# 1. data (about 300 MB): clone both repos into an empty folder
git clone --depth 1 https://github.com/Dypoi/XAUUSD_Dataset
git clone --depth 1 https://github.com/parshant65-lang/Gold-XAUUSD-1m-2020-2025-Historical-Data
python3 prepare_data.py XAUUSD_Dataset Gold-XAUUSD-1m-2020-2025-Historical-Data xau_m1.csv 2022-09-01

# 2. one run: in-sample / out-of-sample split, per-setup stats, trade log for cbot-gate
dotnet run -c Release -- run data=xau_m1.csv from=2023-01-01 to=2026-10-29 split=2025-07-01 out=trades.csv

# 3. a grid on the in-sample period only (trend | harmonic | exit | filters | daily)
dotnet run -c Release -- grid trend data=xau_m1.csv from=2023-01-01 to=2025-07-01

# any bot setting can be overridden: Name=value, e.g. RunnerEnabled=false SessionStartHour=7
```

## November 2026 result

The full write-up is in `../README.md` under "Backtest". The trade log and the
cbot-gate report are in `results/`.

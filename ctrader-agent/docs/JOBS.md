# Job file schema

Drop a `.json` file matching one of the shapes below into `jobs/pending/`.
The agent claims the oldest pending file on each poll, processes it, and
moves it to `jobs/done/` or `jobs/failed/`.

## Common fields

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | string | recommended | Used as the folder name under `reports/`. Auto-generated if omitted. |
| `type` | `"Backtest"` \| `"Optimization"` | yes | |
| `botName` | string | yes | Must exactly match the cBot's display name in cTrader Automate's bot list. |
| `symbol` | string | yes | e.g. `EURUSD` |
| `timeframe` | string | yes | Must match a value in cTrader's Period dropdown, e.g. `M1`, `M15`, `H1`, `D1`. |
| `fromDate` / `toDate` | `YYYY-MM-DD` | yes | Backtest/optimization date range. |
| `initialBalance` | number | no (default 10000) | |
| `spreadModel` | string | no (default `Real`) | `Real`, `Fixed`, or `Zero`, matching cTrader's spread dropdown. |
| `commission` | number | no (default 0) | |
| `reportName` | string | no | Cosmetic label only; reports are keyed by `id`. |

## Backtest-only

```json
{
  "type": "Backtest",
  "parameters": { "StopLossPips": 20, "TakeProfitPips": 40 }
}
```

`parameters` is a flat map of cBot input name → fixed value for this single run.

## Optimization-only

```json
{
  "type": "Optimization",
  "optimizationCriteria": "NetProfit",
  "parameterRanges": [
    { "name": "StopLossPips", "min": 10, "max": 50, "step": 5 }
  ],
  "topN": 10
}
```

- `parameterRanges`: one entry per cBot input you want the optimizer to
  sweep. Any input *not* listed here keeps whatever value is currently set
  in cTrader Automate for that cBot — set it manually in the UI beforehand
  if it needs to differ from the default.
- `optimizationCriteria`: must match an entry in cTrader's "Optimization
  Criteria" dropdown (e.g. `NetProfit`, `ProfitFactor`, `SharpeRatio`,
  `Equity`, `MaxDrawdown` — the exact list depends on your cTrader version;
  check via `--inspect`).
- `topN`: how many rows of the optimization results grid to copy into the
  summary report, ranked as cTrader itself ranks them.

## Output

For job id `abc123`, results land in `reports/abc123/`:

- `summary.md` — human-readable summary (and top-N table for optimizations).
- `result.json` — the same data, structured, for scripting against.
- whatever cTrader's own export produced (once export is calibrated — see
  `docs/CALIBRATION.md`).

Full validation errors (missing fields, bad ranges) are raised before any
UI automation happens, and the job goes straight to `jobs/failed/` with the
reason logged.

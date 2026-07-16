# Job file schema

Drop a `.json` file matching one of the shapes below into `jobs/pending/`.
The agent claims the oldest pending file on each poll, processes it, and
moves it to `jobs/done/` or `jobs/failed/`.

## How symbol & timeframe work (important)

In cTrader 5.7 a **backtest runs on whatever symbol + timeframe the target
cBot instance's chart is set to** — there is no symbol/timeframe field on the
backtest panel itself. So a Backtest job points at an **existing instance**
(`instanceName`) that you've already set up on the symbol+timeframe you want,
and the agent opens that instance and tests it as-is. It does **not** switch
charts around (deliberately — that keeps it well away from your live
instances).

For an **Optimization** job, cTrader's Optimisation "Parameters" dialog *does*
let you choose timeframe(s), so `optimizationTimeframes` is applied there.

The `symbol` / `timeframe` fields in the job are informational — recorded in
the report so you know what was tested.

## Common fields

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | string | recommended | Folder name under `reports/`. Auto-generated if omitted. |
| `type` | `"Backtest"` \| `"Optimization"` | yes | |
| `instanceName` | string | yes | Exact display name of the cBot instance in the Algo → cBots list. |
| `symbol` | string | no | Informational (what the instance is on), recorded in the report. |
| `timeframe` | string | no | Informational for backtests. For optimization use `optimizationTimeframes`. |
| `fromDate` / `toDate` | `YYYY-MM-DD` | yes | Test date range (written into cTrader as dd/MM/yyyy for you). |
| `startingCapital` | number | no (default 10000) | Backtesting settings → Starting capital. |
| `commission` | number | no (default 30) | Only used when `applyCommissionAutomatically` is false. |
| `applyCommissionAutomatically` | bool | no (default true) | Matches the checkbox in Backtesting settings. |
| `dataMode` | string | no | Matches the Data dropdown, e.g. `"Tick data from server (accurate)"`. |
| `reportName` | string | no | Cosmetic label; reports are keyed by `id`. |

## Backtest-only

```json
{
  "type": "Backtest",
  "instanceName": "EurusdWaveCapture",
  "parameters": { "EMA Fast": 21, "EMA Slow": 42, "ADX Period": 47 }
}
```

`parameters` is a flat map of **parameter label → fixed value**, using the
exact labels shown in the cBot's Parameters panel (e.g. `EMA Fast`,
`EMA Trend`, `ADX Period`). Any parameter you don't list keeps whatever value
the instance currently has. Omit `parameters` entirely to backtest the
instance exactly as it's configured.

## Optimization-only

```json
{
  "type": "Optimization",
  "instanceName": "EurusdWaveCapture",
  "optimizationTimeframes": ["h1"],
  "useGeneticAlgorithm": true,
  "optimizationCriteria": "Net profit",
  "topN": 10,
  "parameterRanges": [
    { "name": "EMA Fast",  "min": 5,  "max": 50,  "step": 1 },
    { "name": "Use H4 Bias Confirmation", "values": ["Yes", "No"] }
  ]
}
```

- `parameterRanges`: one entry per cBot parameter to sweep, using the exact
  label from the Parameters panel.
  - **Numeric** parameters use `min` / `max` / `step`.
  - **Boolean/enum** parameters use `values` (a list, e.g. `["Yes","No"]`) —
    this maps to cTrader's value-list field for that parameter.
  - The agent ticks the "include in optimisation" checkbox for each listed
    parameter automatically.
- `optimizationTimeframes`: timeframes to test, set in the Optimisation
  Parameters dialog's Timeframe multi-select (e.g. `["m15","h1"]`).
- `useGeneticAlgorithm`: `true` presses cTrader's **GA** button (samples the
  space — much faster for large grids); `false` runs the full grid.
- `optimizationCriteria`: which **results column** to rank passes by, matching
  a column header exactly (e.g. `"Net profit"`, `"Profit factor"`,
  `"Fitness"`). The agent reads the whole results grid, sorts by this column
  descending, and keeps the top `topN`.

## Output

For job id `abc123`, results land in `reports/abc123/`:

- `summary.md` — human-readable summary (and top-N table for optimizations).
- `result.json` — the same data, structured, for scripting against.

Validation errors (missing fields, bad ranges) are raised before any UI
automation happens, and the job goes straight to `jobs/failed/` with the
reason logged.

# Getting a clean trade list

The gate needs one row for each closed trade: the closing time and the net
profit after commission and swap. Three ways to get that, from most to least
reliable.

## 1. Let the cBot write its own log (recommended)

This works the same way in backtests, on demo and on live, so the gate always
reads the same format. Add the code below to the cBot. It writes a CSV to
Documents when the run ends and skips optimiser passes, so a sweep doesn't
leave thousands of files behind.

```csharp
using System;
using System.Globalization;
using System.IO;
using System.Text;
using cAlgo.API;

// File access needs FullAccess. Keep everything else in the bot unchanged.
[Robot(AccessRights = AccessRights.FullAccess)]
public class YourBot : Robot
{
    // Use this same label on every ExecuteMarketOrder / Place*Order call, so a live
    // account running several bots only logs this one's trades.
    private const string BotLabel = "GSB15";

    protected override void OnStop()
    {
        if (RunningMode == RunningMode.Optimization) return;

        var inv = CultureInfo.InvariantCulture;   // dot decimals whatever the PC locale
        var sb = new StringBuilder("Closing Time,Entry Time,Symbol,Direction,Volume,Pips,Gross,Commissions,Swap,Net Profit,Balance\n");
        foreach (var t in History)
        {
            if (t.Label != BotLabel) continue;
            sb.AppendLine(string.Join(",",
                t.ClosingTime.ToString("yyyy-MM-dd HH:mm:ss", inv),
                t.EntryTime.ToString("yyyy-MM-dd HH:mm:ss", inv),
                t.SymbolName, t.TradeType, t.VolumeInUnits.ToString(inv),
                t.Pips.ToString(inv), t.GrossProfit.ToString(inv),
                t.Commissions.ToString(inv), t.Swap.ToString(inv),
                t.NetProfit.ToString(inv), t.Balance.ToString(inv)));
        }
        var mode = RunningMode == RunningMode.RealTime ? "live" : "backtest";
        var name = $"{GetType().Name}_{SymbolName}_{TimeFrame}_{mode}_{DateTime.Now:yyyyMMdd_HHmmss}.csv";
        var path = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), "cBotLogs", name);
        Directory.CreateDirectory(Path.GetDirectoryName(path));
        File.WriteAllText(path, sb.ToString());
        Print("Trade log written: " + path);
    }
}
```

Property names are from the cAlgo `HistoricalTrade` API. If your cTrader
version names one differently, the compiler will say which; rename it and keep
the column headers as they are.

To run a walk-forward, use cTrader's optimiser on each in-sample window. Then
backtest the chosen settings on the in-sample window and on the following
out-of-sample window, keeping one log file for each, and pass them as
`--is`/`--oos` pairs in order.

## 2. cTrader's own history export

The backtest's History tab can be copied or exported. Any version with a
closing-time column and a Net column loads as it is. The gate also handles `;`
delimiters and comma decimals when Windows uses South African regional
settings. If the profit column has an unusual name, pass `--profit-col "Net €"`.

## 3. MT5 report

From the Strategy Tester or account history, save the Deals table as CSV,
or open the HTML report in Excel and save that as CSV. The gate drops
`balance` rows and `in` deals, and keeps the `out` deals that carry the profit.
If commission and swap are in separate columns and the profit column is
gross, pass `--profit-col Profit`. The report says which column it used.

## Headline numbers only

If all he has is the optimiser's summary row, write `summary.json` (format in
SKILL.md) and run with `--summary`. The decay and Profit Factor checks still
run. Monte Carlo, significance and outlier checks need the trade list.

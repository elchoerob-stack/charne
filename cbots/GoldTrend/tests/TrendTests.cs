// GoldTrend D1 tests. Exit code 0 when all pass.
//
//   cd cbots/GoldTrend/tests && dotnet run

using System;
using System.Globalization;
using System.IO;
using System.Linq;
using cAlgo.Robots;

internal static class Program
{
    private static int _fail, _pass;

    private static void Check(string name, bool ok, string detail = "")
    {
        if (ok) _pass++;
        else { _fail++; Console.WriteLine("FAIL  " + name + (detail.Length > 0 ? "  " + detail : "")); }
    }

    private static void Near(string name, double got, double want)
    {
        Check(name, Math.Abs(got - want) < 1e-9, $"got {got}, want {want}");
    }

    private static int Main()
    {
        // ---- Channel / Signal on a hand-made series ---------------------------------
        double[] h = { 10, 12, 11, 13, 12, 12.5 };
        double[] l = { 9, 10, 10, 11, 11, 9.5 };
        double[] c = { 9.5, 11, 10.5, 12, 11.5, 13.5 };
        Near("channel max excludes the current bar", TrendMath.Channel(i => h[i], 5, 3, true), 13);
        Near("channel min excludes the current bar", TrendMath.Channel(i => l[i], 5, 3, false), 10);
        Check("close above prior highs -> buy", TrendMath.Signal(i => h[i], i => l[i], i => c[i], 5, 3) == 1);
        Check("close equal to the high is not a breakout", TrendMath.Signal(i => h[i], i => l[i], i => new[] { 0, 0, 0, 0, 0, 13.0 }[i], 5, 3) == 0);
        Check("close below prior lows -> sell", TrendMath.Signal(i => h[i], i => l[i], i => new[] { 0, 0, 0, 0, 0, 9.9 }[i], 5, 3) == -1);
        Check("inside the channel -> nothing", TrendMath.Signal(i => h[i], i => l[i], i => c[i], 4, 3) == 0);
        Check("not enough history -> nothing", TrendMath.Signal(i => h[i], i => l[i], i => c[i], 2, 3) == 0);

        // ---- Chandelier trail --------------------------------------------------------
        Near("long: initial stop holds until the trail passes it", TrendMath.Trail(true, 97.5, 100.2, 1.0, 3.0), 97.5);
        Near("long: trail = best close - k ATR", TrendMath.Trail(true, 97.5, 101.0, 1.0, 3.0), 98.0);
        Near("long: never loosens", TrendMath.Trail(true, 98.5, 101.0, 1.0, 3.0), 98.5);
        Near("short: trail = best close + k ATR", TrendMath.Trail(false, 102.5, 99.0, 1.0, 3.0), 102.0);
        Near("short: never loosens", TrendMath.Trail(false, 101.5, 99.0, 1.0, 3.0), 101.5);

        // ---- Parity with the research harness (40-day breakout, every day 2016-2026) --
        string path = Path.Combine(AppContext.BaseDirectory, "../../../d1_bars_signals.csv");
        if (!File.Exists(path)) path = "d1_bars_signals.csv";
        var rows = File.ReadAllLines(path).Skip(1).Select(s => s.Split(',')).ToArray();
        double P(string[] r, int k) => double.Parse(r[k], CultureInfo.InvariantCulture);
        double[] H = rows.Select(r => P(r, 2)).ToArray(), L = rows.Select(r => P(r, 3)).ToArray(), C = rows.Select(r => P(r, 4)).ToArray();
        int[] want = rows.Select(r => int.Parse(r[5])).ToArray();
        int mismatches = 0, signals = 0;
        for (int k = 0; k < rows.Length; k++)
        {
            int got = TrendMath.Signal(i => H[i], i => L[i], i => C[i], k, 40);
            if (got != 0) signals++;
            if (got != want[k])
            {
                if (++mismatches <= 5) Console.WriteLine($"  parity mismatch on {rows[k][0]}: bot {got}, harness {want[k]}");
            }
        }
        Check($"bot signal == harness signal on all {rows.Length} days ({signals} breakouts)", mismatches == 0, $"{mismatches} mismatches");

        Console.WriteLine($"{_pass} passed, {_fail} failed");
        return _fail == 0 ? 0 : 1;
    }
}

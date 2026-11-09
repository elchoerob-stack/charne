// GoldBreakout tests. Exit code 0 when all pass.
//
//   cd cbots/GoldBreakout/tests && dotnet run                          unit tests
//   cd cbots/GoldBreakout/tests && dotnet run -c Release -- xau_m1_10y.csv   + 10-year replay
//
// The replay walks the M1 bid/ask file day by day on the broker clock (New York + 7h),
// makes each day's decision with the cBot's own BreakoutMath, and checks direction, entry,
// stop and target against harness_trades.csv (exported by GoldResearch/export_lb.py).

using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using cAlgo.Robots;

internal static class Program
{
    private static int _fail, _pass;
    private static readonly CultureInfo Inv = CultureInfo.InvariantCulture;

    private static void Check(string name, bool ok, string detail = "")
    {
        if (ok) _pass++;
        else { _fail++; Console.WriteLine("FAIL  " + name + (detail.Length > 0 ? "  " + detail : "")); }
    }

    private static void Near(string name, double got, double want, double tol = 1e-9)
    {
        Check(name, Math.Abs(got - want) <= tol, $"got {got}, want {want}");
    }

    private static int Main(string[] args)
    {
        Unit();
        if (args.Length > 0) Replay(args[0]);
        else Console.WriteLine("(10-year replay skipped: pass the xau_m1_10y.csv path to run it)");
        Console.WriteLine($"{_pass} passed, {_fail} failed");
        return _fail == 0 ? 0 : 1;
    }

    private static void Unit()
    {
        // Range filter: 0.30%-1.60% of price
        var narrow = BreakoutMath.Plan(2005, 2000, 2004, 0.30, 1.60, 0.01);
        Check("0.25% range is too narrow", !narrow.Valid && narrow.Why == "range too narrow");
        var wide = BreakoutMath.Plan(2040, 2000, 2004, 0.30, 1.60, 0.01);
        Check("2% range is too wide", !wide.Valid && wide.Why == "range too wide");
        var p = BreakoutMath.Plan(2010, 2000, 2004, 0.30, 1.60, 0.01);
        Check("0.5% range is traded", p.Valid);
        Near("buy level = high + 0.01% of price", p.BuyLevel, 2010 + 0.2004);
        Near("sell level = low - 0.01% of price", p.SellLevel, 2000 - 0.2004);

        // Stop at the far side, target 2.5R
        BreakoutMath.Levels(true, 2010.2, p, 0.60, 2.5, out double st, out double tg, out double dist);
        Near("buy stop = range low", st, 2000);
        Near("buy risk", dist, 10.2, 1e-9);
        Near("buy target = entry + 2.5R", tg, 2010.2 + 25.5, 1e-9);
        BreakoutMath.Levels(false, 1999.8, p, 0.60, 2.5, out st, out tg, out dist);
        Near("sell stop = range high", st, 2010);
        Near("sell target = entry - 2.5R", tg, 1999.8 - 25.5, 1e-9);

        // Stop cap: 0.6% of entry
        var big = BreakoutMath.Plan(2030, 2000, 2004, 0.30, 1.60, 0.01);
        BreakoutMath.Levels(true, 2030.2, big, 0.60, 2.5, out st, out tg, out dist);
        Near("wide range: stop capped at 0.6% of entry", dist, 0.006 * 2030.2, 1e-9);

        // Break-even at 1.5R, never loosens
        Near("no break-even below 1.5R", BreakoutMath.BreakEven(true, 100, 2, 102.9, 1.5, 98), 98);
        Near("break-even at 1.5R (buy)", BreakoutMath.BreakEven(true, 100, 2, 103, 1.5, 98), 100);
        Near("break-even at 1.5R (sell)", BreakoutMath.BreakEven(false, 100, 2, 97, 1.5, 102), 100);
        Near("break-even never loosens", BreakoutMath.BreakEven(true, 100, 2, 105, 1.5, 101), 101);

        // Trend side and EMA step (pandas ewm span=n, adjust=False)
        Check("close above EMA = buys only", BreakoutMath.TrendSide(101, 100) == 1);
        Check("close below EMA = sells only", BreakoutMath.TrendSide(99, 100) == -1);
        Near("EMA step", BreakoutMath.EmaNext(100, 110, 100), 100 + 2.0 / 101 * 10);

        // Broker clock: New York + 7h, so 17:00 New York is 00:00 of the next broker day
        var b = BreakoutMath.BrokerClock(new DateTime(2026, 3, 9, 17, 0, 0), 7);
        Check("17:00 New York = 00:00 broker clock next day", b == new DateTime(2026, 3, 10, 0, 0, 0));
    }

    private static void Replay(string path)
    {
        var tz = TimeZoneInfo.FindSystemTimeZoneById("America/New_York");
        var day = new List<DateTime>();
        var mod = new List<int>();
        var bo = new List<double>(); var bh = new List<double>(); var bl = new List<double>(); var bc = new List<double>();
        var ao = new List<double>(); var ah = new List<double>();
        foreach (var line in File.ReadLines(path))
        {
            var f = line.Split(',');
            long m = long.Parse(f[0], Inv);
            var ny = TimeZoneInfo.ConvertTimeFromUtc(DateTime.UnixEpoch.AddMinutes(m), tz);
            var br = BreakoutMath.BrokerClock(ny, 7);
            day.Add(br.Date); mod.Add(br.Hour * 60 + br.Minute);
            bo.Add(double.Parse(f[1], Inv)); bh.Add(double.Parse(f[2], Inv)); bl.Add(double.Parse(f[3], Inv)); bc.Add(double.Parse(f[4], Inv));
            ao.Add(double.Parse(f[5], Inv)); ah.Add(double.Parse(f[6], Inv));
        }
        int n = day.Count;
        var starts = new List<int> { 0 };
        for (int i = 1; i < n; i++) if (day[i] != day[i - 1]) starts.Add(i);
        starts.Add(n);

        var got = new Dictionary<string, (int dir, double entry, double stop, double target)>();
        double ema = 0, prevClose = 0;
        for (int k = 0; k + 1 < starts.Count; k++)
        {
            int f0 = starts[k], f1 = starts[k + 1];
            DateTime d = day[f0];
            if (k >= 1 && d.DayOfWeek != DayOfWeek.Saturday && d.DayOfWeek != DayOfWeek.Sunday)
            {
                int At(int minute) { int i = f0; while (i < f1 && mod[i] < minute) i++; return i; }
                int r0 = At(180), r1 = At(480), e1 = At(1260);
                if (r1 - r0 >= 180 && e1 > r1)
                {
                    double hi = double.MinValue, lo = double.MaxValue;
                    for (int i = r0; i < r1; i++) { hi = Math.Max(hi, bh[i]); lo = Math.Min(lo, bl[i]); }
                    var plan = BreakoutMath.Plan(hi, lo, bc[r1 - 1], 0.30, 1.60, 0.01);
                    if (plan.Valid)
                    {
                        int ib = -1, isell = -1;
                        for (int i = r1; i < e1 && (ib < 0 || isell < 0); i++)
                        {
                            if (ib < 0 && ah[i] >= plan.BuyLevel) ib = i;
                            if (isell < 0 && bl[i] <= plan.SellLevel) isell = i;
                        }
                        bool any = ib >= 0 || isell >= 0, tie = ib >= 0 && ib == isell;
                        if (any && !tie)
                        {
                            bool buy = isell < 0 || (ib >= 0 && ib < isell);
                            int i0 = buy ? ib : isell;
                            if (BreakoutMath.TrendSide(prevClose, ema) == (buy ? 1 : -1))
                            {
                                double entry = buy ? Math.Max(ao[i0], plan.BuyLevel) : Math.Min(bo[i0], plan.SellLevel);
                                BreakoutMath.Levels(buy, entry, plan, 0.60, 2.5, out double st, out double tg, out _);
                                got[d.ToString("yyyy-MM-dd", Inv)] = (buy ? 1 : -1, entry, st, tg);
                            }
                        }
                    }
                }
            }
            double close = bc[f1 - 1];
            ema = k == 0 ? close : BreakoutMath.EmaNext(ema, close, 100);
            prevClose = close;
        }

        string fx = Path.Combine(AppContext.BaseDirectory, "../../../harness_trades.csv");
        if (!File.Exists(fx)) fx = "harness_trades.csv";
        var want = File.ReadAllLines(fx).Skip(1).Select(s => s.Split(',')).ToDictionary(
            r => r[0], r => (int.Parse(r[1], Inv), double.Parse(r[2], Inv), double.Parse(r[3], Inv), double.Parse(r[4], Inv)));
        int missing = want.Keys.Count(k => !got.ContainsKey(k)), extra = got.Keys.Count(k => !want.ContainsKey(k)), diff = 0;
        foreach (var kv in want)
        {
            if (!got.TryGetValue(kv.Key, out var g)) { if (missing <= 5) Console.WriteLine($"  harness trade not in replay: {kv.Key}"); continue; }
            var w = kv.Value;
            if (g.dir != w.Item1 || Math.Abs(g.entry - w.Item2) > 1e-4 || Math.Abs(g.stop - w.Item3) > 1e-4 || Math.Abs(g.target - w.Item4) > 1e-4)
            {
                if (++diff <= 5) Console.WriteLine($"  {kv.Key}: replay {g} vs harness {w}");
            }
        }
        foreach (var k in got.Keys.Where(k => !want.ContainsKey(k)).Take(5)) Console.WriteLine($"  replay trade not in harness: {k}");
        Check($"10-year replay: {got.Count} trades vs harness {want.Count}", missing == 0 && extra == 0, $"missing {missing}, extra {extra}");
        Check("10-year replay: direction, entry, stop and target match on every trade", diff == 0, $"{diff} differ");
    }
}

// Runs PlanEngine on the gold-forecast CSV snapshot for one or more cutoffs and prints JSON (parity test).
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text.Json;
using GoldEngine;

static class Program
{
    static List<Bar> Load(string path)
    {
        var list = new List<Bar>();
        foreach (var line in File.ReadLines(path).Skip(1))
        {
            var f = line.Split(',');
            var t = DateTime.Parse(f[0], CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal);
            list.Add(new Bar(t, double.Parse(f[1], CultureInfo.InvariantCulture), double.Parse(f[2], CultureInfo.InvariantCulture),
                             double.Parse(f[3], CultureInfo.InvariantCulture), double.Parse(f[4], CultureInfo.InvariantCulture)));
        }
        return list;
    }

    static int Main(string[] args)
    {
        if (args.Length >= 2 && args[0] == "structure")
        {
            // structure mode: walk a bar CSV from index <start> and print the bars whose close broke structure
            var bars = Load(args[1]);
            int start = args.Length > 2 ? int.Parse(args[2], CultureInfo.InvariantCulture) : 0;
            var w = new StructureWalk();
            var up = new List<int>(); var dn = new List<int>();
            for (int j = start; j < bars.Count; j++)
            {
                w.Step(j, i => bars[i].H, i => bars[i].L, i => bars[i].C);
                if (w.BrokeUp) up.Add(j);
                if (w.BrokeDown) dn.Add(j);
            }
            Console.WriteLine(JsonSerializer.Serialize(new { up, dn, trend = w.Trend, last = w.LastLevel }));
            return 0;
        }
        var h1 = Load(Path.Combine(args[0], "XAUUSD_H_1.csv"));
        var h4 = Load(Path.Combine(args[0], "XAUUSD_H_4.csv"));
        if (args.Length > 2 && args[1] == "score")
        {
            // score mode: plan at the cutoff, then score it on the next session's closed bars in the file
            var cut = DateTime.Parse(args[2], CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal);
            var plan = PlanEngine.Build(h1, h4, cut);
            var day = h1.Where(b => b.T >= cut).ToList();
            int n = 1;
            while (n < day.Count && (day[n].T - day[n - 1].T).TotalHours < 2) n++;
            var s = PlanEngine.Score(plan, day.Take(n).ToList());
            Console.WriteLine(JsonSerializer.Serialize(new { s.Hours, s.Passed, s.ErrorRatio, s.In50, s.In80, s.LastClose, s.High, s.Low, s.Brier, s.Range, s.Tests }));
            return 0;
        }
        var outp = new List<object>();
        foreach (var c in args.Skip(1))
        {
            var cut = DateTime.Parse(c, CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal);
            var sw = System.Diagnostics.Stopwatch.StartNew();
            var p = PlanEngine.Build(h1, h4, cut);
            outp.Add(new
            {
                cutoff = c, ms = sw.ElapsedMilliseconds, anchor = p.Anchor, atr = p.Atr, p_up = p.PUp, proj_high = p.ProjHigh, proj_low = p.ProjLow,
                center = p.Center, sigma = p.Sigma, range_q = p.RangeQ,
                analogs = p.AnalogDays.Select(d => d.ToString("yyyy-MM-dd HH:mm")).ToArray(),
                levels = p.Levels.Select(l => new { price = l.Price, p_touch = l.PTouch, label = l.Label }).ToArray(),
                bull = new { trigger = p.Bull.Trigger, targets = p.Bull.Targets.Select(t => new { price = t.Price, p_touch = t.PTouch }).ToArray(), inval = p.Bull.Invalidation },
                bear = new { trigger = p.Bear.Trigger, targets = p.Bear.Targets.Select(t => new { price = t.Price, p_touch = t.PTouch }).ToArray(), inval = p.Bear.Invalidation },
            });
        }
        Console.WriteLine(JsonSerializer.Serialize(outp));
        return 0;
    }
}

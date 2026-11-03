// Unit tests for HarmonicMath (the Gartley / AB=CD maths in GoldGuard_XAUUSD_v3.cs).
// Builds synthetic M15 paths and replays them bar by bar the way the robot's OnBar does:
// scan swings -> match pattern -> check trigger.
//
// Run from Program.cs:  cd cbots/GoldGuard/tests && dotnet run

using System;
using System.Collections.Generic;
using cAlgo.Robots;

internal static class HarmonicTests
{
    private const int K = 3;            // swing strength (bot default)
    private const double Atr = 1.0;     // constant ATR for the synthetic paths
    private const double MinLeg = 1.5;  // Min Swing Leg 1.5 x ATR (bot default)
    private const double Tol = 0.08, StopBuf = 0.5, Target = 0.618, Zone = 0.35;

    private sealed class Path
    {
        public readonly List<double> O = new(), H = new(), L = new(), C = new();
        private double _last;

        public Path(double start) { _last = start; }

        // Straight leg to 'to' over 'bars' candles, each opening at the previous close.
        public Path Leg(double to, int bars)
        {
            for (int b = 1; b <= bars; b++)
            {
                double close = _last + (to - _last) / (bars - b + 1);
                O.Add(_last); C.Add(close);
                H.Add(Math.Max(_last, close) + 0.05); L.Add(Math.Min(_last, close) - 0.05);
                _last = close;
            }
            return this;
        }

        public Path Mirror(double around)
        {
            var m = new Path(around - _last);
            for (int i = 0; i < C.Count; i++)
            {
                m.O.Add(around - O[i]); m.C.Add(around - C[i]);
                m.H.Add(around - L[i]); m.L.Add(around - H[i]);
            }
            return m;
        }
    }

    private sealed class Outcome
    {
        public HarmonicMath.Pattern Pattern;
        public int TriggerBar = -1;
        public bool SawInvalidation;
    }

    // Mirrors GoldGuardXauusdV3.OnBar -> UpdateSwings + HarmonicSignal.
    private static Outcome Replay(Path p, bool gartley = true, bool abcd = true)
    {
        var swings = new List<HarmonicMath.Swing>();
        var used = new HashSet<string>();
        var result = new Outcome();
        int lastScan = -1;
        for (int i = 0; i < p.C.Count; i++)             // i = last closed bar
        {
            int newest = i - K;
            for (int c = Math.Max(lastScan + 1, K); c <= newest; c++)
            {
                bool lastHigh = swings.Count > 0 && swings[^1].High;
                int kind = HarmonicMath.SwingAt(c, K, j => p.H[j], j => p.L[j], lastHigh);
                if (kind != 0) HarmonicMath.AddSwing(swings, c, kind > 0 ? p.H[c] : p.L[c], kind > 0, MinLeg * Atr);
            }
            lastScan = Math.Max(lastScan, newest);

            var pat = HarmonicMath.Match(swings, gartley, abcd, Tol, StopBuf * Atr, Target);
            if (pat == null) continue;
            string key = pat.Setup + "|" + pat.FirstIndex + "|" + pat.C.Index;
            if (used.Contains(key) || i - pat.C.Index > Math.Max(10, pat.C.Index - pat.FirstIndex)) continue;

            int state = HarmonicMath.Trigger(pat, i, j => p.H[j], j => p.L[j], p.O[i], p.C[i], Zone * Atr);
            if (state < 0) { used.Add(key); result.SawInvalidation = true; }
            if (state == 1) { result.Pattern = pat; result.TriggerBar = i; return result; }
        }
        return result;
    }

    private static int _failures;

    private static void Check(string name, bool ok, string detail = "")
    {
        Console.WriteLine((ok ? "PASS  " : "FAIL  ") + name + (ok || detail == "" ? "" : "  -> " + detail));
        if (!ok) _failures++;
    }

    private static bool Close(double a, double b) => Math.Abs(a - b) < 1e-6;

    private static Path BullGartley()
    {
        // X 100 -> A 110 -> B 103.82 (0.618 XA) -> C 108 (0.676 AB) -> D zone ~102.3 -> bounce
        return new Path(104).Leg(100, 6).Leg(110, 10).Leg(103.82, 7).Leg(108, 6).Leg(102.30, 8).Leg(103.5, 4);
    }

    internal static int Run()
    {
        Console.WriteLine("-- Harmonic patterns --");
        // Swing prices are candle extremes, so each designed turning point carries the
        // 0.05 wick: X = 99.95, A = 110.05, B = 103.77, C = 108.05.
        const double W = 0.05;

        // 1. Bullish Gartley: D = A - 0.786 XA, stop 0.5 ATR beyond X, target 0.618 of AD.
        double gx = 100 - W, ga = 110 + W, gd = ga - 0.786 * (ga - gx);
        var g = Replay(BullGartley());
        Check("bull Gartley detected", g.Pattern != null && g.Pattern.Setup == "GT" && g.Pattern.Bull,
            g.Pattern == null ? "no trigger" : g.Pattern.Setup + " bull=" + g.Pattern.Bull);
        if (g.Pattern != null)
        {
            Check("bull Gartley swings at X 99.95 / A 110.05", Close(g.Pattern.X.Price, gx) && Close(g.Pattern.A.Price, ga));
            Check("bull Gartley D = A - 0.786 XA = " + gd.ToString("F4"), Close(g.Pattern.D, gd), g.Pattern.D.ToString("F4"));
            Check("bull Gartley stop = X - 0.5 ATR", Close(g.Pattern.Stop, gx - 0.5), g.Pattern.Stop.ToString("F4"));
            Check("bull Gartley target = D + 0.618 AD", Close(g.Pattern.Target, gd + 0.618 * (ga - gd)), g.Pattern.Target.ToString("F4"));
            Check("bull Gartley enters on first bullish bar after the low (bar 37)", g.TriggerBar == 37, "bar " + g.TriggerBar);
        }

        // 2. Bearish Gartley: the same path mirrored around 100.
        var bg = Replay(BullGartley().Mirror(200));
        Check("bear Gartley detected", bg.Pattern != null && bg.Pattern.Setup == "GT" && !bg.Pattern.Bull,
            bg.Pattern == null ? "no trigger" : bg.Pattern.Setup + " bull=" + bg.Pattern.Bull);
        if (bg.Pattern != null)
        {
            double bx = 200 - gx, ba = 200 - ga, bd = 200 - gd;
            Check("bear Gartley D mirrors bull D", Close(bg.Pattern.D, bd), bg.Pattern.D.ToString("F4"));
            Check("bear Gartley stop = X + 0.5 ATR", Close(bg.Pattern.Stop, bx + 0.5), bg.Pattern.Stop.ToString("F4"));
            Check("bear Gartley target = D - 0.618 AD", Close(bg.Pattern.Target, bd - 0.618 * (bd - ba)), bg.Pattern.Target.ToString("F4"));
            Check("bear Gartley triggers on the same bar as the bull mirror", bg.TriggerBar == g.TriggerBar, "bar " + bg.TriggerBar);
        }

        // 3. Bullish AB=CD: B below the prior low, so it cannot be a Gartley.
        //    A 110.05, B 103.95, C 108.05 -> D = C - AB = 101.95.
        double aa = 110 + W, ab = 104 - W, ac = 108 + W, ad = ac - (aa - ab);
        var abcd = Replay(new Path(112).Leg(106.5, 6).Leg(110, 6).Leg(104, 8).Leg(108, 6).Leg(102.2, 8).Leg(103.5, 4));
        Check("bull AB=CD detected", abcd.Pattern != null && abcd.Pattern.Setup == "AB" && abcd.Pattern.Bull,
            abcd.Pattern == null ? "no trigger" : abcd.Pattern.Setup + " bull=" + abcd.Pattern.Bull);
        if (abcd.Pattern != null)
        {
            Check("AB=CD D = C - AB = " + ad.ToString("F4"), Close(abcd.Pattern.D, ad), abcd.Pattern.D.ToString("F4"));
            Check("AB=CD stop = D - 0.5 ATR", Close(abcd.Pattern.Stop, ad - 0.5), abcd.Pattern.Stop.ToString("F4"));
            Check("AB=CD target = D + 0.618 CD", Close(abcd.Pattern.Target, ad + 0.618 * (ac - ad)), abcd.Pattern.Target.ToString("F4"));
        }

        // 4. Bearish AB=CD (mirror).
        var babcd = Replay(new Path(112).Leg(106.5, 6).Leg(110, 6).Leg(104, 8).Leg(108, 6).Leg(102.2, 8).Leg(103.5, 4).Mirror(200));
        Check("bear AB=CD detected", babcd.Pattern != null && babcd.Pattern.Setup == "AB" && !babcd.Pattern.Bull && Close(babcd.Pattern.D, 200 - ad),
            babcd.Pattern == null ? "no trigger" : babcd.Pattern.Setup + " D=" + babcd.Pattern.D);

        // 5. Gartley that fails: price runs through X (the stop) before bouncing. No entry.
        var fail = Replay(new Path(104).Leg(100, 6).Leg(110, 10).Leg(103.82, 7).Leg(108, 6).Leg(99.0, 10).Leg(101, 4), gartley: true, abcd: false);
        Check("failed Gartley: no entry", fail.Pattern == null, "entered " + fail.Pattern?.Setup + " at bar " + fail.TriggerBar);
        Check("failed Gartley: invalidation seen", fail.SawInvalidation);

        // 6. Not a Gartley: B retraces 95% of XA. With AB=CD off, nothing should trigger.
        var none = Replay(new Path(104).Leg(100, 6).Leg(110, 10).Leg(100.5, 9).Leg(106, 6).Leg(102.3, 6).Leg(103.5, 4), gartley: true, abcd: false);
        Check("B at 0.95 XA is not a Gartley", none.Pattern == null, "entered " + none.Pattern?.Setup);

        // 7. No entry while price is still falling: the trigger needs a candle closing back up.
        var swingsOnly = Replay(new Path(104).Leg(100, 6).Leg(110, 10).Leg(103.82, 7).Leg(108, 6).Leg(102.30, 8));
        Check("no entry before a rejection candle", swingsOnly.Pattern == null, "entered at bar " + swingsOnly.TriggerBar);

        // 8. Swing filter: a wiggle smaller than Min Swing Leg is ignored.
        var swings = new List<HarmonicMath.Swing>();
        HarmonicMath.AddSwing(swings, 10, 100, false, 1.5);
        HarmonicMath.AddSwing(swings, 15, 101, true, 1.5);   // leg 1.0 < 1.5: ignored
        HarmonicMath.AddSwing(swings, 20, 104, true, 1.5);   // real high
        HarmonicMath.AddSwing(swings, 25, 105, true, 1.5);   // higher high replaces it
        Check("zigzag ignores small legs and keeps the extreme",
            swings.Count == 2 && swings[1].Index == 25 && Close(swings[1].Price, 105),
            string.Join(" ", swings.ConvertAll(s => (s.High ? "H" : "L") + s.Price + "@" + s.Index)));

        return _failures;
    }
}

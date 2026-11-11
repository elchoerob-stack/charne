// PlanEngine - the gold-forecast planning model in plain C# (no cTrader dependencies).
//
// A line-by-line port of gold-forecast/analysis.py + targets.py (analog-v1.0 model, scenario plan levels-v2),
// verified number-for-number against the Python by cbot/engine/parity (see parity_check.py).
// Used inside GoldBandBreakoutBot v2 so the bot builds its own daily plan at every close.
//
// Inputs: closed H1 and H4 bars (UTC open times). Everything is computed from bars closed by the cutoff.

using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Numerics;
using System.Text.RegularExpressions;

namespace GoldEngine
{
    public struct Bar
    {
        public DateTime T;          // open time, UTC
        public double O, H, L, C;
        public Bar(DateTime t, double o, double h, double l, double c) { T = t; O = o; H = h; L = l; C = c; }
    }

    public sealed class Level
    {
        public double Price;
        public List<string> Names = new List<string>();
        public string Kind;
        public double PTouch;
        public string Label => string.Join(" / ", Names);
    }

    public sealed class Target
    {
        public string Name;
        public double Price, PTouch;
    }

    public sealed class Scenario
    {
        public string Key, Name, TriggerRule, InvalidationRule;
        public double Trigger, Invalidation;
        public List<Target> Targets = new List<Target>();
    }

    public sealed class DailyPlan
    {
        public DateTime CutoffUtc;
        public double Anchor, Atr, PUp, ProjHigh, ProjLow;
        public double[] Center = new double[PlanEngine.BarsPerSession];   // projected move, ATR units
        public double[] Sigma = new double[PlanEngine.BarsPerSession];    // typical move, ATR units
        public double[] RangeQ = new double[5];                            // q10 q25 q50 q75 q90 of the day's range, $
        public double Pdh, Pdl, Pdc;
        public List<DateTime> AnalogDays = new List<DateTime>();
        public List<Level> Levels = new List<Level>();                     // merged ladder within 1.5 ATR, with touch odds
        public Scenario Bull, Bear;
        public int Sessions;
        public double ProjClose => Anchor + Center[PlanEngine.BarsPerSession - 1] * Atr;
        public double Band(int k, double z) => z * Sigma[Math.Min(k, PlanEngine.BarsPerSession - 1)] * Atr;
        public double Projected(int k) => Anchor + Center[Math.Min(k, PlanEngine.BarsPerSession - 1)] * Atr;
    }

    public sealed class DayScore
    {
        public int Hours, Passed;
        public double ErrorRatio, In50, In80, LastClose, High, Low, Brier, Range;
        public bool[] Tests = new bool[8];
        public static readonly string[] Names =
            { "T1 beats no-change", "T2 50% band", "T3 80% band", "T4 direction", "T5 high", "T6 low", "T7 level odds", "T8 range" };
    }

    public static class PlanEngine
    {
        public const int BarsPerSession = 23, PathBars = 24, KAnalogs = 20, ProfileSessions = 120, Trail = 250;
        public const int SwingN = 3, SwingNH4 = 2, H1Rows = 2000, H4Rows = 1500, AtrPeriod = 14;
        public const double FvgMinAtr = 0.15, Z50 = 0.674, Z80 = 1.2816;
        static readonly TimeSpan Sast = TimeSpan.FromHours(2);

        // Python's round(x, n): half-even rounding of the EXACT binary value (3976.915 is really 3976.91499999...,
        // so Python gives 3976.91 where Math.Round or a 17-digit string gives 3976.92). Exact via BigInteger.
        public static double PyRound(double x, int n)
        {
            if (double.IsNaN(x) || double.IsInfinity(x) || x == 0) return x;
            long bits = BitConverter.DoubleToInt64Bits(x);
            bool neg = bits < 0;
            int exp = (int)((bits >> 52) & 0x7FF);
            long man = bits & 0xFFFFFFFFFFFFFL;
            if (exp == 0) exp = 1; else man |= 1L << 52;
            exp -= 1075;                                            // |x| = man * 2^exp exactly
            BigInteger num = new BigInteger(man) * BigInteger.Pow(10, n), den = BigInteger.One;
            if (exp > 0) num <<= exp; else den <<= -exp;
            BigInteger q = BigInteger.DivRem(num, den, out BigInteger r);
            int cmp = (r * 2).CompareTo(den);
            if (cmp > 0 || (cmp == 0 && !q.IsEven)) q += 1;
            double res = (double)q / Math.Pow(10, n);
            return neg ? -res : res;
        }

        // ------------------------------------------------------------------ sessions
        sealed class Sess
        {
            public int Start, End, N;            // row range in the H1 array
            public DateTime S;
            public double O, H, L, C, Atr, Ema20;
        }

        static List<Sess> AllSessions(IList<Bar> h1)
        {
            var list = new List<Sess>();
            Sess cur = null;
            for (int i = 0; i < h1.Count; i++)
            {
                if (cur == null || (h1[i].T - h1[i - 1].T).TotalHours >= 2.0)
                {
                    cur = new Sess { Start = i, S = h1[i].T, O = h1[i].O, H = h1[i].H, L = h1[i].L };
                    list.Add(cur);
                }
                cur.End = i;
                cur.N = i - cur.Start + 1;
                cur.H = Math.Max(cur.H, h1[i].H);
                cur.L = Math.Min(cur.L, h1[i].L);
                cur.C = h1[i].C;
            }
            double atr = 0, ema = 0, a = 1.0 / AtrPeriod, ae = 2.0 / 21.0;
            for (int j = 0; j < list.Count; j++)
            {
                var s = list[j];
                double tr = j == 0 ? s.H - s.L
                    : Math.Max(s.H - s.L, Math.Max(Math.Abs(s.H - list[j - 1].C), Math.Abs(s.L - list[j - 1].C)));
                atr = j == 0 ? tr : (1 - a) * atr + a * tr;
                ema = j == 0 ? s.C : (1 - ae) * ema + ae * s.C;
                s.Atr = atr;
                s.Ema20 = ema;
            }
            return list;
        }

        // outcome of kept session i+1 relative to kept session i's close (ATR units)
        static void Outcome(IList<Bar> h1, List<Sess> k, int i, double[] path, out double hi, out double lo)
        {
            var a = k[i]; var b = k[i + 1];
            double atr = a.Atr, c0 = a.C;
            int n = b.End - b.Start + 1;
            hi = double.NegativeInfinity; lo = double.PositiveInfinity;
            for (int j = 0; j < n; j++)
            {
                var bar = h1[b.Start + j];
                hi = Math.Max(hi, bar.H); lo = Math.Min(lo, bar.L);
            }
            for (int j = 0; j < BarsPerSession; j++)
                path[j] = (h1[b.Start + Math.Min(j, n - 1)].C - c0) / atr;
            hi = (hi - c0) / atr; lo = (lo - c0) / atr;
        }

        static double[] Features(IList<Bar> h1, List<Sess> k, int i)
        {
            var f = new double[PathBars + 5 + 3];
            var s = k[i];
            double atr = s.Atr; int end = s.End;
            for (int j = 0; j < PathBars; j++)
                f[j] = (h1[end - PathBars + 1 + j].C - h1[end].C) / atr;
            for (int j = 0; j < 5; j++)
                f[PathBars + j] = (k[i - 4 + j].C - k[i - 5 + j].C) / atr;
            double lo20 = double.PositiveInfinity, hi20 = double.NegativeInfinity;
            for (int j = i - 19; j <= i; j++) { lo20 = Math.Min(lo20, k[j].L); hi20 = Math.Max(hi20, k[j].H); }
            f[PathBars + 5] = (s.C - lo20) / (hi20 - lo20);
            f[PathBars + 6] = (s.C - s.Ema20) / atr;
            f[PathBars + 7] = (s.H - s.L) / atr;
            return f;
        }

        // ------------------------------------------------------------------ numpy-equivalent helpers
        static double Median(IList<double> v)
        {
            var a = v.OrderBy(x => x).ToArray();
            int n = a.Length;
            return n % 2 == 1 ? a[n / 2] : 0.5 * (a[n / 2 - 1] + a[n / 2]);
        }

        static double Quantile(IList<double> v, double q)        // numpy default (linear)
        {
            var a = v.OrderBy(x => x).ToArray();
            double pos = q * (a.Length - 1);
            int lo = (int)Math.Floor(pos), hi = (int)Math.Ceiling(pos);
            return a[lo] + (a[hi] - a[lo]) * (pos - lo);
        }

        // ------------------------------------------------------------------ TF indicators / structure
        sealed class Tf
        {
            public Bar[] B;
            public bool[] Sh, Sl;
            public double AtrLast, RangeHi = double.NaN, RangeLo = double.NaN;
            public List<(int bar, string side, double bot, double top, string state)> Gaps = new List<(int, string, double, double, string)>();
        }

        static Tf Analyse(IList<Bar> all, int rows, int n)
        {
            var b = all.Skip(Math.Max(0, all.Count - rows)).ToArray();
            var t = new Tf { B = b, Sh = new bool[b.Length], Sl = new bool[b.Length] };
            double atr = 0, a = 1.0 / AtrPeriod;
            for (int i = 0; i < b.Length; i++)
            {
                double tr = i == 0 ? b[i].H - b[i].L
                    : Math.Max(b[i].H - b[i].L, Math.Max(Math.Abs(b[i].H - b[i - 1].C), Math.Abs(b[i].L - b[i - 1].C)));
                atr = i == 0 ? tr : (1 - a) * atr + a * tr;
            }
            t.AtrLast = atr;
            for (int i = n; i < b.Length - n; i++)
            {
                double lh = double.NegativeInfinity, rh = double.NegativeInfinity, ll = double.PositiveInfinity, rl = double.PositiveInfinity;
                for (int j = i - n; j < i; j++) { lh = Math.Max(lh, b[j].H); ll = Math.Min(ll, b[j].L); }
                for (int j = i + 1; j <= i + n; j++) { rh = Math.Max(rh, b[j].H); rl = Math.Min(rl, b[j].L); }
                if (b[i].H > lh && b[i].H >= rh) t.Sh[i] = true;
                if (b[i].L < ll && b[i].L <= rl) t.Sl[i] = true;
            }
            for (int i = b.Length - 1; i >= 0; i--) if (t.Sh[i]) { t.RangeHi = b[i].H; break; }
            for (int i = b.Length - 1; i >= 0; i--) if (t.Sl[i]) { t.RangeLo = b[i].L; break; }
            // fair value gaps with fill state
            int m = b.Length;
            var sufMin = new double[m + 1]; var sufMax = new double[m + 1];
            sufMin[m] = double.PositiveInfinity; sufMax[m] = double.NegativeInfinity;
            for (int i = m - 1; i >= 0; i--) { sufMin[i] = Math.Min(sufMin[i + 1], b[i].L); sufMax[i] = Math.Max(sufMax[i + 1], b[i].H); }
            double min = FvgMinAtr * atr;
            for (int i = 2; i < m; i++)
            {
                double afterLo = sufMin[i + 1], afterHi = sufMax[i + 1];
                if (b[i].L - b[i - 2].H >= min)
                {
                    double bot = b[i - 2].H, top = b[i].L;
                    string st = afterLo <= bot ? "filled" : (afterLo < top ? "partly mitigated" : "open");
                    t.Gaps.Add((i - 1, "Bullish", bot, top, st));
                }
                if (b[i - 2].L - b[i].H >= min)
                {
                    double bot = b[i].H, top = b[i - 2].L;
                    string st = afterHi >= top ? "filled" : (afterHi > bot ? "partly mitigated" : "open");
                    t.Gaps.Add((i - 1, "Bearish", bot, top, st));
                }
            }
            return t;
        }

        static string Sa(DateTime utc) => (utc + Sast).ToString("dd MMM HH:mm", CultureInfo.InvariantCulture);

        // ------------------------------------------------------------------ the plan
        public static DailyPlan Build(IList<Bar> h1In, IList<Bar> h4In, DateTime cutoffUtc)
        {
            var h1 = h1In.Where(x => x.T.AddHours(1) <= cutoffUtc).ToList();
            var h4 = h4In.Where(x => x.T.AddHours(4) <= cutoffUtc).ToList();
            var all = AllSessions(h1);
            var kept = all.Where(s => s.N >= 16).ToList();
            int li = kept.Count - 1;
            if (li < Math.Max(Trail, ProfileSessions) + 30)
                throw new InvalidOperationException($"not enough history: {kept.Count} sessions");
            var p = new DailyPlan { CutoffUtc = cutoffUtc, Anchor = kept[li].C, Atr = kept[li].Atr, Sessions = kept.Count };

            // --- analog pattern model
            var target = Features(h1, kept, li);
            var cands = Enumerable.Range(25, li - 25).ToList();
            var F = cands.Select(d => Features(h1, kept, d)).ToList();
            int nf = target.Length;
            var sd = new double[nf];
            for (int j = 0; j < nf; j++)
            {
                double mean = F.Average(f => f[j]);
                sd[j] = Math.Sqrt(F.Average(f => (f[j] - mean) * (f[j] - mean))) + 1e-9;
            }
            var dist = new double[F.Count];
            for (int c = 0; c < F.Count; c++)
            {
                double za = 0, zb = 0, zc = 0;
                for (int j = 0; j < PathBars; j++) { double z = (F[c][j] - target[j]) / sd[j]; za += z * z; }
                for (int j = PathBars; j < PathBars + 5; j++) { double z = (F[c][j] - target[j]) / sd[j]; zb += z * z; }
                for (int j = PathBars + 5; j < nf; j++) { double z = (F[c][j] - target[j]) / sd[j]; zc += z * z; }
                dist[c] = Math.Sqrt(za / PathBars + zb / 5 + zc / 3);
            }
            var order = Enumerable.Range(0, F.Count).OrderBy(c => dist[c]).ThenBy(c => c).Take(KAnalogs).ToList();
            var path = new double[BarsPerSession];
            var his = new List<double>(); var los = new List<double>(); int up = 0;
            foreach (var o in order)
            {
                int d = cands[o];
                Outcome(h1, kept, d, path, out double hi, out double lo);
                for (int j = 0; j < BarsPerSession; j++) p.Center[j] += path[j] / KAnalogs;
                his.Add(hi); los.Add(lo);
                if (path[BarsPerSession - 1] > 0) up++;
                p.AnalogDays.Add(kept[d].S);
            }
            p.PUp = (double)up / KAnalogs;
            p.ProjHigh = p.Anchor + Median(his) * p.Atr;
            p.ProjLow = p.Anchor + Median(los) * p.Atr;

            // --- volatility profile (RMS move from the prior close by hour, last 120 sessions)
            var sum = new double[BarsPerSession]; int cnt = 0;
            for (int d = Math.Max(25, li - ProfileSessions); d < li; d++)
            {
                Outcome(h1, kept, d, path, out _, out _);
                for (int j = 0; j < BarsPerSession; j++) sum[j] += path[j] * path[j];
                cnt++;
            }
            for (int j = 0; j < BarsPerSession; j++) p.Sigma[j] = Math.Sqrt(sum[j] / cnt);

            // --- trailing next-day excursions for touch odds and range quantiles
            var th = new List<double>(); var tl = new List<double>();
            for (int d = li - Trail; d < li; d++)
            {
                Outcome(h1, kept, d, path, out double hi, out double lo);
                th.Add(hi); tl.Add(lo);
            }
            var rng = th.Zip(tl, (a, b) => (a - b) * p.Atr).ToList();
            double[] qs = { .1, .25, .5, .75, .9 };
            for (int j = 0; j < 5; j++) p.RangeQ[j] = Quantile(rng, qs[j]);
            Func<double, double> pTouch = x => x >= 0 ? th.Count(v => v >= x) / (double)th.Count : tl.Count(v => -v >= -x) / (double)tl.Count;

            // --- key levels (analysis.key_levels)
            var last = all[all.Count - 1];
            var lastBars = h1.Skip(last.Start).Take(last.N).ToList();
            double price = lastBars[lastBars.Count - 1].C;
            p.Pdh = lastBars.Max(x => x.H); p.Pdl = lastBars.Min(x => x.L); p.Pdc = price;
            var raw = new List<(string name, double px)>
            {
                ("PDH - previous day high", p.Pdh), ("PDL - previous day low", p.Pdl), ("Day open", lastBars[0].O)
            };
            foreach (var (name, f) in new (string, Func<int, bool>)[]
                     { ("Asia", hr => hr >= 23 || hr < 7), ("London", hr => hr >= 7 && hr < 12), ("New York", hr => hr >= 12 && hr < 22) })
            {
                var s = lastBars.Where(x => f(x.T.Hour)).ToList();
                if (s.Count > 0)
                {
                    raw.Add(($"{name} session high", s.Max(x => x.H)));
                    raw.Add(($"{name} session low", s.Min(x => x.L)));
                }
            }
            Func<DateTime, DateTime> week = s => { var d = (s + Sast).Date; return d.AddDays(-(((int)d.DayOfWeek + 6) % 7)); };
            var thisWeek = week(last.S);
            var pw = all.Where(s => week(s.S) == thisWeek.AddDays(-7)).ToList();
            if (pw.Count > 0)
            {
                raw.Add(("PWH - previous week high", pw.Max(s => s.H)));
                raw.Add(("PWL - previous week low", pw.Min(s => s.L)));
                raw.Add(("PWC - previous week close", pw[pw.Count - 1].C));
            }
            double atrD = all[all.Count - 1].Atr;
            foreach (var (label, tf) in new[] { ("4h", Analyse(h4, H4Rows, SwingNH4)), ("1h", Analyse(h1, H1Rows, SwingN)) })
            {
                var b = tf.B; int m = b.Length;
                var sufMax = new double[m + 1]; var sufMin = new double[m + 1];
                sufMax[m] = double.NegativeInfinity; sufMin[m] = double.PositiveInfinity;
                for (int i = m - 1; i >= 0; i--) { sufMax[i] = Math.Max(sufMax[i + 1], b[i].H); sufMin[i] = Math.Min(sufMin[i + 1], b[i].L); }
                var above = Enumerable.Range(0, m).Where(i => tf.Sh[i] && b[i].H > price && sufMax[i + 1] < b[i].H)
                    .OrderBy(i => b[i].H).Take(3);
                var below = Enumerable.Range(0, m).Where(i => tf.Sl[i] && b[i].L < price && sufMin[i + 1] > b[i].L)
                    .OrderBy(i => -b[i].L).Take(3);
                foreach (var i in above) raw.Add(($"{label} swing high {Sa(b[i].T)}", b[i].H));
                foreach (var i in below) raw.Add(($"{label} swing low {Sa(b[i].T)}", b[i].L));
                if (!double.IsNaN(tf.RangeHi) && !double.IsNaN(tf.RangeLo))
                    raw.Add(($"{label} range 50%", (tf.RangeHi + tf.RangeLo) / 2));
                var gaps = tf.Gaps.Where(g => g.state != "filled" && Math.Abs((g.top + g.bot) / 2 - price) < 2 * atrD).ToList();
                foreach (var g in gaps.Skip(Math.Max(0, gaps.Count - 4)))
                    raw.Add(($"{label} {g.side.ToLowerInvariant()} FVG ({(g.state == "open" ? "open" : "part-filled")}) {Sa(b[g.bar].T)}",
                             (g.top + g.bot) / 2));
            }
            for (int r = (int)(Math.Floor(price / 50) - 2) * 50; r <= (int)(Math.Floor(price / 50) + 3) * 50; r += 50)
                raw.Add(($"Round number {r:N0}", r));
            double P = (p.Pdh + p.Pdl + p.Pdc) / 3;
            raw.Add(("Daily pivot P", P)); raw.Add(("Daily pivot R1", 2 * P - p.Pdl)); raw.Add(("Daily pivot S1", 2 * P - p.Pdh));
            raw.Add(("Daily pivot R2", P + p.Pdh - p.Pdl)); raw.Add(("Daily pivot S2", P - (p.Pdh - p.Pdl)));

            // merge (targets.merged_levels): within 1.5 ATR of the anchor, levels within $0.75 combine
            foreach (var (name, px) in raw.Select((x, ix) => (x, ix)).OrderBy(t => t.x.px).ThenBy(t => t.ix).Select(t => t.x))
            {
                if (Math.Abs(px - p.Anchor) > 1.5 * p.Atr || Math.Abs(px - p.Anchor) < 0.01) continue;
                if (p.Levels.Count > 0 && Math.Abs(px - p.Levels[p.Levels.Count - 1].Price) <= 0.75)
                {
                    p.Levels[p.Levels.Count - 1].Names.Add(name);
                    continue;
                }
                var L = new Level { Price = PyRound(px, 2) };
                L.Names.Add(name);
                p.Levels.Add(L);
            }
            foreach (var L in p.Levels) L.PTouch = PyRound(pTouch((L.Price - p.Anchor) / p.Atr), 3);

            // --- scenario plan v2: trigger = first level >= 0.20 ATR away, three targets >= 0.15 ATR apart
            Scenario Ladder(string key, int sign)
            {
                var side = (sign > 0 ? p.Levels.Where(l => l.Price > p.Anchor) : p.Levels.Where(l => l.Price < p.Anchor).Reverse()).ToList();
                var trig = side.FirstOrDefault(l => Math.Abs(l.Price - p.Anchor) >= 0.20 * p.Atr);
                double tp = trig != null ? trig.Price : p.Anchor + sign * 0.25 * p.Atr;
                var sc = new Scenario
                {
                    Key = key,
                    Trigger = PyRound(tp, 2),
                    Name = (sign > 0 ? "Bull - reclaim and hold above " : "Bear - break and hold below ") + (trig != null ? Short(trig.Label) : "0.25 ATR"),
                    TriggerRule = sign > 0 ? "1h candle CLOSES above" : "1h candle CLOSES below",
                    Invalidation = PyRound(p.Anchor, 2),
                    InvalidationRule = sign > 0 ? "after trigger, 1h close back below the prior close" : "after trigger, 1h close back above the prior close",
                };
                double lastPx = tp;
                foreach (var l in side)
                    if (sc.Targets.Count < 3 && sign * (l.Price - lastPx) >= 0.15 * p.Atr)
                    {
                        sc.Targets.Add(new Target { Name = $"T{sc.Targets.Count + 1} {Short(l.Label)}", Price = l.Price });
                        lastPx = l.Price;
                    }
                while (sc.Targets.Count < 3)
                {
                    lastPx += sign * 0.25 * p.Atr;
                    sc.Targets.Add(new Target { Name = $"T{sc.Targets.Count + 1} {Math.Abs(lastPx - p.Anchor) / p.Atr:F2} ATR", Price = PyRound(lastPx, 2) });
                }
                foreach (var t in sc.Targets) t.PTouch = PyRound(pTouch((t.Price - p.Anchor) / p.Atr), 3);
                return sc;
            }
            p.Bull = Ladder("bull", +1);
            p.Bear = Ladder("bear", -1);
            return p;
        }

        public static string Short(string label)
        {
            var names = label.Split(new[] { " / " }, StringSplitOptions.None);
            string s = names[0];
            s = Regex.Replace(s, @" - previous day (high|low|close)", " day $1");
            s = Regex.Replace(s, @" - previous week (high|low|close)", " week $1");
            return s + (names.Length > 1 ? $" +{names.Length - 1}" : "");
        }

        // ------------------------------------------------------------------ end-of-day self-score (check.py T1-T8)
        public static DayScore Score(DailyPlan p, IList<Bar> session)
        {
            var sc = new DayScore { Hours = Math.Min(session.Count, BarsPerSession) };
            if (sc.Hours == 0) return sc;
            double err = 0, rw = 0; int in50 = 0, in80 = 0;
            for (int k = 0; k < sc.Hours; k++)
            {
                double c = session[k].C, proj = p.Projected(k);
                err += Math.Abs(c - proj); rw += Math.Abs(c - p.Anchor);
                if (Math.Abs(c - proj) <= p.Band(k, Z50)) in50++;
                if (Math.Abs(c - proj) <= p.Band(k, Z80)) in80++;
            }
            sc.ErrorRatio = rw > 0 ? err / rw : double.NaN;
            sc.In50 = (double)in50 / sc.Hours; sc.In80 = (double)in80 / sc.Hours;
            sc.LastClose = session[sc.Hours - 1].C;
            sc.High = session.Take(sc.Hours).Max(b => b.H); sc.Low = session.Take(sc.Hours).Min(b => b.L);
            sc.Range = sc.High - sc.Low;
            sc.Brier = p.Levels.Count == 0 ? double.NaN
                : p.Levels.Average(l => Math.Pow(l.PTouch - (l.Price >= sc.Low && l.Price <= sc.High ? 1.0 : 0.0), 2));
            bool upCall = p.ProjClose > p.Anchor;
            sc.Tests[0] = sc.ErrorRatio <= 1.0;
            sc.Tests[1] = sc.In50 >= 0.25 && sc.In50 <= 0.75;
            sc.Tests[2] = sc.In80 >= 0.6;
            sc.Tests[3] = upCall ? sc.LastClose >= p.Anchor : sc.LastClose <= p.Anchor;
            sc.Tests[4] = Math.Abs(sc.High - p.ProjHigh) <= 0.25 * p.Atr;
            sc.Tests[5] = Math.Abs(sc.Low - p.ProjLow) <= 0.25 * p.Atr;
            sc.Tests[6] = sc.Brier <= 0.25;
            sc.Tests[7] = sc.Range >= p.RangeQ[0] && sc.Range <= p.RangeQ[4];
            sc.Passed = sc.Tests.Count(t => t);
            return sc;
        }
    }

    /// <summary>
    /// Market structure on one timeframe, advanced one closed bar at a time. The same walk as the research
    /// (analysis.structure / contsim.structure_events): a swing high is a bar whose high is above the N bars before it and
    /// not below the N bars after it (mirror for lows); it becomes known N bars later; a bar that CLOSES beyond the most
    /// recent known swing breaks structure in that direction, and each swing level counts once.
    /// </summary>
    public sealed class StructureWalk
    {
        public const int N = 3;
        private double _lh, _ll;
        private bool _lhOpen, _llOpen;

        public int Trend;                       // +1 / -1 = direction of the last break, 0 = none yet
        public double LastLevel;                // the swing level of the last break
        public int LastIndex = -1;              // the bar whose close made the last break
        public bool BrokeUp, BrokeDown;         // did the bar given to the last Step() break structure?
        public double BrokeUpLevel, BrokeDownLevel;

        /// <summary>Process closed bar j (bars 0..j must be readable through the three accessors).</summary>
        public void Step(int j, Func<int, double> high, Func<int, double> low, Func<int, double> close)
        {
            BrokeUp = BrokeDown = false;
            int i = j - N;
            if (i >= N)
            {
                if (IsSwing(i, high, true)) { _lh = high(i); _lhOpen = true; }
                if (IsSwing(i, low, false)) { _ll = low(i); _llOpen = true; }
            }
            double c = close(j);
            if (_lhOpen && c > _lh) { BrokeUp = true; BrokeUpLevel = _lh; _lhOpen = false; Trend = 1; LastLevel = _lh; LastIndex = j; }
            if (_llOpen && c < _ll) { BrokeDown = true; BrokeDownLevel = _ll; _llOpen = false; Trend = -1; LastLevel = _ll; LastIndex = j; }
        }

        private static bool IsSwing(int i, Func<int, double> v, bool high)
        {
            double x = v(i);
            for (int k = i - N; k < i; k++) if (high ? !(x > v(k)) : !(x < v(k))) return false;
            for (int k = i + 1; k <= i + N; k++) if (high ? !(x >= v(k)) : !(x <= v(k))) return false;
            return true;
        }
    }
}

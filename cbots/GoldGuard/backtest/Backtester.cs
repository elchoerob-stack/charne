// =====================================================================================
//  GoldGuard v3 backtester
//
//  Replays the cBot's logic on M1 bid/ask gold data (see prepare_data.py). The
//  pattern and exit maths are the bot's own HarmonicMath and ExitMath classes,
//  compiled in from GoldGuard_XAUUSD_v3.cs. Entry signals, gates and risk rules are a
//  line-for-line port of the robot.
//
//  How it fills:
//    - Bars are built from BID prices, as cTrader charts are.
//    - Entries at the open of the next M15 bar: buy at ASK, sell at BID.
//    - Stops and take-profits are checked against each M1 bar's high/low (buy exits on
//      bid, sell exits on ask). A gap through a level fills at the bar's open. If stop
//      and take-profit are both inside one M1 bar, the stop is assumed first.
//    - Break-even, trailing and the runner are updated on each M1 close (cTrader does it
//      every tick, so live trailing can only be tighter than this).
//    - Daily-loss and peak-drawdown halts on M1 equity; Friday flat at 20:30 UTC.
//    - Commission per oz per round trip (default $0.07 = $7 per 100 oz lot). No swap.
//
//  Usage:
//    dotnet run -c Release -- run  data=xau_m1.csv from=2023-01-01 to=2026-10-29 split=2025-07-01 out=trades.csv [Param=value ...]
//    dotnet run -c Release -- grid <trend|harmonic|exit> data=xau_m1.csv from=2023-01-01 to=2025-07-01 [Param=value ...]
// =====================================================================================

using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Text;
using System.Threading.Tasks;
using cAlgo.Robots;

namespace GoldGuardBacktest
{
    internal static class Inv
    {
        public static readonly CultureInfo C = CultureInfo.InvariantCulture;
        public static string F(double v, int d = 2) => double.IsNaN(v) ? "n/a" : double.IsInfinity(v) ? "inf" : v.ToString("F" + d, C);
    }

    // ---------------------------------------------------------------------------------
    //  Data
    // ---------------------------------------------------------------------------------
    internal sealed class Market
    {
        public int N;
        public DateTime[] T;
        public double[] Bo, Bh, Bl, Bc, Ao, Ah, Al, Ac;

        public static Market Load(string path)
        {
            var lines = File.ReadAllLines(path);
            var m = new Market { N = lines.Length };
            m.T = new DateTime[m.N];
            m.Bo = new double[m.N]; m.Bh = new double[m.N]; m.Bl = new double[m.N]; m.Bc = new double[m.N];
            m.Ao = new double[m.N]; m.Ah = new double[m.N]; m.Al = new double[m.N]; m.Ac = new double[m.N];
            for (int i = 0; i < m.N; i++)
            {
                var p = lines[i].Split(',');
                m.T[i] = DateTime.UnixEpoch.AddMinutes(long.Parse(p[0], Inv.C));
                m.Bo[i] = double.Parse(p[1], Inv.C); m.Bh[i] = double.Parse(p[2], Inv.C);
                m.Bl[i] = double.Parse(p[3], Inv.C); m.Bc[i] = double.Parse(p[4], Inv.C);
                m.Ao[i] = double.Parse(p[5], Inv.C); m.Ah[i] = double.Parse(p[6], Inv.C);
                m.Al[i] = double.Parse(p[7], Inv.C); m.Ac[i] = double.Parse(p[8], Inv.C);
            }
            return m;
        }
    }

    // Bid bars of one timeframe, each pointing at its M1 range [Start, End).
    internal sealed class Series
    {
        public DateTime[] Time;
        public double[] O, H, L, C;
        public int[] Start, End;
        public int Count;

        public static Series Build(Market m, int minutes)
        {
            var t = new List<DateTime>(); var o = new List<double>(); var h = new List<double>();
            var l = new List<double>(); var c = new List<double>(); var st = new List<int>(); var en = new List<int>();
            long cur = long.MinValue;
            for (int i = 0; i < m.N; i++)
            {
                long bucket = (long)(m.T[i] - DateTime.UnixEpoch).TotalMinutes / minutes;
                if (bucket != cur)
                {
                    if (t.Count > 0) en.Add(i);
                    cur = bucket;
                    t.Add(DateTime.UnixEpoch.AddMinutes(bucket * minutes));
                    o.Add(m.Bo[i]); h.Add(m.Bh[i]); l.Add(m.Bl[i]); c.Add(m.Bc[i]); st.Add(i);
                }
                else
                {
                    int j = t.Count - 1;
                    h[j] = Math.Max(h[j], m.Bh[i]); l[j] = Math.Min(l[j], m.Bl[i]); c[j] = m.Bc[i];
                }
            }
            if (t.Count > 0) en.Add(m.N);
            return new Series
            {
                Time = t.ToArray(), O = o.ToArray(), H = h.ToArray(), L = l.ToArray(), C = c.ToArray(),
                Start = st.ToArray(), End = en.ToArray(), Count = t.Count,
            };
        }

        // For each bar of 'fast', the index of the newest bar of this series that had
        // closed when that fast bar opened (the robot's LastClosedIndex).
        public int[] LastClosedFor(Series fast, TimeSpan length)
        {
            var r = new int[fast.Count];
            int j = -1;
            for (int k = 0; k < fast.Count; k++)
            {
                while (j + 1 < Count && Time[j + 1] + length <= fast.Time[k]) j++;
                r[k] = j;
            }
            return r;
        }
    }

    internal static class Ind
    {
        // cTrader-style EMA: seeded with the first value.
        public static double[] Ema(double[] src, int n)
        {
            var r = new double[src.Length];
            double k = 2.0 / (n + 1);
            for (int i = 0; i < src.Length; i++) r[i] = i == 0 ? src[0] : r[i - 1] + k * (src[i] - r[i - 1]);
            return r;
        }

        // ATR with MovingAverageType.Exponential: EMA of true range.
        public static double[] Atr(Series s, int n)
        {
            var tr = new double[s.Count];
            for (int i = 0; i < s.Count; i++)
                tr[i] = i == 0 ? s.H[i] - s.L[i]
                    : Math.Max(s.H[i] - s.L[i], Math.Max(Math.Abs(s.H[i] - s.C[i - 1]), Math.Abs(s.L[i] - s.C[i - 1])));
            var r = Ema(tr, n);
            for (int i = 0; i < Math.Min(n, r.Length); i++) r[i] = double.NaN; // warm-up
            return r;
        }

        // RSI with Wilder smoothing (EMA of period 2n-1).
        public static double[] Rsi(double[] c, int n)
        {
            var g = new double[c.Length]; var l = new double[c.Length];
            for (int i = 1; i < c.Length; i++) { double d = c[i] - c[i - 1]; g[i] = Math.Max(d, 0); l[i] = Math.Max(-d, 0); }
            var ag = Ema(g, 2 * n - 1); var al = Ema(l, 2 * n - 1);
            var r = new double[c.Length];
            for (int i = 0; i < c.Length; i++) r[i] = i < n ? double.NaN : al[i] == 0 ? 100 : 100 - 100 / (1 + ag[i] / al[i]);
            return r;
        }

        public static double[] Sma(double[] src, int n)
        {
            var r = new double[src.Length]; double sum = 0; int valid = 0;
            var q = new Queue<double>();
            for (int i = 0; i < src.Length; i++)
            {
                double v = src[i];
                if (double.IsNaN(v)) { r[i] = double.NaN; continue; }
                q.Enqueue(v); sum += v; valid++;
                if (q.Count > n) sum -= q.Dequeue();
                r[i] = q.Count == n ? sum / n : double.NaN;
            }
            return r;
        }
    }

    // ---------------------------------------------------------------------------------
    //  Settings: the bot's [Parameter] defaults, plus simulation costs
    // ---------------------------------------------------------------------------------
    internal sealed class Config
    {
        public int H1Fast = 34, H1Slow = 100;
        public bool EnablePullbacks = true, EnableBreakouts = true;
        public int EntryEma = 20, RsiPeriod = 14;
        public double BuyRsi = 52, SellRsi = 48;
        public int StructureBars = 8;
        public double MinBodyRatio = 0.45, RewardRisk = 2.0;
        public bool EnableGartley = true, EnableAbcd = true;
        public int SwingStrength = 3;
        public double MinSwingLegAtr = 1.5, RatioTolerance = 0.08, HarmonicDZoneAtr = 0.35;
        public double HarmonicStopBuffer = 0.5, HarmonicTarget = 0.618, HarmonicMinRr = 1.2;
        public bool HarmonicsNeedTrend = false;
        public int AtrPeriod = 14;
        public double AtrStopMult = 1.8, SwingStopBuffer = 0.2, MaxStopAtr = 4.0, MaxSpreadAtr = 0.15;
        public int AtrBaseline = 96;
        public double MinAtrRatio = 0.6, MaxAtrRatio = 2.5;
        public int CooldownBars = 2;
        public bool UsePivotBias = false;
        public int D1TrendEma = 100; // the bot's Daily Trend EMA (0 = off)
        public double BreakEvenAtR = 1.0, BreakEvenLockR = 0.1;
        public bool TrailEnabled = true;
        public double TrailStartR = 1.5, TrailAtrMult = 1.5;
        public bool RunnerEnabled = true;
        public double RunnerLock = 0.8, RunnerTrailAtr = 0.6, RunnerHardTp = 3;
        public bool UseSessionFilter = true;
        public int SessionStartHour = 12, SessionEndHour = 16;
        public int FitnessMinTrades = 100;
        // Simulation
        public double StartBalance = 10000, CommissionPerOz = 0.07, StopSlippage = 0;

        public Config Clone() => (Config)MemberwiseClone();

        public void Set(string key, string value)
        {
            var f = GetType().GetField(key, BindingFlags.Public | BindingFlags.Instance | BindingFlags.IgnoreCase)
                ?? throw new ArgumentException("Unknown setting: " + key);
            f.SetValue(this, Convert.ChangeType(value, f.FieldType, Inv.C));
        }

        public string Show(IEnumerable<string> keys) => string.Join(" ", keys.Select(k =>
            k + "=" + Convert.ToString(GetType().GetField(k)!.GetValue(this), Inv.C)));
    }

    // ---------------------------------------------------------------------------------
    //  Simulation
    // ---------------------------------------------------------------------------------
    internal sealed class Pos
    {
        public bool Buy;
        public double Entry, Sl, Units, StopDist, TargetDist, Risk;
        public double? Tp;
        public string Setup;
        public DateTime EntryTime;
        public bool Runner;
    }

    internal sealed class Trade
    {
        public DateTime Entry, Close;
        public bool Buy, Runner;
        public double Units, EntryPx, ExitPx, Gross, Comm, Net, Balance, R, TargetR;
        public string Setup, Reason;
    }

    internal sealed class Result
    {
        public List<Trade> Trades = new();
        public int DdTrips, DayHalts;
        public double MaxDdPct, EndBalance;
        public Dictionary<string, int> Signals = new(), Taken = new(), Skips = new();
    }

    internal sealed class Candidate
    {
        public bool Buy, NeedsTrend;
        public string Setup;
        public double StopPrice, MinStopDist, TargetPrice = double.NaN, Rr = double.NaN, MinRr;
    }

    internal sealed class Sim
    {
        // Risk constants: identical to the robot's.
        private const double RiskPerTradePct = 0.5, MaxOpenRiskPct = 1.0, MaxDailyLossPct = 2.0, MaxPeakDrawdownPct = 6.0;
        private const int MaxOpenPositions = 2, MaxTradesPerDay = 6, MaxConsecutiveLosses = 3;
        private const double MaxVolumeOverRisk = 1.01, ScratchBandR = 0.2, VolumeStep = 1.0; // 1 oz = 0.01 lot
        private const int FridayLastEntryHourUtc = 18;
        private static readonly TimeSpan FridayFlat = new TimeSpan(20, 30, 0);

        private readonly Market _m;
        private readonly Series _b, _h1, _d1;
        private readonly int[] _h1Closed, _d1Closed;
        private readonly Config _c;
        private readonly ExitRules _rules;
        private double[] _ema, _rsi, _atr, _atrBase, _h1F, _h1S, _d1E;

        private readonly List<Pos> _pos = new();
        private readonly List<HarmonicMath.Swing> _swings = new();
        private readonly HashSet<string> _used = new();
        private int _lastScan = -1;
        private double _balance, _dayStart, _peak, _ddPeak;
        private DateTime _day = DateTime.MinValue, _lastEntryBar = DateTime.MinValue, _from;
        private int _tradesToday, _streak;
        private bool _dayHalt, _ddHalt;
        private readonly Result _r = new();

        public Sim(Market m, Series m15, Series h1, int[] h1Closed, Series d1, int[] d1Closed, Config c)
        {
            _m = m; _b = m15; _h1 = h1; _h1Closed = h1Closed; _d1 = d1; _d1Closed = d1Closed; _c = c;
            _rules = new ExitRules
            {
                BreakEvenAtR = c.BreakEvenAtR, BreakEvenLockR = c.BreakEvenLockR,
                Trail = c.TrailEnabled, TrailStartR = c.TrailStartR, TrailAtrMult = c.TrailAtrMult,
                Runner = c.RunnerEnabled, RunnerLock = c.RunnerLock, RunnerTrailAtr = c.RunnerTrailAtr,
            };
        }

        public Result Run(DateTime from, DateTime to)
        {
            _from = from;
            _ema = Ind.Ema(_b.C, _c.EntryEma);
            _rsi = Ind.Rsi(_b.C, _c.RsiPeriod);
            _atr = Ind.Atr(_b, _c.AtrPeriod);
            _atrBase = Ind.Sma(_atr, _c.AtrBaseline);
            _h1F = Ind.Ema(_h1.C, _c.H1Fast);
            _h1S = Ind.Ema(_h1.C, _c.H1Slow);
            _d1E = _c.D1TrendEma > 0 ? Ind.Ema(_d1.C, _c.D1TrendEma) : null;
            _balance = _c.StartBalance; _dayStart = _peak = _ddPeak = _balance;

            int last = -1;
            for (int k = 1; k < _b.Count; k++)
            {
                if (_b.Time[k] >= to) break;
                int f = _b.Start[k];
                CheckRisk(f, true);                         // OnBar: equity at the bar's open
                UpdateSwings(k - 1);
                if (_b.Time[k] >= from) OnBar(k);
                for (int m = f; m < _b.End[k]; m++) { OnMinute(m, k); last = m; }
            }
            foreach (var p in _pos.ToList()) Close(p, p.Buy ? _m.Bc[last] : _m.Ac[last], "end of test", _m.T[last]);
            _r.EndBalance = _balance;
            return _r;
        }

        // ---- per M1 bar -------------------------------------------------------------
        private void OnMinute(int m, int k)
        {
            DateTime t = _m.T[m];
            double slip = _c.StopSlippage;
            foreach (var p in _pos.ToList())
            {
                if (p.Buy)
                {
                    if (_m.Bo[m] <= p.Sl) Close(p, _m.Bo[m] - slip, "stop (gap)", t);
                    else if (p.Tp.HasValue && _m.Bo[m] >= p.Tp) Close(p, _m.Bo[m], "take-profit", t);
                    else if (_m.Bl[m] <= p.Sl) Close(p, p.Sl - slip, "stop", t);
                    else if (p.Tp.HasValue && _m.Bh[m] >= p.Tp) Close(p, p.Tp.Value, "take-profit", t);
                }
                else
                {
                    if (_m.Ao[m] >= p.Sl) Close(p, _m.Ao[m] + slip, "stop (gap)", t);
                    else if (p.Tp.HasValue && _m.Ao[m] <= p.Tp) Close(p, _m.Ao[m], "take-profit", t);
                    else if (_m.Ah[m] >= p.Sl) Close(p, p.Sl + slip, "stop", t);
                    else if (p.Tp.HasValue && _m.Al[m] <= p.Tp) Close(p, p.Tp.Value, "take-profit", t);
                }
            }

            double atr = _atr[k - 1];
            if (atr > 0)
            {
                foreach (var p in _pos)
                {
                    double px = p.Buy ? _m.Bc[m] : _m.Ac[m];
                    double want = ExitMath.DesiredStop(p.Buy, p.Entry, px, p.Sl, p.StopDist, p.TargetDist, atr, _rules, out bool atTarget);
                    if (atTarget) p.Runner = true;
                    double step = Math.Max(0.01, 0.05 * atr);
                    double gap = (_m.Ac[m] - _m.Bc[m]) + 0.02;
                    bool better = p.Buy ? want >= p.Sl + step : want <= p.Sl - step;
                    bool valid = p.Buy ? want <= _m.Bc[m] - gap : want >= _m.Ac[m] + gap;
                    if (better && valid) p.Sl = Math.Round(want, 2);
                }
            }
            CheckRisk(m, false);
        }

        private double Equity(int m, bool atOpen)
        {
            double bid = atOpen ? _m.Bo[m] : _m.Bc[m], ask = atOpen ? _m.Ao[m] : _m.Ac[m];
            double e = _balance;
            foreach (var p in _pos) e += (p.Buy ? bid - p.Entry : p.Entry - ask) * p.Units;
            return e;
        }

        private void CheckRisk(int m, bool atOpen)
        {
            DateTime now = _m.T[m];
            double eq = Equity(m, atOpen);
            if (now.Date != _day)
            {
                _day = now.Date; _dayStart = eq; _tradesToday = 0; _streak = 0; _dayHalt = false;
                if (_ddHalt) { _ddHalt = false; _peak = eq; }   // backtest re-arm, as in the robot
            }
            if (eq > _peak) _peak = eq;
            if (now >= _from)
            {
                if (eq > _ddPeak) _ddPeak = eq;
                _r.MaxDdPct = Math.Max(_r.MaxDdPct, (1 - eq / _ddPeak) * 100);
            }
            if (!_dayHalt && eq <= _dayStart * (1 - MaxDailyLossPct / 100)) { _dayHalt = true; _r.DayHalts++; }
            if (!_ddHalt && eq <= _peak * (1 - MaxPeakDrawdownPct / 100)) { _ddHalt = true; _r.DdTrips++; }
            if (_dayHalt || _ddHalt) CloseAll(m, atOpen, "risk halt");
            if (now.DayOfWeek == DayOfWeek.Friday && now.TimeOfDay >= FridayFlat) CloseAll(m, atOpen, "weekend flat");
        }

        private void CloseAll(int m, bool atOpen, string why)
        {
            foreach (var p in _pos.ToList())
                Close(p, p.Buy ? (atOpen ? _m.Bo[m] : _m.Bc[m]) : (atOpen ? _m.Ao[m] : _m.Ac[m]), why, _m.T[m]);
        }

        private void Close(Pos p, double exit, string why, DateTime t)
        {
            double gross = (p.Buy ? exit - p.Entry : p.Entry - exit) * p.Units;
            double comm = p.Units * _c.CommissionPerOz;
            double net = gross - comm;
            _balance += net;
            _pos.Remove(p);
            double r = net / p.Risk;
            if (r <= -ScratchBandR) _streak++;
            else if (r >= ScratchBandR) _streak = 0;
            _r.Trades.Add(new Trade
            {
                Entry = p.EntryTime, Close = t, Buy = p.Buy, Units = p.Units, EntryPx = p.Entry, ExitPx = exit,
                Gross = gross, Comm = comm, Net = net, Balance = _balance, R = r, TargetR = p.TargetDist / p.StopDist,
                Setup = p.Setup, Reason = why, Runner = p.Runner,
            });
        }

        // ---- per M15 bar (OnBar) ------------------------------------------------------
        private void UpdateSwings(int i)
        {
            int k = _c.SwingStrength;
            int newest = i - k;
            for (int c = Math.Max(_lastScan + 1, k + _c.AtrPeriod); c <= newest; c++)
            {
                if (c - k < 0 || c + k > i) continue;
                double atr = _atr[c];
                if (!(atr > 0)) continue;
                bool lastHigh = _swings.Count > 0 && _swings[^1].High;
                int kind = HarmonicMath.SwingAt(c, k, j => _b.H[j], j => _b.L[j], lastHigh);
                if (kind != 0) HarmonicMath.AddSwing(_swings, c, kind > 0 ? _b.H[c] : _b.L[c], kind > 0, _c.MinSwingLegAtr * atr);
            }
            if (newest > _lastScan) _lastScan = newest;
        }

        private static void Count(Dictionary<string, int> d, string key) { d.TryGetValue(key, out int n); d[key] = n + 1; }
        private void Skip(string setup, string why) => Count(_r.Skips, setup + ": " + why);

        private void OnBar(int k)
        {
            int i = k - 1;
            int warm = Math.Max(Math.Max(_c.StructureBars, _c.EntryEma), Math.Max(_c.AtrBaseline, _c.RsiPeriod)) + _c.AtrPeriod + 2;
            int h = _h1Closed[k];
            double atr = _atr[i];
            if (i < warm || h < _c.H1Slow + 2 || !(atr > 0)) return;

            var harmonic = HarmonicSignal(i, atr);
            var trend = TrendSignal(i, h, atr);
            var pick = harmonic ?? trend;
            if (harmonic != null && trend != null)
            {
                Count(_r.Signals, trend.Setup);
                if (harmonic.Buy != trend.Buy)
                {
                    Count(_r.Signals, harmonic.Setup);
                    Skip(harmonic.Setup, "conflicts with trend setup"); Skip(trend.Setup, "conflicts with harmonic setup");
                    pick = null;
                }
                else Skip(trend.Setup, "same bar as harmonic entry");
            }
            if (pick != null) TryEnter(pick, k, i, h, atr);
        }

        private bool H1Up(int h) => _h1F[h] > _h1S[h] && _h1.C[h] > _h1F[h];
        private bool H1Down(int h) => _h1F[h] < _h1S[h] && _h1.C[h] < _h1F[h];

        private Candidate TrendSignal(int i, int h, double atr)
        {
            if (!_c.EnablePullbacks && !_c.EnableBreakouts) return null;
            double open = _b.O[i], close = _b.C[i], range = _b.H[i] - _b.L[i];
            if (range <= 0 || Math.Abs(close - open) / range < _c.MinBodyRatio) return null;
            bool up = H1Up(h), down = H1Down(h);
            if (!up && !down) return null;
            double prevHigh = double.MinValue, prevLow = double.MaxValue;
            for (int k = i - _c.StructureBars; k < i; k++) { prevHigh = Math.Max(prevHigh, _b.H[k]); prevLow = Math.Min(prevLow, _b.L[k]); }
            double ema = _ema[i], emaPrev = _ema[i - 1];
            bool buyCandle = close > open && close > ema && _rsi[i] >= _c.BuyRsi;
            bool sellCandle = close < open && close < ema && _rsi[i] <= _c.SellRsi;
            bool buyPb = _c.EnablePullbacks && _b.L[i - 1] <= emaPrev && close > _b.H[i - 1];
            bool sellPb = _c.EnablePullbacks && _b.H[i - 1] >= emaPrev && close < _b.L[i - 1];
            bool buyBo = _c.EnableBreakouts && close > prevHigh;
            bool sellBo = _c.EnableBreakouts && close < prevLow;
            bool buy = up && buyCandle && (buyPb || buyBo);
            bool sell = down && sellCandle && (sellPb || sellBo);
            if (buy == sell) return null;
            return new Candidate
            {
                Buy = buy, Setup = buy ? (buyPb ? "PB" : "BO") : (sellPb ? "PB" : "BO"),
                StopPrice = buy ? prevLow - _c.SwingStopBuffer * atr : prevHigh + _c.SwingStopBuffer * atr,
                MinStopDist = _c.AtrStopMult * atr, Rr = _c.RewardRisk, MinRr = 0,
            };
        }

        private Candidate HarmonicSignal(int i, double atr)
        {
            if (!_c.EnableGartley && !_c.EnableAbcd) return null;
            var p = HarmonicMath.Match(_swings, _c.EnableGartley, _c.EnableAbcd, _c.RatioTolerance, _c.HarmonicStopBuffer * atr, _c.HarmonicTarget);
            if (p == null) return null;
            string key = p.Setup + "|" + p.FirstIndex + "|" + p.C.Index;
            if (_used.Contains(key)) return null;
            if (i - p.C.Index > Math.Max(10, p.C.Index - p.FirstIndex)) return null;
            int state = HarmonicMath.Trigger(p, i, j => _b.H[j], j => _b.L[j], _b.O[i], _b.C[i], _c.HarmonicDZoneAtr * atr);
            if (state < 0) _used.Add(key);
            if (state <= 0) return null;
            _used.Add(key);
            return new Candidate
            {
                Buy = p.Bull, Setup = p.Setup, StopPrice = p.Stop, MinStopDist = _c.AtrStopMult * atr,
                TargetPrice = p.Target, MinRr = _c.HarmonicMinRr, NeedsTrend = _c.HarmonicsNeedTrend,
            };
        }

        private void TryEnter(Candidate c, int k, int i, int h, double atr)
        {
            Count(_r.Signals, c.Setup);
            int f = _b.Start[k];
            string why = Gate(c, k, i, h, atr, f, out double units, out double stopDist, out double tpDist, out double risk, out double entry);
            if (why != null) { Skip(c.Setup, why); return; }
            double s = c.Buy ? 1 : -1;
            double? tp = !_c.RunnerEnabled ? entry + s * tpDist
                : _c.RunnerHardTp > 0 ? entry + s * tpDist * _c.RunnerHardTp : (double?)null;
            _pos.Add(new Pos
            {
                Buy = c.Buy, Entry = entry, Sl = Math.Round(entry - s * stopDist, 2), Tp = tp.HasValue ? Math.Round(tp.Value, 2) : null,
                Units = units, StopDist = stopDist, TargetDist = tpDist, Risk = risk, Setup = c.Setup, EntryTime = _m.T[f],
            });
            _tradesToday++;
            _lastEntryBar = _b.Time[k];
            Count(_r.Taken, c.Setup);
        }

        private string Gate(Candidate c, int k, int i, int h, double atr, int f,
            out double units, out double stopDist, out double tpDist, out double risk, out double entry)
        {
            units = stopDist = tpDist = risk = entry = 0;
            if (_ddHalt) return "halt: peak drawdown";
            if (_dayHalt) return "halt: daily loss";
            if (_streak >= MaxConsecutiveLosses) return "loss-streak cap";
            if (_tradesToday >= MaxTradesPerDay) return "daily trade cap";
            if (_pos.Count >= MaxOpenPositions) return "max open positions";
            if (_pos.Any(p => p.Buy != c.Buy)) return "opposite position open";
            if (_lastEntryBar != DateTime.MinValue && Math.Round((_b.Time[k] - _lastEntryBar).TotalMinutes / 15.0) <= _c.CooldownBars) return "cooldown";
            DateTime now = _m.T[f];
            if (_c.UseSessionFilter && !InHours(now.Hour, _c.SessionStartHour, _c.SessionEndHour)) return "outside session";
            if (now.DayOfWeek == DayOfWeek.Friday && now.Hour >= FridayLastEntryHourUtc) return "Friday cutoff";
            double spread = _m.Ao[f] - _m.Bo[f];
            if (spread > _c.MaxSpreadAtr * atr) return "spread too wide";
            double baseAtr = _atrBase[i];
            if (baseAtr > 0)
            {
                double ratio = atr / baseAtr;
                if (ratio < _c.MinAtrRatio) return "volatility too low";
                if (ratio > _c.MaxAtrRatio) return "volatility too high";
            }
            if (c.NeedsTrend && !(c.Buy ? H1Up(h) : H1Down(h))) return "against H1 trend";
            if (_d1E != null)
            {
                int dd = _d1Closed[k];
                if (dd < _c.D1TrendEma) return "daily trend warming up";
                if (c.Buy ? _d1.C[dd] <= _d1E[dd] : _d1.C[dd] >= _d1E[dd]) return "against daily trend";
            }
            if (_c.UsePivotBias)
            {
                int d = _d1Closed[k];
                if (d >= 0)
                {
                    double pivot = (_d1.H[d] + _d1.L[d] + _d1.C[d]) / 3;
                    if (c.Buy ? _b.C[i] <= pivot : _b.C[i] >= pivot) return "wrong side of daily pivot";
                }
            }
            entry = c.Buy ? _m.Ao[f] : _m.Bo[f];
            double structural = c.Buy ? entry - c.StopPrice : c.StopPrice - entry;
            stopDist = Math.Max(c.MinStopDist, structural);
            if (stopDist > _c.MaxStopAtr * atr) return "stop too wide";
            tpDist = double.IsNaN(c.TargetPrice) ? stopDist * c.Rr : (c.Buy ? c.TargetPrice - entry : entry - c.TargetPrice);
            if (tpDist <= 0 || tpDist / stopDist < c.MinRr) return "reward/risk too low";
            double eq = Equity(f, true);
            risk = eq * RiskPerTradePct / 100;
            double openRisk = 0;
            foreach (var p in _pos)
            {
                double dist = p.Buy ? p.Entry - p.Sl : p.Sl - p.Entry;
                if (dist > 0) openRisk += dist * p.Units;
            }
            if (openRisk + risk > eq * MaxOpenRiskPct / 100 + 1e-6) return "open-risk cap";
            units = Math.Floor(risk / stopDist / VolumeStep) * VolumeStep;
            if (units < VolumeStep || units * stopDist > risk * MaxVolumeOverRisk) return "minimum lot risks more than the per-trade budget";
            return null;
        }

        private static bool InHours(int hour, int start, int end)
        {
            if (start == end) return true;
            return start < end ? hour >= start && hour < end : hour >= start || hour < end;
        }
    }

    // ---------------------------------------------------------------------------------
    //  Statistics, reports, grids
    // ---------------------------------------------------------------------------------
    internal sealed class Stats
    {
        public int N, Wins;
        public double Pf, Net, AvgR, WinPct;

        public static Stats Of(IEnumerable<Trade> trades)
        {
            var t = trades.ToList();
            double won = t.Where(x => x.Net > 0).Sum(x => x.Net), lost = -t.Where(x => x.Net < 0).Sum(x => x.Net);
            return new Stats
            {
                N = t.Count, Wins = t.Count(x => x.Net > 0), Net = t.Sum(x => x.Net),
                Pf = lost > 0 ? won / lost : (won > 0 ? double.PositiveInfinity : double.NaN),
                AvgR = t.Count > 0 ? t.Average(x => x.R) : double.NaN,
                WinPct = t.Count > 0 ? 100.0 * t.Count(x => x.Net > 0) / t.Count : double.NaN,
            };
        }

        public override string ToString() =>
            $"trades {N,4} | win {Inv.F(WinPct, 1),5}% | PF {Inv.F(Pf),5} | net {Inv.F(Net),10} | avg {Inv.F(AvgR),5}R";
    }

    internal static class Program
    {
        private static double Fitness(Result r, Config c, DateTime from, DateTime to)
        {
            var t = r.Trades.Where(x => x.Close >= from && x.Close < to).ToList();
            if (t.Count < c.FitnessMinTrades) return -1.0 + t.Count / (double)Math.Max(1, c.FitnessMinTrades);
            double pf = Stats.Of(t).Pf;
            if (double.IsNaN(pf)) pf = 0;
            if (double.IsInfinity(pf) || pf > 5) pf = 5;
            return pf - 0.02 * r.MaxDdPct;
        }

        private static int Main(string[] args)
        {
            if (args.Length == 0) { Console.WriteLine("usage: run|grid <name> data=... from=... to=... [Param=value ...]"); return 2; }
            string mode = args[0];
            string grid = mode == "grid" ? args[1] : null;
            var kv = args.Skip(mode == "grid" ? 2 : 1).Select(a => a.Split('=', 2)).ToDictionary(a => a[0], a => a[1], StringComparer.OrdinalIgnoreCase);
            string data = kv["data"];
            DateTime from = DateTime.Parse(kv.GetValueOrDefault("from", "2023-01-01"), Inv.C);
            DateTime to = DateTime.Parse(kv.GetValueOrDefault("to", "2026-10-29"), Inv.C);
            DateTime split = DateTime.Parse(kv.GetValueOrDefault("split", "2025-07-01"), Inv.C);
            var baseCfg = new Config();
            foreach (var (k, v) in kv)
                if (!new[] { "data", "from", "to", "split", "out", "top" }.Contains(k, StringComparer.OrdinalIgnoreCase)) baseCfg.Set(k, v);

            var sw = System.Diagnostics.Stopwatch.StartNew();
            var m = Market.Load(data);
            var m15 = Series.Build(m, 15); var h1 = Series.Build(m, 60); var d1 = Series.Build(m, 1440);
            var h1c = h1.LastClosedFor(m15, TimeSpan.FromHours(1)); var d1c = d1.LastClosedFor(m15, TimeSpan.FromDays(1));
            Console.Error.WriteLine($"loaded {m.N:N0} M1 bars, {m15.Count:N0} M15 bars in {sw.Elapsed.TotalSeconds:F1}s");

            Result RunOne(Config c) => new Sim(m, m15, h1, h1c, d1, d1c, c).Run(from, to);

            if (mode == "run")
            {
                var r = RunOne(baseCfg);
                Report(r, from, split, to);
                if (kv.TryGetValue("out", out var outPath)) WriteCsv(r, outPath);
                return 0;
            }

            // Grid: every combination, scored on [from, to) only. Look at the out-of-sample
            // period only once, for the chosen settings, with "run".
            var axes = Grids(grid);
            var configs = new List<(Config Cfg, string Label)> { (baseCfg.Clone(), "") };
            foreach (var (name, values) in axes)
            {
                var next = new List<(Config, string)>();
                foreach (var (cfg, label) in configs)
                    foreach (var v in values) { var c2 = cfg.Clone(); c2.Set(name, v); next.Add((c2, (label + " " + name + "=" + v).Trim())); }
                configs = next;
            }
            var results = new (string Label, double Fit, Stats S, double Dd, int Trips)[configs.Count];
            Parallel.For(0, configs.Count, j =>
            {
                var r = RunOne(configs[j].Cfg);
                var t = r.Trades.Where(x => x.Close >= from && x.Close < to);
                results[j] = (configs[j].Label, Fitness(r, configs[j].Cfg, from, to), Stats.Of(t), r.MaxDdPct, r.DdTrips);
            });
            Console.WriteLine($"grid '{grid}': {configs.Count} variants on {from:yyyy-MM-dd}..{to:yyyy-MM-dd} ({sw.Elapsed.TotalSeconds:F0}s)");
            foreach (var x in results.OrderByDescending(x => x.Fit).Take(int.Parse(kv.GetValueOrDefault("top", "15"), Inv.C)))
                Console.WriteLine($"fit {Inv.F(x.Fit, 3),6} | {x.S} | maxDD {Inv.F(x.Dd, 1),4}% | ddHalts {x.Trips} | {x.Label}");
            return 0;
        }

        private static List<(string, string[])> Grids(string name) => name switch
        {
            "trend" => new()
            {
                ("AtrStopMult", new[] { "1.2", "1.5", "1.8", "2.2" }),
                ("RewardRisk", new[] { "1.5", "2", "2.5", "3" }),
                ("StructureBars", new[] { "5", "8", "12" }),
                ("TrailStartR", new[] { "1", "1.5", "2" }),
            },
            "harmonic" => new()
            {
                ("RatioTolerance", new[] { "0.05", "0.08", "0.12" }),
                ("HarmonicDZoneAtr", new[] { "0.2", "0.35", "0.6" }),
                ("HarmonicTarget", new[] { "0.382", "0.618", "0.786" }),
                ("MinSwingLegAtr", new[] { "1", "1.5", "2.5" }),
            },
            "exit" => new()
            {
                ("RunnerEnabled", new[] { "true", "false" }),
                ("RunnerLock", new[] { "0.6", "0.8" }),
                ("RunnerTrailAtr", new[] { "0.4", "0.6", "1.0" }),
            },
            "daily" => new()
            {
                ("D1TrendEma", new[] { "0", "20", "50", "100" }),
            },
            "filters" => new()
            {
                ("SessionStartHour", new[] { "6", "7", "12" }),
                ("SessionEndHour", new[] { "16", "20" }),
                ("MinAtrRatio", new[] { "0", "0.6", "0.8" }),
                ("UsePivotBias", new[] { "false", "true" }),
            },
            _ => throw new ArgumentException("unknown grid " + name),
        };

        private static void Report(Result r, DateTime from, DateTime split, DateTime to)
        {
            void Block(string title, DateTime a, DateTime b)
            {
                var t = r.Trades.Where(x => x.Close >= a && x.Close < b).ToList();
                Console.WriteLine($"\n{title}  ({a:yyyy-MM-dd} .. {b:yyyy-MM-dd})");
                foreach (var s in new[] { "PB", "BO", "GT", "AB" })
                {
                    var g = t.Where(x => x.Setup == s).ToList();
                    if (g.Count > 0) Console.WriteLine($"  {s,-3} {Stats.Of(g)}");
                }
                Console.WriteLine($"  ALL {Stats.Of(t)}");
                Console.WriteLine($"  buys  {Stats.Of(t.Where(x => x.Buy))}");
                Console.WriteLine($"  sells {Stats.Of(t.Where(x => !x.Buy))}");
                var run = t.Where(x => x.Runner).ToList();
                if (run.Count > 0)
                    Console.WriteLine($"  runners: {run.Count} reached target | exit avg {Inv.F(run.Average(x => x.R))}R vs target avg {Inv.F(run.Average(x => x.TargetR))}R | best {Inv.F(run.Max(x => x.R))}R | below target {run.Count(x => x.R < x.TargetR)}");
            }
            Block("IN-SAMPLE", from, split);
            Block("OUT-OF-SAMPLE", split, to);
            Block("WHOLE PERIOD", from, to);
            Console.WriteLine($"\nmax equity drawdown {Inv.F(r.MaxDdPct, 1)}% | peak-drawdown halts {r.DdTrips} | daily-loss halts {r.DayHalts} | end balance {Inv.F(r.EndBalance)}");
            foreach (var s in r.Signals.Keys.OrderBy(x => x))
                Console.WriteLine($"signals {s}: {r.Signals[s]} found, {r.Taken.GetValueOrDefault(s)} traded");
            foreach (var x in r.Skips.OrderByDescending(x => x.Value).Take(40)) Console.WriteLine($"  skipped {x.Value,5}x  {x.Key}");
            var reasons = r.Trades.GroupBy(x => x.Reason).Select(g => $"{g.Key} {g.Count()}");
            Console.WriteLine("exits: " + string.Join(", ", reasons));
        }

        private static void WriteCsv(Result r, string path)
        {
            var sb = new StringBuilder("Closing Time,Entry Time,Symbol,Direction,Volume,Pips,Gross,Commissions,Swap,Net Profit,Balance,Setup,R,Target R,Exit\n");
            foreach (var t in r.Trades)
                sb.AppendLine(string.Join(",", t.Close.ToString("yyyy-MM-dd HH:mm:ss", Inv.C), t.Entry.ToString("yyyy-MM-dd HH:mm:ss", Inv.C),
                    "XAUUSD", t.Buy ? "Buy" : "Sell", t.Units.ToString(Inv.C), Inv.F((t.Buy ? t.ExitPx - t.EntryPx : t.EntryPx - t.ExitPx) * 100, 1),
                    Inv.F(t.Gross), Inv.F(-t.Comm), "0", Inv.F(t.Net), Inv.F(t.Balance), t.Setup, Inv.F(t.R, 3), Inv.F(t.TargetR, 3), t.Reason));
            File.WriteAllText(path, sb.ToString());
            Console.Error.WriteLine("trade log: " + path);
        }
    }
}

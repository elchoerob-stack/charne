// =====================================================================================
//  GoldGuard XAUUSD v3  -  M15 trend-continuation + harmonic (Gartley / ABCD) cBot
//
//  DEMO ONLY until it has passed cbot-gate and a demo forward test.
//  Every value that sizes a trade or caps a loss is a compile-time constant below.
//
//  Setups (each is tagged in the position comment and scored separately on stop):
//    PB  pullback to the M15 entry EMA, in the H1 trend direction        (from v2)
//    BO  close beyond the N-bar structure high/low, in the H1 trend      (from v2)
//    GT  Gartley completion (B = 0.618 XA, D = 0.786 XA) + rejection candle at D
//    AB  AB=CD completion + rejection candle at D
//  GT and AB are the textbook versions of the patterns Autochartist shows in the
//  cTrader Signals tab. Autochartist's own tolerances are looser and unpublished, so
//  the two will not match one for one. The Signals feed itself cannot be read by a cBot.
//
//  Defaults come from the Nov 2026 backtest refinement (see README.md, "Backtest"):
//  London/New York overlap session (12-16 UTC) and a daily EMA-100 trend filter.
//
//  Units: every distance is an ATR multiple or a price, never pips, so the same
//  settings work whether the broker quotes gold with a $0.01 or a $0.10 pip.
// =====================================================================================

using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;
using cAlgo.API;
using cAlgo.API.Indicators;
using cAlgo.API.Internals;

namespace cAlgo.Robots
{
    // FullAccess is used for one thing only: writing the trade-log CSV for cbot-gate
    // to Documents\cBotLogs when a backtest or demo run stops.
    [Robot(TimeZone = TimeZones.UTC, AccessRights = AccessRights.FullAccess)]
    public class GoldGuardXauusdV3 : Robot
    {
        // -----------------------------------------------------------------------------
        //  RISK - fixed constants. Change only here, rebuild, and re-validate.
        // -----------------------------------------------------------------------------
        private const double RiskPerTradePct = 0.5;      // % of equity lost if the stop is hit
        private const double MaxOpenRiskPct = 1.0;       // all open bot positions together
        private const double MaxDailyLossPct = 2.0;      // vs UTC-midnight equity: close all, halt for the day
        private const double MaxPeakDrawdownPct = 6.0;   // vs peak equity: close all, halt until KillSwitchEpoch changes
        private const int MaxOpenPositions = 2;
        private const int MaxTradesPerDay = 6;
        private const int MaxConsecutiveLosses = 3;      // per UTC day
        private const double MaxVolumeOverRisk = 1.01;   // broker lot rounding may overshoot the risk by at most 1%
        private const bool DemoOnly = true;

        // To clear a tripped peak-drawdown halt after reviewing it, change this to 2, 3, ...
        // in code and rebuild. Peak equity then restarts from current equity.
        // There is deliberately no [Parameter] for this.
        private const int KillSwitchEpoch = 1;

        // Gold gaps over the weekend: no new entries late on Friday, flat before the close.
        private const int FridayLastEntryHourUtc = 18;
        private const int FridayFlatHourUtc = 20;
        private const int FridayFlatMinuteUtc = 30;

        // A trade within +/- this many R of zero (a break-even exit after commission) is a
        // scratch. It neither adds to nor resets the loss streak.
        private const double ScratchBandR = 0.2;

        private const string Label = "GoldGuardV3-XAU";
        private const string CommentTag = "GG3";
        private const string StatePrefix = "GoldGuardV3";

        // -----------------------------------------------------------------------------
        //  STRATEGY parameters. Safe to optimise: none of them changes position size.
        // -----------------------------------------------------------------------------
        [Parameter("Fast H1 EMA", DefaultValue = 34, MinValue = 5, MaxValue = 200, Step = 1, Group = "Trend filters")]
        public int H1Fast { get; set; }

        [Parameter("Slow H1 EMA", DefaultValue = 100, MinValue = 10, MaxValue = 400, Step = 5, Group = "Trend filters")]
        public int H1Slow { get; set; }

        // Trade only in the direction of the daily trend: buys while the last closed daily bar
        // closed above this EMA, sells while below. Applies to every setup.
        [Parameter("Daily Trend EMA (0 = off)", DefaultValue = 100, MinValue = 0, MaxValue = 300, Step = 10, Group = "Trend filters")]
        public int DailyTrendEma { get; set; }

        [Parameter("Enable Pullbacks (PB)", DefaultValue = true, Group = "Trend setups (M15)")]
        public bool EnablePullbacks { get; set; }

        [Parameter("Enable Breakouts (BO)", DefaultValue = true, Group = "Trend setups (M15)")]
        public bool EnableBreakouts { get; set; }

        [Parameter("Entry EMA", DefaultValue = 20, MinValue = 3, MaxValue = 100, Step = 1, Group = "Trend setups (M15)")]
        public int EntryEma { get; set; }

        [Parameter("RSI Period", DefaultValue = 14, MinValue = 3, MaxValue = 50, Step = 1, Group = "Trend setups (M15)")]
        public int RsiPeriod { get; set; }

        [Parameter("Buy RSI Minimum", DefaultValue = 52, MinValue = 40, MaxValue = 80, Step = 1, Group = "Trend setups (M15)")]
        public double BuyRsi { get; set; }

        [Parameter("Sell RSI Maximum", DefaultValue = 48, MinValue = 20, MaxValue = 60, Step = 1, Group = "Trend setups (M15)")]
        public double SellRsi { get; set; }

        [Parameter("Structure Lookback (bars)", DefaultValue = 8, MinValue = 3, MaxValue = 50, Step = 1, Group = "Trend setups (M15)")]
        public int StructureBars { get; set; }

        [Parameter("Min Body / Range", DefaultValue = 0.45, MinValue = 0.1, MaxValue = 1, Step = 0.05, Group = "Trend setups (M15)")]
        public double MinBodyRatio { get; set; }

        [Parameter("Reward / Risk", DefaultValue = 2.0, MinValue = 0.5, MaxValue = 6, Step = 0.25, Group = "Trend setups (M15)")]
        public double RewardRisk { get; set; }

        [Parameter("Enable Gartley (GT)", DefaultValue = true, Group = "Harmonic setups")]
        public bool EnableGartley { get; set; }

        [Parameter("Enable ABCD (AB)", DefaultValue = true, Group = "Harmonic setups")]
        public bool EnableAbcd { get; set; }

        [Parameter("Swing Strength (bars each side)", DefaultValue = 3, MinValue = 2, MaxValue = 10, Step = 1, Group = "Harmonic setups")]
        public int SwingStrength { get; set; }

        [Parameter("Min Swing Leg (x ATR)", DefaultValue = 1.5, MinValue = 0.5, MaxValue = 6, Step = 0.25, Group = "Harmonic setups")]
        public double MinSwingLegAtr { get; set; }

        [Parameter("Ratio Tolerance", DefaultValue = 0.08, MinValue = 0.02, MaxValue = 0.2, Step = 0.01, Group = "Harmonic setups")]
        public double RatioTolerance { get; set; }

        [Parameter("D Zone (x ATR)", DefaultValue = 0.35, MinValue = 0, MaxValue = 2, Step = 0.05, Group = "Harmonic setups")]
        public double HarmonicDZoneAtr { get; set; }

        [Parameter("Harmonic Stop Buffer (x ATR)", DefaultValue = 0.5, MinValue = 0, MaxValue = 3, Step = 0.1, Group = "Harmonic setups")]
        public double HarmonicStopBuffer { get; set; }

        [Parameter("Harmonic Target (retrace of AD / CD)", DefaultValue = 0.618, MinValue = 0.236, MaxValue = 1.0, Step = 0.05, Group = "Harmonic setups")]
        public double HarmonicTarget { get; set; }

        [Parameter("Harmonic Min Reward / Risk", DefaultValue = 1.2, MinValue = 0.5, MaxValue = 4, Step = 0.1, Group = "Harmonic setups")]
        public double HarmonicMinRr { get; set; }

        [Parameter("Harmonics Need H1 Trend", DefaultValue = false, Group = "Harmonic setups")]
        public bool HarmonicsNeedTrend { get; set; }

        [Parameter("ATR Period", DefaultValue = 14, MinValue = 3, MaxValue = 50, Step = 1, Group = "Stops and filters")]
        public int AtrPeriod { get; set; }

        [Parameter("ATR Stop Multiple", DefaultValue = 1.8, MinValue = 0.5, MaxValue = 6, Step = 0.1, Group = "Stops and filters")]
        public double AtrStopMult { get; set; }

        [Parameter("Swing Stop Buffer (x ATR)", DefaultValue = 0.2, MinValue = 0, MaxValue = 2, Step = 0.1, Group = "Stops and filters")]
        public double SwingStopBuffer { get; set; }

        [Parameter("Max Stop (x ATR)", DefaultValue = 4.0, MinValue = 1, MaxValue = 10, Step = 0.25, Group = "Stops and filters")]
        public double MaxStopAtr { get; set; }

        [Parameter("Max Spread (x ATR)", DefaultValue = 0.15, MinValue = 0.01, MaxValue = 1, Step = 0.01, Group = "Stops and filters")]
        public double MaxSpreadAtr { get; set; }

        [Parameter("ATR Baseline (bars)", DefaultValue = 96, MinValue = 20, MaxValue = 500, Step = 4, Group = "Stops and filters")]
        public int AtrBaseline { get; set; }

        [Parameter("Min ATR / Baseline", DefaultValue = 0.6, MinValue = 0, MaxValue = 1.5, Step = 0.05, Group = "Stops and filters")]
        public double MinAtrRatio { get; set; }

        [Parameter("Max ATR / Baseline", DefaultValue = 2.5, MinValue = 1, MaxValue = 10, Step = 0.1, Group = "Stops and filters")]
        public double MaxAtrRatio { get; set; }

        [Parameter("Cooldown (bars)", DefaultValue = 2, MinValue = 0, MaxValue = 30, Step = 1, Group = "Stops and filters")]
        public int CooldownBars { get; set; }

        [Parameter("Daily Pivot Bias (TC-style rule)", DefaultValue = false, Group = "Stops and filters")]
        public bool UsePivotBias { get; set; }

        [Parameter("Break-even at R", DefaultValue = 1.0, MinValue = 0.3, MaxValue = 5, Step = 0.1, Group = "Trade management")]
        public double BreakEvenAtR { get; set; }

        [Parameter("Break-even Lock (R)", DefaultValue = 0.1, MinValue = 0, MaxValue = 1, Step = 0.05, Group = "Trade management")]
        public double BreakEvenLockR { get; set; }

        [Parameter("Enable ATR Trailing", DefaultValue = true, Group = "Trade management")]
        public bool TrailEnabled { get; set; }

        [Parameter("Trail Starts at R", DefaultValue = 1.5, MinValue = 0.5, MaxValue = 6, Step = 0.25, Group = "Trade management")]
        public double TrailStartR { get; set; }

        [Parameter("Trail ATR Multiple", DefaultValue = 1.5, MinValue = 0.5, MaxValue = 5, Step = 0.1, Group = "Trade management")]
        public double TrailAtrMult { get; set; }

        // Runner exit: no take-profit at the target. When price reaches it, the stop jumps
        // to lock most of the target and then trails close behind price, so a move that keeps
        // going is followed instead of cut off. Off = the v2 fixed take-profit at the target.
        [Parameter("Trail Past Target (runner)", DefaultValue = true, Group = "Trade management")]
        public bool RunnerEnabled { get; set; }

        [Parameter("Runner Lock at Target (share)", DefaultValue = 0.8, MinValue = 0, MaxValue = 1, Step = 0.05, Group = "Trade management")]
        public double RunnerLock { get; set; }

        [Parameter("Runner Trail (x ATR)", DefaultValue = 0.6, MinValue = 0.2, MaxValue = 3, Step = 0.1, Group = "Trade management")]
        public double RunnerTrailAtr { get; set; }

        [Parameter("Runner Hard TP (x target, 0 = none)", DefaultValue = 3, MinValue = 0, MaxValue = 10, Step = 0.5, Group = "Trade management")]
        public double RunnerHardTp { get; set; }

        [Parameter("Use Session Filter", DefaultValue = true, Group = "Sessions (UTC)")]
        public bool UseSessionFilter { get; set; }

        [Parameter("Session Start Hour", DefaultValue = 12, MinValue = 0, MaxValue = 23, Step = 1, Group = "Sessions (UTC)")]
        public int SessionStartHour { get; set; }

        [Parameter("Session End Hour (exclusive)", DefaultValue = 16, MinValue = 0, MaxValue = 23, Step = 1, Group = "Sessions (UTC)")]
        public int SessionEndHour { get; set; }

        [Parameter("Entry Blackouts (HH:mm-HH:mm, ...)", DefaultValue = "", Group = "Sessions (UTC)")]
        public string BlackoutWindows { get; set; }

        [Parameter("Fitness: Min Trades", DefaultValue = 100, MinValue = 10, MaxValue = 2000, Step = 10, Group = "Validation")]
        public int FitnessMinTrades { get; set; }

        [Parameter("Write Trade Log CSV", DefaultValue = true, Group = "Validation")]
        public bool WriteTradeLog { get; set; }

        // -----------------------------------------------------------------------------
        //  State
        // -----------------------------------------------------------------------------
        private sealed class Meta
        {
            public string Setup;
            public double StopDist;   // initial stop distance in price = 1R
            public double RiskMoney;  // account currency at risk when opened
            public double TargetDist = double.NaN;  // expected-profit distance in price
        }

        private sealed class Candidate
        {
            public bool Buy;
            public string Setup;
            public double StopPrice;
            public double MinStopDist;
            public double TargetPrice = double.NaN;  // structural target (harmonics)
            public double Rr = double.NaN;           // fixed reward/risk (trend setups)
            public double MinRr;
            public bool NeedsTrend;
        }

        private readonly CultureInfo Inv = CultureInfo.InvariantCulture;

        private Bars _h1, _d1;
        private ExponentialMovingAverage _h1FastEma, _h1SlowEma, _entryEma;
        private RelativeStrengthIndex _rsi;
        private AverageTrueRange _atr;
        private SimpleMovingAverage _atrBase;
        private ExponentialMovingAverage _d1Ema;

        private bool _started, _persist, _visual, _stateDirty;
        private long _keyAccount;
        private string _keySymbol;

        private DateTime _day;
        private double _dayStartEquity, _peakEquity, _lastSavedPeak;
        private int _tradesToday, _lossStreak;
        private bool _dayHalt, _ddHalt;
        private int _ddTrips, _dayHalts;
        private DateTime _lastEntryBarTime = DateTime.MinValue;
        private DateTime _nextCloseAttempt = DateTime.MinValue;
        private string _lastSkip;

        private readonly List<HarmonicMath.Swing> _swings = new List<HarmonicMath.Swing>();
        private int _lastSwingScan = -1;
        private readonly HashSet<string> _usedPatterns = new HashSet<string>();
        private readonly HashSet<string> _drawn = new HashSet<string>();
        private readonly List<(TimeSpan From, TimeSpan To)> _blackouts = new List<(TimeSpan From, TimeSpan To)>();
        private readonly Dictionary<int, Meta> _meta = new Dictionary<int, Meta>();
        private readonly Dictionary<string, int> _signals = new Dictionary<string, int>();
        private readonly Dictionary<string, int> _taken = new Dictionary<string, int>();
        private readonly Dictionary<string, int> _skips = new Dictionary<string, int>();
        private ExitRules _exitRules;
        private readonly HashSet<int> _runners = new HashSet<int>();
        private readonly List<(double ExitR, double TargetR)> _runnerResults = new List<(double ExitR, double TargetR)>();

        // -----------------------------------------------------------------------------
        //  Lifecycle
        // -----------------------------------------------------------------------------
        protected override void OnStart()
        {
            if (DemoOnly && Account.IsLive)
            {
                Print("DEMO ONLY: this is a live account. GoldGuard v3 stays on demo until it has passed cbot-gate.");
                Stop();
                return;
            }
            string sym = SymbolName.ToUpperInvariant();
            if (!(sym.Contains("XAUUSD") || sym.StartsWith("GOLD")) || TimeFrame != TimeFrame.Minute15)
            {
                Print("Attach GoldGuard v3 to an XAUUSD (gold) M15 chart. Current: {0} {1}.", SymbolName, TimeFrame);
                Stop();
                return;
            }
            string error = ValidateParameters();
            if (error != null)
            {
                Print("Parameter error: {0}", error);
                Stop();
                return;
            }

            // Persist risk state only for the real-time instance, so a backtest can never
            // write a peak-equity value or a halt into the demo bot's state (or into the
            // next optimisation pass).
            _persist = RunningMode == RunningMode.RealTime;
            _visual = RunningMode == RunningMode.RealTime || RunningMode == RunningMode.VisualBacktesting;
            _keyAccount = Account.Number; _keySymbol = SymbolName;

            _h1 = MarketData.GetBars(TimeFrame.Hour);
            _d1 = MarketData.GetBars(TimeFrame.Daily);
            _h1FastEma = Indicators.ExponentialMovingAverage(_h1.ClosePrices, H1Fast);
            _h1SlowEma = Indicators.ExponentialMovingAverage(_h1.ClosePrices, H1Slow);
            _entryEma = Indicators.ExponentialMovingAverage(Bars.ClosePrices, EntryEma);
            _rsi = Indicators.RelativeStrengthIndex(Bars.ClosePrices, RsiPeriod);
            _atr = Indicators.AverageTrueRange(AtrPeriod, MovingAverageType.Exponential);
            _atrBase = Indicators.SimpleMovingAverage(_atr.Result, AtrBaseline);
            if (DailyTrendEma > 0)
            {
                // The filter needs DailyTrendEma closed daily bars; fetch more if the chart has fewer.
                try
                {
                    while (_d1.Count < DailyTrendEma * 2 && _d1.LoadMoreHistory() > 0) { }
                }
                catch (Exception ex)
                {
                    Print("Could not load more daily history ({0}); the daily trend filter blocks entries until {1} daily bars exist.", ex.Message, DailyTrendEma);
                }
                _d1Ema = Indicators.ExponentialMovingAverage(_d1.ClosePrices, DailyTrendEma);
            }
            _exitRules = new ExitRules
            {
                BreakEvenAtR = BreakEvenAtR, BreakEvenLockR = BreakEvenLockR,
                Trail = TrailEnabled, TrailStartR = TrailStartR, TrailAtrMult = TrailAtrMult,
                Runner = RunnerEnabled, RunnerLock = RunnerLock, RunnerTrailAtr = RunnerTrailAtr,
            };

            LoadState();
            AdoptOpenPositions();

            // Rebuild the recent swing structure so harmonics work straight after a restart.
            int firstScan = Math.Max(SwingStrength + AtrPeriod, Bars.Count - 600);
            int lastScan = Bars.Count - 2 - SwingStrength;
            for (int c = firstScan; c <= lastScan; c++)
                ScanSwing(c);
            _lastSwingScan = Math.Max(_lastSwingScan, lastScan);

            Positions.Closed += OnPositionClosed;
            Timer.Start(5);
            _started = true;

            Print("GoldGuard v3 on {0} ({1}), account {2}, mode {3}. PipSize {4}, TickSize {5}, digits {6}, min volume {7} units, spread now {8}.",
                SymbolName, TimeFrame, Account.Number, RunningMode, Symbol.PipSize, Symbol.TickSize, Symbol.Digits,
                Symbol.VolumeInUnitsMin, Symbol.Spread.ToString("F" + Symbol.Digits, Inv));
            Print("Risk constants: {0}% per trade, {1}% open risk, -{2}% day halt, -{3}% peak halt, {4} positions, {5} trades/day, {6} losses/day. Kill-switch epoch {7}.",
                RiskPerTradePct, MaxOpenRiskPct, MaxDailyLossPct, MaxPeakDrawdownPct, MaxOpenPositions, MaxTradesPerDay,
                MaxConsecutiveLosses, KillSwitchEpoch);
            UpdatePanel();
        }

        protected override void OnTick()
        {
            if (!_started) return;
            CheckRisk();
            ManagePositions();
        }

        protected override void OnTimer()
        {
            if (!_started) return;
            CheckRisk();
            ManagePositions();
            if (_stateDirty) SaveState();
            if (RunningMode == RunningMode.RealTime) UpdatePanel();
        }

        protected override void OnBar()
        {
            if (!_started) return;
            CheckRisk();
            UpdateSwings();

            int i = Bars.Count - 2; // last fully closed M15 bar
            int warmUp = Math.Max(Math.Max(StructureBars, EntryEma), Math.Max(AtrBaseline, RsiPeriod)) + AtrPeriod + 2;
            int h = LastClosedIndex(_h1, TimeSpan.FromHours(1));
            double atr = i >= 0 ? _atr.Result[i] : double.NaN;
            if (i < warmUp || h < H1Slow + 2 || !(atr > 0))
            {
                UpdatePanel();
                return;
            }

            Candidate harmonic = HarmonicSignal(i, atr);
            Candidate trend = TrendSignal(i, h, atr);
            Candidate pick = harmonic ?? trend;
            if (harmonic != null && trend != null)
            {
                Count(_signals, trend.Setup);
                if (harmonic.Buy != trend.Buy)
                {
                    Count(_signals, harmonic.Setup);
                    Skip(harmonic.Setup, "conflicts with trend setup");
                    Skip(trend.Setup, "conflicts with harmonic setup");
                    pick = null;
                }
                else
                {
                    Skip(trend.Setup, "same bar as harmonic entry");
                }
            }
            if (pick != null) TryEnter(pick, i, h, atr);
            UpdatePanel();
        }

        protected override void OnStop()
        {
            if (!_started) return;
            Positions.Closed -= OnPositionClosed;
            SaveState();
            Report();
            if (WriteTradeLog && RunningMode != RunningMode.Optimization) WriteCsv();
        }

        // Custom optimisation criterion. In the optimiser choose Criteria > Custom.
        // Ranked the way cbot-gate judges: Profit Factor first. A pass with too few trades
        // always scores below any pass with enough trades (range -1..0), and drawdown
        // takes a small deduction so two equal-PF passes prefer the shallower curve.
        protected override double GetFitness(GetFitnessArgs args)
        {
            double trades = args.TotalTrades;
            if (trades < FitnessMinTrades) return -1.0 + trades / Math.Max(1, FitnessMinTrades);
            double pf = args.ProfitFactor;
            if (double.IsNaN(pf)) pf = 0;
            if (double.IsInfinity(pf) || pf > 5) pf = 5;
            return pf - 0.02 * args.MaxEquityDrawdownPercentages;
        }

        // -----------------------------------------------------------------------------
        //  Signals
        // -----------------------------------------------------------------------------
        private bool H1Up(int h)
        {
            return _h1FastEma.Result[h] > _h1SlowEma.Result[h] && _h1.ClosePrices[h] > _h1FastEma.Result[h];
        }

        private bool H1Down(int h)
        {
            return _h1FastEma.Result[h] < _h1SlowEma.Result[h] && _h1.ClosePrices[h] < _h1FastEma.Result[h];
        }

        // v2 logic, unchanged apart from units and the H1 index.
        private Candidate TrendSignal(int i, int h, double atr)
        {
            if (!EnablePullbacks && !EnableBreakouts) return null;
            double open = Bars.OpenPrices[i], close = Bars.ClosePrices[i];
            double range = Bars.HighPrices[i] - Bars.LowPrices[i];
            if (range <= 0 || Math.Abs(close - open) / range < MinBodyRatio) return null;

            bool up = H1Up(h), down = H1Down(h);
            if (!up && !down) return null;

            double prevHigh = double.MinValue, prevLow = double.MaxValue;
            for (int k = i - StructureBars; k < i; k++)
            {
                prevHigh = Math.Max(prevHigh, Bars.HighPrices[k]);
                prevLow = Math.Min(prevLow, Bars.LowPrices[k]);
            }
            double ema = _entryEma.Result[i], emaPrev = _entryEma.Result[i - 1];
            bool buyCandle = close > open && close > ema && _rsi.Result[i] >= BuyRsi;
            bool sellCandle = close < open && close < ema && _rsi.Result[i] <= SellRsi;
            bool buyPb = EnablePullbacks && Bars.LowPrices[i - 1] <= emaPrev && close > Bars.HighPrices[i - 1];
            bool sellPb = EnablePullbacks && Bars.HighPrices[i - 1] >= emaPrev && close < Bars.LowPrices[i - 1];
            bool buyBo = EnableBreakouts && close > prevHigh;
            bool sellBo = EnableBreakouts && close < prevLow;

            bool buy = up && buyCandle && (buyPb || buyBo);
            bool sell = down && sellCandle && (sellPb || sellBo);
            if (buy == sell) return null;

            return new Candidate
            {
                Buy = buy,
                Setup = buy ? (buyPb ? "PB" : "BO") : (sellPb ? "PB" : "BO"),
                StopPrice = buy ? prevLow - SwingStopBuffer * atr : prevHigh + SwingStopBuffer * atr,
                MinStopDist = AtrStopMult * atr,
                Rr = RewardRisk,
                MinRr = 0,
                NeedsTrend = false, // already required above
            };
        }

        // Gartley / AB=CD on the zigzag of confirmed swings (maths in HarmonicMath below).
        // The last confirmed swing is C; price is travelling from C towards the projected D.
        // Entry needs price to reach the D zone and an M15 candle to close back beyond D.
        private Candidate HarmonicSignal(int i, double atr)
        {
            if (!EnableGartley && !EnableAbcd) return null;
            HarmonicMath.Pattern p = HarmonicMath.Match(_swings, EnableGartley, EnableAbcd, RatioTolerance,
                HarmonicStopBuffer * atr, HarmonicTarget);
            if (p == null) return null;

            string key = p.Setup + "|" + p.FirstIndex.ToString(Inv) + "|" + p.C.Index.ToString(Inv);
            if (_usedPatterns.Contains(key)) return null;
            if (i - p.C.Index > Math.Max(10, p.C.Index - p.FirstIndex)) return null; // D never came: expired
            DrawPattern(key, p);

            int state = HarmonicMath.Trigger(p, i, j => Bars.HighPrices[j], j => Bars.LowPrices[j],
                Bars.OpenPrices[i], Bars.ClosePrices[i], HarmonicDZoneAtr * atr);
            if (state < 0) _usedPatterns.Add(key);   // ran through the stop: pattern failed
            if (state <= 0) return null;

            _usedPatterns.Add(key);                  // one entry attempt per pattern
            return new Candidate
            {
                Buy = p.Bull,
                Setup = p.Setup,
                StopPrice = p.Stop,
                MinStopDist = AtrStopMult * atr,
                TargetPrice = p.Target,
                MinRr = HarmonicMinRr,
                NeedsTrend = HarmonicsNeedTrend,
            };
        }

        private void UpdateSwings()
        {
            int newest = Bars.Count - 2 - SwingStrength;
            for (int c = Math.Max(_lastSwingScan + 1, SwingStrength + AtrPeriod); c <= newest; c++)
                ScanSwing(c);
            if (newest > _lastSwingScan) _lastSwingScan = newest;
        }

        private void ScanSwing(int c)
        {
            if (c - SwingStrength < 0 || c + SwingStrength > Bars.Count - 2) return;
            double atr = _atr.Result[c];
            if (!(atr > 0)) return;
            bool lastHigh = _swings.Count > 0 && _swings[_swings.Count - 1].High;
            int kind = HarmonicMath.SwingAt(c, SwingStrength, j => Bars.HighPrices[j], j => Bars.LowPrices[j], lastHigh);
            if (kind != 0)
                HarmonicMath.AddSwing(_swings, c, kind > 0 ? Bars.HighPrices[c] : Bars.LowPrices[c], kind > 0, MinSwingLegAtr * atr);
        }

        // -----------------------------------------------------------------------------
        //  Entry
        // -----------------------------------------------------------------------------
        private void TryEnter(Candidate c, int i, int h, double atr)
        {
            Count(_signals, c.Setup);
            string why = EntryGate(c, i, h, atr, out double volume, out double stopDist, out double tpDist, out double riskMoney);
            if (why != null)
            {
                Skip(c.Setup, why);
                return;
            }

            var type = c.Buy ? TradeType.Buy : TradeType.Sell;
            string comment = CommentTag + "|" + c.Setup + "|" + stopDist.ToString("G10", Inv) + "|"
                + riskMoney.ToString("F2", Inv) + "|" + tpDist.ToString("G10", Inv);
            double stopPips = stopDist / Symbol.PipSize;
            // Runner mode: no take-profit at the target (the bot locks and trails from there),
            // only a far broker-side ceiling (default 3x the target; 0 = none).
            // Otherwise the fixed take-profit at the target.
            double? tpPips = !RunnerEnabled ? tpDist / Symbol.PipSize
                : RunnerHardTp > 0 ? tpDist * RunnerHardTp / Symbol.PipSize : (double?)null;

            TradeResult result = ExecuteMarketOrder(type, SymbolName, volume, Label, stopPips, tpPips, comment);
            if (!result.IsSuccessful)
            {
                Skip(c.Setup, "order rejected (" + result.Error + ")");
                Print("Order rejected: {0}", result.Error);
                return;
            }
            Position p = result.Position;
            if (p != null && !p.StopLoss.HasValue)
            {
                Print("Position {0} filled without a stop loss. Closing it immediately.", p.Id);
                ClosePosition(p);
                return;
            }

            _tradesToday++;
            _lastEntryBarTime = Bars.OpenTimes.LastValue;
            if (p != null) _meta[p.Id] = new Meta { Setup = c.Setup, StopDist = stopDist, RiskMoney = riskMoney, TargetDist = tpDist };
            Count(_taken, c.Setup);
            SaveState();
            Print("OPEN {0} {1} {2} units | stop {3} ({4:F2} ATR) | target {5} ({6:F2}R){7} | risk {8} {9}",
                c.Setup, type, volume, stopDist.ToString("F2", Inv), stopDist / atr, tpDist.ToString("F2", Inv),
                tpDist / stopDist, RunnerEnabled ? ", then trail" : " fixed TP", riskMoney.ToString("F2", Inv), Account.Asset.Name);
        }

        // Returns null when the trade may go, otherwise the reason it is skipped.
        private string EntryGate(Candidate c, int i, int h, double atr,
            out double volume, out double stopDist, out double tpDist, out double riskMoney)
        {
            volume = stopDist = tpDist = riskMoney = 0;

            if (_ddHalt) return "halt: peak drawdown";
            if (_dayHalt) return "halt: daily loss";
            if (_lossStreak >= MaxConsecutiveLosses) return "loss-streak cap";
            if (_tradesToday >= MaxTradesPerDay) return "daily trade cap";

            Position[] open = BotPositions();
            if (open.Length >= MaxOpenPositions) return "max open positions";
            var type = c.Buy ? TradeType.Buy : TradeType.Sell;
            if (open.Any(p => p.TradeType != type)) return "opposite position open";
            if (_lastEntryBarTime != DateTime.MinValue
                && Math.Round((Bars.OpenTimes.LastValue - _lastEntryBarTime).TotalMinutes / 15.0) <= CooldownBars)
                return "cooldown";

            DateTime now = Server.Time;
            if (UseSessionFilter && !InHours(now.Hour, SessionStartHour, SessionEndHour)) return "outside session";
            if (now.DayOfWeek == DayOfWeek.Friday && now.Hour >= FridayLastEntryHourUtc) return "Friday cutoff";
            if (InBlackout(now.TimeOfDay)) return "news blackout";
            if (!Symbol.MarketHours.IsOpened()) return "market closed";
            if (Symbol.Spread > MaxSpreadAtr * atr) return "spread too wide";

            double baseAtr = _atrBase.Result[i];
            if (baseAtr > 0)
            {
                double ratio = atr / baseAtr;
                if (ratio < MinAtrRatio) return "volatility too low";
                if (ratio > MaxAtrRatio) return "volatility too high";
            }
            if (c.NeedsTrend && !(c.Buy ? H1Up(h) : H1Down(h))) return "against H1 trend";
            if (_d1Ema != null)
            {
                int d = LastClosedIndex(_d1, TimeSpan.FromDays(1));
                if (d < DailyTrendEma) return "daily trend warming up";
                if (c.Buy ? _d1.ClosePrices[d] <= _d1Ema.Result[d] : _d1.ClosePrices[d] >= _d1Ema.Result[d]) return "against daily trend";
            }
            if (UsePivotBias)
            {
                double pivot = DailyPivot();
                double close = Bars.ClosePrices[i];
                if (!double.IsNaN(pivot) && (c.Buy ? close <= pivot : close >= pivot)) return "wrong side of daily pivot";
            }

            // Stop: the wider of the ATR stop and the structural stop. Size follows the stop,
            // so a wider stop means a smaller position, never a bigger loss.
            double entry = c.Buy ? Symbol.Ask : Symbol.Bid;
            double structural = c.Buy ? entry - c.StopPrice : c.StopPrice - entry;
            stopDist = Math.Max(c.MinStopDist, structural);
            if (stopDist > MaxStopAtr * atr) return "stop too wide";
            tpDist = double.IsNaN(c.TargetPrice) ? stopDist * c.Rr : (c.Buy ? c.TargetPrice - entry : entry - c.TargetPrice);
            if (tpDist <= 0 || tpDist / stopDist < c.MinRr) return "reward/risk too low";

            riskMoney = Account.Equity * RiskPerTradePct / 100.0;
            double openRisk = 0;
            foreach (var p in open)
            {
                if (!p.StopLoss.HasValue) return "unprotected bot position open";
                double dist = p.TradeType == TradeType.Buy ? p.EntryPrice - p.StopLoss.Value : p.StopLoss.Value - p.EntryPrice;
                if (dist > 0) openRisk += Symbol.AmountRisked(p.VolumeInUnits, dist / Symbol.PipSize);
            }
            if (openRisk + riskMoney > Account.Equity * MaxOpenRiskPct / 100.0 + 1e-6) return "open-risk cap";

            double stopPips = stopDist / Symbol.PipSize;
            volume = Symbol.NormalizeVolumeInUnits(Symbol.VolumeForFixedRisk(riskMoney, stopPips, RoundingMode.Down), RoundingMode.Down);
            volume = Math.Min(volume, Symbol.VolumeInUnitsMax);
            if (volume < Symbol.VolumeInUnitsMin || Symbol.AmountRisked(volume, stopPips) > riskMoney * MaxVolumeOverRisk)
                return "minimum lot risks more than the per-trade budget";
            return null;
        }

        // -----------------------------------------------------------------------------
        //  Risk and position management
        // -----------------------------------------------------------------------------
        private void CheckRisk()
        {
            double eq = Account.Equity;
            DateTime today = Server.Time.Date;
            if (today != _day) RollDay(today, eq);

            if (eq > _peakEquity)
            {
                _peakEquity = eq;
                if (eq > _lastSavedPeak * 1.001) _stateDirty = true; // written by the timer, not on every tick
            }
            if (!_dayHalt && eq <= _dayStartEquity * (1 - MaxDailyLossPct / 100.0))
            {
                _dayHalt = true;
                _dayHalts++;
                SaveState();
                Print("DAILY LOSS HALT: equity {0} is {1}% below today's start {2}. Closing all; no entries until 00:00 UTC.",
                    eq.ToString("F2", Inv), MaxDailyLossPct, _dayStartEquity.ToString("F2", Inv));
            }
            if (!_ddHalt && eq <= _peakEquity * (1 - MaxPeakDrawdownPct / 100.0))
            {
                _ddHalt = true;
                _ddTrips++;
                SaveState();
                Print("PEAK DRAWDOWN HALT: equity {0} is {1}% below peak {2}. Closing all. Review, then change KillSwitchEpoch in code to resume.",
                    eq.ToString("F2", Inv), MaxPeakDrawdownPct, _peakEquity.ToString("F2", Inv));
            }
            if (_dayHalt || _ddHalt) CloseAll("risk halt");

            DateTime t = Server.Time;
            if (t.DayOfWeek == DayOfWeek.Friday && t.TimeOfDay >= new TimeSpan(FridayFlatHourUtc, FridayFlatMinuteUtc, 0))
                CloseAll("weekend flat");
        }

        private void RollDay(DateTime today, double eq)
        {
            _day = today;
            _dayStartEquity = eq;
            _tradesToday = 0;
            _lossStreak = 0;
            _dayHalt = false;
            if (_ddHalt && !_persist)
            {
                // Backtest/optimisation only. Live, the halt holds until you change
                // KillSwitchEpoch. A backtest stands in for "halt, review, resume" by
                // re-arming next day, so one bad patch doesn't silence the rest of the test.
                // Every trip is counted and printed in the report; any trip is a red flag.
                _ddHalt = false;
                _peakEquity = eq;
                Print("[backtest] Peak-drawdown halt re-armed on {0:yyyy-MM-dd}; peak equity reset to {1}.", today, eq.ToString("F2", Inv));
            }
            SaveState();
        }

        private void ManagePositions()
        {
            if (Bars.Count < AtrPeriod + 3) return;
            double atr = _atr.Result.Last(1);
            if (!(atr > 0)) return;

            foreach (var p in BotPositions())
            {
                if (!p.StopLoss.HasValue)
                {
                    if (Server.Time >= _nextCloseAttempt)
                    {
                        _nextCloseAttempt = Server.Time.AddSeconds(15);
                        Print("Bot position {0} has no stop loss. Closing it.", p.Id);
                        ClosePosition(p);
                    }
                    continue;
                }
                Meta m = GetMeta(p);
                if (m == null || m.StopDist <= 0) continue;

                bool buy = p.TradeType == TradeType.Buy;
                double px = buy ? Symbol.Bid : Symbol.Ask;
                double sl = p.StopLoss.Value;
                double want = ExitMath.DesiredStop(buy, p.EntryPrice, px, sl, m.StopDist, m.TargetDist, atr, _exitRules, out bool atTarget);
                if (atTarget && _runners.Add(p.Id))
                    Print("RUNNER {0} {1}: target reached at {2}. Locking {3}% of it, then trailing {4} ATR behind price.",
                        m.Setup, p.Id, px.ToString("F2", Inv), (RunnerLock * 100).ToString("F0", Inv), RunnerTrailAtr.ToString(Inv));

                // Move only in steps of 0.05 ATR, so a trend doesn't send a modify request on every tick.
                double step = Math.Max(Symbol.TickSize, 0.05 * atr);
                double gap = Symbol.Spread + 2 * Symbol.TickSize;
                bool better = buy ? want >= sl + step : want <= sl - step;
                bool valid = buy ? want <= Symbol.Bid - gap : want >= Symbol.Ask + gap;
                if (better && valid)
                {
                    TradeResult r = p.ModifyStopLossPrice(Math.Round(want, Symbol.Digits));
                    if (!r.IsSuccessful) Print("Stop move failed on {0}: {1}", p.Id, r.Error);
                }
            }
        }

        private void OnPositionClosed(PositionClosedEventArgs args)
        {
            Position p = args.Position;
            if (p.Label != Label || p.SymbolName != SymbolName) return;
            Meta m = GetMeta(p);
            _meta.Remove(p.Id);

            double r = m != null && m.RiskMoney > 0 ? p.NetProfit / m.RiskMoney : double.NaN;
            bool loss = double.IsNaN(r) ? p.NetProfit < 0 : r <= -ScratchBandR;
            bool win = double.IsNaN(r) ? p.NetProfit > 0 : r >= ScratchBandR;
            if (loss) _lossStreak++;
            else if (win) _lossStreak = 0;
            if (_runners.Remove(p.Id) && m != null && !double.IsNaN(r) && m.TargetDist > 0)
                _runnerResults.Add((r, m.TargetDist / m.StopDist));
            SaveState();

            Print("CLOSED {0} {1} ({2}): net {3} = {4}R | loss streak {5}/{6}",
                m != null ? m.Setup : "?", p.Id, args.Reason, p.NetProfit.ToString("F2", Inv),
                double.IsNaN(r) ? "?" : r.ToString("F2", Inv), _lossStreak, MaxConsecutiveLosses);
        }

        private void CloseAll(string why)
        {
            Position[] list = BotPositions();
            if (list.Length == 0 || Server.Time < _nextCloseAttempt) return;
            _nextCloseAttempt = Server.Time.AddSeconds(15);
            foreach (var p in list)
            {
                TradeResult r = ClosePosition(p);
                if (r.IsSuccessful) Print("Closed {0} ({1}).", p.Id, why);
                else Print("Close FAILED on {0} ({1}): {2}. Retrying in 15 s.", p.Id, why, r.Error);
            }
        }

        private void AdoptOpenPositions()
        {
            foreach (var p in BotPositions())
            {
                if (!p.StopLoss.HasValue)
                {
                    Print("Bot position {0} has no stop loss (left over from a restart?). Closing it.", p.Id);
                    ClosePosition(p);
                    continue;
                }
                if (GetMeta(p) == null)
                    Print("Bot position {0} has no GoldGuard v3 comment. It keeps its stop and target but won't be trailed.", p.Id);
                if (p.EntryTime > _lastEntryBarTime) _lastEntryBarTime = p.EntryTime;
            }
            foreach (var t in BotHistory())
                if (t.EntryTime > _lastEntryBarTime) _lastEntryBarTime = t.EntryTime;
        }

        private Meta GetMeta(Position p)
        {
            if (_meta.TryGetValue(p.Id, out Meta m)) return m;
            m = ParseComment(p.Comment);
            if (m == null) return null;
            // Older comment without a target: the fixed take-profit was the target.
            if (double.IsNaN(m.TargetDist) && p.TakeProfit.HasValue) m.TargetDist = Math.Abs(p.TakeProfit.Value - p.EntryPrice);
            _meta[p.Id] = m;
            return m;
        }

        private Meta ParseComment(string comment)
        {
            if (string.IsNullOrEmpty(comment)) return null;
            string[] parts = comment.Split('|');
            if (parts.Length < 4 || parts[0] != CommentTag) return null;
            if (!double.TryParse(parts[2], NumberStyles.Float, Inv, out double stop) || stop <= 0) return null;
            double.TryParse(parts[3], NumberStyles.Float, Inv, out double risk);
            double target = double.NaN;
            if (parts.Length >= 5 && double.TryParse(parts[4], NumberStyles.Float, Inv, out double t) && t > 0) target = t;
            return new Meta { Setup = parts[1], StopDist = stop, RiskMoney = risk, TargetDist = target };
        }

        private Position[] BotPositions()
        {
            return Positions.FindAll(Label, SymbolName);
        }

        private List<HistoricalTrade> BotHistory()
        {
            return History.Where(t => t.Label == Label && t.SymbolName == SymbolName).OrderBy(t => t.ClosingTime).ToList();
        }

        // -----------------------------------------------------------------------------
        //  Time helpers
        // -----------------------------------------------------------------------------
        // Index of the newest bar of another timeframe that had fully closed when the
        // current M15 bar opened. Time-based, so it doesn't matter whether that series
        // has already received its new bar.
        private int LastClosedIndex(Bars series, TimeSpan length)
        {
            DateTime now = Bars.OpenTimes.LastValue;
            for (int j = series.Count - 1; j >= 0 && j >= series.Count - 6; j--)
                if (series.OpenTimes[j] + length <= now) return j;
            return -1;
        }

        // Classic floor pivot of the previous daily bar. Trading Central's levels are
        // proprietary; this only applies their rule "bullish while above the pivot".
        private double DailyPivot()
        {
            int d = LastClosedIndex(_d1, TimeSpan.FromDays(1));
            if (d < 0) return double.NaN;
            return (_d1.HighPrices[d] + _d1.LowPrices[d] + _d1.ClosePrices[d]) / 3.0;
        }

        private static bool InHours(int hour, int start, int end)
        {
            if (start == end) return true;
            return start < end ? hour >= start && hour < end : hour >= start || hour < end;
        }

        private bool InBlackout(TimeSpan t)
        {
            foreach (var w in _blackouts)
            {
                bool inside = w.From <= w.To ? t >= w.From && t < w.To : t >= w.From || t < w.To;
                if (inside) return true;
            }
            return false;
        }

        private string ValidateParameters()
        {
            if (H1Fast >= H1Slow) return "Fast H1 EMA must be below Slow H1 EMA.";
            if (MaxStopAtr < AtrStopMult) return "Max Stop (x ATR) is below ATR Stop Multiple, so every trade would be rejected.";
            if (MinAtrRatio >= MaxAtrRatio) return "Min ATR / Baseline must be below Max ATR / Baseline.";
            if (!EnablePullbacks && !EnableBreakouts && !EnableGartley && !EnableAbcd) return "Every setup is switched off.";
            if (RunnerEnabled && RunnerHardTp > 0 && RunnerHardTp < 1.5)
                return "Runner Hard TP must be 0 (none) or at least 1.5x the target, or it would cut runners short.";

            _blackouts.Clear();
            if (string.IsNullOrWhiteSpace(BlackoutWindows)) return null;
            string[] formats = { @"h\:mm", @"hh\:mm" };
            foreach (string raw in BlackoutWindows.Split(new[] { ',', ';' }, StringSplitOptions.RemoveEmptyEntries))
            {
                string[] parts = raw.Trim().Split('-');
                if (parts.Length != 2
                    || !TimeSpan.TryParseExact(parts[0].Trim(), formats, Inv, out TimeSpan from)
                    || !TimeSpan.TryParseExact(parts[1].Trim(), formats, Inv, out TimeSpan to)
                    || from.TotalHours >= 24 || to.TotalHours >= 24)
                    return "Blackout '" + raw.Trim() + "' is not in HH:mm-HH:mm form (UTC), e.g. 12:20-12:50.";
                _blackouts.Add((from, to));
            }
            return null;
        }

        // -----------------------------------------------------------------------------
        //  Persistent state (real-time instance only)
        // -----------------------------------------------------------------------------
        // Device scope: the halt survives removing and re-adding the instance, or renaming
        // the cBot. The key is per account and symbol.
        // LocalStorage keys may only hold Latin letters, digits and spaces, with no space at
        // either end (cTrader throws otherwise). A storage failure must never stop the bot:
        // it falls back from Device to Instance scope, then to memory only, and says so once.
        private LocalStorageScope _scope = LocalStorageScope.Device;
        private bool _storageOk = true;

        private string Get(string name)
        {
            for (int attempt = 0; attempt < 2 && _storageOk; attempt++)
            {
                try { return LocalStorage.GetString(Key(name), _scope); }
                catch (Exception e) { StorageFailed(e); }
            }
            return null;
        }

        private void Set(string name, string value)
        {
            for (int attempt = 0; attempt < 2 && _storageOk; attempt++)
            {
                try { LocalStorage.SetString(Key(name), value, _scope); return; }
                catch (Exception e) { StorageFailed(e); }
            }
        }

        private void FlushStore()
        {
            if (!_storageOk) return;
            try { LocalStorage.Flush(_scope); }
            catch (Exception e) { StorageFailed(e); }
        }

        private string Key(string name)
        {
            return ExitMath.StorageKey(StatePrefix, _keyAccount, _keySymbol, name);
        }

        private void StorageFailed(Exception e)
        {
            if (_scope == LocalStorageScope.Device)
            {
                _scope = LocalStorageScope.Instance;
                Print("Device storage unavailable ({0}); using instance storage. A drawdown halt then survives restarts of this instance only.", e.Message);
                return;
            }
            _storageOk = false;
            Print("Local storage unavailable ({0}). Risk state is kept in memory for this run only.", e.Message);
        }

        private double ReadDouble(string name, double fallback)
        {
            return double.TryParse(Get(name), NumberStyles.Float, Inv, out double v) && v > 0 ? v : fallback;
        }

        private int ReadInt(string name, int fallback)
        {
            return int.TryParse(Get(name), NumberStyles.Integer, Inv, out int v) ? v : fallback;
        }

        private void LoadState()
        {
            double eq = Account.Equity;
            _day = Server.Time.Date;
            _dayStartEquity = eq;
            _peakEquity = eq;
            _tradesToday = 0;
            _lossStreak = 0;
            _dayHalt = false;
            _ddHalt = false;

            if (_persist)
            {
                int epoch = ReadInt("epoch", -1);
                if (epoch == KillSwitchEpoch)
                {
                    _peakEquity = Math.Max(ReadDouble("peak", eq), eq);
                    _ddHalt = ReadInt("ddHalt", 0) == 1;
                }
                else if (epoch != -1)
                {
                    Print("KillSwitchEpoch changed from {0} to {1}: drawdown halt cleared, peak equity restarts at {2}.",
                        epoch, KillSwitchEpoch, eq.ToString("F2", Inv));
                }
                if (Get("day") == _day.ToString("yyyyMMdd", Inv))
                {
                    _dayStartEquity = ReadDouble("dayEquity", eq);
                    _tradesToday = ReadInt("trades", 0);
                    _lossStreak = ReadInt("losses", 0);
                    _dayHalt = ReadInt("dayHalt", 0) == 1;
                }
                if (_ddHalt) Print("Peak-drawdown halt is ACTIVE from an earlier run. No entries until KillSwitchEpoch is changed.");
            }
            SaveState();
        }

        private void SaveState()
        {
            _stateDirty = false;
            _lastSavedPeak = _peakEquity;
            if (!_persist) return;
            Set("epoch", KillSwitchEpoch.ToString(Inv));
            Set("day", _day.ToString("yyyyMMdd", Inv));
            Set("dayEquity", _dayStartEquity.ToString("R", Inv));
            Set("peak", _peakEquity.ToString("R", Inv));
            Set("trades", _tradesToday.ToString(Inv));
            Set("losses", _lossStreak.ToString(Inv));
            Set("dayHalt", _dayHalt ? "1" : "0");
            Set("ddHalt", _ddHalt ? "1" : "0");
            FlushStore();
        }

        // -----------------------------------------------------------------------------
        //  Reporting
        // -----------------------------------------------------------------------------
        private static void Count(Dictionary<string, int> map, string key)
        {
            map.TryGetValue(key, out int n);
            map[key] = n + 1;
        }

        private void Skip(string setup, string why)
        {
            Count(_skips, setup + ": " + why);
            _lastSkip = setup + " " + why + " (" + Server.Time.ToString("dd MMM HH:mm", Inv) + ")";
        }

        private void UpdatePanel()
        {
            if (!_visual) return;
            double eq = Account.Equity;
            double dayPct = _dayStartEquity > 0 ? (eq / _dayStartEquity - 1) * 100 : 0;
            double ddPct = _peakEquity > 0 ? (1 - eq / _peakEquity) * 100 : 0;
            string state = _ddHalt ? "HALTED: peak drawdown (change KillSwitchEpoch after review)"
                : _dayHalt ? "HALTED for today: daily loss"
                : _lossStreak >= MaxConsecutiveLosses ? "PAUSED for today: loss streak"
                : _tradesToday >= MaxTradesPerDay ? "PAUSED for today: trade cap"
                : "ARMED";
            var sb = new StringBuilder();
            sb.AppendLine("GoldGuard v3  |  " + state);
            sb.AppendLine(string.Format(Inv, "Day {0:+0.00;-0.00;0.00}% (halt -{1}%)   Off peak {2:0.00}% (halt {3}%)",
                dayPct, MaxDailyLossPct, ddPct, MaxPeakDrawdownPct));
            sb.AppendLine(string.Format(Inv, "Trades today {0}/{1}   Loss streak {2}/{3}   Open {4}/{5}",
                _tradesToday, MaxTradesPerDay, _lossStreak, MaxConsecutiveLosses, BotPositions().Length, MaxOpenPositions));
            if (_lastSkip != null) sb.AppendLine("Last skip: " + _lastSkip);
            Chart.DrawStaticText("gg3_panel", sb.ToString(), VerticalAlignment.Top, HorizontalAlignment.Left, Color.Orange);
        }

        // Draws X-A-B-C and the projected D on the chart (live and visual backtests), so the
        // detector can be compared with the Autochartist pattern on the same chart.
        private void DrawPattern(string key, HarmonicMath.Pattern p)
        {
            if (!_visual || !_drawn.Add(key)) return;
            Color col = p.Bull ? Color.DodgerBlue : Color.OrangeRed;
            var pts = new List<HarmonicMath.Swing> { p.X, p.A, p.B, p.C }.Where(s => s != null).ToList();
            for (int j = 0; j + 1 < pts.Count; j++)
                Chart.DrawTrendLine(key + "_l" + j, Bars.OpenTimes[pts[j].Index], pts[j].Price,
                    Bars.OpenTimes[pts[j + 1].Index], pts[j + 1].Price, col);
            DateTime tc = Bars.OpenTimes[p.C.Index];
            int span = Math.Max(8, p.C.Index - p.FirstIndex);
            Chart.DrawTrendLine(key + "_d", tc, p.D, tc.AddMinutes(15 * span), p.D, col, 1, LineStyle.Dots);
            Chart.DrawText(key + "_t", p.Setup + " D " + p.D.ToString("F2", Inv), tc, p.D, col);
        }

        private static double RMultiple(HistoricalTrade t, Func<string, Meta> parse)
        {
            Meta m = parse(t.Comment);
            return m != null && m.RiskMoney > 0 ? t.NetProfit / m.RiskMoney : double.NaN;
        }

        private void Report()
        {
            List<HistoricalTrade> trades = BotHistory();
            Print("==================== GoldGuard v3 report ({0}) ====================", RunningMode);
            Print("Closed trades {0} | daily-loss halts {1} | peak-drawdown halts {2}{3}",
                trades.Count, _dayHalts, _ddTrips, _ddTrips > 0 ? "  <-- RED FLAG: the kill switch tripped" : "");

            foreach (string setup in new[] { "PB", "BO", "GT", "AB", "ALL" })
            {
                var g = setup == "ALL" ? trades : trades.Where(t => SetupOf(t.Comment) == setup).ToList();
                if (g.Count == 0) continue;
                double won = g.Where(t => t.NetProfit > 0).Sum(t => t.NetProfit);
                double lost = -g.Where(t => t.NetProfit < 0).Sum(t => t.NetProfit);
                double pf = lost > 0 ? won / lost : double.PositiveInfinity;
                var rs = g.Select(t => RMultiple(t, ParseComment)).Where(r => !double.IsNaN(r)).ToList();
                Print("{0,-3} trades {1,4} | win {2,5}% | PF {3,6} | net {4,10} | avg {5,6}R",
                    setup, g.Count, (100.0 * g.Count(t => t.NetProfit > 0) / g.Count).ToString("F1", Inv),
                    pf.ToString("F2", Inv), g.Sum(t => t.NetProfit).ToString("F2", Inv),
                    rs.Count > 0 ? rs.Average().ToString("F2", Inv) : "n/a");
            }

            int run = 0, worst = 0;
            foreach (var t in trades)
            {
                run = t.NetProfit < 0 ? run + 1 : 0;
                worst = Math.Max(worst, run);
            }
            Print("Longest losing run: {0} trades", worst);

            // Did trailing past the target beat closing at it? (this run's positions)
            if (_runnerResults.Count > 0)
                Print("Runners: {0} trades reached target and trailed on | exit avg {1}R vs target avg {2}R | best {3}R | {4} exited below target",
                    _runnerResults.Count, _runnerResults.Average(x => x.ExitR).ToString("F2", Inv),
                    _runnerResults.Average(x => x.TargetR).ToString("F2", Inv), _runnerResults.Max(x => x.ExitR).ToString("F2", Inv),
                    _runnerResults.Count(x => x.ExitR < x.TargetR));

            foreach (string setup in _signals.Keys.OrderBy(k => k))
            {
                _taken.TryGetValue(setup, out int taken);
                Print("Signals {0}: {1} found, {2} traded", setup, _signals[setup], taken);
            }
            foreach (var kv in _skips.OrderByDescending(kv => kv.Value).Take(15))
                Print("  skipped {0,5}x  {1}", kv.Value, kv.Key);
        }

        private string SetupOf(string comment)
        {
            Meta m = ParseComment(comment);
            return m != null ? m.Setup : "?";
        }

        // One row per closed trade in the format cbot-gate reads (see
        // skills/cbot-gate/references/exporting-trades.md), plus Setup and R columns.
        private void WriteCsv()
        {
            try
            {
                List<HistoricalTrade> trades = BotHistory();
                if (trades.Count == 0) return;
                var sb = new StringBuilder("Closing Time,Entry Time,Symbol,Direction,Volume,Pips,Gross,Commissions,Swap,Net Profit,Balance,Setup,R,Target R\n");
                foreach (var t in trades)
                {
                    double r = RMultiple(t, ParseComment);
                    Meta tm = ParseComment(t.Comment);
                    double targetR = tm != null && tm.TargetDist > 0 ? tm.TargetDist / tm.StopDist : double.NaN;
                    sb.AppendLine(string.Join(",",
                        t.ClosingTime.ToString("yyyy-MM-dd HH:mm:ss", Inv),
                        t.EntryTime.ToString("yyyy-MM-dd HH:mm:ss", Inv),
                        t.SymbolName, t.TradeType, t.VolumeInUnits.ToString(Inv),
                        t.Pips.ToString(Inv), t.GrossProfit.ToString(Inv),
                        t.Commissions.ToString(Inv), t.Swap.ToString(Inv),
                        t.NetProfit.ToString(Inv), t.Balance.ToString(Inv),
                        SetupOf(t.Comment), double.IsNaN(r) ? "" : r.ToString("F3", Inv),
                        double.IsNaN(targetR) ? "" : targetR.ToString("F3", Inv)));
                }
                string mode = RunningMode == RunningMode.RealTime ? "demo" : "backtest";
                string name = string.Format(Inv, "GoldGuardV3_{0}_m15_{1}_{2:yyyyMMdd_HHmmss}.csv",
                    SymbolName.Replace(".", "_"), mode, DateTime.Now);
                string dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), "cBotLogs");
                Directory.CreateDirectory(dir);
                string path = Path.Combine(dir, name);
                System.IO.File.WriteAllText(path, sb.ToString());
                Print("Trade log for cbot-gate: {0}", path);
            }
            catch (Exception ex)
            {
                Print("Trade log not written: {0}", ex.Message);
            }
        }
    }

    // =====================================================================================
    //  Exit maths. Plain C#, unit-tested outside cTrader (see tests/ExitTests.cs).
    // =====================================================================================
    public sealed class ExitRules
    {
        public double BreakEvenAtR, BreakEvenLockR;   // move to break-even (+lock) at this R
        public bool Trail;
        public double TrailStartR, TrailAtrMult;      // ATR trail before the target
        public bool Runner;
        public double RunnerLock, RunnerTrailAtr;     // at the target: lock a share, trail close
    }

    public static class ExitMath
    {
        /// LocalStorage key: Latin letters, digits and single spaces only, no space at either end.
        public static string StorageKey(string prefix, long account, string symbol, string name)
        {
            string Clean(string s) => new string((s ?? "").Where(c => (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9')).ToArray());
            return string.Join(" ", new[] { Clean(prefix), account.ToString(CultureInfo.InvariantCulture), Clean(symbol), Clean(name) }.Where(x => x.Length > 0));
        }

        // The stop a position should have right now. It is never looser than currentStop:
        // a stop only ever moves in the trade's favour.
        //   1. at BreakEvenAtR:        entry + BreakEvenLockR x R
        //   2. from TrailStartR:       TrailAtrMult x ATR behind price
        //   3. runner, once price has covered the target distance:
        //        at least RunnerLock x target locked in, and
        //        RunnerTrailAtr x ATR behind price from then on (the close trail)
        // atTarget is true while price is at or beyond the target in runner mode.
        public static double DesiredStop(bool buy, double entry, double price, double currentStop,
            double stopDist, double targetDist, double atr, ExitRules r, out bool atTarget)
        {
            atTarget = false;
            if (!(stopDist > 0)) return currentStop;
            double s = buy ? 1 : -1;
            double gain = s * (price - entry);
            double gainR = gain / stopDist;
            double want = currentStop;

            if (gainR >= r.BreakEvenAtR)
                want = Tighter(s, want, entry + s * r.BreakEvenLockR * stopDist);
            if (r.Trail && gainR >= r.TrailStartR)
                want = Tighter(s, want, price - s * r.TrailAtrMult * atr);
            if (r.Runner && targetDist > 0 && gain >= targetDist)
            {
                atTarget = true;
                want = Tighter(s, want, entry + s * r.RunnerLock * targetDist);
                want = Tighter(s, want, price - s * r.RunnerTrailAtr * atr);
            }
            return want;
        }

        // The tighter of two stops: higher for a buy, lower for a sell.
        private static double Tighter(double s, double current, double candidate)
        {
            return s * (candidate - current) > 0 ? candidate : current;
        }
    }

    // =====================================================================================
    //  Harmonic pattern maths. Plain C# with no cTrader types, so it is unit-tested
    //  outside cTrader (see tests/HarmonicTests.cs).
    // =====================================================================================
    public static class HarmonicMath
    {
        public sealed class Swing
        {
            public int Index;
            public double Price;
            public bool High;
        }

        public sealed class Pattern
        {
            public string Setup;      // "GT" Gartley or "AB" AB=CD
            public bool Bull;         // true = buy at D
            public Swing X, A, B, C;  // X is null for AB=CD
            public double D, Stop, Target;
            public int FirstIndex { get { return (X ?? A).Index; } }
        }

        // +1 if bar c is a swing high, -1 a swing low, 0 neither: the extreme of k bars on
        // each side (earlier bars strictly, later bars may tie). An outside bar that is both
        // counts only as the side that continues the zigzag.
        public static int SwingAt(int c, int k, Func<int, double> high, Func<int, double> low, bool lastWasHigh)
        {
            double hi = high(c), lo = low(c);
            bool isHigh = true, isLow = true;
            for (int j = 1; j <= k; j++)
            {
                if (high(c - j) >= hi || high(c + j) > hi) isHigh = false;
                if (low(c - j) <= lo || low(c + j) < lo) isLow = false;
            }
            if (isHigh && isLow)
            {
                if (lastWasHigh) isHigh = false;
                else isLow = false;
            }
            return isHigh ? 1 : isLow ? -1 : 0;
        }

        // Zigzag rules: highs and lows alternate; a second high (low) in a row replaces the
        // first if it is more extreme; a leg shorter than minLeg is ignored.
        public static void AddSwing(List<Swing> swings, int index, double price, bool high, double minLeg, int keep = 60)
        {
            Swing last = swings.Count > 0 ? swings[swings.Count - 1] : null;
            if (last != null && last.High == high)
            {
                if (high ? price > last.Price : price < last.Price)
                {
                    last.Index = index;
                    last.Price = price;
                }
                return;
            }
            if (last != null && Math.Abs(price - last.Price) < minLeg) return;
            swings.Add(new Swing { Index = index, Price = price, High = high });
            if (swings.Count > keep) swings.RemoveAt(0);
        }

        // Matches the newest swings against a Gartley (checked first) or an AB=CD.
        // stopBuffer is a price distance; targetRetrace is the share of AD (Gartley) or
        // CD (AB=CD) to aim for from D.
        public static Pattern Match(IList<Swing> swings, bool gartley, bool abcd, double tol, double stopBuffer, double targetRetrace)
        {
            int n = swings.Count;
            if (n < 3) return null;
            Swing c = swings[n - 1], b = swings[n - 2], a = swings[n - 3];
            Swing x = n >= 4 ? swings[n - 4] : null;
            bool bull = c.High;        // last swing a high: price is falling towards a bullish D
            double s = bull ? 1 : -1;  // sign trick: the same maths serves both directions

            if (gartley && x != null)
            {
                double xa = s * (a.Price - x.Price), ab = s * (a.Price - b.Price), bc = s * (c.Price - b.Price);
                if (xa > 0 && ab > 0 && bc > 0 && s * (b.Price - x.Price) > 0 && s * (a.Price - c.Price) >= 0)
                {
                    double d = a.Price - s * 0.786 * xa;
                    double cd = s * (c.Price - d);
                    if (Math.Abs(ab / xa - 0.618) <= tol && Within(bc / ab, 0.382, 0.886, tol) && Within(cd / bc, 1.13, 1.618, tol))
                        return new Pattern
                        {
                            Setup = "GT", Bull = bull, X = x, A = a, B = b, C = c, D = d,
                            Stop = x.Price - s * stopBuffer,                       // a Gartley is wrong beyond X
                            Target = d + s * targetRetrace * Math.Abs(a.Price - d),
                        };
                }
            }
            if (abcd)
            {
                double ab = s * (a.Price - b.Price), bc = s * (c.Price - b.Price);
                if (ab > 0 && bc > 0 && s * (a.Price - c.Price) > 0 && Within(bc / ab, 0.382, 0.886, tol))
                {
                    double d = c.Price - s * ab;                                   // CD = AB
                    return new Pattern
                    {
                        Setup = "AB", Bull = bull, A = a, B = b, C = c, D = d,
                        Stop = d - s * stopBuffer,
                        Target = d + s * targetRetrace * Math.Abs(c.Price - d),
                    };
                }
            }
            return null;
        }

        // Bars C+1..i (i = last closed bar): +1 enter now (price reached the D zone and bar i
        // closed back beyond D in the reversal direction), 0 keep waiting, -1 dead (price
        // ran through the stop).
        public static int Trigger(Pattern p, int i, Func<int, double> high, Func<int, double> low, double open, double close, double zone)
        {
            double s = p.Bull ? 1 : -1;
            double edge = p.D + s * zone;
            bool touched = false;
            for (int j = p.C.Index + 1; j <= i; j++)
            {
                double towardC = p.Bull ? high(j) : low(j);
                double towardD = p.Bull ? low(j) : high(j);
                if (s * (towardC - p.C.Price) > 0) return 0;   // beyond C: the C-D leg isn't under way
                if (s * (towardD - p.Stop) <= 0) return -1;
                if (s * (towardD - edge) <= 0) touched = true;
            }
            return touched && s * (close - open) > 0 && s * (close - p.D) > 0 ? 1 : 0;
        }

        private static bool Within(double v, double lo, double hi, double tol)
        {
            return v >= lo - tol && v <= hi + tol;
        }
    }
}

// =====================================================================================
//  GoldBreakout XAUUSD  -  London breakout of the Asian range, with the daily trend
//
//  DEMO ONLY. The highest-frequency gold strategy with an edge in the Nov 2026 research
//  (cbots/GoldResearch, "High-frequency round"): about 100 trades a year.
//    Sep 2016 - Dec 2022  PF 1.12 (1.15 without 2020-21)  526 trades
//    Jan 2023 - Oct 2026  PF 1.23 (run once, untouched)    435 trades
//  cbot-gate: FAIL (OOS PF 1.23 < 1.30; PF 0.94 without its best 22 trades).
//  A demo forward test reaches the gate's 100 trades in about a year.
//
//  Clock: everything below is on the usual broker clock, New York time + 7h, so the
//  trading day starts at 17:00 New York and the hours follow US daylight saving.
//  The cBot runs in New York time and converts; your chart's time zone doesn't matter.
//
//  Each trading day (Mon-Fri):
//    1. Asian range = high and low of the M1 bars from 03:00 to 08:00 (bid prices).
//    2. Skip the day if the range is under 0.30% or over 1.60% of price.
//    3. At 08:00: buy stop at range high + 0.01%, sell stop at range low - 0.01%.
//       With the trend filter (default) only the order in the direction of the daily
//       trend is placed: yesterday's close above the 100-day EMA = buys only.
//       If price breaks the OTHER side first, the day is cancelled.
//    4. Stop at the other side of the range, capped at 0.60% of price.
//       Target 2.5 x the risk. At 1.5 x the risk the stop moves to entry.
//    5. 21:00: close any position, cancel any order. One trade a day. Never overnight,
//       never over a weekend (Friday 21:00 = 14:00 New York).
// =====================================================================================

using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text;
using cAlgo.API;
using cAlgo.API.Internals;

namespace cAlgo.Robots
{
    [Robot(TimeZone = TimeZones.EasternStandardTime, AccessRights = AccessRights.None)]
    public class GoldBreakoutXauusd : Robot
    {
        // -----------------------------------------------------------------------------
        //  RISK - fixed constants. Change only here, rebuild, and re-validate.
        // -----------------------------------------------------------------------------
        private const double RiskPerTradePct = 0.5;      // % of equity lost if the stop is hit
        private const double MaxPeakDrawdownPct = 6.0;   // vs peak equity: close all, halt until KillSwitchEpoch changes
        private const double MaxVolumeOverRisk = 1.01;   // broker lot rounding may overshoot the risk by at most 1%
        private const bool DemoOnly = true;
        private const double TargetR = 2.5;              // take-profit at 2.5 x the initial risk (researched value)
        private const double BreakEvenR = 1.5;           // stop to entry once a close is 1.5 x the risk in profit

        // To clear a tripped peak-drawdown halt after reviewing it, change this to 2, 3, ...
        // in code and rebuild. Peak equity then restarts from current equity.
        private const int KillSwitchEpoch = 1;

        private const string Label = "GoldBreakout-XAU";
        private const string CommentTag = "GB1";
        private const string StatePrefix = "GoldBreakout";
        private const int BrokerClockOffsetHours = 7;    // broker clock = New York + 7h

        // -----------------------------------------------------------------------------
        //  Parameters (defaults = the researched settings; don't optimise them on the
        //  same years you then judge them on)
        // -----------------------------------------------------------------------------
        [Parameter("Range Start Hour", Group = "Session (broker clock = New York + 7h)", DefaultValue = 3, MinValue = 0, MaxValue = 23)]
        public int RangeStartHour { get; set; }

        [Parameter("Range End / Orders Hour", Group = "Session (broker clock = New York + 7h)", DefaultValue = 8, MinValue = 1, MaxValue = 23)]
        public int RangeEndHour { get; set; }

        [Parameter("Flat Hour", Group = "Session (broker clock = New York + 7h)", DefaultValue = 21, MinValue = 2, MaxValue = 23)]
        public int FlatHour { get; set; }

        [Parameter("Min Range %", Group = "Range", DefaultValue = 0.30, MinValue = 0.0, MaxValue = 5.0, Step = 0.05)]
        public double MinRangePct { get; set; }

        [Parameter("Max Range %", Group = "Range", DefaultValue = 1.60, MinValue = 0.1, MaxValue = 10.0, Step = 0.1)]
        public double MaxRangePct { get; set; }

        [Parameter("Entry Buffer %", Group = "Range", DefaultValue = 0.01, MinValue = 0.0, MaxValue = 0.5, Step = 0.01)]
        public double BufferPct { get; set; }

        [Parameter("Stop Cap %", Group = "Exits", DefaultValue = 0.60, MinValue = 0.1, MaxValue = 5.0, Step = 0.05)]
        public double StopCapPct { get; set; }

        [Parameter("Use Daily Trend Filter", Group = "Trend", DefaultValue = true)]
        public bool UseTrendFilter { get; set; }

        [Parameter("Trend EMA (days)", Group = "Trend", DefaultValue = 100, MinValue = 10, MaxValue = 400, Step = 10)]
        public int TrendEmaDays { get; set; }

        [Parameter("Fitness Min Trades", Group = "Validation", DefaultValue = 100, MinValue = 1, MaxValue = 5000)]
        public int FitnessMinTrades { get; set; }

        // -----------------------------------------------------------------------------
        //  State
        // -----------------------------------------------------------------------------
        private static readonly CultureInfo Inv = CultureInfo.InvariantCulture;
        private Bars _m1, _h1;
        private bool _persist, _ddHalt;
        private long _keyAccount;
        private string _keySymbol;
        private double _peakEquity, _lastSavedPeak;
        private int _ddTrips, _daysPlanned, _entries;

        // daily closes on the broker clock, built from H1 bars
        private int _dailyCount;
        private double _ema, _lastDailyClose;

        // today
        private DateTime _planDay = DateTime.MinValue;
        private DayPlan _plan;
        private int _trendSide;          // +1 buys only, -1 sells only, 0 both (filter off)
        private bool _dayDone;           // cancelled, traded, or skipped
        private string _status = "waiting for 08:00";
        private readonly Dictionary<int, double> _risk = new Dictionary<int, double>();   // position id -> initial risk (price)
        private readonly Dictionary<string, int> _skips = new Dictionary<string, int>();

        // -----------------------------------------------------------------------------
        //  Lifecycle
        // -----------------------------------------------------------------------------
        protected override void OnStart()
        {
            if (DemoOnly && Account.IsLive)
            {
                Print("DEMO ONLY: this is a live account. GoldBreakout stays on demo until it has passed cbot-gate.");
                Stop();
                return;
            }
            string sym = SymbolName.ToUpperInvariant();
            if (!(sym.Contains("XAUUSD") || sym.StartsWith("GOLD")))
            {
                Print("Attach GoldBreakout to an XAUUSD (gold) chart. Current symbol: {0}.", SymbolName);
                Stop();
                return;
            }
            if (!(RangeStartHour < RangeEndHour && RangeEndHour < FlatHour) || MinRangePct >= MaxRangePct)
            {
                Print("Parameter error: needs Range Start < Range End < Flat Hour and Min Range % < Max Range %.");
                Stop();
                return;
            }

            _persist = RunningMode == RunningMode.RealTime;
            _keyAccount = Account.Number; _keySymbol = SymbolName;

            _h1 = MarketData.GetBars(TimeFrame.Hour);
            try { while (_h1.Count < (TrendEmaDays * 3 + 10) * 24 && _h1.LoadMoreHistory() > 0) { } }
            catch (Exception e) { Print("Could not load more H1 history: {0}", e.Message); }
            _m1 = MarketData.GetBars(TimeFrame.Minute);

            // Daily closes from all complete H1 history (the forming bar is excluded).
            for (int i = 0; i < _h1.Count - 1; i++) FeedH1(i);
            _h1.BarOpened += e => FeedH1(_h1.Count - 2);
            _m1.BarOpened += OnMinuteBar;
            Positions.Opened += OnPositionOpened;

            LoadState();
            AdoptExisting();

            Print("GoldBreakout on {0} | mode {1} | {2} daily closes (EMA{3} {4}) | range {5:00}-{6:00}, flat {7:00} broker clock | trend filter {8} | risk {9}% per trade, DD halt {10}%, epoch {11}",
                SymbolName, RunningMode, _dailyCount, TrendEmaDays, _dailyCount > 0 ? _ema.ToString("F2", Inv) : "n/a",
                RangeStartHour, RangeEndHour, FlatHour, UseTrendFilter, RiskPerTradePct, MaxPeakDrawdownPct, KillSwitchEpoch);
            if (_dailyCount < TrendEmaDays && UseTrendFilter)
                Print("Warning: only {0} daily closes for a {1}-day EMA. The trend filter is unreliable until more history loads.", _dailyCount, TrendEmaDays);
            if (_persist) Timer.Start(TimeSpan.FromSeconds(30));
            UpdatePanel();
        }

        protected override void OnTimer()
        {
            CheckRisk();
            if (_peakEquity > _lastSavedPeak * 1.001) SaveState();
            UpdatePanel();
        }

        protected override void OnStop()
        {
            SaveState();
            if (RunningMode == RunningMode.Optimization) return;
            var mine = History.Where(h => h.Label == Label && h.SymbolName == SymbolName).ToList();
            double gp = mine.Where(h => h.NetProfit > 0).Sum(h => h.NetProfit);
            double gl = -mine.Where(h => h.NetProfit < 0).Sum(h => h.NetProfit);
            Print("==================== GoldBreakout report ({0}) ====================", RunningMode);
            Print("trades {0} | wins {1} | PF {2} | net {3} | longs {4} | shorts {5} | days planned {6} | entries {7} | peak-DD halts {8}",
                mine.Count, mine.Count(h => h.NetProfit > 0), gl > 0 ? (gp / gl).ToString("F2", Inv) : "n/a",
                (gp - gl).ToString("F2", Inv), mine.Count(h => h.TradeType == TradeType.Buy),
                mine.Count(h => h.TradeType == TradeType.Sell), _daysPlanned, _entries, _ddTrips);
            foreach (var kv in _skips.OrderByDescending(k => k.Value))
                Print("  {0,5}x  {1}", kv.Value, kv.Key);
        }

        // Profit Factor first, as cbot-gate judges. Too few trades always scores below any
        // run with enough trades; drawdown takes a small deduction.
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
        //  Broker clock and daily trend
        // -----------------------------------------------------------------------------
        private static DateTime Broker(DateTime newYork)
        {
            return BreakoutMath.BrokerClock(newYork, BrokerClockOffsetHours);
        }

        // H1 bar i is complete. When the next bar starts a new broker day, bar i's close is
        // that day's close.
        private void FeedH1(int i)
        {
            if (i < 0 || i + 1 >= _h1.Count) return;
            DateTime day = Broker(_h1.OpenTimes[i]).Date;
            DateTime next = Broker(_h1.OpenTimes[i + 1]).Date;
            if (next == day) return;
            double close = _h1.ClosePrices[i];
            _ema = _dailyCount == 0 ? close : BreakoutMath.EmaNext(_ema, close, TrendEmaDays);
            _lastDailyClose = close;
            _dailyCount++;
        }

        // -----------------------------------------------------------------------------
        //  Minute bar: plan at 08:00, break-even, flat at 21:00
        // -----------------------------------------------------------------------------
        private void OnMinuteBar(BarOpenedEventArgs e)
        {
            CheckRisk();
            DateTime b = Broker(_m1.OpenTimes.LastValue);
            DateTime day = b.Date;
            int minute = b.Hour * 60 + b.Minute;

            // Anything still open from an earlier broker day: close it (missed 21:00 flat).
            foreach (var p in BotPositions().ToList())
                if (Broker(p.EntryTime).Date != day) { ClosePosition(p); Print("Closed {0} left over from {1:yyyy-MM-dd}.", p.Id, Broker(p.EntryTime).Date); }

            if (minute >= FlatHour * 60)
            {
                if (BotOrders().Any() || BotPositions().Any())
                {
                    foreach (var o in BotOrders().ToList()) CancelPendingOrder(o);
                    foreach (var p in BotPositions().ToList()) ClosePosition(p);
                    _status = "flat at " + FlatHour + ":00";
                }
                _dayDone = true;
                return;
            }

            if (minute >= RangeEndHour * 60 && _planDay != day) PlanDay(day, b);

            ManageBreakEven();
            WatchOtherSide();
        }

        protected override void OnTick()
        {
            WatchOtherSide();
        }

        private void PlanDay(DateTime day, DateTime now)
        {
            _planDay = day;
            _plan = null;
            _dayDone = true;
            if (day.DayOfWeek == DayOfWeek.Saturday || day.DayOfWeek == DayOfWeek.Sunday) return;
            if (now.Hour * 60 + now.Minute > RangeEndHour * 60 + 5 && RunningMode == RunningMode.RealTime)
            {
                Skip("started after the order time; first plan tomorrow");
                return;
            }
            if (_ddHalt) { Skip("halt: peak drawdown"); return; }

            // Asian range from the M1 bars already closed today, RangeStartHour..RangeEndHour.
            double hi = double.MinValue, lo = double.MaxValue, last = double.NaN;
            int n = 0;
            for (int i = _m1.Count - 2; i >= 0; i--)
            {
                DateTime t = Broker(_m1.OpenTimes[i]);
                if (t.Date != day || t.Hour < RangeStartHour) break;
                if (t.Hour >= RangeEndHour) continue;
                if (double.IsNaN(last)) last = _m1.ClosePrices[i];
                hi = Math.Max(hi, _m1.HighPrices[i]);
                lo = Math.Min(lo, _m1.LowPrices[i]);
                n++;
            }
            int need = (int)Math.Ceiling((RangeEndHour - RangeStartHour) * 60 * 0.6);
            if (n < need) { Skip("not enough range bars"); return; }

            var plan = BreakoutMath.Plan(hi, lo, last, MinRangePct, MaxRangePct, BufferPct);
            if (!plan.Valid) { Skip(plan.Why); _status = "no trade: " + plan.Why; return; }

            _trendSide = 0;
            if (UseTrendFilter)
            {
                if (_dailyCount < 2) { Skip("trend not ready"); return; }
                _trendSide = BreakoutMath.TrendSide(_lastDailyClose, _ema);
                if (_trendSide == 0) { Skip("close equals EMA"); return; }
            }
            _daysPlanned++;
            _plan = plan;
            _dayDone = false;

            // Price already beyond a level at 08:00: the harness treats that as a break
            // in the first minute.
            bool buyOk = _trendSide >= 0, sellOk = _trendSide <= 0;
            if (Symbol.Bid <= plan.SellLevel && !sellOk) { CancelDay("broke the other side first"); return; }
            if (Symbol.Ask >= plan.BuyLevel && !buyOk) { CancelDay("broke the other side first"); return; }

            string comment = string.Join("|", CommentTag, plan.Hi.ToString("R", Inv), plan.Lo.ToString("R", Inv),
                plan.BuyLevel.ToString("R", Inv), plan.SellLevel.ToString("R", Inv), _trendSide.ToString(Inv));
            if (buyOk) PlaceSide(TradeType.Buy, plan, comment);
            if (sellOk && !_dayDone) PlaceSide(TradeType.Sell, plan, comment);
            _status = string.Format(Inv, "range {0:F2}-{1:F2} | {2}", plan.Lo, plan.Hi,
                _trendSide > 0 ? "buy stop " + plan.BuyLevel.ToString("F2", Inv) : _trendSide < 0 ? "sell stop " + plan.SellLevel.ToString("F2", Inv) : "both sides");
            UpdatePanel();
        }

        private void PlaceSide(TradeType type, DayPlan plan, string comment)
        {
            bool buy = type == TradeType.Buy;
            double level = buy ? plan.BuyLevel : plan.SellLevel;
            BreakoutMath.Levels(buy, level, plan, StopCapPct, TargetR, out double stop, out double target, out double dist);
            string why = Size(dist, out double volume);
            if (why != null) { Skip(why); CancelDay(why); return; }

            bool through = buy ? Symbol.Ask >= level : Symbol.Bid <= level;
            TradeResult r = through
                ? ExecuteMarketOrder(type, SymbolName, volume, Label, dist / Symbol.PipSize, TargetR * dist / Symbol.PipSize, comment)
                : PlaceStopOrder(type, SymbolName, volume, level, Label, stop, target, ProtectionType.Absolute, null, comment);
            if (!r.IsSuccessful) { Skip("order rejected: " + r.Error); Print("{0} order rejected: {1}", type, r.Error); return; }
            if (through) _dayDone = true;     // filled at market: no second order today
            // Sized from the planned level; a fill that slips past the level widens the stop by
            // the slippage, so the loss can exceed the budget by that much (as in the research).
        }

        private string Size(double stopDist, out double volume)
        {
            double riskMoney = Account.Equity * RiskPerTradePct / 100.0;
            double stopPips = stopDist / Symbol.PipSize;
            volume = Symbol.NormalizeVolumeInUnits(Symbol.VolumeForFixedRisk(riskMoney, stopPips, RoundingMode.Down), RoundingMode.Down);
            volume = Math.Min(volume, Symbol.VolumeInUnitsMax);
            if (volume < Symbol.VolumeInUnitsMin || Symbol.AmountRisked(volume, stopPips) > riskMoney * MaxVolumeOverRisk)
            {
                double need = Symbol.AmountRisked(Symbol.VolumeInUnitsMin, stopPips) / (RiskPerTradePct / 100.0);
                return string.Format(Inv, "account too small: the minimum lot risks {0:F2}, budget {1:F2} (needs equity of about {2:F0})",
                    Symbol.AmountRisked(Symbol.VolumeInUnitsMin, stopPips), riskMoney, need);
            }
            return null;
        }

        // With the trend filter only one order is working. If price breaks the other side of
        // the range first, the research skips the day, so cancel.
        private void WatchOtherSide()
        {
            if (_plan == null || _dayDone || _trendSide == 0 || BotPositions().Any()) return;
            bool other = _trendSide > 0 ? Symbol.Bid <= _plan.SellLevel : Symbol.Ask >= _plan.BuyLevel;
            if (other) CancelDay("broke the other side first");
        }

        private void CancelDay(string why)
        {
            foreach (var o in BotOrders().ToList()) CancelPendingOrder(o);
            _dayDone = true;
            _status = "no trade today: " + why;
            if (why == "broke the other side first") Skip(why);
            UpdatePanel();
        }

        // On fill: cancel the other order and set stop and target from the actual fill price,
        // exactly as the research does (stop at the far side of the range, capped).
        private void OnPositionOpened(PositionOpenedEventArgs e)
        {
            var p = e.Position;
            if (p.Label != Label || p.SymbolName != SymbolName) return;
            foreach (var o in BotOrders().ToList()) CancelPendingOrder(o);
            _dayDone = true;
            _entries++;
            var plan = _plan ?? PlanFromComment(p.Comment);
            if (plan == null) { Print("Position {0} opened without a plan; keeping the stop sent with the order.", p.Id); return; }
            bool buy = p.TradeType == TradeType.Buy;
            BreakoutMath.Levels(buy, p.EntryPrice, plan, StopCapPct, TargetR, out double stop, out double target, out double dist);
            p.ModifyStopLossPrice(Math.Round(stop, Symbol.Digits));
            p.ModifyTakeProfitPrice(Math.Round(target, Symbol.Digits));
            _risk[p.Id] = dist;
            _status = string.Format(Inv, "{0} {1} at {2:F2} | stop {3:F2} | target {4:F2}", p.TradeType, p.VolumeInUnits, p.EntryPrice, stop, target);
            Print("{0} {1} units at {2} | stop {3:F2} | target {4:F2} | risk {5:F2}", p.TradeType, p.VolumeInUnits, p.EntryPrice, stop, target,
                Symbol.AmountRisked(p.VolumeInUnits, dist / Symbol.PipSize));
            UpdatePanel();
        }

        private void ManageBreakEven()
        {
            if (_m1.Count < 2) return;
            double bidClose = _m1.ClosePrices.Last(1);
            foreach (var p in BotPositions().ToList())
            {
                if (!p.StopLoss.HasValue) continue;
                bool buy = p.TradeType == TradeType.Buy;
                if (!_risk.TryGetValue(p.Id, out double dist))
                {
                    dist = Math.Abs(p.EntryPrice - p.StopLoss.Value);     // after a restart, before break-even
                    _risk[p.Id] = dist;
                }
                double close = buy ? bidClose : bidClose + Symbol.Spread;   // longs exit at the bid, shorts at the ask
                double want = BreakoutMath.BreakEven(buy, p.EntryPrice, dist, close, BreakEvenR, p.StopLoss.Value);
                if (Math.Abs(want - p.StopLoss.Value) >= Symbol.TickSize)
                {
                    var r = p.ModifyStopLossPrice(Math.Round(want, Symbol.Digits));
                    if (r.IsSuccessful) Print("Break-even: stop moved to entry {0} on {1}.", p.EntryPrice, p.Id);
                }
            }
        }

        // -----------------------------------------------------------------------------
        //  Restart recovery, risk, state
        // -----------------------------------------------------------------------------
        private IEnumerable<Position> BotPositions()
        {
            return Positions.Where(p => p.Label == Label && p.SymbolName == SymbolName);
        }

        private IEnumerable<PendingOrder> BotOrders()
        {
            return PendingOrders.Where(o => o.Label == Label && o.SymbolName == SymbolName);
        }

        private static DayPlan PlanFromComment(string comment)
        {
            var s = (comment ?? "").Split('|');
            if (s.Length < 6 || s[0] != CommentTag) return null;
            double[] v = new double[4];
            for (int i = 0; i < 4; i++)
                if (!double.TryParse(s[i + 1], NumberStyles.Float, Inv, out v[i])) return null;
            return new DayPlan { Valid = true, Hi = v[0], Lo = v[1], BuyLevel = v[2], SellLevel = v[3] };
        }

        private void AdoptExisting()
        {
            var o = BotOrders().FirstOrDefault();
            var p = BotPositions().FirstOrDefault();
            string comment = o?.Comment ?? p?.Comment;
            if (comment == null) return;
            _plan = PlanFromComment(comment);
            var s = comment.Split('|');
            if (s.Length >= 6) int.TryParse(s[5], NumberStyles.Integer, Inv, out _trendSide);
            _planDay = Broker(Server.Time).Date;
            _dayDone = p != null;
            _status = "adopted today's " + (p != null ? "position" : "order") + " after a restart";
            Print("Adopted existing {0} for today.", p != null ? "position " + p.Id : "order " + o.Id);
        }

        private void CheckRisk()
        {
            double eq = Account.Equity;
            if (eq > _peakEquity) _peakEquity = eq;
            if (_ddHalt)
            {
                if (!_persist && Broker(Server.Time).Date != _planDay && !BotPositions().Any())
                {
                    // Backtest only: re-arm the next day so one bad patch doesn't silence the
                    // rest of the test. Every trip is counted in the report.
                    _ddHalt = false;
                    _peakEquity = eq;
                    Print("[backtest] Peak-drawdown halt re-armed.");
                }
                return;
            }
            if (eq <= _peakEquity * (1 - MaxPeakDrawdownPct / 100.0))
            {
                _ddHalt = true;
                _ddTrips++;
                foreach (var o in BotOrders().ToList()) CancelPendingOrder(o);
                foreach (var p in BotPositions().ToList()) ClosePosition(p);
                _dayDone = true;
                SaveState();
                Print("PEAK DRAWDOWN HALT: equity {0:F2} is {1}% below peak {2:F2}. Closed all. Review, then change KillSwitchEpoch in code to resume.",
                    eq, MaxPeakDrawdownPct, _peakEquity);
            }
        }

        private void LoadState()
        {
            double eq = Account.Equity;
            _peakEquity = eq;
            _ddHalt = false;
            if (_persist)
            {
                int.TryParse(Get("epoch"), NumberStyles.Integer, Inv, out int epoch);
                if (epoch == KillSwitchEpoch)
                {
                    if (double.TryParse(Get("peak"), NumberStyles.Float, Inv, out double pk) && pk > eq) _peakEquity = pk;
                    _ddHalt = Get("ddHalt") == "1";
                }
                else if (epoch != 0)
                    Print("KillSwitchEpoch changed from {0} to {1}: halt cleared, peak equity restarts at {2:F2}.", epoch, KillSwitchEpoch, eq);
                if (_ddHalt) Print("Peak-drawdown halt is ACTIVE from an earlier run. No entries until KillSwitchEpoch is changed.");
            }
            SaveState();
        }

        private void SaveState()
        {
            _lastSavedPeak = _peakEquity;
            if (!_persist) return;
            Set("epoch", KillSwitchEpoch.ToString(Inv));
            Set("peak", _peakEquity.ToString("R", Inv));
            Set("ddHalt", _ddHalt ? "1" : "0");
            FlushStore();
        }

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
            return BreakoutMath.StorageKey(StatePrefix, _keyAccount, _keySymbol, name);
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

        private void Skip(string why)
        {
            _skips.TryGetValue(why, out int n);
            _skips[why] = n + 1;
        }

        // -----------------------------------------------------------------------------
        //  Chart panel (real time and visual backtests)
        // -----------------------------------------------------------------------------
        private void UpdatePanel()
        {
            if (RunningMode != RunningMode.RealTime && RunningMode != RunningMode.VisualBacktesting) return;
            var sb = new StringBuilder();
            sb.AppendLine("GoldBreakout  (DEMO ONLY)");
            sb.AppendLine("Broker clock " + Broker(Server.Time).ToString("ddd HH:mm", Inv) + "  (range " + RangeStartHour.ToString("00", Inv) + "-" +
                RangeEndHour.ToString("00", Inv) + ", flat " + FlatHour.ToString("00", Inv) + ")");
            if (UseTrendFilter && _dailyCount > 1)
                sb.AppendLine(string.Format(Inv, "Daily trend: {0} (close {1:F2} vs EMA{2} {3:F2})",
                    _lastDailyClose > _ema ? "UP - buys only" : "DOWN - sells only", _lastDailyClose, TrendEmaDays, _ema));
            sb.AppendLine("Today: " + _status);
            foreach (var p in BotPositions())
                sb.AppendLine(string.Format(Inv, "{0} {1} at {2:F2}  stop {3:F2}  target {4:F2}  P/L {5:F2}",
                    p.TradeType, p.VolumeInUnits, p.EntryPrice, p.StopLoss ?? 0, p.TakeProfit ?? 0, p.NetProfit));
            double dd = _peakEquity > 0 ? (1 - Account.Equity / _peakEquity) * 100 : 0;
            sb.AppendLine(_ddHalt ? "HALTED: peak drawdown (change KillSwitchEpoch after review)"
                                  : string.Format(Inv, "Drawdown from peak {0:F1}% (halt at {1}%)", dd, MaxPeakDrawdownPct));
            Chart.DrawStaticText("gb1_panel", sb.ToString(), VerticalAlignment.Top, HorizontalAlignment.Left, Color.Gold);
        }
    }

    // =====================================================================================
    //  Pure logic, no cTrader types: unit-tested, and replayed against the research
    //  harness on 10 years of M1 data in tests/.
    // =====================================================================================
    public sealed class DayPlan
    {
        public bool Valid;
        public string Why;
        public double Hi, Lo, Price, Buffer, BuyLevel, SellLevel;
    }

    public static class BreakoutMath
    {
        /// LocalStorage key: Latin letters, digits and single spaces only, no space at either end.
        public static string StorageKey(string prefix, long account, string symbol, string name)
        {
            string Clean(string s) => new string((s ?? "").Where(c => (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9')).ToArray());
            return string.Join(" ", new[] { Clean(prefix), account.ToString(CultureInfo.InvariantCulture), Clean(symbol), Clean(name) }.Where(x => x.Length > 0));
        }

        public static DateTime BrokerClock(DateTime newYork, int offsetHours)
        {
            return newYork.AddHours(offsetHours);
        }

        /// pandas ewm(span=n, adjust=False) step.
        public static double EmaNext(double prev, double x, int n)
        {
            return prev + 2.0 / (n + 1) * (x - prev);
        }

        /// +1 = buys only (close above EMA), -1 = sells only, 0 = equal.
        public static int TrendSide(double close, double ema)
        {
            return close > ema ? 1 : close < ema ? -1 : 0;
        }

        /// Range filter and order levels. price = last close of the range (bid).
        public static DayPlan Plan(double hi, double lo, double price, double minPct, double maxPct, double bufPct)
        {
            var p = new DayPlan { Hi = hi, Lo = lo, Price = price };
            if (!(hi > lo) || !(price > 0)) { p.Why = "no range"; return p; }
            double w = (hi - lo) / price * 100.0;
            if (w < minPct) { p.Why = "range too narrow"; return p; }
            if (w > maxPct) { p.Why = "range too wide"; return p; }
            p.Buffer = bufPct / 100.0 * price;
            p.BuyLevel = hi + p.Buffer;
            p.SellLevel = lo - p.Buffer;
            p.Valid = true;
            return p;
        }

        /// Stop at the far side of the range, capped at capPct of the entry price; target
        /// targetR x that distance.
        public static void Levels(bool buy, double entry, DayPlan p, double capPct, double targetR,
                                  out double stop, out double target, out double dist)
        {
            double cap = capPct / 100.0 * entry;
            dist = buy ? Math.Min(entry - p.Lo, cap) : Math.Min(p.Hi - entry, cap);
            stop = buy ? entry - dist : entry + dist;
            target = buy ? entry + targetR * dist : entry - targetR * dist;
        }

        /// Stop to entry once a close is beR x risk in profit. Never loosens.
        public static double BreakEven(bool buy, double entry, double dist, double close, double beR, double currentStop)
        {
            if (beR <= 0 || dist <= 0) return currentStop;
            if (buy && close >= entry + beR * dist) return Math.Max(currentStop, entry);
            if (!buy && close <= entry - beR * dist) return Math.Min(currentStop, entry);
            return currentStop;
        }
    }
}

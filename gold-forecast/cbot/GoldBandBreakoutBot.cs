// GoldBandBreakoutBot v2.2  -  XAUUSD planning engine + breakout rules.
//
// v2.2: housekeeping, same trading rules. (1) Orders that are expiring on their own are no longer cancelled at the
//       hour change (that race caused the harmless 'cancel FAILED: EntityNotFound / TechnicalError' journal lines).
//       (2) Each order placement prints prices and the stop/target in dollars; the platform's order log shows SL/TP
//       in PIPS (XAUUSD pip = $0.01, so '3094' = $30.94). (3) A Band z other than the tested 1.2816 prints a warning.
//       (4) If two orders ever fill at once, the extra position is closed (hard 1-position rule).
//       Trading the scenario plan directly was tested 11 Nov 2026 (scenario_test.py) and rejected: not added.
// v2.1: live-ready. Lot size stays a code constant (exactly 0.01): the volume is never rounded up and the bot stops
//       itself if the broker cannot trade exactly 0.01 lot. The 10%-of-equity guard is OFF on live accounts (decision
//       10 Nov 2026, against the pressure test: R200-R1,000 accounts were wiped in 83-98% of 60-trade runs) and stays on
//       for demo. The startup log states LIVE/DEMO, account, balance and the rules' validation status.
// v2.0: the bot builds its own daily plan with PlanEngine (engine/PlanEngine.cs) - the gold-forecast model ported to
//       C# and verified number-for-number against the Python on 20 past closes (parity_check.py). At every session
//       close it prints the plan (bands, projected range, key levels with touch odds, bull/bear scenarios) and scores
//       the previous day's plan (tests T1-T8, par 5/8), keeping a running record. It never re-tunes itself.
//       Trading uses the engine's anchor/ATR/profile, i.e. exactly the backtested rules.
// v1.3: skips set-ups whose stop would risk more than 10% of equity (a tiny account cannot be wiped by one stop).
// v1.2: USD loss caps; a restart keeps open trades.   v1.1: runs in cTrader cloud (AccessRights.None).
//
// Status: the breakout rules FAILED the unseen-period test (May 2025 - Jan 2026, 223 trades, PF 0.99). The plan is a
// map of ranges and levels, not a direction signal (direction hit rate ~50%). Running it live was the owner's decision.
//
// Trading rule, each hour k (not the first, not the last, not the US-data bar), while flat:
//   d = BandZ * sigma[k] * ATR;  BUY STOP at anchor + d, SELL STOP at anchor - d, SL = TP = d (1:1);
//   already beyond a level -> market; first fill cancels the other; orders expire at the end of the hour; flat at close.

using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using cAlgo.API;
using cAlgo.API.Internals;
using GoldEngine;
using EBar = GoldEngine.Bar;

namespace cAlgo.Robots
{
    [Robot(TimeZone = TimeZones.UTC, AccessRights = AccessRights.None)]
    public class GoldBandBreakoutBot : Robot
    {
        // ---- Risk: fixed constants, never [Parameter]. Change them by editing code, on purpose. ----
        private const double LotSize = 0.01;                    // 0.01 lot = 1 oz of gold
        private const int MaxOpenPositions = 1;
        private const int MaxTradesPerSession = 4;
        private const double MaxLossPerTradeUsd = 100.0;        // skip set-ups whose stop would risk more than this (USD)
        private const double MaxDailyLossUsd = 150.0;           // no new entries this session after losing this much (USD)
        private const double MinFreeMarginAccount = 100.0;      // no new orders below this free margin (account currency)
        private const double MaxStopRiskPercentOfEquity = 10.0; // skip set-ups whose stop risks more than this share of equity
        private const bool EquityGuardOnLive = false;           // owner's decision 10 Nov 2026: live always trades 0.01 lot if margin allows
        private const double MaxSpreadPrice = 1.00;             // $ per oz
        private const string BotLabel = "GBB1";

        // ---- Fixed rules ----
        private const int BarsPerSession = PlanEngine.BarsPerSession;
        private const int DataHourBar = 14;                     // US 08:30 ET bar (winter and summer)
        private const double SessionGapHours = 2.0;
        private const int EntryCutoffMinutes = 65;              // no entries in the session's last hour
        private const int FlatBeforeCloseMinutes = 5;
        private const int ExpiryGraceSeconds = 5;              // v2.2: leave orders expiring this soon to the server
        private const double TestedBandZ = 1.2816;             // the validated band (80%)
        private static readonly DateTime HistoryStartUtc = new DateTime(2024, 10, 10, 23, 0, 0, DateTimeKind.Utc); // same pool as the research
        private static readonly TimeSpan Sast = TimeSpan.FromHours(2);
        // US CPI release dates (BLS schedule), 08:30 ET = 15:30 SAST
        private static readonly string[] CpiDates =
            { "2026-11-10", "2026-12-10", "2027-01-13", "2027-02-11", "2027-03-10", "2027-04-13", "2027-05-12",
              "2027-06-10", "2027-07-14", "2027-08-11", "2027-09-14", "2027-10-14", "2027-11-10", "2027-12-10" };

        // ---- Strategy parameters (shape the signal, not the risk) ----
        [Parameter("Band z (1.2816 = 80% band)", DefaultValue = 1.2816, MinValue = 0.6, MaxValue = 2.0, Step = 0.1, Group = "Strategy")]
        public double BandZ { get; set; }

        [Parameter("Skip US-data hour", DefaultValue = true, Group = "Strategy")]
        public bool SkipDataHour { get; set; }

        [Parameter("Other event dates (yyyy-MM-dd, comma-separated)", DefaultValue = "", Group = "Plan")]
        public string ExtraEventDates { get; set; }

        [Parameter("Draw plan on chart", DefaultValue = true, Group = "Plan")]
        public bool DrawPlan { get; set; }

        private Bars _h1, _h4;
        private double _volume;
        private int _sessionStart = -1;
        private DailyPlan _plan, _prevPlan;
        private int _prevSessionStart = -1;
        private int _tradesThisSession;
        private double _pnlUsdThisSession;
        private readonly List<DayScore> _record = new List<DayScore>();

        protected override void OnStart()
        {
            _h1 = MarketData.GetBars(TimeFrame.Hour);
            _h4 = MarketData.GetBars(TimeFrame.Hour4);
            while (_h1.OpenTimes[0] > HistoryStartUtc && _h1.LoadMoreHistory() > 0) { }
            while (_h4.Count < PlanEngine.H4Rows + 50 && _h4.LoadMoreHistory() > 0) { }
            if (_h1.OpenTimes[0] > HistoryStartUtc)
                Print("Note: H1 history starts {0:yyyy-MM-dd}; the research pool starts 2024-10-10, so plans can differ slightly from the workbook",
                      _h1.OpenTimes[0]);
            // Exactly 0.01 lot or nothing: never round the volume up to a broker minimum.
            double wanted = Symbol.QuantityToVolumeInUnits(LotSize);
            _volume = Symbol.NormalizeVolumeInUnits(wanted, RoundingMode.Down);
            if (_volume < Symbol.VolumeInUnitsMin || Math.Abs(_volume - wanted) > 1e-9)
            {
                Print("STOPPED: this broker cannot trade exactly {0} lot of {1} (wanted {2} units; min {3}, step {4}). Refusing to trade a different size.",
                      LotSize, SymbolName, wanted, Symbol.VolumeInUnitsMin, Symbol.VolumeInUnitsStep);
                Stop();
                return;
            }
            bool live = Account.IsLive;
            Print("{0} account {1} | balance {2:F2} {3} | fixed {4} lot = {5} units (1 lot = {6} oz) | 10% equity guard {7}",
                  live ? "LIVE" : "DEMO", Account.Number, Account.Balance, Account.Asset.Name, LotSize, _volume, Symbol.LotSize,
                  live && !EquityGuardOnLive ? "OFF (live)" : "ON");
            if (live)
                Print("LIVE NOTE: these rules failed the unseen-period test (May 2025 - Jan 2026, 223 trades, PF 0.99) - expect roughly " +
                      "break-even before costs. One stop is about $17-$75 per 0.01 lot; caps: $100 per trade, $150 per session, 4 trades per session.");
            if (Math.Abs(BandZ - TestedBandZ) > 1e-9)
                Print("WARNING: Band z = {0} is UNTESTED (tested setting: {1}; z 1.0 and 0.674 were tested 11 Nov 2026 and rejected). " +
                      "Set it back to {1} unless you are deliberately running an experiment.", BandZ, TestedBandZ);

            _h1.BarOpened += OnHourOpened;
            Positions.Opened += OnPositionOpened;
            Positions.Closed += OnPositionClosed;

            // A restart between a fill and its protection must never leave a naked position.
            foreach (var p in Positions.FindAll(BotLabel, SymbolName))
                if (p.StopLoss == null)
                    ClosePosition(p);

            // Plan the current session straight away and rebuild its counters, so a restart keeps going.
            _sessionStart = SessionStartOf(_h1.Count - 1);
            _plan = TryBuildPlan(_h1.OpenTimes[_sessionStart]);
            DateTime sessionOpen = _h1.OpenTimes[_sessionStart];
            foreach (var t in History.Where(t => t.Label == BotLabel && t.SymbolName == SymbolName && t.EntryTime >= sessionOpen))
            {
                _tradesThisSession++;
                _pnlUsdThisSession += t.Pips * Symbol.PipSize * t.VolumeInUnits;
            }
            _tradesThisSession += Positions.FindAll(BotLabel, SymbolName).Length;
            Print("GoldBandBreakoutBot v2.2: {0} H1 / {1} H4 bars, {2} units per trade, {3} trades / ${4:F2} so far this session",
                  _h1.Count, _h4.Count, _volume, _tradesThisSession, _pnlUsdThisSession);
        }

        // ------------------------------------------------------------------ planning
        private DailyPlan TryBuildPlan(DateTime cutoffUtc)
        {
            try
            {
                var h1 = new List<EBar>(_h1.Count);
                for (int i = 0; i < _h1.Count; i++)
                    if (_h1.OpenTimes[i] >= HistoryStartUtc)
                        h1.Add(new EBar(_h1.OpenTimes[i], _h1.OpenPrices[i], _h1.HighPrices[i], _h1.LowPrices[i], _h1.ClosePrices[i]));
                var h4 = new List<EBar>(_h4.Count);
                for (int i = 0; i < _h4.Count; i++)
                    h4.Add(new EBar(_h4.OpenTimes[i], _h4.OpenPrices[i], _h4.HighPrices[i], _h4.LowPrices[i], _h4.ClosePrices[i]));
                var plan = PlanEngine.Build(h1, h4, cutoffUtc);
                PrintPlan(plan);
                if (DrawPlan)
                    DrawOnChart(plan);
                return plan;
            }
            catch (Exception e)
            {
                Print("PLAN not built: {0}", e.Message);
                return null;
            }
        }

        private void PrintPlan(DailyPlan p)
        {
            var inv = CultureInfo.InvariantCulture;
            DateTime day = (p.CutoffUtc + Sast).AddHours(1).Date;
            if (day.DayOfWeek == DayOfWeek.Saturday) day = day.AddDays(2);
            Print("PLAN {0} | anchor {1:F2} | daily ATR {2:F2} | analogs up {3:P0} | projected close {4:F2}, high {5:F2}, low {6:F2}",
                  day.ToString("ddd dd MMM yyyy", inv), p.Anchor, p.Atr, p.PUp, p.ProjClose, p.ProjHigh, p.ProjLow);
            Print("RANGE typical ${0:F0}; 80% of days ${1:F0} - ${2:F0}. 80% band: hour 2 +-{3:F0}, hour 12 +-{4:F0}, close +-{5:F0}",
                  p.RangeQ[2], p.RangeQ[0], p.RangeQ[4], p.Band(1, PlanEngine.Z80), p.Band(11, PlanEngine.Z80), p.Band(22, PlanEngine.Z80));
            foreach (var s in new[] { p.Bull, p.Bear })
                Print("{0}: {1} {2:F2} -> {3}; invalid on 1h close back {4} {5:F2}", s.Key.ToUpperInvariant(), s.TriggerRule, s.Trigger,
                      string.Join(", ", s.Targets.Select(t => string.Format(inv, "{0} {1:F2} ({2:P0})", t.Name.Split(' ')[0], t.Price, t.PTouch))),
                      s.Key == "bull" ? "below" : "above", s.Invalidation);
            var near = p.Levels.OrderBy(l => Math.Abs(l.Price - p.Anchor)).Take(6).OrderByDescending(l => l.Price);
            Print("LEVELS {0}", string.Join(" | ", near.Select(l => string.Format(inv, "{0:F2} {1} ({2:P0})", l.Price, PlanEngine.Short(l.Label), l.PTouch))));
            string ev = EventFor(day);
            Print("EVENTS {0}", ev ?? "none on the built-in calendar (add dates in the Plan parameters)");
            double d1 = BandZ * p.Sigma[1] * p.Atr;
            Print("BOT first orders (hour 2): buy stop {0:F2} / sell stop {1:F2}, stop and target {2:F2} each. Direction is a coin flip for this model.",
                  p.Anchor + d1, p.Anchor - d1, d1);
        }

        private string EventFor(DateTime daySast)
        {
            string key = daySast.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
            if (CpiDates.Contains(key))
                return "US CPI 15:30 SAST (high impact; the bot skips that hour)";
            var extra = (ExtraEventDates ?? "").Split(new[] { ',', ';', ' ' }, StringSplitOptions.RemoveEmptyEntries);
            return extra.Contains(key) ? "event date from parameters" : null;
        }

        private void DrawOnChart(DailyPlan p)
        {
            try
            {
                foreach (var name in Chart.Objects.Where(o => o.Name.StartsWith("GBBplan")).Select(o => o.Name).ToList())
                    Chart.RemoveObject(name);
                Line("GBBplan_anchor", p.Anchor, Color.Gray, LineStyle.Dots, "prior close");
                Line("GBBplan_bull", p.Bull.Trigger, Color.SeaGreen, LineStyle.Solid, "bull trigger");
                Line("GBBplan_bear", p.Bear.Trigger, Color.IndianRed, LineStyle.Solid, "bear trigger");
                for (int i = 0; i < 3; i++)
                {
                    Line($"GBBplan_bullT{i + 1}", p.Bull.Targets[i].Price, Color.SeaGreen, LineStyle.DotsRare, p.Bull.Targets[i].Name);
                    Line($"GBBplan_bearT{i + 1}", p.Bear.Targets[i].Price, Color.IndianRed, LineStyle.DotsRare, p.Bear.Targets[i].Name);
                }
                Line("GBBplan_ph", p.ProjHigh, Color.DodgerBlue, LineStyle.Lines, "projected high");
                Line("GBBplan_pl", p.ProjLow, Color.DodgerBlue, LineStyle.Lines, "projected low");
            }
            catch (Exception)
            {
                // charts are not drawn for cloud instances
            }
        }

        private void Line(string name, double y, Color color, LineStyle style, string comment)
        {
            var l = Chart.DrawHorizontalLine(name, y, color, 1, style);
            l.Comment = comment;
        }

        private void ScorePreviousDay()
        {
            if (_prevPlan == null || _prevSessionStart < 0)
                return;
            var bars = new List<EBar>();
            for (int i = _prevSessionStart; i < _sessionStart; i++)
                bars.Add(new EBar(_h1.OpenTimes[i], _h1.OpenPrices[i], _h1.HighPrices[i], _h1.LowPrices[i], _h1.ClosePrices[i]));
            if (bars.Count < 16)
                return;
            var s = PlanEngine.Score(_prevPlan, bars);
            _record.Add(s);
            Print("SCORE {0}: {1}/8 (par 5) | error vs no-change {2:F2} | in 50% band {3:P0} | in 80% band {4:P0} | close {5:F2} vs {6:F2} | " +
                  "high {7:F2} low {8:F2} range ${9:F0} | level Brier {10:F3}",
                  (_prevPlan.CutoffUtc + Sast).AddHours(1).ToString("ddd dd MMM", CultureInfo.InvariantCulture), s.Passed, s.ErrorRatio,
                  s.In50, s.In80, s.LastClose, _prevPlan.Anchor, s.High, s.Low, s.Range, s.Brier);
            Print("SCORE tests: {0}", string.Join(", ", DayScore.Names.Select((n, i) => (s.Tests[i] ? "PASS " : "fail ") + n)));
            Print("RECORD since start: {0} day(s), average {1:F1}/8, {2} at or above par", _record.Count,
                  _record.Average(r => r.Passed), _record.Count(r => r.Passed >= 5));
        }

        // ------------------------------------------------------------------ trading
        private void OnHourOpened(BarOpenedEventArgs args)
        {
            CancelOwnOrders();
            int now = _h1.Count - 1;                            // the bar that just opened
            int start = SessionStartOf(now);
            if (start != _sessionStart)
            {
                // New session: nothing carries over, yesterday's plan is scored, today's plan is built.
                foreach (var p in Positions.FindAll(BotLabel, SymbolName))
                    ClosePosition(p);
                _prevPlan = _plan;
                _prevSessionStart = _sessionStart;
                _sessionStart = start;
                _tradesThisSession = 0;
                _pnlUsdThisSession = 0;
                ScorePreviousDay();
                _plan = TryBuildPlan(_h1.OpenTimes[start]);
            }
            if (_plan == null)
                return;

            int k = now - start;
            if (k == 0 || k >= BarsPerSession - 1)
                return;                                         // rollover hour / last hour
            if (SkipDataHour && k == DataHourBar)
                return;
            if (Symbol.MarketHours.TimeTillClose() < TimeSpan.FromMinutes(EntryCutoffMinutes))
                return;
            if (Positions.FindAll(BotLabel, SymbolName).Length >= MaxOpenPositions)
                return;
            if (_tradesThisSession >= MaxTradesPerSession || _pnlUsdThisSession <= -MaxDailyLossUsd)
                return;
            if (Symbol.Spread > MaxSpreadPrice || Account.FreeMargin < MinFreeMarginAccount)
                return;

            double d = BandZ * _plan.Sigma[k] * _plan.Atr;
            double riskUsd = d * _volume;                       // 1 unit = 1 oz, so price distance x units = USD
            if (d <= 0 || riskUsd > MaxLossPerTradeUsd)
            {
                Print("Bar {0}: skipped, stop would risk ${1:F0} (cap ${2:F0})", k, riskUsd, MaxLossPerTradeUsd);
                return;
            }
            double riskAccount = d / Symbol.PipSize * Symbol.PipValue * _volume;   // same loss, in account currency
            if ((!Account.IsLive || EquityGuardOnLive) && riskAccount > Account.Equity * MaxStopRiskPercentOfEquity / 100.0)
            {
                Print("Bar {0}: skipped, stop would risk {1:F2} = {2:F1}% of equity (cap {3:F0}%)",
                      k, riskAccount, 100.0 * riskAccount / Math.Max(Account.Equity, 0.01), MaxStopRiskPercentOfEquity);
                return;
            }
            double pips = Math.Round(d / Symbol.PipSize, 1);
            double up = Math.Round(_plan.Anchor + d, Symbol.Digits);
            double down = Math.Round(_plan.Anchor - d, Symbol.Digits);
            DateTime expiry = _h1.OpenTimes[now].AddHours(1);

            if (Symbol.Ask >= up)
                ExecuteMarketOrder(TradeType.Buy, SymbolName, _volume, BotLabel, pips, pips);
            else if (Symbol.Bid <= down)
                ExecuteMarketOrder(TradeType.Sell, SymbolName, _volume, BotLabel, pips, pips);
            else
            {
                PlaceStopOrder(TradeType.Buy, SymbolName, _volume, up, BotLabel, pips, pips, ProtectionType.Relative, expiry);
                PlaceStopOrder(TradeType.Sell, SymbolName, _volume, down, BotLabel, pips, pips, ProtectionType.Relative, expiry);
            }
            Print("Bar {0} ({1:HH:mm} SAST): BUY STOP {2} | SELL STOP {3} | stop & target ${4:F2} each (order log shows {5} pips) | until {6:HH:mm} SAST",
                  k, _h1.OpenTimes[now] + Sast, up, down, d, pips, expiry + Sast);
        }

        protected override void OnTick()
        {
            if (Symbol.MarketHours.TimeTillClose() > TimeSpan.FromMinutes(FlatBeforeCloseMinutes))
                return;
            CancelOwnOrders();
            foreach (var p in Positions.FindAll(BotLabel, SymbolName))
                ClosePosition(p);
        }

        private void OnPositionOpened(PositionOpenedEventArgs args)
        {
            if (args.Position.Label != BotLabel || args.Position.SymbolName != SymbolName)
                return;
            _tradesThisSession++;
            CancelOwnOrders();                                  // one-cancels-other
            var mine = Positions.FindAll(BotLabel, SymbolName);
            if (mine.Length > MaxOpenPositions)                 // two orders filled at once: keep the first, close the extra
            {
                Print("Extra position {0} closed: max {1} open position(s)", args.Position.Id, MaxOpenPositions);
                ClosePosition(args.Position);
            }
        }

        private void OnPositionClosed(PositionClosedEventArgs args)
        {
            if (args.Position.Label != BotLabel || args.Position.SymbolName != SymbolName)
                return;
            var p = args.Position;
            _pnlUsdThisSession += p.Pips * Symbol.PipSize * p.VolumeInUnits;   // price move x oz = USD
            var inv = CultureInfo.InvariantCulture;
            Print("TRADE,{0},{1},{2},{3},{4},{5}", Server.Time.ToString("yyyy-MM-dd HH:mm:ss", inv), p.TradeType,
                  p.EntryPrice.ToString(inv), p.EntryTime.ToString("yyyy-MM-dd HH:mm:ss", inv),
                  p.NetProfit.ToString(inv), args.Reason);
        }

        private void CancelOwnOrders()
        {
            // Orders expiring within a few seconds are left to expire by themselves: cancelling them races the server's
            // own expiry and prints a harmless 'FAILED: EntityNotFound / TechnicalError' line.
            DateTime soon = Server.Time.AddSeconds(ExpiryGraceSeconds);
            foreach (var o in PendingOrders.Where(o => o.Label == BotLabel && o.SymbolName == SymbolName).ToList())
                if (o.ExpirationTime == null || o.ExpirationTime.Value > soon)
                    CancelPendingOrder(o);
        }

        private int SessionStartOf(int i)
        {
            while (i > 0 && (_h1.OpenTimes[i] - _h1.OpenTimes[i - 1]).TotalHours < SessionGapHours)
                i--;
            return i;
        }

        protected override void OnStop()
        {
            var mine = History.Where(t => t.Label == BotLabel).ToList();
            double won = mine.Where(t => t.NetProfit > 0).Sum(t => t.NetProfit);
            double lost = -mine.Where(t => t.NetProfit < 0).Sum(t => t.NetProfit);
            Print("Stopped: {0} trades, net {1:F2}, profit factor {2}; plan record {3} day(s), average {4:F1}/8",
                  mine.Count, won - lost, lost > 0 ? (won / lost).ToString("F2", CultureInfo.InvariantCulture) : "n/a",
                  _record.Count, _record.Count > 0 ? _record.Average(r => r.Passed) : 0.0);
        }
    }
}

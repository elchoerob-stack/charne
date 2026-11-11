// GoldBandBreakoutBot v3.1  -  XAUUSD planning engine + breakout rules, sized for small accounts, reading 15m / 5m / 1m.
//
// v3.1 (11 Nov 2026): reads the lower timeframes. (1) Every hour it prints the market structure of the 15m, 5m and 1m
//       charts (direction of the last swing break and when it happened). (2) 'Early exit' switch: close a trade when
//       the chosen timeframe CLOSES through its last swing against the trade (a buy: below the last swing low).
//       Tested before it was built in (mtf_exit_test.py, pre-registered; 2016-2024 and 2025-26): it does what it says -
//       the average loss falls from $18 to $14 (15m), $8 (5m), $4 (1m) per oz at today's volatility and full stop-outs
//       from 35% of trades to 16%, 4%, 0.4% - but the winners are cut the same way (wins 49% -> 42%, 33%, 27%) and the
//       bot trades more often, so the result is WORSE: profit factor 0.87 -> 0.83 (15m), 0.73 (5m), 0.58 (1m). It ships OFF.
//       (3) At each session close it prints its own trade record next to what the tests say to expect.
//       The structure rule is engine/PlanEngine.cs StructureWalk, identical to the research code (parity_check.py).
// v3.0 (11 Nov 2026): NO new trading rule - none earned it. What changed is how a trade is sized and guarded:
//       (1) Trades GOLD IN GRAMS (XAUUSDgr, 1 unit = 1 g) at the broker's minimum (5 g = 0.16 oz, so a $1 move = $0.16)
//           whenever the broker lists it; signals and the plan still come from XAUUSD. Without a gram contract it
//           trades exactly 0.01 lot of XAUUSD as before.
//       (2) One stop may never risk more than 33% of equity, live and demo (small_account_test.py, pre-registered:
//           a R300 account at 1 oz was wiped in 80% of 3-month runs, at 5 g with this cap in none).
//       (3) On a LIVE account it only plans until 'Trade on a LIVE account' is ticked, because of (5).
//       (4) Band z is a constant (1.2816) again, not a setting.
//       (5) Evidence: on 2016-2024 data that no test had used (continuation_test.py, 2,258 sessions, 3,075 trades) these
//           rules lost in 9 of 9 years, profit factor 0.87; before costs they are a coin flip (50.4% wins). The 2026
//           profit came from a trending year. 'Continuation only' entries looked good on 2025-26 and failed the same
//           nine years (PF 0.86-0.90), so they were not added.
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
// Status: the breakout rules FAILED every test on data they were not designed on (2016-2024: PF 0.87, 0 of 9 years
// profitable; May 2025 - Jan 2026: PF 0.99). The plan is a map of ranges and levels, not a direction signal (direction
// hit rate ~50%). Expect to lose about the spread and commission on every trade. Live trading is the owner's decision.
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
    public enum EarlyExitMode { Off, M15, M5, M1 }

    // One timeframe's market structure, fed from cTrader bars. The rule itself lives in engine/PlanEngine.cs
    // (StructureWalk) so it can be checked against the research code outside cTrader (parity_check.py).
    public sealed class StructureTracker
    {
        private const int Warmup = 600;                       // closed bars replayed at start
        private readonly Bars _b;
        private readonly StructureWalk _w = new StructureWalk();
        private int _next;                                    // next closed bar to process

        public readonly string Name;
        public DateTime LastTime;                             // close time of the bar that made the last break
        public bool BrokeUp, BrokeDown;                       // did the bar that just closed break structure?

        public StructureTracker(Bars bars, string name)
        {
            _b = bars;
            Name = name;
            _next = Math.Max(0, bars.Count - 1 - Warmup);
            Update();
            BrokeUp = BrokeDown = false;
        }

        public int Trend { get { return _w.Trend; } }
        public double BrokeUpLevel { get { return _w.BrokeUpLevel; } }
        public double BrokeDownLevel { get { return _w.BrokeDownLevel; } }
        public DateTime LastClosedBarCloseTime { get { return _b.OpenTimes[_b.Count - 1]; } }

        public void Update()
        {
            BrokeUp = BrokeDown = false;
            int lastClosed = _b.Count - 2;
            for (int j = _next; j <= lastClosed; j++)
            {
                _w.Step(j, i => _b.HighPrices[i], i => _b.LowPrices[i], i => _b.ClosePrices[i]);
                if (_w.BrokeUp || _w.BrokeDown)
                    LastTime = _b.OpenTimes[j + 1];
                if (j == lastClosed)
                {
                    BrokeUp = _w.BrokeUp;
                    BrokeDown = _w.BrokeDown;
                }
            }
            if (lastClosed + 1 > _next)
                _next = lastClosed + 1;
        }

        public string Describe(TimeSpan offset)
        {
            if (_w.Trend == 0)
                return Name + " no break yet";
            return string.Format(CultureInfo.InvariantCulture, "{0} {1} since {2:HH:mm} (closed {3} {4:F2})", Name, _w.Trend > 0 ? "UP" : "DOWN",
                                 LastTime + offset, _w.Trend > 0 ? "above" : "below", _w.LastLevel);
        }
    }

    [Robot(TimeZone = TimeZones.UTC, AccessRights = AccessRights.None)]
    public class GoldBandBreakoutBot : Robot
    {
        // ---- Risk: fixed constants, never [Parameter]. Change them by editing code, on purpose. ----
        private const string GramSymbolName = "XAUUSDgr";       // gold priced per gram: 1 unit = 1 g = 1/31.1035 oz
        private const double GramsPerOunce = 31.1034768;
        private const double MaxGramsPerTrade = 5.0;            // gram contract: trade the broker's minimum, only if it is <= this
        private const double MaxContractDriftPercent = 0.25;    // gram price x 31.1035 must match the ounce price this closely
        private const double LotSize = 0.01;                    // ounce contract (no gram contract): exactly 0.01 lot = 1 oz
        private const int MaxOpenPositions = 1;
        private const int MaxTradesPerSession = 4;
        private const double MaxLossPerTradeUsd = 100.0;        // skip set-ups whose stop would risk more than this (USD)
        private const double MaxDailyLossUsd = 150.0;           // no new entries this session after losing this much (USD)
        private const double MinEquityUsd = 6.0;                // no new orders below this equity (about R100)
        private const double MaxStopRiskPercentOfEquity = 33.0; // live AND demo: skip set-ups whose stop risks more of equity than this
        private const double MaxSpreadPrice = 1.00;             // $ per oz (a gram spread is converted to $ per oz)
        private const double BandZ = 1.2816;                    // the 80% band. A constant: it sets the stop distance.
        private const string BotLabel = "GBB1";

        // ---- Fixed rules ----
        private const int BarsPerSession = PlanEngine.BarsPerSession;
        private const int DataHourBar = 14;                     // US 08:30 ET bar (winter and summer)
        private const double SessionGapHours = 2.0;
        private const int EntryCutoffMinutes = 65;              // no entries in the session's last hour
        private const int FlatBeforeCloseMinutes = 5;
        private const int ExpiryGraceSeconds = 5;              // v2.2: leave orders expiring this soon to the server
        private static readonly DateTime HistoryStartUtc = new DateTime(2024, 10, 10, 23, 0, 0, DateTimeKind.Utc); // same pool as the research
        private static readonly TimeSpan Sast = TimeSpan.FromHours(2);
        // US CPI release dates (BLS schedule), 08:30 ET = 15:30 SAST
        private static readonly string[] CpiDates =
            { "2026-11-10", "2026-12-10", "2027-01-13", "2027-02-11", "2027-03-10", "2027-04-13", "2027-05-12",
              "2027-06-10", "2027-07-14", "2027-08-11", "2027-09-14", "2027-10-14", "2027-11-10", "2027-12-10" };

        // ---- Strategy parameters (shape the signal, not the risk) ----
        [Parameter("Trade on a LIVE account (rules lost in 9 of 9 test years)", DefaultValue = false, Group = "Live")]
        public bool TradeLive { get; set; }

        [Parameter("Skip US-data hour", DefaultValue = true, Group = "Strategy")]
        public bool SkipDataHour { get; set; }

        [Parameter("Early exit on a lower-timeframe shift (tested: Off is best)", DefaultValue = EarlyExitMode.Off, Group = "Strategy")]
        public EarlyExitMode EarlyExit { get; set; }

        [Parameter("Other event dates (yyyy-MM-dd, comma-separated)", DefaultValue = "", Group = "Plan")]
        public string ExtraEventDates { get; set; }

        [Parameter("Draw plan on chart", DefaultValue = true, Group = "Plan")]
        public bool DrawPlan { get; set; }

        private Bars _h1, _h4, _m1, _m5, _m15;
        private StructureTracker _s1, _s5, _s15;
        private Symbol _trade;                                  // the contract orders go to: gram gold, or this chart's XAUUSD
        private double _f = 1.0;                                // price of the traded contract / XAUUSD price (1/31.1035 for grams)
        private double _volume;
        private bool _tradingAllowed;
        private int _liveNoteSession = -1;
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
            if (SymbolName == GramSymbolName)
            {
                Print("STOPPED: attach this bot to the XAUUSD chart (1h). It reads XAUUSD for the plan and places its orders on {0} itself.", GramSymbolName);
                Stop();
                return;
            }
            // Size: the smallest trade there is. Gram gold at the broker's minimum when it exists (and is <= 5 g);
            // otherwise exactly 0.01 lot of this chart's symbol. The volume is never rounded up.
            _trade = Symbol;
            _f = 1.0;
            _volume = 0;
            if (Symbols.Exists(GramSymbolName))
            {
                Symbol g = Symbols.GetSymbol(GramSymbolName);
                if (g != null && g.VolumeInUnitsMin > 0 && g.VolumeInUnitsMin <= MaxGramsPerTrade + 1e-9)
                {
                    _trade = g;
                    _f = 1.0 / GramsPerOunce;
                    _volume = g.VolumeInUnitsMin;
                }
                else
                    Print("Note: {0} exists but its minimum trade is {1} g (limit {2} g) - using {3} instead",
                          GramSymbolName, g == null ? double.NaN : g.VolumeInUnitsMin, MaxGramsPerTrade, SymbolName);
            }
            if (_f == 1.0)
            {
                double wanted = Symbol.QuantityToVolumeInUnits(LotSize);
                _volume = Symbol.NormalizeVolumeInUnits(wanted, RoundingMode.Down);
                if (_volume < Symbol.VolumeInUnitsMin || Math.Abs(_volume - wanted) > 1e-9)
                {
                    Print("STOPPED: this broker cannot trade exactly {0} lot of {1} (wanted {2} units; min {3}, step {4}). Refusing to trade a different size.",
                          LotSize, SymbolName, wanted, Symbol.VolumeInUnitsMin, Symbol.VolumeInUnitsStep);
                    Stop();
                    return;
                }
            }
            bool live = Account.IsLive;
            _tradingAllowed = !live || TradeLive;
            Print("{0} account {1} | balance {2:F2} {3} | trades {4}: {5} {6} per trade = {7:F3} oz, so a $1 move in gold = ${7:F2} | " +
                  "one stop may risk at most {8:F0}% of equity",
                  live ? "LIVE" : "DEMO", Account.Number, Account.Balance, Account.Asset.Name, _trade.Name, _volume,
                  _f == 1.0 ? "oz" : "g", _volume * _f, MaxStopRiskPercentOfEquity);
            Print("EVIDENCE: on 2016-2024 data these rules lost in 9 of 9 years (3,075 trades, profit factor 0.87); before costs they are a " +
                  "coin flip (50.4% wins). Expect to lose about the spread and commission per trade. The plan is a map, not a signal.");
            if (live && !TradeLive)
                Print("LIVE account: PLANNING ONLY, no orders. To let it trade real money, tick 'Trade on a LIVE account' in the settings.");

            // Lower timeframes of this chart's symbol: market structure on 15m / 5m / 1m, for the hourly MTF line and the
            // optional early exit.
            _m15 = MarketData.GetBars(TimeFrame.Minute15);
            _m5 = MarketData.GetBars(TimeFrame.Minute5);
            _m1 = MarketData.GetBars(TimeFrame.Minute);
            _s15 = new StructureTracker(_m15, "15m");
            _s5 = new StructureTracker(_m5, "5m");
            _s1 = new StructureTracker(_m1, "1m");
            _m15.BarOpened += a => OnLowerBar(_s15, EarlyExitMode.M15);
            _m5.BarOpened += a => OnLowerBar(_s5, EarlyExitMode.M5);
            _m1.BarOpened += a => OnLowerBar(_s1, EarlyExitMode.M1);
            Print("MTF now: {0} | {1} | {2}. Early exit: {3}", _s15.Describe(Sast), _s5.Describe(Sast), _s1.Describe(Sast), EarlyExitNote());

            _h1.BarOpened += OnHourOpened;
            Positions.Opened += OnPositionOpened;
            Positions.Closed += OnPositionClosed;

            // A restart between a fill and its protection must never leave a naked position.
            foreach (var p in MyPositions())
                if (p.StopLoss == null)
                    ClosePosition(p);

            // Plan the current session straight away and rebuild its counters, so a restart keeps going.
            _sessionStart = SessionStartOf(_h1.Count - 1);
            _plan = TryBuildPlan(_h1.OpenTimes[_sessionStart]);
            DateTime sessionOpen = _h1.OpenTimes[_sessionStart];
            foreach (var t in History.Where(t => t.Label == BotLabel && IsMine(t.SymbolName) && t.EntryTime >= sessionOpen))
            {
                _tradesThisSession++;
                _pnlUsdThisSession += t.Pips * PipSizeOf(t.SymbolName) * t.VolumeInUnits;
            }
            _tradesThisSession += MyPositions().Length;
            Print("GoldBandBreakoutBot v3.1: {0} H1 / {1} H4 bars, {2} trades / ${3:F2} so far this session",
                  _h1.Count, _h4.Count, _tradesThisSession, _pnlUsdThisSession);
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
            Print("BOT first orders (hour 2): buy stop {0:F2} / sell stop {1:F2}, stop and target ${2:F2} per oz each. Direction is a coin flip for this model.",
                  p.Anchor + d1, p.Anchor - d1, d1);
            PrintFit(p);
        }

        // What today's stops mean for THIS account at the traded size.
        private void PrintFit(DailyPlan p)
        {
            if (_trade == null || _volume <= 0)
                return;
            double perUsd = AccountPerUsd();
            double equity = Account.Equity;
            if (perUsd <= 0 || equity <= 0)
                return;
            double lo = double.MaxValue, hi = 0;
            int hours = 0, ok = 0;
            for (int k = 1; k < BarsPerSession - 1; k++)
            {
                if (SkipDataHour && k == DataHourBar)
                    continue;
                double risk = BandZ * p.Sigma[k] * p.Atr * _f * _volume * perUsd;     // account currency
                lo = Math.Min(lo, risk);
                hi = Math.Max(hi, risk);
                hours++;
                if (risk <= equity * MaxStopRiskPercentOfEquity / 100.0)
                    ok++;
            }
            Print("FIT {0} {1} {2}: one stop today costs {3:F2} to {4:F2} {5} = {6:P0} to {7:P0} of equity {8:F2}. Cap {9:F0}%: {10} of {11} hours " +
                  "tradable. Every hour is tradable from about {12:F0} {5} of equity.",
                  _volume, _f == 1.0 ? "oz" : "g", _trade.Name, lo, hi, Account.Asset.Name, lo / equity, hi / equity, equity,
                  MaxStopRiskPercentOfEquity, ok, hours, hi * 100.0 / MaxStopRiskPercentOfEquity);
        }

        // Account currency per 1 USD, read from the traded contract (its quote currency is USD).
        private double AccountPerUsd()
        {
            return _trade.PipSize > 0 ? _trade.PipValue / _trade.PipSize : 0;
        }

        private bool IsMine(string symbolName)
        {
            return symbolName == _trade.Name || symbolName == SymbolName;
        }

        private double PipSizeOf(string symbolName)
        {
            return symbolName == _trade.Name ? _trade.PipSize : Symbol.PipSize;
        }

        private Position[] MyPositions()
        {
            return Positions.Where(p => p.Label == BotLabel && IsMine(p.SymbolName)).ToArray();
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
                foreach (var p in MyPositions())
                    ClosePosition(p);
                _prevPlan = _plan;
                _prevSessionStart = _sessionStart;
                _sessionStart = start;
                _tradesThisSession = 0;
                _pnlUsdThisSession = 0;
                ScorePreviousDay();
                PrintTradeRecord();
                _plan = TryBuildPlan(_h1.OpenTimes[start]);
            }
            if (_plan == null)
                return;

            int k = now - start;
            Print("MTF bar {0} ({1:HH:mm} SAST): gold {2:F2}, {3:+0.00;-0.00} from the prior close | {4} | {5} | {6}", k, _h1.OpenTimes[now] + Sast,
                  Symbol.Bid, Symbol.Bid - _plan.Anchor, _s15.Describe(Sast), _s5.Describe(Sast), _s1.Describe(Sast));
            if (k == 0 || k >= BarsPerSession - 1)
                return;                                         // rollover hour / last hour
            if (SkipDataHour && k == DataHourBar)
                return;
            if (!_tradingAllowed)
            {
                if (_liveNoteSession != _sessionStart)
                    Print("LIVE account: planning only, no orders (tick 'Trade on a LIVE account' to trade real money)");
                _liveNoteSession = _sessionStart;
                return;
            }
            if (_trade.MarketHours.TimeTillClose() < TimeSpan.FromMinutes(EntryCutoffMinutes))
                return;
            if (MyPositions().Length >= MaxOpenPositions)
                return;
            if (_tradesThisSession >= MaxTradesPerSession || _pnlUsdThisSession <= -MaxDailyLossUsd)
                return;

            string hh = (_h1.OpenTimes[now] + Sast).ToString("HH:mm", CultureInfo.InvariantCulture);
            double perUsd = AccountPerUsd();
            if (!(_trade.Bid > 0) || !(_trade.Ask > 0) || perUsd <= 0)
            {
                Print("Bar {0} ({1} SAST): skipped, no price yet for {2}", k, hh, _trade.Name);
                return;
            }
            if (_f != 1.0)
            {
                // The gram contract must be the same market as this chart: gram price x 31.1035 = ounce price.
                double drift = 100.0 * Math.Abs((_trade.Bid + _trade.Ask) / _f / (Symbol.Bid + Symbol.Ask) - 1.0);
                if (!(drift <= MaxContractDriftPercent))
                {
                    Print("Bar {0} ({1} SAST): skipped, {2} is {3:F2}% away from {4} (limit {5}%)", k, hh, _trade.Name, drift, SymbolName, MaxContractDriftPercent);
                    return;
                }
            }
            if (_trade.Spread / _f > MaxSpreadPrice)
            {
                Print("Bar {0} ({1} SAST): skipped, spread ${2:F2} per oz is above ${3:F2}", k, hh, _trade.Spread / _f, MaxSpreadPrice);
                return;
            }
            if (Account.Equity < MinEquityUsd * perUsd || Account.FreeMargin <= 0)
            {
                Print("Bar {0} ({1} SAST): skipped, equity {2:F2} {3} is below the floor of ${4:F0}", k, hh, Account.Equity, Account.Asset.Name, MinEquityUsd);
                return;
            }

            double d = BandZ * _plan.Sigma[k] * _plan.Atr;      // band width in $ per oz (the research unit)
            double dT = d * _f;                                 // the same distance in the traded contract's price
            double riskUsd = dT * _volume;                      // quote currency is USD: price distance x units = USD
            if (d <= 0 || riskUsd > MaxLossPerTradeUsd)
            {
                Print("Bar {0} ({1} SAST): skipped, stop would risk ${2:F0} (cap ${3:F0})", k, hh, riskUsd, MaxLossPerTradeUsd);
                return;
            }
            double riskAccount = riskUsd * perUsd;              // the same loss in account currency
            if (riskAccount > Account.Equity * MaxStopRiskPercentOfEquity / 100.0)
            {
                Print("Bar {0} ({1} SAST): skipped, a ${2:F2}-per-oz stop on {3} {4} would cost {5:F2} {6} = {7:F0}% of equity (cap {8:F0}%)",
                      k, hh, d, _volume, _f == 1.0 ? "oz" : "g", riskAccount, Account.Asset.Name,
                      100.0 * riskAccount / Math.Max(Account.Equity, 0.01), MaxStopRiskPercentOfEquity);
                return;
            }
            double pips = Math.Round(dT / _trade.TickSize) * _trade.TickSize / _trade.PipSize;   // a whole number of ticks
            double up = Math.Round((_plan.Anchor + d) * _f, _trade.Digits);
            double down = Math.Round((_plan.Anchor - d) * _f, _trade.Digits);
            DateTime expiry = _h1.OpenTimes[now].AddHours(1);

            string what;
            if (_trade.Ask >= up)
            {
                ExecuteMarketOrder(TradeType.Buy, _trade.Name, _volume, BotLabel, pips, pips);
                what = "already above the band -> BUY at market";
            }
            else if (_trade.Bid <= down)
            {
                ExecuteMarketOrder(TradeType.Sell, _trade.Name, _volume, BotLabel, pips, pips);
                what = "already below the band -> SELL at market";
            }
            else
            {
                PlaceStopOrder(TradeType.Buy, _trade.Name, _volume, up, BotLabel, pips, pips, ProtectionType.Relative, expiry);
                PlaceStopOrder(TradeType.Sell, _trade.Name, _volume, down, BotLabel, pips, pips, ProtectionType.Relative, expiry);
                what = string.Format(CultureInfo.InvariantCulture, "BUY STOP {0:F2} | SELL STOP {1:F2}", _plan.Anchor + d, _plan.Anchor - d);
            }
            Print("Bar {0} ({1} SAST): {2} | stop & target ${3:F2} per oz = {4:F2} {5} on {6} {7} ({8:F0}% of equity) | {9} order prices {10} / {11}, {12} pips | until {13:HH:mm} SAST",
                  k, hh, what, d, riskAccount, Account.Asset.Name, _volume, _f == 1.0 ? "oz" : "g",
                  100.0 * riskAccount / Math.Max(Account.Equity, 0.01), _trade.Name, up, down, pips, expiry + Sast);
        }

        // A lower-timeframe bar has just closed: update its structure; if the early exit is switched to this timeframe and
        // the bar broke structure AGAINST an open trade that was already open before the bar closed, close the trade.
        private void OnLowerBar(StructureTracker s, EarlyExitMode mode)
        {
            s.Update();
            if (EarlyExit != mode || (!s.BrokeUp && !s.BrokeDown))
                return;
            DateTime closedAt = s.LastClosedBarCloseTime;
            foreach (var p in MyPositions())
            {
                bool buy = p.TradeType == TradeType.Buy;
                if (!(buy ? s.BrokeDown : s.BrokeUp) || p.EntryTime >= closedAt)
                    continue;
                Print("EARLY EXIT: the {0} chart closed {1} its last swing {2} {3:F2} -> closing the {4} (open result {5:F2} {6})",
                      s.Name, buy ? "below" : "above", buy ? "low" : "high", buy ? s.BrokeDownLevel : s.BrokeUpLevel,
                      buy ? "BUY" : "SELL", p.NetProfit, Account.Asset.Name);
                ClosePosition(p);
            }
        }

        private string EarlyExitNote()
        {
            return EarlyExit == EarlyExitMode.Off
                ? "OFF (tested: closing early made results worse)"
                : "ON, " + EarlyExit + " - tested 2016-2024: smaller losses but smaller wins and more trades; profit factor 0.83 (15m), " +
                  "0.73 (5m), 0.58 (1m) against 0.87 with it off";
        }

        // The bot's own trades so far, next to what the tests say to expect.
        private void PrintTradeRecord()
        {
            var mine = History.Where(t => t.Label == BotLabel && IsMine(t.SymbolName)).ToList();
            if (mine.Count == 0)
                return;
            double won = mine.Where(t => t.NetProfit > 0).Sum(t => t.NetProfit);
            double lost = -mine.Where(t => t.NetProfit < 0).Sum(t => t.NetProfit);
            Print("TRADES so far: {0}, {1} won, net {2:F2} {3}, profit factor {4}. The tests say to expect about 0.9-1.0; fewer than 100 trades prove nothing either way.",
                  mine.Count, mine.Count(t => t.NetProfit > 0), won - lost, Account.Asset.Name,
                  lost > 0 ? (won / lost).ToString("F2", CultureInfo.InvariantCulture) : "n/a");
        }

        protected override void OnTick()
        {
            if (_trade == null || _trade.MarketHours.TimeTillClose() > TimeSpan.FromMinutes(FlatBeforeCloseMinutes))
                return;
            CancelOwnOrders();
            foreach (var p in MyPositions())
                ClosePosition(p);
        }

        private void OnPositionOpened(PositionOpenedEventArgs args)
        {
            if (args.Position.Label != BotLabel || !IsMine(args.Position.SymbolName))
                return;
            _tradesThisSession++;
            CancelOwnOrders();                                  // one-cancels-other
            var mine = MyPositions();
            if (mine.Length > MaxOpenPositions)                 // two orders filled at once: keep the first, close the extra
            {
                Print("Extra position {0} closed: max {1} open position(s)", args.Position.Id, MaxOpenPositions);
                ClosePosition(args.Position);
            }
        }

        private void OnPositionClosed(PositionClosedEventArgs args)
        {
            if (args.Position.Label != BotLabel || !IsMine(args.Position.SymbolName))
                return;
            var p = args.Position;
            _pnlUsdThisSession += p.Pips * PipSizeOf(p.SymbolName) * p.VolumeInUnits;   // price move x units = USD
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
            foreach (var o in PendingOrders.Where(o => o.Label == BotLabel && IsMine(o.SymbolName)).ToList())
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

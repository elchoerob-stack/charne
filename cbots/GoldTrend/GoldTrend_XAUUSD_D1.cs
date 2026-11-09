// =====================================================================================
//  GoldTrend XAUUSD D1  -  daily Donchian breakout with an ATR chandelier trail
//
//  DEMO ONLY. cbot-gate verdict (Nov 2026): INCONCLUSIVE, only 21 out-of-sample trades.
//  Every other gate check passed. See ../GoldResearch/README.md for the full research.
//
//  Rules (identical to the research harness, cbots/GoldResearch/families.py donchian_d1):
//    Entry   a daily bar CLOSES above the highest high of the previous 40 daily bars
//            -> buy at the next daily open. Below the lowest low -> sell (if shorts on).
//    Stop    2.5 x ATR(20, daily, Wilder) from the entry price, placed with the order.
//    Trail   chandelier: best M1 close since entry minus 3 x the entry-day ATR (plus
//            for shorts). Only ever tightens. It overtakes the initial stop after
//            a 0.5 ATR move in your favour.
//    Exit    the stop or the trail, or after 120 daily bars.
//    One position at a time. Signals while a position is open are ignored.
//
//  It HOLDS OVER WEEKENDS. That is the strategy (median hold 15 days, longest 82), and it
//  is a deliberate exception to the Friday-flat rule in GoldGuard. A weekend gap can fill
//  the stop worse than planned, and overnight swap is paid on every night held.
//
//  Account size: the stop is 2.5 daily ATRs (about $280/oz in late 2026). At 0.5% risk the
//  broker's minimum 0.01 lot (1 oz) needs about $55,000. On a smaller account the bot
//  skips the trade and says so in the log. It never sizes up past the risk budget.
// =====================================================================================

using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text;
using cAlgo.API;
using cAlgo.API.Indicators;
using cAlgo.API.Internals;

namespace cAlgo.Robots
{
    [Robot(TimeZone = TimeZones.UTC, AccessRights = AccessRights.None)]
    public class GoldTrendXauusdD1 : Robot
    {
        // -----------------------------------------------------------------------------
        //  RISK - fixed constants. Change only here, rebuild, and re-validate.
        // -----------------------------------------------------------------------------
        private const double RiskPerTradePct = 0.5;      // % of equity lost if the initial stop is hit
        private const double MaxPeakDrawdownPct = 6.0;   // vs peak equity: close all, halt until KillSwitchEpoch changes
        private const double MaxVolumeOverRisk = 1.01;   // broker lot rounding may overshoot the risk by at most 1%
        private const bool DemoOnly = true;

        // To clear a tripped peak-drawdown halt after reviewing it, change this to 2, 3, ...
        // in code and rebuild. Peak equity then restarts from current equity.
        private const int KillSwitchEpoch = 1;

        private const string Label = "GoldTrendD1-XAU";
        private const string CommentTag = "GTD1";
        private const string StatePrefix = "GoldTrendD1";

        // -----------------------------------------------------------------------------
        //  Parameters (defaults = the validated research settings)
        // -----------------------------------------------------------------------------
        [Parameter("Breakout Days", Group = "Signal", DefaultValue = 40, MinValue = 10, MaxValue = 120, Step = 5)]
        public int BreakoutDays { get; set; }

        [Parameter("ATR Period (days)", Group = "Signal", DefaultValue = 20, MinValue = 5, MaxValue = 60, Step = 5)]
        public int AtrPeriod { get; set; }

        [Parameter("Allow Shorts", Group = "Signal", DefaultValue = true)]
        public bool AllowShorts { get; set; }

        [Parameter("Initial Stop (ATR)", Group = "Exits", DefaultValue = 2.5, MinValue = 1.0, MaxValue = 6.0, Step = 0.25)]
        public double StopAtr { get; set; }

        [Parameter("Chandelier Trail (ATR)", Group = "Exits", DefaultValue = 3.0, MinValue = 1.0, MaxValue = 8.0, Step = 0.25)]
        public double TrailAtr { get; set; }

        [Parameter("Max Hold (daily bars)", Group = "Exits", DefaultValue = 120, MinValue = 5, MaxValue = 500, Step = 5)]
        public int MaxHoldBars { get; set; }

        [Parameter("Fitness Min Trades", Group = "Validation", DefaultValue = 20, MinValue = 1, MaxValue = 1000)]
        public int FitnessMinTrades { get; set; }

        // -----------------------------------------------------------------------------
        //  State
        // -----------------------------------------------------------------------------
        private static readonly CultureInfo Inv = CultureInfo.InvariantCulture;
        private Bars _d1, _m1;
        private AverageTrueRange _atr;
        private bool _persist, _ddHalt;
        private long _keyAccount;
        private string _keySymbol;
        private double _peakEquity, _lastSavedPeak;
        private int _ddTrips, _signals, _entries;
        private readonly Dictionary<int, double> _extreme = new Dictionary<int, double>();   // position id -> best close
        private readonly Dictionary<string, int> _skips = new Dictionary<string, int>();
        private string _lastNote = "waiting for the first daily close";

        // -----------------------------------------------------------------------------
        //  Lifecycle
        // -----------------------------------------------------------------------------
        protected override void OnStart()
        {
            if (DemoOnly && Account.IsLive)
            {
                Print("DEMO ONLY: this is a live account. GoldTrend D1 stays on demo until it has passed cbot-gate.");
                Stop();
                return;
            }
            string sym = SymbolName.ToUpperInvariant();
            if (!(sym.Contains("XAUUSD") || sym.StartsWith("GOLD")))
            {
                Print("Attach GoldTrend D1 to an XAUUSD (gold) chart. Current symbol: {0}.", SymbolName);
                Stop();
                return;
            }
            if (TrailAtr < StopAtr)
                Print("Note: Chandelier Trail ({0}) is tighter than Initial Stop ({1}); the trail will take over at entry.", TrailAtr, StopAtr);

            _persist = RunningMode == RunningMode.RealTime;
            _keyAccount = Account.Number; _keySymbol = SymbolName;

            _d1 = MarketData.GetBars(TimeFrame.Daily);
            try { while (_d1.Count < BreakoutDays + AtrPeriod * 5 + 5 && _d1.LoadMoreHistory() > 0) { } }
            catch (Exception e) { Print("Could not load more daily history: {0}", e.Message); }
            _m1 = MarketData.GetBars(TimeFrame.Minute);
            _atr = Indicators.AverageTrueRange(_d1, AtrPeriod, MovingAverageType.WilderSmoothing);

            _d1.BarOpened += OnDailyBar;
            _m1.BarOpened += OnMinuteBar;
            LoadState();

            foreach (var p in BotPositions()) _extreme[p.Id] = RecoverExtreme(p);

            Print("GoldTrend D1 on {0} | mode {1} | daily bars {2} | breakout {3}d, stop {4} ATR, trail {5} ATR, shorts {6} | risk {7}% per trade, DD halt {8}%, epoch {9}",
                SymbolName, RunningMode, _d1.Count, BreakoutDays, StopAtr, TrailAtr, AllowShorts, RiskPerTradePct, MaxPeakDrawdownPct, KillSwitchEpoch);
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
            Print("==================== GoldTrend D1 report ({0}) ====================", RunningMode);
            Print("trades {0} | wins {1} | PF {2} | net {3} | longs {4} | shorts {5} | signals {6} | entries {7} | peak-DD halts {8}",
                mine.Count, mine.Count(h => h.NetProfit > 0), gl > 0 ? (gp / gl).ToString("F2", Inv) : "n/a",
                (gp - gl).ToString("F2", Inv), mine.Count(h => h.TradeType == TradeType.Buy),
                mine.Count(h => h.TradeType == TradeType.Sell), _signals, _entries, _ddTrips);
            foreach (var kv in _skips.OrderByDescending(k => k.Value))
                Print("  skipped {0,4}x  {1}", kv.Value, kv.Key);
        }

        // Profit Factor first, as cbot-gate judges. Too few trades always scores below any
        // run with enough trades; drawdown takes a small deduction.
        protected override double GetFitness(GetFitnessArgs args)
        {
            double trades = args.TotalTrades;
            if (trades < FitnessMinTrades) return -1.0 + trades / Math.Max(1, FitnessMinTrades);
            double pf = args.ProfitFactor;
            if (double.IsNaN(pf)) pf = 0;
            if (double.IsInfinity(pf) || pf > 10) pf = 10;
            return pf - 0.02 * args.MaxEquityDrawdownPercentages;
        }

        // -----------------------------------------------------------------------------
        //  Daily bar: max-hold exits, then the breakout signal
        // -----------------------------------------------------------------------------
        private void OnDailyBar(BarOpenedEventArgs e)
        {
            CheckRisk();
            if (_ddHalt && !_persist)
            {
                // Backtest only: re-arm on the next daily bar so one bad patch doesn't
                // silence the rest of the test. Every trip is counted in the report.
                _ddHalt = false;
                _peakEquity = Account.Equity;
                Print("[backtest] Peak-drawdown halt re-armed on {0:yyyy-MM-dd}.", Server.Time);
            }
            int now = _d1.Count - 1;      // the bar that just opened
            bool closedNow = false;
            int last = now - 1;           // the bar that just closed

            foreach (var p in BotPositions().ToList())
            {
                int entryBar = _d1.OpenTimes.GetIndexByTime(p.EntryTime);
                if (entryBar >= 0 && now - entryBar >= MaxHoldBars)
                {
                    ClosePosition(p);
                    closedNow = true;
                    Print("Max hold reached ({0} daily bars): closed {1} {2}.", MaxHoldBars, p.TradeType, p.Id);
                }
            }

            if (last < BreakoutDays + AtrPeriod) { _lastNote = "warming up"; return; }
            int sig = TrendMath.Signal(i => _d1.HighPrices[i], i => _d1.LowPrices[i], i => _d1.ClosePrices[i], last, BreakoutDays);
            if (sig == 0) { _lastNote = "no breakout on " + _d1.OpenTimes[last].ToString("yyyy-MM-dd", Inv); UpdatePanel(); return; }
            _signals++;
            string side = sig > 0 ? "BUY" : "SELL";

            string why = null;
            if (_ddHalt) why = "halt: peak drawdown";
            else if (sig < 0 && !AllowShorts) why = "shorts disabled";
            else if (BotPositions().Any()) why = "position already open";
            else if (closedNow) why = "position closed at this open";
            double atr = _atr.Result[last];
            if (why == null && !(atr > 0)) why = "ATR not ready";

            double volume = 0, stopDist = StopAtr * atr;
            if (why == null) why = Size(stopDist, out volume);
            if (why != null)
            {
                Count(side + ": " + why);
                _lastNote = side + " breakout skipped: " + why;
                Print("{0} breakout on {1:yyyy-MM-dd} skipped: {2}", side, _d1.OpenTimes[last], why);
                UpdatePanel();
                return;
            }

            string comment = string.Join("|", CommentTag, atr.ToString("R", Inv), TrailAtr.ToString("R", Inv));
            var type = sig > 0 ? TradeType.Buy : TradeType.Sell;
            TradeResult r = ExecuteMarketOrder(type, SymbolName, volume, Label, stopDist / Symbol.PipSize, null, comment);
            if (!r.IsSuccessful)
            {
                Count(side + ": order rejected " + r.Error);
                Print("{0} order rejected: {1}", side, r.Error);
                return;
            }
            _entries++;
            var pos = r.Position;
            _extreme[pos.Id] = pos.EntryPrice;
            _lastNote = string.Format(Inv, "{0} {1} oz at {2:F2}, stop {3:F2}", side, pos.VolumeInUnits, pos.EntryPrice, pos.StopLoss ?? 0);
            Print("{0} {1} units at {2} | stop {3} ({4} ATR = {5:F2}) | ATR {6:F2} | risk {7:F2}",
                side, pos.VolumeInUnits, pos.EntryPrice, pos.StopLoss, StopAtr, stopDist, atr,
                Symbol.AmountRisked(pos.VolumeInUnits, stopDist / Symbol.PipSize));
            UpdatePanel();
        }

        private string Size(double stopDist, out double volume)
        {
            volume = 0;
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

        // -----------------------------------------------------------------------------
        //  Minute bar: chandelier trail on the last closed M1 bar
        // -----------------------------------------------------------------------------
        private void OnMinuteBar(BarOpenedEventArgs e)
        {
            CheckRisk();
            if (_m1.Count < 2) return;
            double bidClose = _m1.ClosePrices.Last(1);
            foreach (var p in BotPositions().ToList())
            {
                if (!p.StopLoss.HasValue || !TryReadAtr(p, out double atr, out double k)) continue;
                bool buy = p.TradeType == TradeType.Buy;
                // Longs close at the bid, shorts at the ask. M1 bars are bid prices.
                double close = buy ? bidClose : bidClose + Symbol.Spread;
                double ext = _extreme.TryGetValue(p.Id, out double x) ? x : p.EntryPrice;
                ext = buy ? Math.Max(ext, close) : Math.Min(ext, close);
                _extreme[p.Id] = ext;
                double want = TrendMath.Trail(buy, p.StopLoss.Value, ext, atr, k);
                double step = Math.Max(Symbol.TickSize, 0.01 * atr);   // skip micro-moves to avoid flooding the server
                if (Math.Abs(want - p.StopLoss.Value) >= step)
                {
                    var res = p.ModifyStopLossPrice(Math.Round(want, Symbol.Digits));
                    if (!res.IsSuccessful) Print("Trail update failed on {0}: {1}", p.Id, res.Error);
                }
            }
        }

        private static bool TryReadAtr(Position p, out double atr, out double k)
        {
            atr = k = 0;
            var parts = (p.Comment ?? "").Split('|');
            return parts.Length >= 3 && parts[0] == CommentTag
                && double.TryParse(parts[1], NumberStyles.Float, Inv, out atr) && atr > 0
                && double.TryParse(parts[2], NumberStyles.Float, Inv, out k) && k > 0;
        }

        // After a restart: best close since entry from the M1 history that is loaded.
        // The trailed stop itself is already on the server, so this can only tighten it.
        private double RecoverExtreme(Position p)
        {
            bool buy = p.TradeType == TradeType.Buy;
            double ext = p.EntryPrice;
            int i = _m1.OpenTimes.GetIndexByTime(p.EntryTime);
            if (i < 0) return ext;
            for (; i < _m1.Count - 1; i++)
            {
                double c = buy ? _m1.ClosePrices[i] : _m1.ClosePrices[i] + Symbol.Spread;
                ext = buy ? Math.Max(ext, c) : Math.Min(ext, c);
            }
            return ext;
        }

        // -----------------------------------------------------------------------------
        //  Risk
        // -----------------------------------------------------------------------------
        private IEnumerable<Position> BotPositions()
        {
            return Positions.Where(p => p.Label == Label && p.SymbolName == SymbolName);
        }

        private void CheckRisk()
        {
            double eq = Account.Equity;
            if (eq > _peakEquity) _peakEquity = eq;
            if (_ddHalt) return;
            if (eq <= _peakEquity * (1 - MaxPeakDrawdownPct / 100.0))
            {
                _ddHalt = true;
                _ddTrips++;
                foreach (var p in BotPositions().ToList()) ClosePosition(p);
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
            return TrendMath.StorageKey(StatePrefix, _keyAccount, _keySymbol, name);
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

        private void Count(string key)
        {
            _skips.TryGetValue(key, out int n);
            _skips[key] = n + 1;
        }

        // -----------------------------------------------------------------------------
        //  Chart panel (real time and visual backtests)
        // -----------------------------------------------------------------------------
        private void UpdatePanel()
        {
            if (RunningMode != RunningMode.RealTime && RunningMode != RunningMode.VisualBacktesting) return;
            int last = _d1.Count - 2;
            var sb = new StringBuilder();
            sb.AppendLine("GoldTrend D1  (DEMO ONLY)");
            if (last > BreakoutDays + AtrPeriod)
            {
                // Levels the CURRENT daily bar must close beyond to signal at the next open.
                double hi = TrendMath.Channel(i => _d1.HighPrices[i], last + 1, BreakoutDays, true);
                double lo = TrendMath.Channel(i => _d1.LowPrices[i], last + 1, BreakoutDays, false);
                double atr = _atr.Result[last];
                double need = Symbol.AmountRisked(Symbol.VolumeInUnitsMin, StopAtr * atr / Symbol.PipSize) / (RiskPerTradePct / 100.0);
                sb.AppendLine(string.Format(Inv, "Buy if today closes above {0:F2}", hi));
                sb.AppendLine(string.Format(Inv, "Sell if today closes below {0:F2}{1}", lo, AllowShorts ? "" : " (shorts off)"));
                sb.AppendLine(string.Format(Inv, "ATR({0}) {1:F2} -> stop {2:F2}", AtrPeriod, atr, StopAtr * atr));
                sb.AppendLine(string.Format(Inv, "Min equity for 1 min lot at {0}%: {1:F0} {2}", RiskPerTradePct, need, Account.Asset.Name));
            }
            foreach (var p in BotPositions())
                sb.AppendLine(string.Format(Inv, "{0} {1} at {2:F2}  stop {3:F2}  P/L {4:F2}", p.TradeType, p.VolumeInUnits, p.EntryPrice, p.StopLoss ?? 0, p.NetProfit));
            double dd = _peakEquity > 0 ? (1 - Account.Equity / _peakEquity) * 100 : 0;
            sb.AppendLine(_ddHalt ? "HALTED: peak drawdown (change KillSwitchEpoch after review)"
                                  : string.Format(Inv, "Drawdown from peak {0:F1}% (halt at {1}%)", dd, MaxPeakDrawdownPct));
            sb.AppendLine("Last: " + _lastNote);
            Chart.DrawStaticText("gtd1_panel", sb.ToString(), VerticalAlignment.Top, HorizontalAlignment.Left, Color.Gold);
        }
    }

    // =====================================================================================
    //  Pure logic, no cTrader types: unit-tested in tests/ and checked against the
    //  research harness's daily signals.
    // =====================================================================================
    public static class TrendMath
    {
        /// LocalStorage key: Latin letters, digits and single spaces only, no space at either end.
        public static string StorageKey(string prefix, long account, string symbol, string name)
        {
            string Clean(string s) => new string((s ?? "").Where(c => (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9')).ToArray());
            return string.Join(" ", new[] { Clean(prefix), account.ToString(CultureInfo.InvariantCulture), Clean(symbol), Clean(name) }.Where(x => x.Length > 0));
        }

        /// Highest (max=true) or lowest value of the n bars BEFORE index `bar`.
        public static double Channel(Func<int, double> x, int bar, int n, bool max)
        {
            double v = max ? double.MinValue : double.MaxValue;
            for (int i = bar - n; i < bar; i++)
                v = max ? Math.Max(v, x(i)) : Math.Min(v, x(i));
            return v;
        }

        /// +1 if bar `last` closed above the highest high of the n bars before it,
        /// -1 if it closed below their lowest low, otherwise 0.
        public static int Signal(Func<int, double> high, Func<int, double> low, Func<int, double> close, int last, int n)
        {
            if (last < n) return 0;
            double c = close(last);
            if (c > Channel(high, last, n, true)) return 1;
            if (c < Channel(low, last, n, false)) return -1;
            return 0;
        }

        /// Chandelier trail: best close since entry minus (longs) / plus (shorts) k ATRs.
        /// Never loosens the current stop.
        public static double Trail(bool buy, double currentStop, double bestClose, double atr, double k)
        {
            return buy ? Math.Max(currentStop, bestClose - k * atr)
                       : Math.Min(currentStop, bestClose + k * atr);
        }
    }
}

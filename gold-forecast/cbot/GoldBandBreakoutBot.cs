// GoldBandBreakoutBot v1  -  XAUUSD, hourly volatility bands, breakout rules.
//
// Mirrors gold-forecast/bandfade_backtest.py with mode="breakout", centre="prior_close",
// z=1.2816 (80% band), US-data hour skipped. On 5-minute bars (Jan-Nov 2026) that variant
// passed cbot-gate: OOS PF 1.44 on 111 trades, P(PF<1) 4.4%, 16 variants tested.
// Its in-sample PF was only 1.04, so: DEMO ONLY until it also passes a cTrader tick-data
// backtest on a period this research never saw (e.g. 2023-01-01 -> 2026-01-12).
//
// Each session (daily break >= 2h apart):
//   anchor = previous session close; ATR = Wilder 14 over sessions;
//   sigma[k] = RMS move from the prior close at hourly bar k over the last 120 sessions (ATR units)
// Each hour k (not the first, not the last, not the US-data bar), while flat:
//   d = BandZ * sigma[k] * ATR
//   BUY STOP at anchor + d, SELL STOP at anchor - d, each with TP = d and SL = d (1:1);
//   if price is already beyond a level, enter at market; the first fill cancels the other;
//   unfilled orders expire at the end of the hour. Everything is flat before the session close.

using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;
using cAlgo.API;
using cAlgo.API.Internals;

namespace cAlgo.Robots
{
    [Robot(TimeZone = TimeZones.UTC, AccessRights = AccessRights.FullAccess)]
    public class GoldBandBreakoutBot : Robot
    {
        // ---- Risk: fixed constants, never [Parameter]. Change them by editing code, on purpose. ----
        private const double LotSize = 0.01;                  // 0.01 lot = 1 oz of gold
        private const int MaxOpenPositions = 1;
        private const int MaxTradesPerSession = 4;
        private const double MaxLossPerTradeAccount = 1800.0; // account currency (ZAR on the demo); skip wider set-ups
        private const double MaxDailyLossAccount = 3000.0;    // no new entries this session after losing this much
        private const double MinFreeMarginAccount = 500.0;    // no new orders below this free margin
        private const double MaxSpreadPrice = 1.00;           // $ per oz
        private const string BotLabel = "GBB1";

        // ---- Fixed rules, exactly as backtested ----
        private const int AtrPeriod = 14;
        private const int MinSessionBars = 16;                // skip holiday stubs in the profile
        private const int BarsPerSession = 23;
        private const int DataHourBar = 14;                   // US 08:30 ET bar (winter and summer)
        private const double SessionGapHours = 2.0;
        private const int EntryCutoffMinutes = 65;            // no entries in the session's last hour
        private const int FlatBeforeCloseMinutes = 5;

        // ---- Strategy parameters (shape the signal, not the risk) ----
        [Parameter("Band z (1.2816 = 80% band)", DefaultValue = 1.2816, MinValue = 0.6, MaxValue = 2.0, Step = 0.1, Group = "Strategy")]
        public double BandZ { get; set; }

        [Parameter("Skip US-data hour", DefaultValue = true, Group = "Strategy")]
        public bool SkipDataHour { get; set; }

        [Parameter("Profile sessions", DefaultValue = 120, MinValue = 60, MaxValue = 250, Step = 20, Group = "Strategy")]
        public int ProfileSessions { get; set; }

        private Bars _h1;
        private double _volume;
        private int _sessionStart = -1;
        private bool _ready;
        private double _anchor, _atr;
        private double[] _sigma = new double[BarsPerSession];
        private int _tradesThisSession;
        private double _pnlThisSession;

        private class Session
        {
            public int Start, End, Bars;
            public double High, Low, Close, Atr;
        }

        protected override void OnStart()
        {
            _h1 = MarketData.GetBars(TimeFrame.Hour);
            int need = (ProfileSessions + AtrPeriod + 40) * (BarsPerSession + 1);
            while (_h1.Count < need && _h1.LoadMoreHistory() > 0) { }
            _volume = Symbol.NormalizeVolumeInUnits(Symbol.QuantityToVolumeInUnits(LotSize));

            _h1.BarOpened += OnHourOpened;
            Positions.Opened += OnPositionOpened;
            Positions.Closed += OnPositionClosed;

            // A restart between a fill and its protection must never leave a naked position.
            foreach (var p in Positions.FindAll(BotLabel, SymbolName))
                if (p.StopLoss == null)
                    ClosePosition(p);

            Print("GoldBandBreakoutBot v1: {0} H1 bars loaded, {1} units per trade", _h1.Count, _volume);
        }

        private void OnHourOpened(BarOpenedEventArgs args)
        {
            CancelOwnOrders();
            int now = _h1.Count - 1;                          // the bar that just opened
            int start = SessionStartOf(now);
            if (start != _sessionStart)
            {
                // New session: nothing carries over (backup for brokers whose market hours
                // do not mark the daily break), counters reset, bands recalibrated.
                foreach (var p in Positions.FindAll(BotLabel, SymbolName))
                    ClosePosition(p);
                _sessionStart = start;
                _tradesThisSession = 0;
                _pnlThisSession = 0;
                _ready = Calibrate(start);
            }
            if (!_ready)
                return;

            int k = now - start;
            if (k == 0 || k >= BarsPerSession - 1)
                return;                                       // rollover hour / last hour
            if (SkipDataHour && k == DataHourBar)
                return;
            if (Symbol.MarketHours.TimeTillClose() < TimeSpan.FromMinutes(EntryCutoffMinutes))
                return;
            if (Positions.FindAll(BotLabel, SymbolName).Length >= MaxOpenPositions)
                return;
            if (_tradesThisSession >= MaxTradesPerSession || _pnlThisSession <= -MaxDailyLossAccount)
                return;
            if (Symbol.Spread > MaxSpreadPrice || Account.FreeMargin < MinFreeMarginAccount)
                return;

            double d = BandZ * _sigma[k] * _atr;
            double riskAccount = d / Symbol.PipSize * Symbol.PipValue * _volume;
            if (d <= 0 || riskAccount > MaxLossPerTradeAccount)
            {
                Print("Bar {0}: skipped, stop would risk {1:F0} (cap {2:F0})", k, riskAccount, MaxLossPerTradeAccount);
                return;
            }
            double pips = Math.Round(d / Symbol.PipSize, 1);
            double up = Math.Round(_anchor + d, Symbol.Digits);
            double down = Math.Round(_anchor - d, Symbol.Digits);
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
            CancelOwnOrders();                                // one-cancels-other
        }

        private void OnPositionClosed(PositionClosedEventArgs args)
        {
            if (args.Position.Label == BotLabel && args.Position.SymbolName == SymbolName)
                _pnlThisSession += args.Position.NetProfit;
        }

        private void CancelOwnOrders()
        {
            foreach (var o in PendingOrders.Where(o => o.Label == BotLabel && o.SymbolName == SymbolName).ToList())
                CancelPendingOrder(o);
        }

        private int SessionStartOf(int i)
        {
            while (i > 0 && (_h1.OpenTimes[i] - _h1.OpenTimes[i - 1]).TotalHours < SessionGapHours)
                i--;
            return i;
        }

        private List<Session> CompletedSessions(int beforeIndex)
        {
            var list = new List<Session>();
            Session cur = null;
            for (int i = 0; i < beforeIndex; i++)
            {
                bool fresh = cur == null || (_h1.OpenTimes[i] - _h1.OpenTimes[i - 1]).TotalHours >= SessionGapHours;
                if (fresh)
                {
                    cur = new Session { Start = i, High = _h1.HighPrices[i], Low = _h1.LowPrices[i] };
                    list.Add(cur);
                }
                cur.End = i;
                cur.Bars = i - cur.Start + 1;
                cur.High = Math.Max(cur.High, _h1.HighPrices[i]);
                cur.Low = Math.Min(cur.Low, _h1.LowPrices[i]);
                cur.Close = _h1.ClosePrices[i];
            }
            double atr = 0;
            for (int j = 0; j < list.Count; j++)
            {
                var s = list[j];
                double tr = j == 0
                    ? s.High - s.Low
                    : Math.Max(s.High - s.Low, Math.Max(Math.Abs(s.High - list[j - 1].Close), Math.Abs(s.Low - list[j - 1].Close)));
                atr = j == 0 ? tr : atr + (tr - atr) / AtrPeriod;
                s.Atr = atr;
            }
            return list;
        }

        private bool Calibrate(int sessionStart)
        {
            var s = CompletedSessions(sessionStart);
            if (s.Count < ProfileSessions + AtrPeriod + 2)
            {
                Print("Not enough history to calibrate ({0} sessions)", s.Count);
                return false;
            }
            var last = s[s.Count - 1];
            _anchor = last.Close;
            _atr = last.Atr;
            var sum = new double[BarsPerSession];
            var n = new int[BarsPerSession];
            for (int d = s.Count - 1 - ProfileSessions; d < s.Count - 1; d++)
            {
                Session a = s[d], b = s[d + 1];
                if (a.Bars < MinSessionBars || b.Bars < MinSessionBars || a.Atr <= 0)
                    continue;
                for (int k = 0; k < BarsPerSession; k++)
                {
                    int i = Math.Min(b.Start + k, b.End);     // short sessions hold their last close
                    double x = (_h1.ClosePrices[i] - a.Close) / a.Atr;
                    sum[k] += x * x;
                    n[k]++;
                }
            }
            for (int k = 0; k < BarsPerSession; k++)
                _sigma[k] = n[k] > 0 ? Math.Sqrt(sum[k] / n[k]) : 0;
            Print("Session {0:yyyy-MM-dd HH:mm}: anchor {1:F2}, ATR {2:F2}, band bar 1 +-{3:F2}, bar 21 +-{4:F2}",
                  _h1.OpenTimes[sessionStart], _anchor, _atr, BandZ * _sigma[1] * _atr, BandZ * _sigma[21] * _atr);
            return _sigma[1] > 0;
        }

        // Writes this bot's closed trades to Documents/cBotLogs for cbot-gate (skipped in optimisation).
        protected override void OnStop()
        {
            if (RunningMode == RunningMode.Optimization)
                return;
            var inv = CultureInfo.InvariantCulture;
            var sb = new StringBuilder("Closing Time,Entry Time,Symbol,Direction,Volume,Pips,Gross,Commissions,Swap,Net Profit,Balance\n");
            foreach (var t in History)
            {
                if (t.Label != BotLabel)
                    continue;
                sb.AppendLine(string.Join(",",
                    t.ClosingTime.ToString("yyyy-MM-dd HH:mm:ss", inv), t.EntryTime.ToString("yyyy-MM-dd HH:mm:ss", inv),
                    t.SymbolName, t.TradeType, t.VolumeInUnits.ToString(inv), t.Pips.ToString(inv),
                    t.GrossProfit.ToString(inv), t.Commissions.ToString(inv), t.Swap.ToString(inv),
                    t.NetProfit.ToString(inv), t.Balance.ToString(inv)));
            }
            var mode = RunningMode == RunningMode.RealTime ? "live" : "backtest";
            var name = string.Format("GoldBandBreakoutBot_{0}_{1}_{2:yyyyMMdd_HHmmss}.csv", SymbolName, mode, DateTime.Now);
            var path = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), "cBotLogs", name);
            Directory.CreateDirectory(Path.GetDirectoryName(path));
            System.IO.File.WriteAllText(path, sb.ToString());
            Print("Trade log written: {0}", path);
        }
    }
}

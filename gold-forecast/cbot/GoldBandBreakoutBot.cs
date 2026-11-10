// GoldBandBreakoutBot v1.3  -  XAUUSD, hourly volatility bands, breakout rules.
// v1.3: a set-up is skipped when its stop would risk more than 10% of the account's equity, so a tiny account
//       (e.g. R200) can never be wiped by one stop. Leverage only lowers margin; it does not shrink the loss.
// v1.2: loss caps are in USD (gold's quote currency) so they mean the same on a ZAR, EUR or USD account;
//       a restart keeps an open position and rebuilds this session's trade count and loss from history.
// v1.1: runs in cTrader cloud (AccessRights.None, trade log printed instead of written to a file,
//       calibrates on 60+ sessions if the cloud supplies less history). Trading rules unchanged.
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
using System.Linq;
using cAlgo.API;
using cAlgo.API.Internals;

namespace cAlgo.Robots
{
    [Robot(TimeZone = TimeZones.UTC, AccessRights = AccessRights.None)]
    public class GoldBandBreakoutBot : Robot
    {
        // ---- Risk: fixed constants, never [Parameter]. Change them by editing code, on purpose. ----
        private const double LotSize = 0.01;                  // 0.01 lot = 1 oz of gold
        private const int MaxOpenPositions = 1;
        private const int MaxTradesPerSession = 4;
        private const double MaxLossPerTradeUsd = 100.0;      // skip set-ups whose stop would risk more than this (USD)
        private const double MaxDailyLossUsd = 150.0;         // no new entries this session after losing this much (USD)
        private const double MinFreeMarginAccount = 100.0;    // no new orders below this free margin (account currency)
        private const double MaxStopRiskPercentOfEquity = 10.0; // skip set-ups whose stop risks more than this share of equity
        private const double MaxSpreadPrice = 1.00;           // $ per oz
        private const string BotLabel = "GBB1";

        // ---- Fixed rules, exactly as backtested ----
        private const int AtrPeriod = 14;
        private const int MinSessionBars = 16;                // skip holiday stubs in the profile
        private const int MinProfileSessions = 60;            // fewest sessions the bands may be built from
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
        private double _pnlUsdThisSession;

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

            // Rebuild the current session so a restart keeps open trades and cannot reset the limits.
            _sessionStart = SessionStartOf(_h1.Count - 1);
            _ready = Calibrate(_sessionStart);
            DateTime sessionOpen = _h1.OpenTimes[_sessionStart];
            foreach (var t in History.Where(t => t.Label == BotLabel && t.SymbolName == SymbolName && t.EntryTime >= sessionOpen))
            {
                _tradesThisSession++;
                _pnlUsdThisSession += t.Pips * Symbol.PipSize * t.VolumeInUnits;
            }
            _tradesThisSession += Positions.FindAll(BotLabel, SymbolName).Length;

            Print("GoldBandBreakoutBot v1.3: {0} H1 bars loaded, {1} units per trade, {2} trades / ${3:F2} so far this session",
                  _h1.Count, _volume, _tradesThisSession, _pnlUsdThisSession);
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
                _pnlUsdThisSession = 0;
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
            if (_tradesThisSession >= MaxTradesPerSession || _pnlUsdThisSession <= -MaxDailyLossUsd)
                return;
            if (Symbol.Spread > MaxSpreadPrice || Account.FreeMargin < MinFreeMarginAccount)
                return;

            double d = BandZ * _sigma[k] * _atr;
            double riskUsd = d * _volume;                     // 1 unit = 1 oz, so price distance x units = USD
            if (d <= 0 || riskUsd > MaxLossPerTradeUsd)
            {
                Print("Bar {0}: skipped, stop would risk ${1:F0} (cap ${2:F0})", k, riskUsd, MaxLossPerTradeUsd);
                return;
            }
            double riskAccount = d / Symbol.PipSize * Symbol.PipValue * _volume;   // same loss, in account currency
            if (riskAccount > Account.Equity * MaxStopRiskPercentOfEquity / 100.0)
            {
                Print("Bar {0}: skipped, stop would risk {1:F2} = {2:F1}% of equity (cap {3:F0}%)",
                      k, riskAccount, 100.0 * riskAccount / Math.Max(Account.Equity, 0.01), MaxStopRiskPercentOfEquity);
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
            if (args.Position.Label != BotLabel || args.Position.SymbolName != SymbolName)
                return;
            var p = args.Position;
            _pnlUsdThisSession += p.Pips * Symbol.PipSize * p.VolumeInUnits;   // price move x oz = USD
            var inv = CultureInfo.InvariantCulture;
            // One CSV line per closed trade in the log (cloud instances cannot write files).
            Print("TRADE,{0},{1},{2},{3},{4},{5}", Server.Time.ToString("yyyy-MM-dd HH:mm:ss", inv), p.TradeType,
                  p.EntryPrice.ToString(inv), p.EntryTime.ToString("yyyy-MM-dd HH:mm:ss", inv),
                  p.NetProfit.ToString(inv), args.Reason);
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
            int use = Math.Min(ProfileSessions, s.Count - AtrPeriod - 2);
            if (use < MinProfileSessions)
            {
                Print("Not enough history to calibrate ({0} sessions)", s.Count);
                return false;
            }
            if (use < ProfileSessions)
                Print("Only {0} sessions of history: bands built from {1} instead of {2}", s.Count, use, ProfileSessions);
            var last = s[s.Count - 1];
            _anchor = last.Close;
            _atr = last.Atr;
            var sum = new double[BarsPerSession];
            var n = new int[BarsPerSession];
            for (int d = s.Count - 1 - use; d < s.Count - 1; d++)
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

        protected override void OnStop()
        {
            var mine = History.Where(t => t.Label == BotLabel).ToList();
            double won = mine.Where(t => t.NetProfit > 0).Sum(t => t.NetProfit);
            double lost = -mine.Where(t => t.NetProfit < 0).Sum(t => t.NetProfit);
            Print("Stopped: {0} trades, net {1:F2}, profit factor {2}", mine.Count, won - lost,
                  lost > 0 ? (won / lost).ToString("F2", CultureInfo.InvariantCulture) : "n/a");
        }
    }
}

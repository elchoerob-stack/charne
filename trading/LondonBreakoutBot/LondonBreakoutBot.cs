// LondonBreakoutBot — Asian-range breakout at the London open, for cTrader
//
// Attach to an M1 chart (EURUSD to start). Robot time zone is London local time
// (GMT Standard Time, DST-aware), so session hours stay aligned all year.
//
// Edge hypothesis: the overnight (Asian) range gets resolved at the London open, and
// the first M1 close outside it continues far enough for a stop at the far side of
// the range to be positive-expectancy. Wide stops (~25 pips) keep costs ~3% of 1R.
// STATUS: FAILED the 2020 replica backtest (see README). Validate before any live use.
//
// RISK RULES ARE HARDCODED CONSTANTS. They are deliberately NOT [Parameter]s so
// they can never be optimised or fat-fingered (PivotTargetBot lesson).

using System;
using cAlgo.API;
using cAlgo.API.Indicators;
using cAlgo.API.Internals;

namespace cAlgo.Robots
{
    [Robot(TimeZone = TimeZones.GMTStandardTime, AccessRights = AccessRights.None)]
    public class LondonBreakoutBot : Robot
    {
        // ---------------- Hardcoded risk (do not expose) ----------------
        private const double RiskPerTradePct     = 1.0;   // target risk per trade, % of balance
        private const double MaxRiskPerTradePct  = 2.0;   // skip trade if min lot would exceed this
        private const double MaxDailyLossPct     = 3.0;   // stop trading for the day
        private const double MaxDrawdownPct      = 20.0;  // kill switch from equity peak — bot stops
        private const double MaxSpreadSlFrac     = 0.10;  // skip if spread > 10% of stop distance
        private const double BreakEvenAtR        = 1.0;   // move SL to entry (+1 pip) at 1R

        // ---------------- Strategy parameters (optimisable) ----------------
        [Parameter("Asia Start (London h)", DefaultValue = 0, MinValue = 0, MaxValue = 23, Group = "Session")]
        public int AsiaStart { get; set; }

        [Parameter("Asia End / London Open (h)", DefaultValue = 7, MinValue = 1, MaxValue = 23, Group = "Session")]
        public int AsiaEnd { get; set; }

        [Parameter("Entry Window End (h)", DefaultValue = 10, MinValue = 2, MaxValue = 23, Group = "Session")]
        public int EntryEnd { get; set; }

        [Parameter("Flat By (h)", DefaultValue = 16, MinValue = 2, MaxValue = 23, Group = "Session")]
        public int ExitHour { get; set; }

        [Parameter("Min Range x Daily ATR", DefaultValue = 0.15, MinValue = 0.05, MaxValue = 0.5, Step = 0.05, Group = "Strategy")]
        public double MinRangeAtr { get; set; }

        [Parameter("Max Range x Daily ATR", DefaultValue = 0.6, MinValue = 0.2, MaxValue = 1.2, Step = 0.1, Group = "Strategy")]
        public double MaxRangeAtr { get; set; }

        [Parameter("Breakout Buffer (pips)", DefaultValue = 1.0, MinValue = 0, MaxValue = 5, Step = 0.5, Group = "Strategy")]
        public double BufferPips { get; set; }

        [Parameter("Take Profit (R)", DefaultValue = 1.5, MinValue = 0.5, MaxValue = 4.0, Step = 0.25, Group = "Strategy")]
        public double TpR { get; set; }

        [Parameter("Label", DefaultValue = "LBO", Group = "Misc")]
        public string Label { get; set; }

        private AverageTrueRange _dailyAtr;

        private DateTime _currentDay;
        private double _dayStartBalance;
        private double _equityPeak;
        private double _rangeHigh, _rangeLow;
        private bool _hasRange, _tradedToday, _killed;

        protected override void OnStart()
        {
            var daily = MarketData.GetBars(TimeFrame.Daily);
            _dailyAtr = Indicators.AverageTrueRange(daily, 14, MovingAverageType.Simple);

            _equityPeak = Account.Equity;
            ResetDay(Server.Time.Date);

            Positions.Opened += p => { if (p.Position.Label == Label) Print($"OPEN {p.Position.TradeType} {p.Position.VolumeInUnits}u @ {p.Position.EntryPrice} range {_rangeLow}-{_rangeHigh}"); };
            Positions.Closed += p => { if (p.Position.Label == Label) Print($"CLOSE {p.Reason} net {p.Position.NetProfit:F2}"); };
        }

        protected override void OnTick()
        {
            ManageBreakEven();
            CheckKillSwitch();
        }

        protected override void OnBar()
        {
            if (_killed) return;

            DateTime now = Server.Time;
            if (now.Date != _currentDay) ResetDay(now.Date);

            // Time exit: never hold past the cut-off or overnight
            if (now.Hour >= ExitHour)
                foreach (var p in Positions.FindAll(Label, SymbolName)) ClosePosition(p);

            int i = Bars.Count - 2; // last CLOSED bar — never act on the forming bar
            if (i < 1) return;
            DateTime barTime = Bars.OpenTimes[i];
            if (barTime.Date != _currentDay) return;
            int hour = barTime.Hour;

            // 1) Build the Asian range from closed bars
            if (hour >= AsiaStart && hour < AsiaEnd)
            {
                if (!_hasRange) { _rangeHigh = Bars.HighPrices[i]; _rangeLow = Bars.LowPrices[i]; _hasRange = true; }
                else { _rangeHigh = Math.Max(_rangeHigh, Bars.HighPrices[i]); _rangeLow = Math.Min(_rangeLow, Bars.LowPrices[i]); }
                return;
            }

            // 2) One breakout attempt per day inside the entry window
            if (!_hasRange || _tradedToday || hour < AsiaEnd || hour >= EntryEnd) return;
            if (Positions.FindAll(Label, SymbolName).Length > 0) return;
            if ((Account.Equity - _dayStartBalance) / _dayStartBalance * 100.0 <= -MaxDailyLossPct) return;

            double atrD = _dailyAtr.Result.Last(1);
            double range = _rangeHigh - _rangeLow;
            if (atrD <= 0 || range < MinRangeAtr * atrD || range > MaxRangeAtr * atrD) return;

            double buf = BufferPips * Symbol.PipSize;
            double close = Bars.ClosePrices[i];
            TradeType side;
            double stopPrice;
            if (close > _rangeHigh + buf) { side = TradeType.Buy;  stopPrice = _rangeLow - buf; }
            else if (close < _rangeLow - buf) { side = TradeType.Sell; stopPrice = _rangeHigh + buf + Symbol.Spread; }
            else return;

            _tradedToday = true; // one attempt per day, even if a gate below skips it
            Enter(side, stopPrice);
        }

        private void Enter(TradeType side, double stopPrice)
        {
            double entry = side == TradeType.Buy ? Symbol.Ask : Symbol.Bid;
            double slDist = side == TradeType.Buy ? entry - stopPrice : stopPrice - entry;
            if (slDist <= 0 || Symbol.Spread > slDist * MaxSpreadSlFrac) return;

            double slPips = slDist / Symbol.PipSize;
            double tpPips = slPips * TpR;

            double volume = CalcVolume(slPips, out double actualRiskPct);
            if (volume <= 0)
            {
                Print($"SKIP: min volume would risk {actualRiskPct:F2}% (> {MaxRiskPerTradePct}%). Account too small for this SL.");
                return;
            }

            var r = ExecuteMarketOrder(side, SymbolName, volume, Label, slPips, tpPips);
            if (!r.IsSuccessful) Print($"Order failed: {r.Error}");
        }

        // Returns 0 if the smallest tradable size breaches MaxRiskPerTradePct.
        private double CalcVolume(double slPips, out double actualRiskPct)
        {
            double riskMoney = Account.Balance * RiskPerTradePct / 100.0;
            double raw = riskMoney / (slPips * Symbol.PipValue);
            double vol = Symbol.NormalizeVolumeInUnits(raw, RoundingMode.Down);
            if (vol < Symbol.VolumeInUnitsMin) vol = Symbol.VolumeInUnitsMin;

            actualRiskPct = vol * slPips * Symbol.PipValue / Account.Balance * 100.0;
            return actualRiskPct > MaxRiskPerTradePct ? 0 : vol;
        }

        private void ResetDay(DateTime day)
        {
            _currentDay = day;
            _dayStartBalance = Account.Balance;
            _hasRange = false;
            _tradedToday = false;
        }

        private void CheckKillSwitch()
        {
            if (_killed) return;
            _equityPeak = Math.Max(_equityPeak, Account.Equity);
            double dd = (_equityPeak - Account.Equity) / _equityPeak * 100.0;
            if (dd < MaxDrawdownPct) return;

            _killed = true;
            foreach (var p in Positions.FindAll(Label, SymbolName)) ClosePosition(p);
            Print($"KILL SWITCH: drawdown {dd:F1}% >= {MaxDrawdownPct}%. Stopping.");
            Stop();
        }

        private void ManageBreakEven()
        {
            foreach (var p in Positions.FindAll(Label, SymbolName))
            {
                if (p.StopLoss == null) continue;
                double riskDist = Math.Abs(p.EntryPrice - p.StopLoss.Value);
                if (riskDist <= 0) continue;

                bool isBuy = p.TradeType == TradeType.Buy;
                double move = isBuy ? Symbol.Bid - p.EntryPrice : p.EntryPrice - Symbol.Ask;
                bool alreadyBe = isBuy ? p.StopLoss >= p.EntryPrice : p.StopLoss <= p.EntryPrice;
                if (alreadyBe || move < riskDist * BreakEvenAtR) continue;

                double be = isBuy ? p.EntryPrice + Symbol.PipSize : p.EntryPrice - Symbol.PipSize;
                ModifyPosition(p, be, p.TakeProfit, ProtectionType.Absolute);
            }
        }
    }
}

// KeystoneTrendBot — H1 trend-pullback cBot for cTrader
//
// Edge hypothesis: in an established trend (EMA200 slope + price side), pullbacks
// into the EMA50 zone that resolve with a close back in trend direction continue
// often enough that a 1.5 ATR stop / 2.5 ATR target is positive-expectancy.
// This is a HYPOTHESIS until walk-forward OOS testing says otherwise.
//
// RISK RULES ARE HARDCODED CONSTANTS. They are deliberately NOT [Parameter]s so
// they can never be optimised or fat-fingered (PivotTargetBot lesson).

using System;
using System.Linq;
using cAlgo.API;
using cAlgo.API.Indicators;
using cAlgo.API.Internals;

namespace cAlgo.Robots
{
    [Robot(TimeZone = TimeZones.UTC, AccessRights = AccessRights.None)]
    public class KeystoneTrendBot : Robot
    {
        // ---------------- Hardcoded risk (do not expose) ----------------
        private const double RiskPerTradePct     = 1.0;   // target risk per trade, % of balance
        private const double MaxRiskPerTradePct  = 2.0;   // skip trade if min lot would exceed this
        private const double MaxDailyLossPct     = 3.0;   // stop trading for the day
        private const double MaxDrawdownPct      = 20.0;  // kill switch from equity peak — bot stops
        private const int    MaxOpenPositions    = 1;
        private const double MaxSpreadAtrFrac    = 0.15;  // skip if spread > 15% of ATR
        private const double BreakEvenAtR        = 1.0;   // move SL to entry (+1 pip) at 1R

        // ---------------- Strategy parameters (optimisable) ----------------
        [Parameter("Trend EMA", DefaultValue = 200, MinValue = 100, MaxValue = 300, Step = 25, Group = "Strategy")]
        public int TrendEmaPeriod { get; set; }

        [Parameter("Pullback EMA", DefaultValue = 50, MinValue = 20, MaxValue = 80, Step = 5, Group = "Strategy")]
        public int PullbackEmaPeriod { get; set; }

        [Parameter("ATR Period", DefaultValue = 14, MinValue = 7, MaxValue = 28, Step = 7, Group = "Strategy")]
        public int AtrPeriod { get; set; }

        [Parameter("SL x ATR", DefaultValue = 1.5, MinValue = 1.0, MaxValue = 3.0, Step = 0.25, Group = "Strategy")]
        public double SlAtrMult { get; set; }

        [Parameter("TP x ATR", DefaultValue = 2.5, MinValue = 1.5, MaxValue = 5.0, Step = 0.25, Group = "Strategy")]
        public double TpAtrMult { get; set; }

        [Parameter("Session Start (UTC h)", DefaultValue = 7, MinValue = 0, MaxValue = 23, Group = "Filters")]
        public int SessionStart { get; set; }

        [Parameter("Session End (UTC h)", DefaultValue = 17, MinValue = 1, MaxValue = 24, Group = "Filters")]
        public int SessionEnd { get; set; }

        [Parameter("Label", DefaultValue = "KTB", Group = "Misc")]
        public string Label { get; set; }

        private ExponentialMovingAverage _trendEma;
        private ExponentialMovingAverage _pullEma;
        private RelativeStrengthIndex _rsi;
        private AverageTrueRange _atr;

        private DateTime _currentDay;
        private double _dayStartBalance;
        private double _equityPeak;
        private bool _killed;

        protected override void OnStart()
        {
            _trendEma = Indicators.ExponentialMovingAverage(Bars.ClosePrices, TrendEmaPeriod);
            _pullEma  = Indicators.ExponentialMovingAverage(Bars.ClosePrices, PullbackEmaPeriod);
            _rsi      = Indicators.RelativeStrengthIndex(Bars.ClosePrices, 14);
            _atr      = Indicators.AverageTrueRange(AtrPeriod, MovingAverageType.Simple);

            _currentDay      = Server.Time.Date;
            _dayStartBalance = Account.Balance;
            _equityPeak      = Account.Equity;

            Positions.Opened += p => { if (p.Position.Label == Label) Print($"OPEN {p.Position.TradeType} {p.Position.VolumeInUnits}u @ {p.Position.EntryPrice}"); };
            Positions.Closed += p => { if (p.Position.Label == Label) Print($"CLOSE {p.Reason} net {p.Position.NetProfit:F2}"); };
        }

        protected override void OnTick()
        {
            ManageBreakEven();
            CheckKillSwitch();
        }

        protected override void OnBar()
        {
            RollDay();
            if (_killed || !RiskGatesOpen()) return;

            int i = Bars.Count - 2; // last CLOSED bar — never act on the forming bar
            if (i < TrendEmaPeriod + 2) return;

            int hour = Bars.OpenTimes[i + 1].Hour;
            if (hour < SessionStart || hour >= SessionEnd) return;

            double atr = _atr.Result[i];
            if (atr <= 0 || Symbol.Spread > atr * MaxSpreadAtrFrac) return;

            double close = Bars.ClosePrices[i], open = Bars.OpenPrices[i];
            double low = Bars.LowPrices[i], high = Bars.HighPrices[i];
            double tEma = _trendEma.Result[i], tEmaPrev = _trendEma.Result[i - 5];
            double pEma = _pullEma.Result[i];
            double rsi = _rsi.Result[i];

            bool upTrend   = close > tEma && pEma > tEma && tEma > tEmaPrev;
            bool downTrend = close < tEma && pEma < tEma && tEma < tEmaPrev;

            bool longSetup  = upTrend   && low  <= pEma + 0.25 * atr && close > pEma && close > open && rsi > 40 && rsi < 70;
            bool shortSetup = downTrend && high >= pEma - 0.25 * atr && close < pEma && close < open && rsi < 60 && rsi > 30;

            if (longSetup)  Enter(TradeType.Buy, atr);
            else if (shortSetup) Enter(TradeType.Sell, atr);
        }

        private void Enter(TradeType side, double atr)
        {
            double slPips = SlAtrMult * atr / Symbol.PipSize;
            double tpPips = TpAtrMult * atr / Symbol.PipSize;

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

        private bool RiskGatesOpen()
        {
            if (Positions.FindAll(Label, SymbolName).Length >= MaxOpenPositions) return false;
            double dayPnlPct = (Account.Equity - _dayStartBalance) / _dayStartBalance * 100.0;
            return dayPnlPct > -MaxDailyLossPct;
        }

        private void RollDay()
        {
            if (Server.Time.Date == _currentDay) return;
            _currentDay = Server.Time.Date;
            _dayStartBalance = Account.Balance;
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

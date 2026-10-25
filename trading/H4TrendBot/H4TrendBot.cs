// H4TrendBot — H4 Donchian breakout trend-follower with ATR chandelier trail, for cTrader
//
// Attach to an H4 chart. One instance per symbol.
//
// Edge hypothesis: classic trend following. Breakouts of the 20-bar range in the direction
// of the EMA50/EMA200 trend are often wrong (expect ~25-35% win rate), but the winners,
// held with a trailing stop and no take profit, are large enough to pay for the losers.
// Costs are tiny relative to the ~2 ATR(H4) stop (~40-60 pips on EURUSD).
// STATUS: FAILED the 2020-2021 EURUSD replica backtest (60 trades, see README).
// Trend following needs many markets and many years to judge. Validate before live use.
//
// RISK RULES ARE HARDCODED CONSTANTS. They are deliberately NOT [Parameter]s so
// they can never be optimised or fat-fingered (PivotTargetBot lesson).

using System;
using cAlgo.API;
using cAlgo.API.Indicators;
using cAlgo.API.Internals;

namespace cAlgo.Robots
{
    [Robot(TimeZone = TimeZones.UTC, AccessRights = AccessRights.None)]
    public class H4TrendBot : Robot
    {
        // ---------------- Hardcoded risk (do not expose) ----------------
        private const double RiskPerTradePct     = 1.0;   // target risk per trade, % of balance
        private const double MaxRiskPerTradePct  = 2.0;   // skip trade if min lot would exceed this
        private const double MaxDrawdownPct      = 20.0;  // kill switch from equity peak — bot stops
        private const double MaxSpreadSlFrac     = 0.10;  // skip if spread > 10% of stop distance

        // ---------------- Strategy parameters (optimisable) ----------------
        [Parameter("Fast EMA", DefaultValue = 50, MinValue = 20, MaxValue = 100, Step = 10, Group = "Strategy")]
        public int FastPeriod { get; set; }

        [Parameter("Slow EMA", DefaultValue = 200, MinValue = 100, MaxValue = 300, Step = 50, Group = "Strategy")]
        public int SlowPeriod { get; set; }

        [Parameter("Donchian Bars", DefaultValue = 20, MinValue = 10, MaxValue = 60, Step = 5, Group = "Strategy")]
        public int DonchianBars { get; set; }

        [Parameter("ATR Period", DefaultValue = 14, MinValue = 7, MaxValue = 28, Step = 7, Group = "Strategy")]
        public int AtrPeriod { get; set; }

        [Parameter("Initial SL x ATR", DefaultValue = 2.0, MinValue = 1.0, MaxValue = 4.0, Step = 0.5, Group = "Strategy")]
        public double SlAtrMult { get; set; }

        [Parameter("Trail x ATR", DefaultValue = 3.0, MinValue = 1.5, MaxValue = 5.0, Step = 0.5, Group = "Strategy")]
        public double TrailAtrMult { get; set; }

        [Parameter("Label", DefaultValue = "H4T", Group = "Misc")]
        public string Label { get; set; }

        private ExponentialMovingAverage _fast, _slow;
        private AverageTrueRange _atr;
        private double _equityPeak;
        private bool _killed;

        protected override void OnStart()
        {
            if (TimeFrame != TimeFrame.Hour4)
                Print($"WARNING: designed and tested for H4, running on {TimeFrame}.");

            _fast = Indicators.ExponentialMovingAverage(Bars.ClosePrices, FastPeriod);
            _slow = Indicators.ExponentialMovingAverage(Bars.ClosePrices, SlowPeriod);
            _atr  = Indicators.AverageTrueRange(AtrPeriod, MovingAverageType.Simple);
            _equityPeak = Account.Equity;

            Positions.Opened += p => { if (p.Position.Label == Label) Print($"OPEN {p.Position.TradeType} {p.Position.VolumeInUnits}u @ {p.Position.EntryPrice} SL {p.Position.StopLoss}"); };
            Positions.Closed += p => { if (p.Position.Label == Label) Print($"CLOSE {p.Reason} net {p.Position.NetProfit:F2}"); };
        }

        protected override void OnTick()
        {
            CheckKillSwitch();
        }

        protected override void OnBar()
        {
            if (_killed) return;

            int i = Bars.Count - 2; // last CLOSED bar — never act on the forming bar
            if (i < Math.Max(SlowPeriod, DonchianBars) + 1) return;

            double atr = _atr.Result[i];
            if (atr <= 0) return;

            var open = Positions.FindAll(Label, SymbolName);
            if (open.Length > 0)
            {
                foreach (var p in open) Trail(p, i, atr);
                return;
            }

            double close = Bars.ClosePrices[i];
            double dcHigh = double.MinValue, dcLow = double.MaxValue;
            for (int k = i - DonchianBars; k < i; k++)
            {
                dcHigh = Math.Max(dcHigh, Bars.HighPrices[k]);
                dcLow  = Math.Min(dcLow,  Bars.LowPrices[k]);
            }

            if (_fast.Result[i] > _slow.Result[i] && close > dcHigh) Enter(TradeType.Buy, atr);
            else if (_fast.Result[i] < _slow.Result[i] && close < dcLow) Enter(TradeType.Sell, atr);
        }

        private void Enter(TradeType side, double atr)
        {
            double slDist = SlAtrMult * atr;
            if (Symbol.Spread > slDist * MaxSpreadSlFrac) return;
            double slPips = slDist / Symbol.PipSize;

            double volume = CalcVolume(slPips, out double actualRiskPct);
            if (volume <= 0)
            {
                Print($"SKIP: min volume would risk {actualRiskPct:F2}% (> {MaxRiskPerTradePct}%). Account too small for this SL.");
                return;
            }

            var r = ExecuteMarketOrder(side, SymbolName, volume, Label, slPips, null);
            if (!r.IsSuccessful) Print($"Order failed: {r.Error}");
        }

        // Chandelier trail: extreme since entry -/+ TrailAtrMult x ATR. Never loosens the stop.
        private void Trail(Position p, int i, double atr)
        {
            if (p.StopLoss == null) return;
            bool isBuy = p.TradeType == TradeType.Buy;

            double ext = isBuy ? double.MinValue : double.MaxValue;
            // bars from the one the entry filled in (opened < 4h before EntryTime) up to the last closed bar
            for (int k = i; k >= 0 && Bars.OpenTimes[k] > p.EntryTime.AddHours(-4); k--)
                ext = isBuy ? Math.Max(ext, Bars.HighPrices[k]) : Math.Min(ext, Bars.LowPrices[k]);
            if (ext == double.MinValue || ext == double.MaxValue) return;

            double newSl = isBuy ? ext - TrailAtrMult * atr : ext + TrailAtrMult * atr + Symbol.Spread;
            bool tighter = isBuy ? newSl > p.StopLoss.Value : newSl < p.StopLoss.Value;
            if (tighter) ModifyPosition(p, newSl, null, ProtectionType.Absolute);
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
    }
}

// CryptoTrendPortfolio — CryptoTrendBot v2 run from ONE cBot instance for all 11 coins
//
// Attach to any chart (any symbol, any timeframe). The bot loads H4 bars for every symbol in
// the "Symbols" list itself and trades them all, so only one instance is needed. Use this when
// you can only run one cBot at a time (e.g. cTrader Cloud, or a single-instance setup).
//
// Rules are identical to CryptoTrendBot (and H4TrendBot): EMA50/EMA200 trend filter, 20-bar
// Donchian breakout on H4 closes, 2xATR(14) initial stop, 3xATR chandelier trail, no take profit.
// v2 risk profile: 0.4% per trade, at most 4 positions open across all coins, 25% kill switch.
// Backtest 2017-2026: ~26%/yr, max drawdown 19.2%, every year positive (2022-2026: ~16%/yr).
// See trading/research/RESULTS.md.
//
// RISK RULES ARE HARDCODED CONSTANTS. They are deliberately NOT [Parameter]s so
// they can never be optimised or fat-fingered (PivotTargetBot lesson).

using System;
using System.Collections.Generic;
using System.Linq;
using cAlgo.API;
using cAlgo.API.Indicators;
using cAlgo.API.Internals;

namespace cAlgo.Robots
{
    [Robot(TimeZone = TimeZones.UTC, AccessRights = AccessRights.None)]
    public class CryptoTrendPortfolio : Robot
    {
        // ---------------- Hardcoded risk (do not expose) ----------------
        private const double RiskPerTradePct     = 0.40;  // target risk per trade, % of balance
        private const double MaxRiskPerTradePct  = 0.80;  // skip trade if min lot would exceed this
        private const int    MaxOpenPositions    = 4;     // across all symbols
        private const double MaxDrawdownPct      = 25.0;  // kill switch from equity peak — bot stops
        private const double MaxSpreadSlFrac     = 0.10;  // skip if spread > 10% of stop distance

        // ---------------- Market list ----------------
        // Broker symbol names differ (BTCUSD, BTC/USD, BITCOIN...). Check your broker's names.
        [Parameter("Symbols (comma separated)", DefaultValue = "BTCUSD,ETHUSD,BNBUSD,XRPUSD,ADAUSD,LINKUSD,SOLUSD,DOGEUSD,AVAXUSD,DOTUSD,NEARUSD", Group = "Markets")]
        public string SymbolList { get; set; }

        // ---------------- Strategy parameters (do not optimise; see RESULTS.md) ----------------
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

        [Parameter("Label", DefaultValue = "CTP", Group = "Misc")]
        public string Label { get; set; }

        private class Market
        {
            public Symbol Symbol;
            public Bars Bars;
            public ExponentialMovingAverage Fast, Slow;
            public AverageTrueRange Atr;
        }

        private readonly List<Market> _markets = new List<Market>();
        private double _equityPeak;
        private bool _killed;

        protected override void OnStart()
        {
            foreach (var name in SymbolList.Split(',').Select(s => s.Trim()).Where(s => s.Length > 0))
            {
                if (!Symbols.Exists(name))
                {
                    Print($"WARNING: symbol '{name}' not found at this broker; skipped. Check the name in Market Watch.");
                    continue;
                }
                var m = new Market { Symbol = Symbols.GetSymbol(name), Bars = MarketData.GetBars(TimeFrame.Hour4, name) };
                while (m.Bars.Count < SlowPeriod + DonchianBars + 10 && m.Bars.LoadMoreHistory() > 0) { }
                m.Fast = Indicators.ExponentialMovingAverage(m.Bars.ClosePrices, FastPeriod);
                m.Slow = Indicators.ExponentialMovingAverage(m.Bars.ClosePrices, SlowPeriod);
                m.Atr  = Indicators.AverageTrueRange(m.Bars, AtrPeriod, MovingAverageType.Simple);
                m.Bars.BarOpened += _ => OnMarketBar(m);
                m.Symbol.Tick += _ => CheckKillSwitch();
                _markets.Add(m);
            }
            Print($"Trading {_markets.Count} markets: {string.Join(", ", _markets.Select(x => x.Symbol.Name))}");

            _equityPeak = Account.Equity;
            Positions.Opened += p => { if (p.Position.Label == Label) Print($"OPEN {p.Position.SymbolName} {p.Position.TradeType} {p.Position.VolumeInUnits}u @ {p.Position.EntryPrice} SL {p.Position.StopLoss}"); };
            Positions.Closed += p => { if (p.Position.Label == Label) Print($"CLOSE {p.Position.SymbolName} {p.Reason} net {p.Position.NetProfit:F2}"); };
        }

        // Called once per symbol when a new H4 bar opens, i.e. the previous bar has just closed.
        // Events for different symbols run one after another on the bot's thread, so the
        // position cap below can't be raced.
        private void OnMarketBar(Market m)
        {
            if (_killed) return;

            var bars = m.Bars;
            int i = bars.Count - 2; // last CLOSED bar — never act on the forming bar
            if (i < Math.Max(SlowPeriod, DonchianBars) + 1) return;

            double atr = m.Atr.Result[i];
            if (atr <= 0) return;

            var open = Positions.FindAll(Label, m.Symbol.Name);
            if (open.Length > 0)
            {
                foreach (var p in open) Trail(m, p, i, atr);
                return;
            }

            if (Positions.Count(p => p.Label == Label) >= MaxOpenPositions) return;

            double close = bars.ClosePrices[i];
            double dcHigh = double.MinValue, dcLow = double.MaxValue;
            for (int k = i - DonchianBars; k < i; k++)
            {
                dcHigh = Math.Max(dcHigh, bars.HighPrices[k]);
                dcLow  = Math.Min(dcLow,  bars.LowPrices[k]);
            }

            if (m.Fast.Result[i] > m.Slow.Result[i] && close > dcHigh) Enter(m, TradeType.Buy, atr);
            else if (m.Fast.Result[i] < m.Slow.Result[i] && close < dcLow) Enter(m, TradeType.Sell, atr);
        }

        private void Enter(Market m, TradeType side, double atr)
        {
            var sym = m.Symbol;
            double slDist = SlAtrMult * atr;
            if (sym.Spread > slDist * MaxSpreadSlFrac) return;
            double slPips = slDist / sym.PipSize;

            double volume = CalcVolume(sym, slPips, out double actualRiskPct);
            if (volume <= 0)
            {
                Print($"SKIP {sym.Name}: min volume would risk {actualRiskPct:F2}% (> {MaxRiskPerTradePct}%). Account too small for this SL.");
                return;
            }

            var r = ExecuteMarketOrder(side, sym.Name, volume, Label, slPips, null);
            if (!r.IsSuccessful) Print($"Order failed {sym.Name}: {r.Error}");
        }

        // Chandelier trail: extreme since entry -/+ TrailAtrMult x ATR. Never loosens the stop.
        private void Trail(Market m, Position p, int i, double atr)
        {
            if (p.StopLoss == null) return;
            var bars = m.Bars;
            bool isBuy = p.TradeType == TradeType.Buy;

            double ext = isBuy ? double.MinValue : double.MaxValue;
            // bars from the one the entry filled in (opened < 4h before EntryTime) up to the last closed bar
            for (int k = i; k >= 0 && bars.OpenTimes[k] > p.EntryTime.AddHours(-4); k--)
                ext = isBuy ? Math.Max(ext, bars.HighPrices[k]) : Math.Min(ext, bars.LowPrices[k]);
            if (ext == double.MinValue || ext == double.MaxValue) return;

            double newSl = isBuy ? ext - TrailAtrMult * atr : ext + TrailAtrMult * atr + m.Symbol.Spread;
            bool tighter = isBuy ? newSl > p.StopLoss.Value : newSl < p.StopLoss.Value;
            if (tighter) ModifyPosition(p, newSl, null, ProtectionType.Absolute);
        }

        // Returns 0 if the smallest tradable size breaches MaxRiskPerTradePct.
        private double CalcVolume(Symbol sym, double slPips, out double actualRiskPct)
        {
            double riskMoney = Account.Balance * RiskPerTradePct / 100.0;
            double raw = riskMoney / (slPips * sym.PipValue);
            double vol = sym.NormalizeVolumeInUnits(raw, RoundingMode.Down);
            if (vol < sym.VolumeInUnitsMin) vol = sym.VolumeInUnitsMin;

            actualRiskPct = vol * slPips * sym.PipValue / Account.Balance * 100.0;
            return actualRiskPct > MaxRiskPerTradePct ? 0 : vol;
        }

        private void CheckKillSwitch()
        {
            if (_killed) return;
            _equityPeak = Math.Max(_equityPeak, Account.Equity);
            double dd = (_equityPeak - Account.Equity) / _equityPeak * 100.0;
            if (dd < MaxDrawdownPct) return;

            _killed = true;
            foreach (var p in Positions.Where(p => p.Label == Label).ToList()) ClosePosition(p);
            Print($"KILL SWITCH: drawdown {dd:F1}% >= {MaxDrawdownPct}%. Stopping.");
            Stop();
        }
    }
}

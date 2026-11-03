using System;
using System.Globalization;
using System.Linq;
using cAlgo.API;
using cAlgo.API.Indicators;

namespace cAlgo.Robots
{
    [Robot(TimeZone = TimeZones.UTC, AccessRights = AccessRights.None)]
    public class GoldGuardXauusdV2 : Robot
    {
        [Parameter("Risk per Trade (%)", DefaultValue = 0.5, MinValue = 0.05, MaxValue = 2, Group = "Risk")]
        public double RiskPct { get; set; }
        [Parameter("Daily Equity Loss (%)", DefaultValue = 2, MinValue = 0.5, MaxValue = 10, Group = "Risk")]
        public double DailyLossPct { get; set; }
        [Parameter("Peak Drawdown (%)", DefaultValue = 6, MinValue = 1, MaxValue = 25, Group = "Risk")]
        public double DrawdownPct { get; set; }
        [Parameter("Max Positions", DefaultValue = 2, MinValue = 1, MaxValue = 5, Group = "Risk")]
        public int MaxPositions { get; set; }
        [Parameter("Max Trades per UTC Day", DefaultValue = 6, MinValue = 1, MaxValue = 30, Group = "Risk")]
        public int MaxDailyTrades { get; set; }
        [Parameter("Max Consecutive Losses", DefaultValue = 3, MinValue = 1, MaxValue = 10, Group = "Risk")]
        public int MaxLossStreak { get; set; }
        [Parameter("Close on Risk Breach", DefaultValue = true, Group = "Risk")]
        public bool CloseOnBreach { get; set; }
        [Parameter("Max Total Bot Risk (%)", DefaultValue = 1, MinValue = 0.1, MaxValue = 5, Group = "Risk")]
        public double MaxTotalRiskPct { get; set; }

        [Parameter("Fast H1 EMA", DefaultValue = 34, MinValue = 5, Group = "Signals")]
        public int H1Fast { get; set; }
        [Parameter("Slow H1 EMA", DefaultValue = 100, MinValue = 10, Group = "Signals")]
        public int H1Slow { get; set; }
        [Parameter("Entry EMA", DefaultValue = 20, MinValue = 3, Group = "Signals")]
        public int EntryEma { get; set; }
        [Parameter("RSI Period", DefaultValue = 14, MinValue = 3, Group = "Signals")]
        public int RsiPeriod { get; set; }
        [Parameter("Buy RSI Minimum", DefaultValue = 52, MinValue = 40, MaxValue = 80, Group = "Signals")]
        public double BuyRsi { get; set; }
        [Parameter("Sell RSI Maximum", DefaultValue = 48, MinValue = 20, MaxValue = 60, Group = "Signals")]
        public double SellRsi { get; set; }
        [Parameter("Structure Lookback", DefaultValue = 8, MinValue = 3, MaxValue = 50, Group = "Signals")]
        public int StructureBars { get; set; }
        [Parameter("Enable Breakouts", DefaultValue = true, Group = "Signals")]
        public bool EnableBreakouts { get; set; }
        [Parameter("Enable Pullbacks", DefaultValue = true, Group = "Signals")]
        public bool EnablePullbacks { get; set; }
        [Parameter("Min Body / Range", DefaultValue = 0.45, MinValue = 0.1, MaxValue = 1, Group = "Signals")]
        public double MinBodyRatio { get; set; }

        [Parameter("ATR Period", DefaultValue = 14, MinValue = 3, Group = "Execution")]
        public int AtrPeriod { get; set; }
        [Parameter("ATR Stop Multiple", DefaultValue = 1.8, MinValue = 0.5, MaxValue = 6, Group = "Execution")]
        public double AtrStopMult { get; set; }
        [Parameter("Swing Stop Buffer ATR", DefaultValue = 0.2, MinValue = 0, MaxValue = 2, Group = "Execution")]
        public double SwingBuffer { get; set; }
        [Parameter("Min Stop (pips)", DefaultValue = 30, MinValue = 1, Group = "Execution")]
        public double MinStopPips { get; set; }
        [Parameter("Max Stop (pips)", DefaultValue = 600, MinValue = 10, Group = "Execution")]
        public double MaxStopPips { get; set; }
        [Parameter("Max Spread (pips)", DefaultValue = 35, MinValue = 0.1, Group = "Execution")]
        public double MaxSpreadPips { get; set; }
        [Parameter("Min ATR (pips)", DefaultValue = 20, MinValue = 0, Group = "Execution")]
        public double MinAtrPips { get; set; }
        [Parameter("Max ATR (pips)", DefaultValue = 500, MinValue = 1, Group = "Execution")]
        public double MaxAtrPips { get; set; }
        [Parameter("Reward / Risk", DefaultValue = 2, MinValue = 0.5, MaxValue = 8, Group = "Execution")]
        public double RewardRisk { get; set; }
        [Parameter("Cooldown Bars", DefaultValue = 2, MinValue = 0, MaxValue = 30, Group = "Execution")]
        public int CooldownBars { get; set; }

        [Parameter("Break Even at R", DefaultValue = 1, MinValue = 0.3, MaxValue = 5, Group = "Management")]
        public double BreakEvenR { get; set; }
        [Parameter("Break Even Buffer (pips)", DefaultValue = 2, MinValue = 0, Group = "Management")]
        public double BreakEvenBuffer { get; set; }
        [Parameter("Enable ATR Trailing", DefaultValue = true, Group = "Management")]
        public bool TrailEnabled { get; set; }
        [Parameter("Trail Starts at R", DefaultValue = 1.5, MinValue = 0.5, MaxValue = 6, Group = "Management")]
        public double TrailStartR { get; set; }
        [Parameter("Trail ATR Multiple", DefaultValue = 1.5, MinValue = 0.5, MaxValue = 5, Group = "Management")]
        public double TrailAtrMult { get; set; }

        [Parameter("Use UTC Session Filter", DefaultValue = true, Group = "Sessions")]
        public bool SessionFilter { get; set; }
        [Parameter("Start UTC Hour", DefaultValue = 7, MinValue = 0, MaxValue = 23, Group = "Sessions")]
        public int StartHour { get; set; }
        [Parameter("End UTC Hour (exclusive)", DefaultValue = 20, MinValue = 0, MaxValue = 23, Group = "Sessions")]
        public int EndHour { get; set; }
        [Parameter("Manual News Blackout", DefaultValue = false, Group = "Sessions")]
        public bool NewsBlackout { get; set; }
        [Parameter("Blackout Start UTC Hour", DefaultValue = 12, MinValue = 0, MaxValue = 23, Group = "Sessions")]
        public int BlackoutStart { get; set; }
        [Parameter("Blackout End UTC Hour", DefaultValue = 14, MinValue = 0, MaxValue = 23, Group = "Sessions")]
        public int BlackoutEnd { get; set; }

        private const string Label = "GoldGuardV2-XAU";
        private Bars _h1;
        private ExponentialMovingAverage _h1Fast, _h1Slow, _entry;
        private RelativeStrengthIndex _rsi;
        private AverageTrueRange _atr;
        private DateTime _day;
        private double _dayStartEquity, _peakEquity;
        private int _tradesToday, _lossStreak, _lastEntryBar = -100000;
        private bool _locked;
        private string _storageKey;
        private readonly CultureInfo _ci = CultureInfo.InvariantCulture;

        protected override void OnStart()
        {
            if (Account.IsLive)
            {
                Print("DEMO ONLY: live account detected. Bot will not run.");
                Stop(); return;
            }
            if (!SymbolName.ToUpperInvariant().Contains("XAUUSD") || TimeFrame != TimeFrame.Minute15)
            {
                Print("Use an XAUUSD M15 chart only. Current: {0} {1}", SymbolName, TimeFrame);
                Stop(); return;
            }
            if (H1Fast >= H1Slow || MaxStopPips <= MinStopPips || RewardRisk <= 0)
            {
                Print("Invalid parameter combination."); Stop(); return;
            }
            // A unique key per account and symbol. LocalStorage survives ordinary bot restarts.
            _storageKey = "GGV2_" + Account.Number + "_" + SymbolName.Replace(".", "_") + "_";
            _h1 = MarketData.GetBars(TimeFrame.Hour);
            _h1Fast = Indicators.ExponentialMovingAverage(_h1.ClosePrices, H1Fast);
            _h1Slow = Indicators.ExponentialMovingAverage(_h1.ClosePrices, H1Slow);
            _entry = Indicators.ExponentialMovingAverage(Bars.ClosePrices, EntryEma);
            _rsi = Indicators.RelativeStrengthIndex(Bars.ClosePrices, RsiPeriod);
            _atr = Indicators.AverageTrueRange(AtrPeriod, MovingAverageType.Exponential);
            _day = Server.Time.Date;
            _dayStartEquity = ReadDouble("dayEquity", Account.Equity);
            _peakEquity = Math.Max(ReadDouble("peakEquity", Account.Equity), Account.Equity);
            var savedDay = LocalStorage.GetString(_storageKey + "day");
            if (savedDay != _day.ToString("yyyyMMdd"))
            {
                _dayStartEquity = Account.Equity;
                _tradesToday = 0; _lossStreak = 0; _locked = false;
            }
            else
            {
                _tradesToday = ReadInt("trades", 0);
                _lossStreak = ReadInt("losses", 0);
                _locked = ReadInt("locked", 0) == 1;
            }
            SaveState();
            Positions.Closed += OnPositionClosed;
            Timer.Start(5);
            Print("GoldGuard v2 started on {0}, account {1}, trading enabled only on this chart. Confirm account is DEMO before starting.", SymbolName, Account.Number);
        }

        private double ReadDouble(string name, double fallback)
        {
            double value;
            return double.TryParse(LocalStorage.GetString(_storageKey + name), NumberStyles.Float, _ci, out value) && value > 0 ? value : fallback;
        }
        private int ReadInt(string name, int fallback)
        {
            int value;
            return int.TryParse(LocalStorage.GetString(_storageKey + name), out value) ? value : fallback;
        }
        private void SaveState()
        {
            LocalStorage.SetString(_storageKey + "day", _day.ToString("yyyyMMdd"));
            LocalStorage.SetString(_storageKey + "dayEquity", _dayStartEquity.ToString("R", _ci));
            LocalStorage.SetString(_storageKey + "peakEquity", _peakEquity.ToString("R", _ci));
            LocalStorage.SetString(_storageKey + "trades", _tradesToday.ToString());
            LocalStorage.SetString(_storageKey + "losses", _lossStreak.ToString());
            LocalStorage.SetString(_storageKey + "locked", _locked ? "1" : "0");
            LocalStorage.Flush();
        }
        private Position[] BotPositions() { return Positions.FindAll(Label, SymbolName); }
        private bool InHours(int hour, int start, int end)
        {
            if (start == end) return true;
            return start < end ? hour >= start && hour < end : hour >= start || hour < end;
        }
        private void CheckRisk()
        {
            if (Server.Time.Date != _day)
            {
                _day = Server.Time.Date; _dayStartEquity = Account.Equity;
                _tradesToday = 0; _lossStreak = 0; _locked = false;
                SaveState();
            }
            if (Account.Equity > _peakEquity) { _peakEquity = Account.Equity; SaveState(); }
            bool breach = Account.Equity <= _dayStartEquity * (1 - DailyLossPct / 100.0)
                || Account.Equity <= _peakEquity * (1 - DrawdownPct / 100.0);
            if (breach && !_locked)
            {
                _locked = true; SaveState();
                Print("EQUITY RISK BREACH: new entries disabled. Equity={0}", Account.Equity);
            }
            if (_locked && breach && CloseOnBreach)
                foreach (var p in BotPositions()) ClosePosition(p);
        }
        protected override void OnTimer()
        {
            CheckRisk();
            ManagePositions();
        }
        protected override void OnTick()
        {
            // Timer manages stops even in quiet markets; ticks provide faster protection.
            CheckRisk();
            ManagePositions();
        }
        private void OnPositionClosed(PositionClosedEventArgs args)
        {
            if (args.Position.Label != Label || args.Position.SymbolName != SymbolName) return;
            if (args.Position.NetProfit < 0) _lossStreak++;
            else if (args.Position.NetProfit > 0) _lossStreak = 0;
            SaveState();
            Print("Closed position {0}: net P/L {1}; loss streak {2}", args.Position.Id, args.Position.NetProfit, _lossStreak);
        }
        private void ManagePositions()
        {
            if (Bars.Count < AtrPeriod + 5) return;
            double atrPips = _atr.Result.Last(1) / Symbol.PipSize;
            if (atrPips <= 0 || double.IsNaN(atrPips)) return;
            foreach (var p in BotPositions())
            {
                if (!p.StopLoss.HasValue || !p.TakeProfit.HasValue) continue;
                // Initial R is inferred from the original fixed TP; remains stable after SL changes.
                double initialR = Math.Abs(p.TakeProfit.Value - p.EntryPrice) / Symbol.PipSize / RewardRisk;
                if (initialR <= 0) continue;
                double gain = p.TradeType == TradeType.Buy ? (Symbol.Bid - p.EntryPrice) / Symbol.PipSize : (p.EntryPrice - Symbol.Ask) / Symbol.PipSize;
                double desired = p.StopLoss.Value;
                if (gain >= initialR * BreakEvenR)
                {
                    double be = p.EntryPrice + (p.TradeType == TradeType.Buy ? 1 : -1) * BreakEvenBuffer * Symbol.PipSize;
                    desired = p.TradeType == TradeType.Buy ? Math.Max(desired, be) : Math.Min(desired, be);
                }
                if (TrailEnabled && gain >= initialR * TrailStartR)
                {
                    double trail = p.TradeType == TradeType.Buy ? Symbol.Bid - atrPips * TrailAtrMult * Symbol.PipSize : Symbol.Ask + atrPips * TrailAtrMult * Symbol.PipSize;
                    desired = p.TradeType == TradeType.Buy ? Math.Max(desired, trail) : Math.Min(desired, trail);
                }
                bool improved = p.TradeType == TradeType.Buy ? desired > p.StopLoss.Value + Symbol.TickSize : desired < p.StopLoss.Value - Symbol.TickSize;
                bool validSide = p.TradeType == TradeType.Buy ? desired < Symbol.Bid - Symbol.TickSize : desired > Symbol.Ask + Symbol.TickSize;
                if (improved && validSide)
                {
                    var result = ModifyPosition(p, Math.Round(desired, Symbol.Digits), p.TakeProfit);
                    if (!result.IsSuccessful) Print("Stop modification failed: {0}", result.Error);
                }
            }
        }
        protected override void OnBar()
        {
            CheckRisk();
            if (_locked || _lossStreak >= MaxLossStreak || _tradesToday >= MaxDailyTrades) return;
            if (Bars.Count < Math.Max(StructureBars + 5, Math.Max(EntryEma, AtrPeriod) + 5) || _h1.Count < H1Slow + 5) return;
            if (Bars.Count - _lastEntryBar <= CooldownBars) return;
            if (BotPositions().Length >= MaxPositions) return;
            if (SessionFilter && !InHours(Server.Time.Hour, StartHour, EndHour)) return;
            if (NewsBlackout && InHours(Server.Time.Hour, BlackoutStart, BlackoutEnd)) return;
            double spread = Symbol.Spread / Symbol.PipSize;
            double atr = _atr.Result.Last(1);
            double atrPips = atr / Symbol.PipSize;
            if (spread > MaxSpreadPips || atrPips < MinAtrPips || atrPips > MaxAtrPips || atr <= 0) return;

            int i = Bars.Count - 2; // last fully closed M15 candle
            int h = _h1.Count - 2; // last fully closed H1 candle
            double open = Bars.OpenPrices[i], close = Bars.ClosePrices[i];
            double high = Bars.HighPrices[i], low = Bars.LowPrices[i];
            double range = high - low;
            if (range <= 0 || Math.Abs(close - open) / range < MinBodyRatio) return;
            bool bullishTrend = _h1Fast.Result[h] > _h1Slow.Result[h] && _h1.ClosePrices[h] > _h1Fast.Result[h];
            bool bearishTrend = _h1Fast.Result[h] < _h1Slow.Result[h] && _h1.ClosePrices[h] < _h1Fast.Result[h];
            bool bullishCandle = close > open && close > _entry.Result[i];
            bool bearishCandle = close < open && close < _entry.Result[i];
            bool buyPullback = EnablePullbacks && Bars.LowPrices[i - 1] <= _entry.Result[i - 1] && close > Bars.HighPrices[i - 1];
            bool sellPullback = EnablePullbacks && Bars.HighPrices[i - 1] >= _entry.Result[i - 1] && close < Bars.LowPrices[i - 1];
            double prevHigh = double.MinValue, prevLow = double.MaxValue;
            for (int k = i - StructureBars; k < i; k++)
            {
                prevHigh = Math.Max(prevHigh, Bars.HighPrices[k]);
                prevLow = Math.Min(prevLow, Bars.LowPrices[k]);
            }
            bool buyBreakout = EnableBreakouts && close > prevHigh;
            bool sellBreakout = EnableBreakouts && close < prevLow;
            bool buy = bullishTrend && bullishCandle && _rsi.Result[i] >= BuyRsi && (buyPullback || buyBreakout);
            bool sell = bearishTrend && bearishCandle && _rsi.Result[i] <= SellRsi && (sellPullback || sellBreakout);
            if (buy == sell) return;
            TradeType direction = buy ? TradeType.Buy : TradeType.Sell;
            // Use the current executable side of the quote, not the candle close, for risk sizing.
            double entryPrice = buy ? Symbol.Ask : Symbol.Bid;
            double swing = buy ? prevLow - SwingBuffer * atr : prevHigh + SwingBuffer * atr;
            double swingStopPips = buy ? (entryPrice - swing) / Symbol.PipSize : (swing - entryPrice) / Symbol.PipSize;
            double stopPips = Math.Max(atrPips * AtrStopMult, swingStopPips);
            if (stopPips < MinStopPips || stopPips > MaxStopPips) return;
            double riskMoney = Account.Equity * RiskPct / 100.0;
            double existingRisk = 0;
            foreach (var p in BotPositions())
            {
                if (!p.StopLoss.HasValue) { Print("Unprotected bot position: no new trades."); return; }
                double distance = p.TradeType == TradeType.Buy ? p.EntryPrice - p.StopLoss.Value : p.StopLoss.Value - p.EntryPrice;
                if (distance > 0) existingRisk += Symbol.AmountRisked(p.VolumeInUnits, distance / Symbol.PipSize);
            }
            if (existingRisk + riskMoney > Account.Equity * MaxTotalRiskPct / 100.0 + 0.00001) return;
            double volume = Symbol.VolumeForFixedRisk(riskMoney, stopPips, RoundingMode.Down);
            volume = Symbol.NormalizeVolumeInUnits(volume, RoundingMode.Down);
            if (volume < Symbol.VolumeInUnitsMin || volume > Symbol.VolumeInUnitsMax)
            {
                Print("Volume outside broker limits: {0}. Skipping trade.", volume); return;
            }
            // Validate the minimum executable size against the requested risk budget.
            if (Symbol.AmountRisked(volume, stopPips) > riskMoney * 1.01) return;
            var result = ExecuteMarketOrder(direction, SymbolName, volume, Label, stopPips, stopPips * RewardRisk);
            if (result.IsSuccessful)
            {
                _lastEntryBar = Bars.Count; _tradesToday++; SaveState();
                Print("OPEN {0} volume={1} stop={2:F1}p target={3:F1}p", direction, volume, stopPips, stopPips * RewardRisk);
            }
            else Print("Order rejected: {0}", result.Error);
        }
        protected override void OnStop()
        {
            SaveState();
            Positions.Closed -= OnPositionClosed;
        }
    }
}

using cAlgo.API;
namespace cAlgo.Robots
{
    [Robot(AccessRights = AccessRights.None)]
    public class GoodBot : Robot
    {
        private const double RiskPercentPerTrade = 0.5;
        private const double MaxDailyLossPercent = 2.0;
        private const int MaxOpenPositions = 1;

        [Parameter("Swing Lookback", Group = "Structure", DefaultValue = 10, MinValue = 3, MaxValue = 30, Step = 1)]
        public int SwingLookback { get; set; }

        [Parameter("Min FVG Size (pips)", Group = "Structure", DefaultValue = 3)]
        public double MinFvgSize { get; set; }

        protected override void OnBar()
        {
            var units = Symbol.NormalizeVolumeInUnits(Account.Balance * RiskPercentPerTrade / 100 / (15 * Symbol.PipValue));
            ExecuteMarketOrder(TradeType.Sell, SymbolName, units, "good", 15, 30);
        }
    }
}

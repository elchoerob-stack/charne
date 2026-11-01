using cAlgo.API;
namespace cAlgo.Robots
{
    [Robot(AccessRights = AccessRights.None)]
    public class BadBot : Robot
    {
        [Parameter("Risk %", Group = "Risk", DefaultValue = 1.0, MinValue = 0.1, MaxValue = 5, Step = 0.1)]
        public double RiskPercent { get; set; }

        [Parameter("Stop Loss (pips)", Group = "Risk", DefaultValue = 20)]
        public double StopLossPips { get; set; }

        [Parameter("Min FVG Size", DefaultValue = 3)]
        public double MinFvgSize { get; set; }

        [Parameter("Plot Colour", DefaultValue = "Red")]
        public string PlotColour { get; set; }

        [Parameter("Max Open Trades", DefaultValue = 3)]
        public int MaxOpenTrades { get; set; }

        [Parameter("ATR Multiplier", DefaultValue = 1.5)]
        public double AtrMultiplier { get; set; }

        [Parameter("Reset equity-floor halt", Group = "Security", DefaultValue = false)]
        public bool ResetEquityFloorHalt { get; set; }

        [Parameter("Use news filter", DefaultValue = true)]
        public bool UseNewsFilter { get; set; }

        // [Parameter("Lot Size", DefaultValue = 1)]  commented out, must be ignored
        private double volume = 1000;

        protected override void OnBar()
        {
            ExecuteMarketOrder(TradeType.Buy, SymbolName, volume, "bad");
            if (LastResult.Position.NetProfit < 0) volume *= 2;
        }
    }
}

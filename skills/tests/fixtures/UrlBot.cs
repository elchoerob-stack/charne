using cAlgo.API;
namespace cAlgo.Robots
{
    [Robot(AccessRights = AccessRights.FullAccess)]
    public class UrlBot : Robot
    {
        [Parameter("Brain URL", DefaultValue = "http://127.0.0.1:7788")]
        public string BrainUrl { get; set; }

        [Parameter("Equity-floor reset code", Group = "Security", DefaultValue = "")]
        public string EquityFloorResetCode { get; set; }

        // [Parameter("Lot Size", DefaultValue = 1)]  a comment: must be ignored
        /* [Parameter("Risk %", DefaultValue = 2)] also a comment */

        private const string LogDir = @"C:\TradeDesk\//logs";  // verbatim string with // inside
        private const char Slash = '/';
        private const double RISK_PER_TRADE = 0.0075;

        [Parameter("Max Lots", DefaultValue = 2.0)]
        public double MaxLots { get; set; }
    }
}

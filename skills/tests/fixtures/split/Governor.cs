namespace cAlgo.Robots
{
    public class Governor
    {
        private const double RISK_PER_TRADE = 0.0075;
        private const double DAILY_LOSS_LIMIT = 0.03;
        private const double EQUITY_FLOOR = 0.85;
        private const int CONSECUTIVE_LOSS_HALT = 4;
        private const double MIN_REWARD_RISK = 1.5;
        public double Units(double equity) => equity * RISK_PER_TRADE;
    }
}

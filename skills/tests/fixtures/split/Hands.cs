using cAlgo.API;
namespace cAlgo.Robots
{
    [Robot(AccessRights = AccessRights.None)]
    public class Hands : Robot
    {
        private Governor _g = new Governor();
        protected override void OnStart() { Positions.Opened += OnOpened; }
        protected override void OnBar()
        {
            PlaceLimitOrder(TradeType.Buy, SymbolName, _g.Units(Account.Equity), Symbol.Bid - 1, "h", null, null, null);
        }
        private void OnOpened(PositionOpenedEventArgs a)
        {
            var r = ModifyPosition(a.Position, a.Position.EntryPrice - 5, a.Position.EntryPrice + 10, ProtectionType.Absolute);
            if (!r.IsSuccessful) ClosePosition(a.Position);
        }
    }
}

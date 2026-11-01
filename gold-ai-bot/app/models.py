"""Shared data types. Prices are in the symbol's quote currency (USD for
XAUUSD); money is in the account currency (ZAR on a rand account) unless a
name says otherwise. Volumes are in units (troy ounces for gold), never lots,
because brokers disagree on how many ounces a lot is."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

Side = Literal["BUY", "SELL"]
Timeframe = Literal["M15", "H1"]
TIMEFRAME_MINUTES = {"M15": 15, "H1": 60}

CommissionType = Literal["NONE", "USD_PER_MILLION_USD", "USD_PER_LOT",
                         "PERCENTAGE_OF_VALUE", "QUOTE_CCY_PER_LOT"]


class Frozen(BaseModel):
    model_config = ConfigDict(frozen=True)


class Candle(Frozen):
    time: datetime  # bar OPEN time, UTC
    open: float
    high: float
    low: float
    close: float
    volume: float = 0.0


class Quote(Frozen):
    bid: float
    ask: float
    time: datetime

    @property
    def spread(self) -> float:
        return self.ask - self.bid

    @property
    def mid(self) -> float:
        return (self.ask + self.bid) / 2


class SymbolSpec(Frozen):
    """What the broker actually says about the symbol. Read from cTrader at
    start-up, never assumed: one broker's gold lot is 100 oz, another's is 1."""
    symbol: str
    broker_symbol_id: int = 0
    digits: int
    quote_currency: str
    units_per_lot: float
    min_units: float
    max_units: float
    step_units: float
    min_stop_distance: float = 0.0  # price units
    commission_type: CommissionType = "NONE"
    commission_rate: float = 0.0  # per side, meaning depends on commission_type


class AccountState(Frozen):
    account_id: int
    is_live: bool
    currency: str
    balance: float
    equity: float
    leverage: float = 100.0
    used_margin: float = 0.0


class Position(Frozen):
    position_id: str
    symbol: str
    side: Side
    units: float
    entry_price: float
    stop_loss: float | None
    take_profit: float | None
    label: str = ""
    open_time: datetime | None = None
    unrealized_net: float = 0.0  # account currency, after commission and swap


class ClosedTrade(Frozen):
    position_id: str
    symbol: str
    side: Side
    units: float
    entry_price: float
    exit_price: float
    open_time: datetime | None
    close_time: datetime
    gross: float  # account currency
    commission: float  # account currency, negative = cost
    swap: float
    label: str = ""

    @property
    def net(self) -> float:
        return self.gross + self.commission + self.swap


class MarketSnapshot(Frozen):
    """Everything both models see. The id is derived from the last closed M15
    bar, so one bar can only ever produce one decision and one order."""
    snapshot_id: str
    symbol: str
    created_at: datetime
    quote: Quote
    m15: list[Candle]
    h1: list[Candle]
    features: dict[str, Any]


class TradeDecision(BaseModel):
    """The contract both models must fill in. Anything that does not validate
    against it is treated as HOLD."""
    snapshot_id: str = Field(description="Copy the snapshot_id you were given, exactly.")
    action: Literal["BUY", "SELL", "HOLD"]
    symbol: Literal["XAUUSD"]
    stop_loss: float = Field(ge=0, description="Absolute price. 0 when action is HOLD.")
    take_profit: float = Field(ge=0, description="Absolute price. 0 when action is HOLD.")
    stop_anchor_time: str = Field(description=(
        "UTC time 'YYYY-MM-DD HH:MM' of the bar whose low (BUY) or high (SELL) the stop "
        "sits beyond, copied from the bars given. Empty string when action is HOLD."))
    stop_anchor_price: float = Field(ge=0, description=(
        "That bar's low (BUY) or high (SELL), exactly as given. 0 when action is HOLD."))
    setup_valid: bool
    rationale: str = Field(description="At most three sentences.")


class Proposal(Frozen):
    snapshot_id: str
    symbol: str
    side: Side
    stop_loss: float
    take_profit: float
    rationale: str


class OrderRequest(Frozen):
    client_order_id: str
    symbol: str
    side: Side
    units: float
    entry_reference: float  # price the stop and target distances are measured from
    stop_loss: float
    take_profit: float


class OrderResult(Frozen):
    status: Literal["FILLED", "REJECTED"]
    position_id: str = ""
    fill_price: float = 0.0
    reason: str = ""


class BrokerError(Exception):
    pass


class OrderTimeout(BrokerError):
    """No acknowledgement in time. The order may or may not exist: reconcile
    before doing anything else."""


class LiveAccountRefused(BrokerError):
    pass

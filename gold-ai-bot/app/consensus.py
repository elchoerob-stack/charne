"""Both models must independently say the same thing about the same data.
Agreement is a filter, not evidence of an edge."""

from __future__ import annotations

from dataclasses import dataclass

from .models import Proposal, TradeDecision

MAX_STOP_RATIO = 2.0  # the two stop distances may differ by at most 2x


@dataclass(frozen=True)
class ConsensusResult:
    agreed: bool
    reason: str


def consensus(gpt: TradeDecision, claude: TradeDecision, snapshot_id: str,
              reference_price: float) -> ConsensusResult:
    def no(reason: str) -> ConsensusResult:
        return ConsensusResult(False, reason)

    if gpt.snapshot_id != snapshot_id or claude.snapshot_id != snapshot_id:
        return no(f"snapshot mismatch: gpt={gpt.snapshot_id} claude={claude.snapshot_id} "
                  f"expected={snapshot_id}")
    if gpt.action == "HOLD" or claude.action == "HOLD":
        return no(f"hold (gpt={gpt.action}, claude={claude.action})")
    if gpt.action != claude.action:
        return no(f"direction disagreement: gpt={gpt.action} claude={claude.action}")
    if gpt.symbol != claude.symbol:
        return no("symbol disagreement")
    if not (gpt.setup_valid and claude.setup_valid):
        return no(f"setup not valid (gpt={gpt.setup_valid}, claude={claude.setup_valid})")
    for name, d in (("gpt", gpt), ("claude", claude)):
        if d.stop_loss <= 0 or d.take_profit <= 0:
            return no(f"{name} gave no stop or target")
    d1 = abs(reference_price - gpt.stop_loss)
    d2 = abs(reference_price - claude.stop_loss)
    if min(d1, d2) <= 0 or max(d1, d2) / min(d1, d2) > MAX_STOP_RATIO:
        return no(f"stop distances too far apart: gpt {d1:.2f}, claude {d2:.2f}")
    return ConsensusResult(True, "agreed")


def build_proposal(gpt: TradeDecision, claude: TradeDecision, snapshot_id: str) -> Proposal:
    """The more conservative combination: the wider stop (the risk engine sizes
    down to keep the money at risk the same) and the nearer target. The risk
    engine then has to find 2:1 even on that pairing."""
    side = gpt.action
    if side == "BUY":
        sl, tp = min(gpt.stop_loss, claude.stop_loss), min(gpt.take_profit, claude.take_profit)
    else:
        sl, tp = max(gpt.stop_loss, claude.stop_loss), max(gpt.take_profit, claude.take_profit)
    return Proposal(snapshot_id=snapshot_id, symbol=gpt.symbol, side=side, stop_loss=sl,
                    take_profit=tp,
                    rationale=f"GPT: {gpt.rationale} | Claude: {claude.rationale}")

from app.consensus import build_proposal, consensus
from tests.conftest import decision

SID = "XAUUSD-20261104T1000Z"
REF = 2650.15


def test_agreement():
    r = consensus(decision(), decision(sl=2644.0, tp=2664.0), SID, REF)
    assert r.agreed, r.reason


def test_any_hold_means_no_trade():
    assert not consensus(decision("HOLD"), decision(), SID, REF).agreed
    assert not consensus(decision(), decision("HOLD"), SID, REF).agreed


def test_direction_disagreement():
    r = consensus(decision("BUY"), decision("SELL", sl=2655, tp=2640), SID, REF)
    assert not r.agreed and "direction" in r.reason


def test_stale_or_mismatched_snapshot_is_rejected():
    r = consensus(decision(sid="XAUUSD-20261104T0945Z"), decision(), SID, REF)
    assert not r.agreed and "snapshot" in r.reason


def test_setup_must_be_valid_for_both():
    assert not consensus(decision(), decision(valid=False), SID, REF).agreed


def test_stops_wildly_apart_count_as_disagreement():
    r = consensus(decision(sl=2648.0), decision(sl=2630.0), SID, REF)
    assert not r.agreed and "stop distances" in r.reason


def test_proposal_takes_wider_stop_and_nearer_target():
    p = build_proposal(decision(sl=2645.0, tp=2666.0), decision(sl=2643.0, tp=2662.0), SID)
    assert (p.side, p.stop_loss, p.take_profit) == ("BUY", 2643.0, 2662.0)
    s = build_proposal(decision("SELL", 2655, 2635), decision("SELL", 2657, 2638), SID)
    assert (s.stop_loss, s.take_profit) == (2657, 2638)

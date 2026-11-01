import dataclasses
import json
from datetime import timedelta

import pytest

from app import blackouts
from app.ai_common import DecisionResult, RuleFollowerAgent, hold, preflight
from app.config import Settings
from app.fingerprint import fingerprint
from app.main import cmd_health
from app.risk_engine import POLICY
from tests.conftest import NOW


# ---- fingerprint -------------------------------------------------------------
def test_fingerprint_changes_with_anything_that_changes_behaviour():
    base = fingerprint("gpt-6-astra", "claude-opus-5-5")
    assert base == fingerprint("gpt-6-astra", "claude-opus-5-5")
    assert base != fingerprint("gpt-6-sol", "claude-opus-5-5")
    assert base != fingerprint("gpt-6-astra", "claude-sonnet-5-5")
    looser = dataclasses.replace(POLICY, risk_per_trade=0.01)
    assert base != fingerprint("gpt-6-astra", "claude-opus-5-5", looser)


# ---- blackouts ---------------------------------------------------------------
def test_blackout_window(tmp_path):
    p = tmp_path / "blackouts.csv"
    p.write_text("start_utc,end_utc,label\n2026-11-04 09:45,2026-11-04 10:30,US CPI\n")
    assert "US CPI" in blackouts.active(NOW, p)
    assert blackouts.active(NOW + timedelta(hours=1), p) == ""
    assert blackouts.active(NOW, tmp_path / "missing.csv") == ""


def test_unreadable_calendar_blocks_trading(tmp_path):
    p = tmp_path / "blackouts.csv"
    p.write_text("start_utc,end_utc,label\nnot-a-date,2026-11-04 10:30,x\n")
    assert "unreadable" in blackouts.active(NOW, p)


# ---- health watchdog -----------------------------------------------------------
def test_health_flags_a_stalled_bot(tmp_path, monkeypatch):
    s = Settings(data_dir=tmp_path)
    assert cmd_health(s) == 1  # no file yet
    from app import main as m
    monkeypatch.setattr(m, "utcnow", lambda: NOW)
    s.health_path.write_text(json.dumps({"time": (NOW - timedelta(minutes=5)).isoformat(),
                                         "stage": "no_candidate", "error": ""}))
    assert cmd_health(s) == 0
    s.health_path.write_text(json.dumps({"time": (NOW - timedelta(hours=2)).isoformat(),
                                         "stage": "no_candidate", "error": ""}))
    assert cmd_health(s) == 1


# ---- model preflight -------------------------------------------------------------
class EchoAgent:
    provider, model = "fake", "m"

    def __init__(self, ok=True, wrong_id=False):
        self.ok, self.wrong_id = ok, wrong_id

    async def decide(self, s, c):
        sid = "WRONG" if self.wrong_id else s.snapshot_id
        return DecisionResult(self.provider, self.model, hold(sid, "x"), self.ok,
                              "" if self.ok else "model not found")


@pytest.mark.asyncio
async def test_preflight():
    assert await preflight(EchoAgent()) == ""                       # HOLD is fine
    assert "not found" in await preflight(EchoAgent(ok=False))
    assert "expected" in await preflight(EchoAgent(wrong_id=True))
    assert await preflight(RuleFollowerAgent()) == ""

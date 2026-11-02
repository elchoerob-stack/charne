"""Test-period fingerprint.

Results only mean something for the exact configuration that produced them.
The fingerprint is a hash of everything that changes trading behaviour: the
risk policy, the setup modes and constants, both model IDs and the prompt.
Every order and shadow trade is stamped with it, and the report and the
evidence count use only the current fingerprint unless asked for --all. Change
any of these and a new test period starts automatically: you can't carry
results over from a configuration that no longer exists.
"""

from __future__ import annotations

import dataclasses
import hashlib
import json

from . import evidence, strategy
from .ai_common import SYSTEM_PROMPT
from .risk_engine import POLICY, RiskPolicy


def components(openai_model: str, anthropic_model: str,
               policy: RiskPolicy = POLICY) -> dict:
    return {
        "policy": dataclasses.asdict(policy),
        "strategy_modes": strategy.STRATEGY_MODES,
        "ict_rules": dataclasses.asdict(strategy.ICT),
        "strategy_constants": {k: getattr(strategy, k) for k in (
            "SESSION_UTC", "FRIDAY_CUTOFF_UTC", "MAX_SPREAD_TO_ATR", "BASELINE_RR",
            "STOP_BUFFER_ATR", "MAX_STOP_ATR")},
        "evidence": {k: getattr(evidence, k) for k in (
            "PRICE_TOLERANCE", "LOCAL_EXTREME_BARS", "MAX_STOP_BEYOND_ANCHOR_ATR",
            "MAX_TARGET_H1_ATR")},
        "models": {"openai": openai_model, "anthropic": anthropic_model},
        "prompt_sha": hashlib.sha256(SYSTEM_PROMPT.encode()).hexdigest()[:12],
    }


def fingerprint(openai_model: str, anthropic_model: str, policy: RiskPolicy = POLICY) -> str:
    blob = json.dumps(components(openai_model, anthropic_model, policy), sort_keys=True,
                      default=str)
    return hashlib.sha256(blob.encode()).hexdigest()[:12]

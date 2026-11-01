"""Anthropic reviewer. Structured output by forcing a single tool call whose
input schema is TradeDecision, then validating it with pydantic."""

from __future__ import annotations

import asyncio

from .ai_common import SYSTEM_PROMPT, DecisionResult, Timer, cost, hold, render_snapshot
from .models import MarketSnapshot, TradeDecision
from .strategy import Candidate

TOOL_NAME = "submit_trade_decision"


class ClaudeAgent:
    provider = "anthropic"

    def __init__(self, model: str = "claude-opus-5-5", api_key: str = "",
                 timeout: float = 60.0, client=None,
                 usd_per_mtok_in: float = 0.0, usd_per_mtok_out: float = 0.0):
        self.model, self.timeout = model, timeout
        self.prices = (usd_per_mtok_in, usd_per_mtok_out)
        if client is None:
            from anthropic import AsyncAnthropic
            client = AsyncAnthropic(api_key=api_key, timeout=timeout, max_retries=1)
        self.client = client
        self.tool = {
            "name": TOOL_NAME,
            "description": "Submit your decision for this snapshot. Call exactly once.",
            "input_schema": TradeDecision.model_json_schema(),
        }

    async def decide(self, s: MarketSnapshot, c: Candidate) -> DecisionResult:
        try:
            with Timer() as t:
                msg = await asyncio.wait_for(self.client.messages.create(
                    model=self.model,
                    max_tokens=2000,
                    system=SYSTEM_PROMPT,
                    tools=[self.tool],
                    tool_choice={"type": "tool", "name": TOOL_NAME},
                    messages=[{"role": "user", "content": render_snapshot(s, c)}],
                ), timeout=self.timeout + 5)
            usage = getattr(msg, "usage", None)
            tin = getattr(usage, "input_tokens", 0) or 0
            tout = getattr(usage, "output_tokens", 0) or 0
            block = next((b for b in msg.content
                          if getattr(b, "type", "") == "tool_use" and b.name == TOOL_NAME), None)
            if block is None:
                return DecisionResult(self.provider, self.model,
                                      hold(s.snapshot_id, "no tool call"), False,
                                      f"no tool call (stop_reason={msg.stop_reason})", tin, tout,
                                      cost(tin, tout, *self.prices), t.ms)
            d = TradeDecision.model_validate(block.input)
            return DecisionResult(self.provider, self.model, d, True, "", tin, tout,
                                  cost(tin, tout, *self.prices), t.ms)
        except Exception as e:  # fail closed
            return DecisionResult(self.provider, self.model, hold(s.snapshot_id, "error"),
                                  False, f"{type(e).__name__}: {e}"[:500])

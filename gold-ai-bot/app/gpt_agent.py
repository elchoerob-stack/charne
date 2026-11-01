"""OpenAI reviewer (Responses API, structured output parsed into TradeDecision)."""

from __future__ import annotations

import asyncio

from .ai_common import SYSTEM_PROMPT, DecisionResult, Timer, cost, hold, render_snapshot
from .models import MarketSnapshot, TradeDecision
from .strategy import Candidate


class GPTAgent:
    provider = "openai"

    def __init__(self, model: str, api_key: str = "", timeout: float = 60.0, client=None,
                 usd_per_mtok_in: float = 0.0, usd_per_mtok_out: float = 0.0):
        if not model:
            raise ValueError("OPENAI_MODEL is not set (e.g. gpt-6-astra; check OpenAI's model list)")
        self.model, self.timeout = model, timeout
        self.prices = (usd_per_mtok_in, usd_per_mtok_out)
        if client is None:
            from openai import AsyncOpenAI
            client = AsyncOpenAI(api_key=api_key, timeout=timeout, max_retries=1)
        self.client = client

    async def decide(self, s: MarketSnapshot, c: Candidate) -> DecisionResult:
        try:
            with Timer() as t:
                resp = await asyncio.wait_for(self.client.responses.parse(
                    model=self.model,
                    instructions=SYSTEM_PROMPT,
                    input=render_snapshot(s, c),
                    text_format=TradeDecision,
                    max_output_tokens=4000,
                    store=False,
                ), timeout=self.timeout + 5)
            usage = getattr(resp, "usage", None)
            tin = getattr(usage, "input_tokens", 0) or 0
            tout = getattr(usage, "output_tokens", 0) or 0
            parsed = getattr(resp, "output_parsed", None)
            if parsed is None:
                return DecisionResult(self.provider, self.model,
                                      hold(s.snapshot_id, "no parsed output"), False,
                                      "no parsed output (refusal or truncation)", tin, tout,
                                      cost(tin, tout, *self.prices), t.ms)
            d = TradeDecision.model_validate(parsed.model_dump())
            return DecisionResult(self.provider, self.model, d, True, "", tin, tout,
                                  cost(tin, tout, *self.prices), t.ms)
        except Exception as e:  # fail closed
            return DecisionResult(self.provider, self.model, hold(s.snapshot_id, "error"),
                                  False, f"{type(e).__name__}: {e}"[:500])

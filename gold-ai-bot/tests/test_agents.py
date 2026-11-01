from types import SimpleNamespace

import pytest

from app.claude_agent import TOOL_NAME, ClaudeAgent
from app.gpt_agent import GPTAgent
from app.strategy import Candidate
from tests.conftest import decision, snapshot

CAND = Candidate("BUY", "test")


class FakeOpenAI:
    def __init__(self, parsed=None, exc=None):
        self.kwargs = None
        self.responses = SimpleNamespace(parse=self.parse)
        self._parsed, self._exc = parsed, exc

    async def parse(self, **kw):
        self.kwargs = kw
        if self._exc:
            raise self._exc
        return SimpleNamespace(output_parsed=self._parsed,
                               usage=SimpleNamespace(input_tokens=1000, output_tokens=200))


class FakeAnthropic:
    def __init__(self, content, exc=None):
        self.kwargs = None
        self.messages = SimpleNamespace(create=self.create)
        self._content, self._exc = content, exc

    async def create(self, **kw):
        self.kwargs = kw
        if self._exc:
            raise self._exc
        return SimpleNamespace(content=self._content, stop_reason="tool_use",
                               usage=SimpleNamespace(input_tokens=900, output_tokens=150))


def tool_use(inp):
    return SimpleNamespace(type="tool_use", name=TOOL_NAME, input=inp)


@pytest.mark.asyncio
async def test_gpt_structured_output():
    c = FakeOpenAI(parsed=decision())
    r = await GPTAgent("gpt-6-astra", client=c, usd_per_mtok_in=1, usd_per_mtok_out=10) \
        .decide(snapshot(), CAND)
    assert r.ok and r.decision.action == "BUY" and r.cost_usd == pytest.approx(0.003)
    assert c.kwargs["text_format"].__name__ == "TradeDecision"
    assert "XAUUSD-20261104T1000Z" in c.kwargs["input"]


@pytest.mark.asyncio
@pytest.mark.parametrize("client", [FakeOpenAI(parsed=None), FakeOpenAI(exc=TimeoutError("x"))])
async def test_gpt_failure_is_hold(client):
    r = await GPTAgent("gpt-6-astra", client=client).decide(snapshot(), CAND)
    assert not r.ok and r.decision.action == "HOLD"


def test_gpt_requires_an_explicit_model():
    with pytest.raises(ValueError):
        GPTAgent("", client=FakeOpenAI())


@pytest.mark.asyncio
async def test_claude_forced_tool_call():
    c = FakeAnthropic([tool_use(decision().model_dump())])
    r = await ClaudeAgent(client=c).decide(snapshot(), CAND)
    assert r.ok and r.decision.action == "BUY"
    assert c.kwargs["tool_choice"] == {"type": "tool", "name": TOOL_NAME}
    assert c.kwargs["model"] == "claude-opus-5-5"


@pytest.mark.asyncio
@pytest.mark.parametrize("content", [
    [SimpleNamespace(type="text", text="I think buy")],               # no tool call
    [tool_use({"action": "BUY", "symbol": "XAUUSD"})],                # missing fields
    [tool_use({**decision().model_dump(), "symbol": "EURUSD"})],      # wrong symbol
])
async def test_claude_bad_output_is_hold(content):
    r = await ClaudeAgent(client=FakeAnthropic(content)).decide(snapshot(), CAND)
    assert not r.ok and r.decision.action == "HOLD"

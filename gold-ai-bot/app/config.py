"""Settings that legitimately differ between machines: credentials, which demo
account, which model, where the data lives.

There are deliberately NO risk settings here. Risk per trade, loss limits,
position caps and the rest are constants in risk_engine.py. An environment
variable can be mistyped, copied from another machine or "temporarily"
raised, and that is how one bad number reaches an account (the PivotTargetBot
lesson). tests/test_risk_engine.py fails if a risk-like field appears here.
"""

from __future__ import annotations

import os
from pathlib import Path

from pydantic import BaseModel, Field


def _ints(raw: str) -> list[int]:
    return [int(x) for x in raw.replace(";", ",").split(",") if x.strip()]


class Settings(BaseModel):
    # cTrader Open API (demo host only; see ctrader_broker.py)
    ctrader_client_id: str = ""
    ctrader_client_secret: str = ""
    ctrader_access_token: str = ""
    ctrader_account_id: int = 0
    ctrader_demo_allowlist: list[int] = Field(default_factory=list)
    ctrader_symbol_name: str = "XAUUSD"  # the broker's name for gold, if different

    # AI providers. The OpenAI model has no default on purpose: OpenAI ships
    # GPT-6 under several IDs (gpt-6-astra, gpt-6-sol, gpt-6-luna, ...), so
    # pick one deliberately and record it with the results.
    openai_api_key: str = ""
    openai_model: str = ""
    anthropic_api_key: str = ""
    anthropic_model: str = "claude-opus-5-5"
    ai_timeout_seconds: float = 60.0

    # Optional: list prices so the report can show API spend (USD per 1M tokens).
    openai_usd_per_mtok_in: float = 0.0
    openai_usd_per_mtok_out: float = 0.0
    anthropic_usd_per_mtok_in: float = 0.0
    anthropic_usd_per_mtok_out: float = 0.0

    data_dir: Path = Path("data")

    # Phone alerts, same variables as Foreman (cms-agent/server/src/notify.ts)
    ntfy_topic: str = ""
    ntfy_server: str = "https://ntfy.sh"
    ntfy_token: str = ""
    notify_webhook_url: str = ""

    @property
    def db_path(self) -> Path:
        return self.data_dir / "journal.sqlite3"

    @property
    def kill_switch_path(self) -> Path:
        """Create this file (any content) to stop new orders immediately."""
        return self.data_dir / "KILL"

    def problems_for_live_run(self) -> list[str]:
        out = []
        for name in ("ctrader_client_id", "ctrader_client_secret", "ctrader_access_token",
                     "openai_api_key", "openai_model", "anthropic_api_key", "anthropic_model"):
            if not getattr(self, name):
                out.append(f"{name.upper()} is not set")
        if not self.ctrader_account_id:
            out.append("CTRADER_ACCOUNT_ID is not set")
        elif self.ctrader_account_id not in self.ctrader_demo_allowlist:
            out.append("CTRADER_ACCOUNT_ID is not in CTRADER_DEMO_ACCOUNT_ALLOWLIST")
        return out


def load_settings(env_file: str | os.PathLike | None = ".env") -> Settings:
    if env_file and Path(env_file).exists():
        from dotenv import load_dotenv
        load_dotenv(env_file, override=False)
    e = os.environ.get

    def f(name: str) -> float:
        return float(e(name, "0") or 0)

    return Settings(
        ctrader_client_id=e("CTRADER_CLIENT_ID", ""),
        ctrader_client_secret=e("CTRADER_CLIENT_SECRET", ""),
        ctrader_access_token=e("CTRADER_ACCESS_TOKEN", ""),
        ctrader_account_id=int(e("CTRADER_ACCOUNT_ID", "0") or 0),
        ctrader_demo_allowlist=_ints(e("CTRADER_DEMO_ACCOUNT_ALLOWLIST", "")),
        ctrader_symbol_name=e("CTRADER_SYMBOL_NAME", "XAUUSD") or "XAUUSD",
        openai_api_key=e("OPENAI_API_KEY", ""),
        openai_model=e("OPENAI_MODEL", ""),
        anthropic_api_key=e("ANTHROPIC_API_KEY", ""),
        anthropic_model=e("ANTHROPIC_MODEL", "claude-opus-5-5") or "claude-opus-5-5",
        ai_timeout_seconds=float(e("AI_TIMEOUT_SECONDS", "60") or 60),
        openai_usd_per_mtok_in=f("OPENAI_USD_PER_MTOK_IN"),
        openai_usd_per_mtok_out=f("OPENAI_USD_PER_MTOK_OUT"),
        anthropic_usd_per_mtok_in=f("ANTHROPIC_USD_PER_MTOK_IN"),
        anthropic_usd_per_mtok_out=f("ANTHROPIC_USD_PER_MTOK_OUT"),
        data_dir=Path(e("DATA_DIR", "data") or "data"),
        ntfy_topic=e("NTFY_TOPIC", ""),
        ntfy_server=e("NTFY_SERVER", "https://ntfy.sh") or "https://ntfy.sh",
        ntfy_token=e("NTFY_TOKEN", ""),
        notify_webhook_url=e("NOTIFY_WEBHOOK_URL", ""),
    )

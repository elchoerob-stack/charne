# Gold AI Bot (demo only)

GPT-6 and Claude look at each XAUUSD setup independently. A deterministic risk
engine then decides whether an order is allowed, and the bot places approved
orders on a **cTrader demo account** without asking you first.

The bot cannot reach a live account: the cTrader host is hard-coded to
`demo.ctraderapi.com`, and the account must be on your allowlist *and* be
reported by the server as a demo account.

```text
cTrader demo ──► market_data  (validate bars, quote, spread, freshness)
                    │
                 strategy     (deterministic pre-filter: is this bar worth asking about?)
                    │
          ┌─────────┴─────────┐
       gpt_agent         claude_agent     same snapshot, run in parallel, neither sees the other
          └─────────┬─────────┘
                consensus     (same snapshot id, same direction, both valid, stops comparable)
                    │
               risk_engine    (every limit, sized from the broker's real contract) ── default: reject
                    │
                execution     (re-check with a fresh quote → ledger row → send → confirm stop)
                    │
     journal (SQLite) · reconciliation · monitoring (report, cbot-gate export, phone alerts)
```

Neither model can place an order. Only `execution.py` sends orders, and it
runs every risk check again just before it sends.

## Risk policy

The limits are **constants** in `app/risk_engine.py`, frozen at runtime. They
can't be set from `.env` or the command line, and a test fails if a risk-like
setting ever appears in `config.py`. This follows the rule that came out of
PivotTargetBot: once a test starts, the values that protect the account stay
fixed. If you change one, commit the change and start a new forward-test
period.

| Control | Value | Where it's enforced |
|---|---|---|
| Account | Demo only | Host constant, allowlist, server `isLive` check, every cycle, every order |
| Symbol | XAUUSD | Policy + decision schema |
| Risk per trade | 0.5% of min(balance, equity) | Sizing |
| Daily loss | 1.5% of start-of-day balance | Breaker + headroom sizing |
| Weekly loss | 3% of start-of-week balance | Breaker + headroom sizing |
| Monthly drawdown | 6% from the month's balance peak | Breaker + headroom sizing |
| Open positions | 1 (whole account, pending orders included) | Gate |
| Reward:risk | ≥ 2.0, measured from the executable price | Gate |
| Losing streak | Stop after 3 | Breaker |
| New trades per day | 3 | Gate |
| AI disagreement, HOLD, error, bad output | No trade | Consensus / agents fail closed |
| Missing or stale data, API error | No trade | Market data / gates |

Two values depend on the broker: `max_spread` (0.60) and
`stop_slippage_allowance` (0.30 USD/oz). Set them once from what
`python -m app.main check` prints for your demo account, then leave them.

**How sizing works.** The lot size, minimum volume, volume step and commission
come from cTrader's symbol data, and the USD→account-currency rate comes from
live prices. The risk counts the stop distance, a slippage allowance (stops
are not guaranteed fills) and round-turn commission. If any period's remaining
loss allowance is smaller than 0.5%, the position is sized down to fit. If the
broker's minimum volume would still risk more than allowed, the order is
rejected.

**Losses that count:** realized P&L net of commission and swap, plus floating
losses on open positions. Floating profit doesn't offset them.

### Circuit breakers stay locked

Locks live in the SQLite journal, so a restart doesn't clear them.

| Breaker | Earliest release | Needs your review? |
|---|---|---|
| Daily loss | Next day, 00:00 UTC | No |
| Weekly loss | Next Monday, 00:00 UTC | No |
| Monthly drawdown | 1st of next month | **Yes** |
| 3 consecutive losses | Next day | **Yes** (streak count restarts after review) |
| Reconciliation (unknown position, missing stop, lost order) | Any time | **Yes** |

```bash
python -m app.main locks
python -m app.main unlock 4 "Reviewed: three losses during the NFP spike, rules unchanged"
```

To stop new orders immediately, create a file called `KILL` in `data/`.

## ⚠ Read this before funding the demo with R4,000

At R4,000, 0.5% risk is **R20**. With USD/ZAR around 17.5, that's about $1.14
of loss per ounce. The usual XAUUSD minimum on cTrader brokers is 0.01 lot
(1 oz). After the 0.30 slippage allowance, the widest stop the bot can take is
**about $0.84/oz**, which is far tighter than any normal M15 structural stop.
The replay test confirms that with R4,000 the bot places no trades at all.

The bot handles this correctly: it rejects the trade, and it does so *before*
calling either model, so you don't pay for AI opinions on trades that can't
happen. But you'd collect no evidence. Options, in order of preference:

1. Give the demo account the balance you would actually trade live, so the
   forward test measures the real thing.
2. Check whether your broker offers a smaller minimum on gold (some offer
   0.01 oz). `check` prints the minimum and the widest affordable stop.
3. Only raise the per-trade risk deliberately, as a committed constant change
   that starts a new test period.

## Setup

```bash
cd gold-ai-bot
python -m venv .venv && .venv\Scripts\activate      # Windows (source .venv/bin/activate elsewhere)
pip install -r requirements.txt
copy .env.example .env                               # then fill it in locally
python -m pytest                                     # 78 tests, no network, no API keys needed
```

**cTrader Open API**

1. Go to <https://openapi.ctrader.com/apps>, sign in with your cTrader ID and
   add an application. Wait for its status to become *Active*.
2. Copy the Client ID and Secret into `.env`.
3. In the app's **Playground**, authorise **only your demo account** with the
   *trading* scope and copy the access token. Access tokens expire (refresh
   them from the same page), and the bot will refuse to connect once yours has
   expired.
4. Run `python -m app.main accounts`. It lists every account the token can see
   and marks each one demo or live. Put the demo account's ID in both
   `CTRADER_ACCOUNT_ID` and `CTRADER_DEMO_ACCOUNT_ALLOWLIST`.

**AI providers:** add `OPENAI_API_KEY` and `ANTHROPIC_API_KEY`. `OPENAI_MODEL`
has no default because OpenAI ships GPT-6 under several IDs (`gpt-6-astra`,
`gpt-6-sol`, `gpt-6-luna`). Pick one, and keep it fixed for the whole test
period. Claude defaults to `claude-opus-5-5`; `claude-sonnet-5-5` is cheaper.

Keep your live CFI / MT5 account completely separate. Don't authorise it on
this Open API application at all.

## Commands

| Command | What it does |
|---|---|
| `python -m app.main accounts` | Setup: list the accounts your token can see (demo/live) |
| `python -m app.main check` | Week 1: connect to the demo and print the account, symbol spec, quote, conversion rate, last bars and the widest affordable stop |
| `python -m app.main run` | Autonomous demo trading: one evaluation per closed M15 bar |
| `python -m app.main replay bars.csv` | Offline plumbing test: an M15 CSV (`time,open,high,low,close`) through the paper broker with rule-following stand-ins for both models. **Not a backtest.** |
| `python -m app.main report` | Trades, expectancy, profit factor, drawdown, rejections by reason, AI calls and spend, locks, evidence status |
| `python -m app.main export-trades out.csv` | A CSV that `skills/cbot-gate/scripts/gate.py --oos out.csv --balance …` reads directly |
| `python -m app.main locks` / `unlock ID "note"` | Inspect and review circuit breakers |

## What one cycle does

Every 15 minutes, 5 seconds after the bar closes:

1. Stop unless the demo account is verified.
2. Sync closed trades, then audit open positions. A position without a stop,
   or one the bot didn't open, locks the bot.
3. Build and validate the snapshot. Its ID comes from the closed bar
   (`XAUUSD-20261104T1015Z`), so one bar can produce at most one order.
4. Apply the circuit breakers. If anything is locked, a position is open or
   the kill switch is on, stop here, before any AI spend.
5. Run the pre-filter (`strategy.py`, a placeholder you should replace with
   your ICT/SMC rules), the minimum-volume pre-check, and the daily AI budget
   (30 evaluations).
6. Ask both models in parallel. Every answer is logged with tokens, cost and
   latency.
7. Check consensus, then the risk engine.
8. Execute. With a fresh quote, re-check every rule, write the ledger row,
   send, and confirm the stop is attached. If an acknowledgement is lost, ask
   the broker before doing anything. Retry at most once, and only once the
   broker has confirmed the first order never landed.

## What's verified and what isn't

- **Verified by the tests (78, offline):** every risk gate and breaker, lock
  persistence and review rules, sizing from the spec with conversion and
  commission, consensus rules, both agents failing closed (timeouts, refusals,
  bad schema, wrong symbol), idempotent orders, lost-ack recovery,
  fill-without-stop handling, start-up reconciliation, end-to-end replays, and
  the cTrader unit conversions using the SDK's real protobuf classes.
- **Not yet verified:** the live connection to cTrader's demo server. The
  adapter is written against the SDK's actual message definitions (0.9.2), but
  this repo has never connected to a real server. Week 1 is
  `python -m app.main check`: compare every number it prints with the cTrader
  app, especially commission, minimum stop distance and the conversion rate.
- **Never tested here:** the real GPT-6 and Claude calls. They're tested with
  fake clients that have the same interface. The first real run will show
  whether the models return valid structured decisions.

## Schedule and evidence

| Stage | Deliverable | Done when |
|---|---|---|
| Week 1 | Demo connection and market data | `check` output matches the cTrader app |
| Week 2 | Strategy and risk engine | Your strategy rules replace the placeholder; `pytest` green |
| Week 3 | GPT-6 and Claude | Valid structured answers; failures produce HOLD |
| Week 4 | Unattended demo execution | No duplicate orders; breakers trip and hold |
| Weeks 5–8 | Forward test | Reliable unattended running, complete journal |

The minimum before drawing any conclusion: **100 or more out-of-sample trades,
positive expectancy after costs, no risk-control violations**, across
different market conditions. The report tracks this; `export-trades` and
cbot-gate apply the full gate. Agreement between two models filters trades. It
isn't evidence of an edge, and none of this predicts future returns.

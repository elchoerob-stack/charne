# Gold AI Bot (demo only)

GPT-6 and Claude look at each XAUUSD setup independently. A deterministic risk
engine then decides whether an order is allowed, and the bot places approved
orders on a **cTrader demo account** without asking you first.

The bot cannot reach a live account: the cTrader host is hard-coded to
`demo.ctraderapi.com`, and the account must be on your allowlist *and* be
reported by the server as a demo account.

```text
cTrader demo ──► market_data  (validate bars, quote, spread, freshness; swings, FVGs)
                    │
                 strategy     (setup modules, each live / shadow / off) ──► shadow book (every candidate, in R)
                    │
       blackouts · breakers · kill switch · min-volume feasibility · AI budget   (before any AI spend)
                    │
          ┌─────────┴─────────┐
       gpt_agent         claude_agent     same frozen snapshot, in parallel, neither sees the other
          └─────────┬─────────┘
                consensus     (same snapshot id, same direction, both valid, stops comparable)
                    │
                evidence      (each model's stop anchor checked against the actual bars)
                    │
               risk_engine    (every limit, sized from the broker's real contract) ── default: reject
                    │
                execution     (fresh re-check → ledger row → send → confirm stop; never resends)
                    │
     journal (SQLite) · reconciliation · monitoring · health watchdog · test-period fingerprint
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
python -m pytest                                     # 105 tests, no network, no API keys needed
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
| `python -m app.main check-ai` | Week 3: one real call to each model; both must return a valid decision |
| `python -m app.main run` | Autonomous demo trading: one evaluation per closed M15 bar (runs the model preflight first) |
| `python -m app.main health` | Watchdog for Task Scheduler: exit 1 and alert if the last cycle is over 25 minutes old |
| `python -m app.main fingerprint` | Show the current test-period hash and everything that goes into it |
| `python -m app.main replay bars.csv` | Offline plumbing test: an M15 CSV (`time,open,high,low,close`) through the paper broker with rule-following stand-ins for both models. **Not a backtest.** |
| `python -m app.main report [--all]` | Trades, expectancy, profit factor, drawdown, shadow evidence, rejections, AI spend per trade, locks (current test period by default) |
| `python -m app.main export-trades out.csv` | A CSV that `skills/cbot-gate/scripts/gate.py --oos out.csv --balance …` reads directly |
| `python -m app.main export-shadow out.csv [--strategy S] [--variant baseline\|ai]` | Shadow trades in R for cbot-gate (`--balance 100`, so 1R = 1%) |
| `python -m app.main locks` / `unlock ID "note"` | Inspect and review circuit breakers |

## What one cycle does

Every 15 minutes, 5 seconds after the bar closes (`app/bot.py`):

1. Stop unless the demo account is verified.
2. Sync closed trades, then audit open positions. A missing stop or a
   position the bot didn't open locks the bot. A late fill (an order recorded
   as absent that landed after all) is adopted, and you get an alert.
3. Build and validate the snapshot. Its ID comes from the closed bar
   (`XAUUSD-20261104T1015Z`), so one bar can produce at most one order.
4. **Shadow book:** advance open shadow trades, and open a baseline shadow
   trade for every candidate from every setup. This runs even when the bot is
   locked or can't afford the trade.
5. News blackout, circuit breakers, kill switch, open position: stop here,
   before any AI spend.
6. Live candidate? Then check that the broker minimum allows a sensible stop,
   and that today's AI budget (30 evaluations) isn't used up.
7. Ask both models in parallel. Every answer is logged with tokens, cost,
   latency and the test-period fingerprint.
8. **Consensus**, then **evidence**: each model has to name the bar its stop
   protects. The claim is rejected if that bar isn't in the data at that
   price, isn't a real local extreme, has already been broken, or sits more
   than one ATR from the stop. Fantasy targets (more than 8 H1 ATR away) are
   also rejected. Models can't change risk values; their output is only a
   proposal.
9. Risk engine.
10. Execution re-checks every rule with a fresh quote, writes the ledger row,
    sends, and confirms the stop. **There is no automatic retry.** If the
    acknowledgement is lost, the bot asks the broker three times:
    - **found:** recorded as filled
    - **every query answered and none found it:** recorded as absent, and the
      bar is skipped
    - **any query failed, or the order is still pending:** recorded as
      unknown, and the bot locks for your review. An inconclusive answer
      never counts as "the order failed".

Every cycle writes `data/health.json`. Schedule `python -m app.main health`
every 15 minutes in Windows Task Scheduler. It exits 1 and sends a phone alert
if the bot has stalled, which the bot can't report about itself.

## Is the AI worth it? Shadow evidence

`report` breaks shadow results down by setup, measured in R so the account
size doesn't matter:

| Row | Question it answers |
|---|---|
| `baseline / all` | Does the setup have an edge on its own, with no AI? |
| `baseline / agreed` vs `baseline / vetoed` | Does the AI filter keep the better trades? |
| `ai / all` vs `baseline / agreed` | Are the AI's levels better than the mechanical ones on the same trades? |
| AI spend line | Is any improvement bigger than what the API calls cost? |

Each setup in `strategy.py` has a mode. `trend_breakout` is **live**.
`liquidity_sweep` (sweep of a recent swing, then a close back inside) is
**shadow**: it's recorded but never sent to the models or the broker. Promote
a setup to live only after `export-shadow --strategy liquidity_sweep` passes
cbot-gate. Your own ICT/SMC rules plug in the same way, using the swing, FVG,
sweep and displacement helpers in `structure.py`. A test proves none of those
helpers look ahead.

This also solves the R4,000 problem for evidence purposes: the account can't
place real trades, but the baseline shadow book still fills up. Set
`SHADOW_AI_WHEN_UNTRADEABLE=true` if you also want the AI filter measured on
that account (it costs API money and never trades).

## Test periods (fingerprint)

Every order, AI call and shadow trade is stamped with a hash of the risk
policy, setup modes and constants, evidence limits, both model IDs and the
prompt. Change any of them and a new test period starts: `report` and the
exports only count the current period unless you pass `--all`. Run
`python -m app.main fingerprint` to see exactly what's included. This
enforces the rule that results from a configuration that no longer exists
don't count.

## News blackouts

Copy `blackouts.example.csv` to `data/blackouts.csv` and keep it up to date
from an economic calendar (NFP, CPI, FOMC). Times are UTC, which is SAST minus
2 hours. The file is re-read every cycle. A file that can't be read blocks
trading, because an unreadable calendar is missing data.

## What's verified and what isn't

- **Verified offline (105 tests):**
  - every risk gate and circuit breaker, lock persistence and review rules
  - randomised invariants: 3,000 random accounts and prices, and no approval
    ever exceeds the risk budget or loss headroom, breaks a broker volume step
    or falls below 2:1
  - sizing with conversion and commission
  - consensus and evidence checks
  - both agents failing closed, plus the model preflight
  - no-retry execution, inconclusive-check locking, late-fill adoption,
    fill-without-stop handling, start-up reconciliation
  - shadow scoring, test-period fingerprints, blackouts, the health watchdog
  - no look-ahead in the structure features
  - end-to-end replays, and the cTrader unit conversions using the SDK's real
    protobuf classes
- **Ready, but needs your credentials:** `tests/integration/` runs against
  the real demo server. `GOLDBOT_DEMO_INTEGRATION=1` checks identity, symbol
  spec, quotes, closed-bar handling and conversion. Adding
  `GOLDBOT_DEMO_ORDER_TEST=1` also places one minimum-size demo order and
  checks that the stop and target landed at the right distances, closes it,
  and confirms the commission was recorded. This is the evidence the offline
  tests can't give.
- **Needs your API keys:** `python -m app.main check-ai` makes one real call
  to each model. `run` refuses to start if either fails, so a wrong or retired
  model ID shows up at start-up, not as silent HOLDs.

## Schedule and evidence

| Stage | Deliverable | Done when |
|---|---|---|
| Week 1 | Demo connection and market data | `check` matches the cTrader app; `tests/integration` passes |
| Week 2 | Strategy and risk engine | Your strategy rules replace the placeholder; `pytest` green |
| Week 3 | GPT-6 and Claude | `check-ai` passes; evidence rejections reviewed in `report` |
| Week 4 | Unattended demo execution | Order round-trip test passes; health watchdog scheduled; no duplicates |
| Weeks 5–8 | Forward test | Reliable unattended running, complete journal |

The minimum before drawing any conclusion: **100 or more out-of-sample trades,
positive expectancy after costs, no risk-control violations**, across
different market conditions. The report tracks this; `export-trades` and
cbot-gate apply the full gate. Agreement between two models filters trades. It
isn't evidence of an edge, and none of this predicts future returns.

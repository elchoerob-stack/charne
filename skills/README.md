# Skills

Custom Claude skills built for Jacques' own workflows.

| Skill | What it does |
|---|---|
| `cbot-gate/` | Scores a cTrader / MT5 backtest or walk-forward run to PASS, FAIL or INCONCLUSIVE against fixed thresholds, and audits cBot C# for risk inputs exposed as `[Parameter]`. |
| `keystone-desk/` | Charné's desk at RB Brand: listing copy in her style, buyer–listing matching, buyer cost sheets (SARS transfer duty, bond, affordability), seller net, commission splits, and FICA / POPIA / PPA checklists. |

### Full Stack AI Engineer: the 7 skill sets

One skill per skill set, 20 concepts each. Each skill applies its concepts
when Claude builds or reviews code (Foreman, Keystone, cBots), and switches
to coaching (explanation, an example from his own code, an exercise, check
questions) when he asks to learn a concept.

| Skill | The 20 concepts | Extra |
|---|---|---|
| `stack-backend/` | REST, status codes, JWT, OAuth 2.0, sessions, SQL vs NoSQL, indexing, ACID, migrations, Redis, queues, rate limiting, WebSockets, background jobs, S3 uploads, pagination, versioning, validation, logging, tests | |
| `stack-dsa/` | Arrays → hashing → two pointers → sliding window → … → union find, greedy, DP | Constraint → complexity budget table |
| `stack-hld/` | Scalability, load balancing, caching, CDN, sharding, replication, consistent hashing, CAP, PACELC, consistency, Kafka, events, microservices, gateway, rate limiter, Bloom filter, circuit breaker, saga, blob storage, estimation | `scripts/estimate.py`: QPS, storage, bandwidth, cache, servers |
| `stack-lld/` | OOP, SOLID, DRY/KISS/YAGNI, composition, UML, 13 GoF patterns, thread safety, machine coding | |
| `stack-ai-agentic/` | LLMs, tokens, prompting, structured output, embeddings, vector DBs, RAG, chunking, reranking, tool calling, MCP, ReAct, planning, memory, multi-agent, orchestration, guardrails, evals, tracing, LoRA | |
| `stack-devops/` | Linux, networking, Git, Docker, Compose, K8s, Helm, CI/CD, Actions, AWS, Terraform, Ansible, Nginx, LBs, Prometheus, Grafana, ELK, blue-green, autoscaling, secrets | Small-app deploy checklist |
| `stack-security/` | OWASP Top 10, SQLi, XSS, CSRF, CORS, SSRF, TLS, crypto, passwords, sessions, JWT, OAuth, secrets, IAM, headers/CSP, rate limiting, validation, dependencies, pentesting, prompt injection | `scripts/scan.py`: static scan with file:line and a fix |

## Install

- **Claude app (web, desktop, phone):** open the `.skill` file in `dist/` from the chat
  where it was sent and press **Save skill**. Or go to Settings → Capabilities →
  Skills and upload the file.
- **Claude Code:** copy the folder to `~/.claude/skills/<name>/`.

After that, just share a backtest or a `.cs` file and ask whether it's ready.
The skill loads on its own.

## Test

```bash
python3 skills/tests/test_cbot_gate.py
python3 skills/tests/test_keystone_desk.py
python3 skills/tests/test_stack_skills.py
```

The cbot-gate test builds synthetic histories (a real edge, a decaying edge,
too few trades, comma-decimal CSVs, MT5 deal exports, walk-forward folds) and
sample cBots, and checks each verdict. The keystone-desk test checks transfer
duty against the SARS table at every bracket edge, plus repayments, commission
splits and matching. Run it after any
change to the scripts, then rebuild the package:

```bash
cd <skill-creator> && python3 -m scripts.package_skill /path/to/skills/cbot-gate /path/to/skills/dist
```

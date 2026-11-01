---
name: stack-hld
description: High-level system design (HLD) for architecture decisions and interviews, covering 20 concepts — scalability, load balancing, caching, CDN, database sharding, replication, consistent hashing, CAP theorem, PACELC, consistency models, Kafka and pub/sub, event-driven architecture, microservices, API gateway, rate limiter design, Bloom filters, circuit breakers, saga pattern, blob storage, back-of-envelope estimation. Use it whenever Jacques asks how to architect, scale or split a system (Foreman going multi-dealer or multi-machine, the CMS Workshop module, Keystone going multi-agent, a trading data pipeline), asks "will this handle X users/dealers", compares architectures, prepares for a system design interview, or wants to learn or be quizzed on any of these terms — even if he only says "how should I structure this" or "what happens when 50 dealerships use it".
---

# HLD — 20 concepts, applied

From the "Full Stack AI Engineer" skill-set list. Two jobs: **design** (give a
real architecture for a real load) and **coach** (teach and test the concepts).

## Design method

Work in this order and show each step briefly. Skipping step 2 is how
systems get over- or under-built.

1. **Requirements.** Functional (the 3–5 things it must do) and
   non-functional (users, latency, availability, consistency needs, data
   retention, POPIA/where data may live).
2. **Estimate.** Run the calculator — don't do the arithmetic in your head:
   ```bash
   python scripts/estimate.py --users 2000 --requests 60 --read-ratio 0.9 \
       --payload-kb 4 --retention-days 1825 --peak 3 --server-qps 500
   ```
   It gives QPS (average, peak, read/write), storage per day/year/retention
   and with replication, bandwidth, cache size and an N+1 server count. State
   the assumptions behind each input.
3. **The simplest design that meets the numbers.** Box diagram (ASCII or
   Mermaid): clients → edge → app → data. One process and one SQLite file
   carries a surprising amount: Foreman for a few dealers is exactly that and
   should stay that way until the numbers say otherwise.
4. **Deep dive** on the 2–3 parts the numbers stress, using the table below.
5. **Failure modes.** What breaks when each box dies, and what the user sees.
6. **Trade-offs** you chose and the next step when load grows 10×.

## The 20 concepts

| # | Concept | Use it when / rule of thumb | Watch out for |
|---|---|---|---|
| 01 | Scalability | Scale up (bigger box) first, out (more boxes) when one box can't carry peak or you need redundancy. Stateless app servers scale out; state goes to the data tier. | Sticky in-memory state that stops you adding a second server |
| 02 | Load balancing | L7 (HTTP) balancer in front of ≥2 app servers; round robin or least-connections; health checks remove dead nodes. | No health check; one balancer as a new single point of failure |
| 03 | Caching | Cache what's read often and changes rarely. Layers: browser → CDN → app (in-memory/Redis) → DB. Pick TTL by how stale is acceptable. | Stampede when a hot key expires (use jitter or lock); stale permissions |
| 04 | CDN | Static assets and public media near the user. SA users: pick a provider with a Johannesburg/Cape Town PoP. | Caching personalised responses |
| 05 | Database sharding | Only after indexes, read replicas and caching run out. Shard by a key that spreads load and keeps queries local (e.g. `dealer_id`). | Cross-shard joins; a hot shard (one huge dealer group) |
| 06 | Replication | Leader–follower for read scaling and failover. Async is fast but can lose the last writes on failover; sync is safe but slower. | Reading your own write from a lagging replica |
| 07 | Consistent hashing | Spread keys over cache/shard nodes so adding a node moves only ~1/N keys. Virtual nodes even out the load. | Plain `hash % N` — adding a node reshuffles everything |
| 08 | CAP theorem | During a network partition choose C (refuse) or A (serve possibly stale). Money, stock, bookings → C. Feeds, analytics → A. | Claiming "CA" for a distributed system |
| 09 | PACELC | Even without a partition you trade **L**atency vs **C**onsistency. DynamoDB/Cassandra: PA/EL. Spanner/Postgres sync: PC/EC. | Ignoring the normal-case trade-off |
| 10 | Consistency models | Strong → read-your-writes → monotonic reads → eventual. Pick per feature, not per system. | Eventual consistency on a balance or a booking slot |
| 11 | Kafka and pub/sub | Durable, ordered (per partition), replayable event log; consumers in groups. Simpler needs: Redis streams, SQS, or a jobs table. | Kafka for 10 messages a minute; ordering assumed across partitions |
| 12 | Event-driven architecture | Services emit facts ("JobCardClosed") and others react. Use an outbox table so the DB write and the event can't diverge. | Dual write to DB and broker without an outbox |
| 13 | Microservices | Split by business capability when teams or scaling needs differ. A well-structured monolith first. | Distributed monolith: services that must deploy together |
| 14 | API gateway | One entry point: auth, rate limits, routing, TLS, request IDs. | Business logic creeping into the gateway |
| 15 | Rate limiter design | Token bucket (bursty OK) or sliding-window counter; store counters in Redis with atomic `INCR`+`EXPIRE` or a Lua script; return 429 + `Retry-After`. | Per-process counters behind a load balancer |
| 16 | Bloom filter | "Definitely not / maybe yes" membership in tiny memory; avoid DB lookups for keys that don't exist; size from n and the false-positive rate. | Needing deletions (use a counting filter) |
| 17 | Circuit breaker | Wrap calls to flaky dependencies (Evolve DMS, Infomedia, the Claude API, a broker): closed → open after failures → half-open probe. Pair with timeouts and fallbacks. | Retries with no timeout or backoff — a retry storm |
| 18 | Saga pattern | Multi-service transaction as steps with compensating actions (book → reserve parts → charge; undo in reverse). Orchestrated or choreographed. | No compensation for a half-finished flow |
| 19 | Blob storage | Files (photos, PDFs, eVHC videos, signed quotes) in object storage; DB keeps the key and metadata. Presigned URLs; lifecycle rules for retention. | Files as BLOBs in the main DB |
| 20 | Back-of-envelope estimation | Always before choosing components. `scripts/estimate.py`. Useful anchors: 1 day ≈ 10⁵ s; 1 M req/day ≈ 12 QPS; SSD random read ~0.1 ms; same-region round trip ~1 ms; JNB↔EU ~160 ms. | Designing for Google scale when the load is 40 QPS |

## Interview mode

If he's practising for an interview, run it like one: give the prompt
("design a workshop booking system for 300 dealerships"), let him lead, ask
the clarifying questions an interviewer would, time-box (45 min), then score:
requirements, estimates, design, deep dive, trade-offs — each /5 with one
line of feedback.

## Coaching loop

1. The idea in one paragraph with an analogy from his world (a dealership
   group, a parts warehouse, a broker's order book).
2. A diagram.
3. Where it would appear in Foreman, CMS or his trading stack — and whether
   it's needed yet.
4. One design question to answer in writing; mark it.

Track progress as `HLD 09/20 ✓` lines when he's working through the list.

## Files

- `scripts/estimate.py` — QPS, storage, bandwidth, cache and server count from
  stated inputs. `--json` for machine-readable output.

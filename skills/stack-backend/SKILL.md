---
name: stack-backend
description: Backend engineering checklist and coach covering 20 concepts — REST APIs, HTTP status codes, JWT auth, OAuth 2.0, sessions and cookies, SQL vs NoSQL, indexing, transactions and ACID, ORMs and migrations, Redis caching, message queues, rate limiting, WebSockets, background jobs, file uploads to S3, pagination, API versioning, input validation, logging and monitoring, unit and integration tests. Use it whenever Jacques builds, reviews or debugs a server, API endpoint, route, database table or query, auth flow, webhook, job queue or upload — Foreman (cms-agent, Express + node:sqlite), Keystone Sales OS, the CMS Workshop prototype, or anything new — and whenever he asks to learn or be quizzed on a backend concept, even casually ("add an endpoint for…", "why is this slow?", "is this route OK?", "explain JWT vs sessions").
---

# Backend — 20 concepts, applied

From the "Full Stack AI Engineer" skill-set list. This skill has two jobs:

1. **Build/review mode** (default). When writing or reviewing server code, run
   the relevant rows of the table below against the code and fix what fails.
   Don't recite the table; apply it and mention only the rows that changed
   something.
2. **Coach mode.** When Jacques asks to learn, explain or be tested on a
   concept, follow the coaching loop at the bottom of this file.

His stack, so examples land: Foreman is TypeScript on Node 22+, Express,
`node:sqlite` (`DatabaseSync`, WAL), zod, the Anthropic SDK, Playwright, run as
a single Windows launcher. Keystone and the CMS prototype are single-file
HTML/JS apps. Prefer examples in TypeScript; C# when it touches cBots.

## The 20 concepts

| # | Concept | Rule to apply | Red flag in code |
|---|---|---|---|
| 01 | REST APIs | Nouns for resources, verbs from the method. `GET /tasks/:id`, `POST /tasks`, not `/getTask`. Same shape for every error body: `{ error: { code, message } }`. | Action verbs in paths; each route inventing its own error format |
| 02 | HTTP and status codes | 200 read, 201 created (+ `Location`), 204 no body, 400 bad input, 401 not authenticated, 403 not allowed, 404 missing, 409 conflict, 422 valid JSON but invalid meaning, 429 rate limited, 500 our fault, 503 dependency down. | `200 { ok: false }`; 500 for bad user input |
| 03 | Authentication with JWT | Short-lived access token (≈15 min) + refresh token. Verify signature **and** `exp`, `iss`, `aud`; pin the algorithm. Never put secrets or PII in the payload — it's only base64. | `jwt.decode` used where `verify` is needed; `alg: none` accepted; token in `localStorage` with no XSS protection |
| 04 | OAuth 2.0 | Authorization Code + PKCE for apps and SPAs. Validate `state`. Request the smallest scopes. Store refresh tokens server-side, encrypted. | Implicit flow; client secret in browser code |
| 05 | Sessions and cookies | Server sessions are simpler than JWT for a single server like Foreman. Cookie flags: `HttpOnly; Secure; SameSite=Lax` (or `Strict`). Rotate the session ID at login. | Session ID in a URL; missing `HttpOnly` |
| 06 | SQL vs NoSQL | Default to SQL (SQLite → Postgres) when data has relations and needs transactions — dealers, jobs, deals, commissions all do. NoSQL for documents with no joins, very high write volume, or flexible blobs. JSON columns cover most "flexible" needs. | Mongo chosen "because it's easier" for relational data |
| 07 | Database indexing | Index columns used in `WHERE`, `JOIN`, `ORDER BY`. Composite index order follows the query: equality columns first, then range/sort. Check with `EXPLAIN QUERY PLAN` (SQLite) / `EXPLAIN ANALYZE` (Postgres). | Full table scan on a growing table; an index per column instead of the composite the query needs |
| 08 | Transactions and ACID | Anything that writes more than one row as one fact goes in one transaction (`BEGIN … COMMIT`, rollback on throw). Keep transactions short; no network calls inside. | Two related inserts with no transaction; an API call between BEGIN and COMMIT |
| 09 | ORM and migrations | Schema changes are numbered migration files, applied once, recorded in a `schema_migrations` table, never edited after release. `CREATE TABLE IF NOT EXISTS` is not a migration once columns change. Add columns nullable or with defaults; backfill; then tighten. | `ALTER` statements scattered in startup code; editing an applied migration |
| 10 | Caching with Redis | Cache-aside: read cache → miss → read DB → set with TTL. Invalidate on write. Every key gets a TTL. For a single-process app an in-memory `Map` with TTL is enough; reach for Redis when there are several processes. | Cache with no TTL or invalidation; caching per-user data under a shared key |
| 11 | Message queues | Use a queue when work is slow, can fail and retry, or must survive a restart. Consumers must be **idempotent** (same message twice = same result). Dead-letter after N failures. | Fire-and-forget promises for important work; non-idempotent consumer |
| 12 | Rate limiting | Per user/key/IP, token bucket or sliding window. Return 429 + `Retry-After`. Apply to login, OTP, anything that costs money (LLM calls). | Public endpoint that triggers a paid API with no limit |
| 13 | WebSockets | Use for two-way live data; SSE is simpler for server → client streams (agent output). Authenticate the upgrade, heartbeat, reconnect with backoff, and resend missed state on reconnect. | No auth on the socket; client assumes it never drops |
| 14 | Background jobs | Jobs table or queue with status, attempts, `run_after`, last error. Retries with exponential backoff and a cap. Survive restart. Scheduled jobs use a lock so two instances don't run the same one. | `setTimeout` for work that must happen; no record of failures |
| 15 | File uploads to S3 | Presigned upload URLs straight to storage; the server never streams the bytes. Validate size and content type, generate the key server-side, scan or re-encode images, private bucket by default. | User-supplied filename used as a path; public bucket |
| 16 | Pagination | Cursor (keyset) pagination for feeds and large tables: `WHERE id < :cursor ORDER BY id DESC LIMIT n`. Offset only for small admin lists. Cap `limit`. Return `nextCursor`. | `OFFSET 50000`; unbounded `limit` from the client |
| 17 | API versioning | `/v1/` in the path for public APIs. Additive changes don't need a version; removing or renaming a field does. Deprecate with a date. | Renaming a response field in place |
| 18 | Input validation | Validate at the edge with a schema (zod in Foreman): types, lengths, ranges, enums. Parse, don't trust. Reject unknown fields where it matters. Parameterised SQL always. | `req.body.x` used unchecked; string-built SQL |
| 19 | Logging and monitoring | Structured JSON logs with a request ID, user/dealer, route, status, duration. No secrets, tokens or ID numbers in logs (POPIA). Health endpoint, error rate and latency alerts. | `console.log(req.body)`; no way to trace one request |
| 20 | Unit and integration tests | Unit-test pure logic; integration-test routes against a real temp DB (Foreman already uses `node --test` + tsx). Test the failure paths: bad input, missing auth, duplicate submit. | Only happy-path tests; mocks of the database you actually ship |

## Review output

When reviewing, report findings as a short list ranked by impact:

```
1. [08 Transactions] POST /tasks writes task + steps without a transaction — a crash
   between them leaves an orphan task. Fix: wrap in db.exec("BEGIN") … COMMIT. (code below)
2. [16 Pagination] GET /reports returns every row. …
```

Give the fixed code for anything you flag. If nothing in a row applies, say
nothing about it.

## Coaching loop

When he wants to learn a concept:

1. **One-paragraph idea**, plain language, with an everyday analogy (a
   workshop job card, a dealership queue, a trade log).
2. **Where it lives in his code.** Find a real spot in Foreman, Keystone or a
   cBot where the concept is used or missing (search the repo). Show it.
3. **The trap.** The most common mistake, and what it costs.
4. **One exercise**, sized for 20–40 minutes, in his own codebase if possible.
5. **Three quick check questions.** Wait for his answers, then mark them.

Track progress in the conversation as `Backend 07/20 ✓` style lines if he's
working through the list.

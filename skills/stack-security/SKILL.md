---
name: stack-security
description: Application security review and coaching, covering 20 concepts — OWASP Top 10, SQL injection, XSS, CSRF, CORS, SSRF, HTTPS and TLS, hashing and encryption, password hashing, secure sessions, JWT security, OAuth security, secrets management, IAM and least privilege, security headers and CSP, rate limiting and DDoS, input validation, dependency scanning, penetration testing and prompt injection. Includes a static scanner that flags risky lines with file:line and a fix. Use it whenever Jacques asks if code is secure or ready to ship, before Foreman, Keystone (POPIA/FICA client data) or any app goes online or to a dealer, when he handles logins, tokens, uploads, API keys, broker credentials or customer data, when an LLM agent reads emails, web pages or documents, or when he wants to learn or be quizzed on a security concept — even if he only says "check this before I deploy" or "is this safe?".
---

# Cyber Security — 20 concepts, applied

From the "Full Stack AI Engineer" skill-set list. Defensive only: find and
fix weaknesses in his own code, and teach how attacks work so he can stop
them. Two jobs: **review** and **coach**.

Why it matters for him specifically: Keystone holds buyer and seller ID
numbers, FICA documents and contact details (POPIA: report breaches to the
Information Regulator and the people affected); Foreman touches dealer
systems; his trading accounts sit behind broker API keys.

## Review method

1. **Scan** for the mechanical problems first:
   ```bash
   python scripts/scan.py <path> [--min-severity MEDIUM] [--json]
   ```
   It covers JS/TS/HTML/Python/C#/shell/YAML, skips `node_modules`/`dist`,
   masks any secret it prints, and exits 1 if there's a HIGH finding.
   **Read every hit before reporting it** — it is a pattern match. Say which
   hits are real and which are false positives, and why (e.g. "dynamic SQL,
   but only code-built `?` fragments — safe"). A reviewed line can carry
   `security-scan: ignore` in a comment.
2. **Read by hand** what no scanner finds: authentication on every route,
   authorisation (can user A read dealer B's data? — broken access control is
   OWASP #1), business logic, file upload handling, what the LLM agent can do.
3. **Report** ranked by real risk:
   ```
   [HIGH] index.html:321 — stored XSS: r.purpose is rendered unescaped; anyone who
   can create a recording can run script in the console. Fix: wrap in esc(). (diff)
   ```
   Give the fixed code for each real finding. End with what was **not**
   covered (no runtime testing, no infra review, etc.).

## The 20 concepts

| # | Concept | Defence to apply | Check |
|---|---|---|---|
| 01 | OWASP Top 10 | The map for every review: broken access control, crypto failures, injection, insecure design, misconfiguration, vulnerable components, auth failures, integrity failures, logging gaps, SSRF. | Walk the list against the app once per release |
| 02 | SQL injection | Parameterised queries only (`?`, `@p`). Identifiers (column names, sort order) from an allow-list. | `scan.py` sql-* rules; grep for string-built SQL |
| 03 | XSS | Escape on output by context (HTML, attribute, URL, JS). `textContent` over `innerHTML`. CSP as the safety net. Sanitise (DOMPurify) if HTML must be rendered — e.g. LLM markdown. | `scan.py` xss-* rules; every `${}` in an HTML string |
| 04 | CSRF | SameSite=Lax/Strict cookies + CSRF token for cookie-authenticated state changes; never change state on GET. Bearer-token APIs aren't exposed the same way. | Forms and POST routes using cookies |
| 05 | CORS | CORS relaxes the browser's same-origin rule; it isn't protection. List exact origins; never `*` with credentials. | `cors()` config |
| 06 | SSRF | When the server fetches a URL from input (Foreman browses sites): allow-list hosts, resolve and block private, loopback and metadata IPs, no redirects to them. | Any fetch/Playwright `goto` with user-supplied URLs |
| 07 | HTTPS and TLS | TLS everywhere, HSTS, never disable certificate checks (use the right CA bundle instead). | `scan.py` tls-disabled, http-url |
| 08 | Hashing and encryption | Hashing is one-way (integrity, lookups); encryption is two-way (data you must read back). AES-256-GCM with a random nonce; keys outside the DB. `crypto.randomBytes`, never `Math.random`, for tokens and OTPs. | Home-made crypto; ECB; reused nonces |
| 09 | Password hashing | argon2id (or scrypt/bcrypt cost ≥ 12) with per-user salt. Never MD5/SHA for passwords. | `scan.py` weak-hash-password |
| 10 | Secure sessions | Random ID ≥ 128 bits, `HttpOnly; Secure; SameSite`, rotate on login, idle + absolute timeout, server-side logout. | Cookie flags; token in `localStorage` |
| 11 | JWT security | `verify` not `decode`; pin algorithm; check `exp`/`iss`/`aud`; short expiry; a way to revoke (refresh token rotation / deny-list). | `scan.py` jwt-* rules |
| 12 | OAuth security | Auth code + PKCE, validate `state` and redirect URI exactly, minimal scopes, tokens encrypted at rest. | Implicit flow; wildcard redirect URIs |
| 13 | Secrets management | No keys in code, screenshots, logs or chat. `.env` git-ignored; CI secrets; rotate anything that was ever pushed — deleting the commit isn't enough. | `scan.py` secret-* rules; GitHub secret scanning |
| 14 | IAM and least privilege | Every key, DB user, agent tool and cloud role gets only what it needs. Broker API keys: trade-only, no withdrawal; IP-restricted where possible. | Admin keys used by apps |
| 15 | Security headers and CSP | `Content-Security-Policy` (no `unsafe-inline` scripts where possible), `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `frame-ancestors`. `helmet` in Express. | `curl -I` the deployed site |
| 16 | Rate limiting and DDoS | Limits on login, OTP, password reset, LLM-backed endpoints; account lockout with backoff; a CDN/WAF in front of public sites. | Unlimited OTP attempts; open LLM endpoint |
| 17 | Input validation | Validate type, length, range and format at the boundary (zod); allow-lists over block-lists; validate files by content, not extension. | Unchecked `req.body` |
| 18 | Dependency scanning | `npm audit`, `pip-audit`, `dotnet list package --vulnerable`; Dependabot on GitHub; lockfiles committed; few dependencies. | Run on every CI build |
| 19 | Penetration testing | Test only systems he owns or has written permission for. Tools: OWASP ZAP baseline scan, Burp Community, `nmap` against his own server. Fix, then retest. | Scope agreed in writing for any dealer system |
| 20 | Prompt injection | Text from emails, web pages, PDFs, tickets and users is **data**: wrap it in tags, tell the model it may contain instructions to ignore, never let it unlock tools. Destructive or outward actions need human approval; tools get least privilege; check outputs before acting. | `scan.py` prompt-concat; review each agent tool's blast radius |

## Before anything goes online

- [ ] `scan.py` clean or every hit explained
- [ ] Every route checks auth **and** that the user may access *that* record
- [ ] Secrets only in env/secret store; anything ever committed is rotated
- [ ] HTTPS + security headers; cookies flagged
- [ ] Rate limits on auth and costly endpoints
- [ ] `npm audit` / `pip-audit` with no high-severity findings
- [ ] Personal data: collected only if needed, encrypted at rest where sensitive, access logged (POPIA)
- [ ] Backups exist and are not publicly reachable

## Coaching loop

1. How the attack works, conceptually, with a tiny example against a
   **local toy app** — never a live third-party system.
2. The defence, in his stack's code.
3. Find whether his own code has the flaw (run the scanner, read the spot).
4. Exercise: fix it and write a test that proves the attack no longer works.

Track progress as `Security 08/20 ✓` lines when he's working through the list.

## Files

- `scripts/scan.py` — static pattern scan, ~30 rules mapped to the concepts
  above, with a second-look pass that drops escaped interpolations and
  env-sourced values.

---
name: stack-devops
description: DevOps and deployment, covering 20 concepts — Linux and Bash, networking basics, Git and GitHub, Docker, Docker Compose, Kubernetes, Helm, CI/CD pipelines, GitHub Actions, AWS, Terraform, Ansible, Nginx reverse proxy, load balancers, Prometheus, Grafana, ELK logging, blue-green deploys, auto scaling, and secrets management. Use it whenever Jacques writes or fixes a Dockerfile, compose file, GitHub Actions workflow, shell script, server setup, domain/DNS/TLS/port problem, deployment, backup or monitoring — Foreman's Windows launcher build, hosting Foreman or Keystone, running a cBot VPS, a home server — or when a build is red, a port won't open, a container won't start, or he wants to learn or be quizzed on any of these tools, even if he only says "how do I put this online" or "CI is failing again".
---

# DevOps — 20 concepts, applied

From the "Full Stack AI Engineer" skill-set list. Two jobs: **ship and fix**
(builds, deploys, servers) and **coach** the concepts.

Right-size everything. His real workloads are a Node app for a handful of
dealers, single-file web apps, a Windows launcher built in GitHub Actions
(`.github/workflows/foreman-windows.yml`), and trading bots on a VPS. A
single small VM with Docker Compose, Caddy/Nginx and nightly backups beats
Kubernetes for all of that. Say so when he reaches for something bigger, and
say what load would justify it.

## The 20 concepts

| # | Concept | Apply it as | Classic failure |
|---|---|---|---|
| 01 | Linux and Bash | Scripts start `#!/usr/bin/env bash` + `set -euo pipefail`; quote every variable; `systemd` units for long-running services; `journalctl -u x -f` to watch them. | Unquoted path with a space; script carries on after an error |
| 02 | Networking basics | DNS → IP → port → TLS → HTTP. Debug in that order: `dig`, `curl -v`, `ss -tlnp`, firewall. Bind to `0.0.0.0` to accept outside traffic, `127.0.0.1` to hide behind a proxy. Home: CGNAT on many SA fibre/4G lines blocks inbound — use a tunnel (Cloudflare Tunnel, Tailscale). | Service listening on localhost only; port-forwarding behind CGNAT |
| 03 | Git and GitHub | Small commits that say why; feature branches + PRs; never commit secrets (`.gitignore` + secret scanning); tag releases. | `.env` committed; force-push to a shared branch |
| 04 | Docker | Small base (`node:22-slim`), multi-stage build, `npm ci`, copy lockfile first for layer caching, run as non-root, `HEALTHCHECK`, config by env vars, data in volumes. | 1.5 GB image; data lost when the container is recreated |
| 05 | Docker Compose | One file for app + proxy + DB + backups; `restart: unless-stopped`; named volumes; `.env` file for secrets (not committed). | Containers that don't come back after a reboot |
| 06 | Kubernetes | Deployments, Services, Ingress, ConfigMaps/Secrets, probes, resource requests/limits. Worth it with many services, many nodes, or a platform team. | Running a 3-node cluster for one app |
| 07 | Helm | Package and template K8s manifests per environment with `values.yaml`. | Copy-pasted YAML per environment |
| 08 | CI/CD pipelines | On every push: install → lint/typecheck → test → build artefact. On tag/main: deploy the *same* artefact. Fail fast, cache dependencies, pin tool versions. | "Works on my machine"; rebuilding differently for prod |
| 09 | GitHub Actions | Pin actions to a version (or SHA), least-privilege `permissions:`, secrets via `secrets.X`, matrix for OS/Node versions, `actions/cache` or `setup-node` cache, upload artefacts. Windows runners: watch `shell:` defaults, path separators and `npx` resolution — the recent Foreman build fixes were exactly these. | Unpinned third-party actions; `permissions: write-all` |
| 10 | AWS Cloud | Learn the core: IAM, EC2, S3, RDS, Lambda, CloudWatch, VPC. Pick `af-south-1` (Cape Town) for SA data under POPIA. Set a billing alarm on day one. | Surprise bill; data in a region the client didn't agree to |
| 11 | Terraform | Infra as code: `plan` before `apply`, remote state with locking, modules for repeats, never edit by hand what Terraform owns. | Drift from console clicks; state file lost |
| 12 | Ansible | Configure servers idempotently (packages, users, files, services) from playbooks. | Snowflake server nobody can rebuild |
| 13 | Nginx reverse proxy | TLS termination, route by host/path to apps on localhost ports, gzip, `client_max_body_size`, WebSocket/SSE headers (`Upgrade`, `proxy_buffering off` for streams). Caddy does auto-TLS with less config. | SSE agent stream buffered until the end; 413 on uploads |
| 14 | Load balancers | Health checks, connection draining, sticky sessions only if unavoidable. | Sending traffic to a dead instance |
| 15 | Prometheus | Scrape `/metrics`; the four golden signals: latency, traffic, errors, saturation. Alert on symptoms (error rate, latency), not every CPU blip. | Hundreds of alerts nobody reads |
| 16 | Grafana | One dashboard per service with the golden signals; link alerts to it. | Pretty dashboards with no alerts |
| 17 | ELK logging | Centralised, structured logs (Elasticsearch/Logstash/Kibana, or Loki, or a hosted service). Retention set deliberately; no secrets or PII. | SSH-ing into boxes to `grep` logs |
| 18 | Blue-green deploys | Run new version beside the old, switch traffic, keep old for instant rollback. Database changes must be backward compatible (expand → migrate → contract). | Deploy that breaks the old version's schema mid-switch |
| 19 | Auto scaling | Scale on a real signal (CPU, queue depth, latency) with min/max bounds and cool-downs. Stateless apps only. | Scaling a service that keeps state in memory |
| 20 | Secrets management | Never in code, images or logs. `.env` (git-ignored) locally, GitHub Actions secrets in CI, a secret manager (AWS Secrets Manager, Doppler, 1Password) in prod. Rotate on exposure; one key per environment. Broker and API keys get the smallest scope. | Anthropic or broker key pasted into a repo or a screenshot |

## When CI is red

1. Read the **first** error in the log, not the last.
2. Reproduce locally with the same versions (Node, OS, shell).
3. Fix the cause, run the same check locally, then push.
4. Never skip or disable a test to get green.

## Deploy checklist (small app)

- [ ] Build in CI, deploy the artefact CI built
- [ ] Config and secrets from env, none in the image
- [ ] TLS on, HTTP → HTTPS redirect
- [ ] Health endpoint + uptime monitor that pings his phone (ntfy already works in Foreman)
- [ ] Nightly backup of the DB/volume, **restore tested once**
- [ ] Logs kept and searchable
- [ ] Rollback is one command

## Coaching loop

1. What the tool is for, in one paragraph, and when he would *not* need it.
2. A minimal working example (a 10-line Dockerfile, a 20-line workflow).
3. Apply it to one of his projects.
4. One hands-on exercise; check the result together.

Track progress as `DevOps 05/20 ✓` lines when he's working through the list.

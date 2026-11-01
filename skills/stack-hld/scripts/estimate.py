#!/usr/bin/env python3
"""Back-of-envelope capacity estimate for a system design.

Standard library only. Every figure is derived from the inputs shown at the top
of the report, so the arithmetic can be checked and argued with.

Example:
    python estimate.py --users 2000 --requests 60 --read-ratio 0.9 \
        --payload-kb 4 --retention-days 1825 --peak 3 --server-qps 500
"""

import argparse
import json
import math
import sys

SECONDS_PER_DAY = 86_400


def human_bytes(n):
    for unit in ("B", "KB", "MB", "GB", "TB", "PB"):
        if abs(n) < 1024 or unit == "PB":
            return f"{n:,.1f} {unit}"
        n /= 1024
    return f"{n:,.1f} PB"


def human_rate(bits_per_s):
    for unit in ("bps", "Kbps", "Mbps", "Gbps", "Tbps"):
        if abs(bits_per_s) < 1000 or unit == "Tbps":
            return f"{bits_per_s:,.1f} {unit}"
        bits_per_s /= 1000
    return f"{bits_per_s:,.1f} Tbps"


def estimate(users, requests, read_ratio, payload_kb, retention_days,
             peak=3.0, replication=3, server_qps=None, hot_fraction=0.2,
             response_kb=None):
    if not 0 <= read_ratio <= 1:
        raise ValueError("read-ratio must be between 0 and 1")
    if users < 0 or requests < 0 or payload_kb < 0 or retention_days < 0:
        raise ValueError("inputs must not be negative")
    if peak < 1:
        raise ValueError("peak factor must be at least 1")

    per_day = users * requests
    avg_qps = per_day / SECONDS_PER_DAY
    peak_qps = avg_qps * peak
    write_qps = avg_qps * (1 - read_ratio)
    read_qps = avg_qps * read_ratio
    writes_per_day = per_day * (1 - read_ratio)

    payload_b = payload_kb * 1024
    resp_b = (response_kb if response_kb is not None else payload_kb) * 1024
    storage_day = writes_per_day * payload_b
    storage_year = storage_day * 365
    storage_retained = storage_day * retention_days
    storage_replicated = storage_retained * replication

    ingress_bps = write_qps * payload_b * 8
    egress_bps = read_qps * resp_b * 8
    peak_egress_bps = egress_bps * peak

    # Cache sized for the hot fraction of one day's reads (80/20 rule by default)
    cache_bytes = per_day * read_ratio * resp_b * hot_fraction

    out = {
        "inputs": {
            "users_per_day": users, "requests_per_user_per_day": requests,
            "read_ratio": read_ratio, "payload_kb": payload_kb,
            "response_kb": response_kb if response_kb is not None else payload_kb,
            "retention_days": retention_days, "peak_factor": peak,
            "replication": replication, "hot_fraction": hot_fraction,
            "server_qps": server_qps,
        },
        "requests_per_day": per_day,
        "avg_qps": avg_qps,
        "peak_qps": peak_qps,
        "read_qps": read_qps,
        "write_qps": write_qps,
        "storage_per_day_bytes": storage_day,
        "storage_per_year_bytes": storage_year,
        "storage_retained_bytes": storage_retained,
        "storage_replicated_bytes": storage_replicated,
        "ingress_bps": ingress_bps,
        "egress_bps": egress_bps,
        "peak_egress_bps": peak_egress_bps,
        "cache_bytes": cache_bytes,
    }
    if server_qps:
        # N+1: one spare so a single failure doesn't overload the rest
        out["servers_at_peak"] = max(1, math.ceil(peak_qps / server_qps)) + 1
    return out


def num(x):
    return f"{x:,.0f}" if float(x).is_integer() else f"{x:,}"


def report(r):
    i = r["inputs"]
    lines = [
        "Back-of-envelope estimate",
        "",
        f"Inputs: {num(i['users_per_day'])} users/day × {num(i['requests_per_user_per_day'])} requests, "
        f"{i['read_ratio']:.0%} reads, {num(i['payload_kb'])} KB per write, "
        f"kept {num(i['retention_days'])} days, peak ×{num(i['peak_factor'])}, replication ×{i['replication']}",
        "",
        "| Quantity | Value |",
        "|---|---|",
        f"| Requests per day | {r['requests_per_day']:,.0f} |",
        f"| Average QPS | {r['avg_qps']:,.2f} |",
        f"| Peak QPS | {r['peak_qps']:,.2f} |",
        f"| Read QPS / write QPS | {r['read_qps']:,.2f} / {r['write_qps']:,.2f} |",
        f"| New data per day | {human_bytes(r['storage_per_day_bytes'])} |",
        f"| New data per year | {human_bytes(r['storage_per_year_bytes'])} |",
        f"| Data kept (retention) | {human_bytes(r['storage_retained_bytes'])} |",
        f"| Data kept × replication | {human_bytes(r['storage_replicated_bytes'])} |",
        f"| Ingress (avg) | {human_rate(r['ingress_bps'])} |",
        f"| Egress (avg / peak) | {human_rate(r['egress_bps'])} / {human_rate(r['peak_egress_bps'])} |",
        f"| Cache for hot {i['hot_fraction']:.0%} of a day's reads | {human_bytes(r['cache_bytes'])} |",
    ]
    if "servers_at_peak" in r:
        lines.append(f"| App servers at peak (N+1, {i['server_qps']:,} QPS each) | {r['servers_at_peak']} |")
    return "\n".join(lines)


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--users", type=float, required=True, help="daily active users (or devices, dealers…)")
    p.add_argument("--requests", type=float, required=True, help="requests per user per day")
    p.add_argument("--read-ratio", type=float, default=0.9, help="share of requests that are reads (0–1)")
    p.add_argument("--payload-kb", type=float, default=1.0, help="bytes stored per write, in KB")
    p.add_argument("--response-kb", type=float, help="bytes returned per read, in KB (default: payload)")
    p.add_argument("--retention-days", type=float, default=365)
    p.add_argument("--peak", type=float, default=3.0, help="peak-to-average multiplier")
    p.add_argument("--replication", type=int, default=3)
    p.add_argument("--hot-fraction", type=float, default=0.2)
    p.add_argument("--server-qps", type=float, help="QPS one app server handles; adds a server count")
    p.add_argument("--json", action="store_true", help="print JSON instead of a table")
    a = p.parse_args(argv)
    try:
        r = estimate(a.users, a.requests, a.read_ratio, a.payload_kb, a.retention_days,
                     a.peak, a.replication, a.server_qps, a.hot_fraction, a.response_kb)
    except ValueError as e:
        print(f"error: {e}", file=sys.stderr)
        return 2
    print(json.dumps(r, indent=2) if a.json else report(r))
    return 0


if __name__ == "__main__":
    sys.exit(main())

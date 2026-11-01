#!/usr/bin/env python3
"""
Risk-constant audit for cTrader cBots (C# / cAlgo API).

The rule this enforces: anything that sizes a position or caps a loss is a
fixed constant in the code, never a [Parameter]. A parameter can be optimised,
mistyped in the instance settings, or carried over from a test, and that is
how a single bad number reaches a live account.

Usage:
    python audit_risk.py MyBot.cs [OtherBot.cs | folder ...] [--json out.json]

Exit code: 0 clean, 1 warnings only, 2 at least one critical finding.
Standard library only.
"""

import argparse
import json
import re
import sys
from pathlib import Path

# Classification works on the words in a name, so "MinFvgSize" or "PlotColor"
# are not mistaken for "LotSize". camelCase, snake_case and labels all split.
def words(text: str) -> set:
    text = re.sub(r"([a-z0-9])([A-Z])", r"\1 \2", text or "")
    text = re.sub(r"([A-Z]+)([A-Z][a-z])", r"\1 \2", text)
    return {w for w in re.split(r"[^A-Za-z0-9]+", text.lower()) if w}


SIZING = {"risk", "lot", "lots", "lotsize", "volume", "units", "quantity", "qty",
          "leverage", "martingale", "exposure", "drawdown", "grid"}
SIZE_CONTEXT = {"position", "trade", "order", "lot", "lots", "volume"}
LOSS_CAP = {"max", "daily", "weekly", "monthly", "total", "equity", "limit", "account"}
COUNT_CAP = {"positions", "trades", "orders", "open"}
STOP_WORDS = {"stop", "sl", "stoploss", "slpips", "trailing", "trail", "breakeven"}
RISK_GROUP = {"risk", "money", "sizing", "position"}


def classify(name: str, label: str = "", group: str = "") -> str:
    """CRITICAL = sizes a trade or caps a loss; REVIEW = shapes the stop; '' = other."""
    w = words(name) | words(label)
    is_stop = bool(w & STOP_WORDS) or ("atr" in w and w & {"mult", "multiplier"})
    if w & {"reward", "rr"}:
        return "REVIEW"  # reward:risk filters shape trade selection, not size
    if w & {"halt", "floor", "streak", "consecutive", "breaker"} and w & {
            "loss", "losses", "equity", "drawdown", "balance", "reset", "override", "disable"}:
        return "CRITICAL"  # circuit breakers: loss-streak halts, equity floors
    if w & SIZING and not ("risk" in w and is_stop and not w & {"percent", "pct", "amount"}):
        return "CRITICAL"
    if "size" in w and w & SIZE_CONTEXT:
        return "CRITICAL"
    if "multiplier" in w and w & {"lot", "lots", "volume", "size", "position"}:
        return "CRITICAL"
    if "loss" in w and w & LOSS_CAP and not is_stop:
        return "CRITICAL"
    if "max" in w and w & COUNT_CAP:
        return "CRITICAL"
    if w & {"percent", "pct"} and w & {"balance", "equity", "account"}:
        return "CRITICAL"
    if is_stop:
        return "REVIEW"
    if words(group) & RISK_GROUP:
        return "CRITICAL"
    return ""


PARAM_ATTR = re.compile(r"\[\s*Parameter\s*(\((?P<args>[^\]]*)\))?\s*\]", re.S)
PROPERTY = re.compile(
    r"\s*(?:\[[^\]]*\]\s*)*public\s+(?P<type>[\w<>?\.]+)\s+(?P<name>\w+)\s*\{",
    re.S,
)
CONST_DECL = re.compile(
    r"(?:private|public|internal|protected)?\s*(?:static\s+)?(?:const|readonly)\s+"
    r"(?P<type>double|int|long|decimal|float)\s+(?P<name>\w+)\s*=\s*(?P<value>[^;]+);"
)
MARKET_ORDER = re.compile(r"\bExecuteMarketOrder(?:Async)?\s*\(", re.S)
PENDING_ORDER = re.compile(r"\bPlace(?:Limit|Stop|StopLimit)Order(?:Async)?\s*\(", re.S)
SELF_MULTIPLY = re.compile(r"\b(\w+)\s*(?:\*=|=\s*\1\s*\*)")


def _named_arg(args: str, key: str):
    m = re.search(rf"\b{key}\s*=\s*([^,\)]+)", args or "")
    return m.group(1).strip().strip('"') if m else None


def _label(args: str):
    m = re.match(r'\s*"([^"]*)"', args or "")
    return m.group(1) if m else None


def _split_call_args(src: str, open_idx: int):
    """Return the top-level argument list of a call starting at '(' index."""
    depth, i, start, args = 0, open_idx, open_idx + 1, []
    while i < len(src):
        c = src[i]
        if c in "([{":
            depth += 1
        elif c in ")]}":
            depth -= 1
            if depth == 0:
                args.append(src[start:i].strip())
                return [a for a in args if a], i
        elif c == "," and depth == 1:
            args.append(src[start:i].strip())
            start = i + 1
        elif c == '"':
            j = src.find('"', i + 1)
            i = j if j != -1 else i
        i += 1
    return args, len(src)


def _line_of(src: str, idx: int) -> int:
    return src.count("\n", 0, idx) + 1


def strip_comments(src: str) -> str:
    """Blank out comments but keep line numbers stable."""
    def blank(m):
        return re.sub(r"[^\n]", " ", m.group(0))
    src = re.sub(r"/\*.*?\*/", blank, src, flags=re.S)
    return re.sub(r"//[^\n]*", blank, src)


def audit_source(path: Path) -> dict:
    raw = path.read_text(encoding="utf-8", errors="replace")
    src = strip_comments(raw)
    findings, params, consts = [], [], []

    for m in PARAM_ATTR.finditer(src):
        args = m.group("args") or ""
        prop = PROPERTY.match(src, m.end())
        if not prop:
            continue
        name, ptype = prop.group("name"), prop.group("type")
        label = _label(args) or ""
        group = _named_arg(args, "Group") or ""
        has_range = any(_named_arg(args, k) for k in ("MinValue", "MaxValue", "Step"))
        info = {
            "name": name,
            "type": ptype,
            "label": label,
            "group": group,
            "default": _named_arg(args, "DefaultValue"),
            "optimisable_range": has_range,
            "line": _line_of(src, m.start()),
        }
        params.append(info)
        kind = classify(name, label, group)
        if ptype in ("bool", "string") and kind != "CRITICAL":
            continue
        if kind == "CRITICAL" and ptype == "bool":
            findings.append({
                "severity": "CRITICAL",
                "line": info["line"],
                "item": name,
                "detail": (
                    f'A [Parameter] switch overrides a risk breaker ("{label or name}"). '
                    "Instance settings persist, so if it is left on, every restart (reconnect, "
                    "VPS reboot, cTrader update) applies it again and quietly defeats the "
                    "breaker. Make it one-shot: record in the persisted state which halt it "
                    "cleared and ignore it after that, or remove it and reset by editing the "
                    "state file on purpose."
                ),
                "fix": None,
            })
        elif kind == "CRITICAL":
            ctype = ptype.rstrip("?")
            findings.append({
                "severity": "CRITICAL",
                "line": info["line"],
                "item": name,
                "detail": (
                    f'Risk input exposed as [Parameter] ("{label or name}", default '
                    f'{info["default"]}{", optimisable range set" if has_range else ""}). '
                    "Move it to a const so no instance setting or optimiser pass can change it."
                ),
                "fix": f'private const {ctype} {name} = {info["default"] or "<value>"};',
            })
        elif kind == "REVIEW":
            findings.append({
                "severity": "REVIEW",
                "line": info["line"],
                "item": name,
                "detail": (
                    f'Stop/exit distance is a [Parameter] ("{label or name}"). Fine to optimise '
                    "as strategy logic, but cap it: add a const ceiling on loss per trade in "
                    "account terms so a wide stop can never mean a bigger loss."
                ),
                "fix": None,
            })

    for m in CONST_DECL.finditer(src):
        kind = classify(m.group("name"))
        if kind:
            consts.append({
                "name": m.group("name"),
                "value": m.group("value").strip(),
                "kind": kind,
                "line": _line_of(src, m.start()),
            })

    # Stop attached in the fill handler, with the position closed if that fails,
    # is a deliberate design (absolute stop prices). Report it, don't flag it.
    protects_after_fill = bool(
        re.search(r"\bModifyPosition(?:Async)?\s*\(", src)
        and re.search(r"Positions\.Opened|PositionOpened", src)
        and re.search(r"\bClosePosition(?:Async)?\s*\(", src))

    # Orders sent without a stop. Market: SL is argument 5; pending: argument 6.
    for pattern, sl_index, label in ((MARKET_ORDER, 4, "ExecuteMarketOrder"),
                                     (PENDING_ORDER, 5, "Place*Order")):
        for m in pattern.finditer(src):
            args, _ = _split_call_args(src, m.end() - 1)
            sl = args[sl_index] if len(args) > sl_index else None
            if sl is None or sl.strip() in ("null", "0", "0.0", "default"):
                if protects_after_fill:
                    detail = ("Order sent without a stop; the stop is attached in the fill "
                              "handler and the position is closed if that fails. Sound design. "
                              "The remaining exposure is the moment between fill and "
                              "ModifyPosition, and a cBot restart in that moment: on start-up, "
                              "check for open positions with this bot's label and no stop.")
                    sev = "INFO"
                else:
                    detail = (f"Order sent without a stop loss attached ({len(args)} arguments"
                              f"{', SL = ' + sl if sl else ''}). If the stop is added afterwards, "
                              "a disconnect between the two calls leaves the position naked. "
                              "Pass the stop in the order itself.")
                    sev = "REVIEW"
                findings.append({"severity": sev, "line": _line_of(src, m.start()),
                                 "item": label, "detail": detail, "fix": None})

    # Size scaled by its own previous value: martingale / grid recovery.
    for m in SELF_MULTIPLY.finditer(src):
        w = words(m.group(1))
        if w & {"volume", "lot", "lots", "units", "quantity", "qty"} or (
                "size" in w and w & SIZE_CONTEXT):
            findings.append({
                "severity": "CRITICAL",
                "line": _line_of(src, m.start()),
                "item": m.group(1),
                "detail": "Position size is multiplied by its own previous value "
                          "(martingale/grid pattern). Size must come from the fixed risk "
                          "constant, never from the last result.",
                "fix": None,
            })

    places_orders = bool(MARKET_ORDER.search(src) or PENDING_ORDER.search(src))
    return finalise({
        "file": str(path),
        "findings": findings,
        "parameters": params,
        "risk_constants": consts,
        "places_orders": places_orders,
    })


SEVERITY_ORDER = {"CRITICAL": 0, "REVIEW": 1, "INFO": 2}


def finalise(r: dict) -> dict:
    sev = {f["severity"] for f in r["findings"]}
    r["status"] = "CRITICAL" if "CRITICAL" in sev else ("REVIEW" if "REVIEW" in sev else "CLEAN")
    r["findings"].sort(key=lambda f: (SEVERITY_ORDER[f["severity"]], f["line"] or 10**9))
    return r


def audit_paths(paths) -> list:
    """Audit a set of files as one project: risk constants may live in any of them."""
    results = [audit_source(f) for f in collect(paths)]
    if results and not any(c["kind"] == "CRITICAL" for r in results for c in r["risk_constants"]):
        targets = [r for r in results if r["places_orders"]] or results[:1]
        for r in targets:
            r["findings"].append({
                "severity": "REVIEW", "line": None, "item": "risk constants",
                "detail": "No const/readonly sizing or loss-cap value found in any file given "
                          "(risk %, max lots, daily loss cap). If sizing lives in another file, "
                          "include it in the audit; otherwise add them.",
                "fix": "private const double RiskPercentPerTrade = 0.5;  "
                       "private const double MaxDailyLossPercent = 2.0;",
            })
            finalise(r)
    return results


def collect(paths):
    out = []
    for p in map(Path, paths):
        if p.is_dir():
            out += sorted(p.rglob("*.cs"))
        elif p.suffix.lower() == ".cs" and p.exists():
            out.append(p)
        else:
            print(f"skipping {p}: not a .cs file or folder", file=sys.stderr)
    return out


def to_markdown(results) -> str:
    lines = ["## Risk-constant audit", ""]
    quiet = [r for r in results if not r["findings"] and not r["parameters"]
             and not r["risk_constants"]]
    for r in results:
        if r in quiet:
            continue
        lines.append(f"**{Path(r['file']).name}**: {r['status']}  ")
        lines.append(
            f"{len(r['parameters'])} parameters, {len(r['risk_constants'])} risk constants "
            "found in code."
        )
        lines.append("")
        if r["findings"]:
            lines.append("| Severity | Line | Item | What and why |")
            lines.append("|---|---|---|---|")
            for f in r["findings"]:
                detail = f["detail"] + (f"<br>Fix: `{f['fix']}`" if f["fix"] else "")
                lines.append(f"| {f['severity']} | {f['line'] or '-'} | `{f['item']}` | {detail} |")
            lines.append("")
        if r["risk_constants"]:
            lines.append("Hardcoded risk values: " + ", ".join(
                f"`{c['name']} = {c['value']}`" for c in r["risk_constants"]))
            lines.append("")
    if quiet:
        lines.append("No parameters, orders or risk values in: "
                     + ", ".join(Path(r["file"]).name for r in quiet))
        lines.append("")
    return "\n".join(lines)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("paths", nargs="+", help=".cs files or folders")
    ap.add_argument("--json", help="also write results as JSON to this path")
    a = ap.parse_args()
    results = audit_paths(a.paths)
    if not results:
        sys.exit("no .cs files found")
    print(to_markdown(results))
    if a.json:
        Path(a.json).write_text(json.dumps(results, indent=2))
    worst = {"CLEAN": 0, "REVIEW": 1, "CRITICAL": 2}
    sys.exit(max(worst[r["status"]] for r in results))


if __name__ == "__main__":
    main()

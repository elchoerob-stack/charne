#!/usr/bin/env python3
"""Quick static security scan for JS/TS/HTML/Python/C# code.

A first pass, not a pentest: it finds the patterns behind the common
OWASP Top 10 mistakes so a reviewer can look at those lines first. Every
finding names its rule, the concept it belongs to, and the fix.

Standard library only.

    python scan.py <path> [<path> ...] [--json] [--min-severity LOW|MEDIUM|HIGH]

Exit code: 0 no HIGH findings, 1 at least one HIGH finding, 2 usage error.
Add `security-scan: ignore` in a comment on a line to silence it after review.
"""

import argparse
import json
import os
import re
import sys

EXTS = {".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".html", ".htm", ".py", ".cs", ".sh", ".yml", ".yaml", ".env"}
SKIP_DIRS = {"node_modules", ".git", "dist", "build", "out", "bin", "obj", "__pycache__", ".venv", "venv", "coverage"}
SEVERITY = {"LOW": 1, "MEDIUM": 2, "HIGH": 3}
MAX_BYTES = 2_000_000

# (id, severity, concept, regex, applies-to extensions or None for all, fix)
RULES = [
    # --- Secrets (13) -----------------------------------------------------
    ("secret-anthropic", "HIGH", "13 Secrets Management",
     r"sk-ant-[A-Za-z0-9_\-]{20,}", None,
     "Remove the key, rotate it in the Anthropic console, load it from an env var."),
    ("secret-aws", "HIGH", "13 Secrets Management",
     r"\bAKIA[0-9A-Z]{16}\b", None,
     "Rotate the AWS key now; use IAM roles or a secret manager."),
    ("secret-private-key", "HIGH", "13 Secrets Management",
     r"-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----", None,
     "Private keys never live in the repo. Rotate and move to a secret store."),
    ("secret-github", "HIGH", "13 Secrets Management",
     r"\b(?:ghp|gho|ghs|github_pat)_[A-Za-z0-9_]{20,}", None,
     "Revoke the GitHub token and use Actions secrets."),
    ("secret-generic", "MEDIUM", "13 Secrets Management",
     r"""(?i)\b(?:api[_-]?key|secret|passwd|password|token|client[_-]?secret)\b\s*[:=]\s*["'][^"'\s]{8,}["']""", None,
     "Hard-coded credential. Load from env / secret manager; rotate if it was ever pushed."),

    # --- Injection (02, 17) ----------------------------------------------
    ("sql-template", "HIGH", "02 SQL Injection",
     r"""(?i)\.(?:query|exec|execute|prepare|run|all|get|raw)\s*\(\s*`[^`]*\b(?:select|insert|update|delete|where)\b[^`]*\$\{""",
     {".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx"},
     "Use placeholders: db.prepare('… WHERE id = ?').get(id)."),
    ("sql-concat", "HIGH", "02 SQL Injection",
     r"""(?i)["'](?:\s*(?:select|insert|update|delete)\b[^"']*|[^"']*\bwhere\b[^"']*)["']\s*\+\s*[A-Za-z_]""", None,
     "String-built SQL. Use parameters (?, @p, %s with a params tuple)."),
    ("sql-fstring", "HIGH", "02 SQL Injection",
     r"""(?i)\.execute\(\s*f["'][^"']*\b(?:select|insert|update|delete|where)\b""", {".py"},
     "cursor.execute('… WHERE id = %s', (id,)) — never an f-string."),
    ("cmd-injection-js", "HIGH", "17 Input Validation",
     r"""\b(?:exec|execSync)\s*\(\s*`[^`]*\$\{""", {".js", ".mjs", ".cjs", ".ts", ".tsx"},
     "Use execFile/spawn with an argument array, never a shell string with input in it."),
    ("cmd-shell-true", "HIGH", "17 Input Validation",
     r"subprocess\.\w+\([^)]*shell\s*=\s*True", {".py"},
     "Pass a list of args and drop shell=True."),
    ("eval", "HIGH", "17 Input Validation",
     r"(?<![\w.])(?:eval|new\s+Function)\s*\(", {".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".html", ".htm", ".py"},
     "Remove eval. Parse JSON with JSON.parse / json.loads; use a lookup table for dispatch."),
    ("unsafe-deserialise", "HIGH", "17 Input Validation",
     r"\b(?:pickle\.loads?|yaml\.load)\s*\((?![^)]*SafeLoader)", {".py"},
     "Never unpickle untrusted data; use yaml.safe_load."),

    # --- XSS (03) ---------------------------------------------------------
    ("xss-innerhtml", "MEDIUM", "03 XSS",
     r"""\.(?:innerHTML|outerHTML)\s*\+?=\s*(?!\s*["'][^"'$]*["']\s*;?\s*$)[^;]*(?:\$\{|\+\s*[A-Za-z_])""",
     {".js", ".mjs", ".ts", ".tsx", ".jsx", ".html", ".htm"},
     "Dynamic data into innerHTML. Use textContent, or escape every interpolated value."),
    ("xss-insertadjacent", "MEDIUM", "03 XSS",
     r"""insertAdjacentHTML\s*\([^)]*(?:\$\{|\+\s*[A-Za-z_])""", {".js", ".mjs", ".ts", ".tsx", ".jsx", ".html", ".htm"},
     "Escape interpolated values or build nodes with createElement/textContent."),
    ("xss-document-write", "MEDIUM", "03 XSS",
     r"document\.write\s*\(", {".js", ".ts", ".html", ".htm"},
     "Avoid document.write; build DOM nodes."),
    ("xss-react", "MEDIUM", "03 XSS",
     r"dangerouslySetInnerHTML", {".tsx", ".jsx", ".js", ".ts"},
     "Sanitise with DOMPurify first, or render as text."),

    # --- Transport and crypto (07, 08, 09) --------------------------------
    ("tls-disabled", "HIGH", "07 HTTPS and TLS",
     r"""rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*["']?0|verify\s*=\s*False|ServerCertificateCustomValidationCallback\s*=\s*\([^)]*\)\s*=>\s*true""",
     None, "Certificate checks are off — anyone on the path can read and change traffic. Fix the CA bundle instead."),
    ("http-url", "LOW", "07 HTTPS and TLS",
     r"""["']http://(?!localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|www\.w3\.org|schemas\.)[^"'\s]+""", None,
     "Plain HTTP to a remote host. Use https://."),
    ("weak-hash-password", "HIGH", "09 Password Hashing",
     r"""(?i)(?:md5|sha1|sha256)\b[^\n]{0,60}\bpass(?:word)?|\bpass(?:word)?\b[^\n]{0,60}(?:md5|sha1|createHash\(\s*["']sha(?:1|256)["'])""",
     None, "Fast hashes are not password hashes. Use argon2id, scrypt or bcrypt (cost ≥ 12)."),
    ("weak-random-token", "MEDIUM", "08 Hashing and Encryption",
     r"""(?i)\b(?:token|otp|secret|session|nonce|reset|code)\w*\s*[:=][^\n;]*Math\.random\(""", None,
     "Math.random is predictable. Use crypto.randomBytes / crypto.randomUUID / secrets.token_urlsafe."),

    # --- Auth and sessions (10, 11, 12) -----------------------------------
    ("jwt-decode", "MEDIUM", "11 JWT Security",
     r"\bjwt\.decode\s*\(", {".js", ".mjs", ".ts", ".tsx", ".py"},
     "decode does not check the signature. Use jwt.verify with a pinned algorithm, issuer and audience."),
    ("jwt-none", "HIGH", "11 JWT Security",
     r"""(?i)algorithms?\s*[:=]\s*\[?\s*["']none["']""", None,
     "alg 'none' accepts unsigned tokens. Pin HS256/RS256/EdDSA."),
    ("token-localstorage", "LOW", "10 Secure Sessions",
     r"""localStorage\.setItem\(\s*["'][^"']*(?:token|jwt|session|auth)[^"']*["']""", None,
     "Tokens in localStorage are readable by any XSS. Prefer an HttpOnly, Secure, SameSite cookie."),
    ("cookie-flags", "MEDIUM", "10 Secure Sessions",
     r"""httpOnly\s*:\s*false|secure\s*:\s*false""", {".js", ".mjs", ".ts"},
     "Session cookies need httpOnly: true and secure: true."),

    # --- CORS, CSRF, SSRF, headers (04, 05, 06, 15) -----------------------
    ("cors-wildcard-credentials", "HIGH", "05 CORS",
     r"""origin\s*:\s*(?:["']\*["']|true)[^}]*credentials\s*:\s*true|credentials\s*:\s*true[^}]*origin\s*:\s*(?:["']\*["']|true)""", None,
     "Any site can make credentialed requests. List allowed origins explicitly."),
    ("cors-open", "LOW", "05 CORS",
     r"""\bcors\(\s*\)""", {".js", ".mjs", ".ts"},
     "cors() with no options allows every origin. Fine for a public read-only API; otherwise pass an origin list."),
    ("ssrf-fetch", "MEDIUM", "06 SSRF",
     r"""\b(?:fetch|axios\.(?:get|post)|got|requests\.(?:get|post))\s*\(\s*(?:req|request)\.(?:body|query|params)""", None,
     "Server fetches a URL the user chose. Allow-list hosts and block private/metadata IPs (169.254.169.254, 10/8, 127/8)."),
    ("csrf-get-mutation", "LOW", "04 CSRF",
     r"""\.get\(\s*["'][^"']*/(?:delete|remove|update|approve|send|pay|cancel)\b""", {".js", ".mjs", ".ts"},
     "State-changing action on GET. Use POST/PUT/DELETE with CSRF protection or SameSite cookies."),

    # --- Prompt injection (20) --------------------------------------------
    ("prompt-concat", "LOW", "20 Prompt Injection",
     r"""(?i)(?:system|prompt)\w*\s*[:=]\s*`[^`]*\$\{\s*(?:req|request|body|input|email|page|html|userInput|message)""", None,
     "Untrusted text in a prompt. Wrap it in tags, label it as data, and never let it unlock tools."),
]

COMPILED = [(rid, sev, concept, re.compile(rx), exts, fix) for rid, sev, concept, rx, exts, fix in RULES]
SECRET_RULES = {"secret-anthropic", "secret-aws", "secret-private-key", "secret-github", "secret-generic"}
XSS_RULES = {"xss-innerhtml", "xss-insertadjacent"}
INTERP = re.compile(r"\$\{((?:[^{}]|\{[^{}]*\})*)\}")
# Interpolations that can't carry markup: escaped, encoded, numeric, or a literal-only ternary
SAFE_INTERP = re.compile(
    r"""^\s*(?:esc|escape|escapeHtml|escapeHTML|sanitize|DOMPurify\.sanitize|encodeURIComponent|"""
    r"""Math\.\w+|Number|parseInt|parseFloat|String\(\s*\d)\s*\(|^\s*-?\d+(?:\.\d+)?\s*$|"""
    r"""^\s*[\w.]+\s*[=!<>]=?=?\s*(?:["'][^"']*["']|-?\d+(?:\.\d+)?)\s*\?\s*["'][^"']*["']\s*:\s*["'][^"']*["']\s*$""")
TAINT = re.compile(r"\b(?:req|request|body|query|params|input|userInput|args)\b")


def judge(rid, sev, line):
    """Second look at a regex hit. Returns the severity to report, or None to drop it."""
    if rid in XSS_RULES:
        sink = re.split(r"innerHTML|outerHTML|insertAdjacentHTML", line, maxsplit=1)[-1]
        sink = re.sub(r"^\s*\+?=", "", sink)
        exprs = INTERP.findall(sink)
        if exprs and all(SAFE_INTERP.search(e) for e in exprs) and "+" not in INTERP.sub("", sink):
            return None
    if rid == "sql-template":
        exprs = INTERP.findall(line)
        if exprs and not any(TAINT.search(e) for e in exprs):
            return "MEDIUM"  # dynamic SQL built from code fragments: check values still go through ?
    if rid == "sql-concat" and "`" in line:
        return None  # the template-literal rule already covers this line
    if rid == "secret-generic" and re.search(r"""[:=]\s*["']\$""", line):
        return None  # value comes from a shell/env variable
    return sev


def mask(line):
    """Hide most of any secret-looking value so the report doesn't leak it again."""
    def _m(m):
        s = m.group(0)
        return s[:6] + "…" + s[-2:] if len(s) > 10 else "…"
    return re.sub(r"[A-Za-z0-9_\-+/=]{16,}", _m, line)


def iter_files(paths):
    for p in paths:
        if os.path.isfile(p):
            yield p
            continue
        for root, dirs, files in os.walk(p):
            dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
            for f in files:
                ext = os.path.splitext(f)[1].lower()
                if ext in EXTS or f.startswith(".env"):
                    yield os.path.join(root, f)


def scan_file(path):
    findings = []
    try:
        if os.path.getsize(path) > MAX_BYTES:
            return findings
        with open(path, encoding="utf-8", errors="replace") as fh:
            lines = fh.read().splitlines()
    except OSError:
        return findings
    ext = os.path.splitext(path)[1].lower()
    if path.endswith(".min.js"):
        return findings
    is_example = bool(re.search(r"\.example$|\.sample$|example\.env", path))
    for n, line in enumerate(lines, 1):
        if "security-scan: ignore" in line or len(line) > 2000:
            continue
        for rid, sev, concept, rx, exts, fix in COMPILED:
            if exts is not None and ext not in exts and not (ext == "" and None in exts):
                continue
            if not rx.search(line):
                continue
            if rid in SECRET_RULES and (is_example or re.search(r"(?i)process\.env|os\.environ|getenv|<your|changeme|example|placeholder|xxxx", line)):
                continue
            sev_now = judge(rid, sev, line)
            if sev_now is None:
                continue
            findings.append({
                "file": path, "line": n, "rule": rid, "severity": sev_now, "concept": concept,
                "code": mask(line.strip())[:200] if rid in SECRET_RULES else line.strip()[:200],
                "fix": fix,
            })
    # one finding per line per concept, keeping the most severe
    best = {}
    for f in findings:
        k = (f["line"], f["concept"])
        if k not in best or SEVERITY[f["severity"]] > SEVERITY[best[k]["severity"]]:
            best[k] = f
    return list(best.values())


def scan(paths, min_severity="LOW"):
    floor = SEVERITY[min_severity]
    out = []
    for f in iter_files(paths):
        out.extend(x for x in scan_file(f) if SEVERITY[x["severity"]] >= floor)
    out.sort(key=lambda x: (-SEVERITY[x["severity"]], x["file"], x["line"]))
    return out


def report(findings, scanned_paths):
    if not findings:
        return f"No findings in {', '.join(scanned_paths)}. (Static patterns only — still review auth, access control and business logic by hand.)"
    counts = {s: sum(1 for f in findings if f["severity"] == s) for s in ("HIGH", "MEDIUM", "LOW")}
    lines = [f"{len(findings)} findings — HIGH {counts['HIGH']}, MEDIUM {counts['MEDIUM']}, LOW {counts['LOW']}", ""]
    for f in findings:
        lines.append(f"[{f['severity']}] {f['file']}:{f['line']}  {f['rule']}  ({f['concept']})")
        lines.append(f"    {f['code']}")
        lines.append(f"    fix: {f['fix']}")
    return "\n".join(lines)


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("paths", nargs="+")
    p.add_argument("--json", action="store_true")
    p.add_argument("--min-severity", default="LOW", choices=list(SEVERITY))
    a = p.parse_args(argv)
    missing = [x for x in a.paths if not os.path.exists(x)]
    if missing:
        print(f"error: not found: {', '.join(missing)}", file=sys.stderr)
        return 2
    findings = scan(a.paths, a.min_severity)
    print(json.dumps(findings, indent=2) if a.json else report(findings, a.paths))
    return 1 if any(f["severity"] == "HIGH" for f in findings) else 0


if __name__ == "__main__":
    sys.exit(main())

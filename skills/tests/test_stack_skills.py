#!/usr/bin/env python3
"""Self-test for the stack-* skills. Run: python3 skills/tests/test_stack_skills.py"""

import importlib.util
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
SKILLS = HERE.parent
TMP = Path(tempfile.mkdtemp(prefix="stack-test-"))
FAILS = []


def load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def expect(name, cond, detail=""):
    print(("ok   " if cond else "FAIL ") + name)
    if not cond:
        FAILS.append(name)
        print(str(detail)[:2000])


def run(*args):
    r = subprocess.run([sys.executable, *map(str, args)], capture_output=True, text=True)
    return r.returncode, r.stdout + r.stderr


# ---------------------------------------------------------------- SKILL.md files
NAMES = ["stack-backend", "stack-dsa", "stack-hld", "stack-lld", "stack-ai-agentic", "stack-devops", "stack-security"]
for n in NAMES:
    text = (SKILLS / n / "SKILL.md").read_text()
    m = re.match(r"^---\nname: (.+)\ndescription: (.+)\n---\n", text)
    expect(f"{n}: frontmatter", m and m.group(1) == n, text[:200])
    if m:
        expect(f"{n}: description under 1024 chars", len(m.group(2)) <= 1024, len(m.group(2)))
    rows = re.findall(r"^\| (\d\d) \|", text, re.M)
    expect(f"{n}: all 20 concepts present", rows == [f"{i:02d}" for i in range(1, 21)], rows)
    expect(f"{n}: under 500 lines", text.count("\n") < 500)

# ---------------------------------------------------------------- estimate.py
est = load(SKILLS / "stack-hld" / "scripts" / "estimate.py", "estimate")
r = est.estimate(users=1_000_000, requests=10, read_ratio=0.9, payload_kb=1, retention_days=365, peak=2, server_qps=100)
expect("10M requests/day ≈ 115.7 QPS", abs(r["avg_qps"] - 10_000_000 / 86_400) < 1e-9, r["avg_qps"])
expect("peak = avg × factor", abs(r["peak_qps"] - 2 * r["avg_qps"]) < 1e-9)
expect("reads + writes = total", abs(r["read_qps"] + r["write_qps"] - r["avg_qps"]) < 1e-9)
expect("storage/day = writes × payload", abs(r["storage_per_day_bytes"] - 1_000_000 * 1024) < 1e-6, r["storage_per_day_bytes"])
expect("retained = day × retention", abs(r["storage_retained_bytes"] - r["storage_per_day_bytes"] * 365) < 1e-3)
expect("replicated = retained × 3", abs(r["storage_replicated_bytes"] - 3 * r["storage_retained_bytes"]) < 1e-3)
expect("servers N+1: ceil(231.5/100)+1 = 4", r["servers_at_peak"] == 4, r["servers_at_peak"])
code, out = run(SKILLS / "stack-hld" / "scripts" / "estimate.py", "--users", "2000", "--requests", "60", "--json")
expect("CLI --json parses", code == 0 and json.loads(out)["requests_per_day"] == 120_000, out)
code, out = run(SKILLS / "stack-hld" / "scripts" / "estimate.py", "--users", "10", "--requests", "1", "--read-ratio", "1.5")
expect("bad read ratio rejected with exit 2", code == 2 and "read-ratio" in out, out)

# ---------------------------------------------------------------- scan.py
SCAN = SKILLS / "stack-security" / "scripts" / "scan.py"
bad = TMP / "bad"
bad.mkdir()
(bad / "server.ts").write_text("""
const key = "sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWXYZ012345";
app.get("/u", (req, res) => db.prepare(`SELECT * FROM users WHERE id = ${req.query.id}`).get());
const otpCode = Math.floor(Math.random() * 1e6);
const claims = jwt.decode(token);
exec(`convert ${req.body.file} out.png`);
https.request({ host, rejectUnauthorized: false });
app.use(cors({ origin: "*", credentials: true }));
const r = await fetch(req.body.url);
const system = `You are helpful. ${email.body}`;
""")
(bad / "page.html").write_text("""<script>
el.innerHTML = `<b>${user.name}</b>`;
ok.innerHTML = `<b>${esc(user.name)}</b> ${n === 1 ? "item" : "items"}`;
localStorage.setItem("auth_token", t);
</script>""")
(bad / "job.py").write_text("""
cur.execute(f"SELECT * FROM deals WHERE agent = '{name}'")
subprocess.run(cmd, shell=True)
data = pickle.loads(blob)
hashed = hashlib.md5(password.encode()).hexdigest()
""")
(bad / "Bot.cs").write_text('var cmd = new SqlCommand("SELECT * FROM t WHERE id = " + id, conn);\n')

found = load(SCAN, "scan").scan([str(bad)])
rules = {f["rule"] for f in found}
for want in ["secret-anthropic", "sql-template", "weak-random-token", "jwt-decode", "cmd-injection-js",
             "tls-disabled", "cors-wildcard-credentials", "ssrf-fetch", "prompt-concat", "xss-innerhtml",
             "token-localstorage", "sql-fstring", "cmd-shell-true", "unsafe-deserialise", "weak-hash-password",
             "sql-concat"]:
    expect(f"scan finds {want}", want in rules, sorted(rules))
xss_lines = [f["line"] for f in found if f["rule"] == "xss-innerhtml"]
expect("escaped innerHTML not flagged", xss_lines == [2], xss_lines)
sql = [f for f in found if f["rule"] == "sql-template"]
expect("SQL with req.* is HIGH", sql and sql[0]["severity"] == "HIGH", sql)
secret = [f for f in found if f["rule"] == "secret-anthropic"][0]
expect("secret masked in output", "ABCDEFGHIJKLMNOP" not in secret["code"], secret["code"])
code, _ = run(SCAN, bad)
expect("exit 1 when HIGH found", code == 1)

good = TMP / "good"
good.mkdir()
(good / "server.ts").write_text("""
const key = process.env.ANTHROPIC_API_KEY;
const where = []; const args = [];
if (dealer) { where.push("dealer = ?"); args.push(dealer); }
db.prepare(`SELECT * FROM r ${where.length ? "WHERE " + where.join(" AND ") : ""}`).all(...args);
const token = crypto.randomBytes(32).toString("hex");
el.textContent = user.name;
""")
(good / ".env.example").write_text('API_KEY="sk-ant-your-key-here-placeholder-0000"\n')
(good / "setup.sh").write_text('API_KEY="${ANTHROPIC_API_KEY:-}"\n')
(good / "ignored.ts").write_text('db.exec(`DELETE FROM t WHERE id = ${req.params.id}`); // security-scan: ignore\n')
found = load(SCAN, "scan2").scan([str(good)])
expect("no HIGH on safe code", not [f for f in found if f["severity"] == "HIGH"], found)
expect("code-built SQL fragments are only MEDIUM", [f["severity"] for f in found if f["rule"] == "sql-template"] == ["MEDIUM"], found)
expect("env-sourced and example secrets ignored", not [f for f in found if f["rule"].startswith("secret")], found)
code, _ = run(SCAN, good)
expect("exit 0 with no HIGH", code == 0)
code, out = run(SCAN, TMP / "does-not-exist")
expect("missing path exits 2", code == 2, out)

print()
if FAILS:
    print(f"{len(FAILS)} FAILED: {', '.join(FAILS)}")
    sys.exit(1)
print("all passed")

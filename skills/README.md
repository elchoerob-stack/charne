# Skills

Custom Claude skills built for Jacques' own workflows.

| Skill | What it does |
|---|---|
| `cbot-gate/` | Scores a cTrader / MT5 backtest or walk-forward run to PASS, FAIL or INCONCLUSIVE against fixed thresholds, and audits cBot C# for risk inputs exposed as `[Parameter]`. |

## Install

- **Claude app (web, desktop, phone):** open `dist/cbot-gate.skill` from the chat
  where it was sent and press **Save skill**. Or go to Settings → Capabilities →
  Skills and upload the file.
- **Claude Code:** copy the folder to `~/.claude/skills/cbot-gate/`.

After that, just share a backtest or a `.cs` file and ask whether it's ready.
The skill loads on its own.

## Test

```bash
python3 skills/tests/test_cbot_gate.py
```

This builds synthetic histories (a real edge, a decaying edge, too few trades,
comma-decimal CSVs, MT5 deal exports, walk-forward folds) plus a good and a bad
sample cBot. It checks that each one gets the right verdict. Run it after any
change to the scripts, then rebuild the package:

```bash
cd <skill-creator> && python3 -m scripts.package_skill /path/to/skills/cbot-gate /path/to/skills/dist
```

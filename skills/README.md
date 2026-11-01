# Skills

Custom Claude skills built for Jacques' own workflows.

| Skill | What it does |
|---|---|
| `cbot-gate/` | Scores a cTrader / MT5 backtest or walk-forward run to PASS, FAIL or INCONCLUSIVE against fixed thresholds, and audits cBot C# for risk inputs exposed as `[Parameter]`. |
| `keystone-desk/` | Charné's desk at RB Brand: listing copy in her style, buyer–listing matching, buyer cost sheets (SARS transfer duty, bond, affordability), seller net, commission splits, and FICA / POPIA / PPA checklists. |

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

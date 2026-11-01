"""News blackout windows. No new trades (live or shadow) inside them.

data/blackouts.csv, edited by hand and re-read every cycle:

    start_utc,end_utc,label
    2026-11-06 13:15,2026-11-06 14:30,US NFP
    2026-12-10 18:45,2026-12-10 20:30,FOMC

Times are UTC (SAST minus 2 hours). If the file can't be read, the bot treats
it as a blackout: an unreadable calendar is missing data.
"""

from __future__ import annotations

import csv
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path


@dataclass(frozen=True)
class Window:
    start: datetime
    end: datetime
    label: str


def _dt(s: str) -> datetime:
    return datetime.fromisoformat(s.strip().replace("Z", "")).replace(tzinfo=timezone.utc)


def load(path: Path | None) -> tuple[list[Window], str]:
    """(windows, error). A missing file means no blackouts; a broken one is an error."""
    if path is None or not path.exists():
        return [], ""
    try:
        with open(path, newline="") as f:
            rows = [r for r in csv.DictReader(f) if r.get("start_utc", "").strip()]
        return [Window(_dt(r["start_utc"]), _dt(r["end_utc"]), (r.get("label") or "").strip())
                for r in rows], ""
    except Exception as e:  # noqa: BLE001
        return [], f"{path.name} unreadable: {e}"


def active(now: datetime, path: Path | None) -> str:
    """Reason string if trading is blocked now, else ''."""
    windows, err = load(path)
    if err:
        return err
    w = next((w for w in windows if w.start <= now < w.end), None)
    return f"{w.label} ({w.start:%H:%M}-{w.end:%H:%M} UTC)" if w else ""

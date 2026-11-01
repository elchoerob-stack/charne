from datetime import timedelta

from app.models import Candle
from app.shadow import MAX_BARS, ShadowBook
from app.strategy import Candidate
from tests.conftest import NOW, quote, snapshot

C = Candidate("BUY", "t", "trend_breakout", stop=2645.0, target=2662.0)


def bar(i, low, high, close=2650.0):
    t = snapshot().m15[-1].time + timedelta(minutes=15 * (i + 1))
    return Candle(time=t, open=2650, high=high, low=low, close=close)


def test_target_hit_is_measured_in_r(journal):
    book = ShadowBook(journal)
    s = snapshot(q=quote())
    book.open(s, C, "baseline", C.stop, C.target, "fp1")
    book.update([bar(0, 2648, 2655), bar(1, 2649, 2663)], NOW)
    (r,) = book.summary("fp1")[:1]
    assert r["n"] == 1 and r["expectancy_r"] == round((2662 - 2650.3) / 5.3, 3)


def test_stop_wins_when_one_bar_touches_both(journal):
    book = ShadowBook(journal)
    book.open(snapshot(), C, "baseline", C.stop, C.target)
    book.update([bar(0, 2640, 2670)], NOW)
    assert book.summary()[0]["expectancy_r"] == -1.0


def test_time_exit_and_no_double_counting(journal):
    book = ShadowBook(journal)
    s = snapshot()
    book.open(s, C, "baseline", C.stop, C.target)
    book.open(s, C, "baseline", C.stop, C.target)  # same bar again: ignored
    flat = [bar(i, 2649, 2651, 2650.3) for i in range(MAX_BARS)]
    book.update(flat[:50], NOW)
    book.update(flat, NOW)  # overlapping bars aren't re-applied
    (r,) = [x for x in book.summary() if x["ai_verdict"] == "all"]
    assert r["n"] == 1 and abs(r["expectancy_r"]) < 0.01


def test_verdict_split(journal):
    book = ShadowBook(journal)
    s1, s2 = snapshot(sid="A"), snapshot(sid="B")
    for s in (s1, s2):
        book.open(s, C, "baseline", C.stop, C.target)
    book.set_verdict("A", "trend_breakout", "agreed")
    book.set_verdict("B", "trend_breakout", "vetoed")
    book.update([bar(0, 2649, 2663)], NOW)
    verdicts = {r["ai_verdict"]: r["n"] for r in book.summary()}
    assert verdicts == {"agreed": 1, "all": 2, "vetoed": 1}


def test_invalid_levels_are_not_recorded(journal):
    book = ShadowBook(journal)
    book.open(snapshot(), C, "baseline", 2655.0, 2662.0)  # stop above a BUY entry
    assert journal.db.execute("SELECT COUNT(*) FROM shadow_trades").fetchone()[0] == 0

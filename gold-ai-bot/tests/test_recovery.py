from datetime import timedelta

import pytest

from app.broker import PaperBroker
from app.journal import ABSENT, FILLED, PENDING, Journal
from app.models import OrderRequest
from app.reconciliation import startup_reconcile, sync_closed_trades
from tests.conftest import NOW, quote, spec


def order(journal, coid):
    journal.record_order(client_order_id=coid, snapshot_id=coid[4:], side="BUY", units=1,
                         entry_reference=2650.3, stop_loss=2645, take_profit=2662,
                         risk_amount=98, now=NOW)


async def broker_with_position(label):
    b = PaperBroker(spec(), balance=100_000)
    b.set_market([], [], quote())
    await b.connect()
    await b.place_market_order(OrderRequest(client_order_id=label, symbol="XAUUSD", side="BUY",
                                            units=1, entry_reference=2650.3, stop_loss=2645,
                                            take_profit=2662))
    return b


@pytest.mark.asyncio
async def test_crash_after_send_order_is_found(journal):
    order(journal, "gab-A")
    b = await broker_with_position("gab-A")
    issues = await startup_reconcile(b, journal, NOW)
    assert issues == [] and journal.get_order("gab-A")["state"] == FILLED


@pytest.mark.asyncio
async def test_crash_before_send_order_is_marked_absent(journal):
    order(journal, "gab-B")
    b = PaperBroker(spec())
    b.set_market([], [], quote())
    await b.connect()
    await startup_reconcile(b, journal, NOW)
    assert journal.get_order("gab-B")["state"] == ABSENT
    assert journal.active_locks(NOW) == []


@pytest.mark.asyncio
async def test_position_the_bot_did_not_open_locks_it(journal):
    b = await broker_with_position("manual")
    issues = await startup_reconcile(b, journal, NOW)
    assert issues and [lk.kind for lk in journal.active_locks(NOW)] == ["reconciliation"]


@pytest.mark.asyncio
async def test_our_label_but_missing_from_ledger_locks_it(journal):
    b = await broker_with_position("gab-ghost")
    issues = await startup_reconcile(b, journal, NOW)
    assert any("not in the ledger" in i for i in issues)


@pytest.mark.asyncio
async def test_closed_trade_sync_is_idempotent(journal):
    order(journal, "gab-C")
    b = await broker_with_position("gab-C")
    journal.set_order_state("gab-C", FILLED, position_id="1001", now=NOW)
    from tests.conftest import bars
    bar = bars(1)[0].model_copy(update={"low": 2640.0, "high": 2651.0})
    b.advance(bar, NOW + timedelta(minutes=15))
    later = NOW + timedelta(minutes=20)
    assert len(await sync_closed_trades(b, journal, later)) == 1
    assert len(await sync_closed_trades(b, journal, later)) == 0
    (t,) = journal.trades()
    assert t["client_order_id"] == "gab-C" and t["net"] < 0


def test_pending_order_survives_restart(tmp_path):
    db = tmp_path / "j.sqlite3"
    order(Journal(db), "gab-D")
    assert Journal(db).get_order("gab-D")["state"] == PENDING

import pytest

from app.broker import PaperBroker
from app.execution import ExecutionService
from app.journal import ABSENT, FILLED, REJECTED, UNKNOWN
from app.models import BrokerError
from tests.conftest import NOW, buy, quote, snapshot, spec


async def nosleep(_s):
    return None


def setup(journal, balance=100_000.0, q=None):
    b = PaperBroker(spec(), balance=balance)
    b.set_market([], [], q or quote())
    svc = ExecutionService(b, journal, clock=lambda: NOW, sleep=nosleep)
    return b, svc


@pytest.mark.asyncio
async def test_fill_is_written_to_the_ledger(journal):
    b, svc = setup(journal)
    await b.connect()
    out = await svc.execute(buy(), snapshot())
    assert out.status == "FILLED"
    row = journal.get_order(out.client_order_id)
    assert row["state"] == FILLED and row["position_id"] == out.position_id
    (pos,) = await b.open_positions()
    assert pos.stop_loss is not None and pos.label == out.client_order_id


@pytest.mark.asyncio
async def test_same_snapshot_never_sends_twice(journal):
    b, svc = setup(journal)
    await b.connect()
    await svc.execute(buy(), snapshot())
    again = await svc.execute(buy(), snapshot())
    assert again.status == "DUPLICATE" and len(b.orders_received) == 1


@pytest.mark.asyncio
async def test_refuses_when_not_verified(journal):
    b, svc = setup(journal)  # connect() never called
    out = await svc.execute(buy(), snapshot())
    assert out.status == "BLOCKED" and "demo_account" in out.detail
    assert b.orders_received == []


@pytest.mark.asyncio
async def test_broker_rejection(journal):
    b, svc = setup(journal)
    await b.connect()
    b.fail_next = ["reject"]
    out = await svc.execute(buy(), snapshot())
    assert out.status == "REJECTED" and journal.get_order(out.client_order_id)["state"] == REJECTED


@pytest.mark.asyncio
async def test_lost_ack_but_filled_is_found_not_resent(journal):
    b, svc = setup(journal)
    await b.connect()
    b.fail_next = ["timeout_filled"]
    out = await svc.execute(buy(), snapshot())
    assert out.status == "FILLED" and len(b.orders_received) == 1
    assert len(await b.open_positions()) == 1


@pytest.mark.asyncio
async def test_lost_ack_confirmed_absent_is_never_resent(journal):
    b, svc = setup(journal)
    await b.connect()
    b.fail_next = ["timeout_absent"]
    out = await svc.execute(buy(), snapshot())
    assert out.status == "ABSENT" and len(b.orders_received) == 1
    assert journal.get_order(out.client_order_id)["state"] == ABSENT
    assert (await svc.execute(buy(), snapshot())).status == "DUPLICATE"
    assert len(b.orders_received) == 1
    assert journal.active_locks(NOW) == []


class FlakyQueries(PaperBroker):
    """Order acks are lost and the follow-up queries fail too."""
    async def open_positions(self):
        if self.orders_received:
            raise BrokerError("connection reset")
        return await super().open_positions()


@pytest.mark.asyncio
async def test_inconclusive_check_locks_instead_of_assuming_failure(journal):
    b = FlakyQueries(spec(), balance=100_000)
    b.set_market([], [], quote())
    await b.connect()
    svc = ExecutionService(b, journal, clock=lambda: NOW, sleep=nosleep)
    b.fail_next = ["timeout_absent"]
    out = await svc.execute(buy(), snapshot())
    assert out.status == "UNKNOWN" and len(b.orders_received) == 1
    assert journal.get_order(out.client_order_id)["state"] == UNKNOWN
    assert [lk.kind for lk in journal.active_locks(NOW)] == ["reconciliation"]


@pytest.mark.asyncio
async def test_late_fill_is_adopted_by_reconciliation(journal):
    from app.models import OrderRequest
    from app.reconciliation import audit_positions
    b, svc = setup(journal)
    await b.connect()
    b.fail_next = ["timeout_absent"]
    out = await svc.execute(buy(), snapshot())
    assert out.status == "ABSENT"
    # ...then the order turns up at the broker after all
    await b.place_market_order(OrderRequest(
        client_order_id=out.client_order_id, symbol="XAUUSD", side="BUY", units=1,
        entry_reference=2650.3, stop_loss=2645, take_profit=2662))
    alerts = []
    issues = await audit_positions(b, journal, lambda m, **k: alerts.append(m))
    assert issues == [] and alerts
    assert journal.get_order(out.client_order_id)["state"] == FILLED


@pytest.mark.asyncio
async def test_fill_without_stop_is_closed_and_locks_the_bot(journal):
    b, svc = setup(journal)
    await b.connect()
    b.fail_next = ["no_stop"]
    await svc.execute(buy(), snapshot())
    assert await b.open_positions() == []
    assert [lk.kind for lk in journal.active_locks(NOW)] == ["reconciliation"]


@pytest.mark.asyncio
async def test_final_check_uses_fresh_market_data(journal):
    # The spread blew out between the AI decision and submission.
    b, svc = setup(journal, q=quote(bid=2650.0, ask=2651.5))
    await b.connect()
    out = await svc.execute(buy(), snapshot())
    assert out.status == "BLOCKED" and out.detail.startswith("spread")
    assert b.orders_received == []


@pytest.mark.asyncio
async def test_price_ran_through_the_stop_before_submission(journal):
    b, svc = setup(journal, q=quote(bid=2644.0, ask=2644.3))
    await b.connect()
    out = await svc.execute(buy(), snapshot())
    assert out.status == "BLOCKED" and "placement" in out.detail

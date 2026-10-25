import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/lib/db';
import {
  addOpportunity,
  closeWeek,
  ensureWeek,
  getSettings,
  logActivity,
  setStage,
} from '../src/lib/repo';
import { exportBackup, parseBackup, restoreBackup, clearAllData } from '../src/lib/backup';
import { hasDemoData, loadDemoData, removeDemoData } from '../src/lib/demo';
import { todayKey, weekStartOf, addDaysKey } from '../src/lib/dates';

beforeEach(async () => {
  await clearAllData();
});

describe('logging', () => {
  it('creates the current week on the first log and pre-fills band and area', async () => {
    const a = await logActivity({ type: 'seller_conversation' });
    const week = await db.weeks.get(a.weekId);
    expect(week?.weekStart).toBe(weekStartOf(todayKey()));
    expect(a.bandId).toBe(week?.bandId);
    expect(a.area).toBe(week?.area);
  });

  it('moving an opportunity to offer logs a submitted offer, once', async () => {
    const week = await ensureWeek(weekStartOf(todayKey()));
    const opp = await addOpportunity({ weekId: week.id, ref: '12 Oak St', kind: 'buyer', bandId: 'fam', area: 'Garsfontein', stage: 'viewing', nextAction: '', isTop3: true });
    const logged = await setStage(opp, 'offer');
    expect(logged?.outcome).toBe('submitted');
    expect(await setStage({ ...opp, stage: 'offer' }, 'offer')).toBeUndefined();
  });
});

describe('closing a week', () => {
  it('locks the week, snapshots it and carries unfinished opportunities forward', async () => {
    const start = '2026-10-12';
    const week = await ensureWeek(start);
    const open = await addOpportunity({ weekId: week.id, ref: 'A', kind: 'seller', bandId: 'fam', area: 'x', stage: 'lead', nextAction: 'call', isTop3: true, stalled: true });
    const won = await addOpportunity({ weekId: week.id, ref: 'B', kind: 'buyer', bandId: 'fam', area: 'x', stage: 'accepted', nextAction: '', isTop3: true });
    const next = await closeWeek(week.id);

    expect(next.weekStart).toBe(addDaysKey(start, 7));
    expect((await db.weeks.get(week.id))?.status).toBe('closed');
    const moved = await db.opportunities.get(open.id);
    expect(moved?.weekId).toBe(next.id);
    expect(moved?.carriedFromWeekId).toBe(week.id);
    expect(moved?.stalled).toBe(false);
    expect((await db.opportunities.get(won.id))?.weekId).toBe(week.id);
    const review = await db.reviews.where('weekId').equals(week.id).first();
    expect(review?.snapshot).toBeTruthy();
  });
});

describe('backup', () => {
  it('restoring a backup reproduces identical data', async () => {
    await getSettings();
    await loadDemoData();
    await logActivity({ type: 'viewing', preQualified: true, note: 'comma, "quote"' });
    const before = await exportBackup();
    const text = JSON.stringify(before);
    await clearAllData();
    await restoreBackup(parseBackup(text));
    const after = await exportBackup();
    expect(after.tables).toEqual(before.tables);
  });

  it('rejects files that are not backups', () => {
    expect(() => parseBackup('nope')).toThrow(/JSON/);
    expect(() => parseBackup('{"app":"other"}')).toThrow(/Agent Momentum/);
  });
});

describe('sample data', () => {
  it('loads 8 closed weeks and removes cleanly without touching real entries', async () => {
    await getSettings();
    await loadDemoData();
    expect(await hasDemoData()).toBe(true);
    expect(await db.weeks.where('status').equals('closed').count()).toBe(8);

    const real = await logActivity({ type: 'valuation' });
    await removeDemoData();
    expect(await hasDemoData()).toBe(false);
    expect(await db.activities.get(real.id)).toBeTruthy();
    expect(await db.weeks.get(real.weekId)).toBeTruthy();
    expect(await db.activities.count()).toBe(1);
  });
});

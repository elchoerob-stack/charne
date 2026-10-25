import {
  DEFAULT_AREAS,
  DEFAULT_BANDS,
  DEFAULT_REMINDERS,
  DEFAULT_TARGETS,
  REVIEW_READY_HOUR,
} from '../config';
import type {
  Activity,
  Buyer,
  Miss,
  Opportunity,
  OppStage,
  Review,
  Settings,
  Week,
} from '../types';
import { db } from './db';
import { addDaysKey, isoWeekday, localHour, localTimeOn, timeOf, todayKey, weekStartOf } from './dates';
import { computeWeekMetrics } from './metrics';

export function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export const nowIso = () => new Date().toISOString();

function stamp<T extends object>(rec: T): T & { id: string; createdAt: string; updatedAt: string } {
  const t = nowIso();
  return { id: uuid(), createdAt: t, updatedAt: t, ...rec };
}

// ─── Settings ───────────────────────────────────────────────────────────────

export function defaultSettings(): Settings {
  return {
    id: 'app',
    name: 'Charné',
    targets: { ...DEFAULT_TARGETS },
    bands: structuredClone(DEFAULT_BANDS),
    areas: [...DEFAULT_AREAS],
    workDays: [1, 2, 3, 4, 5],
    reminders: { ...DEFAULT_REMINDERS },
    defaultBandId: DEFAULT_BANDS[1].id,
    defaultArea: DEFAULT_BANDS[1].areas[0],
    theme: 'system',
    onboarded: false,
    hintsSeen: [],
    updatedAt: nowIso(),
  };
}

export async function getSettings(): Promise<Settings> {
  const s = await db.settings.get('app');
  if (s) return s;
  const fresh = defaultSettings();
  await db.settings.put(fresh);
  return fresh;
}

export async function updateSettings(patch: Partial<Settings>): Promise<void> {
  const s = await getSettings();
  await db.settings.put({ ...s, ...patch, id: 'app', updatedAt: nowIso() });
}

export async function markHintSeen(hint: string): Promise<void> {
  const s = await getSettings();
  if (!s.hintsSeen.includes(hint)) await updateSettings({ hintsSeen: [...s.hintsSeen, hint] });
}

// ─── Weeks ──────────────────────────────────────────────────────────────────

export async function getWeekByStart(weekStart: string): Promise<Week | undefined> {
  const w = await db.weeks.where('weekStart').equals(weekStart).first();
  return w && !w.deletedAt ? w : undefined;
}

/** Finds the week that starts on weekStart, creating it (in planning) if needed. */
export async function ensureWeek(weekStart: string): Promise<Week> {
  return db.transaction('rw', db.weeks, db.settings, async () => {
    const existing = await getWeekByStart(weekStart);
    if (existing) return existing;
    const s = await getSettings();
    const prev = (await db.weeks.where('weekStart').below(weekStart).reverse().toArray()).find((w) => !w.deletedAt);
    const week: Week = stamp({
      weekStart,
      area: prev?.area ?? s.defaultArea,
      bandId: prev?.bandId ?? s.defaultBandId,
      targets: { ...s.targets },
      status: 'planning' as const,
      mondayNote: '',
      reviewNotes: [],
    });
    await db.weeks.add(week);
    return week;
  });
}

export async function currentWeek(): Promise<Week> {
  return ensureWeek(weekStartOf(todayKey()));
}

export async function updateWeek(id: string, patch: Partial<Week>): Promise<void> {
  await db.weeks.update(id, { ...patch, updatedAt: nowIso() });
}

/** True from Friday 15:00 onwards (and all weekend). */
export function isReviewTime(now = new Date()): boolean {
  const day = isoWeekday(todayKey(now));
  return day > 5 || (day === 5 && localHour(now) >= REVIEW_READY_HOUR);
}

// ─── Activities ─────────────────────────────────────────────────────────────

export type NewActivity = Omit<Activity, 'id' | 'createdAt' | 'updatedAt' | 'weekId' | 'occurredAt'> & {
  occurredAt?: string;
};

export async function logActivity(input: NewActivity): Promise<Activity> {
  const occurredAt = input.occurredAt ?? nowIso();
  const week = await ensureWeek(weekStartOf(todayKey(new Date(occurredAt))));
  const rec: Activity = stamp({
    bandId: week.bandId,
    area: week.area,
    ...input,
    weekId: week.id,
    occurredAt,
  });
  if (input.type === 'offer' && !rec.outcome) rec.outcome = 'submitted';
  await db.activities.add(rec);
  return rec;
}

export async function updateActivity(id: string, patch: Partial<Activity>): Promise<void> {
  await db.activities.update(id, { ...patch, updatedAt: nowIso() });
}

/** Moves an entry to another day (keeping its time), and into that day's week. */
export async function moveActivityToDay(a: Activity, dayKey: string): Promise<void> {
  const occurredAt = localTimeOn(dayKey, timeOf(a.occurredAt)).toISOString();
  const week = await ensureWeek(weekStartOf(dayKey));
  await updateActivity(a.id, { occurredAt, weekId: week.id });
}

export async function deleteActivity(id: string): Promise<void> {
  const t = nowIso();
  await db.activities.update(id, { deletedAt: t, updatedAt: t });
}

export async function restoreActivity(id: string): Promise<void> {
  await db.activities.update(id, { deletedAt: undefined, updatedAt: nowIso() });
}

// ─── Opportunities ──────────────────────────────────────────────────────────

export async function addOpportunity(
  input: Omit<Opportunity, 'id' | 'createdAt' | 'updatedAt'>,
): Promise<Opportunity> {
  const rec = stamp(input) as Opportunity;
  await db.opportunities.add(rec);
  return rec;
}

export async function updateOpportunity(id: string, patch: Partial<Opportunity>): Promise<void> {
  await db.opportunities.update(id, { ...patch, updatedAt: nowIso() });
}

export async function deleteOpportunity(id: string): Promise<void> {
  const t = nowIso();
  await db.opportunities.update(id, { deletedAt: t, updatedAt: t });
}

/**
 * Moves an opportunity's stage. Reaching "offer" or "accepted" logs the
 * matching offer activity too, so she never has to record the same thing twice.
 * Returns the activity it logged, if any, so the caller can offer an undo.
 */
export async function setStage(opp: Opportunity, stage: OppStage): Promise<Activity | undefined> {
  await updateOpportunity(opp.id, { stage });
  const outcome = stage === 'offer' ? 'submitted' : stage === 'accepted' ? 'accepted' : undefined;
  if (!outcome || opp.stage === stage) return undefined;
  return logActivity({ type: 'offer', outcome, oppId: opp.id, ref: opp.ref, bandId: opp.bandId, area: opp.area });
}

/** Marks the next action done: clears it so the Week screen asks for the next one. */
export async function completeNextAction(id: string): Promise<void> {
  await updateOpportunity(id, { nextAction: '', dueDate: undefined });
}

/** Pushes the due date to the next work day. */
export async function rescheduleNextAction(opp: Opportunity, workDays: number[]): Promise<string> {
  const from = opp.dueDate && opp.dueDate > todayKey() ? opp.dueDate : todayKey();
  let next = addDaysKey(from, 1);
  for (let i = 0; i < 7 && !workDays.includes(isoWeekday(next)); i++) next = addDaysKey(next, 1);
  await updateOpportunity(opp.id, { dueDate: next });
  return next;
}

// ─── Buyers ─────────────────────────────────────────────────────────────────

export async function addBuyer(input: Omit<Buyer, 'id' | 'createdAt' | 'updatedAt'>): Promise<Buyer> {
  const rec = stamp(input) as Buyer;
  await db.buyers.add(rec);
  return rec;
}

export async function updateBuyer(id: string, patch: Partial<Buyer>): Promise<void> {
  await db.buyers.update(id, { ...patch, updatedAt: nowIso() });
}

export async function deleteBuyer(id: string): Promise<void> {
  const t = nowIso();
  await db.buyers.update(id, { deletedAt: t, updatedAt: t });
}

/** Copies last week's buyer list into this week, skipping refs already there. */
export async function copyBuyersFromPreviousWeek(week: Week): Promise<number> {
  const prev = (await db.weeks.where('weekStart').below(week.weekStart).reverse().toArray()).find((w) => !w.deletedAt);
  if (!prev) return 0;
  const [theirs, ours] = await Promise.all([
    db.buyers.where('weekId').equals(prev.id).filter((b) => !b.deletedAt).toArray(),
    db.buyers.where('weekId').equals(week.id).filter((b) => !b.deletedAt).toArray(),
  ]);
  const have = new Set(ours.map((b) => b.ref.trim().toLowerCase()));
  const toCopy = theirs.filter((b) => !have.has(b.ref.trim().toLowerCase()));
  for (const b of toCopy) {
    const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = b;
    await addBuyer({ ...rest, weekId: week.id });
  }
  return toCopy.length;
}

// ─── Reviews ────────────────────────────────────────────────────────────────

export async function getReview(weekId: string): Promise<Review | undefined> {
  return db.reviews.where('weekId').equals(weekId).first();
}

export async function saveReviewDraft(weekId: string, patch: { misses?: Miss[]; wins?: string[] }): Promise<void> {
  const existing = await getReview(weekId);
  if (existing) {
    await db.reviews.update(existing.id, { ...patch, updatedAt: nowIso() });
  } else {
    await db.reviews.add(
      stamp({ weekId, generatedAt: nowIso(), snapshot: null, misses: patch.misses ?? [], wins: patch.wins ?? [] }),
    );
  }
}

/**
 * Locks the week, stores a snapshot of its numbers, and moves every
 * unfinished opportunity into the following week. Returns the next week.
 */
export async function closeWeek(weekId: string): Promise<Week> {
  const week = await db.weeks.get(weekId);
  if (!week) throw new Error('Week not found');
  const settings = await getSettings();
  const next = await ensureWeek(addDaysKey(week.weekStart, 7));

  await db.transaction('rw', [db.weeks, db.activities, db.opportunities, db.reviews], async () => {
    const acts = await db.activities.where('weekId').equals(weekId).toArray();
    const snapshot = computeWeekMetrics(week, acts, settings.workDays, addDaysKey(week.weekStart, 6));
    const existing = await getReview(weekId);
    if (existing) {
      await db.reviews.update(existing.id, { snapshot, generatedAt: nowIso(), updatedAt: nowIso() });
    } else {
      await db.reviews.add(stamp({ weekId, generatedAt: nowIso(), snapshot, misses: [], wins: [] }));
    }

    const open = await db.opportunities
      .where('weekId')
      .equals(weekId)
      .filter((o) => !o.deletedAt && o.stage !== 'accepted' && o.stage !== 'lost')
      .toArray();
    for (const o of open) {
      await db.opportunities.update(o.id, {
        weekId: next.id,
        carriedFromWeekId: weekId,
        stalled: false,
        updatedAt: nowIso(),
      });
    }
    await db.weeks.update(weekId, { status: 'closed', closedAt: nowIso(), updatedAt: nowIso() });
  });
  return next;
}

export async function reopenWeek(weekId: string): Promise<void> {
  await db.weeks.update(weekId, { status: 'active', closedAt: undefined, updatedAt: nowIso() });
}

import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';
import { todayKey, weekStartOf } from '../lib/dates';
import { ensureWeek } from '../lib/repo';
import type { Activity, Buyer, Opportunity, Week } from '../types';

/** Today's day key in Johannesburg, kept fresh across midnight and app resumes. */
export function useToday(): string {
  const [today, setToday] = useState(todayKey());
  useEffect(() => {
    const tick = () => setToday(todayKey());
    const id = window.setInterval(tick, 60_000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, []);
  return today;
}

export function useSettings() {
  return useLiveQuery(() => db.settings.get('app'), []);
}

/** The week starting on weekStart, created on first use. */
export function useWeek(weekStart: string | undefined): Week | undefined {
  useEffect(() => {
    if (weekStart) void ensureWeek(weekStart);
  }, [weekStart]);
  return useLiveQuery(
    async () => {
      if (!weekStart) return undefined;
      const w = await db.weeks.where('weekStart').equals(weekStart).first();
      return w && !w.deletedAt ? w : undefined;
    },
    [weekStart],
  );
}

export function useCurrentWeek(): Week | undefined {
  const today = useToday();
  return useWeek(weekStartOf(today));
}

export function useWeekById(id: string | undefined): Week | undefined {
  return useLiveQuery(async () => (id ? db.weeks.get(id) : undefined), [id]);
}

export function useWeekActivities(weekId: string | undefined): Activity[] | undefined {
  return useLiveQuery(
    async () =>
      weekId
        ? (await db.activities.where('weekId').equals(weekId).toArray()).filter((a) => !a.deletedAt)
        : [],
    [weekId],
  );
}

export function useWeekOpportunities(weekId: string | undefined): Opportunity[] | undefined {
  return useLiveQuery(
    async () =>
      weekId
        ? (await db.opportunities.where('weekId').equals(weekId).toArray())
            .filter((o) => !o.deletedAt)
            .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        : [],
    [weekId],
  );
}

export function useWeekBuyers(weekId: string | undefined): Buyer[] | undefined {
  return useLiveQuery(
    async () =>
      weekId
        ? (await db.buyers.where('weekId').equals(weekId).toArray())
            .filter((b) => !b.deletedAt)
            .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.ref.localeCompare(b.ref, undefined, { numeric: true }))
        : [],
    [weekId],
  );
}

export function useAllWeeks(): Week[] | undefined {
  return useLiveQuery(async () => (await db.weeks.orderBy('weekStart').toArray()).filter((w) => !w.deletedAt), []);
}

export function useAllActivities(): Activity[] | undefined {
  return useLiveQuery(async () => (await db.activities.toArray()).filter((a) => !a.deletedAt), []);
}

export function useRecentActivities(limit = 20): Activity[] | undefined {
  return useLiveQuery(
    async () =>
      (await db.activities.orderBy('occurredAt').reverse().filter((a) => !a.deletedAt).limit(limit).toArray()),
    [limit],
  );
}

import type { Activity, ActivityType, Targets, Week } from '../src/types';
import { DEFAULT_TARGETS } from '../src/config';
import { localTimeOn, addDaysKey } from '../src/lib/dates';
import { computeWeekMetrics, type WeekMetrics } from '../src/lib/metrics';

let n = 0;
export const WORK = [1, 2, 3, 4, 5];

export function week(weekStart: string, targets: Targets = DEFAULT_TARGETS): Week {
  return {
    id: `w-${weekStart}`,
    createdAt: '',
    updatedAt: '',
    weekStart,
    area: 'Faerie Glen',
    bandId: 'fam',
    targets,
    status: 'closed',
    mondayNote: '',
    reviewNotes: [],
  };
}

export function act(w: Week, type: ActivityType, day = 0, extra: Partial<Activity> = {}): Activity {
  return {
    id: `a${++n}`,
    createdAt: '',
    updatedAt: '',
    weekId: w.id,
    type,
    occurredAt: localTimeOn(addDaysKey(w.weekStart, day), '10:00').toISOString(),
    bandId: w.bandId,
    area: w.area,
    ...extra,
  };
}

export function many(w: Week, type: ActivityType, count: number, extra: Partial<Activity> = {}): Activity[] {
  return Array.from({ length: count }, (_, i) => act(w, type, i % 5, extra));
}

/** A closed week's metrics from a recipe of counts. */
export function closedWeek(
  weekStart: string,
  c: Partial<Record<ActivityType, number>> & { accepted?: number },
  extra: Partial<Record<ActivityType, Partial<Activity>>> = {},
): WeekMetrics {
  const w = week(weekStart);
  const acts: Activity[] = [];
  for (const [type, count] of Object.entries(c)) {
    if (type === 'accepted') continue;
    acts.push(...many(w, type as ActivityType, count as number, extra[type as ActivityType]));
  }
  acts.push(...many(w, 'offer', c.accepted ?? 0, { outcome: 'accepted' }));
  return computeWeekMetrics(w, acts, WORK, addDaysKey(weekStart, 6));
}

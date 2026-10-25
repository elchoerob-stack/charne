import { ACTIVITIES, TARGET_KEYS, TARGET_TO_TYPE } from '../config';
import type { Activity, ActivityType, TargetKey, Targets, Week } from '../types';
import { dayKeyOf, isoWeekday, workDaysOfWeek, addDaysKey } from './dates';

// Pure functions only: no database, no clock. Everything the Today, Review
// and Insights screens show comes from here, and tests/metrics.test.ts pins it.

export type Counts = Record<ActivityType, number>;

export interface Yield {
  activities: number;
  offers: number;
  accepted: number;
}

export interface WeekMetrics {
  weekId: string;
  weekStart: string;
  counts: Counts;
  actual: Targets;
  targets: Targets;
  /** actual / target, uncapped; null when the target is 0. */
  attainment: Record<TargetKey, number | null>;
  /** Mean of the attainments, each capped at 100%. 0–1. */
  activityScore: number;
  offersSubmitted: number;
  offersAccepted: number;
  convToVal: number | null;
  valToMandate: number | null;
  viewingToOffer: number | null;
  offerToAccepted: number | null;
  /** Share of viewings marked pre-qualified, out of the viewings where it was answered. */
  preQualifiedRate: number | null;
  preQualifiedYes: number;
  preQualifiedAnswered: number;
  /** Share of mandates marked within comps, out of the mandates where it was answered. */
  withinCompsRate: number | null;
  withinCompsYes: number;
  withinCompsAnswered: number;
  byBand: Record<string, Yield>;
  byArea: Record<string, Yield>;
  activeDays: number;
  workDaysElapsed: number;
  consistency: number | null;
}

export function ratio(num: number, den: number): number | null {
  return den > 0 ? num / den : null;
}

export function emptyCounts(): Counts {
  return Object.fromEntries(ACTIVITIES.map((a) => [a.type, 0])) as Counts;
}

export function countByType(activities: Activity[]): Counts {
  const counts = emptyCounts();
  for (const a of activities) counts[a.type] += 1;
  return counts;
}

export function actualFromCounts(counts: Counts): Targets {
  return Object.fromEntries(TARGET_KEYS.map((k) => [k, counts[TARGET_TO_TYPE[k]]])) as Targets;
}

export function attainmentOf(actual: Targets, targets: Targets): Record<TargetKey, number | null> {
  return Object.fromEntries(TARGET_KEYS.map((k) => [k, ratio(actual[k], targets[k])])) as Record<
    TargetKey,
    number | null
  >;
}

export function activityScoreOf(attainment: Record<TargetKey, number | null>): number {
  const vals = TARGET_KEYS.map((k) => attainment[k]).filter((v): v is number => v != null);
  if (!vals.length) return 0;
  return vals.reduce((s, v) => s + Math.min(v, 1), 0) / vals.length;
}

const isOffer = (a: Activity) => a.type === 'offer';
const isSubmitted = (a: Activity) => isOffer(a) && (a.outcome ?? 'submitted') === 'submitted';
const isAccepted = (a: Activity) => isOffer(a) && a.outcome === 'accepted';

function addYield(map: Record<string, Yield>, key: string | undefined, a: Activity) {
  if (!key) return;
  const y = (map[key] ??= { activities: 0, offers: 0, accepted: 0 });
  y.activities += 1;
  if (isSubmitted(a)) y.offers += 1;
  if (isAccepted(a)) y.accepted += 1;
}

/**
 * @param asOfDay  Day key used to decide how many work days have elapsed.
 *                 Pass the week's last day (or later) for a closed week.
 */
export function computeWeekMetrics(
  week: Pick<Week, 'id' | 'weekStart' | 'targets'>,
  activities: Activity[],
  workDays: number[],
  asOfDay: string,
): WeekMetrics {
  const live = activities.filter((a) => !a.deletedAt && a.weekId === week.id);
  const counts = countByType(live);
  const actual = actualFromCounts(counts);
  const attainment = attainmentOf(actual, week.targets);

  const viewings = live.filter((a) => a.type === 'viewing');
  const vAnswered = viewings.filter((a) => a.preQualified != null);
  const mandates = live.filter((a) => a.type === 'mandate');
  const mAnswered = mandates.filter((a) => a.withinComps != null);

  const pqYes = vAnswered.filter((a) => a.preQualified).length;
  const wcYes = mAnswered.filter((a) => a.withinComps).length;
  const offersSubmitted = live.filter(isSubmitted).length;
  const offersAccepted = live.filter(isAccepted).length;

  const byBand: Record<string, Yield> = {};
  const byArea: Record<string, Yield> = {};
  for (const a of live) {
    addYield(byBand, a.bandId, a);
    addYield(byArea, a.area, a);
  }

  const workDayKeys = workDaysOfWeek(week.weekStart, workDays);
  const elapsed = workDayKeys.filter((d) => d <= asOfDay);
  const activeSet = new Set(live.map((a) => dayKeyOf(a.occurredAt)));
  const activeDays = elapsed.filter((d) => activeSet.has(d)).length;

  return {
    weekId: week.id,
    weekStart: week.weekStart,
    counts,
    actual,
    targets: week.targets,
    attainment,
    activityScore: activityScoreOf(attainment),
    offersSubmitted,
    offersAccepted,
    convToVal: ratio(actual.valuations, actual.conversations),
    valToMandate: ratio(actual.mandates, actual.valuations),
    viewingToOffer: ratio(offersSubmitted, actual.viewings),
    offerToAccepted: ratio(offersAccepted, offersSubmitted),
    preQualifiedRate: ratio(pqYes, vAnswered.length),
    preQualifiedYes: pqYes,
    preQualifiedAnswered: vAnswered.length,
    withinCompsRate: ratio(wcYes, mAnswered.length),
    withinCompsYes: wcYes,
    withinCompsAnswered: mAnswered.length,
    byBand,
    byArea,
    activeDays,
    workDaysElapsed: elapsed.length,
    consistency: ratio(activeDays, elapsed.length),
  };
}

/** Sums several weeks into one, recomputing every ratio from the sums. */
export function aggregate(weeks: WeekMetrics[]): WeekMetrics | null {
  if (!weeks.length) return null;
  const counts = emptyCounts();
  const targets = Object.fromEntries(TARGET_KEYS.map((k) => [k, 0])) as Targets;
  const byBand: Record<string, Yield> = {};
  const byArea: Record<string, Yield> = {};
  let offersSubmitted = 0;
  let offersAccepted = 0;
  let pqYes = 0;
  let pqAnswered = 0;
  let wcYes = 0;
  let wcAnswered = 0;
  let activeDays = 0;
  let elapsed = 0;

  const mergeYield = (into: Record<string, Yield>, from: Record<string, Yield>) => {
    for (const [k, y] of Object.entries(from)) {
      const t = (into[k] ??= { activities: 0, offers: 0, accepted: 0 });
      t.activities += y.activities;
      t.offers += y.offers;
      t.accepted += y.accepted;
    }
  };

  for (const w of weeks) {
    for (const t of ACTIVITIES) counts[t.type] += w.counts[t.type];
    for (const k of TARGET_KEYS) targets[k] += w.targets[k];
    offersSubmitted += w.offersSubmitted;
    offersAccepted += w.offersAccepted;
    pqAnswered += w.preQualifiedAnswered;
    pqYes += w.preQualifiedYes;
    wcAnswered += w.withinCompsAnswered;
    wcYes += w.withinCompsYes;
    activeDays += w.activeDays;
    elapsed += w.workDaysElapsed;
    mergeYield(byBand, w.byBand);
    mergeYield(byArea, w.byArea);
  }

  const actual = actualFromCounts(counts);
  const attainment = attainmentOf(actual, targets);
  return {
    weekId: weeks[weeks.length - 1].weekId,
    weekStart: weeks[0].weekStart,
    counts,
    actual,
    targets,
    attainment,
    activityScore: activityScoreOf(attainment),
    offersSubmitted,
    offersAccepted,
    convToVal: ratio(actual.valuations, actual.conversations),
    valToMandate: ratio(actual.mandates, actual.valuations),
    viewingToOffer: ratio(offersSubmitted, actual.viewings),
    offerToAccepted: ratio(offersAccepted, offersSubmitted),
    preQualifiedRate: ratio(pqYes, pqAnswered),
    preQualifiedYes: pqYes,
    preQualifiedAnswered: pqAnswered,
    withinCompsRate: ratio(wcYes, wcAnswered),
    withinCompsYes: wcYes,
    withinCompsAnswered: wcAnswered,
    byBand,
    byArea,
    activeDays,
    workDaysElapsed: elapsed,
    consistency: ratio(activeDays, elapsed),
  };
}

/**
 * Consecutive work days, counting back from today, with at least one logged
 * activity. Today doesn't break the streak until it's over, and days off
 * neither count nor break it.
 */
export function currentStreak(activeDays: Set<string>, today: string, workDays: number[]): number {
  let streak = 0;
  let day = today;
  for (let i = 0; i < 400; i++) {
    const isWork = workDays.includes(isoWeekday(day));
    if (isWork) {
      if (activeDays.has(day)) streak += 1;
      else if (day !== today) break;
    }
    day = addDaysKey(day, -1);
  }
  return streak;
}

/** Splits a weekly target over n days, front-loading any remainder. */
export function spread(target: number, n: number): number[] {
  if (n <= 0) return [];
  const base = Math.floor(target / n);
  const extra = target % n;
  return Array.from({ length: n }, (_, i) => base + (i < extra ? 1 : 0));
}

export interface TodayQuota {
  key: TargetKey;
  target: number;
  done: number;
  doneToday: number;
  /** What to aim for today so the week still lands. 0 on a day off. */
  aimToday: number;
}

export function todayQuotas(
  week: Pick<Week, 'id' | 'weekStart' | 'targets'>,
  activities: Activity[],
  workDays: number[],
  today: string,
): TodayQuota[] {
  const live = activities.filter((a) => !a.deletedAt && a.weekId === week.id);
  const workDayKeys = workDaysOfWeek(week.weekStart, workDays);
  const isWorkDay = workDayKeys.includes(today);
  const remainingDays = workDayKeys.filter((d) => d >= today).length;
  return TARGET_KEYS.map((key) => {
    const type = TARGET_TO_TYPE[key];
    const ofType = live.filter((a) => a.type === type);
    const doneToday = ofType.filter((a) => dayKeyOf(a.occurredAt) === today).length;
    const doneBefore = ofType.length - doneToday;
    const target = week.targets[key];
    const left = Math.max(0, target - doneBefore);
    const aimToday = isWorkDay && remainingDays > 0 ? Math.ceil(left / remainingDays) : 0;
    return { key, target, done: ofType.length, doneToday, aimToday };
  });
}

export interface DayCell {
  day: string;
  planned: number;
  done: number;
}

/** Mon–Fri (or whatever her work days are) grid: planned vs done per target. */
export function dayGrid(
  week: Pick<Week, 'id' | 'weekStart' | 'targets'>,
  activities: Activity[],
  workDays: number[],
): Record<TargetKey, DayCell[]> {
  const live = activities.filter((a) => !a.deletedAt && a.weekId === week.id);
  const days = workDaysOfWeek(week.weekStart, workDays);
  return Object.fromEntries(
    TARGET_KEYS.map((key) => {
      const planned = spread(week.targets[key], days.length);
      const type = TARGET_TO_TYPE[key];
      return [
        key,
        days.map((day, i) => ({
          day,
          planned: planned[i],
          done: live.filter((a) => a.type === type && dayKeyOf(a.occurredAt) === day).length,
        })),
      ];
    }),
  ) as Record<TargetKey, DayCell[]>;
}

export interface PersonalBest {
  id: string;
  label: string;
  value: number;
  display: string;
  weekId: string;
  weekStart: string;
}

type BestDef = { id: string; label: string; get: (m: WeekMetrics) => number; fmt: (v: number) => string };

export const BEST_DEFS: BestDef[] = [
  { id: 'score', label: 'Activity score', get: (m) => m.activityScore, fmt: (v) => `${Math.round(v * 100)}%` },
  { id: 'conversations', label: 'Seller conversations', get: (m) => m.actual.conversations, fmt: String },
  { id: 'valuations', label: 'Valuations', get: (m) => m.actual.valuations, fmt: String },
  { id: 'mandates', label: 'Mandates', get: (m) => m.actual.mandates, fmt: String },
  { id: 'viewings', label: 'Viewings', get: (m) => m.actual.viewings, fmt: String },
  { id: 'accepted', label: 'Offers accepted', get: (m) => m.offersAccepted, fmt: String },
];

/** Best week so far for each metric (earliest week wins a tie). Zero is never a best. */
export function personalBests(weeks: WeekMetrics[]): PersonalBest[] {
  const out: PersonalBest[] = [];
  for (const def of BEST_DEFS) {
    let best: WeekMetrics | null = null;
    for (const w of weeks) if (def.get(w) > 0 && (!best || def.get(w) > def.get(best))) best = w;
    if (best) {
      const value = def.get(best);
      out.push({ id: def.id, label: def.label, value, display: def.fmt(value), weekId: best.weekId, weekStart: best.weekStart });
    }
  }
  return out;
}

/** Metrics on which `latest` beats every earlier week. Needs at least one earlier week. */
export function newBests(latest: WeekMetrics, earlier: WeekMetrics[]): BestDef[] {
  if (!earlier.length) return [];
  return BEST_DEFS.filter((d) => d.get(latest) > 0 && earlier.every((w) => d.get(latest) > d.get(w)));
}

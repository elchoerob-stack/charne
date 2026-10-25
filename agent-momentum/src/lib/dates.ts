import { addDays, format, getISODay, parseISO, startOfWeek } from 'date-fns';
import { formatInTimeZone, toZonedTime } from 'date-fns-tz';
import { TIME_ZONE } from '../config';

// Day keys are plain 'yyyy-MM-dd' strings in Africa/Johannesburg. Once a
// moment has been turned into a day key, all arithmetic on it is calendar
// arithmetic, so it doesn't matter which time zone the phone thinks it's in.

export function dayKeyOf(moment: Date | string): string {
  return formatInTimeZone(moment, TIME_ZONE, 'yyyy-MM-dd');
}

export function todayKey(now: Date = new Date()): string {
  return dayKeyOf(now);
}

/** Hour of day (0–23) in Johannesburg. */
export function localHour(now: Date = new Date()): number {
  return toZonedTime(now, TIME_ZONE).getHours();
}

export function weekStartOf(dayKey: string): string {
  return format(startOfWeek(parseISO(dayKey), { weekStartsOn: 1 }), 'yyyy-MM-dd');
}

export function addDaysKey(dayKey: string, n: number): string {
  return format(addDays(parseISO(dayKey), n), 'yyyy-MM-dd');
}

/** 1 = Monday … 7 = Sunday */
export function isoWeekday(dayKey: string): number {
  return getISODay(parseISO(dayKey));
}

/** All seven days of the week starting at weekStart. */
export function daysOfWeek(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDaysKey(weekStart, i));
}

export function workDaysOfWeek(weekStart: string, workDays: number[]): string[] {
  return daysOfWeek(weekStart).filter((d) => workDays.includes(isoWeekday(d)));
}

export function formatDay(dayKey: string, pattern = 'EEE d MMM'): string {
  return format(parseISO(dayKey), pattern);
}

export function weekLabel(weekStart: string): string {
  const end = addDaysKey(weekStart, 6);
  const sameMonth = weekStart.slice(0, 7) === end.slice(0, 7);
  return sameMonth
    ? `${formatDay(weekStart, 'd')} – ${formatDay(end, 'd MMM yyyy')}`
    : `${formatDay(weekStart, 'd MMM')} – ${formatDay(end, 'd MMM yyyy')}`;
}

export function shortWeekLabel(weekStart: string): string {
  return formatDay(weekStart, 'd MMM');
}

/** "08:00" on a given day in Johannesburg, as a Date. SA has no daylight saving. */
export function localTimeOn(dayKey: string, hhmm: string): Date {
  return new Date(`${dayKey}T${hhmm}:00+02:00`);
}

export function timeOf(iso: string): string {
  return formatInTimeZone(iso, TIME_ZONE, 'HH:mm');
}

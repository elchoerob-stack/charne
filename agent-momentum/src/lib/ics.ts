import type { Reminders } from '../types';
import { addDaysKey, isoWeekday, todayKey } from './dates';

const DAY_CODES = ['', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];

function nextOn(weekday: number, from = todayKey()): string {
  let d = from;
  while (isoWeekday(d) !== weekday) d = addDaysKey(d, 1);
  return d;
}

function dt(dayKey: string, hhmm: string): string {
  return `${dayKey.replace(/-/g, '')}T${hhmm.replace(':', '')}00`;
}

function event(uid: string, summary: string, description: string, start: string, hhmm: string, byday: string[], minutes = 15): string[] {
  const [h, m] = hhmm.split(':').map(Number);
  const endMin = h * 60 + m + minutes;
  const end = `${String(Math.floor(endMin / 60) % 24).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}`;
  return [
    'BEGIN:VEVENT',
    `UID:${uid}@agent-momentum`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '')}`,
    `DTSTART;TZID=Africa/Johannesburg:${dt(start, hhmm)}`,
    `DTEND;TZID=Africa/Johannesburg:${dt(start, end)}`,
    `RRULE:FREQ=WEEKLY;BYDAY=${byday.join(',')}`,
    `SUMMARY:${summary}`,
    `DESCRIPTION:${description}`,
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `DESCRIPTION:${summary}`,
    'TRIGGER:PT0M',
    'END:VALARM',
    'END:VEVENT',
  ];
}

/** Three repeating reminders her phone calendar will handle for her. */
export function buildReminderIcs(r: Reminders, workDays: number[]): string {
  const weekdays = workDays.filter((d) => d !== 7).map((d) => DAY_CODES[d]);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Agent Momentum//Reminders//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VTIMEZONE',
    'TZID:Africa/Johannesburg',
    'BEGIN:STANDARD',
    'DTSTART:19700101T000000',
    'TZOFFSETFROM:+0200',
    'TZOFFSETTO:+0200',
    'TZNAME:SAST',
    'END:STANDARD',
    'END:VTIMEZONE',
    ...event('plan-week', 'Plan your week · Agent Momentum', 'Open Agent Momentum and plan the week (about 3 minutes).', nextOn(7), r.planSun, ['SU'], 20),
    ...event('daily-checkin', 'Daily check-in · Agent Momentum', 'Check today’s targets and due next steps.', nextOn(workDays[0] ?? 1), r.dailyAm, weekdays, 10),
    ...event('friday-review', 'Friday review · Agent Momentum', 'Your weekly review is ready. Fill in misses and close the week.', nextOn(5), r.reviewFri, ['FR'], 20),
    'END:VCALENDAR',
  ];
  return lines.join('\r\n') + '\r\n';
}

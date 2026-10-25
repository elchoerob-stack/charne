import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  AlertTriangle,
  CalendarCheck,
  Check,
  Clock,
  DatabaseBackup,
  FlaskConical,
  Flame,
  ListChecks,
  Settings as SettingsIcon,
  Sparkles,
} from 'lucide-react';
import { ACTIVITY_BY_TYPE, BACKUP_REMINDER_DAYS, TARGET_LABEL, TARGET_TO_TYPE } from '../config';
import type { Opportunity, Settings, Week } from '../types';
import { db } from '../lib/db';
import { addDaysKey, dayKeyOf, formatDay, isoWeekday, localHour, weekStartOf, workDaysOfWeek } from '../lib/dates';
import { computeWeekMetrics, currentStreak, todayQuotas } from '../lib/metrics';
import { pct, plural } from '../lib/format';
import { completeNextAction, isReviewTime, rescheduleNextAction } from '../lib/repo';
import { removeDemoData } from '../lib/demo';
import {
  useAllActivities,
  useCurrentWeek,
  useSettings,
  useToday,
  useWeek,
  useWeekActivities,
  useWeekOpportunities,
} from '../hooks/data';
import { useLongPress } from '../hooks/gestures';
import { buzz, useLog } from '../components/LogSheet';
import { Ring } from '../components/Ring';
import { SwipeRow } from '../components/SwipeRow';
import { useToast } from '../components/Toast';
import { Banner, Button, Card, IconButton, PageHeader, ProgressBar, SectionTitle, cx } from '../components/ui';
import { ACTIVITY_ICON } from '../components/ActivityIcon';
import type { TargetKey } from '../types';

function greeting(): string {
  const h = localHour();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

export function Today() {
  const settings = useSettings();
  const today = useToday();
  const week = useCurrentWeek();
  const acts = useWeekActivities(week?.id);
  const all = useAllActivities();
  const opps = useWeekOpportunities(week?.id);
  const log = useLog();

  if (!settings || !week || !acts) return <div className="h-dvh" />;

  const quotas = todayQuotas(week, acts, settings.workDays, today);
  const metrics = computeWeekMetrics(week, acts, settings.workDays, today);
  const streak = currentStreak(new Set((all ?? []).map((a) => dayKeyOf(a.occurredAt))), today, settings.workDays);
  const workDays = workDaysOfWeek(week.weekStart, settings.workDays);
  const dayIndex = workDays.indexOf(today);
  const isDayOff = dayIndex === -1;

  return (
    <div>
      <PageHeader
        subtitle={formatDay(today, 'EEEE d MMMM')}
        title={`${greeting()}, ${settings.name || 'there'}`}
        actions={
          <Link to="/settings" aria-label="Settings" className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-navy-50 dark:hover:bg-white/5">
            <SettingsIcon className="h-5 w-5" />
          </Link>
        }
      />

      <Prompts settings={settings} week={week} today={today} />

      <Card className="mt-3 overflow-hidden">
        <div className="bg-navy p-4 text-white dark:bg-navy-800">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-white/60">This week</p>
              <p className="mt-0.5 text-3xl font-bold tabular-nums">{pct(metrics.activityScore)}</p>
              <p className="text-xs text-white/70">of your plan done</p>
            </div>
            <div className="text-right">
              <div className="flex items-center justify-end gap-1.5 text-gold">
                <Flame className="h-5 w-5" aria-hidden />
                <span className="text-2xl font-bold tabular-nums">{streak}</span>
              </div>
              <p className="text-xs text-white/70">day streak</p>
            </div>
          </div>
          <ProgressBar value={metrics.activityScore} className="mt-3 bg-white/15 dark:bg-white/10" />
          <p className="mt-2 text-xs text-white/70">
            {isDayOff ? 'Day off — anything you log still counts.' : `Day ${dayIndex + 1} of ${workDays.length}`}
            {week.area && ` · ${week.area}`}
          </p>
        </div>

        <div className="grid grid-cols-3 gap-y-4 px-2 py-5">
          {quotas.map((q) => (
            <TargetRing key={q.key} k={q.key} done={q.done} target={q.target} doneToday={q.doneToday} aimToday={q.aimToday} />
          ))}
          <div className="flex flex-col items-center justify-center gap-2 px-1">
            <ExtraButton type="offer" />
            <ExtraButton type="follow_up" />
          </div>
        </div>
        <p className="border-t border-slate-100 px-4 py-2.5 text-center text-xs text-slate-500 dark:border-white/5 dark:text-slate-400">
          Tap a ring to log one · press and hold to add details
        </p>
      </Card>

      <DueList opps={opps ?? []} today={today} settings={settings} />

      <div className="mt-6">
        <Button variant="secondary" block size="lg" onClick={() => log.open()}>
          Log something else
        </Button>
      </div>
    </div>
  );
}

function TargetRing({ k, done, target, doneToday, aimToday }: { k: TargetKey; done: number; target: number; doneToday: number; aimToday: number }) {
  const log = useLog();
  const type = TARGET_TO_TYPE[k];
  const meta = ACTIVITY_BY_TYPE[type];
  const press = useLongPress(
    () => void log.quickLog(type),
    () => {
      buzz();
      log.open({ type });
    },
  );
  const met = target > 0 && done >= target;
  return (
    <button
      type="button"
      aria-label={`${TARGET_LABEL[k]}: ${done} of ${target}. Tap to log one, hold for details.`}
      className="flex select-none flex-col items-center gap-1.5 rounded-2xl py-1 [-webkit-touch-callout:none] active:scale-95"
      {...press}
    >
      <Ring value={target ? done / target : 0} color={meta.color}>
        {met ? (
          <Check className="h-7 w-7" style={{ color: meta.color }} strokeWidth={3} aria-hidden />
        ) : (
          <span className="text-lg font-bold tabular-nums leading-none">
            {done}
            <span className="text-xs font-medium text-slate-400">/{target}</span>
          </span>
        )}
      </Ring>
      <span className="text-xs font-semibold leading-tight">{meta.short}</span>
      <span className={cx('text-[11px] leading-tight', doneToday >= aimToday && aimToday > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-400')}>
        {aimToday > 0 ? `Today ${doneToday} of ${aimToday}` : met ? 'Target met' : doneToday ? `Today ${doneToday}` : ' '}
      </span>
    </button>
  );
}

function ExtraButton({ type }: { type: 'offer' | 'follow_up' }) {
  const log = useLog();
  const meta = ACTIVITY_BY_TYPE[type];
  const Icon = ACTIVITY_ICON[type];
  const press = useLongPress(
    () => void log.quickLog(type),
    () => log.open({ type }),
  );
  return (
    <button
      type="button"
      aria-label={`Log ${meta.noun}. Hold for details.`}
      className="flex min-h-[44px] w-full select-none items-center justify-center gap-1.5 rounded-xl bg-slate-100 px-2 text-xs font-semibold [-webkit-touch-callout:none] active:scale-95 dark:bg-navy-800"
      {...press}
    >
      <Icon className="h-4 w-4" style={{ color: meta.color }} aria-hidden />+ {meta.short.replace(/s$/, '')}
    </button>
  );
}

function Prompts({ settings, week, today }: { settings: Settings; week: Week; today: string }) {
  const navigate = useNavigate();
  const toast = useToast();
  const isSunday = isoWeekday(today) === 7;
  const nextWeek = useWeek(isSunday ? addDaysKey(weekStartOf(today), 7) : undefined);
  const lastWeekStart = addDaysKey(week.weekStart, -7);
  const lastWeek = useLiveQuery(() => db.weeks.where('weekStart').equals(lastWeekStart).first(), [lastWeekStart]);
  const lastWeekHasData = useLiveQuery(
    async () => (lastWeek ? (await db.activities.where('weekId').equals(lastWeek.id).count()) > 0 : false),
    [lastWeek?.id],
  );
  const isDemo = useLiveQuery(async () => (await db.weeks.filter((w) => !!w.isDemo).count()) > 0, []);
  const hasAnyData = useLiveQuery(async () => (await db.activities.count()) > 0, []);

  const prompts: JSX.Element[] = [];

  if (isDemo) {
    prompts.push(
      <Banner
        key="demo"
        tone="slate"
        icon={FlaskConical}
        title="You’re looking at sample data"
        action={
          <Button
            size="sm"
            variant="secondary"
            onClick={async () => {
              await removeDemoData();
              toast.show('Sample data removed');
            }}
          >
            Remove sample data
          </Button>
        }
      >
        Explore freely. Anything you log yourself is kept when you remove it.
      </Banner>,
    );
  }

  if (lastWeek && lastWeek.status !== 'closed' && lastWeekHasData) {
    prompts.push(
      <Banner
        key="close-last"
        icon={AlertTriangle}
        title="Last week isn’t closed yet"
        action={<Button size="sm" onClick={() => navigate(`/review?week=${lastWeek.id}`)}>Review & close</Button>}
      >
        Closing it locks the numbers and moves unfinished deals into this week.
      </Banner>,
    );
  }

  if (isSunday && nextWeek && nextWeek.status === 'planning') {
    prompts.push(
      <Banner key="plan-next" tone="navy" icon={CalendarCheck} title="Plan next week" action={<Button size="sm" variant="gold" onClick={() => navigate(`/plan?week=${nextWeek.weekStart}`)}>Plan now · 3 min</Button>}>
        Set your area, targets, buyers and top 3 deals before Monday.
      </Banner>,
    );
  } else if (week.status === 'planning') {
    prompts.push(
      <Banner key="plan" tone="navy" icon={CalendarCheck} title="Plan your week" action={<Button size="sm" variant="gold" onClick={() => navigate('/plan')}>Plan now · 3 min</Button>}>
        Five quick steps. You can log activity before you plan — it all counts.
      </Banner>,
    );
  }

  if (week.status !== 'closed' && isReviewTime()) {
    prompts.push(
      <Banner key="review" icon={Sparkles} title="Your Friday review is ready" action={<Button size="sm" onClick={() => navigate('/review')}>Open review</Button>}>
        Takes about a minute. It’s ready to share for Monday’s meeting.
      </Banner>,
    );
  }

  const daysSinceBackup = settings.lastBackupAt ? (Date.now() - Date.parse(settings.lastBackupAt)) / 86_400_000 : Infinity;
  if (hasAnyData && !isDemo && daysSinceBackup > BACKUP_REMINDER_DAYS) {
    prompts.push(
      <Banner key="backup" tone="slate" icon={DatabaseBackup} title="Time for a backup" action={<Button size="sm" variant="secondary" onClick={() => navigate('/settings#backup')}>Back up now</Button>}>
        Your data lives only on this phone. A backup takes one tap.
      </Banner>,
    );
  }

  if (!prompts.length) return null;
  return <div className="mt-2 space-y-2">{prompts}</div>;
}

function DueList({ opps, today, settings }: { opps: Opportunity[]; today: string; settings: Settings }) {
  const toast = useToast();
  const navigate = useNavigate();
  const due = useMemo(
    () =>
      opps
        .filter((o) => o.nextAction && o.dueDate && o.dueDate <= today && o.stage !== 'accepted' && o.stage !== 'lost')
        .sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? '')),
    [opps, today],
  );
  const upcoming = opps.filter((o) => o.nextAction && o.dueDate && o.dueDate > today).length;

  return (
    <>
      <SectionTitle action={due.length > 0 ? <span className="text-xs text-slate-500">Swipe → done · ← later</span> : undefined}>
        Due today {due.length > 0 && `· ${due.length}`}
      </SectionTitle>
      {due.length === 0 ? (
        <Card className="flex items-center gap-3 p-4">
          <ListChecks className="h-6 w-6 shrink-0 text-slate-400" aria-hidden />
          <p className="flex-1 text-sm text-slate-500 dark:text-slate-400">
            Nothing due.{' '}
            {upcoming ? `${plural(upcoming, 'next step')} coming up this week.` : 'Next steps on your top deals show up here.'}
          </p>
          <Button size="sm" variant="ghost" onClick={() => navigate('/week')}>
            Open week
          </Button>
        </Card>
      ) : (
        <ul className="space-y-2">
          {due.map((o) => {
            const overdue = (o.dueDate ?? '') < today;
            const done = async () => {
              buzz();
              const before = { nextAction: o.nextAction, dueDate: o.dueDate };
              await completeNextAction(o.id);
              toast.show(`Done: ${o.nextAction}`, {
                actions: [
                  { label: 'Undo', onClick: () => void db.opportunities.update(o.id, before) },
                  { label: 'Set next step', onClick: () => navigate(`/week#opp-${o.id}`) },
                ],
                duration: 8000,
              });
            };
            const later = async () => {
              const next = await rescheduleNextAction(o, settings.workDays);
              toast.show(`Moved to ${formatDay(next, 'EEEE')}`, {
                actions: [{ label: 'Undo', onClick: () => void db.opportunities.update(o.id, { dueDate: o.dueDate }) }],
              });
            };
            return (
              <li key={o.id}>
                <SwipeRow onDone={done} onLater={later}>
                  <div className="flex items-center gap-2 p-3">
                    <div className="min-w-0 flex-1 pl-1">
                      <p className="truncate text-sm font-semibold">{o.nextAction}</p>
                      <p className={cx('truncate text-xs', overdue ? 'font-medium text-red-600 dark:text-red-400' : 'text-slate-500')}>
                        {o.ref}
                        {overdue ? ` · overdue since ${formatDay(o.dueDate!, 'EEE d MMM')}` : ' · today'}
                      </p>
                    </div>
                    <IconButton icon={Clock} label="Move to next work day" onClick={later} className="text-amber-600" />
                    <IconButton icon={Check} label="Mark done" onClick={done} className="bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10" />
                  </div>
                </SwipeRow>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

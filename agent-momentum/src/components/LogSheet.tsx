import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Check, Lock, Trash2, Undo2 } from 'lucide-react';
import { ACTIVITIES, ACTIVITY_BY_TYPE, REF_HINT, UNDO_MS } from '../config';
import type { Activity, ActivityType } from '../types';
import { db } from '../lib/db';
import { addDaysKey, dayKeyOf, formatDay, timeOf, weekStartOf } from '../lib/dates';
import { parseRand, rand } from '../lib/format';
import { deleteActivity, logActivity, moveActivityToDay, restoreActivity, updateActivity } from '../lib/repo';
import { useCurrentWeek, useRecentActivities, useSettings, useToday, useWeekActivities, useWeekOpportunities } from '../hooks/data';
import { ACTIVITY_ICON } from './ActivityIcon';
import { Sheet } from './Sheet';
import { useToast } from './Toast';
import { Button, Chip, cx, YesNo } from './ui';

// "Log first, details later": choosing a type saves the entry immediately
// (2 taps from anywhere), then the sheet offers optional details for it.

interface LogApi {
  /** Open the sheet. With a type, logs one straight away and shows its details. */
  open: (opts?: { type?: ActivityType; activityId?: string }) => void;
  /** Log one without opening anything; shows an Undo / Details snackbar. */
  quickLog: (type: ActivityType) => Promise<void>;
}

const Ctx = createContext<LogApi>({ open: () => {}, quickLog: async () => {} });
export const useLog = () => useContext(Ctx);

export function buzz() {
  try {
    navigator.vibrate?.(12);
  } catch {
    /* not supported */
  }
}

export function LogProvider({ children }: { children: ReactNode }) {
  const [isOpen, setOpen] = useState(false);
  const [activityId, setActivityId] = useState<string | undefined>();
  const [justLogged, setJustLogged] = useState(false);
  const toast = useToast();

  const logAndShow = useCallback(async (type: ActivityType) => {
    const a = await logActivity({ type });
    buzz();
    setActivityId(a.id);
    setJustLogged(true);
  }, []);

  const open = useCallback<LogApi['open']>(
    (opts) => {
      setOpen(true);
      setJustLogged(false);
      setActivityId(opts?.activityId);
      if (opts?.type) void logAndShow(opts.type);
    },
    [logAndShow],
  );

  const quickLog = useCallback<LogApi['quickLog']>(
    async (type) => {
      const a = await logActivity({ type });
      buzz();
      const meta = ACTIVITY_BY_TYPE[type];
      toast.show(`Logged 1 ${meta.noun}`, {
        duration: UNDO_MS,
        actions: [
          {
            label: 'Undo',
            onClick: () => {
              void deleteActivity(a.id);
            },
          },
          {
            label: 'Details',
            onClick: () => {
              setOpen(true);
              setActivityId(a.id);
              setJustLogged(true);
            },
          },
        ],
      });
    },
    [toast],
  );

  const close = useCallback(() => {
    setOpen(false);
    setActivityId(undefined);
  }, []);

  return (
    <Ctx.Provider value={{ open, quickLog }}>
      {children}
      <LogSheetView
        open={isOpen}
        activityId={activityId}
        justLogged={justLogged}
        onPick={logAndShow}
        onEdit={(id) => {
          setActivityId(id);
          setJustLogged(false);
        }}
        onBack={() => setActivityId(undefined)}
        onClose={close}
      />
    </Ctx.Provider>
  );
}

function LogSheetView({
  open,
  activityId,
  justLogged,
  onPick,
  onEdit,
  onBack,
  onClose,
}: {
  open: boolean;
  activityId?: string;
  justLogged: boolean;
  onPick: (t: ActivityType) => void;
  onEdit: (id: string) => void;
  onBack: () => void;
  onClose: () => void;
}) {
  const activity = useLiveQuery(async () => (activityId ? db.activities.get(activityId) : undefined), [activityId]);
  const showDetails = !!activityId;
  const title = showDetails ? (activity ? ACTIVITY_BY_TYPE[activity.type].label : 'Log activity') : 'Log activity';

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      footer={
        showDetails ? (
          <div className="flex gap-2">
            <Button variant="secondary" size="lg" onClick={onBack} className="flex-1">
              Log another
            </Button>
            <Button size="lg" icon={Check} onClick={onClose} className="flex-1">
              Done
            </Button>
          </div>
        ) : undefined
      }
    >
      {showDetails ? (
        activity ? (
          <DetailsPanel key={activity.id} activity={activity} justLogged={justLogged} onDeleted={onBack} />
        ) : (
          <div className="h-64" />
        )
      ) : (
        <PickPanel onPick={onPick} onEdit={onEdit} />
      )}
    </Sheet>
  );
}

function PickPanel({ onPick, onEdit }: { onPick: (t: ActivityType) => void; onEdit: (id: string) => void }) {
  const week = useCurrentWeek();
  const acts = useWeekActivities(week?.id);
  const recent = useRecentActivities(20);
  const counts = useMemo(() => {
    const c: Partial<Record<ActivityType, number>> = {};
    for (const a of acts ?? []) c[a.type] = (c[a.type] ?? 0) + 1;
    return c;
  }, [acts]);

  return (
    <div>
      <p className="mb-3 text-sm text-slate-500 dark:text-slate-400">Tap what you just did. It’s saved straight away — details are optional.</p>
      <div className="grid grid-cols-2 gap-2.5">
        {ACTIVITIES.map((m) => {
          const Icon = ACTIVITY_ICON[m.type];
          const target = m.targetKey && week ? week.targets[m.targetKey] : undefined;
          return (
            <button
              key={m.type}
              type="button"
              onClick={() => onPick(m.type)}
              className="card flex min-h-[76px] items-center gap-3 p-3 text-left transition active:scale-[0.97]"
            >
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white" style={{ backgroundColor: m.color }}>
                <Icon className="h-5 w-5" aria-hidden />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold leading-tight">{m.label}</span>
                <span className="block text-xs text-slate-500 dark:text-slate-400">
                  {counts[m.type] ?? 0}
                  {target != null ? ` of ${target}` : ''} this week
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <h3 className="mb-2 mt-6 text-xs font-semibold uppercase tracking-wider text-slate-500">Recent</h3>
      {recent && recent.length === 0 && <p className="py-4 text-center text-sm text-slate-500">Nothing logged yet.</p>}
      <ul className="card divide-y divide-slate-100 dark:divide-white/5">
        {recent?.map((a) => (
          <li key={a.id}>
            <button type="button" onClick={() => onEdit(a.id)} className="flex min-h-[52px] w-full items-center gap-3 px-3 py-2 text-left">
              <ActivityDot type={a.type} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {ACTIVITY_BY_TYPE[a.type].label}
                  {a.outcome && <span className="font-normal text-slate-500"> · {outcomeLabel(a)}</span>}
                </span>
                <span className="block truncate text-xs text-slate-500">
                  {[a.ref, a.area].filter(Boolean).join(' · ') || 'No details'}
                </span>
              </span>
              <span className="shrink-0 text-xs text-slate-400">{whenLabel(a.occurredAt)}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ActivityDot({ type, size = 32 }: { type: ActivityType; size?: number }) {
  const Icon = ACTIVITY_ICON[type];
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-lg text-white"
      style={{ backgroundColor: ACTIVITY_BY_TYPE[type].color, width: size, height: size }}
    >
      <Icon className="h-4 w-4" aria-hidden />
    </span>
  );
}

export function outcomeLabel(a: Activity): string {
  return ACTIVITY_BY_TYPE[a.type].outcomes.find((o) => o.value === a.outcome)?.label ?? '';
}

function whenLabel(iso: string): string {
  const d = dayKeyOf(iso);
  const today = dayKeyOf(new Date());
  if (d === today) return timeOf(iso);
  if (d === addDaysKey(today, -1)) return 'Yesterday';
  return formatDay(d, 'EEE d MMM');
}

function DetailsPanel({ activity: a, justLogged, onDeleted }: { activity: Activity; justLogged: boolean; onDeleted: () => void }) {
  const settings = useSettings();
  const today = useToday();
  const toast = useToast();
  const meta = ACTIVITY_BY_TYPE[a.type];
  const week = useLiveQuery(() => db.weeks.get(a.weekId), [a.weekId]);
  const opps = useWeekOpportunities(a.weekId);
  const locked = week?.status === 'closed';

  const [ref, setRef] = useState(a.ref ?? '');
  const [note, setNote] = useState(a.note ?? '');
  const [amount, setAmount] = useState(a.amount != null ? rand(a.amount).replace(/^R/, '') : '');
  const pending = useRef<Partial<Activity>>({});
  const timer = useRef<number>();

  const flush = useCallback(() => {
    window.clearTimeout(timer.current);
    if (Object.keys(pending.current).length) {
      void updateActivity(a.id, pending.current);
      pending.current = {};
    }
  }, [a.id]);
  useEffect(() => flush, [flush]);

  const saveSoon = (patch: Partial<Activity>) => {
    pending.current = { ...pending.current, ...patch };
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, 400);
  };
  const saveNow = (patch: Partial<Activity>) => void updateActivity(a.id, patch);

  const band = settings?.bands.find((b) => b.id === a.bandId);
  const areaChoices = useMemo(() => {
    const first = band?.areas ?? [];
    const rest = (settings?.areas ?? []).filter((x) => !first.includes(x));
    return [...first, ...rest];
  }, [band, settings?.areas]);

  const day = dayKeyOf(a.occurredAt);
  const remove = async () => {
    flush();
    await deleteActivity(a.id);
    toast.show(`Deleted ${meta.noun}`, { actions: [{ label: 'Undo', onClick: () => void restoreActivity(a.id) }], duration: UNDO_MS });
    onDeleted();
  };

  return (
    <fieldset disabled={locked} className="min-w-0 space-y-5">
      {justLogged && (
        <div className="flex items-center gap-3 rounded-2xl bg-emerald-50 p-3 ring-1 ring-emerald-200 dark:bg-emerald-500/10 dark:ring-emerald-500/30">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-500 text-white">
            <Check className="h-5 w-5" />
          </span>
          <p className="flex-1 text-sm">
            <span className="font-semibold">Logged.</span> Add details below if you like.
          </p>
          <button type="button" onClick={remove} className="flex min-h-[40px] items-center gap-1 rounded-lg px-2 text-sm font-semibold text-emerald-700 dark:text-emerald-300">
            <Undo2 className="h-4 w-4" /> Undo
          </button>
        </div>
      )}
      {locked && (
        <div className="flex items-center gap-2 rounded-xl bg-slate-100 p-3 text-sm dark:bg-navy-800">
          <Lock className="h-4 w-4" /> This week is closed. Reopen it from Review to change entries.
        </div>
      )}
      {meta.hint && <p className="text-sm text-slate-500 dark:text-slate-400">{meta.hint}</p>}

      <div>
        <span className="label">Outcome</span>
        <div className="flex flex-wrap gap-2">
          {meta.outcomes.map((o) => (
            <Chip key={o.value} active={a.outcome === o.value} onClick={() => saveNow({ outcome: a.outcome === o.value ? undefined : o.value })}>
              {o.label}
            </Chip>
          ))}
        </div>
      </div>

      {meta.check && (
        <YesNo label={meta.check.label} value={a[meta.check.field]} onChange={(v) => saveNow({ [meta.check!.field]: v })} />
      )}

      {meta.amountLabel && (
        <div>
          <label className="label" htmlFor="amount">
            {meta.amountLabel} <span className="font-normal text-slate-400">(optional)</span>
          </label>
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">R</span>
            <input
              id="amount"
              className="input pl-7"
              inputMode="decimal"
              placeholder="1 650 000 or 1.65m"
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
                saveSoon({ amount: parseRand(e.target.value) });
              }}
              onBlur={() => {
                flush();
                const c = parseRand(amount);
                if (c != null) setAmount(rand(c).replace(/^R/, ''));
              }}
            />
          </div>
        </div>
      )}

      <div>
        <span className="label">When</span>
        <div className="flex flex-wrap gap-2">
          <Chip active={day === today} onClick={() => void moveActivityToDay(a, today)}>
            Today
          </Chip>
          <Chip active={day === addDaysKey(today, -1)} onClick={() => void moveActivityToDay(a, addDaysKey(today, -1))}>
            Yesterday
          </Chip>
          <label className={cx('inline-flex min-h-[40px] items-center rounded-full border px-3 text-sm', day < addDaysKey(today, -1) ? 'border-navy bg-navy text-white dark:border-gold dark:bg-gold dark:text-navy-950' : 'border-slate-200 bg-white dark:border-white/10 dark:bg-navy-800')}>
            <span className="sr-only">Pick a day</span>
            <input
              type="date"
              className="bg-transparent text-sm outline-none"
              value={day}
              max={today}
              onChange={(e) => e.target.value && void moveActivityToDay(a, e.target.value)}
            />
          </label>
        </div>
        {weekStartOf(day) !== weekStartOf(today) && <p className="hint">Counts toward the week of {formatDay(weekStartOf(day), 'd MMM')}.</p>}
      </div>

      {settings && (
        <div>
          <span className="label">Price band</span>
          <div className="flex flex-wrap gap-2">
            {settings.bands.map((b) => (
              <Chip key={b.id} active={a.bandId === b.id} onClick={() => saveNow({ bandId: b.id })}>
                {b.label}
              </Chip>
            ))}
          </div>
        </div>
      )}

      <div>
        <span className="label">Area</span>
        <div className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1">
          {areaChoices.map((x) => (
            <Chip key={x} active={a.area === x} onClick={() => saveNow({ area: x })} className="shrink-0">
              {x}
            </Chip>
          ))}
        </div>
      </div>

      {opps && opps.length > 0 && (
        <div>
          <span className="label">Linked to</span>
          <div className="flex flex-wrap gap-2">
            {opps.map((o) => (
              <Chip
                key={o.id}
                active={a.oppId === o.id}
                onClick={() => saveNow(a.oppId === o.id ? { oppId: undefined } : { oppId: o.id, ref: a.ref || o.ref })}
              >
                {o.ref}
              </Chip>
            ))}
          </div>
        </div>
      )}

      <div>
        <label className="label" htmlFor="ref">
          Reference <span className="font-normal text-slate-400">(optional)</span>
        </label>
        <input
          id="ref"
          className="input"
          placeholder="e.g. 12 Oak St or Buyer B3"
          value={ref}
          onChange={(e) => {
            setRef(e.target.value);
            saveSoon({ ref: e.target.value || undefined });
          }}
          onBlur={flush}
        />
        <p className="hint">{REF_HINT}</p>
      </div>

      <div>
        <label className="label" htmlFor="note">
          Note <span className="font-normal text-slate-400">(optional)</span>
        </label>
        <textarea
          id="note"
          className="input min-h-[80px] py-2"
          placeholder="Anything worth remembering"
          value={note}
          onChange={(e) => {
            setNote(e.target.value);
            saveSoon({ note: e.target.value || undefined });
          }}
          onBlur={flush}
        />
        <p className="hint">No client names or numbers, please.</p>
      </div>

      {!justLogged && !locked && (
        <button type="button" onClick={remove} className="flex min-h-[44px] items-center gap-2 text-sm font-medium text-red-600">
          <Trash2 className="h-4 w-4" /> Delete this entry
        </button>
      )}
    </fieldset>
  );
}

import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { CalendarCheck, Pencil, Plus, Star, Tag, Users } from 'lucide-react';
import { ACTIVITY_BY_TYPE, FUNDING_LABEL, STAGES, TARGET_KEYS, TARGET_TO_TYPE } from '../config';
import type { Buyer, Opportunity, OppStage, Settings, Week } from '../types';
import { formatDay, weekLabel } from '../lib/dates';
import { dayGrid } from '../lib/metrics';
import { randShort } from '../lib/format';
import { deleteActivity, setStage } from '../lib/repo';
import { useCurrentWeek, useSettings, useToday, useWeekActivities, useWeekBuyers, useWeekOpportunities } from '../hooks/data';
import { BuyerSheet, dueLabel, fundingTone, nextBuyerRef, OppSheet } from '../components/Editors';
import { useToast } from '../components/Toast';
import { Banner, Button, Card, cx, EmptyState, PageHeader, SectionTitle } from '../components/ui';
import { ACTIVITY_ICON } from '../components/ActivityIcon';

export function WeekScreen() {
  const settings = useSettings();
  const week = useCurrentWeek();
  const acts = useWeekActivities(week?.id);
  const opps = useWeekOpportunities(week?.id);
  const buyers = useWeekBuyers(week?.id);
  const navigate = useNavigate();
  const location = useLocation();
  const [editingOpp, setEditingOpp] = useState<Opportunity | 'new' | null>(null);
  const [editingBuyer, setEditingBuyer] = useState<Buyer | 'new' | null>(null);

  // Deep link from Today's "Set next step": /week#opp-<id>
  useEffect(() => {
    const id = location.hash.startsWith('#opp-') ? location.hash.slice(5) : null;
    const o = id && opps?.find((x) => x.id === id);
    if (o) {
      setEditingOpp(o);
      navigate('/week', { replace: true });
    }
  }, [location.hash, opps, navigate]);

  if (!settings || !week || !acts || !opps || !buyers) return <div className="h-dvh" />;

  const band = settings.bands.find((b) => b.id === week.bandId);
  const open = opps.filter((o) => o.stage !== 'accepted' && o.stage !== 'lost');
  const top = open.filter((o) => o.isTop3);
  const others = open.filter((o) => !o.isTop3 && !(o.kind === 'listing' && o.stalled));
  const stalled = open.filter((o) => o.kind === 'listing' && o.stalled);
  const finished = opps.filter((o) => o.stage === 'accepted' || o.stage === 'lost');

  return (
    <div>
      <PageHeader
        subtitle={weekLabel(week.weekStart)}
        title="This week"
        actions={
          <Button size="sm" variant="secondary" icon={Pencil} onClick={() => navigate('/plan')}>
            Edit plan
          </Button>
        }
      />

      {week.status === 'planning' && (
        <div className="mt-2">
          <Banner tone="navy" icon={CalendarCheck} title="This week isn’t planned yet" action={<Button size="sm" variant="gold" onClick={() => navigate('/plan')}>Plan now · 3 min</Button>}>
            Pick your focus, buyers and top 3 deals.
          </Banner>
        </div>
      )}

      <Card className="mt-3 flex items-center justify-between p-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-slate-500">Focus</p>
          <p className="font-semibold">{week.area}</p>
          <p className="text-sm text-slate-500">
            {band?.label} · {band?.description}
          </p>
        </div>
        <span
          className={cx(
            'rounded-full px-3 py-1 text-xs font-semibold',
            week.status === 'closed' ? 'bg-slate-100 text-slate-600' : week.status === 'active' ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300' : 'bg-amber-50 text-amber-700',
          )}
        >
          {week.status === 'closed' ? 'Closed' : week.status === 'active' ? 'Planned' : 'Not planned'}
        </span>
      </Card>

      <SectionTitle>Day by day</SectionTitle>
      <DayGrid week={week} settings={settings} acts={acts} />

      <SectionTitle action={<AddLink onClick={() => setEditingOpp('new')}>Add deal</AddLink>}>Top 3 deals</SectionTitle>
      {top.length === 0 ? (
        <Card>
          <EmptyState icon={Star} title="No top deals yet" action={<Button size="sm" onClick={() => setEditingOpp('new')}>Add a deal</Button>}>
            Star your three strongest opportunities so their next steps show up on Today.
          </EmptyState>
        </Card>
      ) : (
        <ul className="space-y-2">
          {top.map((o) => (
            <OppCard key={o.id} opp={o} onEdit={() => setEditingOpp(o)} />
          ))}
        </ul>
      )}

      {stalled.length > 0 && (
        <>
          <SectionTitle>Listings to price-review</SectionTitle>
          <ul className="space-y-2">
            {stalled.map((o) => (
              <li key={o.id}>
                <button type="button" onClick={() => setEditingOpp(o)} className="card flex w-full items-center gap-3 p-3 text-left">
                  <Tag className="h-5 w-5 text-orange-500" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{o.ref}</span>
                    <span className="block truncate text-xs text-slate-500">{o.nextAction || 'Price review conversation'}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {others.length > 0 && (
        <>
          <SectionTitle>Other open deals</SectionTitle>
          <ul className="space-y-2">
            {others.map((o) => (
              <OppCard key={o.id} opp={o} onEdit={() => setEditingOpp(o)} />
            ))}
          </ul>
        </>
      )}

      <SectionTitle action={<AddLink onClick={() => setEditingBuyer('new')}>Add buyer</AddLink>}>
        Qualified buyers · {buyers.length}/5
      </SectionTitle>
      {buyers.length === 0 ? (
        <Card>
          <EmptyState icon={Users} title="No buyers picked">
            Pick up to 5 qualified buyers in the planner, or add them here.
          </EmptyState>
        </Card>
      ) : (
        <Card className="divide-y divide-slate-100 dark:divide-white/5">
          {buyers.map((b) => (
            <button key={b.id} type="button" onClick={() => setEditingBuyer(b)} className="flex min-h-[56px] w-full items-center gap-3 px-4 py-2 text-left">
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{b.ref}</span>
                <span className="block truncate text-xs text-slate-500">
                  {[b.budgetMax != null && `up to ${randShort(b.budgetMax)}`, b.mustHaves.join(', '), b.dealBreaker && `not: ${b.dealBreaker}`].filter(Boolean).join(' · ')}
                </span>
              </span>
              <span className={cx('shrink-0 rounded-full px-2 py-1 text-[11px] font-semibold', fundingTone(b.funding))}>{FUNDING_LABEL[b.funding]}</span>
            </button>
          ))}
        </Card>
      )}

      {finished.length > 0 && (
        <>
          <SectionTitle>Finished this week</SectionTitle>
          <ul className="space-y-2">
            {finished.map((o) => (
              <OppCard key={o.id} opp={o} onEdit={() => setEditingOpp(o)} />
            ))}
          </ul>
        </>
      )}

      <OppSheet open={editingOpp != null} onClose={() => setEditingOpp(null)} week={week} settings={settings} opp={editingOpp && editingOpp !== 'new' ? editingOpp : undefined} defaults={{ isTop3: top.length < 3 }} />
      <BuyerSheet open={editingBuyer != null} onClose={() => setEditingBuyer(null)} week={week} buyer={editingBuyer && editingBuyer !== 'new' ? editingBuyer : undefined} nextRef={nextBuyerRef(buyers)} />
    </div>
  );
}

function AddLink({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="-my-2 flex min-h-[44px] items-center gap-1 text-sm font-semibold text-navy dark:text-gold">
      <Plus className="h-4 w-4" /> {children}
    </button>
  );
}

function OppCard({ opp: o, onEdit }: { opp: Opportunity; onEdit: () => void }) {
  const today = useToday();
  const toast = useToast();
  const move = async (stage: OppStage) => {
    if (stage === o.stage) return;
    const logged = await setStage(o, stage);
    const label = STAGES.find((s) => s.value === stage)!.label;
    toast.show(logged ? `${o.ref} → ${label}. Offer logged.` : `${o.ref} → ${label}`, {
      actions: [
        {
          label: 'Undo',
          onClick: async () => {
            await setStage({ ...o, stage }, o.stage);
            if (logged) await deleteActivity(logged.id);
          },
        },
      ],
    });
  };
  const overdue = !!o.dueDate && o.dueDate < today;
  return (
    <li className="card p-3">
      <button type="button" onClick={onEdit} className="flex w-full items-start gap-2 text-left">
        {o.isTop3 && <Star className="mt-0.5 h-4 w-4 shrink-0 fill-gold text-gold" aria-label="Top 3" />}
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold">{o.ref}</span>
          <span className={cx('block truncate text-xs', !o.nextAction ? 'font-medium text-amber-600' : overdue ? 'text-red-600' : 'text-slate-500')}>
            {o.nextAction ? `${o.nextAction} · ${dueLabel(o.dueDate, today)}` : o.stage === 'accepted' || o.stage === 'lost' ? 'Finished' : 'Set the next step →'}
          </span>
        </span>
        <span className="shrink-0 text-xs capitalize text-slate-400">{o.kind}</span>
      </button>
      <div className="mt-3 flex gap-1" role="group" aria-label={`Stage of ${o.ref}`}>
        {STAGES.map((s) => (
          <button
            key={s.value}
            type="button"
            onClick={() => void move(s.value)}
            aria-pressed={o.stage === s.value}
            className={cx(
              'min-h-[36px] flex-1 rounded-lg text-[11px] font-semibold transition',
              o.stage === s.value
                ? s.value === 'lost'
                  ? 'bg-slate-500 text-white'
                  : s.value === 'accepted'
                    ? 'bg-emerald-500 text-white'
                    : 'bg-navy text-white dark:bg-gold dark:text-navy-950'
                : 'bg-slate-100 text-slate-500 dark:bg-navy-800 dark:text-slate-400',
            )}
          >
            {s.label}
          </button>
        ))}
      </div>
    </li>
  );
}

function DayGrid({ week, settings, acts }: { week: Week; settings: Settings; acts: Parameters<typeof dayGrid>[1] }) {
  const today = useToday();
  const grid = dayGrid(week, acts, settings.workDays);
  const days = grid.conversations.map((c) => c.day);
  return (
    <Card className="overflow-x-auto p-3">
      <table className="w-full border-separate border-spacing-1 text-center text-sm">
        <thead>
          <tr>
            <th className="w-9" />
            {days.map((d) => (
              <th key={d} scope="col" className={cx('text-xs font-semibold', d === today ? 'text-navy dark:text-gold' : 'text-slate-400')}>
                {formatDay(d, 'EEE')}
              </th>
            ))}
            <th scope="col" className="text-xs font-semibold text-slate-400">Week</th>
          </tr>
        </thead>
        <tbody>
          {TARGET_KEYS.map((k) => {
            const type = TARGET_TO_TYPE[k];
            const Icon = ACTIVITY_ICON[type];
            const cells = grid[k];
            const done = cells.reduce((s, c) => s + c.done, 0);
            return (
              <tr key={k}>
                <th scope="row" aria-label={ACTIVITY_BY_TYPE[type].short}>
                  <span className="flex h-7 w-7 items-center justify-center rounded-md text-white" style={{ backgroundColor: ACTIVITY_BY_TYPE[type].color }}>
                    <Icon className="h-3.5 w-3.5" aria-hidden />
                  </span>
                </th>
                {cells.map((c) => {
                  const past = c.day < today;
                  const hit = c.done >= c.planned && (c.planned > 0 || c.done > 0);
                  return (
                    <td
                      key={c.day}
                      className={cx(
                        'h-9 rounded-md tabular-nums',
                        c.day === today && 'ring-1 ring-gold',
                        hit ? 'bg-emerald-50 font-semibold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300' : past && c.planned > 0 ? 'bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-300' : 'bg-slate-50 text-slate-500 dark:bg-navy-800',
                      )}
                      aria-label={`${formatDay(c.day, 'EEEE')}: ${c.done} done of ${c.planned} planned`}
                    >
                      {c.done}
                      <span className="text-[10px] text-slate-400">/{c.planned}</span>
                    </td>
                  );
                })}
                <td className="text-xs font-semibold tabular-nums">
                  {done}/{week.targets[k]}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-2 text-center text-xs text-slate-500">Done / planned each day. Plans spread your weekly target evenly.</p>
    </Card>
  );
}

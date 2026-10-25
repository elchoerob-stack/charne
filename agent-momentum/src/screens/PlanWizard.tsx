import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Copy, Plus, Rocket, Star, Tag, Users, X } from 'lucide-react';
import { ACTIVITY_BY_TYPE, FUNDING_LABEL, TARGET_KEYS, TARGET_LABEL, TARGET_TO_TYPE } from '../config';
import type { Buyer, Opportunity, Settings, Week } from '../types';
import { formatDay, todayKey, weekLabel, weekStartOf } from '../lib/dates';
import { randShort } from '../lib/format';
import { copyBuyersFromPreviousWeek, updateOpportunity, updateWeek } from '../lib/repo';
import { useSettings, useToday, useWeek, useWeekBuyers, useWeekOpportunities } from '../hooks/data';
import { BuyerSheet, dueLabel, fundingTone, nextBuyerRef, OppSheet } from '../components/Editors';
import { useToast } from '../components/Toast';
import { ACTIVITY_ICON } from '../components/ActivityIcon';
import { Button, Card, Chip, cx, IconButton, NumberStepper, ProgressBar } from '../components/ui';

const STEPS = ['Focus', 'Targets', 'Buyers', 'Top 3', 'Listings'];

export function PlanWizard() {
  const [params] = useSearchParams();
  const weekStart = params.get('week') ?? weekStartOf(todayKey());
  const settings = useSettings();
  const week = useWeek(weekStart);
  const buyers = useWeekBuyers(week?.id);
  const opps = useWeekOpportunities(week?.id);
  const [step, setStep] = useState(0);
  const navigate = useNavigate();
  const toast = useToast();

  if (!settings || !week || !buyers || !opps) return <div className="h-dvh" />;

  const finish = async () => {
    await updateWeek(week.id, { status: week.status === 'closed' ? 'closed' : 'active' });
    toast.show('Week planned. Go get it!');
    navigate('/');
  };

  const last = step === STEPS.length - 1;

  return (
    <div className="pt-safe mx-auto flex min-h-dvh max-w-lg flex-col">
      <header className="px-4 pt-3">
        <div className="flex items-center justify-between">
          <IconButton icon={X} label="Close planner" onClick={() => navigate(-1)} className="-ml-2" />
          <p className="text-sm font-medium text-slate-500">Week of {weekLabel(week.weekStart)}</p>
          <span className="w-11" />
        </div>
        <div className="mt-2 flex items-center gap-3">
          <ProgressBar value={(step + 1) / STEPS.length} className="flex-1" />
          <span className="text-xs font-semibold tabular-nums text-slate-500">
            {step + 1}/{STEPS.length}
          </span>
        </div>
        <nav aria-label="Plan steps" className="mt-3 flex gap-1 overflow-x-auto">
          {STEPS.map((s, i) => (
            <button
              key={s}
              type="button"
              onClick={() => setStep(i)}
              aria-current={i === step ? 'step' : undefined}
              className={cx(
                'min-h-[32px] shrink-0 rounded-full px-3 text-xs font-semibold',
                i === step ? 'bg-navy text-white dark:bg-gold dark:text-navy-950' : i < step ? 'text-navy dark:text-gold' : 'text-slate-400',
              )}
            >
              {s}
            </button>
          ))}
        </nav>
      </header>

      <main className="flex-1 px-4 pb-32 pt-4">
        {step === 0 && <FocusStep week={week} settings={settings} />}
        {step === 1 && <TargetsStep week={week} settings={settings} />}
        {step === 2 && <BuyersStep week={week} buyers={buyers} />}
        {step === 3 && <Top3Step week={week} settings={settings} opps={opps} />}
        {step === 4 && <ListingsStep week={week} settings={settings} opps={opps} />}
      </main>

      <footer className="pb-safe fixed inset-x-0 bottom-0 z-30 border-t border-black/5 bg-white/95 backdrop-blur dark:border-white/10 dark:bg-navy-900/95">
        <div className="mx-auto flex max-w-lg gap-2 p-3">
          {step > 0 && (
            <Button variant="secondary" size="lg" icon={ArrowLeft} onClick={() => setStep(step - 1)} aria-label="Back">
              Back
            </Button>
          )}
          {last ? (
            <Button variant="gold" size="lg" block icon={Rocket} onClick={finish}>
              Start my week
            </Button>
          ) : (
            <Button size="lg" block onClick={() => setStep(step + 1)}>
              Next: {STEPS[step + 1]} <ArrowRight className="h-4 w-4" />
            </Button>
          )}
        </div>
      </footer>
    </div>
  );
}

function StepIntro({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-5">
      <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{children}</p>
    </div>
  );
}

function FocusStep({ week, settings }: { week: Week; settings: Settings }) {
  const band = settings.bands.find((b) => b.id === week.bandId);
  const otherAreas = settings.areas.filter((a) => !band?.areas.includes(a));
  const [showAll, setShowAll] = useState(!!week.area && !band?.areas.includes(week.area));
  return (
    <>
      <StepIntro title="Where’s your focus?">Pick the price band and area you’ll prospect hardest this week.</StepIntro>
      <div className="space-y-2">
        {settings.bands.map((b) => (
          <button
            key={b.id}
            type="button"
            onClick={() => void updateWeek(week.id, { bandId: b.id, area: b.areas.includes(week.area) ? week.area : b.areas[0] ?? week.area })}
            aria-pressed={week.bandId === b.id}
            className={cx(
              'card flex w-full items-center justify-between p-4 text-left transition',
              week.bandId === b.id && 'ring-2 ring-gold dark:ring-gold',
            )}
          >
            <span>
              <span className="block font-semibold">{b.label}</span>
              <span className="block text-sm text-slate-500">{b.description}</span>
            </span>
            <span className={cx('h-5 w-5 rounded-full border-2', week.bandId === b.id ? 'border-gold bg-gold' : 'border-slate-300')} aria-hidden />
          </button>
        ))}
      </div>
      <p className="label mt-6">Area</p>
      <div className="flex flex-wrap gap-2">
        {(band?.areas ?? []).map((a) => (
          <Chip key={a} active={week.area === a} onClick={() => void updateWeek(week.id, { area: a })}>
            {a}
          </Chip>
        ))}
        {showAll &&
          otherAreas.map((a) => (
            <Chip key={a} active={week.area === a} onClick={() => void updateWeek(week.id, { area: a })}>
              {a}
            </Chip>
          ))}
        {!showAll && otherAreas.length > 0 && (
          <Chip onClick={() => setShowAll(true)}>
            <Plus className="h-4 w-4" /> Other areas
          </Chip>
        )}
      </div>
    </>
  );
}

function TargetsStep({ week, settings }: { week: Week; settings: Settings }) {
  const changed = TARGET_KEYS.some((k) => week.targets[k] !== settings.targets[k]);
  return (
    <>
      <StepIntro title="This week’s targets">
        Already set from your defaults. Adjust just for this week if you need to — a short week or December, say.
      </StepIntro>
      <Card className="divide-y divide-slate-100 dark:divide-white/5">
        {TARGET_KEYS.map((k) => {
          const type = TARGET_TO_TYPE[k];
          const Icon = ACTIVITY_ICON[type];
          return (
            <div key={k} className="flex items-center gap-3 px-4 py-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white" style={{ backgroundColor: ACTIVITY_BY_TYPE[type].color }}>
                <Icon className="h-4 w-4" aria-hidden />
              </span>
              <span className="flex-1 text-sm font-medium">{TARGET_LABEL[k]}</span>
              <NumberStepper
                label={TARGET_LABEL[k].toLowerCase()}
                value={week.targets[k]}
                onChange={(v) => void updateWeek(week.id, { targets: { ...week.targets, [k]: v } })}
              />
            </div>
          );
        })}
      </Card>
      {changed && (
        <button type="button" className="mt-3 min-h-[44px] text-sm font-semibold text-navy underline-offset-2 hover:underline dark:text-gold" onClick={() => void updateWeek(week.id, { targets: { ...settings.targets } })}>
          Reset to my usual targets
        </button>
      )}
    </>
  );
}

function BuyersStep({ week, buyers }: { week: Week; buyers: Buyer[] }) {
  const [editing, setEditing] = useState<Buyer | 'new' | null>(null);
  const toast = useToast();
  return (
    <>
      <StepIntro title="Your 5 best buyers">
        The qualified buyers you’ll match listings to this week. A short code is enough — details stay in Keystone.
      </StepIntro>
      <div className="mb-3 flex items-center justify-between">
        <span className={cx('text-sm font-semibold', buyers.length >= 5 ? 'text-emerald-600' : 'text-slate-500')}>
          {buyers.length} of 5 picked
        </span>
        <Button
          size="sm"
          variant="ghost"
          icon={Copy}
          onClick={async () => {
            const n = await copyBuyersFromPreviousWeek(week);
            toast.show(n ? `Copied ${n} buyer${n === 1 ? '' : 's'} from last week` : 'Nothing new to copy from last week');
          }}
        >
          Copy last week’s
        </Button>
      </div>
      <ul className="space-y-2">
        {buyers.map((b) => (
          <li key={b.id}>
            <button type="button" onClick={() => setEditing(b)} className="card flex w-full items-center gap-3 p-3 text-left">
              <Users className="h-5 w-5 shrink-0 text-slate-400" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{b.ref}</span>
                <span className="block truncate text-xs text-slate-500">
                  {[b.budgetMax != null && `up to ${randShort(b.budgetMax)}`, b.mustHaves.join(', ')].filter(Boolean).join(' · ') || 'Tap to add details'}
                </span>
              </span>
              <span className={cx('shrink-0 rounded-full px-2 py-1 text-[11px] font-semibold', fundingTone(b.funding))}>{FUNDING_LABEL[b.funding]}</span>
            </button>
          </li>
        ))}
      </ul>
      <Button variant="secondary" block size="lg" icon={Plus} className="mt-3" onClick={() => setEditing('new')}>
        Add a buyer
      </Button>
      <BuyerSheet
        open={editing != null}
        onClose={() => setEditing(null)}
        week={week}
        buyer={editing && editing !== 'new' ? editing : undefined}
        nextRef={nextBuyerRef(buyers)}
      />
    </>
  );
}

function Top3Step({ week, settings, opps }: { week: Week; settings: Settings; opps: Opportunity[] }) {
  const [editing, setEditing] = useState<Opportunity | 'new' | null>(null);
  const today = useToday();
  const live = opps.filter((o) => o.stage !== 'accepted' && o.stage !== 'lost');
  const starred = live.filter((o) => o.isTop3).length;
  return (
    <>
      <StepIntro title="Your 3 strongest deals">
        Star the three that matter most, and give each a next action and a date. They’ll show up on Today when due.
      </StepIntro>
      <p className={cx('mb-3 text-sm font-semibold', starred === 3 ? 'text-emerald-600' : 'text-slate-500')}>{starred} of 3 starred</p>
      {live.length === 0 && (
        <p className="card p-4 text-sm text-slate-500">No open deals yet. Add the ones you’re working — buyers, sellers or listings.</p>
      )}
      <ul className="space-y-2">
        {live.map((o) => (
          <li key={o.id} className="card flex items-center gap-1 p-1.5">
            <IconButton
              icon={Star}
              label={o.isTop3 ? `Unstar ${o.ref}` : `Star ${o.ref}`}
              onClick={() => void updateOpportunity(o.id, { isTop3: !o.isTop3 })}
              className={o.isTop3 ? 'text-gold [&_svg]:fill-gold' : 'text-slate-300'}
            />
            <button type="button" onClick={() => setEditing(o)} className="min-w-0 flex-1 py-2 pr-2 text-left">
              <span className="block truncate font-semibold">{o.ref}</span>
              <span className={cx('block truncate text-xs', o.nextAction ? 'text-slate-500' : 'text-amber-600')}>
                {o.nextAction ? `${o.nextAction} · ${dueLabel(o.dueDate, today)}` : 'Add a next action'}
                {o.carriedFromWeekId && ' · carried over'}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <Button variant="secondary" block size="lg" icon={Plus} className="mt-3" onClick={() => setEditing('new')}>
        Add a deal
      </Button>
      <OppSheet
        open={editing != null}
        onClose={() => setEditing(null)}
        week={week}
        settings={settings}
        opp={editing && editing !== 'new' ? editing : undefined}
        defaults={{ isTop3: starred < 3 }}
      />
    </>
  );
}

function ListingsStep({ week, settings, opps }: { week: Week; settings: Settings; opps: Opportunity[] }) {
  const [adding, setAdding] = useState(false);
  const listings = opps.filter((o) => o.kind === 'listing' && o.stage !== 'accepted' && o.stage !== 'lost');
  return (
    <>
      <StepIntro title="Any listings stalling?">
        Flag listings that need a price conversation this week. They count toward your price-review target when you log the talk.
      </StepIntro>
      {listings.length === 0 && <p className="card p-4 text-sm text-slate-500">No listings on your list this week. Add one if it needs a price review.</p>}
      <ul className="space-y-2">
        {listings.map((o) => (
          <li key={o.id}>
            <button
              type="button"
              onClick={() => void updateOpportunity(o.id, { stalled: !o.stalled })}
              aria-pressed={!!o.stalled}
              className={cx('card flex w-full items-center gap-3 p-4 text-left', o.stalled && 'ring-2 ring-orange-400')}
            >
              <Tag className={cx('h-5 w-5', o.stalled ? 'text-orange-500' : 'text-slate-300')} aria-hidden />
              <span className="flex-1">
                <span className="block font-semibold">{o.ref}</span>
                <span className="block text-xs text-slate-500">{o.stalled ? 'Needs a price review' : 'Tap to flag for a price review'}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <Button variant="secondary" block size="lg" icon={Plus} className="mt-3" onClick={() => setAdding(true)}>
        Add a stalled listing
      </Button>
      <OppSheet
        open={adding}
        onClose={() => setAdding(false)}
        week={week}
        settings={settings}
        defaults={{ kind: 'listing', stalled: true, nextAction: 'Price review conversation' }}
      />
      <p className="mt-6 text-center text-sm text-slate-500">That’s it. Tap <strong>Start my week</strong> when you’re ready.</p>
      <p className="mt-1 text-center text-xs text-slate-400">Plan for {formatDay(week.weekStart, 'd MMM')} onwards · edit any time from Week</p>
    </>
  );
}

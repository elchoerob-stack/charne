import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ArrowDownRight, ArrowUpRight, ChartLine, Flame, Lightbulb, Minus, PartyPopper, Sparkles, Trophy } from 'lucide-react';
import { COACHING } from '../config';
import type { Settings, Week } from '../types';
import { addDaysKey, dayKeyOf, formatDay, shortWeekLabel } from '../lib/dates';
import { aggregate, computeWeekMetrics, currentStreak, personalBests, type WeekMetrics } from '../lib/metrics';
import { evaluateCoaching, type CoachingCard } from '../lib/coaching';
import { pct, plural } from '../lib/format';
import { loadDemoData } from '../lib/demo';
import { useAllActivities, useAllWeeks, useSettings, useToday } from '../hooks/data';
import { useToast } from '../components/Toast';
import { Button, Card, cx, EmptyState, PageHeader, ProgressBar, Segmented, SectionTitle } from '../components/ui';

type Range = '4' | '8' | '12' | 'all';

export function Insights() {
  const settings = useSettings();
  const weeks = useAllWeeks();
  const acts = useAllActivities();
  const today = useToday();
  const [range, setRange] = useState<Range>('8');

  const closed = useMemo(() => {
    if (!settings || !weeks || !acts) return [];
    const byWeek = new Map<string, typeof acts>();
    for (const a of acts) byWeek.set(a.weekId, [...(byWeek.get(a.weekId) ?? []), a]);
    return weeks
      .filter((w) => w.status === 'closed')
      .map((w) => computeWeekMetrics(w, byWeek.get(w.id) ?? [], settings.workDays, addDaysKey(w.weekStart, 6)));
  }, [settings, weeks, acts]);

  if (!settings || !weeks || !acts) return <div className="h-dvh" />;

  const header = <PageHeader title="Insights" subtitle={closed.length ? `${plural(closed.length, 'closed week')}` : undefined} />;

  if (!closed.length) {
    return (
      <div>
        {header}
        <Card className="mt-3">
          <InsightsEmpty />
        </Card>
      </div>
    );
  }

  const n = range === 'all' ? closed.length : Number(range);
  const shown = closed.slice(-n);
  const previous = closed.slice(-2 * n, -n);
  const agg = aggregate(shown)!;
  const prevAgg = aggregate(previous);
  const cards = evaluateCoaching(closed, settings.bands);
  const streak = currentStreak(new Set(acts.map((a) => dayKeyOf(a.occurredAt))), today, settings.workDays);

  return (
    <div>
      {header}
      <div className="mt-2">
        <Segmented
          label="Time range"
          value={range}
          onChange={setRange}
          options={[
            { value: '4', label: '4 wks' },
            { value: '8', label: '8 wks' },
            { value: '12', label: '12 wks' },
            { value: 'all', label: 'All' },
          ]}
        />
      </div>

      <SectionTitle>Your coach</SectionTitle>
      {closed.length < COACHING.minClosedWeeks ? (
        <Card className="flex items-center gap-3 p-4 text-sm text-slate-500">
          <Lightbulb className="h-5 w-5 shrink-0 text-gold" /> Coaching tips start once you’ve closed {COACHING.minClosedWeeks} weeks.
        </Card>
      ) : cards.length === 0 ? (
        <Card className="flex items-center gap-3 p-4 text-sm text-slate-600 dark:text-slate-300">
          <Sparkles className="h-5 w-5 shrink-0 text-gold" /> Nothing to flag — your numbers look balanced. Keep the rhythm.
        </Card>
      ) : (
        <div className="space-y-2">
          {cards.map((c) => (
            <CoachCard key={c.rule} card={c} />
          ))}
        </div>
      )}

      <SectionTitle>Am I improving?</SectionTitle>
      <ScoreTrend weeks={shown} allClosed={closed} />
      {prevAgg && (
        <Card className="mt-2 grid grid-cols-3 divide-x divide-slate-100 dark:divide-white/5">
          <Delta label="Activity score" now={agg.activityScore} before={prevAgg.activityScore} />
          <Delta label="Conv → val" now={agg.convToVal} before={prevAgg.convToVal} />
          <Delta label="Offer → accepted" now={agg.offerToAccepted} before={prevAgg.offerToAccepted} />
        </Card>
      )}
      {prevAgg && <p className="mt-1.5 px-1 text-xs text-slate-500">Compared with the {plural(previous.length, 'week')} before.</p>}

      <SectionTitle>Where does my funnel leak?</SectionTitle>
      <Funnel agg={agg} />

      <SectionTitle>Where do my deals come from?</SectionTitle>
      <BandSplit agg={agg} settings={settings} />

      <SectionTitle>Habits</SectionTitle>
      <Card className="grid grid-cols-2 gap-px overflow-hidden bg-slate-100 dark:bg-white/5">
        <Stat label="Current streak" value={`${streak}`} suffix={streak === 1 ? 'day' : 'days'} icon={<Flame className="h-4 w-4 text-gold" />} />
        <Stat label="Days with activity" value={pct(agg.consistency)} suffix="of work days" />
        <Stat label="Pre-qualified viewings" value={pct(agg.preQualifiedRate)} suffix={agg.preQualifiedAnswered ? `of ${agg.preQualifiedAnswered} recorded` : 'not recorded'} warn={agg.preQualifiedRate != null && agg.preQualifiedRate < COACHING.preQualifiedLow} />
        <Stat label="Mandates within comps" value={pct(agg.withinCompsRate)} suffix={agg.withinCompsAnswered ? `of ${agg.withinCompsAnswered} recorded` : 'not recorded'} warn={agg.withinCompsRate != null && agg.withinCompsRate < COACHING.withinCompsLow} />
      </Card>

      <SectionTitle>Personal bests</SectionTitle>
      <PersonalBests closed={closed} weeks={weeks} />
    </div>
  );
}

function InsightsEmpty() {
  const toast = useToast();
  return (
    <EmptyState
      icon={ChartLine}
      title="Your trends appear here"
      action={
        <Button
          variant="secondary"
          size="sm"
          onClick={async () => {
            await loadDemoData();
            toast.show('Sample data loaded — remove it any time from Today or Settings');
          }}
        >
          Preview with sample data
        </Button>
      }
    >
      After you close your first week on Friday, this shows how you’re trending, where deals leak, and which band pays best.
    </EmptyState>
  );
}

function CoachCard({ card }: { card: CoachingCard }) {
  const Icon = card.kind === 'celebrate' ? PartyPopper : card.kind === 'insight' ? Trophy : Lightbulb;
  return (
    <Card className={cx('p-4', card.kind === 'celebrate' && 'ring-2 ring-gold/50')}>
      <div className="flex items-start gap-3">
        <span className={cx('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl', card.kind === 'celebrate' ? 'bg-gold text-navy-950' : 'bg-navy text-gold dark:bg-navy-700')}>
          <Icon className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="font-semibold">{card.title}</p>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{card.see}</p>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{card.why}</p>
          <p className="mt-3 rounded-xl bg-gold-50 px-3 py-2 text-sm font-medium text-navy-900 dark:bg-gold/10 dark:text-gold-300">
            <span className="font-semibold">Next week:</span> {card.action}
          </p>
        </div>
      </div>
    </Card>
  );
}

function ScoreTrend({ weeks, allClosed }: { weeks: WeekMetrics[]; allClosed: WeekMetrics[] }) {
  const navigate = useNavigate();
  const data = weeks.map((w) => {
    const i = allClosed.indexOf(w);
    const window = allClosed.slice(Math.max(0, i - 3), i + 1);
    return {
      weekId: w.weekId,
      label: shortWeekLabel(w.weekStart),
      score: Math.round(w.activityScore * 100),
      avg: Math.round(aggregate(window)!.activityScore * 100),
    };
  });
  const open = (weekId?: string) => weekId && navigate(`/review?week=${weekId}`);
  return (
    <Card className="p-3 pt-4">
      <div className="mb-2 flex items-center gap-4 px-1 text-xs text-slate-500">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-gold" /> Weekly score
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 bg-navy-400" /> 4-week average
        </span>
      </div>
      <div className="h-52">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={data}
            margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
            onClick={(e) => open((e?.activePayload?.[0]?.payload as { weekId?: string } | undefined)?.weekId)}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#94a3b833" vertical={false} />
            <XAxis dataKey="label" tick={{ fill: '#94a3b8', fontSize: 11 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
            <YAxis domain={[0, 100]} width={40} tick={{ fill: '#94a3b8', fontSize: 11 }} tickLine={false} axisLine={false} unit="%" />
            <Tooltip
              formatter={(v: number, name: string) => [`${v}%`, name === 'score' ? 'Score' : '4-wk avg']}
              contentStyle={{ borderRadius: 12, border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,.15)', fontSize: 12 }}
            />
            <Line type="monotone" dataKey="avg" stroke="#4C6593" strokeWidth={2} dot={false} isAnimationActive={false} />
            <Line
              type="monotone"
              dataKey="score"
              stroke="#C9A227"
              strokeWidth={3}
              dot={{ r: 4, fill: '#C9A227', strokeWidth: 0, cursor: 'pointer' }}
              activeDot={{ r: 7, cursor: 'pointer', onClick: (_: unknown, p: unknown) => open((p as { payload?: { weekId?: string } }).payload?.weekId) }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-1 text-center text-xs text-slate-500">Tap a week to open its review</p>
    </Card>
  );
}

function Delta({ label, now, before }: { label: string; now: number | null; before: number | null }) {
  const diff = now != null && before != null ? now - before : null;
  const Icon = diff == null || Math.abs(diff) < 0.005 ? Minus : diff > 0 ? ArrowUpRight : ArrowDownRight;
  const tone = diff == null || Math.abs(diff) < 0.005 ? 'text-slate-400' : diff > 0 ? 'text-emerald-600' : 'text-red-600';
  return (
    <div className="p-3 text-center">
      <p className="text-lg font-bold tabular-nums">{pct(now)}</p>
      <p className={cx('flex items-center justify-center gap-0.5 text-xs font-semibold tabular-nums', tone)}>
        <Icon className="h-3.5 w-3.5" aria-hidden />
        {diff == null ? 'n/a' : `${diff > 0 ? '+' : ''}${Math.round(diff * 100)} pts`}
      </p>
      <p className="mt-0.5 text-[11px] leading-tight text-slate-500">{label}</p>
    </div>
  );
}

function Funnel({ agg }: { agg: WeekMetrics }) {
  const seller = [
    { label: 'Seller conversations', n: agg.actual.conversations },
    { label: 'Valuations', n: agg.actual.valuations },
    { label: 'Mandates', n: agg.actual.mandates },
  ];
  const buyer = [
    { label: 'Viewings', n: agg.actual.viewings },
    { label: 'Offers', n: agg.offersSubmitted },
    { label: 'Accepted', n: agg.offersAccepted },
  ];
  // Compare each step with a sensible benchmark (the coaching thresholds) to name the leak.
  const steps = [
    { name: 'conversation → valuation', rate: agg.convToVal, bar: COACHING.convToValLow },
    { name: 'valuation → mandate', rate: agg.valToMandate, bar: COACHING.valToMandateLow },
    { name: 'viewing → offer', rate: agg.viewingToOffer, bar: COACHING.viewingToOfferLow },
  ].filter((s) => s.rate != null);
  const leak = steps.map((s) => ({ ...s, gap: (s.rate as number) / s.bar })).sort((a, b) => a.gap - b.gap)[0];

  return (
    <Card className="p-4">
      {leak && (
        <p className={cx('mb-4 rounded-xl px-3 py-2 text-sm', leak.gap < 1 ? 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300' : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300')}>
          {leak.gap < 1 ? (
            <>
              Biggest leak: <strong>{leak.name}</strong> at {pct(leak.rate)} (aim for {pct(leak.bar)}+).
            </>
          ) : (
            <>No step is below its benchmark. Weakest relative step: {leak.name} ({pct(leak.rate)}).</>
          )}
        </p>
      )}
      <FunnelBars title="Sellers" steps={seller} color="#C9A227" />
      <div className="h-4" />
      <FunnelBars title="Buyers" steps={buyer} color="#8B5CF6" />
    </Card>
  );
}

function FunnelBars({ title, steps, color }: { title: string; steps: { label: string; n: number }[]; color: string }) {
  const max = Math.max(1, steps[0].n);
  return (
    <div>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">{title}</p>
      <div className="space-y-1.5">
        {steps.map((s, i) => (
          <div key={s.label}>
            {i > 0 && (
              <p className="pl-1 text-[11px] text-slate-500">
                ↓ {pct(steps[i - 1].n ? s.n / steps[i - 1].n : null)}
              </p>
            )}
            <div className="flex items-center gap-2">
              <div className="h-8 flex-1 overflow-hidden rounded-lg bg-slate-100 dark:bg-navy-800">
                <div className="flex h-full items-center rounded-lg px-2 text-xs font-semibold text-white" style={{ width: `${Math.max(12, (s.n / max) * 100)}%`, backgroundColor: color, opacity: 1 - i * 0.2 }}>
                  {s.n}
                </div>
              </div>
              <span className="w-32 shrink-0 text-xs text-slate-600 dark:text-slate-300">{s.label}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function BandSplit({ agg, settings }: { agg: WeekMetrics; settings: Settings }) {
  const bands = settings.bands.map((b) => ({ ...b, y: agg.byBand[b.id] ?? { activities: 0, offers: 0, accepted: 0 } }));
  const totalOffers = bands.reduce((s, b) => s + b.y.offers, 0);
  const areas = Object.entries(agg.byArea)
    .filter(([, y]) => y.offers || y.accepted)
    .sort((a, b) => b[1].accepted - a[1].accepted || b[1].offers - a[1].offers)
    .slice(0, 5);

  return (
    <Card className="p-4">
      <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">By price band</p>
      <div className="space-y-3">
        {bands.map((b) => (
          <div key={b.id}>
            <div className="mb-1 flex items-baseline justify-between text-sm">
              <span>
                <span className="font-medium">{b.label}</span> <span className="text-xs text-slate-500">{b.description}</span>
              </span>
              <span className="text-xs tabular-nums text-slate-600 dark:text-slate-300">
                <strong>{b.y.offers}</strong> offers · <strong className="text-emerald-600">{b.y.accepted}</strong> accepted
              </span>
            </div>
            <ProgressBar value={totalOffers ? b.y.offers / totalOffers : 0} />
          </div>
        ))}
      </div>
      <p className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wider text-slate-500">Top areas</p>
      {areas.length === 0 ? (
        <p className="text-sm text-slate-500">No offers recorded in this period yet.</p>
      ) : (
        <ul className="divide-y divide-slate-100 text-sm dark:divide-white/5">
          {areas.map(([area, y]) => (
            <li key={area} className="flex justify-between py-2">
              <span>{area}</span>
              <span className="tabular-nums text-slate-600 dark:text-slate-300">
                {y.offers} offers · <span className="font-semibold text-emerald-600">{y.accepted} accepted</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Stat({ label, value, suffix, icon, warn }: { label: string; value: string; suffix?: string; icon?: React.ReactNode; warn?: boolean }) {
  return (
    <div className="bg-white p-4 dark:bg-navy-900">
      <p className="text-xs text-slate-500">{label}</p>
      <p className={cx('mt-1 flex items-center gap-1 text-2xl font-bold tabular-nums', warn && 'text-amber-600')}>
        {icon}
        {value}
      </p>
      {suffix && <p className="text-[11px] text-slate-500">{suffix}</p>}
    </div>
  );
}

function PersonalBests({ closed, weeks }: { closed: WeekMetrics[]; weeks: Week[] }) {
  const navigate = useNavigate();
  const bests = personalBests(closed);
  if (!bests.length) return <Card className="p-4 text-sm text-slate-500">Your best weeks will show up here.</Card>;
  return (
    <Card className="divide-y divide-slate-100 dark:divide-white/5">
      {bests.map((b) => (
        <button key={b.id} type="button" onClick={() => navigate(`/review?week=${b.weekId}`)} className="flex min-h-[52px] w-full items-center justify-between px-4 text-left">
          <span className="flex items-center gap-2 text-sm">
            <Trophy className="h-4 w-4 text-gold" aria-hidden /> {b.label}
          </span>
          <span className="text-right">
            <span className="block font-bold tabular-nums">{b.display}</span>
            <span className="block text-[11px] text-slate-500">week of {formatDay(weeks.find((w) => w.id === b.weekId)?.weekStart ?? b.weekStart, 'd MMM')}</span>
          </span>
        </button>
      ))}
    </Card>
  );
}

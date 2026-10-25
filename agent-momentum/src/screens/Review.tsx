import { forwardRef, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { toPng } from 'html-to-image';
import {
  CalendarCheck,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Lock,
  LockOpen,
  Printer,
  Share2,
  Trophy,
} from 'lucide-react';
import { ATTAINMENT_DISPLAY_CAP, REVIEW_READY_HOUR, TARGET_KEYS, TARGET_LABEL, TARGET_TO_TYPE, ACTIVITY_BY_TYPE } from '../config';
import type { Miss, Settings, TargetKey, Week } from '../types';
import { db } from '../lib/db';
import { addDaysKey, dayKeyOf, formatDay, todayKey, weekLabel, weekStartOf } from '../lib/dates';
import { computeWeekMetrics, newBests, type WeekMetrics } from '../lib/metrics';
import { pct, plural } from '../lib/format';
import { closeWeek, isReviewTime, reopenWeek, saveReviewDraft, updateWeek } from '../lib/repo';
import { shareOrSave } from '../lib/backup';
import { useAllActivities, useAllWeeks, useSettings, useToday, useWeekActivities, useWeekById } from '../hooks/data';
import { Confirm } from '../components/Sheet';
import { useToast } from '../components/Toast';
import { Banner, Button, Card, cx, IconButton, PageHeader, ProgressBar, SectionTitle } from '../components/ui';

export function Review() {
  const [params, setParams] = useSearchParams();
  const settings = useSettings();
  const today = useToday();
  const weeks = useAllWeeks();
  const currentStart = weekStartOf(today);
  const requestedId = params.get('week') ?? undefined;
  const fallback = weeks?.find((w) => w.weekStart === currentStart);
  const week = useWeekById(requestedId ?? fallback?.id);
  const acts = useWeekActivities(week?.id);
  const allActs = useAllActivities();
  const review = useLiveQuery(async () => (week ? db.reviews.where('weekId').equals(week.id).first() : undefined), [week?.id]);

  if (!settings || !weeks || !acts || !allActs) return <div className="h-dvh" />;
  if (!week) {
    return (
      <div>
        <PageHeader title="Review" />
        <Card className="mt-3 p-6 text-center text-sm text-slate-500">Log some activity first — your review builds itself.</Card>
      </div>
    );
  }

  const isFinished = week.weekStart < currentStart;
  const asOf = isFinished ? addDaysKey(week.weekStart, 6) : today;
  const metrics = computeWeekMetrics(week, acts, settings.workDays, asOf);
  const idx = weeks.findIndex((w) => w.id === week.id);
  const prev = weeks[idx - 1];
  const next = weeks[idx + 1]?.weekStart <= currentStart ? weeks[idx + 1] : undefined;
  const earlier = weeks
    .filter((w) => w.status === 'closed' && w.weekStart < week.weekStart)
    .map((w) => computeWeekMetrics(w, allActs.filter((a) => a.weekId === w.id), settings.workDays, addDaysKey(w.weekStart, 6)));

  return (
    <ReviewBody
      key={week.id}
      week={week}
      settings={settings}
      metrics={metrics}
      earlier={earlier}
      misses={review?.misses ?? []}
      userWins={review?.wins ?? []}
      isCurrent={week.weekStart === currentStart}
      onPrev={prev ? () => setParams({ week: prev.id }) : undefined}
      onNext={next ? () => setParams({ week: next.id }) : undefined}
    />
  );
}

function ReviewBody({
  week,
  settings,
  metrics: m,
  earlier,
  misses: savedMisses,
  userWins,
  isCurrent,
  onPrev,
  onNext,
}: {
  week: Week;
  settings: Settings;
  metrics: WeekMetrics;
  earlier: WeekMetrics[];
  misses: Miss[];
  userWins: string[];
  isCurrent: boolean;
  onPrev?: () => void;
  onNext?: () => void;
}) {
  const navigate = useNavigate();
  const toast = useToast();
  const shareRef = useRef<HTMLDivElement>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const closed = week.status === 'closed';
  const openDeals = useLiveQuery(
    () => db.opportunities.where('weekId').equals(week.id).filter((o) => !o.deletedAt && o.stage !== 'accepted' && o.stage !== 'lost').count(),
    [week.id],
  );

  const missedKeys = TARGET_KEYS.filter((k) => week.targets[k] > 0 && m.actual[k] < week.targets[k]);
  const [misses, setMisses] = useState<Miss[]>(() =>
    missedKeys.map((k) => savedMisses.find((x) => x.metric === k) ?? { metric: k, reason: '', fix: '' }),
  );
  // Keep the list in step as entries are logged, without losing typed text.
  useEffect(() => {
    setMisses((cur) => missedKeys.map((k) => cur.find((x) => x.metric === k) ?? savedMisses.find((x) => x.metric === k) ?? { metric: k, reason: '', fix: '' }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missedKeys.join()]);
  const [winsText, setWinsText] = useState(userWins.join('\n'));
  const [note, setNote] = useState(week.mondayNote);

  const saveTimer = useRef<number>();
  const persist = (patch: { misses?: Miss[]; wins?: string[] }) => {
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => void saveReviewDraft(week.id, patch), 400);
  };
  const noteTimer = useRef<number>();

  const autoWins = useMemo(() => {
    const w: string[] = [];
    for (const k of TARGET_KEYS) if (week.targets[k] > 0 && m.actual[k] >= week.targets[k]) w.push(`Hit ${TARGET_LABEL[k].toLowerCase()}: ${m.actual[k]}/${week.targets[k]}`);
    if (m.offersAccepted) w.push(`${plural(m.offersAccepted, 'offer')} accepted`);
    for (const b of newBests(m, earlier)) w.push(`New personal best — ${b.label.toLowerCase()}: ${b.fmt(b.get(m))}`);
    return w;
  }, [m, earlier, week.targets]);

  const bestBand = useMemo(() => {
    const entries = Object.entries(m.byBand).sort((a, b) => b[1].offers - a[1].offers || b[1].accepted - a[1].accepted || b[1].activities - a[1].activities);
    if (!entries.length) return undefined;
    const band = settings.bands.find((b) => b.id === entries[0][0]);
    return band ? { label: band.label, description: band.description, ...entries[0][1] } : undefined;
  }, [m.byBand, settings.bands]);

  const allWins = [...autoWins, ...winsText.split('\n').map((s) => s.trim()).filter(Boolean)];
  const preview = isCurrent && !closed && !isReviewTime();

  const doClose = async () => {
    setConfirming(false);
    setBusy(true);
    window.clearTimeout(saveTimer.current);
    await saveReviewDraft(week.id, { misses, wins: winsText.split('\n').map((s) => s.trim()).filter(Boolean) });
    await updateWeek(week.id, { mondayNote: note });
    const next = await closeWeek(week.id);
    setBusy(false);
    toast.show('Week closed. Nicely done.', {
      duration: 8000,
      actions: [{ label: 'Plan next week', onClick: () => navigate(`/plan?week=${next.weekStart}`) }],
    });
  };

  const share = async () => {
    if (!shareRef.current) return;
    setBusy(true);
    try {
      const dataUrl = await toPng(shareRef.current, { pixelRatio: 2, backgroundColor: '#ffffff', cacheBust: true });
      const blob = await (await fetch(dataUrl)).blob();
      const file = new File([blob], `weekly-review-${week.weekStart}.png`, { type: 'image/png' });
      const r = await shareOrSave(file, `Weekly review · ${weekLabel(week.weekStart)}`);
      if (r === 'saved') toast.show('Review image saved to your downloads');
    } catch {
      toast.show('Couldn’t create the image. Try Print → Save as PDF instead.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="no-print">
        <PageHeader
          subtitle={weekLabel(week.weekStart)}
          title={closed ? 'Weekly review' : isCurrent ? 'This week’s review' : 'Weekly review'}
          actions={
            <>
              <IconButton icon={ChevronLeft} label="Previous week" onClick={onPrev} disabled={!onPrev} className="disabled:opacity-30" />
              <IconButton icon={ChevronRight} label="Next week" onClick={onNext} disabled={!onNext} className="disabled:opacity-30" />
            </>
          }
        />

        {preview && (
          <div className="mt-2">
            <Banner tone="slate" icon={Clock} title="Week in progress">
              This is a live preview. Your full review is ready on Friday from {REVIEW_READY_HOUR}:00.
            </Banner>
          </div>
        )}
        {closed && (
          <div className="mt-2 flex items-center gap-2 rounded-xl bg-slate-100 px-3 py-2 text-sm text-slate-600 dark:bg-navy-800 dark:text-slate-300">
            <Lock className="h-4 w-4" /> Closed {week.closedAt ? formatDay(dayKeyOf(week.closedAt), 'EEE d MMM') : ''}
          </div>
        )}

        <Scorecard week={week} m={m} />

        <SectionTitle>Conversion</SectionTitle>
        <Card className="divide-y divide-slate-100 dark:divide-white/5">
          <FunnelRow label="Conversation → valuation" value={m.convToVal} detail={`${m.actual.valuations} of ${m.actual.conversations}`} />
          <FunnelRow label="Valuation → mandate" value={m.valToMandate} detail={`${m.actual.mandates} of ${m.actual.valuations}`} />
          <FunnelRow label="Viewing → offer" value={m.viewingToOffer} detail={`${m.offersSubmitted} of ${m.actual.viewings}`} />
          <FunnelRow label="Offer → accepted" value={m.offerToAccepted} detail={`${m.offersAccepted} of ${m.offersSubmitted}`} />
          <FunnelRow label="Pre-qualified viewings" value={m.preQualifiedRate} detail={m.preQualifiedAnswered ? `${m.preQualifiedYes} of ${m.preQualifiedAnswered} answered` : 'not recorded'} />
          <FunnelRow label="Mandates within comps" value={m.withinCompsRate} detail={m.withinCompsAnswered ? `${m.withinCompsYes} of ${m.withinCompsAnswered} answered` : 'not recorded'} />
        </Card>
        {bestBand && (
          <p className="mt-2 px-1 text-sm text-slate-600 dark:text-slate-300">
            <Trophy className="mr-1 inline h-4 w-4 text-gold" aria-hidden />
            Best band: <strong>{bestBand.label}</strong> ({bestBand.description.toLowerCase()}) — {plural(bestBand.offers, 'offer')}, {bestBand.accepted} accepted.
          </p>
        )}

        <SectionTitle>Wins</SectionTitle>
        <Card className="p-4">
          {autoWins.length > 0 ? (
            <ul className="mb-3 space-y-1.5">
              {autoWins.map((w) => (
                <li key={w} className="flex items-start gap-2 text-sm">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" aria-hidden /> {w}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mb-3 text-sm text-slate-500">No targets hit yet — add any wins of your own.</p>
          )}
          <label htmlFor="wins" className="label">
            Your own wins <span className="font-normal text-slate-400">(one per line)</span>
          </label>
          <textarea
            id="wins"
            className="input min-h-[72px] py-2"
            disabled={closed}
            placeholder="e.g. Seller in Moreleta Park agreed to a realistic price"
            value={winsText}
            onChange={(e) => {
              setWinsText(e.target.value);
              persist({ wins: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean) });
            }}
          />
        </Card>

        <SectionTitle>Misses</SectionTitle>
        {preview ? (
          <Card className="flex items-center gap-3 p-4 text-sm text-slate-500 dark:text-slate-400">
            <Clock className="h-5 w-5 shrink-0" aria-hidden />
            {misses.length
              ? `On Friday you’ll jot a one-line reason and a fix for anything still under target (${misses.length} right now).`
              : 'Every target met so far.'}
          </Card>
        ) : misses.length === 0 ? (
          <Card className="flex items-center gap-3 p-4 text-sm">
            <Check className="h-5 w-5 text-emerald-500" /> Every target met. Nothing to fix.
          </Card>
        ) : (
          <div className="space-y-2">
            {misses.map((x, i) => (
              <Card key={x.metric} className="p-4">
                <p className="font-semibold">
                  {TARGET_LABEL[x.metric]}{' '}
                  <span className="font-normal text-slate-500">
                    {m.actual[x.metric]} of {week.targets[x.metric]}
                  </span>
                </p>
                <label className="label mt-3" htmlFor={`reason-${x.metric}`}>
                  Why, in one line
                </label>
                <input
                  id={`reason-${x.metric}`}
                  className="input"
                  disabled={closed}
                  placeholder="e.g. Two days lost to transfers"
                  value={x.reason}
                  onChange={(e) => {
                    const next = misses.map((y, j) => (j === i ? { ...y, reason: e.target.value } : y));
                    setMisses(next);
                    persist({ misses: next });
                  }}
                />
                <label className="label mt-3" htmlFor={`fix-${x.metric}`}>
                  Fix for next week
                </label>
                <input
                  id={`fix-${x.metric}`}
                  className="input"
                  disabled={closed}
                  placeholder="e.g. Block 8–9am for calls"
                  value={x.fix}
                  onChange={(e) => {
                    const next = misses.map((y, j) => (j === i ? { ...y, fix: e.target.value } : y));
                    setMisses(next);
                    persist({ misses: next });
                  }}
                />
              </Card>
            ))}
          </div>
        )}

        <SectionTitle>Note for Monday’s meeting</SectionTitle>
        <textarea
          aria-label="Note for Monday’s meeting"
          className="input min-h-[88px] py-2"
          disabled={closed}
          placeholder="What you want to raise or ask for help with"
          value={note}
          onChange={(e) => {
            setNote(e.target.value);
            window.clearTimeout(noteTimer.current);
            const v = e.target.value;
            noteTimer.current = window.setTimeout(() => void updateWeek(week.id, { mondayNote: v }), 400);
          }}
        />

        <div className="mt-6 space-y-2">
          {!closed ? (
            <Button size="lg" block icon={Lock} disabled={busy} onClick={() => setConfirming(true)}>
              Close week
            </Button>
          ) : (
            <Button size="lg" block variant="gold" icon={CalendarCheck} onClick={() => navigate(`/plan?week=${addDaysKey(week.weekStart, 7)}`)}>
              Plan the next week
            </Button>
          )}
          <div className="flex gap-2">
            <Button variant="secondary" size="lg" icon={Share2} className="flex-1" disabled={busy} onClick={share}>
              Share image
            </Button>
            <Button variant="secondary" size="lg" icon={Printer} className="flex-1" onClick={() => window.print()}>
              PDF
            </Button>
          </div>
          {closed && (
            <button
              type="button"
              className="flex min-h-[44px] w-full items-center justify-center gap-2 text-sm font-medium text-slate-500"
              onClick={async () => {
                await reopenWeek(week.id);
                toast.show('Week reopened. Deals already moved to next week stay there.');
              }}
            >
              <LockOpen className="h-4 w-4" /> Reopen this week
            </button>
          )}
        </div>
      </div>

      {/* The one-pager used for the shared image and for printing. */}
      <div className="pointer-events-none fixed -left-[10000px] top-0 print:static print:left-0" aria-hidden>
        <ShareCard ref={shareRef} week={week} settings={settings} m={m} wins={allWins} misses={misses} note={note} bestBand={bestBand} />
      </div>

      <Confirm
        open={confirming}
        title="Close this week?"
        confirmLabel="Close week"
        onConfirm={doClose}
        onCancel={() => setConfirming(false)}
      >
        This locks the week’s numbers
        {openDeals ? ` and moves ${plural(openDeals, 'unfinished deal')} into next week` : ''}. You can reopen it later if you need to.
      </Confirm>
    </div>
  );
}

function Scorecard({ week, m }: { week: Week; m: WeekMetrics }) {
  return (
    <Card className="mt-3 overflow-hidden">
      <div className="flex items-center justify-between bg-navy p-4 text-white dark:bg-navy-800">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-white/60">Activity score</p>
          <p className="text-3xl font-bold tabular-nums">{pct(m.activityScore)}</p>
        </div>
        <div className="text-right text-sm">
          <p>
            <span className="text-xl font-bold tabular-nums">{m.offersSubmitted}</span> <span className="text-white/70">offers</span>
          </p>
          <p>
            <span className="text-xl font-bold tabular-nums text-gold">{m.offersAccepted}</span> <span className="text-white/70">accepted</span>
          </p>
        </div>
      </div>
      <ul className="divide-y divide-slate-100 dark:divide-white/5">
        {TARGET_KEYS.map((k) => (
          <TargetRow key={k} k={k} actual={m.actual[k]} target={week.targets[k]} />
        ))}
      </ul>
    </Card>
  );
}

function TargetRow({ k, actual, target }: { k: TargetKey; actual: number; target: number }) {
  const ratio = target ? actual / target : 0;
  const color = ACTIVITY_BY_TYPE[TARGET_TO_TYPE[k]].color;
  return (
    <li className="px-4 py-3">
      <div className="mb-1.5 flex items-baseline justify-between text-sm">
        <span className="font-medium">{TARGET_LABEL[k]}</span>
        <span className="tabular-nums">
          <strong>{actual}</strong>
          <span className="text-slate-400"> / {target}</span>
          <span className={cx('ml-2 inline-block w-12 text-right text-xs font-semibold', ratio >= 1 ? 'text-emerald-600' : ratio >= 0.5 ? 'text-amber-600' : 'text-red-600')}>
            {pct(Math.min(ratio, ATTAINMENT_DISPLAY_CAP))}
            {ratio > ATTAINMENT_DISPLAY_CAP && '+'}
          </span>
        </span>
      </div>
      <ProgressBar value={ratio} color={color} />
    </li>
  );
}

function FunnelRow({ label, value, detail }: { label: string; value: number | null; detail: string }) {
  return (
    <div className="flex items-center justify-between px-4 py-3 text-sm">
      <span>
        <span className="block font-medium">{label}</span>
        <span className="block text-xs text-slate-500">{detail}</span>
      </span>
      <span className="text-lg font-bold tabular-nums">{pct(value)}</span>
    </div>
  );
}

const ShareCard = forwardRef<
  HTMLDivElement,
  {
    week: Week;
    settings: Settings;
    m: WeekMetrics;
    wins: string[];
    misses: Miss[];
    note: string;
    bestBand?: { label: string; description: string; offers: number; accepted: number };
  }
>(function ShareCard({ week, settings, m, wins, misses, note, bestBand }, ref) {
  const band = settings.bands.find((b) => b.id === week.bandId);
  return (
    <div ref={ref} className="print-area w-[600px] bg-white p-8 font-sans text-[#14284B]">
      <div className="flex items-start justify-between border-b-4 border-[#C9A227] pb-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-[#C9A227]">Weekly review</p>
          <h1 className="text-2xl font-bold">{settings.name}</h1>
          <p className="text-sm text-slate-500">
            {weekLabel(week.weekStart)} · {week.area} · {band?.label}
          </p>
        </div>
        <div className="text-right">
          <p className="text-4xl font-bold">{pct(m.activityScore)}</p>
          <p className="text-xs text-slate-500">activity score</p>
        </div>
      </div>

      <table className="mt-5 w-full text-sm">
        <tbody>
          {TARGET_KEYS.map((k) => {
            const r = week.targets[k] ? m.actual[k] / week.targets[k] : 0;
            return (
              <tr key={k} className="border-b border-slate-100">
                <td className="py-2">{TARGET_LABEL[k]}</td>
                <td className="py-2 text-right font-semibold">
                  {m.actual[k]} / {week.targets[k]}
                </td>
                <td className={`w-16 py-2 text-right font-semibold ${r >= 1 ? 'text-emerald-600' : r >= 0.5 ? 'text-amber-600' : 'text-red-600'}`}>{pct(Math.min(r, ATTAINMENT_DISPLAY_CAP))}</td>
              </tr>
            );
          })}
          <tr>
            <td className="py-2">Offers submitted / accepted</td>
            <td className="py-2 text-right font-semibold">
              {m.offersSubmitted} / {m.offersAccepted}
            </td>
            <td />
          </tr>
        </tbody>
      </table>

      <div className="mt-4 grid grid-cols-4 gap-2 text-center">
        {[
          ['Conv → val', m.convToVal],
          ['Val → mandate', m.valToMandate],
          ['Viewing → offer', m.viewingToOffer],
          ['Offer → accepted', m.offerToAccepted],
        ].map(([l, v]) => (
          <div key={l as string} className="rounded-lg bg-slate-50 p-2">
            <p className="text-lg font-bold">{pct(v as number | null)}</p>
            <p className="text-[10px] uppercase tracking-wide text-slate-500">{l as string}</p>
          </div>
        ))}
      </div>
      {bestBand && (
        <p className="mt-3 text-sm">
          <strong>Best band:</strong> {bestBand.label} ({bestBand.description.toLowerCase()}) — {bestBand.offers} offers, {bestBand.accepted} accepted
        </p>
      )}

      {wins.length > 0 && (
        <>
          <h2 className="mt-5 text-xs font-bold uppercase tracking-widest text-[#C9A227]">Wins</h2>
          <ul className="mt-1 list-disc pl-5 text-sm">
            {wins.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </>
      )}
      {misses.length > 0 && (
        <>
          <h2 className="mt-5 text-xs font-bold uppercase tracking-widest text-[#C9A227]">Misses & fixes</h2>
          <ul className="mt-1 space-y-1 text-sm">
            {misses.map((x) => (
              <li key={x.metric}>
                <strong>{TARGET_LABEL[x.metric]}</strong> ({m.actual[x.metric]}/{week.targets[x.metric]})
                {x.reason && <> — {x.reason}</>}
                {x.fix && <span className="text-emerald-700"> → {x.fix}</span>}
              </li>
            ))}
          </ul>
        </>
      )}
      {note && (
        <>
          <h2 className="mt-5 text-xs font-bold uppercase tracking-widest text-[#C9A227]">For Monday’s meeting</h2>
          <p className="mt-1 whitespace-pre-line text-sm">{note}</p>
        </>
      )}
      <p className="mt-6 text-right text-[10px] text-slate-400">Agent Momentum · generated {formatDay(todayKey(), 'd MMM yyyy')}</p>
    </div>
  );
});

import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { FUNDING_LABEL, REF_HINT, STAGES } from '../config';
import type { Buyer, Funding, OppKind, OppStage, Opportunity, Settings, Week } from '../types';
import { addDaysKey, formatDay, isoWeekday } from '../lib/dates';
import { parseRand, rand } from '../lib/format';
import { addBuyer, addOpportunity, deleteBuyer, deleteOpportunity, updateBuyer, updateOpportunity } from '../lib/repo';
import { useToday } from '../hooks/data';
import { Sheet } from './Sheet';
import { Button, Chip, Segmented, Toggle } from './ui';

const KIND_OPTIONS: { value: OppKind; label: string }[] = [
  { value: 'buyer', label: 'Buyer' },
  { value: 'seller', label: 'Seller' },
  { value: 'listing', label: 'Listing' },
];

/** Quick date chips: Today, Tomorrow, the next Friday, or any date. */
export function DueDatePicker({ value, onChange }: { value?: string; onChange: (v?: string) => void }) {
  const today = useToday();
  let friday = today;
  while (isoWeekday(friday) !== 5) friday = addDaysKey(friday, 1);
  const quick = [
    { key: today, label: 'Today' },
    { key: addDaysKey(today, 1), label: 'Tomorrow' },
    ...(friday !== today && friday !== addDaysKey(today, 1) ? [{ key: friday, label: 'Friday' }] : []),
  ];
  return (
    <div className="flex flex-wrap items-center gap-2">
      {quick.map((q) => (
        <Chip key={q.key} active={value === q.key} onClick={() => onChange(value === q.key ? undefined : q.key)}>
          {q.label}
        </Chip>
      ))}
      <label className="inline-flex min-h-[40px] items-center rounded-full border border-slate-200 bg-white px-3 text-sm dark:border-white/10 dark:bg-navy-800">
        <span className="sr-only">Pick a date</span>
        <input type="date" className="bg-transparent outline-none" value={value ?? ''} onChange={(e) => onChange(e.target.value || undefined)} />
      </label>
    </div>
  );
}

export function OppSheet({
  open,
  onClose,
  week,
  settings,
  opp,
  defaults,
}: {
  open: boolean;
  onClose: () => void;
  week: Week;
  settings: Settings;
  opp?: Opportunity;
  defaults?: Partial<Opportunity>;
}) {
  const blank = (): Partial<Opportunity> => ({
    ref: '',
    kind: 'seller',
    bandId: week.bandId,
    area: week.area,
    stage: 'lead',
    nextAction: '',
    isTop3: false,
    stalled: false,
    ...defaults,
  });
  const [f, setF] = useState<Partial<Opportunity>>(opp ?? blank());
  useEffect(() => {
    if (open) setF(opp ?? blank());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, opp?.id]);
  const set = (p: Partial<Opportunity>) => setF((x) => ({ ...x, ...p }));
  const band = settings.bands.find((b) => b.id === f.bandId);
  const areas = [...(band?.areas ?? []), ...settings.areas.filter((a) => !band?.areas.includes(a))];

  const save = async () => {
    const data = { ...f, ref: f.ref!.trim(), nextAction: f.nextAction?.trim() ?? '' };
    if (opp) await updateOpportunity(opp.id, data);
    else await addOpportunity({ ...(data as Opportunity), weekId: week.id });
    onClose();
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={opp ? 'Edit opportunity' : 'New opportunity'}
      footer={
        <div className="flex gap-2">
          {opp && (
            <Button
              variant="secondary"
              size="lg"
              icon={Trash2}
              aria-label="Delete opportunity"
              onClick={async () => {
                await deleteOpportunity(opp.id);
                onClose();
              }}
            />
          )}
          <Button size="lg" block onClick={save} disabled={!f.ref?.trim()}>
            {opp ? 'Save' : 'Add opportunity'}
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        <div>
          <label className="label" htmlFor="opp-ref">Reference</label>
          <input id="opp-ref" className="input" autoFocus={!opp} placeholder="e.g. 12 Oak St" value={f.ref} onChange={(e) => set({ ref: e.target.value })} />
          <p className="hint">{REF_HINT}</p>
        </div>
        <div>
          <span className="label">Type</span>
          <Segmented label="Type" value={f.kind as OppKind} options={KIND_OPTIONS} onChange={(kind) => set({ kind })} />
        </div>
        <div>
          <span className="label">Stage</span>
          <div className="flex flex-wrap gap-2">
            {STAGES.map((s) => (
              <Chip key={s.value} active={f.stage === s.value} onClick={() => set({ stage: s.value as OppStage })}>
                {s.label}
              </Chip>
            ))}
          </div>
        </div>
        <div>
          <label className="label" htmlFor="opp-next">Next action</label>
          <input id="opp-next" className="input" placeholder="e.g. Send 3 comparable sales" value={f.nextAction} onChange={(e) => set({ nextAction: e.target.value })} />
        </div>
        <div>
          <span className="label">Due</span>
          <DueDatePicker value={f.dueDate} onChange={(dueDate) => set({ dueDate })} />
        </div>
        <div>
          <span className="label">Price band</span>
          <div className="flex flex-wrap gap-2">
            {settings.bands.map((b) => (
              <Chip key={b.id} active={f.bandId === b.id} onClick={() => set({ bandId: b.id })}>
                {b.label}
              </Chip>
            ))}
          </div>
        </div>
        <div>
          <span className="label">Area</span>
          <div className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1">
            {areas.map((a) => (
              <Chip key={a} active={f.area === a} onClick={() => set({ area: a })} className="shrink-0">
                {a}
              </Chip>
            ))}
          </div>
        </div>
        <div className="card divide-y divide-slate-100 px-4 dark:divide-white/5">
          <Toggle checked={f.isTop3} onChange={(isTop3) => set({ isTop3 })} label="One of my top 3 this week" />
          {f.kind === 'listing' && (
            <Toggle checked={f.stalled} onChange={(stalled) => set({ stalled })} label="Stalled — needs a price review" />
          )}
        </div>
      </div>
    </Sheet>
  );
}

export function BuyerSheet({
  open,
  onClose,
  week,
  buyer,
  nextRef,
}: {
  open: boolean;
  onClose: () => void;
  week: Week;
  buyer?: Buyer;
  nextRef: string;
}) {
  const blank = (): Partial<Buyer> => ({ ref: nextRef, funding: 'unknown', mustHaves: ['', '', ''], dealBreaker: '' });
  const [f, setF] = useState<Partial<Buyer>>(buyer ?? blank());
  const [budget, setBudget] = useState('');
  useEffect(() => {
    if (open) {
      const b = buyer ?? blank();
      setF({ ...b, mustHaves: [...(b.mustHaves ?? []), '', '', ''].slice(0, 3) });
      setBudget(b.budgetMax != null ? rand(b.budgetMax).replace(/^R/, '') : '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, buyer?.id]);
  const set = (p: Partial<Buyer>) => setF((x) => ({ ...x, ...p }));

  const save = async () => {
    const data = {
      ...f,
      ref: f.ref!.trim(),
      budgetMax: parseRand(budget),
      mustHaves: (f.mustHaves ?? []).map((m) => m.trim()).filter(Boolean),
      dealBreaker: f.dealBreaker?.trim() ?? '',
    };
    if (buyer) await updateBuyer(buyer.id, data);
    else await addBuyer({ ...(data as Buyer), weekId: week.id });
    onClose();
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={buyer ? 'Edit buyer' : 'Add a qualified buyer'}
      footer={
        <div className="flex gap-2">
          {buyer && (
            <Button
              variant="secondary"
              size="lg"
              icon={Trash2}
              aria-label="Remove buyer"
              onClick={async () => {
                await deleteBuyer(buyer.id);
                onClose();
              }}
            />
          )}
          <Button size="lg" block onClick={save} disabled={!f.ref?.trim()}>
            {buyer ? 'Save' : 'Add buyer'}
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        <div>
          <label className="label" htmlFor="b-ref">Reference</label>
          <input id="b-ref" className="input" value={f.ref} onChange={(e) => set({ ref: e.target.value })} />
          <p className="hint">A code like “Buyer B3” — look the person up in Keystone.</p>
        </div>
        <div>
          <label className="label" htmlFor="b-budget">Maximum budget</label>
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">R</span>
            <input id="b-budget" className="input pl-7" inputMode="decimal" placeholder="2 200 000 or 2.2m" value={budget} onChange={(e) => setBudget(e.target.value)} />
          </div>
        </div>
        <div>
          <span className="label">Funding</span>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(FUNDING_LABEL) as Funding[]).map((k) => (
              <Chip key={k} active={f.funding === k} onClick={() => set({ funding: k })}>
                {FUNDING_LABEL[k]}
              </Chip>
            ))}
          </div>
        </div>
        <div>
          <label className="label" htmlFor="b-move">Needs to move by</label>
          <input id="b-move" type="date" className="input" value={f.moveBy ?? ''} onChange={(e) => set({ moveBy: e.target.value || undefined })} />
        </div>
        <div>
          <span className="label">Top 3 must-haves</span>
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <input
                key={i}
                className="input"
                aria-label={`Must-have ${i + 1}`}
                placeholder={['e.g. 3 bedrooms', 'e.g. Garden', 'e.g. Near schools'][i]}
                value={f.mustHaves?.[i] ?? ''}
                onChange={(e) => {
                  const m = [...(f.mustHaves ?? ['', '', ''])];
                  m[i] = e.target.value;
                  set({ mustHaves: m });
                }}
              />
            ))}
          </div>
        </div>
        <div>
          <label className="label" htmlFor="b-deal">Deal-breaker</label>
          <input id="b-deal" className="input" placeholder="e.g. No stairs" value={f.dealBreaker} onChange={(e) => set({ dealBreaker: e.target.value })} />
        </div>
      </div>
    </Sheet>
  );
}

export function fundingTone(f: Funding): string {
  return f === 'pre_approved' || f === 'cash'
    ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300'
    : f === 'deposit'
      ? 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300'
      : 'bg-slate-100 text-slate-600 dark:bg-navy-800 dark:text-slate-300';
}

export function dueLabel(dueDate: string | undefined, today: string): string {
  if (!dueDate) return 'No date';
  if (dueDate === today) return 'Today';
  if (dueDate === addDaysKey(today, 1)) return 'Tomorrow';
  if (dueDate < today) return `Overdue · ${formatDay(dueDate, 'EEE d MMM')}`;
  return formatDay(dueDate, 'EEE d MMM');
}

export function nextBuyerRef(existing: { ref: string }[]): string {
  const nums = existing.map((b) => Number(b.ref.match(/B(\d+)/i)?.[1] ?? 0));
  return `Buyer B${Math.max(0, ...nums) + 1}`;
}

import { ACTIVITY_BY_TYPE } from '../config';
import type { Activity, ActivityType, Buyer, Opportunity, Week } from '../types';
import { db } from './db';
import { addDaysKey, localTimeOn, todayKey, weekStartOf, workDaysOfWeek } from './dates';
import { getSettings, nowIso, uuid } from './repo';

// "Load sample data": 8 closed weeks of realistic, varied activity so every
// chart and coaching rule has something to show before real data exists.
// Every record is flagged isDemo and removeDemoData() deletes exactly those.

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export async function hasDemoData(): Promise<boolean> {
  return (await db.weeks.filter((w) => !!w.isDemo).count()) > 0 ||
    (await db.activities.filter((a) => !!a.isDemo).count()) > 0;
}

export async function loadDemoData(seed = 2610): Promise<void> {
  const rnd = mulberry32(seed);
  const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));
  const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];
  const settings = await getSettings();
  const bandIds = settings.bands.map((b) => b.id);
  // Family homes carry most of the offers, so the "strongest band" insight has something to find.
  const bandWeights = [0.25, 0.55, 0.2];
  const pickBand = () => {
    const r = rnd();
    let acc = 0;
    for (let i = 0; i < bandIds.length; i++) {
      acc += bandWeights[i] ?? 0;
      if (r < acc) return bandIds[i];
    }
    return bandIds[0];
  };
  const areaFor = (bandId: string) => pick(settings.bands.find((b) => b.id === bandId)?.areas ?? settings.areas);

  const thisWeek = weekStartOf(todayKey());
  const t = nowIso();
  const base = { createdAt: t, updatedAt: t, isDemo: true as const };

  const weeks: Week[] = [];
  const acts: Activity[] = [];
  const opps: Opportunity[] = [];
  const buyers: Buyer[] = [];

  const makeActs = (week: Week, type: ActivityType, n: number, days: string[], extra?: () => Partial<Activity>) => {
    for (let i = 0; i < n; i++) {
      const bandId = rnd() < 0.7 ? week.bandId : pickBand();
      const hh = String(int(8, 17)).padStart(2, '0');
      const mm = String(int(0, 59)).padStart(2, '0');
      const meta = ACTIVITY_BY_TYPE[type];
      acts.push({
        ...base,
        id: uuid(),
        weekId: week.id,
        type,
        occurredAt: localTimeOn(pick(days), `${hh}:${mm}`).toISOString(),
        bandId,
        area: areaFor(bandId),
        outcome: rnd() < 0.7 ? pick(meta.outcomes).value : undefined,
        ...extra?.(),
      });
    }
  };

  for (let w = 8; w >= 0; w--) {
    const weekStart = addDaysKey(thisWeek, -7 * w);
    if (await db.weeks.where('weekStart').equals(weekStart).count()) continue;
    const isCurrent = w === 0;
    const bandId = pickBand();
    const week: Week = {
      ...base,
      id: uuid(),
      weekStart,
      bandId,
      area: areaFor(bandId),
      targets: { ...settings.targets },
      status: isCurrent ? 'active' : 'closed',
      closedAt: isCurrent ? undefined : localTimeOn(addDaysKey(weekStart, 4), '16:00').toISOString(),
      mondayNote: '',
      reviewNotes: [],
    };
    weeks.push(week);

    // Improvement over time: later weeks lean a bit stronger.
    const lift = (8 - w) / 8;
    let days = workDaysOfWeek(weekStart, settings.workDays);
    if (isCurrent) days = days.filter((d) => d < todayKey());
    if (!days.length) continue;
    const scale = isCurrent ? days.length / 5 : 1;
    const n = (lo: number, hi: number) => Math.round(int(lo, hi) * scale);

    makeActs(week, 'seller_conversation', n(14, 20) + Math.round(lift * 4), days);
    makeActs(week, 'valuation', n(1, 4), days);
    makeActs(week, 'mandate', n(0, 3), days, () => ({
      amount: int(12, 38) * 100_000_00,
      withinComps: rnd() < 0.35 + lift * 0.4,
      outcome: rnd() < 0.6 ? 'sole' : 'open',
    }));
    makeActs(week, 'viewing', n(2, 6), days, () => ({ preQualified: rnd() < 0.55 + lift * 0.35 }));
    makeActs(week, 'price_review', n(0, 3), days);
    makeActs(week, 'follow_up', n(2, 6), days);
    const offers = n(0, 3);
    makeActs(week, 'offer', offers, days, () => ({ outcome: 'submitted', amount: int(12, 38) * 100_000_00 }));
    makeActs(week, 'offer', Math.min(offers, n(0, 2)), days, () => ({ outcome: 'accepted', amount: int(12, 38) * 100_000_00 }));

    if (isCurrent) {
      const streets = ['12 Oak St', '7 Jacaranda Ave', 'Unit 14 La Montagne', '33 Rubida St', 'Erf 221 The Wilds'];
      streets.slice(0, 4).forEach((ref, i) => {
        const b = pickBand();
        opps.push({
          ...base,
          id: uuid(),
          weekId: week.id,
          ref,
          kind: i === 3 ? 'listing' : i % 2 ? 'seller' : 'buyer',
          bandId: b,
          area: areaFor(b),
          stage: (['lead', 'viewing', 'offer', 'lead'] as const)[i],
          nextAction: ['Send 3 comparable sales', 'Confirm second viewing', 'Chase bank for approval', 'Price conversation'][i],
          dueDate: addDaysKey(todayKey(), i - 1),
          isTop3: i < 3,
          stalled: i === 3,
        });
      });
      for (let i = 1; i <= 5; i++) {
        buyers.push({
          ...base,
          id: uuid(),
          weekId: week.id,
          ref: `Buyer B${i}`,
          budgetMax: int(12, 40) * 100_000_00,
          funding: pick(['pre_approved', 'cash', 'deposit', 'unknown'] as const),
          moveBy: addDaysKey(todayKey(), int(20, 120)),
          mustHaves: ['3 bedrooms', 'Garden', 'Near schools'].slice(0, int(1, 3)),
          dealBreaker: pick(['No complex', 'No stairs', 'No busy road', '']),
        });
      }
    }
  }

  await db.transaction('rw', [db.weeks, db.activities, db.opportunities, db.buyers], async () => {
    await db.weeks.bulkAdd(weeks);
    await db.activities.bulkAdd(acts);
    await db.opportunities.bulkAdd(opps);
    await db.buyers.bulkAdd(buyers);
  });
}

/**
 * Deletes every sample record. A sample week that has since collected real
 * entries (she started logging while sample data was on) is kept and simply
 * stops being a sample week — real data is never removed here.
 */
export async function removeDemoData(): Promise<void> {
  await db.transaction('rw', [db.weeks, db.activities, db.opportunities, db.buyers, db.reviews], async () => {
    await db.activities.filter((a) => !!a.isDemo).delete();
    await db.opportunities.filter((o) => !!o.isDemo).delete();
    await db.buyers.filter((b) => !!b.isDemo).delete();
    const demoWeeks = await db.weeks.filter((w) => !!w.isDemo).toArray();
    for (const w of demoWeeks) {
      const inUse =
        (await db.activities.where('weekId').equals(w.id).count()) +
        (await db.opportunities.where('weekId').equals(w.id).count()) +
        (await db.buyers.where('weekId').equals(w.id).count());
      if (inUse) {
        await db.weeks.update(w.id, { isDemo: undefined });
      } else {
        await db.weeks.delete(w.id);
        await db.reviews.where('weekId').equals(w.id).delete();
      }
    }
  });
}

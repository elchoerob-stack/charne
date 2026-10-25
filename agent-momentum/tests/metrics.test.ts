import { describe, expect, it } from 'vitest';
import {
  aggregate,
  computeWeekMetrics,
  currentStreak,
  dayGrid,
  newBests,
  personalBests,
  spread,
  todayQuotas,
} from '../src/lib/metrics';
import { act, closedWeek, many, week, WORK } from './helpers';

const W = week('2026-10-19');

describe('computeWeekMetrics', () => {
  it('counts each activity type exactly, ignoring deleted and other weeks', () => {
    const other = week('2026-10-12');
    const acts = [
      ...many(W, 'seller_conversation', 12),
      ...many(W, 'valuation', 3),
      ...many(W, 'mandate', 1),
      ...many(W, 'viewing', 5),
      ...many(W, 'price_review', 2),
      act(W, 'seller_conversation', 0, { deletedAt: '2026-10-20T10:00:00Z' }),
      ...many(other, 'valuation', 4),
    ];
    const m = computeWeekMetrics(W, acts, WORK, '2026-10-25');
    expect(m.actual).toEqual({ conversations: 12, valuations: 3, mandates: 1, viewings: 5, priceReviews: 2 });
    expect(m.attainment.conversations).toBeCloseTo(0.6);
    expect(m.attainment.viewings).toBeCloseTo(1.25);
  });

  it('activity score averages attainments, each capped at 100%', () => {
    const acts = [
      ...many(W, 'seller_conversation', 40), // 200% → capped to 100%
      ...many(W, 'valuation', 3), // 100%
      ...many(W, 'mandate', 1), // 50%
      // viewings 0%, price reviews 0%
    ];
    const m = computeWeekMetrics(W, acts, WORK, '2026-10-25');
    expect(m.activityScore).toBeCloseTo((1 + 1 + 0.5 + 0 + 0) / 5);
  });

  it('computes funnel conversions', () => {
    const acts = [
      ...many(W, 'seller_conversation', 20),
      ...many(W, 'valuation', 4),
      ...many(W, 'mandate', 2),
      ...many(W, 'viewing', 5),
      ...many(W, 'offer', 2, { outcome: 'submitted' }),
      act(W, 'offer', 1), // no outcome counts as submitted
      act(W, 'offer', 2, { outcome: 'accepted' }),
      act(W, 'offer', 2, { outcome: 'rejected' }),
    ];
    const m = computeWeekMetrics(W, acts, WORK, '2026-10-25');
    expect(m.convToVal).toBeCloseTo(0.2);
    expect(m.valToMandate).toBeCloseTo(0.5);
    expect(m.offersSubmitted).toBe(3);
    expect(m.offersAccepted).toBe(1);
    expect(m.viewingToOffer).toBeCloseTo(0.6);
    expect(m.offerToAccepted).toBeCloseTo(1 / 3);
  });

  it('returns null ratios instead of dividing by zero', () => {
    const m = computeWeekMetrics(W, [], WORK, '2026-10-25');
    expect(m.convToVal).toBeNull();
    expect(m.offerToAccepted).toBeNull();
    expect(m.preQualifiedRate).toBeNull();
    expect(m.activityScore).toBe(0);
  });

  it('pre-qualified and within-comps rates only count answered entries', () => {
    const acts = [
      act(W, 'viewing', 0, { preQualified: true }),
      act(W, 'viewing', 0, { preQualified: false }),
      act(W, 'viewing', 0, { preQualified: true }),
      act(W, 'viewing', 0), // not answered
      act(W, 'mandate', 0, { withinComps: false }),
    ];
    const m = computeWeekMetrics(W, acts, WORK, '2026-10-25');
    expect(m.preQualifiedRate).toBeCloseTo(2 / 3);
    expect(m.preQualifiedAnswered).toBe(3);
    expect(m.withinCompsRate).toBe(0);
  });

  it('groups offers and accepted deals by band and area', () => {
    const acts = [
      act(W, 'offer', 0, { bandId: 'st', area: 'Equestria' }),
      act(W, 'offer', 0, { bandId: 'st', area: 'Equestria', outcome: 'accepted' }),
      act(W, 'offer', 0, { bandId: 'fam', area: 'Garsfontein' }),
    ];
    const m = computeWeekMetrics(W, acts, WORK, '2026-10-25');
    expect(m.byBand.st).toEqual({ activities: 2, offers: 1, accepted: 1 });
    expect(m.byBand.fam).toEqual({ activities: 1, offers: 1, accepted: 0 });
    expect(m.byArea.Equestria.accepted).toBe(1);
  });

  it('consistency only counts work days up to the as-of day', () => {
    const acts = [act(W, 'follow_up', 0), act(W, 'follow_up', 0), act(W, 'follow_up', 2)];
    const midweek = computeWeekMetrics(W, acts, WORK, '2026-10-21'); // Wed
    expect(midweek.workDaysElapsed).toBe(3);
    expect(midweek.activeDays).toBe(2);
    const full = computeWeekMetrics(W, acts, WORK, '2026-10-25');
    expect(full.consistency).toBeCloseTo(2 / 5);
  });

  it('places activities in the Johannesburg day, not UTC', () => {
    // 23:30 SAST on Monday is 21:30 UTC Monday; 00:30 SAST Tuesday is 22:30 UTC Monday.
    const late = act(W, 'follow_up', 0, { occurredAt: '2026-10-19T21:30:00Z' });
    const early = act(W, 'follow_up', 0, { occurredAt: '2026-10-19T22:30:00Z' });
    const grid = dayGrid(W, [late, early], WORK);
    expect(grid.conversations.map((c) => c.day)).toEqual(['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23']);
    const m = computeWeekMetrics(W, [late, early], WORK, '2026-10-25');
    expect(m.activeDays).toBe(2);
  });
});

describe('aggregate', () => {
  it('sums counts and targets, then recomputes ratios', () => {
    const a = closedWeek('2026-10-05', { seller_conversation: 20, valuation: 2 });
    const b = closedWeek('2026-10-12', { seller_conversation: 10, valuation: 4 });
    const agg = aggregate([a, b])!;
    expect(agg.actual.conversations).toBe(30);
    expect(agg.targets.conversations).toBe(40);
    expect(agg.convToVal).toBeCloseTo(6 / 30);
    expect(agg.attainment.conversations).toBeCloseTo(0.75);
  });
  it('returns null for no weeks', () => expect(aggregate([])).toBeNull());
});

describe('spread and quotas', () => {
  it('spreads a target over days, front-loading the remainder', () => {
    expect(spread(20, 5)).toEqual([4, 4, 4, 4, 4]);
    expect(spread(3, 5)).toEqual([1, 1, 1, 0, 0]);
    expect(spread(7, 3)).toEqual([3, 2, 2]);
  });

  it("today's aim is what's left divided by the work days left, including today", () => {
    // Wed 21 Oct: 8 conversations done Mon–Tue, 2 today
    const acts = [...many(W, 'seller_conversation', 8).map((a) => ({ ...a, occurredAt: '2026-10-19T08:00:00Z' })),
      ...many(W, 'seller_conversation', 2).map((a) => ({ ...a, occurredAt: '2026-10-21T08:00:00Z' }))];
    const q = todayQuotas(W, acts, WORK, '2026-10-21').find((x) => x.key === 'conversations')!;
    expect(q.done).toBe(10);
    expect(q.doneToday).toBe(2);
    expect(q.aimToday).toBe(4); // (20 - 8) / 3 days
  });

  it('suggests nothing on a day off', () => {
    const q = todayQuotas(W, [], WORK, '2026-10-24');
    expect(q.every((x) => x.aimToday === 0)).toBe(true);
  });
});

describe('streak', () => {
  const active = new Set(['2026-10-15', '2026-10-16', '2026-10-19', '2026-10-20']);
  it('counts back over work days and skips the weekend', () => {
    expect(currentStreak(active, '2026-10-20', WORK)).toBe(4);
  });
  it("doesn't break on today before anything is logged", () => {
    expect(currentStreak(active, '2026-10-21', WORK)).toBe(4);
  });
  it('breaks on a missed work day', () => {
    expect(currentStreak(active, '2026-10-22', WORK)).toBe(0);
  });
});

describe('personal bests', () => {
  const w1 = closedWeek('2026-09-28', { seller_conversation: 18, valuation: 2 });
  const w2 = closedWeek('2026-10-05', { seller_conversation: 22, valuation: 2 });
  const w3 = closedWeek('2026-10-12', { seller_conversation: 15, valuation: 4, accepted: 1 });

  it('finds the best week for each metric', () => {
    const bests = personalBests([w1, w2, w3]);
    expect(bests.find((b) => b.id === 'conversations')?.weekStart).toBe('2026-10-05');
    expect(bests.find((b) => b.id === 'valuations')?.value).toBe(4);
    expect(bests.find((b) => b.id === 'mandates')).toBeUndefined();
  });

  it('flags metrics where the latest week beats every earlier week', () => {
    expect(newBests(w3, [w1, w2]).map((d) => d.id)).toEqual(['score', 'valuations', 'accepted']);
    expect(newBests(w3, [])).toEqual([]);
  });
});

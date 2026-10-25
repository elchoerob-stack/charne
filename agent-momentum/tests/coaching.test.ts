import { describe, expect, it } from 'vitest';
import { allCards, evaluateCoaching, pickCards } from '../src/lib/coaching';
import { DEFAULT_BANDS } from '../src/config';
import { closedWeek } from './helpers';

const starts = ['2026-09-21', '2026-09-28', '2026-10-05', '2026-10-12'];

/** A solid, balanced week that fires nothing on its own. */
const solid = {
  seller_conversation: 20,
  valuation: 3,
  mandate: 2,
  viewing: 4,
  price_review: 2,
  offer: 1,
};
const solidExtra = { viewing: { preQualified: true }, mandate: { withinComps: true } };

const rules = (cards: { rule: number }[]) => cards.map((c) => c.rule);

describe('coaching', () => {
  it('stays quiet until two weeks are closed', () => {
    expect(evaluateCoaching([closedWeek(starts[0], { seller_conversation: 25, valuation: 1 })])).toEqual([]);
  });

  it('a steady, balanced run fires no tips', () => {
    // Same numbers every week (so no personal bests), offers spread over bands.
    const bands = ['st', 'fam', 'est', 'st'];
    const ws = starts.map((s, i) => closedWeek(s, solid, { ...solidExtra, offer: { bandId: bands[i] } }));
    expect(allCards(ws)).toEqual([]);
  });

  it('rule 1: plenty of conversations but under 10% become valuations', () => {
    const ws = starts.slice(0, 2).map((s) => closedWeek(s, { ...solid, seller_conversation: 25, valuation: 2 }, solidExtra));
    expect(rules(allCards(ws))).toContain(1);
  });

  it('rule 2: valuations on target but under 40% become mandates', () => {
    const ws = starts.slice(0, 2).map((s) => closedWeek(s, { ...solid, valuation: 3, mandate: 1 }, solidExtra));
    expect(rules(allCards(ws))).toContain(2);
  });

  it('rule 3: viewings on target but under 15% produce offers', () => {
    const ws = starts.slice(0, 2).map((s) => closedWeek(s, { ...solid, viewing: 8, offer: 0 }, solidExtra));
    expect(rules(allCards(ws))).toContain(3);
  });

  it('rule 4: pre-qualified viewing rate under 75%', () => {
    const ws = starts.slice(0, 2).map((s) => closedWeek(s, solid, { ...solidExtra, viewing: { preQualified: false } }));
    expect(rules(allCards(ws))).toContain(4);
  });

  it('rule 5: mandates within comps under 50%', () => {
    const ws = starts.slice(0, 2).map((s) => closedWeek(s, solid, { ...solidExtra, mandate: { withinComps: false } }));
    expect(rules(allCards(ws))).toContain(5);
  });

  it('rule 6: any target under 50% for two weeks running', () => {
    const ws = starts.slice(0, 2).map((s) => closedWeek(s, { ...solid, price_review: 0 }, solidExtra));
    const card = allCards(ws).find((c) => c.rule === 6)!;
    expect(card.title).toMatch(/price reviews/);
  });

  it("rule 6 doesn't fire when the gap was only one week", () => {
    const ws = [closedWeek(starts[0], solid, solidExtra), closedWeek(starts[1], { ...solid, price_review: 0 }, solidExtra)];
    expect(rules(allCards(ws))).not.toContain(6);
  });

  it('rule 7: one band produces at least 60% of offers', () => {
    const ws = starts.slice(0, 2).map((s) =>
      closedWeek(s, { ...solid, offer: 2 }, { ...solidExtra, offer: { bandId: 'fam' } }),
    );
    const card = allCards(ws, DEFAULT_BANDS).find((c) => c.rule === 7)!;
    expect(card.title).toContain('R1.5m – R3m');
  });

  it('rule 8: celebrates a new personal best', () => {
    const ws = [closedWeek(starts[0], solid, solidExtra), closedWeek(starts[1], { ...solid, seller_conversation: 26 }, solidExtra)];
    const card = allCards(ws).find((c) => c.rule === 8)!;
    expect(card.kind).toBe('celebrate');
  });

  it('only looks back over the rolling window', () => {
    const old = closedWeek('2026-08-31', { ...solid, seller_conversation: 30, valuation: 1 }, solidExtra);
    const recent = starts.map((s) => closedWeek(s, solid, solidExtra));
    expect(rules(allCards([old, ...recent]))).not.toContain(1);
  });

  it('shows at most two cards, keeping a seat for a celebration', () => {
    const cards = [1, 2, 3, 8].map((rule) => ({ rule, kind: rule === 8 ? 'celebrate' : 'tip', title: '', see: '', why: '', action: '' }) as const);
    expect(rules(pickCards([...cards]))).toEqual([1, 8]);
    expect(rules(pickCards(cards.filter((c) => c.rule !== 8)))).toEqual([1, 2]);
  });
});

import { COACHING, TARGET_KEYS, TARGET_LABEL } from '../config';
import type { Band } from '../types';
import { pct } from './format';
import { aggregate, newBests, type WeekMetrics } from './metrics';

// Rule-based coaching (section 8 of the brief). Pure: give it closed weeks,
// get back at most COACHING.maxCards cards. Thresholds live in config.ts.

export type CardKind = 'tip' | 'insight' | 'celebrate';

export interface CoachingCard {
  rule: number;
  kind: CardKind;
  title: string;
  /** What we see */
  see: string;
  /** Why it matters */
  why: string;
  /** One action for next week */
  action: string;
}

/**
 * @param closed  Closed weeks, oldest first.
 */
export function evaluateCoaching(closed: WeekMetrics[], bands: Band[] = []): CoachingCard[] {
  return pickCards(allCards(closed, bands));
}

/** Every card that fires, in priority order. Exported for tests. */
export function allCards(closed: WeekMetrics[], bands: Band[] = []): CoachingCard[] {
  const C = COACHING;
  if (closed.length < C.minClosedWeeks) return [];
  const window = closed.slice(-C.windowWeeks);
  const agg = aggregate(window)!;
  const weeksTxt = `the last ${window.length} weeks`;
  const cards: CoachingCard[] = [];

  const att = agg.attainment;

  if ((att.conversations ?? 0) >= C.convHighEffort && agg.convToVal != null && agg.convToVal < C.convToValLow) {
    cards.push({
      rule: 1,
      kind: 'tip',
      title: 'Lots of calls, few valuations',
      see: `${agg.actual.conversations} seller conversations led to ${agg.actual.valuations} valuations (${pct(agg.convToVal)}) over ${weeksTxt}.`,
      why: 'The effort is there — the conversation just isn’t turning into a booked appointment.',
      action: 'Open with a short local market update, then ask for the valuation on the same call.',
    });
  }

  if ((att.valuations ?? 0) >= 1 && agg.valToMandate != null && agg.valToMandate < C.valToMandateLow) {
    cards.push({
      rule: 2,
      kind: 'tip',
      title: 'Listings are slipping',
      see: `${agg.actual.valuations} valuations became ${agg.actual.mandates} mandates (${pct(agg.valToMandate)}) over ${weeksTxt}.`,
      why: 'Sellers are meeting you but signing with someone else, or not at all.',
      action: 'Bring 3 comparable sales and a written marketing plan to every valuation.',
    });
  }

  if ((att.viewings ?? 0) >= 1 && agg.viewingToOffer != null && agg.viewingToOffer < C.viewingToOfferLow) {
    cards.push({
      rule: 3,
      kind: 'tip',
      title: 'Buyers aren’t converting',
      see: `${agg.actual.viewings} viewings produced ${agg.offersSubmitted} offers (${pct(agg.viewingToOffer)}) over ${weeksTxt}.`,
      why: 'Viewings take hours. Each one should have a real chance of an offer.',
      action: 'Re-check budget and must-haves before you book the next viewing.',
    });
  }

  if (agg.preQualifiedRate != null && agg.preQualifiedRate < C.preQualifiedLow) {
    cards.push({
      rule: 4,
      kind: 'tip',
      title: 'Too many unqualified viewings',
      see: `Only ${pct(agg.preQualifiedRate)} of viewings were with pre-qualified buyers over ${weeksTxt}.`,
      why: 'Since the September rate hike, the office rule is: funding first, viewing second.',
      action: 'Confirm pre-approval, cash or deposit before you agree to any viewing.',
    });
  }

  if (agg.withinCompsRate != null && agg.withinCompsRate < C.withinCompsLow) {
    cards.push({
      rule: 5,
      kind: 'tip',
      title: 'Stock may be overpriced',
      see: `${pct(agg.withinCompsRate)} of new mandates were priced within comparable sales over ${weeksTxt}.`,
      why: 'Overpriced listings stall, and stalled listings eat your week.',
      action: 'Have the price-review conversation early — don’t wait for 8 quiet weeks.',
    });
  }

  const lastN = closed.slice(-C.persistentGapWeeks);
  if (lastN.length === C.persistentGapWeeks) {
    const gaps = TARGET_KEYS.filter((k) =>
      lastN.every((w) => w.attainment[k] != null && (w.attainment[k] as number) < C.persistentGapBelow),
    );
    if (gaps.length) {
      const names = gaps.map((k) => TARGET_LABEL[k].toLowerCase());
      const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0];
      cards.push({
        rule: 6,
        kind: 'tip',
        title: `Persistent gap: ${list}`,
        see: `Under half of target for ${C.persistentGapWeeks} weeks running.`,
        why: 'When something keeps slipping, it usually has no fixed home in the diary.',
        action: `Block a fixed time slot every work day for ${names[0]}.`,
      });
    }
  }

  const totalOffers = Object.values(agg.byBand).reduce((s, y) => s + y.offers, 0);
  if (totalOffers >= C.bandDominanceMinOffers) {
    const [topId, top] = Object.entries(agg.byBand).sort((a, b) => b[1].offers - a[1].offers)[0];
    if (top.offers / totalOffers >= C.bandDominance) {
      const band = bands.find((b) => b.id === topId);
      const name = band ? `${band.label} (${band.description.toLowerCase()})` : topId;
      cards.push({
        rule: 7,
        kind: 'insight',
        title: `Your strongest band is ${band?.label ?? topId}`,
        see: `${top.offers} of ${totalOffers} offers over ${weeksTxt} came from ${name}.`,
        why: 'Your effort pays best where buyers and your pricing already match.',
        action: 'Consider shifting more of your prospecting into this band next week.',
      });
    }
  }

  const latest = closed[closed.length - 1];
  const bests = newBests(latest, closed.slice(0, -1));
  if (bests.length) {
    const b = bests[0];
    cards.push({
      rule: 8,
      kind: 'celebrate',
      title: `New personal best: ${b.label.toLowerCase()}`,
      see: `${b.fmt(b.get(latest))} last week — your best yet.${bests.length > 1 ? ` (Plus ${bests.length - 1} more.)` : ''}`,
      why: 'Knowing what worked is how a good week becomes a normal week.',
      action: 'Jot down what you did differently, and do it again.',
    });
  }

  return cards;
}

/**
 * At most maxCards. A celebration always gets a seat if one fired, so a
 * strong week never goes unremarked behind a list of fixes.
 */
export function pickCards(cards: CoachingCard[]): CoachingCard[] {
  const max = COACHING.maxCards;
  const celebrate = cards.find((c) => c.kind === 'celebrate');
  const rest = cards.filter((c) => c.kind !== 'celebrate');
  if (!celebrate) return rest.slice(0, max);
  return [...rest.slice(0, max - 1), celebrate];
}

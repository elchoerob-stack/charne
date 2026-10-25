import type { ActivityType, Band, OppStage, TargetKey, Targets } from './types';

// Everything here is meant to be tuned once real data comes in. Metric and
// coaching logic read from this file; nothing else hard-codes a threshold.

export const TIME_ZONE = 'Africa/Johannesburg';

export const DEFAULT_TARGETS: Targets = {
  conversations: 20,
  valuations: 3,
  mandates: 2,
  viewings: 4,
  priceReviews: 2,
};

export const TARGET_KEYS: TargetKey[] = ['conversations', 'valuations', 'mandates', 'viewings', 'priceReviews'];

export const DEFAULT_BANDS: Band[] = [
  {
    id: 'st',
    label: 'R1m – R1.5m',
    description: 'Sectional title',
    areas: ['Equestria', 'La Montagne', 'Willow Park Manor', 'Mooikloof Ridge'],
  },
  {
    id: 'fam',
    label: 'R1.5m – R3m',
    description: 'Family homes',
    areas: ['Faerie Glen', 'Garsfontein', 'Moreleta Park', 'Wapadrand'],
  },
  {
    id: 'est',
    label: 'R3m – R4m',
    description: 'Estates',
    areas: ['Six Fountains', 'Silver Lakes', 'The Hills', 'The Wilds'],
  },
];

export const DEFAULT_AREAS = DEFAULT_BANDS.flatMap((b) => b.areas);

export const DEFAULT_REMINDERS = { planSun: '18:00', dailyAm: '08:00', reviewFri: '15:00' };

/** The Friday review "unlocks" at this local time. */
export const REVIEW_READY_HOUR = 15;

/** Undo window for a freshly logged activity, in ms. */
export const UNDO_MS = 10_000;

/** Nudge for a backup after this many days. */
export const BACKUP_REMINDER_DAYS = 28;

/** Attainment bars and labels cap at this so one big week doesn't flatten the chart. */
export const ATTAINMENT_DISPLAY_CAP = 1.5;

export interface ActivityMeta {
  type: ActivityType;
  label: string;
  /** Short label for rings and chips. */
  short: string;
  /** Singular noun for toasts: "Logged 1 seller conversation". */
  noun: string;
  targetKey?: TargetKey;
  outcomes: { value: string; label: string }[];
  defaultOutcome?: string;
  hint?: string;
  amountLabel?: string;
  check?: { field: 'preQualified' | 'withinComps'; label: string };
  color: string;
}

export const ACTIVITIES: ActivityMeta[] = [
  {
    type: 'seller_conversation',
    label: 'Seller conversation',
    short: 'Conversations',
    noun: 'seller conversation',
    targetKey: 'conversations',
    outcomes: [
      { value: 'follow_up', label: 'Follow up' },
      { value: 'valuation_booked', label: 'Valuation booked' },
      { value: 'no_interest', label: 'No interest' },
    ],
    hint: 'A meaningful conversation with a possible seller.',
    color: '#C9A227',
  },
  {
    type: 'valuation',
    label: 'Valuation',
    short: 'Valuations',
    noun: 'valuation',
    targetKey: 'valuations',
    outcomes: [
      { value: 'completed', label: 'Completed' },
      { value: 'mandate_likely', label: 'Mandate likely' },
      { value: 'mandate_unlikely', label: 'Mandate unlikely' },
      { value: 'no_show', label: 'No-show' },
    ],
    color: '#3B82F6',
  },
  {
    type: 'mandate',
    label: 'New mandate',
    short: 'Mandates',
    noun: 'mandate',
    targetKey: 'mandates',
    outcomes: [
      { value: 'sole', label: 'Sole' },
      { value: 'open', label: 'Open' },
    ],
    amountLabel: 'Asking price',
    check: { field: 'withinComps', label: 'Priced within comparable sales?' },
    color: '#10B981',
  },
  {
    type: 'viewing',
    label: 'Viewing',
    short: 'Viewings',
    noun: 'viewing',
    targetKey: 'viewings',
    outcomes: [
      { value: 'positive', label: 'Positive' },
      { value: 'offer_likely', label: 'Offer likely' },
      { value: 'neutral', label: 'Neutral' },
      { value: 'negative', label: 'Negative' },
    ],
    check: { field: 'preQualified', label: 'Buyer pre-qualified?' },
    color: '#8B5CF6',
  },
  {
    type: 'price_review',
    label: 'Price review',
    short: 'Price reviews',
    noun: 'price review',
    targetKey: 'priceReviews',
    outcomes: [
      { value: 'price_reduced', label: 'Price reduced' },
      { value: 'review_later', label: 'Review later' },
      { value: 'declined', label: 'Declined' },
    ],
    amountLabel: 'New price',
    hint: 'A price conversation on one of your existing listings.',
    color: '#F97316',
  },
  {
    type: 'offer',
    label: 'Offer',
    short: 'Offers',
    noun: 'offer',
    outcomes: [
      { value: 'submitted', label: 'Submitted' },
      { value: 'accepted', label: 'Accepted' },
      { value: 'countered', label: 'Countered' },
      { value: 'rejected', label: 'Rejected' },
    ],
    defaultOutcome: 'submitted',
    amountLabel: 'Offer amount',
    hint: 'Log it when it goes in, and again when it is accepted or rejected.',
    color: '#EC4899',
  },
  {
    type: 'follow_up',
    label: 'Follow-up',
    short: 'Follow-ups',
    noun: 'follow-up',
    outcomes: [
      { value: 'buyer', label: 'Buyer' },
      { value: 'seller', label: 'Seller' },
    ],
    color: '#64748B',
  },
];

export const ACTIVITY_BY_TYPE = Object.fromEntries(ACTIVITIES.map((a) => [a.type, a])) as Record<
  ActivityType,
  ActivityMeta
>;

export const TARGET_TO_TYPE: Record<TargetKey, ActivityType> = {
  conversations: 'seller_conversation',
  valuations: 'valuation',
  mandates: 'mandate',
  viewings: 'viewing',
  priceReviews: 'price_review',
};

export const TARGET_LABEL: Record<TargetKey, string> = {
  conversations: 'Seller conversations',
  valuations: 'Valuations',
  mandates: 'Mandates',
  viewings: 'Viewings',
  priceReviews: 'Price reviews',
};

export const STAGES: { value: OppStage; label: string }[] = [
  { value: 'lead', label: 'Lead' },
  { value: 'viewing', label: 'Viewing' },
  { value: 'offer', label: 'Offer' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'lost', label: 'Lost' },
];

export const FUNDING_LABEL = {
  pre_approved: 'Pre-approved',
  cash: 'Cash',
  deposit: 'Has deposit',
  unknown: 'Unknown',
} as const;

// ─── Coaching thresholds (section 8 of the brief) ───────────────────────────
export const COACHING = {
  /** Hide all coaching until this many weeks are closed. */
  minClosedWeeks: 2,
  /** Rolling window, in closed weeks, that the rules look back over. */
  windowWeeks: 4,
  maxCards: 2,
  convHighEffort: 0.9,
  convToValLow: 0.1,
  valToMandateLow: 0.4,
  viewingToOfferLow: 0.15,
  preQualifiedLow: 0.75,
  withinCompsLow: 0.5,
  persistentGapBelow: 0.5,
  persistentGapWeeks: 2,
  bandDominance: 0.6,
  /** Band dominance needs a few offers before it means anything. */
  bandDominanceMinOffers: 3,
};

/** Reference fields carry this hint everywhere: no personal details in this app. */
export const REF_HINT = 'Use a street, listing number or code — keep names and contact details in Keystone.';

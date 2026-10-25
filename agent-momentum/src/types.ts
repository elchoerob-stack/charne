// Every stored record carries a UUID, timestamps and an optional soft-delete
// marker, so a sync service can be added later without a migration.
export interface BaseRecord {
  id: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
  /** Set on records created by "Load sample data" so they can be removed in one tap. */
  isDemo?: boolean;
}

export type TargetKey = 'conversations' | 'valuations' | 'mandates' | 'viewings' | 'priceReviews';
export type Targets = Record<TargetKey, number>;

export type ActivityType =
  | 'seller_conversation'
  | 'valuation'
  | 'mandate'
  | 'viewing'
  | 'price_review'
  | 'offer'
  | 'follow_up';

export interface Band {
  id: string;
  label: string;
  description: string;
  areas: string[];
}

export interface Reminders {
  planSun: string;
  dailyAm: string;
  reviewFri: string;
}

export interface Settings {
  id: 'app';
  name: string;
  targets: Targets;
  bands: Band[];
  areas: string[];
  /** ISO weekday numbers, 1 = Monday … 7 = Sunday. */
  workDays: number[];
  reminders: Reminders;
  defaultBandId: string;
  defaultArea: string;
  theme: 'system' | 'light' | 'dark';
  pinHash?: string;
  pinSalt?: string;
  onboarded: boolean;
  lastBackupAt?: string;
  hintsSeen: string[];
  updatedAt: string;
}

export type WeekStatus = 'planning' | 'active' | 'closed';

export interface Week extends BaseRecord {
  /** Monday of the week, yyyy-MM-dd in Africa/Johannesburg. */
  weekStart: string;
  area: string;
  bandId: string;
  targets: Targets;
  status: WeekStatus;
  mondayNote: string;
  reviewNotes: string[];
  closedAt?: string;
}

export interface Activity extends BaseRecord {
  weekId: string;
  type: ActivityType;
  occurredAt: string;
  bandId?: string;
  area?: string;
  outcome?: string;
  /** Rand amount in cents. */
  amount?: number;
  ref?: string;
  note?: string;
  oppId?: string;
  preQualified?: boolean;
  withinComps?: boolean;
}

export type OppKind = 'buyer' | 'seller' | 'listing';
export type OppStage = 'lead' | 'viewing' | 'offer' | 'accepted' | 'lost';

export interface Opportunity extends BaseRecord {
  weekId: string;
  ref: string;
  kind: OppKind;
  bandId: string;
  area: string;
  stage: OppStage;
  nextAction: string;
  /** yyyy-MM-dd */
  dueDate?: string;
  isTop3: boolean;
  /** A listing flagged for a price review this week. */
  stalled?: boolean;
  carriedFromWeekId?: string;
}

export type Funding = 'pre_approved' | 'cash' | 'deposit' | 'unknown';

export interface Buyer extends BaseRecord {
  weekId: string;
  ref: string;
  /** Rand amount in cents. */
  budgetMax?: number;
  funding: Funding;
  /** yyyy-MM-dd */
  moveBy?: string;
  mustHaves: string[];
  dealBreaker: string;
}

export interface Miss {
  metric: TargetKey;
  reason: string;
  fix: string;
}

export interface Review extends BaseRecord {
  weekId: string;
  generatedAt: string;
  snapshot: unknown;
  misses: Miss[];
  wins: string[];
}

import Dexie, { type EntityTable } from 'dexie';
import type { Activity, Buyer, Opportunity, Review, Settings, Week } from '../types';

// Versioned from day one. To change the schema, add a new db.version(n)
// block below the old one — never edit a version that has shipped.
export class MomentumDB extends Dexie {
  settings!: EntityTable<Settings, 'id'>;
  weeks!: EntityTable<Week, 'id'>;
  activities!: EntityTable<Activity, 'id'>;
  opportunities!: EntityTable<Opportunity, 'id'>;
  buyers!: EntityTable<Buyer, 'id'>;
  reviews!: EntityTable<Review, 'id'>;

  constructor(name = 'agent-momentum') {
    super(name);
    this.version(1).stores({
      settings: 'id',
      weeks: 'id, &weekStart, status',
      activities: 'id, weekId, type, occurredAt, oppId',
      opportunities: 'id, weekId, stage, dueDate',
      buyers: 'id, weekId',
      reviews: 'id, &weekId',
    });
  }
}

export const db = new MomentumDB();

export const TABLES = ['settings', 'weeks', 'activities', 'opportunities', 'buyers', 'reviews'] as const;
export type TableName = (typeof TABLES)[number];

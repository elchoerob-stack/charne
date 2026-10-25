import {
  ClipboardCheck,
  DoorOpen,
  HandCoins,
  PenLine,
  Phone,
  Repeat,
  TrendingDown,
  type LucideIcon,
} from 'lucide-react';
import type { ActivityType } from '../types';

export const ACTIVITY_ICON: Record<ActivityType, LucideIcon> = {
  seller_conversation: Phone,
  valuation: ClipboardCheck,
  mandate: PenLine,
  viewing: DoorOpen,
  price_review: TrendingDown,
  offer: HandCoins,
  follow_up: Repeat,
};

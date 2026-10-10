import type { GameEvent } from '../model/events';
import type { Id } from '../model/ids';

/** Journal entries about another company that are public news. */
const PUBLIC_COMPANY_EVENTS: ReadonlySet<string> = new Set([
  'company_distressed',
  'company_bankrupt',
  'delisted',
  'credit_rating',
  'dismissals',
  'capex_started',
  'site_commissioned',
  'line_commissioned',
  'line_modernized',
  'asset_sold',
  'ai_price_war',
  'ai_price_truce',
  'ai_wage_outbid',
  'ai_counter_launch',
  'ai_targets_rival',
  'dividend_paid',
  'shares_issued',
  'shares_bought_back',
  'ipo',
  'takeover',
  'tender_offer_rejected',
  'integration_completed',
  // Stock market v3 (lot 3.3): offers, defenses, declarations and campaigns are public.
  'hostile_offer',
  'competing_offer',
  'tender_offer_raised',
  'tender_offer_withdrawn',
  'poison_pill',
  'stake_threshold',
  'activist_campaign',
  'ai_hostile_offer',
  'ai_counter_bid',
  'ai_white_knight',
  'ai_preempt',
  'ai_defense_buyback',
]);

/** Whether an observer controlling `own` may see a journal entry. */
export const isVisible = (event: GameEvent, own: ReadonlySet<Id>): boolean =>
  event.companyId === undefined ||
  own.has(event.companyId) ||
  PUBLIC_COMPANY_EVENTS.has(event.kind);

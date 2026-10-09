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
]);

/** Whether an observer controlling `own` may see a journal entry. */
export const isVisible = (event: GameEvent, own: ReadonlySet<Id>): boolean =>
  event.companyId === undefined ||
  own.has(event.companyId) ||
  PUBLIC_COMPANY_EVENTS.has(event.kind);

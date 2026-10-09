import type { AiMemory } from '../model/ai';

/** Memory of a planner that has not observed anything yet. */
export const newAiMemory = (): AiMemory => ({
  grudges: {},
  watchlist: [],
  rivalPrices: {},
  lastShare: -1,
  priceWarDiscount: 0,
  wageBoost: {},
  demandForecast: -1,
  priceForecast: {},
  lowUtilizationQuarters: 0,
});

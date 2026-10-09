import type { RawState } from './index';

type Obj = Record<string, unknown>;
const obj = (x: unknown): Obj => (typeof x === 'object' && x !== null ? (x as Obj) : {});
const list = (x: unknown): Obj[] => (Array.isArray(x) ? x.map(obj) : []);

/**
 * v4 → v5 (lot 2.1: agrifood). State: weather of each region, βd of the
 * market segments, listing fees of the last decisions. Config: perishability
 * and weather sensitivity of the commodities (none), βd of the segments (0),
 * perishability of the industry's goods (none), sector of each AI competitor
 * (the player's), AI listing parameters and per-sector profile overrides (none). The agri section stays absent: an
 * old game goes on without agrifood companies.
 */
export function migrateV4ToV5(state: RawState): RawState {
  for (const region of Object.values(obj(state.regions)).map(obj)) region.weather ??= 1;
  for (const market of Object.values(obj(state.productMarkets)).map(obj)) {
    for (const segment of list(market.segments)) segment.betaDistribution ??= 0;
  }
  for (const company of Object.values(obj(state.companies)).map(obj)) {
    if (company.lastDecisions) obj(company.lastDecisions).listing ??= {};
  }

  const config = obj(state.config);
  for (const commodity of Object.values(obj(obj(config.commodities).markets)).map(obj)) {
    commodity.perishRate ??= 0;
    commodity.weatherSensitivity ??= 0;
  }
  for (const market of Object.values(obj(obj(config.products).markets)).map(obj)) {
    for (const segment of list(market.segments)) segment.betaDistribution ??= 0;
  }
  obj(obj(config.sectors).industry).finishedGoodsPerishRate ??= 0;
  const scenario = obj(config.scenario);
  for (const competitor of list(scenario.aiCompetitors)) {
    competitor.sector ??= scenario.playerSector ?? 'industry';
  }
  obj(config.ai).listing ??= { targetDistribution: 0.9, maxShareOfRevenue: 0.05 };
  obj(config.ai).sectorProfiles ??= {};
  return state;
}

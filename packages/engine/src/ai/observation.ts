import { producingLines } from '../core/companies';
import type {
  ActiveEventView,
  CompetitorView,
  LaborPoolView,
  Observation,
  SelfView,
  SiteView,
} from '../model/ai';
import type { Company, Staff } from '../model/company';
import type { Id, LaborPoolKey } from '../model/ids';
import type { ProductMarket } from '../model/markets';
import type { GameState } from '../model/state';
import { plantConfigOf } from '../sectors/config';
import { operatorProductivity, siteCapacity, siteCeilings } from '../sectors/plant';
import { borrowingCapacity } from '../systems/finance/credit';
import { unemployed } from '../systems/labor/pools';
import { publishedStatements } from '../systems/stockmarket/fundamental';

/**
 * The only door from GameState to a planner (and to the PlayerView): the
 * actor's own company in full, the markets, and what is public about the
 * others (shelf prices, job ads, factories, published accounts, quotes). Returns a
 * deep copy: nothing the observer does can touch the state.
 */
export function observe(state: GameState, actorId: Id): Observation {
  const actor = state.actors[actorId];
  if (!actor) throw new Error(`Unknown actor ${actorId}`);
  const own = state.companies[actor.rootCompanyId];
  if (!own) throw new Error(`Unknown company ${actor.rootCompanyId}`);
  const lastClosed = state.meta.turn - 1;
  const ownLines = new Set(Object.keys(own.productLines));

  const labor: Record<LaborPoolKey, LaborPoolView> = {};
  for (const [key, pool] of Object.entries(state.labor) as [LaborPoolKey, LaborPoolView][]) {
    labor[key] = { ...pool, unemployed: Math.max(0, unemployed(state, key)) };
  }

  const productMarkets: Record<Id, ProductMarket> = {};
  for (const [id, market] of Object.entries(state.productMarkets)) {
    const allocated: Record<Id, number> = {};
    for (const [lineId, qty] of Object.entries(market.lastResult.allocated)) {
      if (ownLines.has(lineId)) allocated[lineId] = qty;
    }
    productMarkets[id] = { ...market, lastResult: { ...market.lastResult, allocated } };
  }

  const competitors: CompetitorView[] = Object.keys(state.companies)
    .sort()
    .filter((id) => id !== own.id)
    .map((id) => competitorView(state, state.companies[id] as Company, lastClosed));

  const holdings: Record<Id, number> = {};
  const float: Record<Id, number> = {};
  for (const [targetId, register] of Object.entries(state.stock.registry)) {
    const held = register[own.id] ?? 0;
    if (held > 0) holdings[targetId] = held;
    if (state.companies[targetId]?.listed) float[targetId] = register.public ?? 0;
  }

  const news: ActiveEventView[] = state.modifiers.map((m) => ({
    eventId: m.sourceId,
    target: { ...m.target },
    key: m.key,
    op: m.op,
    value: m.value,
    remaining: m.remaining,
  }));

  const observation: Observation = {
    turn: state.meta.turn,
    actorId,
    companyId: own.id,
    config: state.config,
    macro: state.macro,
    regions: state.regions,
    labor,
    commodities: state.commodities,
    productMarkets,
    self: selfView(state, own),
    competitors,
    stock: {
      index: state.stock.index,
      quotes: state.stock.quotes,
      float,
      holdings,
    },
    news,
  };
  if (actor.profileId) observation.profileId = actor.profileId;
  return structuredClone(observation);
}

function selfView(state: GameState, company: Company): SelfView {
  const cfg = plantConfigOf(state.config, company.sector);
  const ceilings = new Map(
    cfg ? siteCeilings(state, company).map((c) => [c.site.id, c.ceiling]) : [],
  );
  const sites: SiteView[] = Object.keys(company.sites)
    .sort()
    .map((id) => {
      const site = company.sites[id] as Company['sites'][Id];
      const lines = Object.values(site.lines);
      return {
        siteId: id,
        regionId: site.regionId,
        status: site.status,
        operationalLines: producingLines(site).length,
        pendingLines: lines.filter((l) => l.status !== 'operational').length,
        capacity: cfg ? siteCapacity(cfg, site) : 0,
        ceiling: Math.floor(ceilings.get(id) ?? 0),
      };
    });
  const productivity: Record<Id, number> = {};
  for (const regionId of new Set(sites.map((s) => s.regionId))) {
    if (cfg) productivity[regionId] = operatorProductivity(state, company, regionId);
  }
  return {
    company,
    sites,
    operatorProductivity: productivity,
    borrowingCapacity: borrowingCapacity(state.config, company),
    outputCeiling: sites.reduce((s, x) => s + x.ceiling, 0),
  };
}

function competitorView(state: GameState, company: Company, lastClosed: number): CompetitorView {
  const market = (marketId: Id) => state.productMarkets[marketId]?.lastResult;
  const actor = Object.values(state.actors).find((a) => a.rootCompanyId === company.id);
  return {
    companyId: company.id,
    name: company.name,
    actorName: actor?.name ?? '',
    sector: company.sector,
    hqRegionId: company.hqRegionId,
    status: company.status,
    listed: company.listed,
    brand: company.brand,
    creditRating: company.credit.rating,
    products: Object.keys(company.productLines)
      .sort()
      .map((id) => {
        const line = company.productLines[id] as Company['productLines'][Id];
        const result = market(line.marketId);
        const allocated = result?.allocated[id] ?? 0;
        const share = result?.shares[id] ?? 0;
        const sold = share * (result?.volume ?? 0);
        const view: CompetitorView['products'][number] = {
          lineId: id,
          marketId: line.marketId,
          price: line.price,
          quality: line.quality,
          stockout: allocated > 0 && sold < allocated * (1 - 1e-6),
          marketShare: share,
        };
        // Subscription products: the installed base is announced, the tech level shows.
        if (line.users !== undefined) {
          view.users = line.users;
          view.techLevel = line.techLevel ?? 0;
        }
        return view;
      }),
    jobOffers: Object.keys(company.workforce)
      .sort()
      .map((key) => company.workforce[key as keyof Company['workforce']] as Staff)
      .filter((staff) => staff.lastQuarter.requested > 0 && staff.lastQuarter.offered > 0)
      .map((staff) => ({
        regionId: staff.regionId,
        occupationId: staff.occupationId,
        wage: staff.lastQuarter.offered,
      })),
    sites: Object.keys(company.sites)
      .sort()
      .map((id) => {
        const site = company.sites[id] as Company['sites'][Id];
        return { regionId: site.regionId, status: site.status, lines: producingLines(site).length };
      }),
    published: company.listed
      ? publishedStatements(state, company, lastClosed).slice(
          -state.config.views.competitorHistoryQuarters,
        )
      : [],
  };
}

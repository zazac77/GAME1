import { isOperating, producingLines } from '../core/companies';
import { controlledBy, controllingActor, managementProfile } from '../core/control';
import type {
  ActiveEventView,
  CompetitorView,
  GroupMemberView,
  GroupView,
  LaborPoolView,
  ListingView,
  MnaView,
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
import { maxSharesKeepingControl } from '../systems/finance/equity';
import { unemployed } from '../systems/labor/pools';
import { blockSeller, boardPremium } from '../systems/mna/rules';
import { publishedStatements } from '../systems/stockmarket/fundamental';

/**
 * The only door from GameState to a planner (and to the PlayerView): the
 * observed company in full (by default the actor's root company; any company
 * the actor runs, or one nobody controls, for its management), the markets,
 * and what is public about the others (shelf prices, job ads, factories,
 * published accounts, quotes, controlling shareholders, companies for sale).
 * Returns a deep copy: nothing the observer does can touch the state.
 */
export function observe(state: GameState, actorId: Id, companyId?: Id): Observation {
  const ownId = companyId ?? state.actors[actorId]?.rootCompanyId;
  if (ownId === undefined) throw new Error(`Unknown actor ${actorId}`);
  const own = state.companies[ownId];
  if (!own) throw new Error(`Unknown company ${ownId}`);
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

  const actorOfGroup = controllingActor(state, own.id);
  const groupIds = actorOfGroup ? controlledBy(state, actorOfGroup) : [own.id];
  const group: GroupView = {
    isHead: actorOfGroup !== undefined && state.actors[actorOfGroup]?.rootCompanyId === own.id,
    companies: groupIds,
    members: Object.fromEntries(
      groupIds.flatMap((id) => {
        const c = state.companies[id];
        return c ? [[id, memberView(c)]] : [];
      }),
    ),
  };
  if (actorOfGroup) group.actorId = actorOfGroup;
  const turn = state.meta.turn;
  const mna: MnaView = {
    listings: state.mna.listings
      .filter((l) => l.expiresAt > turn)
      .map((l): ListingView => ({
        id: l.id,
        name: l.name,
        sector: l.sector,
        regionId: l.regionId,
        scale: l.scale,
        managementProfileId: l.managementProfileId,
        listedAt: l.listedAt,
        expiresAt: l.expiresAt,
        askingPrice: l.askingPrice,
        estimate: { ...l.estimate },
        netDebt: l.netDebt,
      })),
    diligence: state.mna.diligence.filter((d) => d.buyerId === own.id && d.orderedAt < turn),
    tenderOffers: state.stock.tenderOffers,
  };

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
    mna,
    group,
    news,
  };
  const profileId = managementProfile(state, own);
  if (profileId) observation.profileId = profileId;
  return structuredClone(observation);
}

function memberView(company: Company): GroupMemberView {
  const { pnl, balance } = company.books.current;
  const owes: Record<Id, number> = {};
  let overdraft = 0;
  for (const loan of company.loans) {
    if (loan.kind === 'overdraft') overdraft += loan.principal;
    if (loan.kind === 'group' && loan.lenderId) {
      owes[loan.lenderId] = (owes[loan.lenderId] ?? 0) + loan.principal;
    }
  }
  return {
    status: company.status,
    cash: balance.cash,
    overdraft,
    quarterlyCashCosts: Math.max(0, pnl.revenue - pnl.ebitda + Math.max(0, pnl.interest)),
    owes,
  };
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
    sharesWithinControl: Math.min(
      Number.MAX_SAFE_INTEGER,
      company.listed ? maxSharesKeepingControl(state, company) : 0,
    ),
  };
}

function competitorView(state: GameState, company: Company, lastClosed: number): CompetitorView {
  const market = (marketId: Id) => state.productMarkets[marketId]?.lastResult;
  // Its founder, else the actor controlling it (a company under a holding).
  const actor =
    Object.values(state.actors).find((a) => a.rootCompanyId === company.id) ??
    state.actors[controllingActor(state, company.id) ?? ''];
  const view: CompetitorView = {
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
    shares: company.sharesOutstanding,
  };
  const controller = controllingActor(state, company.id);
  if (controller) view.controllerId = controller;
  const asked = isOperating(company) ? boardPremium(state, company) : undefined;
  if (asked !== undefined) view.askedPremium = asked;
  const seller = blockSeller(state, company);
  if (seller) view.blockShares = state.stock.registry[company.id]?.[seller] ?? 0;
  return view;
}

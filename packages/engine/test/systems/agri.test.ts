import { describe, expect, it } from 'vitest';
import { resolveTurn } from '../../src';
import type { Company, CompanyDecisions, GameState } from '../../src';
import { laborPoolKey } from '../../src/core/keys';
import { farmlandLeft } from '../../src/sectors/agri/farm';
import { mainProductLine } from '../../src/sectors/plant';
import { depreciate } from '../../src/systems/accounting';
import { capexSystem, disposalValue } from '../../src/systems/capex';
import { commoditiesSystem } from '../../src/systems/commodities';
import { productionSystem } from '../../src/systems/production';
import { productsSystem } from '../../src/systems/products';
import { emptyDecisions, normalizeDecisions, validationSystem } from '../../src/systems/validation';
import {
  assertJsonSafe,
  newGame,
  playerCompanyId,
  playTurns,
  resolveAll,
  steadyDecisions,
} from '../helpers';

const firstOf = (state: GameState, sector: string): Company => {
  const company = Object.keys(state.companies)
    .sort()
    .map((id) => state.companies[id] as Company)
    .find((c) => c.sector === sector);
  if (!company) throw new Error(`no ${sector} company`);
  return company;
};
const farmOf = (company: Company) => Object.values(company.sites).find((s) => s.kind === 'farm');

describe('agrifood: world', () => {
  const state = newGame(21);
  const agri = Object.values(state.companies).filter((c) => c.sector === 'agri');
  const cfg = state.config.sectors.agri;

  it('gives each agri company a food plant, a farm, farm staff and shelf presence', () => {
    expect(agri).toHaveLength(3);
    for (const c of agri) {
      const farm = farmOf(c);
      expect(farm).toMatchObject({ regionId: c.hqRegionId, hectares: cfg?.farm.hectares });
      expect(farm?.landValue).toBeGreaterThan(0);
      expect(farm?.buildingBookValue).toBeGreaterThan(farm?.landValue ?? Infinity);
      const key = laborPoolKey(c.hqRegionId, 'occ_farmhand');
      expect(c.workforce[key]?.headcount).toBe(24);
      expect(Object.values(c.productLines)[0]?.distribution).toBe(cfg?.listing.initial);
      expect(c.inventory.com_milk?.qty).toBeGreaterThan(0);
    }
    for (const c of Object.values(state.companies).filter((x) => x.sector === 'industry')) {
      expect(Object.values(c.productLines)[0]?.distribution).toBeUndefined();
      expect(farmOf(c)).toBeUndefined();
    }
    const hq = agri[0]?.hqRegionId ?? '';
    expect(farmlandLeft(state, hq)).toBe(
      (cfg?.farm.landByRegion[hq] ?? 0) - (cfg?.farm.hectares ?? 0),
    );
  });

  it('lets the player start in agrifood', () => {
    let s = newGame(4, { scenario: { playerSector: 'agri' } });
    const player = s.companies[playerCompanyId(s)];
    expect(player?.sector).toBe('agri');
    expect(Object.values(s.companies).filter((c) => c.sector === 'agri')).toHaveLength(4);
    s = playTurns(s, 4);
    expect(s.companies[playerCompanyId(s)]?.status).toBe('active');
    expect(s.companies[playerCompanyId(s)]?.books.current.pnl.revenue).toBeGreaterThan(0);
    assertJsonSafe(s);
  });
});

describe('agrifood: farms', () => {
  const SYSTEMS = [validationSystem, commoditiesSystem, productionSystem];
  /** The quarter before the turn counter reaches `turn`, with an agri company. */
  const at = (turn: number) => {
    const state = newGame(22, { scenario: { initialJitter: 0 } });
    state.meta.turn = turn;
    const company = firstOf(state, 'agri');
    return { state, company };
  };
  const harvestOf = (
    ctx: { events: { kind: string; companyId?: string; data?: object }[] },
    id: string,
  ) =>
    ctx.events.find((e) => e.kind === 'harvest' && e.companyId === id)?.data as
      { qty: number; hectares: number } | undefined;

  it('harvests once a year, in T3: hectares × yield × weather × staffing × agronomists', () => {
    const { state, company } = at(2);
    const F = state.config.sectors.agri?.farm;
    if (!F) throw new Error('no agri');
    const { state: next, ctx } = resolveAll(state, [emptyDecisions(company.id)], {
      systems: SYSTEMS,
    });
    const harvest = harvestOf(ctx, company.id);
    expect(harvest?.qty).toBeCloseTo(
      F.hectares * F.yieldPerHectare * (1 + F.agronomistYieldBonus),
      6,
    );
    // Carried at the cost of the fertilizer spread (wages are period costs).
    const fertilizer =
      F.hectares *
      F.fertilizerPerHectare *
      (state.commodities[F.fertilizerId]?.spotPrice ?? 0) *
      (1 + state.config.commodities.spotPremium);
    const purchases = ctx.ledger(company.id).purchases;
    expect(purchases).toBeGreaterThanOrEqual(fertilizer * (1 - 1e-9));
    const lot = next.companies[company.id]?.inventory[F.cropId];
    expect(lot?.qty).toBeGreaterThan(company.inventory[F.cropId]?.qty ?? 0);

    const quiet = at(1);
    const off = resolveAll(quiet.state, [emptyDecisions(quiet.company.id)], { systems: SYSTEMS });
    expect(harvestOf(off.ctx, quiet.company.id)).toBeUndefined();
  });

  it('follows the weather and needs its farmhands', () => {
    const base = at(2);
    const full = harvestOf(
      resolveAll(base.state, [emptyDecisions(base.company.id)], { systems: SYSTEMS }).ctx,
      base.company.id,
    );
    const poor = at(2);
    const region = poor.state.regions[poor.company.hqRegionId];
    if (region) region.weather = 0.5;
    const half = harvestOf(
      resolveAll(poor.state, [emptyDecisions(poor.company.id)], { systems: SYSTEMS }).ctx,
      poor.company.id,
    );
    expect(half?.qty).toBeCloseTo((full?.qty ?? 0) * 0.5, 6);

    const idle = at(2);
    const c = idle.state.companies[idle.company.id] as Company;
    const key = laborPoolKey(c.hqRegionId, 'occ_farmhand');
    c.workforce = Object.fromEntries(Object.entries(c.workforce).filter(([k]) => k !== key));
    const { ctx } = resolveAll(idle.state, [emptyDecisions(c.id)], { systems: SYSTEMS });
    expect(harvestOf(ctx, c.id)?.qty).toBe(0);
  });

  it('buys farms within the farmland of the region and the farm limit', () => {
    const state = newGame(23);
    const agri = firstOf(state, 'agri');
    const industry = firstOf(state, 'industry');
    for (const c of Object.values(state.companies)) c.books.current.balance.cash = 1e9;
    const region = agri.hqRegionId;
    const left = farmlandLeft(state, region);
    const hectares = state.config.sectors.agri?.farm.hectares ?? 1;
    const wanted = Math.floor(left / hectares) + 1;
    const d = emptyDecisions(agri.id);
    for (let i = 0; i < wanted; i++) d.capex.push({ kind: 'buy_farm', regionId: region });
    const { decisions, issues } = normalizeDecisions(state, agri, d);
    expect(decisions.capex).toHaveLength(wanted - 1);
    expect(issues.some((i) => i.code === 'limit')).toBe(true);

    const refused = emptyDecisions(industry.id);
    refused.capex.push({ kind: 'buy_farm', regionId: region });
    expect(normalizeDecisions(state, industry, refused).issues[0]?.code).toBe('not_available');

    const onFarm = emptyDecisions(agri.id);
    onFarm.capex.push({ kind: 'add_line', siteId: farmOf(agri)?.id ?? '' });
    expect(normalizeDecisions(state, agri, onFarm).issues[0]?.code).toBe('invalid_state');
  });

  it('sets a bought farm up in a quarter; its land is never depreciated', () => {
    const state = newGame(24);
    const agri = firstOf(state, 'agri');
    const company = state.companies[agri.id] as Company;
    company.books.current.balance.cash = 1e9;
    const d = emptyDecisions(agri.id);
    d.capex.push({ kind: 'buy_farm', regionId: 'reg_sud' });
    const first = resolveAll(state, [d], { systems: [validationSystem, capexSystem] });
    const farms = Object.values(first.state.companies[agri.id]?.sites ?? {}).filter(
      (s) => s.kind === 'farm' && s.regionId === 'reg_sud',
    );
    expect(farms).toHaveLength(1);
    expect(farms[0]?.status).toBe('under_construction');
    expect(first.ctx.ledger(agri.id).capex).toBeCloseTo(farms[0]?.buildingBookValue ?? 0, 6);
    expect(farmlandLeft(first.state, 'reg_sud')).toBe(
      farmlandLeft(state, 'reg_sud') - (farms[0]?.hectares ?? 0),
    );
    first.state.meta.turn += 1;
    const second = resolveAll(first.state, [], { systems: [validationSystem, capexSystem] });
    const farm = Object.values(second.state.companies[agri.id]?.sites ?? {}).find(
      (s) => s.id === farms[0]?.id,
    );
    expect(farm?.status).toBe('operational');

    const owner = second.state.companies[agri.id] as Company;
    for (let i = 0; i < 200; i++) depreciate(owner);
    expect(farm?.buildingBookValue).toBeGreaterThan(0);
    const site = owner.sites[farm?.id ?? ''];
    expect(site?.buildingBookValue).toBeCloseTo(site?.landValue ?? -1, 6);
    // Farmland resells near its book value, unlike the plant's specific assets.
    const sale = disposalValue(second.state, owner, { kind: 'sell_site', siteId: site?.id ?? '' });
    expect(sale).toBeCloseTo((site?.buildingBookValue ?? 0) * 0.9, 6);
  });
});

describe('agrifood: retail listing', () => {
  const SYSTEMS = [validationSystem, productsSystem];
  const setup = () => {
    const state = newGame(25, { scenario: { initialJitter: 0 } });
    const company = firstOf(state, 'agri');
    const line = mainProductLine(state, company);
    if (!line) throw new Error('no line');
    return { state, company, line };
  };
  const withFees = (id: string, lineId: string, fees: number): CompanyDecisions => {
    const d = emptyDecisions(id);
    d.listing[lineId] = fees;
    return d;
  };

  it('fees keep the shelves, and the shelves sell', () => {
    const { state, company, line } = setup();
    const L = state.config.sectors.agri?.listing;
    if (!L) throw new Error('no agri');
    const paid = resolveAll(state, [withFees(company.id, line.id, 300_000)], {
      systems: SYSTEMS,
    });
    const unpaid = resolveAll(state, [emptyDecisions(company.id)], { systems: SYSTEMS });
    const d0 = line.distribution ?? 0;
    const kept = d0 * (1 - L.decay);
    const gain = 1 - Math.exp(-300_000 / L.feeUnit);
    expect(paid.state.companies[company.id]?.productLines[line.id]?.distribution).toBeCloseTo(
      kept + (1 - kept) * gain,
      12,
    );
    expect(unpaid.state.companies[company.id]?.productLines[line.id]?.distribution).toBeCloseTo(
      kept,
      12,
    );
    const share = (r: typeof paid) =>
      r.state.productMarkets.mkt_food?.lastResult.allocated[line.id];
    expect(share(paid)).toBeGreaterThan(share(unpaid) ?? Infinity);
    expect(paid.ctx.ledger(company.id).marketing).toBeCloseTo(300_000, 6);
  });

  it('is refused outside agrifood', () => {
    const state = newGame(26);
    const industry = firstOf(state, 'industry');
    const line = mainProductLine(state, industry);
    if (!line) throw new Error('no line');
    const { decisions, issues } = normalizeDecisions(
      state,
      industry,
      withFees(industry.id, line.id, 100_000),
    );
    expect(decisions.listing).toEqual({});
    expect(issues[0]).toMatchObject({ path: `listing.${line.id}`, code: 'invalid_value' });
  });
});

describe('agrifood: AI', () => {
  it('the agri planners pay their listing, staff their farms and stay in business', () => {
    let state = newGame(27);
    for (let t = 0; t < 6; t++) {
      state = resolveTurn(state, [steadyDecisions(state, playerCompanyId(state))]).state;
    }
    const agri = Object.values(state.companies).filter((c) => c.sector === 'agri');
    const target = state.config.ai.listing.targetDistribution;
    for (const c of agri) {
      expect(c.status).toBe('active');
      const line = mainProductLine(state, c);
      expect(c.lastDecisions?.listing[line?.id ?? '']).toBeGreaterThan(0);
      // At the target, unless a bad quarter made validation cut the fees.
      expect(line?.distribution).toBeGreaterThan(target - 0.05);
      expect(line?.distribution).toBeLessThan(target + 0.005);
      const farmhands = c.workforce[laborPoolKey(c.hqRegionId, 'occ_farmhand')]?.headcount ?? 0;
      expect(farmhands).toBeGreaterThan(18);
      expect(c.books.current.pnl.revenue).toBeGreaterThan(0);
    }
    // Thinner markups than in industry (config.ai.sectorProfiles).
    const premium = agri.find(
      (c) =>
        Object.values(state.actors).find((a) => a.rootCompanyId === c.id)?.profileId === 'premium',
    );
    expect(Object.values(premium?.productLines ?? {})[0]?.qualityTarget).toBe(
      state.config.ai.sectorProfiles.agri?.premium?.qualityTarget,
    );
  });
});

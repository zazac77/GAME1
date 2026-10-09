import { describe, expect, it } from 'vitest';
import { defaultDecisions, getPlayerView, previewDecisions, resolveTurn } from '../../src';
import type { Company, CompanyDecisions, GameState } from '../../src';
import { defaultConfig } from '../../src/config/default';
import type { DeepPartial, GameConfig } from '../../src/config/schema';
import { laborPoolKey } from '../../src/core/keys';
import { sectorModule } from '../../src/sectors';
import { sectorProductLine } from '../../src/sectors/config';
import { cloudPerUser } from '../../src/sectors/tech/team';
import { disposalValue } from '../../src/systems/capex';
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

const TECH = defaultConfig.sectors.tech;
if (!TECH) throw new Error('no tech in the default config');

/** A game whose player runs a SaaS company (the AI play the others), without jitter or events. */
const setup = (seed = 31, overrides: DeepPartial<GameConfig> = {}) => {
  const state = newGame(seed, {
    ...overrides,
    scenario: { playerSector: 'tech', initialJitter: 0, ...overrides.scenario },
    events: { definitions: [] },
  });
  const id = playerCompanyId(state);
  const company = state.companies[id] as Company;
  const line = sectorProductLine(state.config, company);
  if (!line) throw new Error('no product line');
  return { state, id, company, line };
};

const staffOf = (c: Company | undefined, occupationId: string) =>
  Object.values(c?.workforce ?? {})
    .filter((s) => s.occupationId === occupationId)
    .reduce((n, s) => n + s.headcount, 0);

const lineIn = (state: GameState, id: string) => {
  const company = state.companies[id];
  return company ? sectorProductLine(state.config, company) : undefined;
};

describe('tech: world', () => {
  it('lets the player start in tech, next to 3 tech AI', () => {
    let { state } = setup(4);
    const player = state.companies[playerCompanyId(state)];
    expect(player?.sector).toBe('tech');
    const tech = Object.values(state.companies).filter((c) => c.sector === 'tech');
    expect(tech).toHaveLength(4);
    // The AI of the player's sector leave the player's HQ region aside.
    expect(tech.filter((c) => c.hqRegionId === player?.hqRegionId)).toHaveLength(1);
    state = playTurns(state, 4);
    const after = state.companies[playerCompanyId(state)];
    expect(after?.status).toBe('active');
    expect(after?.books.current.pnl.revenue).toBeGreaterThan(0);
    expect(lineIn(state, after?.id ?? '')?.users).toBeGreaterThan(0);
    assertJsonSafe(state);
  });
});

describe('tech: subscriptions', () => {
  const SYSTEMS = [validationSystem, productionSystem, productsSystem];
  const sell = (state: GameState, d: CompanyDecisions) =>
    resolveAll(state, [d], { systems: SYSTEMS });

  it('bills the subscribers of the quarter and serves them from the cloud', () => {
    const { state, id, line } = setup();
    const users = line.users ?? 0;
    const { state: next, ctx } = sell(state, emptyDecisions(id));
    const after = lineIn(next, id);
    const churn = after?.churn ?? 0;
    const acquired = after?.acquired ?? 0;
    expect(churn).toBeGreaterThanOrEqual(TECH.subscription.minChurn);
    expect(churn).toBeLessThanOrEqual(TECH.subscription.maxChurn);
    expect(acquired).toBeGreaterThan(0);
    expect(after?.users).toBeCloseTo(users * (1 - churn) + acquired, 6);
    const billed = (users + (after?.users ?? 0)) / 2;
    const ledger = ctx.ledger(id);
    expect(ledger.revenue).toBeCloseTo(billed * line.price, 4);
    expect(ledger.unitsSold).toBeCloseTo(billed, 6);
    // Cloud bought at consumption, straight to the cost of sales (no stock).
    const cloud =
      billed *
      TECH.cloudPerUser *
      (state.commodities[TECH.cloudId]?.spotPrice ?? 0) *
      (1 + state.config.commodities.spotPremium);
    expect(ledger.cogs).toBeCloseTo(cloud, 4);
    expect(ledger.purchases).toBeCloseTo(cloud, 4);
    expect(next.companies[id]?.inventory).toEqual({});
    // Shares of the billed subscribers; nothing is lost for lack of stock.
    const result = next.productMarkets.mkt_software?.lastResult;
    const shares = Object.values(result?.shares ?? {}).reduce((s, x) => s + x, 0);
    expect(shares).toBeCloseTo(1, 9);
    expect(result?.allocated[line.id]).toBeCloseTo(billed, 6);
    expect(result?.volume).toBeCloseTo(result?.demand ?? -1, 6);
  });

  it('a dearer product wins fewer subscribers and loses more of them', () => {
    const { state, id, line } = setup();
    const base = lineIn(sell(state, emptyDecisions(id)).state, id);
    const d = emptyDecisions(id);
    d.pricing[line.id] = { price: line.price * 1.3 };
    const dear = lineIn(sell(state, d).state, id);
    expect(dear?.acquired).toBeLessThan(base?.acquired ?? 0);
    expect(dear?.churn).toBeGreaterThan(base?.churn ?? Infinity);
  });

  it('a larger installed base wins more new subscribers (network effect)', () => {
    const { state, id, line } = setup();
    const base = lineIn(sell(state, emptyDecisions(id)).state, id);
    const big = structuredClone(state);
    const bigLine = lineIn(big, id);
    if (bigLine) bigLine.users = 2 * (line.users ?? 0);
    const after = lineIn(sell(big, emptyDecisions(id)).state, id);
    expect(after?.acquired).toBeGreaterThan(base?.acquired ?? Infinity);
  });

  it('lagging the technology frontier costs subscribers', () => {
    const { state, id } = setup();
    const base = lineIn(sell(state, emptyDecisions(id)).state, id);
    const dated = structuredClone(state);
    const datedLine = lineIn(dated, id);
    if (datedLine) datedLine.techLevel = (datedLine.techLevel ?? 0) - 0.3;
    const after = lineIn(sell(dated, emptyDecisions(id)).state, id);
    expect(after?.acquired).toBeLessThan(base?.acquired ?? 0);
    expect(after?.churn).toBeGreaterThan(base?.churn ?? Infinity);
  });

  it('quality follows the seniors and the developers kept on maintenance', () => {
    const { state, id, company } = setup();
    const quality = (s: GameState) =>
      lineIn(resolveAll(s, [emptyDecisions(id)], { systems: SYSTEMS }).state, id)?.quality ?? 0;
    const groupOf = (s: GameState, occupationId: string) =>
      s.companies[id]?.workforce[laborPoolKey(company.hqRegionId, occupationId)];
    const base = quality(state);
    const short = structuredClone(state);
    // 40 developers (and seniors at their ratio) maintain 40 × 500 subscribers, a fraction of the base.
    const devs = groupOf(short, TECH.developerOccupationId);
    const fewSeniors = groupOf(short, TECH.seniorOccupationId);
    if (devs) devs.headcount = 40;
    if (fewSeniors) fewSeniors.headcount = 6;
    expect(quality(short)).toBeLessThan(base - 5);
    const junior = structuredClone(state);
    const seniors = groupOf(junior, TECH.seniorOccupationId);
    if (seniors) seniors.headcount = 0;
    expect(quality(junior)).toBeLessThan(base - 5);
  });
});

describe('tech: R&D in developer-quarters', () => {
  /** Deterministic projects that a small team completes in one quarter. */
  const fast: DeepPartial<GameConfig> = {
    sectors: {
      tech: {
        rnd: {
          product: { effort: 30, releaseGain: 0.12, imitation: 0.3 },
          process: { effort: 30, cloudSavingPerLevel: 0.08, qualityPerLevel: 2 },
          maxEffortShare: 1,
          progressNoise: 0,
          outcomeNoise: 0,
          seniorBonus: 0,
          productManagerBonus: 0,
        },
      },
    },
  };
  const play = (state: GameState, id: string, rnd: CompanyDecisions['rnd']) => {
    const d = steadyDecisions(state, id);
    d.rnd = rnd;
    return resolveAll(state, [d]);
  };

  it('staffs a project with developers: their wages move to R&D, progress in developer-quarters', () => {
    const { state, id } = setup();
    const without = play(state, id, []);
    const { state: next, ctx } = play(state, id, [{ type: 'product', budget: 0, developers: 20 }]);
    const project = next.companies[id]?.rnd[0];
    expect(project).toMatchObject({ type: 'product', effort: TECH.rnd.product.effort });
    // 20 developers × (1 + senior bonus) at the target senior ratio, within the noise.
    const expected = (20 * (1 + TECH.rnd.seniorBonus)) / TECH.rnd.product.effort;
    expect(project?.progress).toBeGreaterThanOrEqual(
      expected * (1 - TECH.rnd.progressNoise) * 0.95,
    );
    expect(project?.progress).toBeLessThanOrEqual(expected * (1 + TECH.rnd.progressNoise) + 1e-9);
    const ledger = ctx.ledger(id);
    expect(ledger.rnd).toBeGreaterThan(0);
    expect(project?.spent).toBeCloseTo(ledger.rnd, 6);
    // Same payroll: the R&D developers' wages are reclassified, not added.
    expect(ledger.wages + ledger.rnd).toBeCloseTo(without.ctx.ledger(id).wages, 4);
    expect(next.companies[id]?.books.current.pnl.rnd).toBeCloseTo(ledger.rnd, 6);
  });

  it('a release raises the tech level, closes part of the lag, never beyond frontier + maxLead', () => {
    const { state, id } = setup(32, fast);
    const before = lineIn(state, id)?.techLevel ?? 0;
    const frontier =
      (state.productMarkets.mkt_software?.techFrontier ?? 0) + TECH.frontier.advancePerQuarter;
    const { state: next, report } = play(state, id, [
      { type: 'product', budget: 0, developers: 30 },
    ]);
    expect(next.productMarkets.mkt_software?.techFrontier).toBeCloseTo(frontier, 12);
    expect(lineIn(next, id)?.techLevel).toBeCloseTo(before + 0.12 + 0.3 * (frontier - before), 9);
    expect(next.companies[id]?.rnd).toEqual([]);
    expect(report.events.some((e) => e.kind === 'rnd_completed' && e.companyId === id)).toBe(true);

    const ahead = structuredClone(state);
    const line = lineIn(ahead, id);
    if (line) line.techLevel = frontier + 0.1;
    const capped = play(ahead, id, [{ type: 'product', budget: 0, developers: 30 }]).state;
    expect(lineIn(capped, id)?.techLevel).toBeCloseTo(frontier + TECH.frontier.maxLead, 9);
  });

  it('a platform level cuts the cloud each subscriber needs', () => {
    const { state, id } = setup(33, fast);
    const { state: next } = play(state, id, [{ type: 'process', budget: 0, developers: 30 }]);
    const company = next.companies[id] as Company;
    const line = lineIn(next, id);
    if (!line) throw new Error('no product line');
    expect(company.processLevel).toBe(1);
    const perUnit = sectorModule('tech')?.materialsPerUnit(next, company, line);
    expect(perUnit?.[TECH.cloudId]).toBeCloseTo(TECH.cloudPerUser * (1 - 0.08), 12);
    expect(cloudPerUser(TECH, 1)).toBeCloseTo(perUnit?.[TECH.cloudId] ?? 0, 12);
  });

  it('the frontier advances every quarter and jumps with a disruptive innovation', () => {
    const { state, id } = setup();
    const f0 = state.productMarkets.mkt_software?.techFrontier ?? 0;
    const calm = resolveAll(state, [steadyDecisions(state, id)]).state;
    expect(calm.productMarkets.mkt_software?.techFrontier).toBeCloseTo(
      f0 + TECH.frontier.advancePerQuarter,
      12,
    );
    const shock = newGame(31, {
      scenario: { playerSector: 'tech', initialJitter: 0 },
      events: {
        definitions: defaultConfig.events.definitions
          .filter((d) => d.id === 'ev_disruptive_innovation')
          .map((d) => ({ ...d, probability: 1 })),
      },
    });
    const jumped = resolveAll(shock, [steadyDecisions(shock, id)]).state;
    expect(jumped.productMarkets.mkt_software?.techFrontier).toBeCloseTo(
      f0 + TECH.frontier.advancePerQuarter + 0.15,
      12,
    );
  });
});

describe('tech: validation and offices', () => {
  it('R&D is staffed with available developers, within what each project absorbs', () => {
    const { state, id, company } = setup();
    const d = emptyDecisions(id);
    d.rnd = [
      { type: 'product', budget: 500_000, developers: 500 },
      { type: 'process', budget: 0, developers: 500 },
    ];
    const { decisions, issues } = normalizeDecisions(state, company, d);
    expect(issues).toContainEqual(
      expect.objectContaining({ path: 'rnd[0].budget', code: 'invalid_value', applied: 0 }),
    );
    const [product, process] = decisions.rnd;
    expect(product?.budget).toBe(0);
    // ceil(maxEffortShare × effort / (1 + senior bonus)) developers.
    const cap = Math.ceil((TECH.rnd.maxEffortShare * TECH.rnd.product.effort) / 1.5 - 1e-9);
    expect(product?.developers).toBe(cap);
    const developers = staffOf(company, TECH.developerOccupationId);
    expect((product?.developers ?? 0) + (process?.developers ?? 0)).toBeLessThanOrEqual(developers);
    const outside = emptyDecisions(id);
    outside.rnd = [{ type: 'product', budget: 0, developers: -1 }];
    expect(normalizeDecisions(state, company, outside).issues[0]?.code).toBe('invalid_value');
  });

  it('hires need a free office seat', () => {
    const { state, id, company } = setup();
    const headcount = Object.values(company.workforce).reduce((n, s) => n + s.headcount, 0);
    const d = emptyDecisions(id);
    d.hr.push({
      regionId: company.hqRegionId,
      occupationId: TECH.developerOccupationId,
      hire: 1000,
      fire: 0,
      wageOffer: state.labor[laborPoolKey(company.hqRegionId, TECH.developerOccupationId)]
        ?.marketWage as number,
    });
    const { decisions, issues } = normalizeDecisions(state, company, d);
    expect(decisions.hr[0]?.hire).toBe(TECH.office.seats - headcount);
    expect(issues[0]).toMatchObject({ path: 'hr[0].hire', code: 'clamped' });
    // No office in the region, no hire.
    const elsewhere = emptyDecisions(id);
    elsewhere.hr.push({ ...(d.hr[0] as CompanyDecisions['hr'][number]), regionId: 'reg_sud' });
    expect(normalizeDecisions(state, company, elsewhere).decisions.hr).toEqual([]);
  });

  it('opens offices (no lines, no farms) and sells them at a discount', () => {
    const { state, id, company } = setup();
    (state.companies[id] as Company).books.current.balance.cash = 1e8;
    const office = Object.values(company.sites)[0];
    const refused = emptyDecisions(id);
    refused.capex = [
      { kind: 'add_line', siteId: office?.id ?? '' },
      { kind: 'buy_farm', regionId: 'reg_sud' },
    ];
    refused.production[office?.id ?? ''] = { targetOutput: 10 };
    refused.listing[lineIn(state, id)?.id ?? ''] = 1000;
    const { issues } = normalizeDecisions(state, company, refused);
    expect(issues.map((i) => [i.path, i.code])).toEqual([
      [`production.${office?.id}`, 'unknown_id'],
      [`listing.${lineIn(state, id)?.id}`, 'invalid_value'],
      ['capex[0]', 'invalid_state'],
      ['capex[1]', 'not_available'],
    ]);

    const d = steadyDecisions(state, id);
    d.capex = [{ kind: 'build_site', regionId: 'reg_sud' }];
    const { state: next, ctx } = resolveAll(state, [d]);
    const built = Object.values(next.companies[id]?.sites ?? {}).find(
      (s) => s.regionId === 'reg_sud',
    );
    expect(built).toMatchObject({
      kind: 'office',
      status: 'under_construction',
      seats: TECH.office.seats,
    });
    const cost = TECH.office.buildCost * (state.regions.reg_sud?.landCostIndex ?? 1);
    expect(ctx.ledger(id).capex).toBeCloseTo(cost, 6);
    const later = resolveAll(next, [steadyDecisions(next, id)]).state;
    const open = later.companies[id]?.sites[built?.id ?? ''];
    expect(open?.status).toBe('operational');
    const owner = later.companies[id] as Company;
    expect(disposalValue(later, owner, { kind: 'sell_site', siteId: open?.id ?? '' })).toBeCloseTo(
      (open?.buildingBookValue ?? 0) * (1 - TECH.assetResaleDiscount),
      6,
    );
    // Seats beyond the limit of offices are refused.
    const many = emptyDecisions(id);
    many.capex = Array.from({ length: TECH.office.maxOffices + 1 }, () => ({
      kind: 'build_site' as const,
      regionId: 'reg_nord',
    }));
    const limited = normalizeDecisions(state, company, many);
    expect(limited.decisions.capex).toHaveLength(TECH.office.maxOffices - 1);
    expect(limited.issues.some((i) => i.code === 'limit')).toBe(true);
  });
});

describe('tech: AI', () => {
  it('the tech planners put developers on R&D, price their subscriptions and stay in business', () => {
    let state = newGame(35);
    for (let t = 0; t < 8; t++) {
      state = resolveTurn(state, [steadyDecisions(state, playerCompanyId(state))]).state;
    }
    const tech = Object.values(state.companies).filter((c) => c.sector === 'tech');
    expect(tech).toHaveLength(3);
    for (const c of tech) {
      expect(c.status).toBe('active');
      const rnd = c.lastDecisions?.rnd ?? [];
      expect(rnd.some((r) => (r.developers ?? 0) > 0)).toBe(true);
      expect(rnd.every((r) => r.budget === 0)).toBe(true);
      const line = sectorProductLine(state.config, c);
      expect(c.lastDecisions?.pricing[line?.id ?? '']?.price).toBeGreaterThan(0);
      expect(line?.users).toBeGreaterThan(0);
      const seats = Object.values(c.sites).reduce((n, s) => n + (s.seats ?? 0), 0);
      const headcount = Object.values(c.workforce).reduce((n, s) => n + s.headcount, 0);
      expect(headcount).toBeLessThanOrEqual(seats);
      expect(c.books.current.pnl.rnd).toBeGreaterThan(0);
    }
    const released = state.log.filter(
      (e) => e.kind === 'rnd_completed' && tech.some((c) => c.id === e.companyId),
    );
    expect(released.length).toBeGreaterThan(0);
  });

  it('opens an office when the team outgrows its seats', () => {
    let state = newGame(36, { sectors: { tech: { office: { seats: 270 } } } });
    for (let t = 0; t < 8; t++) {
      state = resolveTurn(state, [steadyDecisions(state, playerCompanyId(state))]).state;
    }
    const tech = Object.values(state.companies).filter((c) => c.sector === 'tech');
    expect(tech.some((c) => Object.keys(c.sites).length > 1)).toBe(true);
  });
});

describe('tech: player views', () => {
  it('quotes offices and R&D in developers', () => {
    const { state, company } = setup();
    const costs = getPlayerView(state).costs;
    for (const region of Object.values(state.regions)) {
      expect(costs?.buildSite[region.id]).toBeCloseTo(
        TECH.office.buildCost * region.landCostIndex,
        6,
      );
    }
    expect(costs?.tech).toMatchObject({
      seats: TECH.office.seats,
      developers: staffOf(company, TECH.developerOccupationId),
      frontier: state.productMarkets.mkt_software?.techFrontier,
    });
    expect(costs?.tech?.freeSeats[company.hqRegionId]).toBeGreaterThan(0);
    expect(costs?.rnd.product).toMatchObject({ maxBudget: 0, effort: TECH.rnd.product.effort });
    expect(costs?.rnd.product.maxDevelopers).toBeGreaterThan(0);
    expect(costs?.rnd.process.maxLevel).toBe(TECH.rnd.maxLevel);
  });

  it('previews the quarter close to what happens, and repeats the R&D staffing', () => {
    const start = setup(37);
    const id = start.id;
    const state = playTurns(start.state, 2);
    const d = steadyDecisions(state, id);
    const preview = previewDecisions(state, [d]).companies[id];
    const { state: next } = resolveAll(state, [d]);
    const actual = next.companies[id]?.books.current.pnl;
    const users = lineIn(next, id)?.users ?? 1;
    expect(Math.abs((preview?.expectedUsers ?? 0) / users - 1)).toBeLessThan(0.02);
    expect(Math.abs((preview?.expectedRevenue ?? 0) / (actual?.revenue ?? 1) - 1)).toBeLessThan(
      0.05,
    );
    expect(preview?.costs.rnd).toBeGreaterThan(0);
    expect(preview?.costs.materials).toBeGreaterThan(0);
    const again = defaultDecisions(next, id);
    expect(again.rnd.map((r) => r.developers)).toEqual(
      next.companies[id]?.lastDecisions?.rnd.map((r) => r.developers),
    );
  });

  it('alerts on a product left behind and on a maintenance shortfall', () => {
    const { state, id, company } = setup();
    const kinds = (s: GameState) => getPlayerView(s).alerts.map((a) => a.kind);
    expect(kinds(state)).not.toContain('tech_behind');
    const dated = structuredClone(state);
    const line = lineIn(dated, id);
    if (line) line.techLevel = (line.techLevel ?? 0) - 0.5;
    expect(kinds(dated)).toContain('tech_behind');
    const short = structuredClone(state);
    const devs =
      short.companies[id]?.workforce[laborPoolKey(company.hqRegionId, TECH.developerOccupationId)];
    if (devs) devs.headcount = 40;
    expect(kinds(short)).toContain('maintenance_short');
  });
});

import { describe, expect, it } from 'vitest';
import type { Company, CompanyDecisions, GameState } from '../../src';
import { defaultDecisions, previewDecisions, resolveTurn } from '../../src';
import type { DeepPartial, GameConfig } from '../../src/config/schema';
import { mainProductLine, operatorProductivity } from '../../src/sectors/industry';
import { rndProjectCost } from '../../src/sectors/plant/rnd';
import { emptyDecisions, normalizeDecisions } from '../../src/systems/validation';
import { newGame, playerCompanyId, resolveAll, steadyDecisions } from '../helpers';

const setup = (overrides: DeepPartial<GameConfig> = {}) => {
  const state = newGame(17, { scenario: { initialJitter: 0 }, ...overrides });
  const id = playerCompanyId(state);
  return { state, id, company: state.companies[id] as Company };
};

/** Deterministic projects that can be completed in a single quarter. */
const fast: DeepPartial<GameConfig> = {
  sectors: { industry: { rnd: { progressNoise: 0, maxSpendShare: 1 } } },
};

/** Plays a quarter with steady decisions for the player, plus R&D budgets. */
const play = (state: GameState, id: string, rnd: CompanyDecisions['rnd']) => {
  const d = steadyDecisions(state, id);
  d.rnd = rnd;
  return resolveAll(state, [d]);
};

const gap = (c: Company) => {
  const b = c.books.current.balance;
  return b.cash + b.inventory + b.fixedAssets + b.financialAssets - b.debt - b.equity;
};

describe('rnd', () => {
  it('starts a project: the budget is expensed and moves it forward, within the noise', () => {
    const { state, id } = setup();
    const cfg = state.config.sectors.industry;
    const cost = rndProjectCost(cfg, 'process', 0, state.macro.priceLevel);
    const budget = 0.2 * cost;
    const { state: s1, ctx, report } = play(state, id, [{ type: 'process', budget }]);
    const c1 = s1.companies[id] as Company;
    const project = c1.rnd[0];
    expect(c1.rnd).toHaveLength(1);
    expect(project?.type).toBe('process');
    expect(project?.cost).toBeCloseTo(cost, 6);
    expect(project?.spent).toBeCloseTo(budget, 6);
    expect(project?.progress).toBeGreaterThanOrEqual(0.2 * (1 - cfg.rnd.progressNoise) - 1e-12);
    expect(project?.progress).toBeLessThanOrEqual(0.2 * (1 + cfg.rnd.progressNoise) + 1e-12);
    expect(ctx.ledger(id).rnd).toBeCloseTo(budget, 6);
    expect(c1.books.current.pnl.rnd).toBeCloseTo(budget, 6);
    expect(Math.abs(gap(c1))).toBeLessThan(1e-3);
    expect(report.events.some((e) => e.kind === 'rnd_started' && e.companyId === id)).toBe(true);

    // Funding the same type again continues the project (no projectId needed).
    const { state: s2 } = play(s1, id, [{ type: 'process', budget }]);
    const c2 = s2.companies[id] as Company;
    expect(c2.rnd).toHaveLength(1);
    expect(c2.rnd[0]?.id).toBe(project?.id);
    expect(c2.rnd[0]?.spent).toBeCloseTo(2 * budget, 6);
  });

  it('completes a project: one level up, effective next quarter, next project dearer', () => {
    const { state, id } = setup(fast);
    const cfg = state.config.sectors.industry;
    const cost = rndProjectCost(cfg, 'process', 0, state.macro.priceLevel);
    const { state: s1, report } = play(state, id, [{ type: 'process', budget: cost }]);
    const c1 = s1.companies[id] as Company;
    expect(c1.processLevel).toBe(1);
    expect(c1.rnd).toEqual([]);
    const done = report.events.find((e) => e.kind === 'rnd_completed');
    expect(done?.data?.type).toBe('process');
    expect(done?.data?.level).toBe(1);

    const { decisions } = normalizeDecisions(s1, c1, {
      ...emptyDecisions(id),
      rnd: [{ type: 'process', budget: 1e9 }],
    });
    const next = rndProjectCost(cfg, 'process', 1, s1.macro.priceLevel);
    expect(next).toBeCloseTo(
      cost * (1 + cfg.rnd.costGrowthPerLevel) * (s1.macro.priceLevel / state.macro.priceLevel),
      3,
    );
    expect(decisions.rnd[0]?.budget).toBeCloseTo(next, 3);
  });

  it('process R&D raises productivity, product R&D raises the reachable quality', () => {
    // Enough cash for the costly materials of quality 100 (no distress on the way).
    const { state, id, company } = setup({ finance: { startingCash: 20_000_000 } });
    const cfg = state.config.sectors.industry;
    const base = operatorProductivity(state, company, company.hqRegionId);
    const better = structuredClone(state);
    const c = better.companies[id] as Company;
    c.processLevel = 2;
    expect(operatorProductivity(better, c, c.hqRegionId)).toBeCloseTo(
      base * (1 + 2 * cfg.rnd.process.productivityPerLevel),
      9,
    );

    // Same company aiming at 100: product levels lift the quality it reaches.
    const aim = (s: GameState) => {
      const d = steadyDecisions(s, id);
      const line = mainProductLine(s, s.companies[id] as Company);
      if (line) d.pricing[line.id] = { price: line.price, qualityTarget: 100 };
      return d;
    };
    const quality = (s: GameState) => mainProductLine(s, s.companies[id] as Company)?.quality ?? 0;
    const upgraded = structuredClone(state);
    const line = mainProductLine(upgraded, upgraded.companies[id] as Company);
    if (line) line.techLevel = 3;
    let a = state;
    let b = upgraded;
    for (let t = 0; t < 6; t++) {
      a = resolveAll(a, [aim(a)]).state;
      b = resolveAll(b, [aim(b)]).state;
    }
    expect(quality(b) - quality(a)).toBeGreaterThan(2.5 * cfg.rnd.product.qualityPerLevel);
  });

  it('levels fade with obsolescence, never below 0', () => {
    const { state, id } = setup();
    const decay = state.config.sectors.industry.rnd.obsolescencePerQuarter;
    const s0 = structuredClone(state);
    const c0 = s0.companies[id] as Company;
    c0.processLevel = 1;
    const line = mainProductLine(s0, c0);
    if (line) line.techLevel = decay / 2;
    const { state: s1 } = play(s0, id, []);
    const c1 = s1.companies[id] as Company;
    expect(c1.processLevel).toBeCloseTo(1 - decay, 12);
    expect(mainProductLine(s1, c1)?.techLevel).toBe(0);
  });

  it('validation caps budgets, refuses duplicates, stale projects and maxed-out levels', () => {
    const { state, id, company } = setup();
    const cfg = state.config.sectors.industry;
    const cost = rndProjectCost(cfg, 'product', 0, state.macro.priceLevel);
    const { decisions, issues } = normalizeDecisions(state, company, {
      ...emptyDecisions(id),
      rnd: [
        { type: 'product', budget: 1e9 },
        { type: 'product', budget: 1000 },
        { type: 'process', budget: 1000, projectId: 'rnd_999' },
        { type: 'other' as 'process', budget: 1000 },
      ],
    });
    expect(decisions.rnd).toEqual([{ type: 'product', budget: cfg.rnd.maxSpendShare * cost }]);
    expect(issues.map((i) => `${i.path}:${i.code}`)).toEqual([
      'rnd[0].budget:clamped',
      'rnd[1]:duplicate',
      'rnd[2].projectId:unknown_id',
      'rnd[3].type:invalid_value',
    ]);

    const maxed = structuredClone(state);
    const c = maxed.companies[id] as Company;
    c.processLevel = cfg.rnd.maxLevel;
    const out = normalizeDecisions(maxed, c, {
      ...emptyDecisions(id),
      rnd: [{ type: 'process', budget: 1000 }],
    });
    expect(out.decisions.rnd).toEqual([]);
    expect(out.issues.map((i) => i.code)).toEqual(['limit']);
  });

  it('R&D budgets are discretionary spending, scaled down with the rest', () => {
    const { state, id, company } = setup();
    const line = mainProductLine(state, company);
    const d = emptyDecisions(id);
    if (line) d.marketing[line.id] = 1e9;
    d.rnd = [{ type: 'process', budget: 400_000 }];
    const { decisions, issues } = normalizeDecisions(state, company, d);
    expect(issues.some((i) => i.code === 'budget')).toBe(true);
    expect(decisions.rnd[0]?.budget ?? 0).toBeLessThan(400_000);
  });

  it('defaultDecisions carries the budgets over; previewDecisions counts them', () => {
    const { state, id } = setup();
    const { state: s1 } = play(state, id, [{ type: 'product', budget: 300_000 }]);
    const d = defaultDecisions(s1, id);
    expect(d.rnd).toEqual([{ type: 'product', budget: 300_000 }]);
    const preview = previewDecisions(s1, [d]).companies[id];
    const without = previewDecisions(s1, [{ ...d, rnd: [] }]).companies[id];
    expect(preview?.costs.rnd).toBe(300_000);
    expect((without?.expectedCashEnd ?? 0) - (preview?.expectedCashEnd ?? 0)).toBeCloseTo(
      300_000,
      3,
    );
  });

  it('the AI planners fund R&D according to their profile', () => {
    let state = newGame(5);
    for (let t = 0; t < 6; t++)
      state = resolveTurn(state, [steadyDecisions(state, playerCompanyId(state))]).state;
    const ai = Object.values(state.companies).filter((c) => c.id !== playerCompanyId(state));
    for (const c of ai) {
      if (c.status !== 'active') continue;
      const spent = c.books.history.reduce((s, x) => s + x.pnl.rnd, 0);
      expect(spent).toBeGreaterThan(0);
      expect(
        c.rnd.length + c.processLevel + (mainProductLine(state, c)?.techLevel ?? 0),
      ).toBeGreaterThan(0);
    }
  });
});

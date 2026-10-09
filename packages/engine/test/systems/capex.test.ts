import { describe, expect, it } from 'vitest';
import type { CapexOrder, Company, GameState } from '../../src';
import { fixedAssetValue } from '../../src/core/companies';
import { sum } from '../../src/core/math';
import { siteCeilings } from '../../src/sectors/industry';
import { emptyDecisions, normalizeDecisions } from '../../src/systems/validation';
import { LOW_DEBT, newGame, playerCompanyId, resolveAll, steadyDecisions } from '../helpers';

const setup = () => {
  const state = newGame(31, { ...LOW_DEBT, scenario: { initialJitter: 0 } });
  const id = playerCompanyId(state);
  const company = state.companies[id] as Company;
  const siteId = Object.keys(company.sites)[0] ?? '';
  return { state, id, company, siteId };
};

/** Plays a quarter with steady decisions for the player, plus capex orders. */
const play = (state: GameState, id: string, capex: CapexOrder[] = []) => {
  const d = steadyDecisions(state, id);
  d.capex = capex;
  return resolveAll(state, [d]);
};

const gap = (c: Company) => {
  const b = c.books.current.balance;
  return b.cash + b.inventory + b.fixedAssets + b.financialAssets - b.debt - b.equity;
};

const lines = (c: Company) => Object.values(c.sites).flatMap((s) => Object.values(s.lines));

describe('capex', () => {
  it('builds a factory: paid at once, capitalized, commissioned after buildQuarters', () => {
    const { state, id } = setup();
    const cfg = state.config.sectors.industry;
    const { state: s1, ctx } = play(state, id, [{ kind: 'build_site', regionId: 'reg_nord' }]);
    const c1 = s1.companies[id] as Company;
    const site = Object.values(c1.sites).find((s) => s.regionId === 'reg_nord');
    const expected =
      cfg.factory.buildCost * (state.regions.reg_nord?.landCostIndex ?? 1) * state.macro.priceLevel;
    expect(site?.status).toBe('under_construction');
    expect(site?.completesAt).toBe(cfg.factory.buildQuarters);
    expect(ctx.ledger(id).capex).toBeCloseTo(expected, 6);
    expect(c1.books.current.cashFlow.investing).toBeCloseTo(-expected, 6);
    expect(site?.buildingBookValue).toBeCloseTo(expected, 6); // not depreciated while built
    expect(Math.abs(gap(c1))).toBeLessThan(1e-3);

    let s = s1;
    for (let t = 1; t < cfg.factory.buildQuarters; t++) s = play(s, id).state;
    expect(s.companies[id]?.sites[site?.id ?? '']?.status).toBe('under_construction');
    const { state: done, report } = play(s, id);
    expect(done.companies[id]?.sites[site?.id ?? '']?.status).toBe('operational');
    expect(report.events.some((e) => e.kind === 'site_commissioned')).toBe(true);
  });

  it('adds a line that only produces once commissioned', () => {
    const { state, id, siteId } = setup();
    const cfg = state.config.sectors.industry;
    const capacity = (s: GameState) =>
      sum(siteCeilings(s, s.companies[id] as Company).map((x) => x.ceiling));
    const { state: s1 } = play(state, id, [{ kind: 'add_line', siteId }]);
    const added = lines(s1.companies[id] as Company).find((l) => l.status === 'under_construction');
    expect(added?.completesAt).toBe(cfg.line.buildQuarters);
    expect(added?.bookValue).toBeCloseTo(cfg.line.buildCost * state.macro.priceLevel, 6);
    // Not in service: no capacity, no maintenance, no aging.
    const linesBefore = Object.keys(state.companies[id]?.sites[siteId]?.lines ?? {}).length;
    expect(capacity(s1)).toBeLessThanOrEqual(linesBefore * cfg.line.capacity);
    expect(added?.age).toBe(0);
    let s = s1;
    for (let t = 1; t <= cfg.line.buildQuarters; t++) s = play(s, id).state;
    const line = s.companies[id]?.sites[siteId]?.lines[added?.id ?? ''];
    expect(line?.status).toBe('operational');
    expect(line?.age).toBe(1);
  });

  it('modernizes a line: offline for a quarter, then a higher tech level and age 0', () => {
    const { state, id, siteId } = setup();
    const cfg = state.config.sectors.industry.line;
    const lineId = Object.keys(state.companies[id]?.sites[siteId]?.lines ?? {})[0] ?? '';
    const before = state.companies[id]?.sites[siteId]?.lines[lineId];
    const { state: s1 } = play(state, id, [{ kind: 'modernize_line', siteId, lineId }]);
    const during = s1.companies[id]?.sites[siteId]?.lines[lineId];
    expect(during?.status).toBe('modernizing');
    // Capitalized, and still depreciated (it is not a new asset).
    expect(during?.bookValue).toBeCloseTo(
      (before?.bookValue ?? 0) +
        cfg.modernizeCost * state.macro.priceLevel -
        (during?.depreciationPerQuarter ?? 0),
      6,
    );
    const s2 = play(s1, id).state;
    const after = s2.companies[id]?.sites[siteId]?.lines[lineId];
    expect(after?.status).toBe('operational');
    expect(after?.techLevel).toBeCloseTo((before?.techLevel ?? 0) + cfg.modernizeTechGain, 9);
    expect(after?.age).toBe(1); // reset to 0, then one quarter of production
  });

  it('sells a line at a discount on its book value; the loss goes with depreciation', () => {
    const { state, id, siteId, company } = setup();
    const cfg = state.config.sectors.industry;
    const lineId = Object.keys(company.sites[siteId]?.lines ?? {})[0] ?? '';
    const book = company.sites[siteId]?.lines[lineId]?.bookValue ?? 0;
    const { state: s1, ctx } = play(state, id, [{ kind: 'sell_line', siteId, lineId }]);
    const c1 = s1.companies[id] as Company;
    expect(c1.sites[siteId]?.lines[lineId]).toBeUndefined();
    expect(ctx.ledger(id).disposals).toBeCloseTo(book * (1 - cfg.assetResaleDiscount), 6);
    expect(ctx.ledger(id).writeOffs).toBeCloseTo(book * cfg.assetResaleDiscount, 6);
    expect(c1.books.current.balance.fixedAssets).toBeCloseTo(fixedAssetValue(c1), 6);
    expect(Math.abs(gap(c1))).toBeLessThan(1e-3);
  });

  it('sells a whole factory', () => {
    const { state, id, siteId, company } = setup();
    const book = fixedAssetValue(company);
    const { state: s1, ctx } = play(state, id, [{ kind: 'sell_site', siteId }]);
    const c1 = s1.companies[id] as Company;
    expect(c1.sites).toEqual({});
    expect(c1.books.current.balance.fixedAssets).toBe(0);
    expect(ctx.ledger(id).disposals + ctx.ledger(id).writeOffs).toBeCloseTo(book, 4);
    expect(Math.abs(gap(c1))).toBeLessThan(1e-3);
  });
});

describe('capex validation', () => {
  it('drops orders on unknown assets, conflicts, limits and assets not in service', () => {
    const { state, company, siteId } = setup();
    const lineIds = Object.keys(company.sites[siteId]?.lines ?? {});
    const [a = '', b = ''] = lineIds;
    const d = emptyDecisions(company.id);
    d.capex = [
      { kind: 'build_site', regionId: 'reg_nowhere' },
      { kind: 'add_line', siteId: 'site_999' },
      { kind: 'sell_line', siteId, lineId: a },
      { kind: 'modernize_line', siteId, lineId: a }, // same line twice
      { kind: 'sell_site', siteId }, // one of its lines is already sold
      { kind: 'modernize_line', siteId, lineId: b },
      { kind: 'nonsense' } as unknown as CapexOrder,
    ];
    const { decisions, issues } = normalizeDecisions(state, company, d);
    expect(decisions.capex).toEqual([
      { kind: 'sell_line', siteId, lineId: a },
      { kind: 'modernize_line', siteId, lineId: b },
    ]);
    expect(issues.map((i) => `${i.path}:${i.code}`)).toEqual([
      'capex[0]:unknown_id',
      'capex[1]:unknown_id',
      'capex[3]:duplicate',
      'capex[4]:duplicate',
      'capex[6]:invalid_value',
    ]);

    const line = company.sites[siteId]?.lines[a];
    if (line) line.status = 'under_construction';
    const busy = emptyDecisions(company.id);
    busy.capex = [{ kind: 'sell_line', siteId, lineId: a }];
    expect(normalizeDecisions(state, company, busy).issues.map((i) => i.code)).toEqual([
      'invalid_state',
    ]);
  });

  it('enforces the line and site limits and the tech ceiling', () => {
    const { state, company, siteId } = setup();
    const cfg = state.config.sectors.industry;
    const d = emptyDecisions(company.id);
    const room = cfg.factory.maxLines - Object.keys(company.sites[siteId]?.lines ?? {}).length;
    d.capex = Array.from({ length: room + 1 }, () => ({ kind: 'add_line', siteId }) as CapexOrder);
    company.books.current.balance.cash = 1e9;
    const { decisions, issues } = normalizeDecisions(state, company, d);
    expect(decisions.capex).toHaveLength(room);
    expect(issues.map((i) => i.code)).toEqual(['limit']);

    const sites = emptyDecisions(company.id);
    sites.capex = Array.from({ length: cfg.factory.maxSites }, () => ({
      kind: 'build_site' as const,
      regionId: 'reg_sud',
    }));
    expect(normalizeDecisions(state, company, sites).decisions.capex).toHaveLength(
      cfg.factory.maxSites - 1,
    );

    const lineId = Object.keys(company.sites[siteId]?.lines ?? {})[0] ?? '';
    const line = company.sites[siteId]?.lines[lineId];
    if (line) line.techLevel = cfg.line.maxTechLevel;
    const top = emptyDecisions(company.id);
    top.capex = [{ kind: 'modernize_line', siteId, lineId }];
    expect(normalizeDecisions(state, company, top).issues.map((i) => i.code)).toEqual(['limit']);
  });

  it('pays investments from cash and new debt only, and keeps them out of the spending budget', () => {
    const { state, company, siteId } = setup();
    company.books.current.balance.cash = 5_000_000;
    company.books.current.pnl.revenue = 1e9; // the revenue share only funds discretionary spending
    const d = emptyDecisions(company.id);
    d.capex = [
      { kind: 'add_line', siteId }, // 4 M
      { kind: 'add_line', siteId }, // would exceed the cash
    ];
    d.marketing = { [Object.keys(company.productLines)[0] ?? '']: 3_000_000 };
    const { decisions, issues } = normalizeDecisions(state, company, d);
    expect(decisions.capex).toHaveLength(1);
    expect(issues.map((i) => `${i.path}:${i.code}`)).toEqual(['capex[1]:budget']);
    // Liquidity left for marketing: 1 M of cash + a share of revenue.
    expect(Object.values(decisions.marketing)[0]).toBe(3_000_000);
    company.books.current.balance.cash = 8_000_000;
    expect(normalizeDecisions(state, company, d).decisions.capex).toHaveLength(2);
  });
});

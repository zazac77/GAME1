import { describe, expect, it } from 'vitest';
import type { CompanyDecisions, GameState } from '../../src';
import { laborPoolKey } from '../../src/core/keys';
import { commoditiesSystem } from '../../src/systems/commodities';
import { productionSystem } from '../../src/systems/production';
import { emptyDecisions, validationSystem } from '../../src/systems/validation';
import { lineCapacity, mainProductLine, siteCeilings } from '../../src/sectors/industry';
import { newGame, playerCompanyId, resolveAll } from '../helpers';

const SYSTEMS = [validationSystem, commoditiesSystem, productionSystem];
const run = (state: GameState, decisions: CompanyDecisions[] = []) =>
  resolveAll(state, decisions, { systems: SYSTEMS });

const setup = (overrides = {}) => {
  const state = newGame(8, { scenario: { initialJitter: 0 }, ...overrides });
  const id = playerCompanyId(state);
  const company = state.companies[id];
  if (!company) throw new Error('no player');
  const line = mainProductLine(state, company);
  if (!line) throw new Error('no line');
  const siteId = Object.keys(company.sites)[0] ?? '';
  // A full quarter of materials so that only capacity and staff bind.
  for (const [c, perUnit] of Object.entries(state.config.sectors.industry.recipe)) {
    const lot = company.inventory[c];
    if (lot) lot.qty = 40000 * perUnit * 1.5;
  }
  return { state, id, company, line, siteId };
};

const produced = (before: GameState, after: GameState, id: string, lineId: string) =>
  (after.companies[id]?.inventory[lineId]?.qty ?? 0) -
  (before.companies[id]?.inventory[lineId]?.qty ?? 0);

describe('production (industry)', () => {
  it('output = min(lines, operators × productivity, materials, target)', () => {
    const { state, id, company, line, siteId } = setup();
    const lines = Object.values(company.sites[siteId]?.lines ?? {});
    const capacity = lines.reduce((s, l) => s + lineCapacity(state.config.sectors.industry, l), 0);
    const ceiling = siteCeilings(state, company)[0]?.ceiling ?? 0;
    expect(ceiling).toBeLessThanOrEqual(capacity);
    const full = run(structuredClone(state));
    expect(produced(state, full.state, id, line.id)).toBe(Math.floor(ceiling));
    expect(full.ctx.ledger(id).unitsProduced).toBe(Math.floor(ceiling));

    const d = emptyDecisions(id);
    d.production[siteId] = { targetOutput: 1234.7 };
    expect(produced(state, run(structuredClone(state), [d]).state, id, line.id)).toBe(1234);

    const starved = structuredClone(state);
    const kit = starved.companies[id]?.inventory.com_electronics;
    if (kit) kit.qty = 900;
    expect(produced(state, run(starved).state, id, line.id)).toBe(900);
  });

  it('operators limit the output', () => {
    const { state, id, company, line } = setup();
    const ops = company.workforce[laborPoolKey(company.hqRegionId, 'occ_operator')];
    if (!ops) throw new Error('no operators');
    ops.headcount = 50;
    const out = produced(state, run(state).state, id, line.id);
    expect(out).toBeGreaterThan(0);
    expect(out).toBeLessThan(50 * state.config.sectors.industry.operatorProductivity * 1.2);
  });

  it('a strike in the region halves productivity', () => {
    const { state, id, company, line } = setup();
    const ops = company.workforce[laborPoolKey(company.hqRegionId, 'occ_operator')];
    if (ops) ops.headcount = 100; // staff-bound, not line-bound
    const normal = produced(state, run(structuredClone(state)).state, id, line.id);
    state.modifiers.push({
      id: 'mod_s',
      sourceId: 'ev_strike',
      target: { kind: 'region', id: company.hqRegionId },
      key: 'labor.productivity',
      op: 'mul',
      value: 0.5,
      remaining: 1,
      decay: 0,
    });
    const strike = produced(state, run(state).state, id, line.id);
    expect(strike).toBeCloseTo(normal / 2, -1);
  });

  it('consumes materials at book cost and capitalizes them, energy included', () => {
    const { state, id, company, line } = setup();
    const { state: next, ctx } = run(state);
    const out = ctx.ledger(id).unitsProduced;
    const steelBefore = company.inventory.com_steel;
    const steelAfter = next.companies[id]?.inventory.com_steel;
    const perUnit = 0.03 * (1 + 0.01 * Math.max(0, line.quality - 50));
    expect((steelBefore?.qty ?? 0) - (steelAfter?.qty ?? 0)).toBeCloseTo(out * perUnit, 6);
    // Energy is bought at consumption (cash out), the rest comes from stock.
    const energy = out * 0.15 * (next.commodities.com_energy?.spotPrice ?? 0) * 1.02;
    expect(ctx.ledger(id).purchases).toBeCloseTo(energy, 4);
    expect(next.companies[id]?.inventory.com_energy).toBeUndefined();
    const fg = next.companies[id]?.inventory[line.id];
    expect(fg?.avgCost).toBeGreaterThan(0);
  });

  it('pays take-or-pay on unused energy contracts', () => {
    const { state, id, siteId } = setup();
    const d = emptyDecisions(id);
    d.production[siteId] = { targetOutput: 0 };
    d.purchasing.newContracts.push({ commodityId: 'com_energy', qtyPerQuarter: 1000, quarters: 2 });
    const { state: next, ctx } = run(state, [d]);
    const price = next.companies[id]?.contracts[0]?.price ?? 0;
    expect(ctx.ledger(id).purchases).toBe(0);
    expect(ctx.ledger(id).other).toBeGreaterThanOrEqual(1000 * price * 0.3);
  });

  it('quality moves towards the target within the reachable level, and costs material', () => {
    const { state, id, line } = setup();
    const d = emptyDecisions(id);
    d.pricing[line.id] = { price: line.price, qualityTarget: 100 };
    let s = state;
    for (let i = 0; i < 6; i++) s = run(s, [d]).state;
    const q = mainProductLine(s, s.companies[id] as never)?.quality ?? 0;
    expect(q).toBeGreaterThan(line.quality);
    expect(q).toBeLessThan(100); // engineers and tech level cap it
    const low = emptyDecisions(id);
    low.pricing[line.id] = { price: line.price, qualityTarget: 20 };
    let t = state;
    for (let i = 0; i < 6; i++) t = run(t, [low]).state;
    expect(mainProductLine(t, t.companies[id] as never)?.quality).toBeLessThan(line.quality);
  });

  it('ages lines and accumulates output (learning curve)', () => {
    const { state, id, company, siteId } = setup();
    const ageBefore = Object.values(company.sites[siteId]?.lines ?? {})[0]?.age ?? 0;
    const { state: next, ctx } = run(state);
    expect(Object.values(next.companies[id]?.sites[siteId]?.lines ?? {})[0]?.age).toBe(
      ageBefore + 1,
    );
    expect(next.companies[id]?.cumulativeOutput).toBe(
      company.cumulativeOutput + ctx.ledger(id).unitsProduced,
    );
    expect(ctx.ledger(id).other).toBeGreaterThan(0); // maintenance
  });
});

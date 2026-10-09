import { describe, expect, it } from 'vitest';
import type { GameState } from '../../src';
import { mainProductLine } from '../../src/sectors/plant';
import { perishabilitySystem } from '../../src/systems/perishability';
import { newGame, resolveAll } from '../helpers';

const run = (state: GameState) => resolveAll(state, [], { systems: [perishabilitySystem] });

describe('perishability', () => {
  const state = newGame(9);
  const bySector = (sector: string) =>
    Object.values(state.companies).find((c) => c.sector === sector && c.status === 'active');

  it('throws away a share of the unsold food and of the stored milk', () => {
    const company = bySector('agri');
    if (!company) throw new Error('no agri company');
    const line = mainProductLine(state, company);
    if (!line) throw new Error('no line');
    const goods = company.inventory[line.id];
    const milk = company.inventory.com_milk;
    const cereals = company.inventory.com_cereals;
    const { state: next, ctx } = run(state);
    const after = next.companies[company.id]?.inventory;
    const agri = state.config.sectors.agri;
    const rate = agri?.finishedGoodsPerishRate ?? 0;
    expect(rate).toBeGreaterThan(0);
    expect(after?.[line.id]?.qty).toBeCloseTo((goods?.qty ?? 0) * (1 - rate), 6);
    expect(after?.com_milk?.qty).toBeCloseTo(
      (milk?.qty ?? 0) * (1 - (state.config.commodities.markets.com_milk?.perishRate ?? 0)),
      6,
    );
    expect(after?.com_cereals?.qty).toBeLessThan(cereals?.qty ?? 0);
    expect(after?.com_packaging?.qty).toBe(company.inventory.com_packaging?.qty); // keeps
    // The book value lost is a cost of goods sold; the unit cost is unchanged.
    const lost = (['com_milk', 'com_cereals', 'com_oilseeds', line.id] as const).reduce(
      (s, id) =>
        s +
        ((company.inventory[id]?.qty ?? 0) - (after?.[id]?.qty ?? 0)) *
          (company.inventory[id]?.avgCost ?? 0),
      0,
    );
    expect(ctx.ledger(company.id).cogs).toBeCloseTo(lost, 4);
    expect(ctx.ledger(company.id).unitsSpoiled).toBeCloseTo((goods?.qty ?? 0) * rate, 6);
    expect(after?.[line.id]?.avgCost).toBe(goods?.avgCost);
  });

  it('leaves the appliances alone', () => {
    const company = bySector('industry');
    if (!company) throw new Error('no industry company');
    const { state: next, ctx } = run(state);
    expect(next.companies[company.id]?.inventory).toEqual(company.inventory);
    expect(ctx.ledger(company.id).cogs).toBe(0);
  });
});

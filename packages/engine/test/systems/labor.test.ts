import { describe, expect, it } from 'vitest';
import type { CompanyDecisions, GameState } from '../../src';
import { laborPoolKey } from '../../src/core/keys';
import { sum } from '../../src/core/math';
import { allocateHires, laborSystem } from '../../src/systems/labor';
import { unemployed } from '../../src/systems/labor/pools';
import { emptyDecisions, validationSystem } from '../../src/systems/validation';
import { newGame, playerCompanyId, resolveAll } from '../helpers';

const LABOR = [validationSystem, laborSystem];
const runLabor = (state: GameState, decisions: CompanyDecisions[] = []) =>
  resolveAll(state, decisions, { systems: LABOR });

const setup = (seed = 3, overrides = {}) => {
  const state = newGame(seed, overrides);
  const id = playerCompanyId(state);
  const company = state.companies[id];
  if (!company) throw new Error('no player');
  const region = company.hqRegionId;
  const key = laborPoolKey(region, 'occ_operator');
  return { state, id, company, region, key };
};

const hr = (id: string, region: string, h: Partial<CompanyDecisions['hr'][number]>) => {
  const d = emptyDecisions(id);
  d.hr.push({
    regionId: region,
    occupationId: 'occ_operator',
    hire: 0,
    fire: 0,
    wageOffer: 0,
    ...h,
  });
  return d;
};

describe('labor: matching', () => {
  it('splits hires by weight without exceeding any request', () => {
    expect(allocateHires(10, [5, 20], [1, 1])).toEqual([5, 5]);
    expect(allocateHires(10, [100, 100], [3, 1])).toEqual([8, 2]); // 7.5 / 2.5, largest remainder
    expect(sum(allocateHires(7, [3, 3, 3], [1, 1, 1]))).toBe(7);
    expect(allocateHires(10, [0, 4], [1, 1])).toEqual([0, 4]);
    expect(allocateHires(0, [4], [1])).toEqual([0]);
  });

  it('a higher wage offer wins more of the shared pool', () => {
    const [cheap, generous] = allocateHires(50, [100, 100], [100 * 1 ** 2, 100 * 1.2 ** 2]);
    expect(generous).toBeGreaterThan(cheap ?? Infinity);
  });

  it('hires no more than requested nor than the unemployed', () => {
    const { state, id, company, region, key } = setup();
    const market = state.labor[key]?.marketWage ?? 0;
    const before = company.workforce[key]?.headcount ?? 0;
    const U = unemployed(state, key);
    const { state: next, ctx } = runLabor(state, [hr(id, region, { hire: 40, wageOffer: market })]);
    const hired = (next.companies[id]?.workforce[key]?.headcount ?? 0) - before;
    expect(hired).toBeGreaterThan(0);
    expect(hired).toBeLessThanOrEqual(40);
    expect(hired).toBeLessThanOrEqual(U);
    expect(next.companies[id]?.workforce[key]?.rampingUp).toBeGreaterThan(0);
    expect(ctx.ledger(id).other).toBeGreaterThan(0); // recruiting cost
  });

  it('cannot recruit more than the unemployed, however many are requested', () => {
    const { state, id, region, key } = setup();
    const pool = state.labor[key];
    if (!pool) throw new Error('no pool');
    const U = unemployed(state, key);
    const { state: next } = runLabor(state, [
      hr(id, region, { hire: pool.laborForce, wageOffer: pool.marketWage * 2 }),
    ]);
    expect(unemployed(next, key)).toBeGreaterThanOrEqual(0);
    expect(unemployed(next, key)).toBeLessThan(U);
  });
});

describe('labor: wages and tension', () => {
  it('market wages outpace inflation when tension exceeds its target', () => {
    const { state, key } = setup(3, { labor: { attrition: { baseRate: 0 } } });
    const tight = state.labor[key];
    const slack = state.labor[laborPoolKey('reg_nord', 'occ_operator')];
    if (!tight || !slack) throw new Error('no pool');
    // Tight: almost no unemployed. Slack: many.
    tight.outsideEmployment += unemployed(state, key) * 0.8;
    slack.outsideEmployment -= slack.outsideEmployment * 0.2;
    const w0 = { tight: tight.marketWage, slack: slack.marketWage };
    const { state: next } = runLabor(state);
    const p = next.macro.inflation / 4;
    const growth = (k: string, w: number) =>
      (next.labor[k as `${string}:${string}`]?.marketWage ?? 0) / w - 1;
    expect(next.labor[key]?.tension).toBeGreaterThan(state.config.labor.targetTension);
    expect(growth(key, w0.tight)).toBeGreaterThan(p);
    expect(growth('reg_nord:occ_operator', w0.slack)).toBeLessThan(p);
  });

  it('a wage-growth modifier (strike) pushes the regional wage up', () => {
    const { state, region, key } = setup();
    const base = runLabor(structuredClone(state)).state.labor[key]?.marketWage ?? 0;
    state.modifiers.push({
      id: 'mod_s',
      sourceId: 'ev_strike',
      target: { kind: 'region', id: region },
      key: 'labor.wageGrowth',
      op: 'add',
      value: 0.01,
      remaining: 1,
      decay: 0,
    });
    const shocked = runLabor(state).state.labor[key]?.marketWage ?? 0;
    // w·(1 + g + 0.01) − w·(1 + g)
    expect(shocked - base).toBeCloseTo(0.01 * (state.labor[key]?.marketWage ?? 0), 6);
  });
});

describe('labor: attrition, dismissals, training', () => {
  it('underpaid staff quit more', () => {
    let underpaid = 0;
    let paid = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const { state, id, key } = setup(seed);
      const staff = state.companies[id]?.workforce[key];
      const market = state.labor[key]?.marketWage ?? 0;
      if (!staff) throw new Error('no staff');
      const fair = structuredClone(state);
      staff.wage = 0.6 * market;
      const fairStaff = fair.companies[id]?.workforce[key];
      if (fairStaff) fairStaff.wage = market;
      underpaid +=
        staff.headcount - (runLabor(state).state.companies[id]?.workforce[key]?.headcount ?? 0);
      paid +=
        staff.headcount - (runLabor(fair).state.companies[id]?.workforce[key]?.headcount ?? 0);
    }
    expect(underpaid).toBeGreaterThan(paid * 1.5);
  });

  it('dismissals cost severance and employer brand, and free the workers', () => {
    const { state, id, company, region, key } = setup(3, { labor: { attrition: { baseRate: 0 } } });
    const staff = company.workforce[key];
    if (!staff) throw new Error('no staff');
    const U = unemployed(state, key);
    const { state: next, ctx } = runLabor(state, [
      hr(id, region, { fire: 50, wageOffer: staff.wage }),
    ]);
    expect(next.companies[id]?.workforce[key]?.headcount).toBe(staff.headcount - 50);
    expect(ctx.ledger(id).other).toBeCloseTo(
      50 * staff.wage * state.config.labor.severanceQuarters,
      6,
    );
    expect(next.companies[id]?.employerBrand).toBeLessThan(company.employerBrand);
    // Workers return to the pool, where the outside economy starts absorbing them.
    expect(unemployed(next, key)).toBeGreaterThan(U);
  });

  it('trains staff into a higher occupation, moving them between pools', () => {
    const { state, id, region, key } = setup(3, { labor: { attrition: { baseRate: 0 } } });
    const techKey = laborPoolKey(region, 'occ_technician');
    const wage = state.companies[id]?.workforce[key]?.wage ?? 0;
    const d = hr(id, region, {
      wageOffer: wage,
      train: { toOccupationId: 'occ_technician', count: 10 },
    });
    let s = runLabor(state, [d]).state;
    const company = () => s.companies[id];
    expect(company()?.workforce[key]?.inTraining).toEqual([
      { toOccupationId: 'occ_technician', count: 10, doneAt: 2 },
    ]);
    const ops = company()?.workforce[key]?.headcount ?? 0;
    const techs = company()?.workforce[techKey]?.headcount ?? 0;
    const opForce = s.labor[key]?.laborForce ?? 0;
    const techForce = s.labor[techKey]?.laborForce ?? 0;
    for (let i = 0; i < 2; i++) {
      s.meta.turn += 1;
      s = runLabor(s).state;
    }
    expect(company()?.workforce[key]?.headcount).toBe(ops - 10);
    expect(company()?.workforce[techKey]?.headcount).toBe(techs + 10);
    expect(company()?.workforce[key]?.inTraining).toEqual([]);
    // The labor forces follow (graduate flows aside, which are tiny).
    expect((s.labor[key]?.laborForce ?? 0) - opForce).toBeCloseTo(-10, 0);
    expect((s.labor[techKey]?.laborForce ?? 0) - techForce).toBeCloseTo(10, 0);
    expect(unemployed(s, key)).toBeGreaterThanOrEqual(0);
    expect(unemployed(s, techKey)).toBeGreaterThanOrEqual(0);
  });

  it('books the wage bill of the quarter', () => {
    const { state, id } = setup(3, { labor: { attrition: { baseRate: 0 } } });
    const { state: next, ctx } = runLabor(state);
    const bill = sum(
      Object.values(next.companies[id]?.workforce ?? {}).map((s) => s.headcount * s.wage),
    );
    expect(ctx.ledger(id).wages).toBeCloseTo(bill, 6);
  });
});

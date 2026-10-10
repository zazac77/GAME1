import { describe, expect, it } from 'vitest';
import {
  defaultDecisions,
  getPlayerView,
  previewDecisions,
  resolveTurn,
  type CompanyDecisions,
  type GameState,
  type IntraGroupTransfer,
  type Observation,
} from '../../src';
import type { DeepPartial, GameConfig } from '../../src/config/schema';
import { groupFinance } from '../../src/ai/modules/group';
import { emptyDecisions } from '../../src/core/decisions';
import { effectiveShares, groupDebt, groupLoansGranted } from '../../src/core/group';
import { sum } from '../../src/core/math';
import { consolidate } from '../../src/systems/conglomerate';
import { normalizeDecisions } from '../../src/systems/validation';
import { assertJsonSafe, newGame, playerCompanyId, playTurns, steadyDecisions } from '../helpers';

/** A listing arriving every quarter. */
const RICH: DeepPartial<GameConfig> = { mna: { listings: { arrivalProbability: 1 } } };

/** Gives a company cash (new equity), keeping its books balanced. */
function fund(state: GameState, id: string, amount: number): GameState {
  const s = structuredClone(state);
  const b = s.companies[id]?.books.current.balance;
  if (b) {
    b.cash += amount;
    b.equity += amount;
  }
  return s;
}

/** The player's root company owning 100 % of a bought listing. */
function withSubsidiary(seed = 5): { state: GameState; rootId: string; subId: string } {
  let state = playTurns(newGame(seed, RICH), 1);
  const rootId = playerCompanyId(state);
  state = fund(state, rootId, 100_000_000);
  const listing = state.mna.listings[0];
  if (!listing) throw new Error('no listing');
  const d = steadyDecisions(state, rootId);
  d.mna = [{ kind: 'private_purchase', targetId: listing.id }];
  state = resolveTurn(state, [d]).state;
  const sub = Object.values(state.companies).find((c) => c.name === listing.name);
  if (!sub) throw new Error('not bought');
  return { state, rootId, subId: sub.id };
}

/** Decisions of the player's group: steady for operating companies, plus extras by company. */
function groupDecisions(
  state: GameState,
  ids: string[],
  extra: Record<string, Partial<CompanyDecisions>> = {},
): CompanyDecisions[] {
  return ids.map((id) => ({ ...steadyDecisions(state, id), ...extra[id] }));
}

const balanced = (state: GameState): void => {
  for (const c of Object.values(state.companies)) {
    const b = c.books.current.balance;
    const assets = b.cash + b.inventory + b.fixedAssets + b.financialAssets + b.groupLoans;
    expect(Math.abs(assets - b.debt - b.equity - b.minorityInterests)).toBeLessThan(
      1e-6 * Math.max(1, assets),
    );
    expect(b.cash).toBeGreaterThanOrEqual(0);
  }
  for (const [id, register] of Object.entries(state.stock.registry)) {
    expect(sum(Object.values(register))).toBe(state.companies[id]?.sharesOutstanding);
  }
  assertJsonSafe(state);
};

const lastCons = (state: GameState, headId: string) => {
  const cons = state.companies[headId]?.books.consolidated?.at(-1);
  if (!cons) throw new Error('no consolidated accounts');
  return cons;
};

describe('holding company', () => {
  it('is created on top of the root company; the player keeps the same value', () => {
    const { state, rootId, subId } = withSubsidiary();
    const actorId = state.meta.playerActorId;
    const shares = state.stock.registry[rootId]?.[actorId] ?? 0;
    expect(getPlayerView(state).canCreateHolding).toBe(true);
    const next = resolveTurn(
      state,
      groupDecisions(state, [rootId, subId], { [rootId]: { createHolding: true } }),
    ).state;
    balanced(next);
    const holdingId = next.actors[actorId]?.rootCompanyId ?? '';
    const holding = next.companies[holdingId];
    expect(holdingId).not.toBe(rootId);
    expect(holding?.sector).toBe('holding');
    expect(holding?.listed).toBe(false);
    expect(next.stock.registry[holdingId]).toEqual({ [actorId]: shares });
    expect(next.stock.registry[rootId]?.[holdingId]).toBe(shares);
    expect(next.stock.registry[rootId]?.[actorId]).toBeUndefined();
    const price = next.stock.quotes[rootId]?.price ?? 0;
    expect(holding?.books.current.balance.financialAssets).toBeCloseTo(shares * price, 3);
    expect(holding?.books.current.balance.equity).toBeCloseTo(shares * price, 3);
    // Score: the holding is worth its stake in the former root (sum of the parts),
    // less the conglomerate discount of a group spanning several sectors (lot 3.2).
    const view = getPlayerView(next);
    const discount = view.synergies?.discount ?? 0;
    expect(view.score).toBeCloseTo(shares * price * (1 - discount), 0);
    expect(view.canCreateHolding).toBe(false);
    expect(view.groupCompanies.map((c) => c.companyId)).toEqual([holdingId, rootId, subId]);
    expect(next.log.some((e) => e.kind === 'holding_created')).toBe(true);
    // The consolidated accounts move to the new head.
    expect(next.companies[rootId]?.books.consolidated).toBeUndefined();
    expect(Object.keys(lastCons(next, holdingId).members)).toEqual([holdingId, rootId, subId]);

    // The game goes on: views, preview and defaults of a holding company.
    expect(defaultDecisions(next, holdingId)).toEqual(emptyDecisions(holdingId));
    expect(getPlayerView(next, holdingId).costs?.capital).toBeDefined();
    const ids = [holdingId, rootId, subId];
    const preview = previewDecisions(next, groupDecisions(next, ids));
    expect(preview.companies[holdingId]?.expectedRevenue).toBe(0);
    let later = next;
    for (let t = 0; t < 3; t++) later = resolveTurn(later, groupDecisions(later, ids)).state;
    balanced(later);
    expect(later.companies[holdingId]?.status).toBe('active');
    expect(later.companies[holdingId]?.books.history.length).toBe(4);
  });

  it('is refused for a company that is not a root, or already a holding', () => {
    const { state, rootId, subId } = withSubsidiary();
    const sub = state.companies[subId];
    if (!sub) throw new Error('no sub');
    const d = { ...emptyDecisions(subId), createHolding: true };
    const { decisions, issues } = normalizeDecisions(state, sub, d);
    expect(decisions.createHolding).toBeUndefined();
    expect(issues.map((i) => `${i.path}:${i.code}`)).toEqual(['createHolding:invalid_state']);
    const next = resolveTurn(state, [
      { ...steadyDecisions(state, rootId), createHolding: true },
    ]).state;
    const holdingId = playerCompanyId(next);
    const holding = next.companies[holdingId];
    if (!holding) throw new Error('no holding');
    const again = normalizeDecisions(next, holding, {
      ...emptyDecisions(holdingId),
      createHolding: true,
    });
    expect(again.issues.map((i) => i.code)).toEqual(['invalid_state']);
  });
});

describe('intra-group transfers', () => {
  it('a loan moves cash, earns interest for the lender and is repaid first', () => {
    const { state, rootId, subId } = withSubsidiary();
    const loan: IntraGroupTransfer = { kind: 'loan', fromId: rootId, toId: subId, amount: 2e6 };
    const rootCash = state.companies[rootId]?.books.current.balance.cash ?? 0;
    expect(rootCash).toBeGreaterThan(2e6);
    let s = resolveTurn(
      state,
      groupDecisions(state, [rootId, subId], { [rootId]: { intraGroup: [loan] } }),
    ).state;
    balanced(s);
    const sub = s.companies[subId];
    const root = s.companies[rootId];
    expect(groupDebt(sub as never)).toBeCloseTo(2e6, 6);
    expect(root?.books.current.balance.groupLoans).toBeCloseTo(2e6, 6);
    expect(root?.books.current.cashFlow.groupInvesting).toBeCloseTo(-2e6, 6);
    expect(s.log.some((e) => e.kind === 'group_loan' && e.companyId === rootId)).toBe(true);
    // The consolidated accounts eliminate it.
    const cons = lastCons(s, rootId);
    expect(cons.eliminations.loans).toBeCloseTo(2e6, 6);
    expect(cons.balance.groupLoans).toBeCloseTo(0, 6);

    // Next quarter: interest paid by the subsidiary, received by the parent (net in interest).
    const rate = (s.macro.policyRate + s.config.conglomerate.groupLoanSpread) / 4;
    const before = s;
    s = resolveTurn(s, groupDecisions(s, [rootId, subId])).state;
    const interest = (2e6 * (before.macro.policyRate + s.config.conglomerate.groupLoanSpread)) / 4;
    expect(interest).toBeCloseTo(2e6 * rate, 6);
    const consInterest = lastCons(s, rootId).pnl.interest;
    const sumInterest =
      (s.companies[rootId]?.books.current.pnl.interest ?? 0) +
      (s.companies[subId]?.books.current.pnl.interest ?? 0);
    expect(consInterest).toBeCloseTo(sumInterest, 6);

    // Repayment: a loan the other way repays first.
    s = fund(s, subId, 5e6);
    const back: IntraGroupTransfer = { kind: 'loan', fromId: subId, toId: rootId, amount: 3e6 };
    s = resolveTurn(
      s,
      groupDecisions(s, [rootId, subId], { [rootId]: { intraGroup: [back] } }),
    ).state;
    balanced(s);
    expect(groupDebt(s.companies[subId] as never)).toBe(0);
    expect(groupDebt(s.companies[rootId] as never)).toBeCloseTo(1e6, 6);
    expect(groupLoansGranted(s, subId)).toBeCloseTo(1e6, 6);
    expect(groupLoansGranted(s, rootId)).toBe(0);
  });

  it('a dividend goes up to the parent and is eliminated on consolidation', () => {
    const w = withSubsidiary();
    const { rootId, subId } = w;
    let state = w.state;
    state = fund(state, subId, 3e6);
    const dividend: IntraGroupTransfer = {
      kind: 'dividend',
      fromId: subId,
      toId: rootId,
      amount: 1e6,
    };
    const s = resolveTurn(
      state,
      groupDecisions(state, [rootId, subId], { [rootId]: { intraGroup: [dividend] } }),
    ).state;
    balanced(s);
    const root = s.companies[rootId];
    // Received as an intra-group result (the subsidiary's stake may be impaired by the payout).
    expect(root?.books.current.pnl.financial).toBeCloseTo(
      root?.books.current.pnl.groupFinancial ?? 0,
      3,
    );
    expect(root?.books.current.cashFlow.groupInvesting).toBeCloseTo(1e6, 6);
    const cons = lastCons(s, rootId);
    expect(cons.eliminations.financial).toBeCloseTo(
      sum(
        Object.keys(cons.members).map(
          (id) => s.companies[id]?.books.current.pnl.groupFinancial ?? 0,
        ),
      ),
      6,
    );
    // Consolidated net income = Σ net income − intra-group financial result.
    const total = sum(
      Object.keys(cons.members).map((id) => s.companies[id]?.books.current.pnl.netIncome ?? 0),
    );
    expect(cons.pnl.netIncome).toBeCloseTo(total - cons.eliminations.financial, 3);
    expect(cons.minorityNetIncome).toBeCloseTo(0, 6);
    expect(cons.balance.minorityInterests).toBeCloseTo(0, 3);
  });

  it('a cash pool sweeps the excess to the leader and tops up a shortfall', () => {
    const w = withSubsidiary();
    const { rootId, subId } = w;
    let state = w.state;
    state = fund(state, subId, 4e6);
    const pool: IntraGroupTransfer = {
      kind: 'cash_pool',
      fromId: subId,
      toId: rootId,
      amount: 500_000,
    };
    let s = resolveTurn(
      state,
      groupDecisions(state, [rootId, subId], { [rootId]: { intraGroup: [pool] } }),
    ).state;
    balanced(s);
    expect(s.companies[subId]?.books.current.balance.cash).toBeCloseTo(500_000, 3);
    expect(groupLoansGranted(s, subId)).toBeGreaterThan(0);
    // The pool is a standing order.
    expect(defaultDecisions(s, rootId).intraGroup).toEqual([pool]);
    const keep: IntraGroupTransfer = { ...pool, amount: 50_000_000 };
    s = resolveTurn(
      s,
      groupDecisions(s, [rootId, subId], { [rootId]: { intraGroup: [keep] } }),
    ).state;
    balanced(s);
    expect(groupLoansGranted(s, subId)).toBe(0);
    expect(groupLoansGranted(s, rootId)).toBeGreaterThan(0);
  });

  it('a restructuring moves a stake to the holding at its value, against an intra-group loan', () => {
    const { state, rootId, subId } = withSubsidiary();
    let s = resolveTurn(
      state,
      groupDecisions(state, [rootId, subId], { [rootId]: { createHolding: true } }),
    ).state;
    const holdingId = playerCompanyId(s);
    const ids = [holdingId, rootId, subId];
    const shares = s.stock.registry[subId]?.[rootId] ?? 0;
    const stake: IntraGroupTransfer = {
      kind: 'stake',
      fromId: rootId,
      toId: holdingId,
      targetId: subId,
    };
    s = resolveTurn(s, groupDecisions(s, ids, { [holdingId]: { intraGroup: [stake] } })).state;
    balanced(s);
    expect(s.stock.registry[subId]).toEqual({ [holdingId]: shares });
    const value = s.companies[holdingId]?.stakeValues[subId] ?? 0;
    expect(value).toBeGreaterThan(0);
    expect(groupDebt(s.companies[holdingId] as never)).toBeCloseTo(value, 3);
    expect(s.companies[rootId]?.books.current.balance.groupLoans).toBeCloseTo(value, 3);
    // The seller's result on the stake is intra-group: eliminated.
    const root = s.companies[rootId]?.books.current.pnl;
    expect(root?.groupFinancial).not.toBe(0);
    const cons = lastCons(s, holdingId);
    expect(cons.balance.groupLoans).toBeCloseTo(0, 3);
    expect(Object.keys(cons.members)).toEqual(ids);
    // The holding owns the actor's 60 % of the former root, and 100 % of the subsidiary.
    const founder = s.stock.registry[rootId]?.[holdingId] ?? 0;
    expect(cons.members[holdingId]?.share).toBe(1);
    expect(cons.members[rootId]?.share).toBeCloseTo(
      founder / (s.companies[rootId]?.sharesOutstanding ?? 1),
      9,
    );
    expect(cons.members[subId]?.share).toBeCloseTo(1, 9);
    // Control stays: the player still runs the subsidiary.
    expect(getPlayerView(s).groupCompanies.find((c) => c.companyId === subId)?.parentId).toBe(
      holdingId,
    );
  });

  it('validation: deciders, groups, shareholders and loops of control', () => {
    const { state, rootId, subId } = withSubsidiary();
    const sub = state.companies[subId];
    const root = state.companies[rootId];
    if (!sub || !root) throw new Error('missing');
    const rival = Object.keys(state.companies).find((id) => id !== rootId && id !== subId) ?? '';
    const d = (company: string, intraGroup: unknown[]) =>
      ({ ...emptyDecisions(company), intraGroup }) as CompanyDecisions;
    const codes = (company: typeof sub, decisions: CompanyDecisions) =>
      normalizeDecisions(state, company, decisions).issues.map((i) => `${i.path}:${i.code}`);
    expect(
      codes(
        sub,
        d(subId, [
          { kind: 'loan', fromId: rootId, toId: subId, amount: 1 }, // kept: sub is a party
          { kind: 'loan', fromId: rootId, toId: rival, amount: 1 }, // sub is not a party
          { kind: 'dividend', fromId: rootId, toId: subId, amount: 1 }, // sub holds no root share
          { kind: 'stake', fromId: rootId, toId: subId, targetId: subId }, // to the target itself
          { kind: 'loan', fromId: rootId, toId: subId, amount: -1 },
          { kind: 'gift', fromId: rootId, toId: subId, amount: 1 },
          { kind: 'cash_pool', fromId: subId, toId: rootId, amount: 0 },
          { kind: 'cash_pool', fromId: subId, toId: rootId, amount: 10 },
        ]),
      ),
    ).toEqual([
      'intraGroup[1]:not_controlled',
      'intraGroup[2]:invalid_state',
      'intraGroup[3]:invalid_state',
      'intraGroup[4].amount:invalid_value',
      'intraGroup[5].kind:invalid_value',
      'intraGroup[7]:duplicate',
    ]);
    const kept = normalizeDecisions(
      state,
      sub,
      d(subId, [
        { kind: 'loan', fromId: rootId, toId: subId, amount: 1 },
        { kind: 'cash_pool', fromId: subId, toId: rootId, amount: 0 },
      ]),
    ).decisions.intraGroup;
    expect(kept).toHaveLength(2);
    // Outside the group, a loan only repays what is owed.
    expect(
      codes(root, d(rootId, [{ kind: 'loan', fromId: rootId, toId: rival, amount: 1 }])),
    ).toEqual(['intraGroup[0]:invalid_state']);
    // A rival cannot move the player's money.
    const other = state.companies[rival];
    if (!other) throw new Error('no rival');
    expect(
      codes(other, d(rival, [{ kind: 'loan', fromId: rootId, toId: subId, amount: 1 }])),
    ).toEqual(['intraGroup[0]:not_controlled']);
  });

  it('a loan to a company that goes bankrupt is written off', () => {
    const { state, rootId, subId } = withSubsidiary();
    const loan: IntraGroupTransfer = { kind: 'loan', fromId: rootId, toId: subId, amount: 1e6 };
    let s = resolveTurn(
      state,
      groupDecisions(state, [rootId, subId], { [rootId]: { intraGroup: [loan] } }),
    ).state;
    s = structuredClone(s);
    (s.companies[subId] as GameState['companies'][string]).status = 'bankrupt';
    const equity = s.companies[rootId]?.books.current.balance.equity ?? 0;
    s = resolveTurn(s, [steadyDecisions(s, rootId)]).state;
    const root = s.companies[rootId];
    expect(root?.books.current.balance.groupLoans).toBe(0);
    expect(root?.books.current.pnl.groupFinancial).toBeLessThanOrEqual(-1e6 + 1e-6);
    expect(groupDebt(s.companies[subId] as never)).toBe(0);
    expect(s.log.some((e) => e.kind === 'group_loan_written_off')).toBe(true);
    expect(root?.books.current.balance.equity).toBeLessThan(equity);
  });
});

describe('consolidation', () => {
  it('splits equity and income with the minority shareholders by the effective shares', () => {
    const { state, rootId, subId } = withSubsidiary();
    // 30 % of the subsidiary goes to the public: the group keeps 70 %.
    const s = structuredClone(state);
    const register = s.stock.registry[subId] ?? {};
    const N = s.companies[subId]?.sharesOutstanding ?? 0;
    register[rootId] = N - Math.round(0.3 * N);
    register.public = Math.round(0.3 * N);
    const shares = effectiveShares(s, rootId, [rootId, subId]);
    expect(shares[subId]).toBeCloseTo(register[rootId] / N, 12);
    const cons = consolidate(s, rootId, s.meta.turn - 1);
    if (!cons) throw new Error('no consolidation');
    const root = s.companies[rootId] as GameState['companies'][string];
    const sub = s.companies[subId] as GameState['companies'][string];
    const stake = root.stakeValues[subId] ?? 0;
    const e = shares[subId] ?? 0;
    const naSub = sub.books.current.balance.equity;
    const naRoot = root.books.current.balance.equity - stake;
    expect(cons.balance.minorityInterests).toBeCloseTo((1 - e) * naSub, 3);
    expect(cons.balance.equity).toBeCloseTo(naRoot + e * naSub, 3);
    expect(cons.eliminations.stakes).toBeCloseTo(stake, 6);
    const b = cons.balance;
    const assets = b.cash + b.inventory + b.fixedAssets + b.financialAssets + b.groupLoans;
    expect(assets).toBeCloseTo(b.debt + b.equity + b.minorityInterests, 3);
    const niSub = sub.books.current.pnl.netIncome - sub.books.current.pnl.groupFinancial;
    expect(cons.minorityNetIncome).toBeCloseTo((1 - e) * niSub, 3);
    expect(cons.pnl.revenue).toBeCloseTo(
      root.books.current.pnl.revenue + sub.books.current.pnl.revenue,
      6,
    );
  });
});

describe('AI intra-group financing', () => {
  const obs = (isHead: boolean, members: Observation['group']['members']): Observation =>
    ({
      companyId: 'co_a',
      config: newGame(1).config,
      group: { isHead, companies: Object.keys(members), members },
    }) as unknown as Observation;
  const member = (cash: number, costs: number, overdraft = 0, owes = {}) => ({
    status: 'active' as const,
    cash,
    overdraft,
    quarterlyCashCosts: costs,
    owes,
  });

  it('a head tops up a subsidiary short of cash from its own excess', () => {
    const d = emptyDecisions('co_a');
    groupFinance(obs(true, { co_a: member(10e6, 2e6), co_b: member(100_000, 1e6, 300_000) }), d);
    // Target: 0.75 quarter of costs + the overdraft − cash.
    expect(d.intraGroup).toEqual([{ kind: 'loan', fromId: 'co_a', toId: 'co_b', amount: 950_000 }]);
    const none = emptyDecisions('co_a');
    groupFinance(obs(true, { co_a: member(10e6, 2e6), co_b: member(900_000, 1e6) }), none);
    expect(none.intraGroup).toBeUndefined();
  });

  it('a company repays its group debt with the cash above its buffer', () => {
    const d = emptyDecisions('co_a');
    groupFinance(obs(false, { co_a: member(5e6, 2e6, 0, { co_h: 1e6 }) }), d);
    expect(d.intraGroup).toEqual([{ kind: 'loan', fromId: 'co_a', toId: 'co_h', amount: 1e6 }]);
  });
});

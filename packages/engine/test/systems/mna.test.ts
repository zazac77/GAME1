import { describe, expect, it } from 'vitest';
import { resolveTurn } from '../../src';
import type { CompanyDecisions, GameState, MnaAction } from '../../src';
import type { DeepPartial, GameConfig } from '../../src/config/schema';
import { controlledCompanyIds, isOperating } from '../../src/core/companies';
import { controllingActor } from '../../src/core/control';
import { sum } from '../../src/core/math';
import { valueEquity } from '../../src/core/valuation';
import { unemployed } from '../../src/systems/labor/pools';
import {
  acquisitionDebtCapacity,
  boardPremium,
  dueDiligenceCost,
  listingPrice,
} from '../../src/systems/mna';
import { holdings } from '../../src/systems/stockmarket';
import { normalizeDecisions } from '../../src/systems/validation';
import { assertJsonSafe, newGame, playerCompanyId, playTurns, steadyDecisions } from '../helpers';

/** A listing arriving every quarter. */
const RICH: DeepPartial<GameConfig> = { mna: { listings: { arrivalProbability: 1 } } };

/** Gives the player's company cash (new equity), keeping the books balanced. */
function fund(state: GameState, amount: number): GameState {
  const s = structuredClone(state);
  const b = s.companies[playerCompanyId(s)]?.books.current.balance;
  if (b) {
    b.cash += amount;
    b.equity += amount;
  }
  return s;
}

const play = (state: GameState, extra: Partial<CompanyDecisions> = {}): GameState => {
  const d = { ...steadyDecisions(state, playerCompanyId(state)), ...extra };
  return resolveTurn(state, [d]).state;
};

const balanced = (state: GameState) => {
  for (const c of Object.values(state.companies)) {
    const b = c.books.current.balance;
    const assets = b.cash + b.inventory + b.fixedAssets + b.financialAssets;
    expect(Math.abs(assets - b.debt - b.equity - b.minorityInterests)).toBeLessThan(
      1e-6 * Math.max(1, assets),
    );
    expect(b.cash).toBeGreaterThanOrEqual(0);
  }
  for (const [id, register] of Object.entries(state.stock.registry)) {
    expect(sum(Object.values(register))).toBe(state.companies[id]?.sharesOutstanding);
  }
  for (const key of Object.keys(state.labor)) {
    expect(unemployed(state, key as `${string}:${string}`)).toBeGreaterThanOrEqual(-1e-6);
  }
  assertJsonSafe(state);
};

/** An AI rival of the player's sector, run by the given profile. */
const rival = (state: GameState, profileId = 'low_cost') => {
  const actor = Object.values(state.actors).find(
    (a) =>
      a.profileId === profileId &&
      state.companies[a.rootCompanyId]?.sector === state.config.scenario.playerSector,
  );
  if (!actor) throw new Error('no rival');
  return { actor, company: state.companies[actor.rootCompanyId] as GameState['companies'][string] };
};

describe('listings ("pépites")', () => {
  it('arrive with a noisy estimate, an asking price above value, and expire', () => {
    let state = newGame(5, RICH);
    expect(state.mna.listings).toEqual([]);
    state = playTurns(state, 1);
    expect(state.mna.listings).toHaveLength(1);
    const listing = state.mna.listings[0];
    if (!listing) throw new Error('no listing');
    expect(listing.estimate).not.toEqual(listing.actual);
    expect(listing.askingPrice).toBeGreaterThan(0);
    const value = valueEquity(
      state.config,
      state.macro.policyRate,
      listing.sector,
      listing.actual,
      0,
      listing.netDebt,
      0,
    );
    expect(listing.askingPrice).toBeGreaterThan(value.mid);
    expect(state.log.some((e) => e.kind === 'company_for_sale')).toBe(true);
    // At most maxOpen at a time; each one leaves after durationQuarters.
    const L = state.config.mna.listings;
    for (let t = 0; t < L.durationQuarters + 1; t++) {
      state = playTurns(state, 1);
      expect(state.mna.listings.length).toBeLessThanOrEqual(L.maxOpen);
    }
    expect(state.mna.listings.find((l) => l.id === listing.id)).toBeUndefined();
  });
});

describe('due diligence', () => {
  it('costs money now and reveals the actual figures and hidden liability next quarter', () => {
    let state = fund(playTurns(newGame(6, RICH), 1), 50_000_000);
    const listing = state.mna.listings[0];
    if (!listing) throw new Error('no listing');
    const id = playerCompanyId(state);
    const cost = dueDiligenceCost(state, listing.id);
    const action: MnaAction = { kind: 'due_diligence', targetId: listing.id };
    const without = play(state);
    state = play(state, { mna: [action] });
    const other = (s: GameState) => s.companies[id]?.books.current.pnl.other ?? 0;
    expect(other(state) - other(without)).toBeCloseTo(cost, 0);
    const dd = state.mna.diligence.find((d) => d.targetId === listing.id);
    expect(dd?.figures).toEqual(listing.actual);
    expect(dd?.hiddenLiability).toBe(listing.hiddenLiability);
    // A second one on the same target is refused while the first is valid.
    const again = normalizeDecisions(state, state.companies[id] as never, {
      ...steadyDecisions(state, id),
      mna: [action],
    });
    expect(again.issues.map((i) => i.code)).toContain('duplicate');
  });
});

describe('buying a listing', () => {
  it('creates a wholly owned, unlisted subsidiary run by its management', () => {
    let state = fund(playTurns(newGame(7, RICH), 1), 100_000_000);
    // Look for a listing with a hidden liability over a few seeds' worth of quarters.
    for (let t = 0; t < 8 && !state.mna.listings.some((l) => l.hiddenLiability > 0); t++) {
      state = playTurns(state, 1);
    }
    const listing = state.mna.listings.find((l) => l.hiddenLiability > 0) ?? state.mna.listings[0];
    if (!listing) throw new Error('no listing');
    const id = playerCompanyId(state);
    // Due diligence first: the revealed liability comes off the price.
    state = play(state, { mna: [{ kind: 'due_diligence', targetId: listing.id }] });
    const price = listingPrice(state, id, listing);
    expect(price).toBeCloseTo(listing.askingPrice - listing.hiddenLiability, 3);
    const before = state;
    state = play(state, { mna: [{ kind: 'private_purchase', targetId: listing.id }] });
    balanced(state);

    const sub = Object.values(state.companies).find((c) => c.name === listing.name);
    if (!sub) throw new Error('not bought');
    expect(sub.listed).toBe(false);
    expect(sub.sector).toBe(listing.sector);
    expect(sub.managementProfileId).toBe(listing.managementProfileId);
    expect(state.stock.registry[sub.id]).toEqual({ [id]: sub.sharesOutstanding });
    expect(controlledCompanyIds(state, state.meta.playerActorId).has(sub.id)).toBe(true);
    expect(state.mna.listings.find((l) => l.id === listing.id)).toBeUndefined();
    const parent = state.companies[id];
    expect(parent?.participations[sub.id]?.cost).toBeCloseTo(price, 3);
    // Carried at cost until its first quarter closes.
    expect(holdings(state, parent as never)[sub.id]?.carrying).toBeCloseTo(price, 3);
    const cashDrop =
      (before.companies[id]?.books.current.balance.cash ?? 0) -
      (state.companies[id]?.books.current.balance.cash ?? 0);
    expect(cashDrop).toBeGreaterThan(price * 0.5);
    expect(state.log.some((e) => e.kind === 'takeover' && e.data?.targetId === sub.id)).toBe(true);
    // Integration: talent departures and a productivity dip.
    expect(state.modifiers.filter((m) => m.target.id === sub.id)).toHaveLength(2);

    // Next quarter: the management runs it, the undeclared liability hits its accounts.
    state = play(state);
    balanced(state);
    const run = state.companies[sub.id];
    expect(run?.lastDecisions).toBeDefined();
    expect(Object.keys(run?.lastDecisions?.pricing ?? {}).length).toBeGreaterThan(0);
    if (listing.hiddenLiability > 0) {
      expect(state.log.some((e) => e.kind === 'hidden_liability' && e.companyId === sub.id)).toBe(
        true,
      );
      expect(run?.books.current.pnl.other ?? 0).toBeGreaterThan(listing.hiddenLiability);
    }
    // The player may decide for it instead.
    const own = steadyDecisions(state, sub.id);
    const next = resolveTurn(state, [steadyDecisions(state, id), own]).state;
    const expected = normalizeDecisions(state, state.companies[sub.id] as never, own).decisions;
    expect(next.companies[sub.id]?.lastDecisions?.marketing).toEqual(expected.marketing);
    balanced(next);
  });
});

describe('friendly tender offer', () => {
  const offer = (state: GameState, premium: number, extra: Partial<MnaAction> = {}) => {
    const { company } = rival(state);
    const price = (state.stock.quotes[company.id]?.referencePrice ?? 0) * (1 + premium);
    const action = {
      kind: 'tender_offer',
      targetId: company.id,
      pricePerShare: price,
      ...extra,
    } as MnaAction;
    return { company, next: play(state, { mna: [action] }) };
  };

  it('is rejected by the board below its asking premium, nothing changes hands', () => {
    const state = fund(playTurns(newGame(8, RICH), 2), 300_000_000);
    const { company } = rival(state);
    const board = boardPremium(state, company) ?? 0;
    expect(board).toBeGreaterThan(0);
    const { next } = offer(state, board / 2);
    expect(next.stock.registry[company.id]).toEqual(state.stock.registry[company.id]);
    expect(next.stock.tenderOffers.at(-1)?.status).toBe('rejected');
    expect(next.log.some((e) => e.kind === 'tender_offer_rejected')).toBe(true);
  });

  it('takes control with the board, the founder and part of the float', () => {
    const state = fund(playTurns(newGame(8, RICH), 2), 300_000_000);
    const { actor, company } = rival(state);
    const board = boardPremium(state, company) ?? 0;
    const { next } = offer(state, board + 0.05);
    balanced(next);
    const id = playerCompanyId(state);
    const register = next.stock.registry[company.id] ?? {};
    expect(register[actor.id] ?? 0).toBe(0);
    expect(register[id] ?? 0).toBeGreaterThan(0.5 * company.sharesOutstanding);
    expect(controllingActor(next, company.id)).toBe(next.meta.playerActorId);
    const tender = next.stock.tenderOffers.at(-1);
    expect(tender?.status).toBe('succeeded');
    expect(tender?.acquired).toBe(register[id]);
    // A higher premium convinces more of the float (same draws of the tranches).
    const { next: richer } = offer(state, board + 0.4);
    const held = (s: GameState) => s.stock.registry[company.id]?.[id] ?? 0;
    expect(held(richer)).toBeGreaterThanOrEqual(held(next));
    // Management in place keeps running the company for its new owner.
    const later = play(next);
    expect(later.companies[company.id]?.lastDecisions?.hr.length).toBeGreaterThan(0);
    balanced(later);
  });

  it('pays partly in new shares and with an acquisition loan', () => {
    const state = fund(playTurns(newGame(9, RICH), 2), 5_000_000);
    const id = playerCompanyId(state);
    const player = state.companies[id] as GameState['companies'][string];
    const { company } = rival(state);
    const board = boardPremium(state, company) ?? 0;
    const debt = acquisitionDebtCapacity(state, player, company.id);
    expect(debt).toBeGreaterThan(0);
    // Too many new shares would cost the player the control of its own company: refused.
    const greedy = offer(state, board + 0.05, { stockShare: 0.9, debt } as Partial<MnaAction>).next;
    expect(greedy.stock.tenderOffers.at(-1)?.status).toBe('failed');
    expect(greedy.stock.registry[company.id]).toEqual(state.stock.registry[company.id]);

    const { next } = offer(state, board + 0.05, { stockShare: 0.05, debt } as Partial<MnaAction>);
    balanced(next);
    expect(next.stock.tenderOffers.at(-1)?.status).toBe('succeeded');
    const after = next.companies[id] as GameState['companies'][string];
    expect(after.sharesOutstanding).toBeGreaterThan(player.sharesOutstanding);
    expect(controlledCompanyIds(next, next.meta.playerActorId).has(id)).toBe(true);
    // The cash at hand was not enough: an acquisition loan was drawn.
    const debtOf = (c: typeof player) => sum(c.loans.map((l) => l.principal));
    expect(debtOf(after)).toBeGreaterThan(debtOf(player));
  });
});

describe('block purchase', () => {
  it('buys the founder block above its asking premium only', () => {
    const state = fund(playTurns(newGame(10, RICH), 2), 300_000_000);
    const { actor, company } = rival(state, 'premium');
    const ref = state.stock.quotes[company.id]?.referencePrice ?? 0;
    const block = (premium: number) =>
      play(state, {
        mna: [
          { kind: 'private_purchase', targetId: company.id, pricePerShare: ref * (1 + premium) },
        ],
      });
    const low = block(0.1);
    expect(low.stock.registry[company.id]).toEqual(state.stock.registry[company.id]);
    expect(low.log.some((e) => e.kind === 'block_purchase_rejected')).toBe(true);
    const high = block(0.6);
    balanced(high);
    const id = playerCompanyId(state);
    expect(high.stock.registry[company.id]?.[actor.id] ?? 0).toBe(0);
    expect(high.stock.registry[company.id]?.[id]).toBe(
      state.stock.registry[company.id]?.[actor.id],
    );
    expect(isOperating(high.companies[company.id] as never)).toBe(true);
  });
});

describe('AI targets', () => {
  it('never get to bid for the player companies', () => {
    const state = playTurns(newGame(11, RICH), 2);
    const { company } = rival(state);
    const id = playerCompanyId(state);
    const d = steadyDecisions(state, company.id);
    d.mna = [{ kind: 'tender_offer', targetId: id, pricePerShare: 1e6 }];
    const { issues, decisions } = normalizeDecisions(state, company, d);
    expect(decisions.mna).toEqual([]);
    expect(issues.map((i) => i.code)).toContain('invalid_state');
  });
});

describe('public offering of a subsidiary', () => {
  it('lists it once it has closed enough quarters; the parent keeps control', () => {
    let state = fund(playTurns(newGame(12, RICH), 1), 100_000_000);
    const listing = state.mna.listings[0];
    if (!listing) throw new Error('no listing');
    const id = playerCompanyId(state);
    state = play(state, { mna: [{ kind: 'private_purchase', targetId: listing.id }] });
    const sub = Object.values(state.companies).find((c) => c.name === listing.name);
    if (!sub) throw new Error('not bought');
    const ipo = (s: GameState) => ({ ...steadyDecisions(s, sub.id), finance: { ipo: true } });
    // Not before stockMarket.ipo.minQuarters closed quarters.
    const early = normalizeDecisions(state, state.companies[sub.id] as never, ipo(state));
    expect(early.decisions.finance.ipo).toBeUndefined();
    expect(early.issues.map((i) => i.code)).toContain('invalid_state');
    for (let t = 0; t < state.config.stockMarket.ipo.minQuarters; t++) state = play(state);
    const N = state.companies[sub.id]?.sharesOutstanding ?? 0;
    const next = resolveTurn(state, [steadyDecisions(state, id), ipo(state)]).state;
    balanced(next);
    const listed = next.companies[sub.id];
    expect(listed?.listed).toBe(true);
    expect(next.stock.quotes[sub.id]).toBeDefined();
    const register = next.stock.registry[sub.id] ?? {};
    const floatShare = state.config.stockMarket.ipo.floatShare;
    expect((register.public ?? 0) / (listed?.sharesOutstanding ?? 1)).toBeCloseTo(floatShare, 3);
    expect(register[id]).toBe(N);
    expect(controlledCompanyIds(next, next.meta.playerActorId).has(sub.id)).toBe(true);
    expect(listed?.books.current.cashFlow.financing).toBeGreaterThan(0);
    expect(next.log.some((e) => e.kind === 'ipo' && e.companyId === sub.id)).toBe(true);
    // Its parent still carries it at cost (it is in the group).
    expect(next.companies[id]?.participations[sub.id]).toBeDefined();
  });
});

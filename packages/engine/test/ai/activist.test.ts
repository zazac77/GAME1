import { describe, expect, it } from 'vitest';
import type { GameState } from '../../src';
import { askedPremium, canTarget } from '../../src/systems/mna';
import { assertJsonSafe, newGame, playerCompanyId, playTurns } from '../helpers';

const fundOf = (state: GameState) => {
  const actor = Object.values(state.actors).find((a) => a.kind === 'fund');
  if (!actor) throw new Error('no fund');
  return { actor, company: state.companies[actor.rootCompanyId] as GameState['companies'][string] };
};

/** A game with the fund, in which every listed company counts as undervalued (it buys at once). */
function undervalued(seed: number): GameState {
  const state = newGame(seed, { stockMarket: { activist: { enabled: true } } });
  state.config.stockMarket.activist.minUndervaluation = -10;
  state.config.stockMarket.activist.exitUndervaluation = -20;
  return state;
}

describe('activist fund (optional)', () => {
  it('stays out of a default game', () => {
    const state = newGame(30);
    expect(Object.values(state.actors).some((a) => a.kind === 'fund')).toBe(false);
  });

  it('buys into undervalued companies up to maxStake, campaigns and tenders cheaply', () => {
    let state = undervalued(31);
    const { actor, company } = fundOf(state);
    expect(company.sector).toBe('holding');
    expect(company.listed).toBe(false);
    expect(company.books.current.balance.cash).toBe(state.config.stockMarket.activist.capital);
    expect(state.stock.registry[company.id]).toEqual({ [actor.id]: company.sharesOutstanding });
    state = playTurns(state, 4);
    assertJsonSafe(state);
    const A = state.config.stockMarket.activist;
    const stakes = Object.entries(state.stock.registry).filter(
      ([, register]) => (register[company.id] ?? 0) > 0,
    );
    expect(stakes.length).toBeGreaterThan(0);
    expect(stakes.length).toBeLessThanOrEqual(A.maxPositions);
    for (const [targetId, register] of stakes) {
      const N = state.companies[targetId]?.sharesOutstanding ?? 1;
      expect((register[company.id] ?? 0) / N).toBeLessThanOrEqual(A.maxStake + 1e-9);
    }
    // Its stake of at least campaignStake: a public campaign.
    const big = stakes.find(
      ([id, r]) =>
        (r[company.id] ?? 0) >= A.campaignStake * (state.companies[id]?.sharesOutstanding ?? 1),
    );
    expect(big).toBeDefined();
    expect(state.stock.campaigns.some((c) => c.targetId === big?.[0])).toBe(true);
    expect(state.log.some((e) => e.kind === 'activist_campaign' && e.companyId === big?.[0])).toBe(
      true,
    );
    // The fund tenders to any offer at its low premium, and is not for sale.
    const target = state.companies[stakes[0]?.[0] ?? ''];
    if (!target) throw new Error('no stake');
    expect(askedPremium(state, company.id, target)).toBe(A.tenderPremium);
    const player = state.companies[playerCompanyId(state)];
    expect(canTarget(state, player as never, company)).toBe(false);
  });

  it('sells its positions once they are no longer undervalued', () => {
    let state = undervalued(32);
    const { company } = fundOf(state);
    state = playTurns(state, 2);
    const held = (s: GameState) =>
      Object.values(s.stock.registry).reduce((n, r) => n + (r[company.id] ?? 0), 0);
    expect(held(state)).toBeGreaterThan(0);
    // Every price now counts as at its fundamental value: it sells, and buys nothing new.
    state.config.stockMarket.activist.exitUndervaluation = 10;
    state.config.stockMarket.activist.minUndervaluation = 10;
    const before = held(state);
    state = playTurns(state, 1);
    expect(held(state)).toBeLessThan(before);
  });
});

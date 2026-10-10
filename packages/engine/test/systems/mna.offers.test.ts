import { describe, expect, it } from 'vitest';
import { getPlayerView, resolveTurn } from '../../src';
import type { CompanyDecisions, GameState, MnaAction } from '../../src';
import type { DeepPartial, GameConfig } from '../../src/config/schema';
import { controllingActor } from '../../src/core/control';
import { sum } from '../../src/core/math';
import { boardPremium, contestable, minCompetingPrice } from '../../src/systems/mna';
import { normalizeDecisions } from '../../src/systems/validation';
import {
  assertJsonSafe,
  newGame,
  playerCompanyId,
  playTurns,
  resolveAll,
  steadyDecisions,
} from '../helpers';

/** No AI deal of its own (white knights included): the offers of the tests stay alone. */
const QUIET: DeepPartial<GameConfig> = {
  ai: {
    profiles: {
      opportunist: { acquisitiveness: 0 },
      conglomerate: { acquisitiveness: 0 },
    },
  },
};

const withPill = (pill: number, ratio = 0.5): DeepPartial<GameConfig> => ({
  ...QUIET,
  ai: { profiles: { ...QUIET.ai?.profiles, premium: { poisonPill: pill } } },
  mna: { offers: { pillShareRatio: ratio } },
});

/** Gives a company cash (new equity), keeping the books balanced. */
function fund(state: GameState, amount: number, id = playerCompanyId(state)): GameState {
  const s = structuredClone(state);
  const b = s.companies[id]?.books.current.balance;
  if (b) {
    b.cash += amount;
    b.equity += amount;
  }
  return s;
}

const balanced = (state: GameState) => {
  for (const c of Object.values(state.companies)) {
    const b = c.books.current.balance;
    const assets = b.cash + b.inventory + b.fixedAssets + b.financialAssets + b.groupLoans;
    expect(Math.abs(assets - b.debt - b.equity - b.minorityInterests)).toBeLessThan(
      1e-6 * Math.max(1, assets),
    );
  }
  for (const [id, register] of Object.entries(state.stock.registry)) {
    expect(sum(Object.values(register))).toBe(state.companies[id]?.sharesOutstanding);
  }
  assertJsonSafe(state);
};

/** The premium AI rival of the player's sector: its founder keeps 40 %, nobody controls it. */
const premiumRival = (state: GameState) => {
  const actor = Object.values(state.actors).find(
    (a) =>
      a.profileId === 'premium' &&
      state.companies[a.rootCompanyId]?.sector === state.config.scenario.playerSector,
  );
  if (!actor) throw new Error('no premium rival');
  return { actor, company: state.companies[actor.rootCompanyId] as GameState['companies'][string] };
};

const play = (state: GameState, extra: Partial<CompanyDecisions> = {}): GameState =>
  resolveTurn(state, [{ ...steadyDecisions(state, playerCompanyId(state)), ...extra }]).state;

/** Buys the target on the market every quarter until the group holds `share` of it. */
function buildStake(state: GameState, targetId: string, share: number): GameState {
  let s = state;
  const id = playerCompanyId(s);
  for (let t = 0; t < 12; t++) {
    const held = s.stock.registry[targetId]?.[id] ?? 0;
    const N = s.companies[targetId]?.sharesOutstanding ?? 0;
    if (held >= share * N - 1) break;
    s = play(s, {
      stockOrders: [{ targetId, side: 'buy', shares: Math.ceil(share * N - held) }],
    });
  }
  return s;
}

const hostile = (state: GameState, targetId: string, premium: number): MnaAction => ({
  kind: 'tender_offer',
  targetId,
  pricePerShare: (state.stock.quotes[targetId]?.referencePrice ?? 0) * (1 + premium),
  hostile: true,
});

describe('hostile tender offer', () => {
  it('opens over the board, then takes control from the shareholders at its close', () => {
    let state = fund(playTurns(newGame(21, withPill(0)), 2), 300_000_000);
    const { actor, company } = premiumRival(state);
    expect(controllingActor(state, company.id)).toBeUndefined();
    expect(contestable(state, company)).toBe(true);
    const board = boardPremium(state, company) ?? 0;
    const id = playerCompanyId(state);
    const before = structuredClone(state.stock.registry[company.id]);
    state = play(state, { mna: [hostile(state, company.id, board - 0.05)] });
    balanced(state);
    // Nothing changes hands at launch: the offer stays open one quarter.
    expect(state.stock.registry[company.id]).toEqual(before);
    const offer = state.stock.tenderOffers.at(-1);
    expect(offer?.status).toBe('open');
    expect(offer?.hostile).toBe(true);
    expect(offer?.expiresAt).toBe(state.meta.turn);
    expect(offer?.defenses).toEqual({ pill: false, whiteKnight: true });
    expect(state.log.some((e) => e.kind === 'hostile_offer' && e.companyId === id)).toBe(true);
    // The player sees it among the open offers, as its own.
    const view = getPlayerView(state).offers.find((o) => o.offer.id === offer?.id);
    expect(view?.mine).toBe(true);
    expect(view?.canWithdraw).toBe(false);
    expect(view?.minRaise).toBeCloseTo((offer?.pricePerShare ?? 0) * 1.02, 6);

    state = play(state);
    balanced(state);
    const closed = state.stock.tenderOffers.find((o) => o.id === offer?.id);
    expect(closed?.status).toBe('succeeded');
    // The founder (asking more) kept its shares; the float gave the control.
    expect(state.stock.registry[company.id]?.[actor.id]).toBe(before?.[actor.id]);
    expect(controllingActor(state, company.id)).toBe(state.meta.playerActorId);
    const news = state.log.find((e) => e.kind === 'takeover' && e.data?.targetId === company.id);
    expect(news?.data?.hostile).toBe(true);
  });

  it('fails without enough shares tendered, nothing changes hands', () => {
    let state = fund(playTurns(newGame(21, withPill(0)), 2), 300_000_000);
    const { company } = premiumRival(state);
    const before = structuredClone(state.stock.registry[company.id]);
    state = play(state, { mna: [hostile(state, company.id, 0)] });
    state = play(state);
    expect(state.stock.registry[company.id]).toEqual(before);
    expect(state.stock.tenderOffers.at(-1)?.status).toBe('failed');
    expect(state.log.some((e) => e.kind === 'deal_failed' && e.data?.reason === 'no_control')).toBe(
      true,
    );
  });

  it('cannot take a company its controlling shareholder holds against its will', () => {
    let state = fund(playTurns(newGame(21, QUIET), 2), 300_000_000);
    const low = Object.values(state.actors).find(
      (a) =>
        a.profileId === 'low_cost' &&
        state.companies[a.rootCompanyId]?.sector === state.config.scenario.playerSector,
    );
    const target = state.companies[low?.rootCompanyId ?? ''];
    if (!target) throw new Error('no target');
    expect(contestable(state, target)).toBe(false);
    state = play(state, { mna: [hostile(state, target.id, 0.15)] });
    expect(state.stock.tenderOffers.at(-1)?.status).toBe('open');
    state = play(state);
    expect(state.stock.tenderOffers.at(-1)?.status).toBe('failed');
    expect(controllingActor(state, target.id)).toBe(low?.id);
  });
});

describe('poison pill', () => {
  it('dilutes the holders who kept their shares when the offer wins against the board', () => {
    let state = fund(playTurns(newGame(22, withPill(1, 0.25)), 1), 400_000_000);
    const { company } = premiumRival(state);
    state = buildStake(state, company.id, 0.3);
    const id = playerCompanyId(state);
    const N = company.sharesOutstanding;
    expect(state.stock.registry[company.id]?.[id] ?? 0).toBeGreaterThan(0.29 * N);
    state = play(state, { mna: [hostile(state, company.id, 0.4)] });
    const offer = state.stock.tenderOffers.at(-1);
    expect(offer?.defenses.pill).toBe(true);
    const priceBefore = state.stock.quotes[company.id]?.price ?? 0;
    state = play(state);
    balanced(state);
    expect(state.stock.tenderOffers.find((o) => o.id === offer?.id)?.status).toBe('succeeded');
    const after = state.companies[company.id];
    expect(after?.sharesOutstanding).toBeGreaterThan(N);
    expect(state.log.some((e) => e.kind === 'poison_pill' && e.companyId === company.id)).toBe(
      true,
    );
    // Control kept after the dilution; price and published share counts adjusted.
    expect(controllingActor(state, company.id)).toBe(state.meta.playerActorId);
    const held = state.stock.registry[company.id]?.[id] ?? 0;
    expect(held / (after?.sharesOutstanding ?? 1)).toBeGreaterThan(0.5);
    expect(after?.books.history.at(-2)?.shares).toBeGreaterThan(N);
    expect(state.stock.quotes[company.id]?.price ?? 0).toBeLessThan(
      Math.max(priceBefore, offer?.pricePerShare ?? 0),
    );
  });

  it('defeats an offer that would not keep control after it', () => {
    let state = fund(playTurns(newGame(22, withPill(1, 0.5)), 2), 400_000_000);
    const { company } = premiumRival(state);
    const before = structuredClone(state.stock.registry[company.id]);
    state = play(state, { mna: [hostile(state, company.id, 0.4)] });
    const offer = state.stock.tenderOffers.at(-1);
    expect(offer?.defenses.pill).toBe(true);
    // After a pill the bidder may withdraw.
    expect(getPlayerView(state).offers.find((o) => o.offer.id === offer?.id)?.canWithdraw).toBe(
      true,
    );
    state = play(state);
    expect(state.stock.tenderOffers.find((o) => o.id === offer?.id)?.status).toBe('failed');
    expect(state.stock.registry[company.id]).toEqual(before);
  });
});

describe('competing offers', () => {
  it('extend the contest; raises compete; the best price wins at the close', () => {
    let state = fund(playTurns(newGame(23, withPill(0)), 2), 400_000_000);
    const { company } = premiumRival(state);
    const id = playerCompanyId(state);
    const knight = Object.values(state.actors).find((a) => a.profileId === 'conglomerate');
    const knightId = knight?.rootCompanyId ?? '';
    state = fund(state, 400_000_000, knightId);
    const board = boardPremium(state, company) ?? 0;
    // Quarter 1: the player's hostile offer.
    state = resolveAll(state, [
      { ...steadyDecisions(state, id), mna: [hostile(state, company.id, board - 0.1)] },
    ]).state;
    const first = state.stock.tenderOffers.at(-1);
    expect(first?.status).toBe('open');
    // Quarter 2: a white knight; below the minimum overbid it is refused.
    const min = minCompetingPrice(state, company.id);
    const knightBid = (price: number): CompanyDecisions => ({
      ...steadyDecisions(state, knightId),
      mna: [{ kind: 'tender_offer', targetId: company.id, pricePerShare: price }],
    });
    const refused = normalizeDecisions(
      state,
      state.companies[knightId] as never,
      knightBid(min * 0.99),
    );
    expect(refused.issues.map((i) => i.code)).toContain('limit');
    // A block purchase waits for the close.
    const block = normalizeDecisions(state, state.companies[knightId] as never, {
      ...steadyDecisions(state, knightId),
      mna: [{ kind: 'private_purchase', targetId: company.id, pricePerShare: min * 2 }],
    });
    expect(block.decisions.mna).toEqual([]);
    state = resolveAll(state, [steadyDecisions(state, id), knightBid(min * 1.01)]).state;
    balanced(state);
    const open = state.stock.tenderOffers.filter(
      (o) => o.status === 'open' && o.targetId === company.id,
    );
    expect(open).toHaveLength(2);
    // The contest goes on one more quarter.
    expect(open.every((o) => o.expiresAt === state.meta.turn)).toBe(true);
    expect(state.log.some((e) => e.kind === 'competing_offer')).toBe(true);
    const mine = getPlayerView(state).offers.find((o) => o.mine);
    expect(mine?.canWithdraw).toBe(true);
    // Quarter 3: the player raises above the knight, to what its board asks (the
    // founder then tenders: its buybacks since the launch made a hostile win uncertain).
    const raise = Math.max(
      (mine?.minRaise ?? 0) * 1.01,
      (first?.basePrice ?? 0) * (1 + board + 0.01),
    );
    state = resolveAll(state, [
      {
        ...steadyDecisions(state, id),
        mna: [{ kind: 'raise_offer', offerId: first?.id ?? '', pricePerShare: raise }],
      },
      steadyDecisions(state, knightId),
    ]).state;
    expect(state.stock.tenderOffers.find((o) => o.id === first?.id)?.pricePerShare).toBeCloseTo(
      raise,
      6,
    );
    expect(state.log.some((e) => e.kind === 'tender_offer_raised')).toBe(true);
    // Quarter 4: the close (maxQuarters after the first launch), the player's price is the best.
    state = resolveAll(state, [steadyDecisions(state, id), steadyDecisions(state, knightId)]).state;
    balanced(state);
    const offers = state.stock.tenderOffers.filter((o) => o.targetId === company.id);
    expect(offers.find((o) => o.id === first?.id)?.status).toBe('succeeded');
    expect(offers.find((o) => o.bidderId === knightId)?.status).toBe('failed');
    expect(controllingActor(state, company.id)).toBe(state.meta.playerActorId);
  });
});

describe('validation of offer moves', () => {
  it('withdraws only an outbid or pilled offer, tenders only shares held', () => {
    let state = fund(playTurns(newGame(21, withPill(0)), 2), 300_000_000);
    const { company } = premiumRival(state);
    const id = playerCompanyId(state);
    state = play(state, { mna: [hostile(state, company.id, 0.3)] });
    const offerId = state.stock.tenderOffers.at(-1)?.id ?? '';
    const check = (mna: MnaAction[], who = id) =>
      normalizeDecisions(state, state.companies[who] as never, {
        ...steadyDecisions(state, who),
        mna,
      });
    expect(check([{ kind: 'withdraw_offer', offerId }]).issues.map((i) => i.code)).toContain(
      'invalid_state',
    );
    expect(check([{ kind: 'withdraw_offer', offerId: 'opa_999' }]).issues[0]?.code).toBe(
      'unknown_id',
    );
    // A second offer of the same group on the target: a raise is the way.
    expect(check([hostile(state, company.id, 0.6)]).issues.map((i) => i.code)).toContain(
      'duplicate',
    );
    const raise = check([
      { kind: 'raise_offer', offerId, pricePerShare: minCompetingPrice(state, company.id) },
    ]);
    expect(raise.decisions.mna).toHaveLength(1);
    // Another AI holds no share of the target: it cannot tender.
    const other = Object.values(state.actors).find((a) => a.profileId === 'low_cost');
    expect(
      check([{ kind: 'tender_shares', offerId }], other?.rootCompanyId).issues.map((i) => i.code),
    ).toContain('invalid_state');
  });
});

describe('disclosure thresholds and the mandatory offer', () => {
  it('declares the stakes crossing 5 and 10 %, and stops market buying at 30 %', () => {
    let state = fund(playTurns(newGame(24, QUIET), 1), 300_000_000);
    const { company } = premiumRival(state);
    const id = playerCompanyId(state);
    const actorId = state.meta.playerActorId;
    const N = company.sharesOutstanding;
    state = play(state, {
      stockOrders: [{ targetId: company.id, side: 'buy', shares: Math.floor(0.06 * N) }],
    });
    const held = state.stock.registry[company.id]?.[id] ?? 0;
    expect(held).toBeGreaterThanOrEqual(0.05 * N);
    expect(state.stock.declared[company.id]?.[actorId]).toBe(0.05);
    const news = state.log.find(
      (e) =>
        e.kind === 'stake_threshold' &&
        e.companyId === company.id &&
        e.turn === state.meta.turn - 1,
    );
    expect(news?.data?.holderId).toBe(actorId);
    expect(news?.data?.level).toBe(0.05);
    // The founder's own declaration (40 %) is in place from the start, no news.
    const founder = Object.values(state.actors).find((a) => a.rootCompanyId === company.id);
    expect(state.stock.declared[company.id]?.[founder?.id ?? '']).toBe(0.33);
    // Market orders stop the group at the mandatory offer threshold.
    const s = structuredClone(state);
    const register = s.stock.registry[company.id] ?? {};
    const move = Math.floor(0.29 * N) - (register[id] ?? 0);
    register[id] = (register[id] ?? 0) + move;
    register.public = (register.public ?? 0) - move;
    const { decisions } = normalizeDecisions(s, s.companies[id] as never, {
      ...steadyDecisions(s, id),
      stockOrders: [{ targetId: company.id, side: 'buy', shares: Math.floor(0.05 * N) }],
    });
    expect(decisions.stockOrders[0]?.shares ?? 0).toBeLessThanOrEqual(
      Math.floor(0.3 * N) - Math.floor(0.29 * N),
    );
  });
});

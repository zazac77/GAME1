import { describe, expect, it } from 'vitest';
import { getPlayerView, previewDecisions, resolveTurn, type GameState } from '../../src';
import type { DeepPartial, GameConfig } from '../../src/config/schema';
import { createTurnContext } from '../../src/core/context';
import { sum } from '../../src/core/math';
import {
  conglomerateDiscount,
  groupProfile,
  groupsByMember,
  holdingDiscount,
  sharedBrand,
  supportWages,
} from '../../src/core/synergies';
import { commoditiesSystem } from '../../src/systems/commodities';
import { conglomeratePreSystem, OVERLOAD_SOURCE } from '../../src/systems/conglomerate';
import { assertJsonSafe, newGame, playerCompanyId, playTurns, steadyDecisions } from '../helpers';

/** A listing arriving every quarter. */
const RICH: DeepPartial<GameConfig> = { mna: { listings: { arrivalProbability: 1 } } };

/** The player's root company owning 100 % of a bought listing. */
function withSubsidiary(
  overrides: DeepPartial<GameConfig> = {},
  seed = 5,
): { state: GameState; rootId: string; subId: string } {
  let state = playTurns(
    newGame(seed, { ...RICH, ...overrides, mna: { listings: { arrivalProbability: 1 } } }),
    1,
  );
  const rootId = playerCompanyId(state);
  state = structuredClone(state);
  const b = state.companies[rootId]?.books.current.balance;
  if (b) {
    b.cash += 100_000_000;
    b.equity += 100_000_000;
  }
  const listing = state.mna.listings[0];
  if (!listing) throw new Error('no listing');
  const d = steadyDecisions(state, rootId);
  d.mna = [{ kind: 'private_purchase', targetId: listing.id }];
  state = resolveTurn(state, [d]).state;
  const sub = Object.values(state.companies).find((c) => c.name === listing.name);
  if (!sub) throw new Error('not bought');
  return { state, rootId, subId: sub.id };
}

const groupTurn = (state: GameState, ids: string[], holding = false): GameState =>
  resolveTurn(
    state,
    ids.map((id, i) => ({
      ...steadyDecisions(state, id),
      ...(holding && i === 0 ? { createHolding: true } : {}),
    })),
  ).state;

describe('group profile', () => {
  it('a lone company has no group; a root company with a subsidiary has one', () => {
    const lone = newGame(5);
    expect(groupsByMember(lone)).toEqual({});
    const { state, rootId, subId } = withSubsidiary();
    const actorId = state.meta.playerActorId;
    const profile = groupProfile(state, actorId, rootId);
    if (!profile) throw new Error('no group');
    const C = state.config.conglomerate;
    expect(profile.members).toEqual([rootId, subId].sort());
    expect(profile.subsidiaries).toBe(1);
    expect(profile.supportSaving).toBeCloseTo(C.synergies.supportMaxSaving / 2, 12);
    expect(profile.holdingFee).toBeCloseTo(
      C.holdingFee.base * state.macro.priceLevel * profile.sectors.length,
      6,
    );
    // An operating head: no conglomerate discount, and 2 companies fit the capacity.
    expect(profile.discount).toBe(0);
    expect(profile.efficiency).toBe(1);
    const revenues = profile.members.map(
      (id) => state.companies[id]?.books.current.pnl.revenue ?? 0,
    );
    const brands = profile.members.map((id) => state.companies[id]?.brand ?? 0);
    expect(profile.brand).toBeCloseTo(
      sum(brands.map((b, i) => b * (revenues[i] ?? 0))) / sum(revenues),
      9,
    );
    expect(groupsByMember(state)[subId]).toEqual(profile);
  });

  it('fees grow with subsidiaries^exponent × sectors; the discount with the sectors, capped', () => {
    const { state } = withSubsidiary();
    const D = state.config.conglomerate.discount;
    expect(conglomerateDiscount(state, 1)).toBe(0);
    expect(conglomerateDiscount(state, 2)).toBeCloseTo(D.perExtraSector, 12);
    expect(conglomerateDiscount(state, 10)).toBe(D.max);
  });
});

describe('synergies', () => {
  it('support functions are shared and holding fees are charged by revenue (before the accounts)', () => {
    const { state, rootId, subId } = withSubsidiary();
    const profile = groupsByMember(state)[rootId];
    if (!profile) throw new Error('no group');
    const ctx = createTurnContext(structuredClone(state), []);
    ctx.ledger(rootId).revenue = 3_000_000;
    ctx.ledger(subId).revenue = 1_000_000;
    conglomeratePreSystem.run(ctx);
    const wantedSaving = (id: string) =>
      -profile.supportSaving * supportWages(state, state.companies[id] as never);
    expect(wantedSaving(rootId)).toBeLessThan(0);
    expect(ctx.ledger(rootId).wages).toBeCloseTo(wantedSaving(rootId), 6);
    expect(ctx.ledger(subId).wages).toBeCloseTo(wantedSaving(subId), 6);
    expect(ctx.ledger(rootId).other).toBeCloseTo(profile.holdingFee * 0.75, 6);
    expect(ctx.ledger(subId).other).toBeCloseTo(profile.holdingFee * 0.25, 6);
    // The preview shows the fee share.
    const preview = previewDecisions(state, [steadyDecisions(state, subId)]);
    expect(preview.companies[subId]?.costs.holdingFees).toBeGreaterThan(0);
  });

  it('a contract earns the volume discount of the whole group', () => {
    const { state, rootId, subId } = withSubsidiary();
    const commodityId = Object.keys(state.commodities).sort()[0] ?? '';
    const market = state.commodities[commodityId];
    if (!market) throw new Error('no commodity');
    const priceFor = (pooledShare: number): number => {
      const draft = structuredClone(state);
      draft.config.conglomerate.synergies.pooledPurchasingShare = pooledShare;
      const turn = draft.meta.turn;
      (draft.companies[rootId] as GameState['companies'][string]).contracts.push({
        id: 'ctr_test',
        commodityId,
        qtyPerQuarter: market.refDemand,
        price: 1,
        startsAt: turn - 1,
        endsAt: turn + 4,
      });
      const d = steadyDecisions(draft, subId);
      d.purchasing.newContracts = [{ commodityId, qtyPerQuarter: 1, quarters: 4 }];
      const ctx = createTurnContext(draft, [d]);
      commoditiesSystem.run(ctx);
      const signed = draft.companies[subId]?.contracts.find(
        (k) => k.commodityId === commodityId && k.startsAt === turn && k.qtyPerQuarter === 1,
      );
      if (!signed) throw new Error('no contract');
      return signed.price;
    };
    const alone = priceFor(0);
    const pooled = priceFor(1);
    const max = state.config.commodities.contractVolumeDiscountMax;
    expect(pooled).toBeLessThan(alone);
    // The root's volume alone earns the full discount.
    expect(pooled / alone).toBeCloseTo(
      (1 - max) /
        (1 -
          max *
            (1 / (market.refDemand * state.config.commodities.contractDiscountFullVolumeShare))),
      6,
    );
  });

  it('the brand customers see is partly the group brand; a scandal spreads', () => {
    const { state, rootId, subId } = withSubsidiary();
    const w = state.config.conglomerate.synergies.sharedBrandWeight;
    const sub = state.companies[subId] as GameState['companies'][string];
    const groups = groupsByMember(state);
    const profile = groups[subId];
    if (!profile) throw new Error('no group');
    expect(sharedBrand(state, sub, groups)).toBeCloseTo((1 - w) * sub.brand + w * profile.brand, 9);
    const scandal = structuredClone(state);
    (scandal.companies[rootId] as typeof sub).brand = 0;
    const after = sharedBrand(
      scandal,
      scandal.companies[subId] as typeof sub,
      groupsByMember(scandal),
    );
    expect(after).toBeLessThan(sharedBrand(state, sub, groups));
    // Outside any group, the brand is the company's own.
    const rival = Object.values(state.companies).find(
      (c) => c.id !== rootId && c.id !== subId && c.sector !== 'holding',
    );
    if (rival) expect(sharedBrand(state, rival, groups)).toBe(rival.brand);
  });
});

describe('complexity', () => {
  it('an overloaded group gets an efficiency malus each quarter, without stacking', () => {
    const tight: DeepPartial<GameConfig> = { conglomerate: { management: { capacity: 1 } } };
    const { state, rootId, subId } = withSubsidiary(tight);
    const M = state.config.conglomerate.management;
    const profile = groupsByMember(state)[rootId];
    if (!profile) throw new Error('no group');
    expect(profile.efficiency).toBeCloseTo(
      Math.max(M.minEfficiency, 1 - M.lossPerUnit * (profile.load - 1)),
      12,
    );
    expect(profile.efficiency).toBeLessThan(1);
    // The takeover quarter already set the malus of the next quarter.
    const malus = (s: GameState) => s.modifiers.filter((m) => m.sourceId === OVERLOAD_SOURCE);
    expect(malus(state)).toHaveLength(4);
    let next = groupTurn(state, [rootId, subId]);
    next = groupTurn(next, [rootId, subId]);
    const mods = malus(next);
    expect(mods).toHaveLength(4);
    for (const m of mods) {
      expect([rootId, subId]).toContain(m.target.id);
      if (m.key === 'labor.productivity') expect(m.value).toBeCloseTo(profile.efficiency, 12);
      else expect(m.value).toBeCloseTo(1 + M.attritionWeight * (1 - profile.efficiency), 12);
    }
    assertJsonSafe(next);
  });

  it('a holding company raises the capacity and carries the conglomerate discount', () => {
    const tight: DeepPartial<GameConfig> = {
      conglomerate: { management: { capacity: 1 }, discount: { perExtraSector: 0.1 } },
    };
    const { state, rootId, subId } = withSubsidiary(tight);
    const next = groupTurn(state, [rootId, subId], true);
    const actorId = next.meta.playerActorId;
    const holdingId = next.actors[actorId]?.rootCompanyId ?? '';
    const holding = next.companies[holdingId];
    if (!holding) throw new Error('no holding');
    const profile = groupProfile(next, actorId, holdingId);
    if (!profile) throw new Error('no group');
    expect(profile.subsidiaries).toBe(2);
    expect(profile.capacity).toBe(1 + next.config.conglomerate.management.holdingBonus);
    expect(profile.discount).toBeCloseTo(holdingDiscount(next, holding), 12);
    expect(profile.discount).toBeCloseTo(conglomerateDiscount(next, profile.sectors.length), 12);
    expect(holding.brand).toBeCloseTo(profile.brand, 9);
    const view = getPlayerView(next);
    expect(view.synergies?.headId).toBe(holdingId);
    expect(view.synergies?.members).toEqual(profile.members);
    expect(view.synergies?.supportSavingAmount).toBeGreaterThan(0);
    assertJsonSafe(view);
  });
});

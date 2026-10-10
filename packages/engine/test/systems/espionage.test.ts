import { describe, expect, it } from 'vitest';
import { getPlayerView, previewDecisions, resolveTurn, validateDecisions } from '../../src';
import type { CompanyDecisions, DeepPartial, GameConfig, GameState } from '../../src';
import { observe } from '../../src/ai/observation';
import { isVisible } from '../../src/views/visibility';
import { newGame, playerCompanyId, playTurns, steadyDecisions, must } from '../helpers';

const SPY = (over: DeepPartial<GameConfig['espionage']> = {}): DeepPartial<GameConfig> => ({
  espionage: { enabled: true, successProbability: 1, detectionProbability: 0, ...over },
});

/** An AI rival of the player's sector. */
const rivalOf = (state: GameState) => {
  const sector = state.config.scenario.playerSector;
  const actor = Object.values(state.actors).find(
    (a) => a.kind === 'ai' && state.companies[a.rootCompanyId]?.sector === sector,
  );
  if (!actor) throw new Error('no rival');
  return actor.rootCompanyId;
};

const spyOn = (state: GameState, targets: string[]): CompanyDecisions => ({
  ...steadyDecisions(state, playerCompanyId(state)),
  espionage: targets.map((targetId) => ({ targetId })),
});

describe('espionage: validation', () => {
  it('is not available unless the option is on', () => {
    const state = newGame(1);
    const issues = validateDecisions(state, [spyOn(state, [rivalOf(state)])]);
    expect(issues).toContainEqual(
      expect.objectContaining({ path: 'espionage', code: 'not_available' }),
    );
  });

  it('targets an operating rival outside the group, once, within the limit and the cash', () => {
    const state = newGame(1, SPY());
    const id = playerCompanyId(state);
    const rival = rivalOf(state);
    const other =
      Object.values(state.actors).find((a) => a.kind === 'ai' && a.rootCompanyId !== rival)
        ?.rootCompanyId ?? '';
    const codes = (d: CompanyDecisions) =>
      validateDecisions(state, [d]).map((i) => [i.path, i.code]);
    expect(codes(spyOn(state, [id]))).toContainEqual(['espionage[0]', 'unknown_id']);
    expect(codes(spyOn(state, ['co_999']))).toContainEqual(['espionage[0]', 'unknown_id']);
    expect(codes(spyOn(state, [rival, rival]))).toContainEqual(['espionage[1]', 'duplicate']);
    expect(codes(spyOn(state, [rival, other]))).toContainEqual(['espionage[1]', 'limit']);
    expect(codes(spyOn(state, [rival]))).toEqual([]);
    const poor = structuredClone(state);
    must(poor.companies[id]).books.current.balance.cash = 1000;
    expect(validateDecisions(poor, [spyOn(poor, [rival])]).map((i) => i.code)).toContain('budget');
  });

  it('shows its price in the preview', () => {
    const state = newGame(1, SPY());
    const id = playerCompanyId(state);
    const without = must(previewDecisions(state, [steadyDecisions(state, id)]).companies[id]);
    const withSpy = must(previewDecisions(state, [spyOn(state, [rivalOf(state)])]).companies[id]);
    expect(withSpy.espionage).toBeCloseTo(400_000 * state.macro.priceLevel, 6);
    expect(without.expectedCashEnd - withSpy.expectedCashEnd).toBeCloseTo(withSpy.espionage, 3);
  });
});

describe('espionage: operations', () => {
  it('brings back a report on the private figures, seen by the spy group only', () => {
    const state = playTurns(newGame(2, SPY()), 1);
    const id = playerCompanyId(state);
    const rival = rivalOf(state);
    const target = must(state.companies[rival]);
    const { state: after, report } = resolveTurn(state, [spyOn(state, [rival])]);
    const [intel] = after.intel[id] ?? [];
    expect(intel).toMatchObject({ turn: 1, spyId: id, targetId: rival });
    expect(intel?.cash).toBeCloseTo(target.books.current.balance.cash, 6);
    expect(intel?.statements?.quarter).toBe(0);
    expect(intel?.workforce.map((w) => w.key)).toEqual(Object.keys(target.workforce).sort());
    expect(intel?.lines.map((l) => l.lineId)).toEqual(Object.keys(target.productLines).sort());
    expect(report.events.map((e) => e.kind)).toContain('espionage_success');
    expect(getPlayerView(after).intel).toHaveLength(1);
    // The target's own observation does not carry the spy's reports.
    const owner = must(Object.values(after.actors).find((a) => a.rootCompanyId === rival));
    expect(observe(after, owner.id).intel).toEqual([]);
    // Nobody found out: no fine, no news.
    expect(after.log.some((e) => e.kind === 'espionage_detected')).toBe(false);
  });

  it('a failed operation is paid and brings nothing back', () => {
    const state = playTurns(newGame(3, SPY({ successProbability: 0 })), 1);
    const id = playerCompanyId(state);
    const { state: after, report } = resolveTurn(state, [spyOn(state, [rivalOf(state)])]);
    expect(after.intel[id]).toBeUndefined();
    expect(report.events.map((e) => e.kind)).toContain('espionage_failed');
  });

  it('a spy caught pays a fine, loses brand and earns a public grudge', () => {
    const state = playTurns(newGame(4, SPY({ detectionProbability: 1 })), 1);
    const id = playerCompanyId(state);
    const rival = rivalOf(state);
    const calm = playTurns(newGame(4, SPY({ detectionProbability: 1 })), 1);
    const ref = resolveTurn(calm, [steadyDecisions(calm, id)]).state;
    const { state: after } = resolveTurn(state, [spyOn(state, [rival])]);
    const news = after.log.find((e) => e.kind === 'espionage_detected');
    expect(news).toMatchObject({ companyId: id, data: { targetId: rival } });
    expect(isVisible(must(news), new Set([rival]))).toBe(true);
    expect(after.modifiers).toContainEqual(
      expect.objectContaining({ sourceId: 'espionage', key: 'company.brand', remaining: 2 }),
    );
    expect(must(after.companies[id]).brand).toBeLessThan(must(ref.companies[id]).brand);
    expect(after.aiMemory[rival]?.rivals[id]?.grudge).toBeGreaterThanOrEqual(0.5);
    const other =
      must(after.companies[id]).books.current.pnl.other -
      must(ref.companies[id]).books.current.pnl.other;
    expect(other).toBeGreaterThan(1_500_000);
  });

  it('keeps at most reportsKept reports per spy', () => {
    let state = newGame(5, SPY({ reportsKept: 2 }));
    const rival = rivalOf(state);
    for (let i = 0; i < 3; i++) state = resolveTurn(state, [spyOn(state, [rival])]).state;
    expect(state.intel[playerCompanyId(state)]?.map((r) => r.turn)).toEqual([1, 2]);
  });
});

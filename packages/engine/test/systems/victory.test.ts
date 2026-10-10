import { describe, expect, it } from 'vitest';
import { getPlayerView, resolveTurn } from '../../src';
import type { GameState } from '../../src';
import { createTurnContext } from '../../src/core/context';
import {
  bankruptcyEndsGame,
  groupMarketShares,
  objectiveView,
  playerScore,
  victorySystem,
} from '../../src/systems/victory';
import { newGame, playerCompanyId, playTurns, must } from '../helpers';

/** Runs the victory step alone on a copy of the state. */
const runVictory = (state: GameState) => {
  const draft = structuredClone(state);
  const ctx = createTurnContext(draft, []);
  victorySystem.run(ctx);
  return { state: draft, ctx };
};

describe('victory: capitalization', () => {
  it('wins as soon as the score reaches the target indexed on the price level', () => {
    const state = newGame(1, { victory: { capitalization: { targetValue: 1 } } });
    expect(state.meta.mode).toBe('capitalization');
    const { state: after, ctx } = runVictory(state);
    expect(after.meta.status).toBe('won');
    expect(after.victory.outcome).toEqual({ status: 'won', reason: 'objective', turn: 0 });
    expect(ctx.events.map((e) => e.kind)).toEqual(['game_won']);
    expect(() => resolveTurn(after, [])).toThrow(/won/);
  });

  it('loses at the end of the last quarter without the target', () => {
    let state = newGame(2, { time: { standardGameTurns: 2 } });
    state = playTurns(state, 1);
    expect(state.meta.status).toBe('running');
    const { state: end, report } = resolveTurn(state, []);
    expect(end.meta.status).toBe('lost');
    expect(end.victory.outcome).toEqual({ status: 'lost', reason: 'deadline', turn: 1 });
    expect(report.events.some((e) => e.kind === 'game_lost')).toBe(true);
  });

  it('shows the score, the target and the progress', () => {
    const state = newGame(3);
    const view = objectiveView(state);
    expect(view.mode).toBe('capitalization');
    expect(view.lastTurn).toBe(state.config.time.standardGameTurns - 1);
    expect(view.score).toBeCloseTo(playerScore(state), 6);
    expect(view.target).toBeCloseTo(60_000_000 * state.macro.priceLevel, 6);
    expect(view.progress).toBeCloseTo(playerScore(state) / must(view.target), 9);
    expect(getPlayerView(state).objective).toEqual(view);
  });
});

describe('victory: domination', () => {
  it('needs the share of a market for the quarters in a row', () => {
    let state = newGame(
      4,
      { victory: { domination: { share: 0.01, quarters: 2 } } },
      {
        mode: 'domination',
      },
    );
    state = playTurns(state, 1);
    const shares = groupMarketShares(state);
    const marketId = Object.keys(shares).find((id) => (shares[id] ?? 0) > 0.01) ?? '';
    expect(state.victory.dominationStreaks[marketId]).toBe(1);
    expect(state.meta.status).toBe('running');
    expect(objectiveView(state)).toMatchObject({
      bestMarketId: marketId,
      streak: 1,
      progress: 0.5,
    });
    state = playTurns(state, 1);
    expect(state.meta.status).toBe('won');
  });

  it('breaks the streak when the share falls back under the threshold', () => {
    const state = newGame(4, undefined, { mode: 'domination' });
    state.victory.dominationStreaks = { mkt_food: 3 };
    const { state: after } = runVictory(state);
    // At the start the player sells about a quarter of its market at most, nothing in the others.
    expect(after.victory.dominationStreaks).toEqual({});
  });
});

describe('victory: conglomerate', () => {
  it('counts the profitable quarters of the group by sector', () => {
    const state = newGame(
      5,
      { victory: { conglomerate: { sectors: 1, quarters: 2 } } },
      {
        mode: 'conglomerate',
      },
    );
    const id = playerCompanyId(state);
    const company = must(state.companies[id]);
    company.books.current.pnl.netIncome = 100;
    const once = runVictory(state).state;
    expect(once.victory.profitableStreaks).toEqual({ industry: 1 });
    expect(once.meta.status).toBe('running');
    const twice = runVictory(once).state;
    expect(twice.victory.profitableStreaks).toEqual({ industry: 2 });
    expect(twice.meta.status).toBe('won');
    must(once.companies[id]).books.current.pnl.netIncome = -1;
    expect(runVictory(once).state.victory.profitableStreaks).toEqual({});
  });

  it('needs every sector asked for', () => {
    const state = newGame(5, undefined, { mode: 'conglomerate' });
    must(state.companies[playerCompanyId(state)]).books.current.pnl.netIncome = 100;
    state.victory.profitableStreaks = { industry: 10 };
    const after = runVictory(state).state;
    expect(after.meta.status).toBe('running');
    expect(objectiveView(after).progress).toBeCloseTo(1 / 3, 9);
  });
});

describe('victory: survival and sandbox', () => {
  it('survival is won by lasting until the end, in a hostile world', () => {
    let state = newGame(6, { time: { standardGameTurns: 2 } }, { mode: 'survival' });
    expect(state.macro.regime).toBe('recession');
    expect(state.config.events.probabilityScale).toBe(2);
    state = playTurns(state, 2);
    expect(state.meta.status).toBe('won');
    expect(state.victory.outcome?.reason).toBe('survived');
  });

  it('the sandbox never ends on its own', () => {
    const state = newGame(7, { time: { standardGameTurns: 1 } }, { mode: 'sandbox' });
    const after = playTurns(state, 3);
    expect(after.meta.status).toBe('running');
    expect(objectiveView(after)).toMatchObject({ mode: 'sandbox', progress: 0 });
    expect(objectiveView(after).lastTurn).toBeUndefined();
  });

  it('a bankruptcy ends survival always, the sandbox only with its option', () => {
    const off = { victory: { bankruptcyEndsGame: false } };
    expect(bankruptcyEndsGame(newGame(1, off, { mode: 'survival' }))).toBe(true);
    expect(bankruptcyEndsGame(newGame(1, off, { mode: 'capitalization' }))).toBe(false);
    expect(bankruptcyEndsGame(newGame(1, undefined, { mode: 'domination' }))).toBe(true);
    expect(bankruptcyEndsGame(newGame(1, undefined, { mode: 'sandbox' }))).toBe(false);
    const option = { victory: { sandbox: { bankruptcyEndsGame: true } } };
    expect(bankruptcyEndsGame(newGame(1, option, { mode: 'sandbox' }))).toBe(true);
  });
});

describe('difficulty presets', () => {
  const cash = (s: GameState) => must(s.companies[playerCompanyId(s)]).books.current.balance.cash;

  it('play on the player start, the events and the AI', () => {
    const normal = newGame(8);
    const easy = newGame(8, undefined, { difficulty: 'easy' });
    const hard = newGame(8, undefined, { difficulty: 'hard' });
    expect(normal.meta.difficulty).toBe('normal');
    expect(hard.meta.difficulty).toBe('hard');
    expect(cash(easy) / cash(normal)).toBeCloseTo(1.5, 9);
    expect(cash(hard) / cash(normal)).toBeCloseTo(0.7, 9);
    expect(easy.config.events.probabilityScale).toBe(0.6);
    expect(hard.config.ai.profiles.low_cost?.aggressiveness).toBeGreaterThan(
      normal.config.ai.profiles.low_cost?.aggressiveness ?? 1,
    );
    expect(getPlayerView(hard).difficulty).toBe('hard');
  });

  it('multiply with the hostile scenario of survival; the caller overrides last', () => {
    const s = newGame(9, undefined, { mode: 'survival', difficulty: 'hard' });
    expect(s.config.events.probabilityScale).toBeCloseTo(3, 9);
    expect(s.config.scenario.playerStart.cashFactor).toBeCloseTo(0.56, 9);
    const own = newGame(9, { events: { probabilityScale: 0 } }, { mode: 'survival' });
    expect(own.config.events.probabilityScale).toBe(0);
  });
});

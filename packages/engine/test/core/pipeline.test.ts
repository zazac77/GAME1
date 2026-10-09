import { describe, expect, it } from 'vitest';
import { resolveTurn } from '../../src';
import { hashState } from '../../src/core/hash';
import { PIPELINE, runPipeline } from '../../src/core/pipeline';
import { createTurnContext } from '../../src/core/context';
import type { CompanyDecisions } from '../../src';
import { assertJsonSafe, newGame, playTurns } from '../helpers';

const noop = (companyId: string): CompanyDecisions => ({
  companyId,
  pricing: {},
  production: {},
  hr: [],
  purchasing: { spot: [], newContracts: [] },
  capex: [],
  marketing: {},
  rnd: [],
  finance: {},
  stockOrders: [],
  mna: [],
});

describe('pipeline', () => {
  it('follows the documented order', () => {
    expect(PIPELINE.map((s) => s.id)).toEqual([
      'ai',
      'validation',
      'macro',
      'events',
      'financePre',
      'capex',
      'labor',
      'commodities',
      'production',
      'products',
      'rnd',
      'accounting',
      'stockmarket',
      'mna',
      'conglomerate',
      'victory',
      'reporting',
    ]);
  });

  it('runs systems in order on a shared context', () => {
    const calls: string[] = [];
    const ctx = createTurnContext(structuredClone(newGame()), []);
    runPipeline(ctx, [
      { id: 'macro', run: () => calls.push('macro') },
      { id: 'labor', run: (c) => calls.push(`labor@${c.turn}`) },
    ]);
    expect(calls).toEqual(['macro', 'labor@0']);
  });

  it('exposes decisions by company and logs into the draft', () => {
    const state = newGame();
    const playerCompany = state.actors[state.meta.playerActorId]?.rootCompanyId ?? '';
    const ctx = createTurnContext(structuredClone(state), [noop(playerCompany)]);
    expect(Object.keys(ctx.decisions)).toEqual([playerCompany]);
    ctx.log({ kind: 'test', severity: 'info' });
    expect(ctx.events).toEqual([{ turn: 0, kind: 'test', severity: 'info' }]);
    expect(ctx.draft.log.at(-1)).toEqual(ctx.events[0]);
  });

  it('advances one quarter without mutating its inputs', () => {
    const state = newGame();
    const before = hashState(state);
    const decisions = [noop(state.actors[state.meta.playerActorId]?.rootCompanyId ?? '')];
    const decisionsBefore = JSON.stringify(decisions);
    const { state: next, report } = resolveTurn(state, decisions);
    expect(hashState(state)).toBe(before);
    expect(JSON.stringify(decisions)).toBe(decisionsBefore);
    expect(next).not.toBe(state);
    expect(next.meta.turn).toBe(1);
    expect(report.turn).toBe(0);
    expect(next.history.turns).toEqual([0, 1]);
    assertJsonSafe(next);
  });

  it('is deterministic: createGame then resolveTurn ×N gives the same hash', () => {
    const run = (seed: number) => hashState(playTurns(newGame(seed), 12));
    expect(run(42)).toBe(run(42));
    expect(run(42)).not.toBe(run(7));
  });

  it('refuses to resolve a finished game', () => {
    const state = newGame();
    state.meta.status = 'lost';
    expect(() => resolveTurn(state, [])).toThrow(/lost/);
  });
});

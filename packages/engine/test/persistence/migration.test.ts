import { describe, expect, it } from 'vitest';
import { deserializeGame, resolveTurn } from '../../src';
import { SCHEMA_VERSION } from '../../src/core/version';
import { assertJsonSafe, playerCompanyId, steadyDecisions } from '../helpers';
import saveV1 from '../fixtures/save-v1.json';

// A v1 save written by the lot 1.1 engine (seed 1234, after 2 quarters).
const v1 = JSON.stringify(saveV1);

describe('migrations', () => {
  it('loads a v1 save into the current schema', () => {
    expect(JSON.parse(v1).schemaVersion).toBe(1);
    const state = deserializeGame(v1);
    expect(state.meta.schemaVersion).toBe(SCHEMA_VERSION);
    expect(state.meta.turn).toBe(2);
    expect(state.macro.baseRate).toBe(state.macro.policyRate);
    for (const pool of Object.values(state.labor))
      expect(pool.wageHistory).toEqual([pool.marketWage]);
    for (const c of Object.values(state.companies)) {
      for (const line of Object.values(c.productLines))
        expect(line.qualityTarget).toBe(line.quality);
    }
    expect(state.config.events.definitions).toEqual([]); // the v1 game had no events
    expect(state.config.sectors.industry.quality.engineerOccupationId).toBe('occ_engineer');
    assertJsonSafe(state);
  });

  it('resumes a migrated game', () => {
    let state = deserializeGame(v1);
    for (let i = 0; i < 4; i++) {
      state = resolveTurn(state, [steadyDecisions(state, playerCompanyId(state))]).state;
    }
    expect(state.meta.turn).toBe(6);
    const player = state.companies[playerCompanyId(state)];
    expect(player?.books.history.length).toBe(4);
    assertJsonSafe(state);
  });
});

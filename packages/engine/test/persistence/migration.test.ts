import { describe, expect, it } from 'vitest';
import { deserializeGame, resolveTurn } from '../../src';
import { SCHEMA_VERSION } from '../../src/core/version';
import { assertJsonSafe, playerCompanyId, steadyDecisions } from '../helpers';
import saveV1 from '../fixtures/save-v1.json';
import saveV2 from '../fixtures/save-v2.json';

// A v1 save written by the lot 1.1 engine (seed 1234, after 2 quarters).
const v1 = JSON.stringify(saveV1);
// A v2 save written by the lot 1.2 engine (seed 1234, after 2 quarters).
const v2 = JSON.stringify(saveV2);

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

  it('loads a v2 save: assets in service, flows, quotes and AI memory filled in', () => {
    expect(JSON.parse(v2).schemaVersion).toBe(2);
    const state = deserializeGame(v2);
    expect(state.meta.schemaVersion).toBe(SCHEMA_VERSION);
    const cfg = state.config.sectors.industry;
    for (const c of Object.values(state.companies)) {
      for (const site of Object.values(c.sites)) {
        expect(site.buildingDepreciationPerQuarter).toBeGreaterThan(0);
        for (const line of Object.values(site.lines)) {
          expect(line.status).toBe('operational');
          expect(line.depreciationPerQuarter).toBe(
            cfg.line.buildCost / cfg.line.depreciationQuarters,
          );
        }
      }
      for (const s of c.books.history) expect(s.pnl.financial).toBe(0);
      for (const staff of Object.values(c.workforce)) expect(staff.lastQuarter.hired).toBe(0);
    }
    for (const memory of Object.values(state.aiMemory)) expect(memory.demandForecast).toBe(-1);
    for (const q of Object.values(state.stock.quotes)) expect(q.publishedQuarter).toBe(-1);
    expect(state.config.ai.priceWar.discount).toBeGreaterThan(0);
    expect(state.config.views.alerts.materialCoverQuarters).toBe(1);
    assertJsonSafe(state);
  });

  it('resumes a migrated v2 game with the AI planners and the stock market', () => {
    let state = deserializeGame(v2);
    for (let i = 0; i < 4; i++) {
      state = resolveTurn(state, [steadyDecisions(state, playerCompanyId(state))]).state;
    }
    expect(state.meta.turn).toBe(6);
    for (const actor of Object.values(state.actors).filter((a) => a.kind === 'ai')) {
      expect(state.aiMemory[actor.id]?.demandForecast).toBeGreaterThan(0);
    }
    expect(Object.values(state.stock.quotes).every((q) => q.publishedQuarter >= 0)).toBe(true);
    assertJsonSafe(state);
  });
});

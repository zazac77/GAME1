import { describe, expect, it } from 'vitest';
import { deserializeGame, getPlayerView, resolveTurn } from '../../src';
import { AI_PROFILE_IDS } from '../../src/config/schema';
import { SCHEMA_VERSION } from '../../src/core/version';
import { assertJsonSafe, playerCompanyId, steadyDecisions } from '../helpers';
import saveV1 from '../fixtures/save-v1.json';
import saveV2 from '../fixtures/save-v2.json';
import saveV3 from '../fixtures/save-v3.json';
import saveV4 from '../fixtures/save-v4.json';
import saveV5 from '../fixtures/save-v5.json';
import saveV6 from '../fixtures/save-v6.json';
import saveV7 from '../fixtures/save-v7.json';
import saveV8 from '../fixtures/save-v8.json';
import saveV9 from '../fixtures/save-v9.json';

// A v1 save written by the lot 1.1 engine (seed 1234, after 2 quarters).
const v1 = JSON.stringify(saveV1);
// A v2 save written by the lot 1.2 engine (seed 1234, after 2 quarters).
const v2 = JSON.stringify(saveV2);
// A v3 save written by the lot 1.3 engine (seed 1234, after 2 quarters).
const v3 = JSON.stringify(saveV3);
// A v4 save written by the lot 1.5 engine (seed 1234, after 2 quarters).
const v4 = JSON.stringify(saveV4);
// A v5 save written by the lot 2.1 engine (seed 1234, after 2 quarters).
const v5 = JSON.stringify(saveV5);
// A v6 save written by the lot 2.2 engine (seed 1240, after 4 quarters, one AI at price war).
const v6 = JSON.stringify(saveV6);
// A v7 save written by the lot 2.3 engine (seed 1234, after 4 quarters, the player holding
// 20 000 shares of an AI company).
const v7 = JSON.stringify(saveV7);
// A v8 save written by the lot 2.5 engine (seed 1234, after 11 quarters, the player owning
// 100 % of a bought listing).
const v8 = JSON.stringify(saveV8);
// A v9 save written by the lot 3.1 engine (the v8 save played 2 more quarters, the player
// having put a holding company on top of its group).
const v9 = JSON.stringify(saveV9);

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
      expect(state.aiMemory[actor.rootCompanyId]?.demandForecast).toBeGreaterThan(0);
    }
    expect(Object.values(state.stock.quotes).every((q) => q.publishedQuarter >= 0)).toBe(true);
    assertJsonSafe(state);
  });

  it('loads a v3 save: R&D levels and config filled in, R&D playable', () => {
    expect(JSON.parse(v3).schemaVersion).toBe(3);
    let state = deserializeGame(v3);
    expect(state.meta.schemaVersion).toBe(SCHEMA_VERSION);
    for (const c of Object.values(state.companies)) {
      expect(c.processLevel).toBe(0);
      expect(c.rnd).toEqual([]);
      for (const line of Object.values(c.productLines)) expect(line.techLevel).toBe(0);
    }
    expect(state.config.sectors.industry.rnd.maxLevel).toBeGreaterThan(0);
    expect(state.config.ai.profiles.low_cost?.rndProcessShare).toBe(0.8);
    for (let i = 0; i < 3; i++) {
      const d = steadyDecisions(state, playerCompanyId(state));
      d.rnd = [{ type: 'process', budget: 200_000 }];
      state = resolveTurn(state, [d]).state;
    }
    expect(state.companies[playerCompanyId(state)]?.rnd[0]?.spent).toBeCloseTo(600_000, 3);
    assertJsonSafe(state);
  });

  it('loads a v4 save: an industry-only game goes on without agrifood', () => {
    expect(JSON.parse(v4).schemaVersion).toBe(4);
    let state = deserializeGame(v4);
    expect(state.meta.schemaVersion).toBe(SCHEMA_VERSION);
    expect(state.config.sectors.agri).toBeUndefined();
    expect(state.config.scenario.aiCompetitors.every((c) => c.sector === 'industry')).toBe(true);
    for (const region of Object.values(state.regions)) expect(region.weather).toBe(1);
    for (const market of Object.values(state.productMarkets)) {
      for (const segment of market.segments) expect(segment.betaDistribution).toBe(0);
    }
    expect(state.config.commodities.markets.com_steel?.perishRate).toBe(0);
    for (let i = 0; i < 3; i++) {
      state = resolveTurn(state, [steadyDecisions(state, playerCompanyId(state))]).state;
    }
    expect(state.meta.turn).toBe(5);
    expect(Object.values(state.regions).every((r) => r.weather === 1)).toBe(true); // no weather
    expect(Object.values(state.companies).every((c) => c.sector === 'industry')).toBe(true);
    assertJsonSafe(state);
  });

  it('loads a v5 save: an industry and agrifood game goes on without tech', () => {
    expect(JSON.parse(v5).schemaVersion).toBe(5);
    let state = deserializeGame(v5);
    expect(state.meta.schemaVersion).toBe(SCHEMA_VERSION);
    expect(state.config.sectors.tech).toBeUndefined();
    expect(state.config.products.networkUnit).toBe(1000);
    expect(state.config.ai.tech.staffingCover).toBeGreaterThan(1);
    for (const market of Object.values(state.productMarkets)) {
      expect(market.techFrontier).toBeUndefined();
      for (const segment of market.segments) {
        expect(segment.betaNetwork).toBe(0);
        expect(segment.betaTech).toBe(0);
      }
    }
    for (let i = 0; i < 3; i++) {
      state = resolveTurn(state, [steadyDecisions(state, playerCompanyId(state))]).state;
    }
    expect(state.meta.turn).toBe(5);
    expect(Object.values(state.companies).some((c) => c.sector === 'agri')).toBe(true);
    expect(Object.values(state.companies).every((c) => c.sector !== 'tech')).toBe(true);
    assertJsonSafe(state);
  });

  it('loads a v6 save: AI memory per rival, price war state, job ads and tactics filled in', () => {
    const raw = JSON.parse(v6) as {
      schemaVersion: number;
      state: { aiMemory: Record<string, { priceWarDiscount: number; grudges: object }> };
    };
    expect(raw.schemaVersion).toBe(6);
    const [warriorId, old] = Object.entries(raw.state.aiMemory).find(
      ([, m]) => m.priceWarDiscount > 0,
    ) ?? ['', undefined];
    let state = deserializeGame(v6);
    expect(state.meta.schemaVersion).toBe(SCHEMA_VERSION);
    // The memory now follows the company the actor runs.
    const memory = state.aiMemory[state.actors[warriorId]?.rootCompanyId ?? ''];
    expect(memory?.priceWar?.discount).toBe(old?.priceWarDiscount);
    expect(memory?.priceWar?.rivalIds).toEqual(Object.keys(old?.grudges ?? {}));
    for (const m of Object.values(state.aiMemory)) {
      expect(m).not.toHaveProperty('grudges');
      expect(m).not.toHaveProperty('priceWarDiscount');
      expect(m.rivals).toBeDefined();
    }
    for (const c of Object.values(state.companies)) {
      for (const staff of Object.values(c.workforce)) {
        expect(staff.lastQuarter.offered).toBe(staff.lastQuarter.requested > 0 ? staff.wage : 0);
      }
    }
    const { ai } = state.config;
    expect(Object.keys(ai.profiles).sort()).toEqual([...AI_PROFILE_IDS].sort());
    expect(ai.profiles.low_cost?.wageOutbidMax).toBe(0.15);
    expect(ai.wageOutbid).not.toHaveProperty('max');
    expect(ai.counterLaunch.durationQuarters).toBeGreaterThan(0);
    expect(ai.opportunism.weakRatings).toContain('CCC');
    // The line-up of the old game is kept.
    const profiles = Object.values(state.actors).map((a) => a.profileId);
    expect(profiles).not.toContain('innovator');
    for (let i = 0; i < 3; i++) {
      state = resolveTurn(state, [steadyDecisions(state, playerCompanyId(state))]).state;
    }
    expect(state.meta.turn).toBe(7);
    assertJsonSafe(state);
  });

  it('loads a v7 save: memory by company, M&A market, shares in the accounts', () => {
    const raw = JSON.parse(v7) as {
      schemaVersion: number;
      state: {
        aiMemory: Record<string, unknown>;
        actors: Record<string, { rootCompanyId: string }>;
      };
    };
    expect(raw.schemaVersion).toBe(7);
    let state = deserializeGame(v7);
    expect(state.meta.schemaVersion).toBe(SCHEMA_VERSION);
    const expected = Object.keys(raw.state.aiMemory)
      .map((actorId) => raw.state.actors[actorId]?.rootCompanyId)
      .sort();
    expect(Object.keys(state.aiMemory).sort()).toEqual(expected);
    expect(state.mna).toEqual({ listings: [], diligence: [], integrations: [] });
    for (const c of Object.values(state.companies)) {
      expect(c.participations).toEqual({});
      expect(c.books.current.shares).toBe(c.sharesOutstanding);
      for (const s of c.books.history) expect(s.shares).toBe(c.sharesOutstanding);
    }
    expect(state.config.mna.controlThreshold).toBe(0.5);
    expect(state.config.ai.profiles.conglomerate?.acquisitiveness).toBeGreaterThan(0);
    expect(state.config.stockMarket.ipo.floatShare).toBeLessThan(0.5);
    // The minority stake stays at fair value; the game goes on with the new systems.
    const id = playerCompanyId(state);
    for (let i = 0; i < 3; i++) {
      state = resolveTurn(state, [steadyDecisions(state, id)]).state;
    }
    expect(state.meta.turn).toBe(7);
    expect(state.companies[id]?.books.current.balance.financialAssets).toBeGreaterThan(0);
    assertJsonSafe(state);
  });

  it('loads a v8 save: intra-group fields, booked stake values, consolidation resumes', () => {
    expect(JSON.parse(v8).schemaVersion).toBe(8);
    let state = deserializeGame(v8);
    expect(state.meta.schemaVersion).toBe(SCHEMA_VERSION);
    expect(state.config.conglomerate.groupLoanSpread).toBeGreaterThan(0);
    expect(state.config.ai.group.targetCashQuarters).toBeGreaterThan(0);
    for (const c of Object.values(state.companies)) {
      for (const s of [c.books.current, ...c.books.history]) {
        expect(s.balance.groupLoans).toBe(0);
        expect(s.pnl.groupFinancial).toBe(0);
        expect(s.cashFlow.groupInvesting).toBe(0);
      }
      const booked = Object.values(c.stakeValues).reduce((a, b) => a + b, 0);
      expect(booked).toBeCloseTo(c.books.current.balance.financialAssets, 6);
      expect(c.books.consolidated).toBeUndefined();
    }
    const id = playerCompanyId(state);
    const sub = Object.keys(state.companies[id]?.participations ?? {})[0] ?? '';
    expect(state.companies[id]?.stakeValues[sub]).toBeGreaterThan(0);
    state = resolveTurn(state, [steadyDecisions(state, id)]).state;
    const cons = state.companies[id]?.books.consolidated;
    expect(cons).toHaveLength(1);
    expect(Object.keys(cons?.[0]?.members ?? {})).toEqual([id, sub]);
    assertJsonSafe(state);
  });

  it('loads a v9 save: synergy settings, the group effects resume', () => {
    expect(JSON.parse(v9).schemaVersion).toBe(9);
    let state = deserializeGame(v9);
    expect(state.meta.schemaVersion).toBe(SCHEMA_VERSION);
    const C = state.config.conglomerate;
    expect(C.synergies.supportOccupationIds).toEqual(['occ_manager', 'occ_sales']);
    expect(C.holdingFee.base).toBeGreaterThan(0);
    expect(C.management.capacity).toBeGreaterThan(0);
    expect(C.discount.max).toBeGreaterThan(0);
    const holdingId = playerCompanyId(state);
    expect(state.companies[holdingId]?.sector).toBe('holding');
    const ids = Object.keys(state.companies).filter(
      (id) =>
        id !== holdingId && getPlayerView(state).groupCompanies.some((c) => c.companyId === id),
    );
    state = resolveTurn(
      state,
      ids.map((id) => steadyDecisions(state, id)),
    ).state;
    const view = getPlayerView(state);
    expect(view.synergies?.headId).toBe(holdingId);
    expect(view.synergies?.subsidiaries).toBe(2);
    assertJsonSafe(state);
  });
});

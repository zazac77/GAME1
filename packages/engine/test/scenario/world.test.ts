import { describe, expect, it } from 'vitest';
import { hashState } from '../../src/core/hash';
import { defaultConfig } from '../../src/config/default';
import { assertJsonSafe, newGame } from '../helpers';

describe('world generation', () => {
  const state = newGame(42);
  const companies = Object.values(state.companies);
  const actors = Object.values(state.actors);

  it('creates the world: 4 regions, 2 sectors', () => {
    expect(Object.keys(state.regions).sort()).toEqual([
      'reg_capitale',
      'reg_nord',
      'reg_ouest',
      'reg_sud',
    ]);
    // 4 regions × 9 occupations (5 in industry, 6 in agri, 2 shared)
    expect(Object.keys(state.labor)).toHaveLength(36);
    expect(Object.keys(state.commodities).sort()).toEqual([
      'com_cereals',
      'com_electronics',
      'com_energy',
      'com_fertilizer',
      'com_milk',
      'com_oilseeds',
      'com_packaging',
      'com_polymers',
      'com_steel',
    ]);
    expect(Object.keys(state.productMarkets)).toEqual(['mkt_appliances', 'mkt_food']);
    for (const region of Object.values(state.regions)) expect(region.weather).toBe(1);
    expect(state.meta).toMatchObject({ turn: 0, status: 'running', mode: 'standard', seed: 42 });
  });

  it('creates the player and 3 AI competitors with distinct profiles in each sector', () => {
    expect(actors).toHaveLength(7);
    expect(companies).toHaveLength(7);
    const player = state.actors[state.meta.playerActorId];
    expect(player).toMatchObject({ kind: 'player', name: 'Alice Martin' });
    expect(state.companies[player?.rootCompanyId ?? '']?.name).toBe('Martin SA');
    const ai = actors.filter((a) => a.kind === 'ai');
    for (const sector of ['industry', 'agri'] as const) {
      const profiles = ai
        .filter((a) => state.companies[a.rootCompanyId]?.sector === sector)
        .map((a) => a.profileId);
      expect(profiles.sort()).toEqual(['low_cost', 'opportunist', 'premium']);
    }
    expect(player && state.companies[player.rootCompanyId]?.sector).toBe('industry');
    expect(Object.keys(state.aiMemory).sort()).toEqual(ai.map((a) => a.id).sort());
    expect(new Set(companies.map((c) => c.name)).size).toBe(7);
  });

  it('spreads the headquarters of each sector over the 4 regions', () => {
    const industry = companies.filter((c) => c.sector === 'industry');
    expect(new Set(industry.map((c) => c.hqRegionId)).size).toBe(4);
    const agri = companies.filter((c) => c.sector === 'agri');
    expect(new Set(agri.map((c) => c.hqRegionId)).size).toBe(3);
    expect(
      state.companies[state.actors[state.meta.playerActorId]?.rootCompanyId ?? '']?.hqRegionId,
    ).toBe('reg_capitale');
  });

  it('gives every company a factory, staff, stock and a product line', () => {
    for (const c of companies) {
      const factories = Object.values(c.sites).filter((s) => s.kind === 'factory');
      expect(factories).toHaveLength(1);
      expect(Object.keys(factories[0]?.lines ?? {})).toHaveLength(c.sector === 'agri' ? 7 : 5);
      expect(Object.values(c.workforce).every((s) => s.regionId === c.hqRegionId)).toBe(true);
      expect(Object.keys(c.productLines)).toHaveLength(1);
      for (const lot of Object.values(c.inventory)) {
        expect(lot.qty).toBeGreaterThan(0);
        expect(lot.avgCost).toBeGreaterThan(0);
      }
      expect(c.inventory['com_energy']).toBeUndefined(); // not storable
    }
  });

  it('positions profiles on price and quality', () => {
    const lineOf = (profile: string) => {
      const actor = actors.find((a) => a.profileId === profile);
      const company = state.companies[actor?.rootCompanyId ?? ''];
      return Object.values(company?.productLines ?? {})[0];
    };
    expect(lineOf('premium')?.price).toBeGreaterThan(lineOf('low_cost')?.price ?? Infinity);
    expect(lineOf('premium')?.quality).toBeGreaterThan(lineOf('low_cost')?.quality ?? Infinity);
  });

  it('balances every opening balance sheet (assets = liabilities + equity)', () => {
    for (const c of companies) {
      const b = c.books.current.balance;
      const assets = b.cash + b.inventory + b.fixedAssets + b.financialAssets;
      expect(assets).toBeCloseTo(b.debt + b.equity + b.minorityInterests, 6);
      expect(b.equity).toBeGreaterThan(0);
      expect(b.debt).toBe(c.loans.reduce((s, l) => s + l.principal, 0));
    }
  });

  it('keeps the labor accounts consistent', () => {
    const rate = defaultConfig.labor.initialUnemploymentRate;
    for (const [key, pool] of Object.entries(state.labor)) {
      const employedBySim = companies.reduce(
        (s, c) => s + (c.workforce[key as `${string}:${string}`]?.headcount ?? 0),
        0,
      );
      const unemployed = pool.laborForce - pool.outsideEmployment - employedBySim;
      expect(unemployed).toBeGreaterThanOrEqual(0);
      expect(Math.abs(unemployed - rate * pool.laborForce)).toBeLessThanOrEqual(0.5 + 1e-9); // rounding
      if (employedBySim > 0) {
        // simulated firms hold 15 to 40 % of the occupation's jobs
        const share = employedBySim / (pool.outsideEmployment + employedBySim);
        expect(share).toBeGreaterThanOrEqual(0.15);
        expect(share).toBeLessThanOrEqual(0.4);
      }
    }
  });

  it('lists every company with a consistent registry', () => {
    for (const c of companies) {
      const holders = state.stock.registry[c.id] ?? {};
      expect(Object.values(holders).reduce((s, n) => s + n, 0)).toBe(c.sharesOutstanding);
      expect((holders.public ?? 0) / c.sharesOutstanding).toBeCloseTo(0.4, 6);
      expect(state.stock.quotes[c.id]?.price).toBeGreaterThan(0);
    }
    expect(state.stock.index.value).toBe(defaultConfig.stockMarket.indexBase);
  });

  it('sets the commodity reference demand from nominal needs', () => {
    for (const m of Object.values(state.commodities)) {
      expect(m.refDemand).toBeGreaterThan(0);
      expect(m.spotPrice).toBe(m.worldPrice);
    }
  });

  it('is plain JSON', () => {
    expect(() => assertJsonSafe(state)).not.toThrow();
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });

  it('is deterministic per seed and varies across seeds', () => {
    expect(hashState(newGame(42))).toBe(hashState(state));
    expect(hashState(newGame(43))).not.toBe(hashState(state));
  });

  it('starts identical worlds without jitter, except for names', () => {
    const a = newGame(1, { scenario: { initialJitter: 0 } });
    const b = newGame(2, { scenario: { initialJitter: 0 } });
    expect(a.commodities).toEqual(b.commodities);
    expect(a.labor).toEqual(b.labor);
  });

  it('records the initial history point', () => {
    expect(state.history.turns).toEqual([0]);
    for (const series of Object.values(state.history.series)) expect(series).toHaveLength(1);
    expect(state.log[0]).toMatchObject({ turn: 0, kind: 'game_started' });
  });

  it('validates its options', () => {
    expect(() => newGame(42, undefined, { playerName: '  ' })).toThrow();
    expect(() => newGame(-3)).toThrow(/Seed/);
  });

  it('supports up to 6 AI competitors per sector', () => {
    const big = newGame(5, {
      scenario: {
        aiCompetitors: [
          { profileId: 'low_cost', sector: 'industry' },
          { profileId: 'premium', sector: 'industry' },
          { profileId: 'opportunist', sector: 'industry' },
          { profileId: 'low_cost', sector: 'industry' },
          { profileId: 'premium', sector: 'industry' },
          { profileId: 'opportunist', sector: 'industry' },
        ],
      },
      labor: {
        occupations: Object.fromEntries(
          Object.entries(defaultConfig.labor.occupations).map(([id, o]) => [
            id,
            { ...o, baseLaborForce: o.baseLaborForce * 3 },
          ]),
        ),
      },
    });
    expect(Object.keys(big.companies)).toHaveLength(7);
  });
});

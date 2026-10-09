import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../../src/config/default';
import { deepMerge, resolveConfig } from '../../src/config/merge';
import { gameConfigSchema, parseConfig } from '../../src/config/schema';

describe('config', () => {
  it('default config is valid', () => {
    expect(gameConfigSchema.safeParse(defaultConfig).success).toBe(true);
  });

  it('applies deep overrides without touching the default', () => {
    const config = resolveConfig({ finance: { taxRate: 0.3 }, scenario: { initialJitter: 0 } });
    expect(config.finance.taxRate).toBe(0.3);
    expect(config.finance.startingCash).toBe(defaultConfig.finance.startingCash);
    expect(config.scenario.initialJitter).toBe(0);
    expect(defaultConfig.finance.taxRate).toBe(0.25);
  });

  it('replaces arrays instead of merging them', () => {
    expect(deepMerge({ a: [1, 2, 3], b: 1 }, { a: [9] })).toEqual({ a: [9], b: 1 });
  });

  it('rejects out-of-range values and unknown keys', () => {
    expect(() => resolveConfig({ finance: { taxRate: 1.5 } })).toThrow(/taxRate/);
    expect(() => resolveConfig({ finance: { taxRat: 0.2 } } as never)).toThrow(/taxRat/);
  });

  it('checks cross references', () => {
    expect(() => resolveConfig({ scenario: { playerHqRegionId: 'reg_atlantide' } })).toThrow(
      /unknown region/,
    );
    expect(() =>
      resolveConfig({ sectors: { industry: { recipe: { com_unobtainium: 1 } } } }),
    ).toThrow(/unknown commodity/);
    expect(() =>
      resolveConfig({
        scenario: {
          aiCompetitors: [
            { profileId: 'innovator', sector: 'industry' },
            { profileId: 'premium', sector: 'industry' },
            { profileId: 'premium', sector: 'industry' },
          ],
        },
      }),
    ).toThrow(/profile missing/);
  });

  it('requires segment weights to sum to 1', () => {
    const market = defaultConfig.products.markets.mkt_appliances;
    if (!market) throw new Error('missing market');
    const segments = market.segments.map((s) => ({ ...s, weight: 0.3 }));
    expect(() =>
      resolveConfig({ products: { markets: { mkt_appliances: { segments } } } }),
    ).toThrow(/sum to 1/);
  });

  it('parseConfig returns a copy', () => {
    const parsed = parseConfig(defaultConfig);
    expect(parsed).toEqual(defaultConfig);
    expect(parsed).not.toBe(defaultConfig);
  });

  it('checks the agrifood references and the sectors in play', () => {
    expect(() => resolveConfig({ sectors: { agri: { farm: { cropId: 'com_energy' } } } })).toThrow(
      /storable commodity/,
    );
    expect(() =>
      resolveConfig({ sectors: { agri: { farm: { fertilizerId: 'com_cereals' } } } }),
    ).toThrow(/non-storable/);
    expect(() =>
      resolveConfig({ sectors: { agri: { farm: { landByRegion: { reg_atlantide: 10 } } } } }),
    ).toThrow(/unknown region/);
    expect(() =>
      resolveConfig({ sectors: { agri: { productMarketId: 'mkt_appliances' } } }),
    ).toThrow(/market of another sector/);
    const seven = Array.from({ length: 7 }, () => ({
      profileId: 'premium' as const,
      sector: 'agri' as const,
    }));
    expect(() => resolveConfig({ scenario: { aiCompetitors: seven } })).toThrow(
      /more than 6 competitors/,
    );
    const plants = { industry: defaultConfig.sectors.industry, agri: defaultConfig.sectors.agri };
    expect(() => parseConfig({ ...defaultConfig, sectors: plants })).toThrow(
      /without configuration/,
    );
  });

  it('checks the tech references', () => {
    expect(() => resolveConfig({ sectors: { tech: { cloudId: 'com_steel' } } })).toThrow(
      /non-storable/,
    );
    expect(() => resolveConfig({ sectors: { tech: { productMarketId: 'mkt_food' } } })).toThrow(
      /market of another sector/,
    );
    expect(() =>
      resolveConfig({ sectors: { tech: { seniorOccupationId: 'occ_wizard' } } }),
    ).toThrow(/unknown occupation/);
    expect(() =>
      resolveConfig({ sectors: { tech: { startingCompany: { staff: { occ_developer: 400 } } } } }),
    ).toThrow(/more staff than seats/);
    expect(() => resolveConfig({ sectors: { tech: { subscription: { minChurn: 0.5 } } } })).toThrow(
      /minChurn > maxChurn/,
    );
    // The player can start in tech.
    expect(resolveConfig({ scenario: { playerSector: 'tech' } }).scenario.playerSector).toBe(
      'tech',
    );
  });
});

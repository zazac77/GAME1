import type { DeepPartial, GameConfig, GameMode } from '../schema';

/**
 * Scenario of each game mode, applied over the difficulty preset. Survival
 * is played in a hostile world: a recession from the first quarter, twice as
 * many events, a more volatile cycle, every plant-based company starting with
 * 20 M€ of debt (16 M€ otherwise) and the player with a thinner cash cushion.
 * Measured with sim-cli (lot 3.5): a passive player survives 14 games out of
 * 50, the autopilot 48.
 */
export const MODE_PRESETS: Record<GameMode, DeepPartial<GameConfig>> = {
  sandbox: {},
  capitalization: {},
  domination: {},
  survival: {
    macro: {
      initialRegime: 'recession',
      regimeTransition: { expansionToRecession: 0.12, recessionToExpansion: 0.2 },
    },
    events: { probabilityScale: 2 },
    finance: { startingDebt: 20_000_000 },
    scenario: { playerStart: { cashFactor: 0.6 } },
  },
  conglomerate: {},
};

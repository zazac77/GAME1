import type { DeepPartial, GameConfig, GameMode } from '../schema';

/**
 * Scenario of each game mode, applied over the difficulty preset. Survival
 * is played in a hostile world: a recession from the first quarter, twice as
 * many events, a thinner cash cushion and a more volatile cycle.
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
    scenario: { playerStart: { cashFactor: 0.8 } },
  },
  conglomerate: {},
};

import type { AiProfileId, DeepPartial, DifficultyId, GameConfig } from '../schema';

/** Each AI profile's aggressiveness (price-war ripostes) under a difficulty. */
const aggressiveness = (
  values: Record<AiProfileId, number>,
): DeepPartial<GameConfig['ai']['profiles']> =>
  Object.fromEntries(Object.entries(values).map(([id, a]) => [id, { aggressiveness: a }]));

/**
 * Difficulty presets, applied over the default config (normal changes
 * nothing). They play on the player's start, the frequency of the events and
 * how hard the AI fights back.
 */
export const DIFFICULTY_PRESETS: Record<DifficultyId, DeepPartial<GameConfig>> = {
  easy: {
    scenario: { playerStart: { quality: 58, cashFactor: 1.5 } },
    events: { probabilityScale: 0.6 },
    ai: {
      profiles: aggressiveness({
        low_cost: 0.5,
        premium: 0.15,
        innovator: 0.3,
        opportunist: 0.5,
        conglomerate: 0.25,
      }),
    },
  },
  normal: {},
  hard: {
    scenario: { playerStart: { quality: 45, cashFactor: 0.7 } },
    events: { probabilityScale: 1.5 },
    ai: {
      profiles: aggressiveness({
        low_cost: 0.9,
        premium: 0.45,
        innovator: 0.65,
        opportunist: 0.9,
        conglomerate: 0.55,
      }),
    },
  },
};

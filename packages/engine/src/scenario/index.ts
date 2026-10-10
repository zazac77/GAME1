import { resolveConfig } from '../config/merge';
import { presetOverrides } from '../config/presets';
import type { DeepPartial, GameConfig } from '../config/schema';
import type { GameState } from '../model/state';
import { generateWorld, type NewGameOptions } from './generate';

export type { NewGameOptions } from './generate';

/**
 * New game from the default config, the difficulty preset, the scenario of
 * the mode (config/presets), then the caller's overrides (sandbox JSON).
 */
export function createGame(opts: NewGameOptions, overrides?: DeepPartial<GameConfig>): GameState {
  const mode = opts.mode ?? 'capitalization';
  const difficulty = opts.difficulty ?? 'normal';
  return generateWorld(resolveConfig(presetOverrides(mode, difficulty, overrides)), {
    ...opts,
    mode,
    difficulty,
  });
}

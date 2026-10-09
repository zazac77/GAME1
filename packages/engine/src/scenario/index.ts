import { resolveConfig } from '../config/merge';
import type { DeepPartial, GameConfig } from '../config/schema';
import type { GameState } from '../model/state';
import { generateWorld, type NewGameOptions } from './generate';

export type { NewGameOptions } from './generate';

/** New game from the default config, optionally overridden (presets, sandbox). */
export function createGame(opts: NewGameOptions, overrides?: DeepPartial<GameConfig>): GameState {
  return generateWorld(resolveConfig(overrides), opts);
}

// Public API of @game/engine (docs/ARCHITECTURE.md §6). Nothing else is exported.
// getPlayerView, validateDecisions, previewDecisions and defaultDecisions
// arrive with lots 1.2 and 1.3.

export { createGame } from './scenario';
export type { NewGameOptions } from './scenario';
export { resolveTurn } from './core/pipeline';
export { serializeGame, deserializeGame } from './persistence/save';
export type { SaveFile } from './persistence/save';
export type { GameConfig, DeepPartial } from './config/schema';
export type * from './model';

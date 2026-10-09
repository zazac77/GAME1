// Public API of @game/engine (docs/ARCHITECTURE.md §6). Nothing else is exported.
// getPlayerView, previewDecisions and defaultDecisions arrive with lot 1.3.

export { createGame } from './scenario';
export type { NewGameOptions } from './scenario';
export { resolveTurn } from './core/pipeline';
export { validateDecisions } from './systems/validation';
export { serializeGame, deserializeGame } from './persistence/save';
export type { SaveFile } from './persistence/save';
export type { GameConfig, DeepPartial } from './config/schema';
export type * from './model';

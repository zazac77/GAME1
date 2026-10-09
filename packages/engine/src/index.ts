// Public API of @game/engine (docs/ARCHITECTURE.md §6). Nothing else is exported.

export { createGame } from './scenario';
export type { NewGameOptions } from './scenario';
export { resolveTurn } from './core/pipeline';
export { validateDecisions } from './systems/validation';
export { getPlayerView } from './views/playerView';
export { previewDecisions } from './views/preview';
export { defaultDecisions } from './views/defaults';
export { serializeGame, deserializeGame } from './persistence/save';
export type { SaveFile } from './persistence/save';
export type { GameConfig, DeepPartial } from './config/schema';
export type * from './model';

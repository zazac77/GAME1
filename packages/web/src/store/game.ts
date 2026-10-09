// Current game, draft decisions and navigation. Every rule lives in @game/engine:
// the store only calls its public API.
import {
  createGame,
  defaultDecisions,
  getPlayerView,
  previewDecisions,
  resolveTurn,
  type CompanyDecisions,
  type CompanyPreview,
  type DecisionPreview,
  type GameMode,
  type GameState,
  type PlayerView,
  type TurnReport,
} from '@game/engine';
import { create } from 'zustand';
import { indexedDbBackend, SaveStore } from '../persistence/saves';

export type ScreenId =
  'dashboard' | 'decisions' | 'markets' | 'competitors' | 'bourse' | 'report' | 'saves';

export interface NewGameInput {
  playerName: string;
  companyName: string;
  seed: number;
  mode: GameMode;
}

/** What the player planned (preview at submission), kept to compare with the report. */
export interface PlannedQuarter {
  turn: number;
  preview?: CompanyPreview;
}

export interface GameStore {
  game: GameState | null;
  view: PlayerView | null;
  /** Decisions being edited for the player's root company. */
  draft: CompanyDecisions | null;
  preview: DecisionPreview | null;
  /** Report of the last resolved quarter. */
  report: TurnReport | null;
  planned: PlannedQuarter | null;
  screen: ScreenId;
  /** Last persistence error (autosave), shown in the UI. */
  storageError: string | null;
  saves: SaveStore;

  newGame(input: NewGameInput): void;
  /** Takes over a loaded or imported game. */
  loadGame(state: GameState): void;
  quit(): void;
  navigate(screen: ScreenId): void;
  /** Edits a copy of the draft, then refreshes the preview. */
  editDraft(edit: (draft: CompanyDecisions) => void): void;
  resetDraft(): void;
  /** Resolves the quarter with the draft, autosaves and opens the report. */
  endTurn(): Promise<void>;
}

const playerCompanyId = (state: GameState): string =>
  state.actors[state.meta.playerActorId]?.rootCompanyId ?? '';

/** Everything derived from the game state (view, fresh default draft, preview). */
function derive(game: GameState) {
  const view = getPlayerView(game);
  const companyId = playerCompanyId(game);
  const draft = game.meta.status === 'running' ? defaultDecisions(game, companyId) : null;
  const preview = draft ? previewDecisions(game, [draft]) : null;
  return { game, view, draft, preview };
}

export const createGameStore = (saves: SaveStore) =>
  create<GameStore>()((set, get) => ({
    game: null,
    view: null,
    draft: null,
    preview: null,
    report: null,
    planned: null,
    screen: 'dashboard',
    storageError: null,
    saves,

    newGame(input) {
      const game = createGame({
        seed: input.seed,
        playerName: input.playerName,
        companyName: input.companyName,
        mode: input.mode,
      });
      set({ ...derive(game), report: null, planned: null, screen: 'dashboard' });
    },

    loadGame(game) {
      set({ ...derive(game), report: null, planned: null, screen: 'dashboard' });
    },

    quit() {
      set({ game: null, view: null, draft: null, preview: null, report: null, planned: null });
    },

    navigate(screen) {
      set({ screen });
    },

    editDraft(edit) {
      const { game, draft } = get();
      if (!game || !draft) return;
      const next = structuredClone(draft);
      edit(next);
      set({ draft: next, preview: previewDecisions(game, [next]) });
    },

    resetDraft() {
      const { game } = get();
      if (game) set(derive(game));
    },

    async endTurn() {
      const { game, draft, preview } = get();
      if (!game || !draft || game.meta.status !== 'running') return;
      const companyId = playerCompanyId(game);
      const planned: PlannedQuarter = { turn: game.meta.turn };
      const companyPreview = preview?.companies[companyId];
      if (companyPreview) planned.preview = companyPreview;
      const { state, report } = resolveTurn(game, [draft]);
      set({ ...derive(state), report, planned, screen: 'report' });
      try {
        await get().saves.autosave(state);
        set({ storageError: null });
      } catch (e) {
        set({ storageError: e instanceof Error ? e.message : String(e) });
      }
    },
  }));

export const useGame = createGameStore(new SaveStore(indexedDbBackend()));

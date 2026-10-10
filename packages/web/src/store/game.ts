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
  type SectorId,
  type TurnReport,
} from '@game/engine';
import { create } from 'zustand';
import { indexedDbBackend, SaveStore } from '../persistence/saves';
import { omit } from './draft';

export type ScreenId =
  | 'dashboard'
  | 'decisions'
  | 'markets'
  | 'competitors'
  | 'bourse'
  | 'deals'
  | 'group'
  | 'report'
  | 'saves';

export interface NewGameInput {
  playerName: string;
  companyName: string;
  seed: number;
  mode: GameMode;
  /** Starting sector of the player's company (default: the config's). */
  sector?: SectorId;
}

/** What the player planned (preview at submission), kept to compare with the report. */
export interface PlannedQuarter {
  turn: number;
  preview?: CompanyPreview;
}

export interface GameStore {
  game: GameState | null;
  /** View of the active company (the root company or a subsidiary the player runs). */
  view: PlayerView | null;
  /** Company the screens show and the decisions edit. */
  activeCompanyId: string;
  /**
   * Draft decisions submitted at the end of the quarter, by company: the root
   * company always, and each subsidiary the player decides for (the others
   * stay with their management in place).
   */
  drafts: Record<string, CompanyDecisions>;
  /** Draft of the active company. */
  draft: CompanyDecisions | null;
  /** Preview of every draft. */
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
  /** Shows and edits another company of the player's group. */
  selectCompany(companyId: string): void;
  /** A subsidiary is run by the player (true) or left to its management (false). */
  setManaged(companyId: string, managed: boolean): void;
  /** Edits a copy of the active draft, then refreshes the preview. */
  editDraft(edit: (draft: CompanyDecisions) => void): void;
  /** Brings the defaults back for the active company. */
  resetDraft(): void;
  /** Resolves the quarter with the drafts, autosaves and opens the report. */
  endTurn(): Promise<void>;
}

export const playerCompanyId = (state: GameState): string =>
  state.actors[state.meta.playerActorId]?.rootCompanyId ?? '';

/**
 * Everything derived from the game state: the view of the active company,
 * fresh default drafts for the root company and the managed subsidiaries
 * still in the group, and their preview.
 */
function derive(game: GameState, managed: readonly string[] = [], active?: string) {
  const rootId = playerCompanyId(game);
  const rootView = getPlayerView(game);
  const group = new Set(
    rootView.groupCompanies
      .filter((c) => c.status === 'active' || c.status === 'distressed')
      .map((c) => c.companyId),
  );
  const activeCompanyId = active && active !== rootId && group.has(active) ? active : rootId;
  const view = activeCompanyId === rootId ? rootView : getPlayerView(game, activeCompanyId);
  const drafts: Record<string, CompanyDecisions> = {};
  if (game.meta.status === 'running') {
    drafts[rootId] = defaultDecisions(game, rootId);
    for (const id of managed) {
      if (id !== rootId && group.has(id)) drafts[id] = defaultDecisions(game, id);
    }
  }
  const preview = drafts[rootId] ? previewDecisions(game, Object.values(drafts)) : null;
  return {
    game,
    view,
    activeCompanyId,
    drafts,
    draft: drafts[activeCompanyId] ?? null,
    preview,
  };
}

export const createGameStore = (saves: SaveStore) =>
  create<GameStore>()((set, get) => ({
    game: null,
    view: null,
    activeCompanyId: '',
    drafts: {},
    draft: null,
    preview: null,
    report: null,
    planned: null,
    screen: 'dashboard',
    storageError: null,
    saves,

    newGame(input) {
      const game = createGame(
        {
          seed: input.seed,
          playerName: input.playerName,
          companyName: input.companyName,
          mode: input.mode,
        },
        input.sector ? { scenario: { playerSector: input.sector } } : undefined,
      );
      set({ ...derive(game), report: null, planned: null, screen: 'dashboard' });
    },

    loadGame(game) {
      set({ ...derive(game), report: null, planned: null, screen: 'dashboard' });
    },

    quit() {
      set({
        game: null,
        view: null,
        activeCompanyId: '',
        drafts: {},
        draft: null,
        preview: null,
        report: null,
        planned: null,
      });
    },

    navigate(screen) {
      set({ screen });
    },

    selectCompany(companyId) {
      const { game, drafts, activeCompanyId } = get();
      if (!game || companyId === activeCompanyId) return;
      const managed = Object.keys(drafts);
      const next = derive(game, managed, companyId);
      // Keep the drafts being edited; only the view changes.
      set({
        view: next.view,
        activeCompanyId: next.activeCompanyId,
        draft: drafts[next.activeCompanyId] ?? null,
      });
    },

    setManaged(companyId, managed) {
      const { game, drafts, activeCompanyId } = get();
      if (!game || companyId === playerCompanyId(game) || game.meta.status !== 'running') return;
      const next = managed
        ? { ...drafts, [companyId]: drafts[companyId] ?? defaultDecisions(game, companyId) }
        : omit(drafts, companyId);
      set({
        drafts: next,
        draft: next[activeCompanyId] ?? null,
        preview: previewDecisions(game, Object.values(next)),
      });
    },

    editDraft(edit) {
      const { game, drafts, activeCompanyId } = get();
      const current = drafts[activeCompanyId];
      if (!game || !current) return;
      const draft = structuredClone(current);
      edit(draft);
      const next = { ...drafts, [activeCompanyId]: draft };
      set({ drafts: next, draft, preview: previewDecisions(game, Object.values(next)) });
    },

    resetDraft() {
      const { game, drafts, activeCompanyId } = get();
      if (!game || !drafts[activeCompanyId]) return;
      const next = { ...drafts, [activeCompanyId]: defaultDecisions(game, activeCompanyId) };
      set({
        drafts: next,
        draft: next[activeCompanyId] ?? null,
        preview: previewDecisions(game, Object.values(next)),
      });
    },

    async endTurn() {
      const { game, drafts, preview, activeCompanyId } = get();
      if (!game || game.meta.status !== 'running') return;
      const rootId = playerCompanyId(game);
      if (!drafts[rootId]) return;
      const planned: PlannedQuarter = { turn: game.meta.turn };
      const rootPreview = preview?.companies[rootId];
      if (rootPreview) planned.preview = rootPreview;
      const { state, report } = resolveTurn(game, Object.values(drafts));
      set({
        ...derive(state, Object.keys(drafts), activeCompanyId),
        report,
        planned,
        screen: 'report',
      });
      try {
        await get().saves.autosave(state);
        set({ storageError: null });
      } catch (e) {
        set({ storageError: e instanceof Error ? e.message : String(e) });
      }
    },
  }));

export const useGame = createGameStore(new SaveStore(indexedDbBackend()));

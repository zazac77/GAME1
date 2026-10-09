// Save slots in IndexedDB (idb-keyval), autosave rotation and JSON export/import.
// The engine owns the save format (serializeGame / deserializeGame + migrations).
import { deserializeGame, serializeGame, type GameState, type SaveFile } from '@game/engine';
import { createStore, del, get, keys, set, type UseStore } from 'idb-keyval';

/** Key-value backend (IndexedDB in the browser, an in-memory map in tests). */
export interface SaveBackend {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  del(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

export function indexedDbBackend(): SaveBackend {
  let store: UseStore | undefined;
  const db = () => (store ??= createStore('game1', 'saves'));
  return {
    get: (key) => get(key, db()),
    set: (key, value) => set(key, value, db()),
    del: (key) => del(key, db()),
    keys: async () => (await keys(db())).map(String),
  };
}

export function memoryBackend(): SaveBackend {
  const data = new Map<string, unknown>();
  return {
    get: async (key) => structuredClone(data.get(key)),
    set: async (key, value) => void data.set(key, structuredClone(value)),
    del: async (key) => void data.delete(key),
    keys: async () => [...data.keys()],
  };
}

/** Shown in the save lists without loading the whole state. */
export interface SaveMeta {
  key: string;
  kind: 'slot' | 'auto';
  name: string;
  companyName: string;
  turn: number;
  savedAt: string;
}

interface Stored {
  meta: SaveMeta;
  file: SaveFile;
}

/** Autosaves kept (one per quarter, most recent first). */
export const AUTOSAVE_COUNT = 3;

const SLOT_PREFIX = 'slot:';
const AUTO_PREFIX = 'auto:';

function companyNameOf(state: GameState): string {
  const actor = state.actors[state.meta.playerActorId];
  return state.companies[actor?.rootCompanyId ?? '']?.name ?? '';
}

function entry(state: GameState, key: string, kind: SaveMeta['kind'], name: string): Stored {
  const savedAt = new Date().toISOString();
  return {
    meta: { key, kind, name, companyName: companyNameOf(state), turn: state.meta.turn, savedAt },
    file: serializeGame(state, { savedAt }),
  };
}

export class SaveStore {
  constructor(private readonly backend: SaveBackend) {}

  async list(): Promise<SaveMeta[]> {
    const all: SaveMeta[] = [];
    for (const key of await this.backend.keys()) {
      if (!key.startsWith(SLOT_PREFIX) && !key.startsWith(AUTO_PREFIX)) continue;
      const stored = (await this.backend.get(key)) as Stored | undefined;
      if (stored?.meta) all.push(stored.meta);
    }
    return all.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  }

  /** Manual save in a named slot (overwrites a slot of the same name). */
  async save(state: GameState, name: string): Promise<SaveMeta> {
    const clean = name.trim() || companyNameOf(state);
    const stored = entry(state, `${SLOT_PREFIX}${clean}`, 'slot', clean);
    await this.backend.set(stored.meta.key, stored);
    return stored.meta;
  }

  /** End-of-quarter autosave; keeps the AUTOSAVE_COUNT most recent. */
  async autosave(state: GameState): Promise<void> {
    const key = `${AUTO_PREFIX}${String(state.meta.turn).padStart(4, '0')}`;
    await this.backend.set(key, entry(state, key, 'auto', `Auto · tour ${state.meta.turn}`));
    const autos = (await this.backend.keys()).filter((k) => k.startsWith(AUTO_PREFIX)).sort();
    for (const old of autos.slice(0, Math.max(0, autos.length - AUTOSAVE_COUNT))) {
      await this.backend.del(old);
    }
  }

  async load(key: string): Promise<GameState> {
    const stored = (await this.backend.get(key)) as Stored | undefined;
    if (!stored) throw new Error(`Sauvegarde introuvable : ${key}`);
    return deserializeGame(stored.file);
  }

  async remove(key: string): Promise<void> {
    await this.backend.del(key);
  }

  /** The raw save file of a slot (for export). */
  async file(key: string): Promise<SaveFile> {
    const stored = (await this.backend.get(key)) as Stored | undefined;
    if (!stored) throw new Error(`Sauvegarde introuvable : ${key}`);
    return stored.file;
  }
}

/** JSON text of a save file, as exported. */
export const exportJson = (state: GameState): string =>
  JSON.stringify(serializeGame(state, { savedAt: new Date().toISOString() }));

/** Loads an exported file (any supported schema version: migrated by the engine). */
export const importJson = (text: string): GameState => deserializeGame(text);

/** File name of an export, e.g. "durand-electromenager-t12.json". */
export function exportFileName(state: GameState): string {
  const slug = companyNameOf(state)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `${slug || 'partie'}-t${state.meta.turn}.json`;
}

import { describe, expect, it } from 'vitest';
import { memoryBackend, SaveStore, exportJson, importJson } from '../src/persistence/saves';
import { createGameStore } from '../src/store/game';

const newStore = () => createGameStore(new SaveStore(memoryBackend()));
const start = (store: ReturnType<typeof newStore>, seed = 7) =>
  store.getState().newGame({
    playerName: 'Camille Durand',
    companyName: 'Durand Électroménager',
    seed,
    mode: 'standard',
  });

describe('game store', () => {
  it('starts a game with a default draft and its preview', () => {
    const store = newStore();
    start(store);
    const { view, draft, preview } = store.getState();
    expect(view?.turn).toBe(0);
    expect(draft?.companyId).toBe(view?.companyId);
    expect(preview?.companies[view?.companyId ?? '']).toBeDefined();
    expect(view?.costs?.rnd.process.maxBudget).toBeGreaterThan(0);
  });

  it('plays a full 40-quarter standard game through the UI store, R&D included', async () => {
    const store = newStore();
    start(store, 2024);
    for (let q = 0; q < 40; q++) {
      const { view } = store.getState();
      if (view?.status !== 'running') break;
      // A player who funds R&D and otherwise keeps the default decisions.
      store.getState().editDraft((d) => {
        const quotes = view.costs?.rnd;
        d.rnd = [];
        if (quotes && quotes.process.maxBudget > 0) {
          d.rnd.push({ type: 'process', budget: Math.min(150_000, quotes.process.maxBudget) });
        }
        if (quotes && quotes.product.maxBudget > 0) {
          d.rnd.push({ type: 'product', budget: Math.min(150_000, quotes.product.maxBudget) });
        }
      });
      await store.getState().endTurn();
      const { report, screen } = store.getState();
      expect(report?.turn).toBe(q);
      expect(screen).toBe('report');
    }
    const { view, game, saves } = store.getState();
    expect(view?.status).toBe('running');
    expect(game?.meta.turn).toBe(40);
    const company = view?.self.company;
    const rndSpent = company?.books.history.reduce((s, x) => s + x.pnl.rnd, 0) ?? 0;
    expect(rndSpent).toBeGreaterThan(0);
    expect(game?.log.some((e) => e.kind === 'rnd_completed' && e.companyId === company?.id)).toBe(
      true,
    );
    // Autosaves rotate on the last three quarters.
    const autos = (await saves.list()).filter((s) => s.kind === 'auto').map((s) => s.turn);
    expect(autos.sort((a, b) => a - b)).toEqual([38, 39, 40]);
  });

  it('a draft edit refreshes the preview; reset brings the defaults back', () => {
    const store = newStore();
    start(store);
    const id = store.getState().view?.companyId ?? '';
    const before = store.getState().preview?.companies[id]?.costs.rnd ?? 0;
    store.getState().editDraft((d) => d.rnd.push({ type: 'process', budget: 100_000 }));
    expect(store.getState().preview?.companies[id]?.costs.rnd).toBe(before + 100_000);
    store.getState().resetDraft();
    expect(store.getState().draft?.rnd).toEqual([]);
  });
});

describe('saves', () => {
  it('saves to a slot, loads it back and resumes identically', async () => {
    const store = newStore();
    start(store, 99);
    await store.getState().endTurn();
    await store.getState().endTurn();
    const { game, saves } = store.getState();
    if (!game) throw new Error('no game');
    const meta = await saves.save(game, 'Ma partie');
    expect(meta).toMatchObject({ kind: 'slot', name: 'Ma partie', turn: 2 });

    const loaded = await saves.load(meta.key);
    expect(loaded).toEqual(game);
    const other = newStore();
    other.getState().loadGame(loaded);
    await other.getState().endTurn();
    await store.getState().endTurn();
    expect(other.getState().game).toEqual(store.getState().game);

    await saves.remove(meta.key);
    expect((await saves.list()).some((s) => s.key === meta.key)).toBe(false);
  });

  it('exports to JSON and imports the exported file', async () => {
    const store = newStore();
    start(store, 5);
    await store.getState().endTurn();
    const game = store.getState().game;
    if (!game) throw new Error('no game');
    const text = exportJson(game);
    expect(JSON.parse(text).schemaVersion).toBe(game.meta.schemaVersion);
    const imported = importJson(text);
    expect(imported).toEqual(game);
    expect(() => importJson('{"not":"a save"}')).toThrow();
  });
});

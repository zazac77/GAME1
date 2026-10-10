import { describe, expect, it } from 'vitest';
import { memoryBackend, SaveStore, exportJson, importJson } from '../src/persistence/saves';
import { createGame } from '@game/engine';
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

describe('starting sector and group', () => {
  it.each(['agri', 'tech'] as const)(
    'starts a %s game and plays it through the store',
    async (sector) => {
      const store = newStore();
      store.getState().newGame({
        playerName: 'Camille Durand',
        companyName: 'Durand',
        seed: 11,
        mode: 'standard',
        sector,
      });
      const { view } = store.getState();
      expect(view?.self.company.sector).toBe(sector);
      if (sector === 'tech') expect(view?.costs?.tech).toBeDefined();
      else expect(view?.costs?.farms).toBeDefined();
      for (let q = 0; q < 8; q++) await store.getState().endTurn();
      expect(store.getState().game?.meta.turn).toBe(8);
      expect(store.getState().view?.status).toBe('running');
    },
  );

  it('buys a company for sale, then runs the subsidiary or leaves it to its management', async () => {
    const store = newStore();
    // Companies for sale every quarter, and a cash-rich player (equity raised).
    const game = createGame(
      { seed: 3, playerName: 'Camille Durand', companyName: 'Durand', mode: 'standard' },
      { mna: { listings: { arrivalProbability: 1 } } },
    );
    const own = game.companies[game.actors[game.meta.playerActorId]?.rootCompanyId ?? ''];
    if (!own) throw new Error('no player company');
    own.books.current.balance.cash += 30e6;
    own.books.current.balance.equity += 30e6;
    store.getState().loadGame(game);
    // Wait for a company for sale the player can pay, then buy it.
    let target: string | undefined;
    for (let q = 0; q < 30 && !target; q++) {
      const { view } = store.getState();
      const cash = view?.self.company.books.current.balance.cash ?? 0;
      const deal = view?.deals.find(
        (d) => d.kind === 'listing' && (d.price ?? Infinity) < cash + d.debtCapacity,
      );
      if (deal) {
        target = deal.targetId;
        const debt = Math.max(0, Math.min(deal.debtCapacity, (deal.price ?? 0) - cash / 2));
        store.getState().editDraft((d) => {
          d.mna = [{ kind: 'private_purchase', targetId: deal.targetId, debt }];
        });
        expect(store.getState().draft?.mna).toHaveLength(1);
      }
      await store.getState().endTurn();
    }
    expect(target).toBeDefined();
    const { view } = store.getState();
    const sub = view?.groupCompanies.find((c) => !c.isRoot);
    expect(sub).toBeDefined();
    if (!sub) return;
    expect(sub.stake).toBe(1);

    // Left to its management: no draft; the player takes it over.
    store.getState().selectCompany(sub.companyId);
    expect(store.getState().view?.companyId).toBe(sub.companyId);
    expect(store.getState().draft).toBeNull();
    store.getState().setManaged(sub.companyId, true);
    expect(store.getState().draft?.companyId).toBe(sub.companyId);
    expect(store.getState().preview?.companies[sub.companyId]).toBeDefined();
    store.getState().editDraft((d) => {
      d.marketing = Object.fromEntries(Object.keys(d.pricing).map((id) => [id, 12_345]));
    });
    await store.getState().endTurn();
    const after = store.getState();
    // The subsidiary stays managed and shown; its decisions were the player's.
    expect(after.activeCompanyId).toBe(sub.companyId);
    expect(Object.keys(after.drafts)).toContain(sub.companyId);
    const last = after.game?.companies[sub.companyId]?.lastDecisions;
    expect(Object.values(last?.marketing ?? {})).toContain(12_345);

    store.getState().setManaged(sub.companyId, false);
    expect(store.getState().draft).toBeNull();
    store.getState().selectCompany(view?.companyId ?? '');
    expect(store.getState().draft?.companyId).toBe(view?.companyId);
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

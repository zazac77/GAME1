import { isOperating } from '../../core/companies';
import { controlledBy } from '../../core/control';
import type { TurnContext } from '../../core/context';
import { sum } from '../../core/math';
import type { System } from '../../core/system';
import type { Company } from '../../model/company';
import type { Id, Money, SectorId } from '../../model/ids';
import type { GameState } from '../../model/state';
import type { ObjectiveView, VictoryReason } from '../../model/victory';
import { shareValue } from '../stockmarket';

/** Value of the player's stake in its root company (share value × shares held directly). */
export function playerScore(state: GameState): Money {
  const actorId = state.meta.playerActorId;
  const rootId = state.actors[actorId]?.rootCompanyId ?? '';
  const root = state.companies[rootId];
  const held = state.stock.registry[rootId]?.[actorId] ?? 0;
  return root ? held * shareValue(state, root) : 0;
}

/** Capitalization target of the quarter: targetValue indexed on the price level. */
export const capitalizationTarget = (state: GameState): Money =>
  state.config.victory.capitalization.targetValue * state.macro.priceLevel;

/** Last quarter of a game with an objective (the sandbox has none). */
export const lastTurn = (state: GameState): number | undefined =>
  state.meta.mode === 'sandbox' ? undefined : state.config.time.standardGameTurns - 1;

/** Whether the bankruptcy of the player's company ends the game in this mode. */
export function bankruptcyEndsGame(state: GameState): boolean {
  const V = state.config.victory;
  if (state.meta.mode === 'sandbox') return V.sandbox.bankruptcyEndsGame;
  return state.meta.mode === 'survival' || V.bankruptcyEndsGame;
}

/** Ends the game: status, outcome and a journal entry (game_won / game_lost). */
export function endGame(
  ctx: TurnContext,
  status: 'won' | 'lost',
  reason: VictoryReason,
  companyId?: Id,
): void {
  const { draft } = ctx;
  draft.meta.status = status;
  draft.victory.outcome = { status, reason, turn: ctx.turn };
  const data: Record<string, string> = { mode: draft.meta.mode, reason };
  ctx.log({
    kind: status === 'won' ? 'game_won' : 'game_lost',
    severity: status === 'won' ? 'info' : 'critical',
    ...(companyId !== undefined ? { companyId } : {}),
    data,
  });
}

/** The operating companies of the player's group (holding companies included). */
function playerGroup(state: GameState): Company[] {
  return controlledBy(state, state.meta.playerActorId)
    .map((id) => state.companies[id])
    .filter((c): c is Company => c !== undefined && isOperating(c));
}

/** Share of each product market sold by the player's group last quarter. */
export function groupMarketShares(state: GameState): Record<Id, number> {
  const lines = new Set(playerGroup(state).flatMap((c) => Object.keys(c.productLines)));
  const out: Record<Id, number> = {};
  for (const marketId of Object.keys(state.productMarkets).sort()) {
    const shares = state.productMarkets[marketId]?.lastResult.shares ?? {};
    out[marketId] = sum(Object.entries(shares).map(([id, s]) => (lines.has(id) ? s : 0)));
  }
  return out;
}

/** Net income of the player's group in the closed quarter, by sector (holding companies left out). */
function sectorNetIncome(state: GameState): Partial<Record<SectorId, Money>> {
  const out: Partial<Record<SectorId, Money>> = {};
  for (const company of playerGroup(state)) {
    if (company.sector === 'holding') continue;
    out[company.sector] = (out[company.sector] ?? 0) + company.books.current.pnl.netIncome;
  }
  return out;
}

/** Sectors of the player's group profitable for long enough (conglomerate objective). */
const sectorsDone = (state: GameState): number =>
  Object.values(state.victory.profitableStreaks).filter(
    (n) => (n ?? 0) >= state.config.victory.conglomerate.quarters,
  ).length;

/** Whether the objective of the mode is reached (never for the sandbox and survival). */
export function objectiveReached(state: GameState): boolean {
  const V = state.config.victory;
  switch (state.meta.mode) {
    case 'capitalization':
      return playerScore(state) >= capitalizationTarget(state);
    case 'domination':
      return Object.values(state.victory.dominationStreaks).some((n) => n >= V.domination.quarters);
    case 'conglomerate':
      return sectorsDone(state) >= V.conglomerate.sectors;
    case 'sandbox':
    case 'survival':
      return false;
  }
}

/** Progress towards the objective, for the UI. */
export function objectiveView(state: GameState): ObjectiveView {
  const V = state.config.victory;
  const end = lastTurn(state);
  const view: ObjectiveView = { mode: state.meta.mode, progress: 0 };
  if (end !== undefined) view.lastTurn = end;
  if (state.victory.outcome) view.outcome = { ...state.victory.outcome };
  const played = end !== undefined ? Math.min(1, state.meta.turn / (end + 1)) : 0;
  switch (state.meta.mode) {
    case 'sandbox':
      break;
    case 'survival':
      view.progress = state.victory.outcome?.status === 'won' ? 1 : played;
      break;
    case 'capitalization': {
      view.score = playerScore(state);
      view.target = capitalizationTarget(state);
      view.progress = Math.min(1, view.score / view.target);
      break;
    }
    case 'domination': {
      const shares = groupMarketShares(state);
      const best = Object.keys(shares).sort(
        (a, b) =>
          (state.victory.dominationStreaks[b] ?? 0) - (state.victory.dominationStreaks[a] ?? 0) ||
          (shares[b] ?? 0) - (shares[a] ?? 0),
      )[0];
      view.share = V.domination.share;
      view.quarters = V.domination.quarters;
      if (best !== undefined) {
        view.bestMarketId = best;
        view.bestShare = shares[best] ?? 0;
        view.streak = state.victory.dominationStreaks[best] ?? 0;
        view.progress = Math.min(1, view.streak / V.domination.quarters);
      }
      break;
    }
    case 'conglomerate': {
      view.sectors = V.conglomerate.sectors;
      view.quarters = V.conglomerate.quarters;
      view.sectorStreaks = { ...state.victory.profitableStreaks };
      const credit = Object.values(state.victory.profitableStreaks)
        .map((n) => Math.min(1, (n ?? 0) / V.conglomerate.quarters))
        .sort((a, b) => b - a)
        .slice(0, V.conglomerate.sectors);
      view.progress = sum(credit) / V.conglomerate.sectors;
      break;
    }
  }
  return view;
}

/**
 * Step 13 (before reporting): updates the streaks of the player's group
 * (market shares of the quarter, net income by sector), then ends the game
 * when the objective of the mode is reached or its last quarter is played
 * (survival: won; the others: lost). A bankruptcy already ended it at step 10.
 */
export const victorySystem: System = {
  id: 'victory',
  run(ctx) {
    const { draft, config, turn } = ctx;
    const V = config.victory;
    const streaks: Record<Id, number> = {};
    for (const [marketId, share] of Object.entries(groupMarketShares(draft))) {
      if (share > V.domination.share) {
        streaks[marketId] = (draft.victory.dominationStreaks[marketId] ?? 0) + 1;
      }
    }
    draft.victory.dominationStreaks = streaks;
    const profitable: Partial<Record<SectorId, number>> = {};
    for (const [sector, income] of Object.entries(sectorNetIncome(draft)) as [SectorId, Money][]) {
      if (income > 0) profitable[sector] = (draft.victory.profitableStreaks[sector] ?? 0) + 1;
    }
    draft.victory.profitableStreaks = profitable;

    if (draft.meta.status !== 'running' || draft.meta.mode === 'sandbox') return;
    if (objectiveReached(draft)) endGame(ctx, 'won', 'objective');
    else if (turn >= (lastTurn(draft) ?? Infinity)) {
      if (draft.meta.mode === 'survival') endGame(ctx, 'won', 'survived');
      else endGame(ctx, 'lost', 'deadline');
    }
  },
};

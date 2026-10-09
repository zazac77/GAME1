import { observe } from '../ai/observation';
import { controlledCompanyIds } from '../core/companies';
import type { GameState, HistoryStore } from '../model/state';
import type { PlayerView } from '../model/views';
import { companyAlerts } from './alerts';
import { playerCosts } from './costs';
import { isVisible } from './visibility';

/**
 * What the UI shows: the same Observation as an AI planner gets (own company
 * in full, public facts about the others), plus the visible journal, the
 * chart series (competitors' private series removed), alerts, the score
 * and the quotes of the quarter's one-shot decisions.
 */
export function getPlayerView(state: GameState): PlayerView {
  const actorId = state.meta.playerActorId;
  const actor = state.actors[actorId];
  if (!actor) throw new Error(`Unknown player actor ${actorId}`);
  const own = controlledCompanyIds(state, actorId);
  const obs = observe(state, actorId);

  const history: HistoryStore = { turns: [...state.history.turns], series: {} };
  for (const [key, values] of Object.entries(state.history.series)) {
    const company = /^company\.([^.]+)\./.exec(key)?.[1];
    if (company === undefined || own.has(company)) history.series[key] = [...values];
  }
  const rootId = actor.rootCompanyId;
  const held = state.stock.registry[rootId]?.[actorId] ?? 0;
  const root = state.companies[rootId];
  const costs = root ? playerCosts(state, root) : undefined;
  const view: PlayerView = {
    ...obs,
    status: state.meta.status,
    mode: state.meta.mode,
    actor: structuredClone(actor),
    alerts: companyAlerts(state, rootId),
    log: structuredClone(state.log.filter((e) => isVisible(e, own))),
    history,
    score: held * (state.stock.quotes[rootId]?.price ?? 0),
  };
  if (costs) view.costs = costs;
  return view;
}

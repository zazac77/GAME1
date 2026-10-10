import { observe } from '../ai/observation';
import { controlledCompanyIds, isOperating } from '../core/companies';
import type { GameState, HistoryStore } from '../model/state';
import type { PlayerView } from '../model/views';
import { companyAlerts } from './alerts';
import { playerCosts } from './costs';
import { dealQuotes, groupLoansView, groupView } from './mna';
import { canCreateHolding } from '../systems/conglomerate';
import { shareValue } from '../systems/stockmarket';
import { synergiesView } from './synergies';
import { isVisible } from './visibility';

/**
 * What the UI shows: the same Observation as an AI planner gets (own company
 * in full, public facts about the others), plus the visible journal, the
 * chart series (the private series of companies outside the group removed),
 * alerts, the score, the quotes of the quarter's one-shot decisions, the
 * player's group (companies, intra-group loans, consolidated accounts) and
 * the deals on offer. By default it views the player's
 * root company; `companyId` views another company of the group (a
 * subsidiary to decide for).
 */
export function getPlayerView(state: GameState, companyId?: string): PlayerView {
  const actorId = state.meta.playerActorId;
  const actor = state.actors[actorId];
  if (!actor) throw new Error(`Unknown player actor ${actorId}`);
  const own = controlledCompanyIds(state, actorId);
  const viewedId = companyId ?? actor.rootCompanyId;
  if (companyId !== undefined && !own.has(companyId)) {
    throw new Error(`The player does not control ${companyId}`);
  }
  const obs = observe(state, actorId, viewedId);

  const history: HistoryStore = { turns: [...state.history.turns], series: {} };
  for (const [key, values] of Object.entries(state.history.series)) {
    const company = /^company\.([^.]+)\./.exec(key)?.[1];
    if (company === undefined || own.has(company)) history.series[key] = [...values];
  }
  const rootId = actor.rootCompanyId;
  const root = state.companies[rootId];
  const held = state.stock.registry[rootId]?.[actorId] ?? 0;
  const viewed = state.companies[viewedId];
  const costs = viewed ? playerCosts(state, viewed) : undefined;
  const view: PlayerView = {
    ...obs,
    status: state.meta.status,
    mode: state.meta.mode,
    actor: structuredClone(actor),
    alerts: companyAlerts(state, viewedId),
    log: structuredClone(state.log.filter((e) => isVisible(e, own))),
    history,
    score: root ? held * shareValue(state, root) : 0,
    groupCompanies: groupView(state, actorId),
    groupLoans: groupLoansView(state, actorId),
    canCreateHolding: state.meta.status === 'running' && canCreateHolding(state, actor),
    deals: viewed && isOperating(viewed) ? dealQuotes(state, viewed) : [],
  };
  if (costs) view.costs = costs;
  const synergies = synergiesView(state, actorId);
  if (synergies) view.synergies = synergies;
  const consolidated = root?.books.consolidated;
  if (consolidated) view.consolidated = structuredClone(consolidated);
  return view;
}

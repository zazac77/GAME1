import type { TurnContext } from '../../core/context';
import { isOperating } from '../../core/companies';
import { controlledBy } from '../../core/control';
import { newId } from '../../core/ids';
import type { Actor, Company } from '../../model/company';
import type { GameState } from '../../model/state';
import { emptyBalance, zeroStatements } from '../../scenario/generate';
import { holdingName } from '../../scenario/names';
import { shareValue } from '../stockmarket/holdings';

/** Whether the actor can put a holding company on top of its root company now. */
export function canCreateHolding(state: GameState, actor: Actor): boolean {
  const root = state.companies[actor.rootCompanyId];
  return (
    root !== undefined &&
    isOperating(root) &&
    root.sector !== 'holding' &&
    (state.stock.registry[root.id]?.[actor.id] ?? 0) > 0 &&
    controlledBy(state, actor.id).includes(root.id)
  );
}

/**
 * Creates a holding company on top of the actor's root company (end of the
 * quarter): the actor exchanges its shares of the root for as many shares of
 * the new, unlisted holding, which holds them at their value (its whole
 * equity, no cash) and becomes the actor's root company. The consolidated
 * accounts move to the new head. An AI founder's profile stays in charge of
 * the former root.
 */
export function createHolding(ctx: TurnContext, actor: Actor): Company | undefined {
  const { draft, config, turn } = ctx;
  if (!canCreateHolding(draft, actor)) return undefined;
  const root = draft.companies[actor.rootCompanyId] as Company;
  const register = draft.stock.registry[root.id] ?? {};
  const shares = register[actor.id] ?? 0;
  const value = shares * shareValue(draft, root);
  const opening = zeroStatements(
    { ...emptyBalance(), financialAssets: value, equity: value },
    shares,
    turn,
  );
  const holding: Company = {
    id: newId(draft.meta, 'co'),
    name: holdingName(root.name),
    sector: 'holding',
    hqRegionId: root.hqRegionId,
    status: 'active',
    listed: false,
    sharesOutstanding: shares,
    sites: {},
    workforce: {},
    inventory: {},
    contracts: [],
    productLines: {},
    brand: root.brand,
    employerBrand: root.employerBrand,
    cumulativeOutput: 0,
    processLevel: 0,
    rnd: [],
    loans: [],
    credit: { rating: config.finance.initialRating, covenantBreached: false, distressQuarters: 0 },
    books: {
      current: opening,
      // The quarter of its creation counts as closed (no flows, its opening balance).
      history: [opening],
      taxLossCarryforward: 0,
    },
    participations: { [root.id]: { shares, cost: value } },
    stakeValues: { [root.id]: value },
  };
  draft.companies[holding.id] = holding;
  const others = Object.entries(register).filter(([h]) => h !== actor.id);
  draft.stock.registry[root.id] = { ...Object.fromEntries(others), [holding.id]: shares };
  draft.stock.registry[holding.id] = { [actor.id]: shares };
  actor.rootCompanyId = holding.id;
  if (actor.profileId && !root.managementProfileId) root.managementProfileId = actor.profileId;
  if (root.books.consolidated) {
    holding.books.consolidated = root.books.consolidated;
    delete root.books.consolidated;
  }
  ctx.log({
    kind: 'holding_created',
    severity: 'info',
    companyId: holding.id,
    data: { companyId: root.id, shares, value },
  });
  return holding;
}

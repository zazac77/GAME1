import { controlledCompanyIds } from '../core/companies';
import { mainCompanyOf } from '../core/group';
import type { TurnContext } from '../core/context';
import { sum } from '../core/math';
import type { ValidationIssue } from '../model/decisions';
import type { Id } from '../model/ids';
import type { GameState } from '../model/state';
import type { PlayerTurnSummary, ReportedEvent } from '../model/views';
import type { TurnReport } from '../model/events';
import { sectorModule } from '../sectors';
import { agriConfigOf, plantConfigOf, sectorProductLine, techConfigOf } from '../sectors/config';
import { companyAlerts } from './alerts';
import { isVisible } from './visibility';

/** Whether an event's target touches the player's company, regions, pools, inputs or markets. */
function concerns(state: GameState, companyId: Id, target: ReportedEvent['target']): boolean {
  const company = state.companies[companyId];
  if (!company || target.kind === 'global') return target.kind === 'global';
  const id = target.id ?? '';
  switch (target.kind) {
    case 'company':
      return id === companyId;
    case 'region':
      return Object.values(company.sites).some((s) => s.regionId === id);
    case 'laborPool':
      return id in company.workforce;
    case 'commodity':
      return (
        id in (plantConfigOf(state.config, company.sector)?.recipe ?? {}) ||
        id === agriConfigOf(state.config, company.sector)?.farm.fertilizerId ||
        id === techConfigOf(state.config, company.sector)?.cloudId
      );
    case 'market':
      return Object.values(company.productLines).some((l) => l.marketId === id);
  }
}

function summarize(before: GameState, after: GameState, ctx: TurnContext, companyId: Id) {
  const start = before.companies[companyId];
  const end = after.companies[companyId];
  if (!start || !end) return undefined;
  const ledger = ctx.ledger(companyId);
  const line = sectorProductLine(after.config, end);
  const result = line ? after.productMarkets[line.marketId]?.lastResult : undefined;
  const previous = line ? before.productMarkets[line.marketId]?.lastResult : undefined;
  const demand = line ? (result?.allocated[line.id] ?? 0) : 0;
  const share = line ? (result?.shares[line.id] ?? 0) : 0;
  const flows = Object.values(end.workforce).map((s) => s.lastQuarter);
  const priceBefore = before.stock.quotes[companyId]?.price ?? 0;
  const priceAfter = after.stock.quotes[companyId]?.price ?? 0;
  const indexBefore = before.stock.index.value;
  const books = end.books.current;
  const events: ReportedEvent[] = ctx.events
    .filter((e) => e.kind === 'event')
    .map((e) => {
      const eventId = String(e.data?.eventId ?? '');
      const def = after.config.events.definitions.find((x) => x.id === eventId);
      const target: ReportedEvent['target'] = {
        kind: (e.data?.targetKind ?? 'global') as ReportedEvent['target']['kind'],
      };
      if (e.data?.targetId !== undefined) target.id = String(e.data.targetId);
      return {
        eventId,
        target,
        effects: def ? def.effects.map((x) => ({ ...x })) : [],
        durationQuarters: def?.durationQuarters ?? 0,
        concernsPlayer: concerns(after, companyId, target),
      };
    });
  const summary: PlayerTurnSummary = {
    companyId,
    quarter: ctx.turn,
    revenue: books.pnl.revenue,
    ebitda: books.pnl.ebitda,
    netIncome: books.pnl.netIncome,
    cashStart: start.books.current.balance.cash,
    cashEnd: books.balance.cash,
    plannedOutput:
      sectorModule(start.sector)?.plannedOutput(before, start, ctx.decisions[companyId]) ?? 0,
    unitsProduced: ledger.unitsProduced,
    demand,
    unitsSold: ledger.unitsSold,
    lostSales: Math.max(0, demand - ledger.unitsSold),
    marketShare: share,
    marketShareChange: share - (line ? (previous?.shares[line.id] ?? 0) : 0),
    hiresRequested: sum(flows.map((f) => f.requested)),
    hired: sum(flows.map((f) => f.hired)),
    quits: sum(flows.map((f) => f.quits)),
    dismissed: sum(flows.map((f) => f.dismissed)),
    sharePrice: priceAfter,
    sharePriceChange: priceBefore > 0 ? priceAfter / priceBefore - 1 : 0,
    indexChange: indexBefore > 0 ? after.stock.index.value / indexBefore - 1 : 0,
    events,
  };
  return summary;
}

/**
 * Turn report for the player: visible journal entries, the changes made to
 * their decisions, planned versus actual on their company and the alerts
 * for the next quarter.
 */
export function buildTurnReport(
  before: GameState,
  after: GameState,
  ctx: TurnContext,
  preIssues: readonly ValidationIssue[],
): TurnReport {
  const actor = after.actors[after.meta.playerActorId];
  const own = controlledCompanyIds(before, after.meta.playerActorId);
  // Under a holding, the group's main operating company.
  const main = actor ? mainCompanyOf(after, actor.id) : undefined;
  const report: TurnReport = {
    turn: ctx.turn,
    events: ctx.events.filter((e) => isVisible(e, own)),
    issues: [...preIssues, ...ctx.issues.filter((i) => own.has(i.companyId))],
    alerts: main ? companyAlerts(after, main) : [],
  };
  const summary = main ? summarize(before, after, ctx, main) : undefined;
  if (summary) report.summary = summary;
  return report;
}

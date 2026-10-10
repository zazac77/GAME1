import type { AiMemory, Observation } from '../../model/ai';
import type { CompanyDecisions } from '../../model/decisions';

/**
 * The activist fund (from its Observation, through the same validation):
 * sells a position once its price is within exitUndervaluation of the
 * fundamental value, or after holdQuarters; buys into the listed companies
 * trading at least minUndervaluation below their fundamental value (the
 * most undervalued first, at most maxPositions), up to maxStake of their
 * capital, with at most positionShareOfCash of its cash per position and
 * per quarter. Its campaigns follow its stakes (systems/mna/disclosure.ts).
 */
export function activistFund(
  obs: Observation,
  memory: AiMemory,
  decisions: CompanyDecisions,
): void {
  const A = obs.config.stockMarket.activist;
  const holdings = obs.stock.holdings;
  memory.positions = Object.fromEntries(
    Object.entries(memory.positions ?? {}).filter(([id]) => (obs.stock.holdings[id] ?? 0) > 0),
  );
  const positions = memory.positions;
  const undervaluation = (id: string): number | undefined => {
    const quote = obs.stock.quotes[id];
    const rival = obs.competitors.find((c) => c.companyId === id);
    if (!quote || !rival?.listed || quote.fundamental <= 0) return undefined;
    if (rival.status !== 'active' && rival.status !== 'distressed') return undefined;
    return 1 - quote.referencePrice / quote.fundamental;
  };

  const kept: string[] = [];
  for (const id of Object.keys(holdings).sort()) {
    const shares = holdings[id] ?? 0;
    const u = undervaluation(id);
    if (shares <= 0 || u === undefined) continue;
    const since = (positions[id] ??= obs.turn);
    if (u <= A.exitUndervaluation || obs.turn - since >= A.holdQuarters) {
      decisions.stockOrders.push({ targetId: id, side: 'sell', shares });
    } else kept.push(id);
  }

  let cash = obs.self.company.books.current.balance.cash;
  const targets = obs.competitors
    .map((c) => ({ id: c.companyId, shares: c.shares, u: undervaluation(c.companyId) }))
    .filter(
      (t): t is { id: string; shares: number; u: number } =>
        t.u !== undefined && t.u >= A.minUndervaluation,
    )
    .sort((a, b) => b.u - a.u || a.id.localeCompare(b.id));
  for (const t of targets) {
    const held = holdings[t.id] ?? 0;
    if (held <= 0 && kept.length >= A.maxPositions) continue;
    const room = Math.floor(A.maxStake * t.shares) - held;
    const price = obs.stock.quotes[t.id]?.referencePrice ?? 0;
    const budget = Math.min(
      cash,
      A.positionShareOfCash * obs.self.company.books.current.balance.cash,
    );
    const shares = Math.min(room, price > 0 ? Math.floor(budget / price) : 0);
    if (shares <= 0) continue;
    decisions.stockOrders.push({ targetId: t.id, side: 'buy', shares });
    cash -= shares * price;
    if (held <= 0) {
      kept.push(t.id);
      positions[t.id] = obs.turn;
    }
  }
}

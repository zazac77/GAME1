import type { RawState } from './index';

type Obj = Record<string, unknown>;
const obj = (x: unknown): Obj => (typeof x === 'object' && x !== null ? (x as Obj) : {});
const num = (x: unknown): number => (typeof x === 'number' && Number.isFinite(x) ? x : 0);

/**
 * Carrying value of each holding of a company (Σ = its financial assets):
 * stakes in its group at their cost (within the total), the rest spread over
 * the other holdings by their market value (last price × shares).
 */
function stakeValues(
  state: Obj,
  companyId: string,
  financialAssets: number,
): Record<string, number> {
  const registry = obj(obj(state.stock).registry);
  const quotes = obj(obj(state.stock).quotes);
  const participations = obj(obj(obj(state.companies)[companyId]).participations);
  const held: [string, number][] = Object.keys(registry)
    .sort()
    .map((targetId): [string, number] => [targetId, num(obj(registry[targetId])[companyId])])
    .filter(([, shares]) => shares > 0);
  const values: Record<string, number> = {};
  let left = financialAssets;
  for (const [targetId] of held) {
    const cost = num(obj(participations[targetId]).cost);
    if (targetId in participations) {
      values[targetId] = Math.min(cost, left);
      left -= values[targetId];
    }
  }
  const others = held.filter(([targetId]) => !(targetId in participations));
  const weights = others.map(([targetId, shares]) => shares * num(obj(quotes[targetId]).price));
  const total = weights.reduce((s, w) => s + w, 0);
  others.forEach(([targetId], i) => {
    values[targetId] = total > 0 ? (left * (weights[i] ?? 0)) / total : left / others.length;
  });
  if (others.length === 0 && held.length > 0 && Math.abs(left) > 0) {
    const first = held[0]?.[0] ?? '';
    values[first] = (values[first] ?? 0) + left;
  }
  return Object.fromEntries(Object.entries(values).filter(([, v]) => v !== 0));
}

/**
 * v8 → v9 (lot 3.1: holding and consolidation). State: the intra-group
 * fields of every statement (loans granted, intra-group financial result
 * and investing flows, all 0: there were none), the booked value of each
 * holding (Σ = financial assets). Config: the conglomerate section and the
 * intra-group financing of the AI. Consolidated accounts start with the
 * next quarter.
 */
export function migrateV8ToV9(state: RawState): RawState {
  const companies = obj(state.companies);
  for (const [id, raw] of Object.entries(companies)) {
    const company = obj(raw);
    const books = obj(company.books);
    for (const s of [books.current, ...(Array.isArray(books.history) ? books.history : [])]) {
      const st = obj(s);
      obj(st.balance).groupLoans ??= 0;
      obj(st.pnl).groupFinancial ??= 0;
      obj(st.cashFlow).groupInvesting ??= 0;
    }
    company.stakeValues ??= stakeValues(
      state,
      id,
      num(obj(obj(books.current).balance).financialAssets),
    );
  }
  const config = obj(state.config);
  config.conglomerate ??= { groupLoanSpread: 0.015 };
  const ai = obj(config.ai);
  ai.group ??= {
    rescueCashQuarters: 0.25,
    targetCashQuarters: 0.75,
    keepCashQuarters: 1,
    repayAboveQuarters: 1.5,
  };
  return state;
}

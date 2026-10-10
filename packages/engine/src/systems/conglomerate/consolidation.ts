import { isOperating } from '../../core/companies';
import { controlledBy } from '../../core/control';
import { effectiveShares } from '../../core/group';
import type { Company } from '../../model/company';
import type { ConsolidatedStatements, MemberContribution, Statements } from '../../model/finance';
import type { Id, Quarter } from '../../model/ids';
import type { GameState } from '../../model/state';

/** Operating companies consolidated by a head: itself, then those it controls, by id. */
export function consolidationScope(state: GameState, headId: Id): Id[] {
  const head = state.companies[headId];
  if (!head || !isOperating(head)) return [];
  const members = controlledBy(state, headId).filter((id) => {
    const c = state.companies[id];
    return c !== undefined && isOperating(c);
  });
  return [headId, ...members.filter((id) => id !== headId)];
}

/**
 * Consolidated accounts of the group headed by `headId`, from the members'
 * statements of the quarter (full consolidation of every operating company
 * it controls, for the whole quarter). Sums of the members' accounts, less:
 * the loans between members (groupLoans and debt), the stakes members hold
 * in members (financial assets and equity: goodwill is written off against
 * equity), the intra-group financial result (dividends, impairments, results
 * on shares, write-offs) and the intra-group cash flows (moved from investing
 * to financing, where their counterpart sits). The equity is split between
 * the group and the minority shareholders by the share of each member the
 * head's shareholders own through the chains of control: equity(group) =
 * Σ share × (equity − stakes in members). Undefined without any member closed
 * this quarter.
 */
export function consolidate(
  state: GameState,
  headId: Id,
  quarter: Quarter,
): ConsolidatedStatements | undefined {
  const ids = consolidationScope(state, headId);
  const head = state.companies[headId];
  if (!head || ids.length === 0) return undefined;
  const inScope = new Set(ids);
  const shares = effectiveShares(state, headId, ids);
  const statements = (id: Id): Statements => (state.companies[id] as Company).books.current;

  const out: ConsolidatedStatements = {
    quarter,
    shares: head.sharesOutstanding,
    pnl: {
      revenue: 0,
      cogs: 0,
      wages: 0,
      marketing: 0,
      rnd: 0,
      storage: 0,
      other: 0,
      ebitda: 0,
      depreciation: 0,
      ebit: 0,
      interest: 0,
      financial: 0,
      groupFinancial: 0,
      tax: 0,
      netIncome: 0,
    },
    cashFlow: { operating: 0, investing: 0, financing: 0, netChange: 0, groupInvesting: 0 },
    balance: {
      cash: 0,
      inventory: 0,
      fixedAssets: 0,
      financialAssets: 0,
      groupLoans: 0,
      debt: 0,
      equity: 0,
      minorityInterests: 0,
    },
    members: {},
    minorityNetIncome: 0,
    eliminations: { loans: 0, stakes: 0, financial: 0, flows: 0 },
  };
  const { pnl, cashFlow, balance, eliminations } = out;
  let totalEquity = 0;
  let groupEquity = 0;
  let groupIncome = 0;
  for (const id of ids) {
    const company = state.companies[id] as Company;
    const s = statements(id);
    const share = shares[id] ?? 0;
    for (const key of Object.keys(pnl) as (keyof typeof pnl)[]) pnl[key] += s.pnl[key];
    cashFlow.operating += s.cashFlow.operating;
    cashFlow.investing += s.cashFlow.investing;
    cashFlow.financing += s.cashFlow.financing;
    cashFlow.netChange += s.cashFlow.netChange;
    balance.cash += s.balance.cash;
    balance.inventory += s.balance.inventory;
    balance.fixedAssets += s.balance.fixedAssets;
    balance.financialAssets += s.balance.financialAssets;
    balance.groupLoans += s.balance.groupLoans;
    balance.debt += s.balance.debt;
    // Stakes in other members: eliminated against their equity.
    let stakes = 0;
    for (const [targetId, value] of Object.entries(company.stakeValues)) {
      if (inScope.has(targetId)) stakes += value;
    }
    eliminations.stakes += stakes;
    const netAssets = s.balance.equity - stakes;
    totalEquity += netAssets;
    groupEquity += share * netAssets;
    // Intra-group loans between members (owed by this member).
    for (const loan of company.loans) {
      if (loan.kind === 'group' && inScope.has(loan.lenderId ?? '')) {
        eliminations.loans += loan.principal;
      }
    }
    const income = s.pnl.netIncome - s.pnl.groupFinancial;
    groupIncome += share * income;
    eliminations.financial += s.pnl.groupFinancial;
    eliminations.flows += s.cashFlow.groupInvesting;
    const member: MemberContribution = {
      share,
      revenue: s.pnl.revenue,
      ebitda: s.pnl.ebitda,
      netIncome: income,
    };
    out.members[id] = member;
  }
  pnl.financial -= eliminations.financial;
  pnl.netIncome -= eliminations.financial;
  pnl.groupFinancial = 0;
  cashFlow.investing -= eliminations.flows;
  cashFlow.financing = cashFlow.netChange - cashFlow.operating - cashFlow.investing;
  balance.financialAssets -= eliminations.stakes;
  balance.groupLoans -= eliminations.loans;
  balance.debt -= eliminations.loans;
  balance.equity = groupEquity;
  balance.minorityInterests = totalEquity - groupEquity;
  out.minorityNetIncome = pnl.netIncome - groupIncome;
  return out;
}

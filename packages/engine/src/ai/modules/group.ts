import type { Observation } from '../../model/ai';
import type { CompanyDecisions, IntraGroupTransfer } from '../../model/decisions';

/**
 * Intra-group financing (before everything else, on the start-of-quarter
 * figures; settled at the end of the quarter on the cash then available):
 * a company repays its group debt with the cash above repayAboveQuarters of
 * its cash costs (off the overdraft); a group head lends to each subsidiary
 * on the overdraft or below rescueCashQuarters of cash enough to reach
 * targetCashQuarters (and clear the overdraft), from its cash above
 * keepCashQuarters of its own.
 */
export function groupFinance(obs: Observation, decisions: CompanyDecisions): void {
  const G = obs.config.ai.group;
  const selfId = obs.companyId;
  const me = obs.group.members[selfId];
  if (!me) return;
  const transfers: IntraGroupTransfer[] = [];
  let cash = me.cash;
  if (me.overdraft <= 0) {
    let excess = cash - G.repayAboveQuarters * me.quarterlyCashCosts;
    for (const lenderId of Object.keys(me.owes).sort()) {
      const amount = Math.min(excess, me.owes[lenderId] ?? 0);
      if (amount <= 0) break;
      transfers.push({ kind: 'loan', fromId: selfId, toId: lenderId, amount });
      excess -= amount;
      cash -= amount;
    }
  }
  if (obs.group.isHead) {
    let available = cash - G.keepCashQuarters * me.quarterlyCashCosts;
    for (const id of Object.keys(obs.group.members).sort()) {
      const m = obs.group.members[id];
      if (id === selfId || !m || (m.status !== 'active' && m.status !== 'distressed')) continue;
      if (m.overdraft <= 0 && m.cash >= G.rescueCashQuarters * m.quarterlyCashCosts) continue;
      const need = G.targetCashQuarters * m.quarterlyCashCosts + m.overdraft - m.cash;
      const amount = Math.min(need, available);
      if (amount <= 0) continue;
      transfers.push({ kind: 'loan', fromId: selfId, toId: id, amount });
      available -= amount;
    }
  }
  if (transfers.length > 0) decisions.intraGroup = transfers;
}

import type { CompanyDecisions } from '../model/decisions';
import type { Id } from '../model/ids';

/** Decisions that change nothing: keep prices, produce at full capacity, buy nothing. */
export const emptyDecisions = (companyId: Id): CompanyDecisions => ({
  companyId,
  pricing: {},
  production: {},
  hr: [],
  purchasing: { spot: [], newContracts: [] },
  capex: [],
  marketing: {},
  listing: {},
  rnd: [],
  finance: {},
  stockOrders: [],
  mna: [],
});

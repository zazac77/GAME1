import { agriConfigOf } from '../../sectors/config';
import type { Plan } from './plan';

/**
 * 4b. Retail listing (agri): the fees that bring the shelf presence back to
 * ai.listing.targetDistribution next quarter, from the inverse of
 * d' = d·(1 − δ) + (1 − d·(1 − δ))·(1 − exp(−fees / unit)), within
 * maxShareOfRevenue of the expected revenue.
 */
export function listing(plan: Plan): void {
  const { obs, config, company, line } = plan;
  const L = agriConfigOf(config, company.sector)?.listing;
  if (!L || line.distribution === undefined) return;
  const A = config.ai.listing;
  const kept = line.distribution * (1 - L.decay);
  const gain = kept >= 1 ? 0 : Math.max(0, (A.targetDistribution - kept) / (1 - kept));
  const unit = L.feeUnit * obs.macro.priceLevel;
  const wanted = gain >= 1 ? Infinity : -unit * Math.log(1 - gain);
  const fees = Math.min(wanted, A.maxShareOfRevenue * plan.forecast * line.price);
  if (!(fees > 0)) return;
  plan.decisions.listing[line.id] = fees;
  plan.listingFees = fees;
  plan.spend.discretionary += fees;
}

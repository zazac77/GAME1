import { indexedRefPrice, operatingCompanies } from '../../core/companies';
import { clamp, sum } from '../../core/math';
import { applyModifiers } from '../../core/modifiers';
import type { System } from '../../core/system';
import type { Company, ProductLine } from '../../model/company';
import type { Id } from '../../model/ids';
import type { GameState } from '../../model/state';
import { agriConfigOf, plantConfigOf } from '../../sectors/config';
import { marketShares } from './logit';

/**
 * Shelf presence after this quarter's listing fees:
 * d·(1 − decay) + (1 − d·(1 − decay))·(1 − exp(−fees / (feeUnit × price level))).
 */
export function nextDistribution(
  state: GameState,
  company: Company,
  current: number,
  fees: number,
): number {
  const L = agriConfigOf(state.config, company.sector)?.listing;
  if (!L) return current;
  const kept = current * (1 - L.decay);
  const gain = 1 - Math.exp(-Math.max(0, fees) / (L.feeUnit * state.macro.priceLevel));
  return clamp(kept + (1 - kept) * gain, 0, 1);
}

interface Seller {
  company: Company;
  line: ProductLine;
  marketing: number;
  share: number;
  allocated: number;
  sold: number;
}

/**
 * Step 8: listing fees → shelf presence; total demand → logit shares by
 * segment → sales limited by stock → reallocation of unserved demand (with a
 * loss) → revenue, cost of goods sold, logistics, marketing → brand. Reads
 * market.demand.
 */
export const productsSystem: System = {
  id: 'products',
  run(ctx) {
    const { draft, config, turn } = ctx;
    const P = config.products;
    const companies = operatingCompanies(draft);

    // Prices and marketing of the quarter.
    const marketingByCompany: Record<Id, number> = {};
    for (const company of companies) {
      const d = ctx.decisions[company.id];
      for (const [lineId, p] of Object.entries(d?.pricing ?? {})) {
        const line = company.productLines[lineId];
        if (line) line.price = p.price;
      }
      const spend = sum(Object.values(d?.marketing ?? {}));
      marketingByCompany[company.id] = spend;
      ctx.ledger(company.id).marketing += spend;
      // Retail listing: fees are a commercial expense, booked with marketing.
      for (const lineId of Object.keys(company.productLines).sort()) {
        const line = company.productLines[lineId] as ProductLine;
        if (line.distribution === undefined) continue;
        const fees = d?.listing[lineId] ?? 0;
        line.distribution = nextDistribution(draft, company, line.distribution, fees);
        ctx.ledger(company.id).marketing += fees;
      }
    }

    const qualitySum: Record<Id, { sum: number; n: number }> = {};
    for (const marketId of Object.keys(draft.productMarkets).sort()) {
      const market = draft.productMarkets[marketId];
      const marketCfg = P.markets[marketId];
      if (!market || !marketCfg) continue;
      const ref = indexedRefPrice(draft, marketId);
      const sellers: Seller[] = [];
      for (const company of companies) {
        for (const lineId of Object.keys(company.productLines).sort()) {
          const line = company.productLines[lineId] as ProductLine;
          if (line.marketId !== marketId) continue;
          sellers.push({
            company,
            line,
            marketing: ctx.decisions[company.id]?.marketing[lineId] ?? 0,
            share: 0,
            allocated: 0,
            sold: 0,
          });
        }
      }
      const shares = marketShares(
        market.segments,
        sellers.map((s) => ({
          price: s.line.price,
          quality: s.line.quality,
          brand: s.company.brand,
          marketing: s.marketing,
          distribution: s.line.distribution ?? 0,
        })),
        ref,
        P.marketingUnit,
      );
      sellers.forEach((s, i) => (s.share = shares[i] ?? 0));
      const inside = sum(shares);
      const avgOfferPrice =
        inside > 0 ? sum(sellers.map((s) => s.share * s.line.price)) / inside : ref;

      // Q = base · season · cycle · (avg price / ref)^(−ε) · modifiers
      const demand =
        market.baseVolume *
        (marketCfg.seasonality[turn % 4] ?? 1) *
        draft.macro.demandIndex *
        (avgOfferPrice / ref) ** -marketCfg.priceElasticity *
        Math.max(
          0,
          applyModifiers(draft.modifiers, 'market.demand', 1, [{ kind: 'market', id: marketId }]),
        );

      const stock = (s: Seller) => s.company.inventory[s.line.id]?.qty ?? 0;
      let unserved = 0;
      for (const s of sellers) {
        s.allocated = demand * s.share;
        s.sold = Math.min(s.allocated, stock(s));
        unserved += s.allocated - s.sold;
      }
      // Unserved customers turn to sellers with stock left, some give up.
      unserved *= 1 - P.spilloverRate;
      for (let round = 0; round < P.spilloverRounds && unserved > 1e-9; round++) {
        const withStock = sellers.filter((s) => stock(s) - s.sold > 1e-9);
        const weight = sum(withStock.map((s) => s.share));
        if (weight <= 0) break;
        let next = 0;
        for (const s of withStock) {
          const extra = (unserved * s.share) / weight;
          const take = Math.min(extra, stock(s) - s.sold);
          s.sold += take;
          next += extra - take;
        }
        unserved = next;
      }

      let volume = 0;
      let revenue = 0;
      for (const s of sellers) {
        const lot = s.company.inventory[s.line.id];
        const ledger = ctx.ledger(s.company.id);
        if (lot && s.sold > 0) {
          lot.qty = lot.qty - s.sold < 1e-9 ? 0 : lot.qty - s.sold;
          ledger.cogs += s.sold * lot.avgCost;
        }
        ledger.revenue += s.sold * s.line.price;
        ledger.unitsSold += s.sold;
        const logistics = draft.regions[s.company.hqRegionId]?.logisticsCostIndex ?? 1;
        ledger.other +=
          s.sold *
          (plantConfigOf(config, s.company.sector)?.logisticsCostPerUnit ?? 0) *
          logistics *
          draft.macro.priceLevel;
        volume += s.sold;
        revenue += s.sold * s.line.price;
        const q = (qualitySum[marketId] ??= { sum: 0, n: 0 });
        q.sum += s.line.quality;
        q.n += 1;
      }
      market.lastResult = {
        shares: Object.fromEntries(
          sellers.map((s) => [s.line.id, volume > 0 ? s.sold / volume : 0]),
        ),
        demand: sum(sellers.map((s) => s.allocated)),
        allocated: Object.fromEntries(sellers.map((s) => [s.line.id, s.allocated])),
        volume,
        avgPrice: volume > 0 ? revenue / volume : ref,
      };
    }

    // brand_{t+1} = brand·(1 − δ) + a·ln(1 + marketing/unit) + b·(quality − market average)
    const B = P.brand;
    for (const company of companies) {
      const lines = Object.values(company.productLines);
      const qualityGap =
        lines.length > 0
          ? sum(
              lines.map((l) => {
                const q = qualitySum[l.marketId];
                return q && q.n > 0 ? l.quality - q.sum / q.n : 0;
              }),
            ) / lines.length
          : 0;
      company.brand = clamp(
        company.brand * (1 - B.decay) +
          B.marketingWeight *
            Math.log(1 + (marketingByCompany[company.id] ?? 0) / P.marketingUnit) +
          B.qualityWeight * qualityGap,
        0,
        100,
      );
    }
  },
};

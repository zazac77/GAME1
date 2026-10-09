import { operatingCompanies } from '../../core/companies';
import type { System } from '../../core/system';
import { plantConfigOf } from '../../sectors/config';

/**
 * Step 8b (after the sales): perishable goods left in stock at the end of the
 * quarter lose a share of their units, materials (commodities.perishRate) and
 * finished goods (finishedGoodsPerishRate of the sector) alike. The book
 * value lost is charged to the cost of goods sold.
 */
export const perishabilitySystem: System = {
  id: 'perishability',
  run(ctx) {
    const { config } = ctx;
    for (const company of operatingCompanies(ctx.draft)) {
      const finishedRate = plantConfigOf(config, company.sector)?.finishedGoodsPerishRate ?? 0;
      const ledger = ctx.ledger(company.id);
      for (const itemId of Object.keys(company.inventory).sort()) {
        const lot = company.inventory[itemId];
        if (!lot || lot.qty <= 0) continue;
        const commodity = config.commodities.markets[itemId];
        const rate = commodity
          ? commodity.perishRate
          : company.productLines[itemId]
            ? finishedRate
            : 0;
        if (rate <= 0) continue;
        const lost = lot.qty * rate;
        lot.qty -= lost;
        ledger.cogs += lost * lot.avgCost;
        if (!commodity) ledger.unitsSpoiled += lost;
      }
    }
  },
};

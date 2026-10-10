import type { TurnContext } from '../../core/context';
import { operatingCompanies } from '../../core/companies';
import { newId } from '../../core/ids';
import { clamp, sum } from '../../core/math';
import { applyModifiers } from '../../core/modifiers';
import { groupsByMember, pooledContractVolume } from '../../core/synergies';
import type { System } from '../../core/system';
import type { Company } from '../../model/company';
import type { Id } from '../../model/ids';
import type { CommodityMarket } from '../../model/markets';
import { sectorModule } from '../../sectors';
import { nationalYield } from '../../sectors/agri/weather';

/** Crops: (national yield index)^(−weatherSensitivity); 1 for the other commodities. */
export function harvestFactor(ctx: TurnContext, commodityId: string): number {
  const sensitivity = ctx.config.commodities.markets[commodityId]?.weatherSensitivity ?? 0;
  if (sensitivity === 0) return 1;
  return Math.max(1e-3, nationalYield(ctx.draft)) ** -sensitivity;
}

/** P = P^w · priceModifier · harvestFactor · max(minShare, D / D_ref)^η */
export function clearingPrice(ctx: TurnContext, market: CommodityMarket, demand: number): number {
  const cfg = ctx.config.commodities;
  const eta = cfg.markets[market.id]?.priceImpact ?? 0;
  const ratio = market.refDemand > 0 ? demand / market.refDemand : 1;
  const modifier = applyModifiers(ctx.draft.modifiers, 'commodity.price', 1, [
    { kind: 'commodity', id: market.id },
  ]);
  return (
    market.worldPrice *
    Math.max(0, modifier) *
    harvestFactor(ctx, market.id) *
    Math.max(cfg.minDemandShare, ratio) ** eta
  );
}

/**
 * Contract price: expected spot + forward premium − volume discount, the
 * discount earned on the contract's volume plus `pooledVolume` (the volume
 * its group buys together, lot 3.2).
 */
function contractPrice(
  ctx: TurnContext,
  market: CommodityMarket,
  qtyPerQuarter: number,
  pooledVolume = 0,
): number {
  const cfg = ctx.config.commodities;
  const fullVolume = market.refDemand * cfg.contractDiscountFullVolumeShare;
  const volume = qtyPerQuarter + pooledVolume;
  const discount =
    cfg.contractVolumeDiscountMax * (fullVolume > 0 ? Math.min(1, volume / fullVolume) : 0);
  const modifier = applyModifiers(ctx.draft.modifiers, 'commodity.price', 1, [
    { kind: 'commodity', id: market.id },
  ]);
  return (
    market.worldPrice *
    Math.max(0, modifier) *
    harvestFactor(ctx, market.id) *
    (1 + cfg.forwardPremium) *
    (1 - discount)
  );
}

const isActive = (turn: number) => (c: Company['contracts'][number]) =>
  c.startsAt <= turn && turn < c.endsAt;

/** Adds delivered units to a stock lot at a weighted average cost. */
function receive(company: Company, commodityId: Id, qty: number, unitPrice: number): void {
  if (qty <= 0) return;
  const lot = (company.inventory[commodityId] ??= { qty: 0, avgCost: 0 });
  lot.avgCost = (lot.qty * lot.avgCost + qty * unitPrice) / (lot.qty + qty);
  lot.qty += qty;
}

/** Expected consumption of a non-storable input (bought at consumption, step 7). */
function plannedNeed(ctx: TurnContext, company: Company, commodityId: Id): number {
  const module = sectorModule(company.sector);
  if (!module) return 0;
  return module.plannedInputs(ctx.draft, company, ctx.decisions[company.id])[commodityId] ?? 0;
}

/**
 * Step 6: new contracts → spot clearing (limit orders cut by tranches until
 * the price meets their limit) → deliveries into stock. Non-storable inputs
 * clear on the expected consumption and are settled in production. Then the
 * world price moves to next quarter (Ornstein-Uhlenbeck on ln, seasonality).
 * Crop prices also follow the national harvest (weather, agri.yield).
 * Reads commodity.price and commodity.supply.
 */
export const commoditiesSystem: System = {
  id: 'commodities',
  run(ctx) {
    const { draft, config, turn } = ctx;
    const cfg = config.commodities;
    const companies = operatingCompanies(draft);

    // New contracts are priced on this quarter's world price and start now. The
    // volume discount counts what the other members of the group contract (in
    // force and signed this quarter, whatever the order of the companies).
    const groups = groupsByMember(draft);
    const pooled = companies.map((company) => {
      const profile = groups[company.id];
      const volumes: Record<Id, number> = {};
      for (const c of ctx.decisions[company.id]?.purchasing.newContracts ?? []) {
        if (volumes[c.commodityId] !== undefined) continue;
        let fresh = 0;
        for (const id of profile?.members ?? []) {
          if (id === company.id) continue;
          for (const k of ctx.decisions[id]?.purchasing.newContracts ?? []) {
            if (k.commodityId === c.commodityId) fresh += k.qtyPerQuarter;
          }
        }
        volumes[c.commodityId] =
          pooledContractVolume(draft, company, c.commodityId, groups, turn) +
          fresh * config.conglomerate.synergies.pooledPurchasingShare;
      }
      return volumes;
    });
    companies.forEach((company, i) => {
      for (const c of ctx.decisions[company.id]?.purchasing.newContracts ?? []) {
        const market = draft.commodities[c.commodityId];
        if (!market) continue;
        company.contracts.push({
          id: newId(draft.meta, 'ctr'),
          commodityId: c.commodityId,
          qtyPerQuarter: c.qtyPerQuarter,
          price: contractPrice(ctx, market, c.qtyPerQuarter, pooled[i]?.[c.commodityId] ?? 0),
          startsAt: turn,
          endsAt: turn + c.quarters,
        });
      }
    });

    for (const commodityId of Object.keys(draft.commodities).sort()) {
      const market = draft.commodities[commodityId] as CommodityMarket;
      const storable = cfg.markets[commodityId]?.storable ?? true;
      const supply = clamp(
        applyModifiers(draft.modifiers, 'commodity.supply', 1, [
          { kind: 'commodity', id: commodityId },
        ]),
        0,
        1,
      );
      const contracted = sum(
        companies.flatMap((c) =>
          c.contracts
            .filter((k) => k.commodityId === commodityId && isActive(turn)(k))
            .map((k) => k.qtyPerQuarter),
        ),
      );

      // Spot orders (storable) or expected spot needs (non-storable).
      const orders: { company: Company; qty: number; limit: number; fill: number }[] = [];
      let otherSpotDemand = 0;
      for (const company of companies) {
        if (storable) {
          for (const o of ctx.decisions[company.id]?.purchasing.spot ?? []) {
            if (o.commodityId !== commodityId || o.qty <= 0) continue;
            orders.push({ company, qty: o.qty, limit: o.limitPrice ?? Infinity, fill: o.qty });
          }
        } else {
          const own = sum(
            company.contracts
              .filter((k) => k.commodityId === commodityId && isActive(turn)(k))
              .map((k) => k.qtyPerQuarter),
          );
          otherSpotDemand += Math.max(0, plannedNeed(ctx, company, commodityId) - own);
        }
      }

      const demand = () => contracted + otherSpotDemand + sum(orders.map((o) => o.fill));
      let price = clearingPrice(ctx, market, demand());
      const maxRounds = cfg.limitOrderTranches * orders.length + 1;
      for (let round = 0; round < maxRounds; round++) {
        const violating = orders.filter((o) => o.fill > 0 && o.limit < price);
        if (violating.length === 0) break;
        for (const o of violating) o.fill = Math.max(0, o.fill - o.qty / cfg.limitOrderTranches);
        price = clearingPrice(ctx, market, demand());
      }
      market.spotPrice = price;
      market.lastSimDemand = demand();

      // Deliveries of storable goods (non-storable ones are settled at consumption).
      if (storable) {
        for (const company of companies) {
          const ledger = ctx.ledger(company.id);
          for (const k of company.contracts) {
            if (k.commodityId !== commodityId || !isActive(turn)(k)) continue;
            const qty = k.qtyPerQuarter * supply;
            receive(company, commodityId, qty, k.price);
            ledger.purchases += qty * k.price;
          }
        }
        const unitPrice = price * (1 + cfg.spotPremium);
        for (const o of orders) {
          const qty = o.fill * supply;
          receive(o.company, commodityId, qty, unitPrice);
          ctx.ledger(o.company.id).purchases += qty * unitPrice;
        }
      }
    }
    advanceWorldPrices(ctx);
  },
};

/** Moves every world price to next quarter; this quarter's spot price is already set. */
export function advanceWorldPrices(ctx: TurnContext): void {
  const { draft, config, rng, turn } = ctx;
  for (const commodityId of Object.keys(draft.commodities).sort()) {
    const market = draft.commodities[commodityId] as CommodityMarket;
    const c = config.commodities.markets[commodityId];
    if (!c) continue;
    const season = c.seasonality[turn % 4] ?? 1;
    const nextSeason = c.seasonality[(turn + 1) % 4] ?? 1;
    const x = Math.log(market.worldPrice / season);
    const anchor = Math.log(c.basePrice * draft.macro.priceLevel);
    const next = x + c.meanReversion * (anchor - x) + rng.normal(0, c.volatility);
    market.worldPrice = Math.exp(next) * nextSeason;
  }
}

import type { TurnContext } from '../../core/context';
import { indexedRefPrice, isOperating } from '../../core/companies';
import { clamp, sum } from '../../core/math';
import { applyModifiers } from '../../core/modifiers';
import { groupsByMember, sharedBrand } from '../../core/synergies';
import type { Company, ProductLine } from '../../model/company';
import type { ProductMarket } from '../../model/markets';
import type { GameState } from '../../model/state';
import { marketShares, type Offer } from '../../systems/products/logit';
import { techConfigOf } from '../config';
import { settleNonStorable } from '../plant';
import { assignedDevelopers, churnRate, cloudPerUser, supportCoverage, techTeam } from './team';

export interface SubscriptionSeller {
  company: Company;
  line: ProductLine;
  marketing: number;
}

const season = (state: GameState, marketId: string, turn: number): number =>
  state.config.products.markets[marketId]?.seasonality[((turn % 4) + 4) % 4] ?? 1;

/** What buyers compare: price, quality, brand, marketing, installed base, tech level vs frontier. */
export const subscriptionOffer = (
  market: ProductMarket,
  company: Company,
  line: ProductLine,
  price: number,
  marketing: number,
  brand: number = company.brand,
): Offer => ({
  price,
  quality: line.quality,
  brand,
  marketing,
  users: line.users ?? 0,
  techGap: (line.techLevel ?? 0) - (market.techFrontier ?? 0),
});

/** New subscribers looking for a product this quarter: Q = base·season·cycle·(avg/ref)^(−ε)·modifiers. */
function newSubscribers(state: GameState, market: ProductMarket, averagePrice: number): number {
  const marketCfg = state.config.products.markets[market.id];
  if (!marketCfg) return 0;
  const ref = indexedRefPrice(state, market.id);
  return (
    market.baseVolume *
    season(state, market.id, state.meta.turn) *
    state.macro.demandIndex *
    (averagePrice / ref) ** -marketCfg.priceElasticity *
    Math.max(
      0,
      applyModifiers(state.modifiers, 'market.demand', 1, [{ kind: 'market', id: market.id }]),
    )
  );
}

/**
 * Step 8 for a subscription market: the flow of new subscribers is shared by
 * the logit (network effect and technology gap included); each base loses
 * its churn; the subscribers of the quarter (average of the opening and
 * closing bases) are billed and served from the cloud (cost of sales). No
 * stock: nothing is lost for lack of goods. Shares are shares of the billed
 * subscribers.
 */
export function sellSubscriptions(
  ctx: TurnContext,
  market: ProductMarket,
  sellers: readonly SubscriptionSeller[],
): void {
  const { draft, config } = ctx;
  const P = config.products;
  const ref = indexedRefPrice(draft, market.id);
  const groups = groupsByMember(draft);
  const offers = sellers.map((s) =>
    subscriptionOffer(
      market,
      s.company,
      s.line,
      s.line.price,
      s.marketing,
      sharedBrand(draft, s.company, groups),
    ),
  );
  const shares = marketShares(market.segments, offers, ref, P.marketingUnit, P.networkUnit);
  const inside = sum(shares);
  const averagePrice =
    inside > 0 ? sum(sellers.map((s, i) => (shares[i] ?? 0) * s.line.price)) / inside : ref;
  const demand = newSubscribers(draft, market, averagePrice);
  const frontier = market.techFrontier ?? 0;

  const billed: number[] = [];
  let revenue = 0;
  sellers.forEach((s, i) => {
    const cfg = techConfigOf(config, s.company.sector);
    if (!cfg) {
      billed.push(0);
      return;
    }
    const before = s.line.users ?? 0;
    const team = techTeam(config, cfg, s.company, assignedDevelopers(ctx.decisions[s.company.id]));
    const churn = churnRate(
      cfg,
      {
        price: s.line.price,
        quality: s.line.quality,
        techGap: frontier - (s.line.techLevel ?? 0),
        supportCoverage: supportCoverage(cfg, team, before),
      },
      averagePrice,
    );
    const acquired = demand * (shares[i] ?? 0);
    const after = before * (1 - churn) + acquired;
    const served = (before + after) / 2;
    const ledger = ctx.ledger(s.company.id);
    ledger.cogs += settleNonStorable(
      ctx,
      s.company,
      cfg.cloudId,
      served * cloudPerUser(cfg, s.company.processLevel),
    );
    ledger.revenue += served * s.line.price;
    ledger.unitsProduced += served;
    ledger.unitsSold += served;
    s.line.users = after;
    s.line.acquired = acquired;
    s.line.churn = churn;
    billed.push(served);
    revenue += served * s.line.price;
  });

  const volume = sum(billed);
  market.lastResult = {
    shares: Object.fromEntries(
      sellers.map((s, i) => [s.line.id, volume > 0 ? (billed[i] ?? 0) / volume : 0]),
    ),
    demand: volume,
    allocated: Object.fromEntries(sellers.map((s, i) => [s.line.id, billed[i] ?? 0])),
    volume,
    avgPrice: volume > 0 ? revenue / volume : ref,
  };
}

/** Expected subscriptions of a line this quarter under a price and a marketing budget. */
export interface SubscriptionEstimate {
  acquired: number;
  churn: number;
  /** Subscribers at the end of the quarter. */
  users: number;
  /** Subscriber-quarters billed. */
  billed: number;
}

/**
 * Estimate from what the player knows. After the first quarter: last
 * quarter's new subscribers, seasonally adjusted, moved by the local logit
 * response to the own price and marketing changes (rivals held constant);
 * churn at the new price against last quarter's average. Before: full logit
 * on the current public offers.
 */
export function estimateSubscriptions(
  state: GameState,
  company: Company,
  line: ProductLine,
  price: number,
  marketing: number,
  supportCov: number,
): SubscriptionEstimate {
  const cfg = techConfigOf(state.config, company.sector);
  const market = state.productMarkets[line.marketId];
  const users = line.users ?? 0;
  if (!cfg || !market) return { acquired: 0, churn: 0, users, billed: users };
  const P = state.config.products;
  const turn = state.meta.turn;
  let acquired: number;
  let averagePrice = market.lastResult.avgPrice;
  if (turn > 0 && line.acquired !== undefined) {
    const s = clamp(market.lastResult.shares[line.id] ?? 0, 0, 1);
    const before = company.lastDecisions?.marketing[line.id] ?? company.books.current.pnl.marketing;
    const dPrice = Math.log(price / line.price);
    const dMarketing =
      Math.log(1 + marketing / P.marketingUnit) - Math.log(1 + before / P.marketingUnit);
    const factor = sum(
      market.segments.map(
        (k) =>
          k.weight * Math.exp((1 - s) * (-k.betaPrice * dPrice + k.betaMarketing * dMarketing)),
      ),
    );
    acquired =
      line.acquired *
      (season(state, market.id, turn) / season(state, market.id, turn - 1)) *
      factor;
  } else {
    const ref = indexedRefPrice(state, market.id);
    const sellers = Object.values(state.companies)
      .filter(isOperating)
      .flatMap((c) =>
        Object.values(c.productLines)
          .filter((l) => l.marketId === market.id)
          .map((l) => ({ c, l })),
      );
    const groups = groupsByMember(state);
    const offers = sellers.map(({ c, l }) =>
      l.id === line.id
        ? subscriptionOffer(market, c, l, price, marketing, sharedBrand(state, c, groups))
        : subscriptionOffer(market, c, l, l.price, 0, sharedBrand(state, c, groups)),
    );
    const shares = marketShares(market.segments, offers, ref, P.marketingUnit, P.networkUnit);
    const inside = sum(shares);
    averagePrice =
      inside > 0 ? sum(offers.map((o, i) => (shares[i] ?? 0) * o.price)) / inside : ref;
    const own = sellers.findIndex(({ l }) => l.id === line.id);
    acquired = newSubscribers(state, market, averagePrice) * (shares[own] ?? 0);
  }
  const churn = churnRate(
    cfg,
    {
      price,
      quality: line.quality,
      techGap: (market.techFrontier ?? 0) - (line.techLevel ?? 0),
      supportCoverage: supportCov,
    },
    averagePrice,
  );
  const after = users * (1 - churn) + acquired;
  return { acquired, churn, users: after, billed: (users + after) / 2 };
}

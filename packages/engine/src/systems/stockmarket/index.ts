import type { TurnContext } from '../../core/context';
import { isOperating, operatingCompanies } from '../../core/companies';
import { clamp, sum } from '../../core/math';
import type { System } from '../../core/system';
import type { Company } from '../../model/company';
import type { Id, Money } from '../../model/ids';
import type { Quote } from '../../model/stock';
import { publishedStatements } from './fundamental';
import { fundamentalOf, revalueHoldings, type StakeTrades } from './holdings';

export { fundamentalValue, publishedStatements } from './fundamental';
export { fundamentalOf, holdings, holdingsCarrying, revalueHoldings, shareValue } from './holdings';

interface Fill {
  buyerId: Id;
  side: 'buy' | 'sell';
  requested: number;
  limit: number | undefined;
  fill: number;
}

/** Common factor r_market: noise, policy rate change and demand cycle change over the quarter. */
function marketFactor(ctx: TurnContext): number {
  const { draft, config, rng } = ctx;
  const pf = config.stockMarket.priceFormation;
  const series = draft.history.series;
  const prevRate = series['macro.policyRate']?.at(-1) ?? draft.macro.policyRate;
  const prevDemand = series['macro.demandIndex']?.at(-1) ?? draft.macro.demandIndex;
  return (
    rng.normal(0, pf.marketVolatility) -
    pf.marketRateSensitivity * (draft.macro.policyRate - prevRate) +
    pf.marketDemandSensitivity * Math.log(draft.macro.demandIndex / Math.max(1e-9, prevDemand))
  );
}

/** Publishes the quarter that leaves the lag window; returns the earnings surprise. */
function publish(ctx: TurnContext, company: Company, quote: Quote): number {
  const pf = ctx.config.stockMarket.priceFormation;
  const quarter = ctx.turn - ctx.config.stockMarket.publicationLagQuarters;
  const statements = company.books.history.find((s) => s.quarter === quarter);
  if (!statements || quarter <= quote.publishedQuarter) return 0;
  const ebitda = statements.pnl.ebitda;
  let surprise = 0;
  if (quote.publishedQuarter < 0) quote.consensus = ebitda;
  else {
    const scale = Math.max(
      Math.abs(quote.consensus),
      pf.surpriseFloorShareOfRevenue * Math.abs(statements.pnl.revenue),
      1,
    );
    surprise = clamp((ebitda - quote.consensus) / scale, -pf.surpriseCap, pf.surpriseCap);
    quote.consensus += pf.consensusSmoothing * (ebitda - quote.consensus);
  }
  quote.publishedQuarter = quarter;
  return surprise;
}

/**
 * Step 11: fundamental value → price (pull to the fundamental, market factor,
 * earnings surprise, impact of the net buying, noise) → execution of the
 * stock orders at the new price (limits, cash) → registry → index → fair
 * value of every company's financial assets, booked into the quarter's
 * statements (financial result, cash, investing flow).
 */
export const stockMarketSystem: System = {
  id: 'stockmarket',
  run(ctx) {
    const { draft, config, rng, turn } = ctx;
    const SM = config.stockMarket;
    const pf = SM.priceFormation;
    const rMarket = marketFactor(ctx);
    const operating = operatingCompanies(draft);
    const cashLeft: Record<Id, Money> = {};
    // By company, then by target.
    const traded: Record<Id, Record<Id, StakeTrades>> = {};
    for (const c of operating) cashLeft[c.id] = c.books.current.balance.cash;

    const previousCaps: Record<Id, Money> = {};
    const targets = Object.keys(draft.companies).sort();
    for (const targetId of targets) {
      const company = draft.companies[targetId] as Company;
      const quote = draft.stock.quotes[targetId];
      const register = draft.stock.registry[targetId];
      if (!quote || !register || !company.listed) continue;
      const p0 = quote.price;
      previousCaps[targetId] = p0 * company.sharesOutstanding;

      if (!isOperating(company)) {
        // Bankrupt: delisted, shares worth the floor price.
        company.listed = false;
        quote.price = SM.minPrice;
        quote.fundamental = SM.minPrice;
        ctx.log({ kind: 'delisted', severity: 'critical', companyId: targetId });
        continue;
      }

      const surprise = publish(ctx, company, quote);
      const fundamental =
        fundamentalOf(draft, company, publishedStatements(draft, company, turn)) ??
        quote.fundamental;
      const base =
        Math.log(p0) +
        pf.fundamentalPull * Math.log(fundamental / p0) +
        pf.marketBeta * rMarket +
        pf.earningsSurprise * surprise +
        rng.normal(0, pf.noise);

      const fills: Fill[] = [];
      for (const buyer of operating) {
        for (const o of ctx.decisions[buyer.id]?.stockOrders ?? []) {
          if (o.targetId !== targetId || o.shares <= 0) continue;
          fills.push({
            buyerId: buyer.id,
            side: o.side,
            requested: o.shares,
            limit: o.limitPrice,
            fill: o.shares,
          });
        }
      }
      const float = Math.max(1, register.public ?? 0);
      const priceOf = () => {
        const net = sum(fills.map((f) => (f.side === 'buy' ? f.fill : -f.fill)));
        return Math.max(SM.minPrice, Math.exp(base + (pf.orderImpact * net) / float));
      };
      // Orders whose limit or cash is not met at the price they create are cut; repeat.
      let price = priceOf();
      for (let round = 0; round <= fills.length; round++) {
        let changed = false;
        for (const f of fills) {
          if (f.fill <= 0) continue;
          let fill = f.fill;
          if (f.limit !== undefined && (f.side === 'buy' ? f.limit < price : f.limit > price)) {
            fill = 0;
          }
          if (f.side === 'buy') {
            fill = Math.min(fill, Math.floor(Math.max(0, cashLeft[f.buyerId] ?? 0) / price));
          }
          if (fill !== f.fill) {
            f.fill = fill;
            changed = true;
          }
        }
        if (!changed) break;
        price = priceOf();
      }

      // Sells first: they add to the public float that buyers draw on.
      const sellsFirst = [...fills].sort(
        (x, y) => Number(x.side === 'buy') - Number(y.side === 'buy'),
      );
      for (const f of sellsFirst) {
        if (f.side === 'buy') f.fill = Math.min(f.fill, register.public ?? 0);
        if (f.fill <= 0) continue;
        const value = f.fill * price;
        const sign = f.side === 'buy' ? 1 : -1;
        register.public = (register.public ?? 0) - sign * f.fill;
        register[f.buyerId] = (register[f.buyerId] ?? 0) + sign * f.fill;
        cashLeft[f.buyerId] = (cashLeft[f.buyerId] ?? 0) - sign * value;
        const t = ((traded[f.buyerId] ??= {})[targetId] ??= { bought: 0, sold: 0 });
        if (f.side === 'buy') t.bought += value;
        else t.sold += value;
        ctx.log({
          kind: 'stock_trade',
          severity: 'info',
          companyId: f.buyerId,
          data: { targetId, side: f.side, shares: f.fill, price },
        });
      }
      quote.price = price;
      quote.fundamental = fundamental;
    }

    // Chain-linked, capitalization-weighted index over the companies listed at the start.
    const ids = Object.keys(previousCaps);
    const before = sum(ids.map((id) => previousCaps[id] ?? 0));
    const after = sum(
      ids.map(
        (id) =>
          (draft.stock.quotes[id]?.price ?? 0) * (draft.companies[id]?.sharesOutstanding ?? 0),
      ),
    );
    if (before > 0) draft.stock.index.value *= after / before;
    pushBounded(
      draft.stock.index.history,
      draft.stock.index.value,
      config.reporting.historyMaxLength,
    );
    for (const quote of Object.values(draft.stock.quotes)) {
      quote.referencePrice = quote.price;
      pushBounded(quote.history, quote.price, config.reporting.historyMaxLength);
    }

    // Financial assets (minority stakes at fair value, the group's at cost less impairment);
    // the change and the trades go through the statements of every company that closed this
    // quarter (one that just went bankrupt included).
    for (const id of targets) {
      const company = draft.companies[id] as Company;
      const statements = company.books.current;
      if (statements.quarter !== turn) continue;
      const trades = traded[company.id] ?? {};
      const cash = sum(Object.values(trades).map((t) => t.sold - t.bought));
      const { carrying, result, groupResult } = revalueHoldings(draft, company, trades);
      const b = statements.balance;
      b.cash += cash;
      b.financialAssets = carrying;
      b.equity += result;
      statements.pnl.financial += result;
      statements.pnl.groupFinancial += groupResult;
      statements.pnl.netIncome += result;
      statements.cashFlow.investing += cash;
      statements.cashFlow.netChange += cash;
      const history = company.books.history;
      if (history.at(-1)?.quarter === turn) history[history.length - 1] = statements;
    }
  },
};

function pushBounded(series: number[], value: number, max: number): void {
  series.push(value);
  if (series.length > max) series.splice(0, series.length - max);
}

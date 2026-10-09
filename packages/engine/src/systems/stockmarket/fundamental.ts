import { clamp, sum } from '../../core/math';
import type { Company } from '../../model/company';
import type { Statements } from '../../model/finance';
import type { Quarter } from '../../model/ids';
import type { GameState } from '../../model/state';

/**
 * Statements the market knows: the closed quarters up to `lastClosed − lag`
 * (listed companies publish with stockMarket.publicationLagQuarters of delay).
 */
export function publishedStatements(
  state: GameState,
  company: Company,
  lastClosed: Quarter,
): Statements[] {
  const through = lastClosed - state.config.stockMarket.publicationLagQuarters;
  return company.books.history.filter((s) => s.quarter <= through);
}

/**
 * Fundamental value per share from published accounts:
 * VE = (w·EBITDA_12m·multiple + (1 − w)·CA_12m·salesMultiple)·f(growth)·g(rate),
 * w = clamp(EBITDA margin / fullEbitdaMargin, 0, 1);
 * F = max(VE − net debt + financial assets, liquidation value) / shares.
 * Undefined until a first quarter is published.
 */
export function fundamentalValue(
  state: GameState,
  company: Company,
  published: readonly Statements[],
): number | undefined {
  const { config, macro } = state;
  const SM = config.stockMarket;
  const f = SM.fundamental;
  const last = published.slice(-4);
  const latest = published.at(-1);
  if (last.length === 0 || !latest) return undefined;
  const scale = 4 / last.length;
  const ebitda = sum(last.map((s) => s.pnl.ebitda)) * scale;
  const revenue = sum(last.map((s) => s.pnl.revenue)) * scale;
  const previous = published.slice(-8, -4);
  const previousRevenue = sum(previous.map((s) => s.pnl.revenue));
  const growth = previous.length === 4 && previousRevenue > 0 ? revenue / previousRevenue - 1 : 0;

  const sector = company.sector === 'holding' ? undefined : company.sector;
  const multiple = sector ? (SM.sectorMultiples[sector] ?? 0) : 0;
  const salesMultiple = sector ? (f.salesMultiples[sector] ?? 0) : 0;
  const margin = revenue > 0 ? ebitda / revenue : 0;
  const w = clamp(margin / f.fullEbitdaMargin, 0, 1);
  const ev =
    (w * Math.max(0, ebitda) * multiple + (1 - w) * revenue * salesMultiple) *
    (1 + f.growthWeight * clamp(growth, -f.growthCap, f.growthCap)) *
    Math.exp(-f.rateSensitivity * (macro.policyRate - config.macro.policyRate.neutral));

  const b = latest.balance;
  const equity = ev - (b.debt - b.cash) + b.financialAssets;
  const liquidation =
    b.cash +
    b.inventory * f.inventoryLiquidationShare +
    b.fixedAssets * (1 - config.sectors.industry.assetResaleDiscount) +
    b.financialAssets -
    b.debt;
  return Math.max(SM.minPrice, Math.max(equity, liquidation) / company.sharesOutstanding);
}

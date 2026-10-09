import type { GameState } from '../../model/state';

/** Values recorded for the charts at the start of the current quarter. */
function snapshot(state: GameState): Record<string, number> {
  const point: Record<string, number> = {
    'macro.gdpGrowth': state.macro.gdpGrowth,
    'macro.inflation': state.macro.inflation,
    'macro.policyRate': state.macro.policyRate,
    'macro.demandIndex': state.macro.demandIndex,
    'stock.index': state.stock.index.value,
  };
  for (const [key, pool] of Object.entries(state.labor)) {
    point[`labor.${key}.marketWage`] = pool.marketWage;
  }
  for (const market of Object.values(state.commodities)) {
    point[`commodity.${market.id}.spotPrice`] = market.spotPrice;
  }
  for (const market of Object.values(state.productMarkets)) {
    point[`market.${market.id}.avgPrice`] = market.lastResult.avgPrice;
    point[`market.${market.id}.volume`] = market.lastResult.volume;
  }
  for (const company of Object.values(state.companies)) {
    const { pnl, balance } = company.books.current;
    point[`company.${company.id}.cash`] = balance.cash;
    point[`company.${company.id}.equity`] = balance.equity;
    point[`company.${company.id}.revenue`] = pnl.revenue;
    point[`company.${company.id}.netIncome`] = pnl.netIncome;
  }
  for (const [companyId, quote] of Object.entries(state.stock.quotes)) {
    point[`quote.${companyId}.price`] = quote.price;
  }
  return point;
}

/**
 * Appends one point per series for the current quarter. A series created
 * later (new company, new market) is shorter than `turns`: it is aligned on
 * the most recent point. Every series keeps at most `historyMaxLength` points.
 */
export function recordHistory(state: GameState): void {
  const { history } = state;
  const max = state.config.reporting.historyMaxLength;
  history.turns.push(state.meta.turn);
  if (history.turns.length > max) history.turns.splice(0, history.turns.length - max);
  for (const [key, value] of Object.entries(snapshot(state))) {
    const series = (history.series[key] ??= []);
    series.push(value);
    if (series.length > max) series.splice(0, series.length - max);
  }
}

/** Drops the oldest journal entries beyond `logMaxEntries`. */
export function trimLog(state: GameState): void {
  const max = state.config.reporting.logMaxEntries;
  if (state.log.length > max) state.log.splice(0, state.log.length - max);
}

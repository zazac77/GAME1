import type { GameConfig } from '../config/schema';
import type { AnnualFigures } from '../model/mna';
import type { Money, SectorId } from '../model/ids';
import { clamp } from './math';

/**
 * Enterprise value by the stock market multiples:
 * (w·EBITDA·multiple + (1 − w)·revenue·salesMultiple)·f(growth)·g(rate),
 * w = clamp(EBITDA margin / fullEbitdaMargin, 0, 1). Annual figures.
 */
export function multiplesValue(
  config: GameConfig,
  policyRate: number,
  sector: SectorId | 'holding',
  annual: AnnualFigures,
  growth: number,
): Money {
  const SM = config.stockMarket;
  const f = SM.fundamental;
  const multiple = sector === 'holding' ? 0 : (SM.sectorMultiples[sector] ?? 0);
  const salesMultiple = sector === 'holding' ? 0 : (f.salesMultiples[sector] ?? 0);
  const margin = annual.revenue > 0 ? annual.ebitda / annual.revenue : 0;
  const w = clamp(margin / f.fullEbitdaMargin, 0, 1);
  return (
    (w * Math.max(0, annual.ebitda) * multiple + (1 - w) * annual.revenue * salesMultiple) *
    (1 + f.growthWeight * clamp(growth, -f.growthCap, f.growthCap)) *
    Math.exp(-f.rateSensitivity * (policyRate - config.macro.policyRate.neutral))
  );
}

/**
 * Simplified DCF: free cash flow = EBITDA × fcfShareOfEbitda, growing at the
 * current growth fading linearly to the terminal growth over the horizon,
 * discounted at policy rate + equity risk premium, plus a Gordon terminal
 * value. A negative EBITDA is worth nothing on this method.
 */
export function dcfValue(
  config: GameConfig,
  policyRate: number,
  annual: AnnualFigures,
  growth: number,
): Money {
  const V = config.mna.valuation;
  const cap = config.stockMarket.fundamental.growthCap;
  const g0 = clamp(growth, -cap, cap);
  const r = Math.max(policyRate + V.equityRiskPremium, V.terminalGrowth + 0.02);
  let fcf = Math.max(0, annual.ebitda) * V.fcfShareOfEbitda;
  let value = 0;
  for (let year = 1; year <= V.horizonYears; year++) {
    const g = g0 + ((V.terminalGrowth - g0) * (year - 1)) / Math.max(1, V.horizonYears - 1);
    fcf *= 1 + g;
    value += fcf / (1 + r) ** year;
  }
  const terminal = (fcf * (1 + V.terminalGrowth)) / (r - V.terminalGrowth);
  return value + terminal / (1 + r) ** V.horizonYears;
}

/** Equity valuation of a whole company (both methods, the range shown and the control premium). */
export interface EquityValuation {
  multiples: Money;
  dcf: Money;
  low: Money;
  mid: Money;
  high: Money;
  /** Premium a buyer can expect to pay for control (share of the value). */
  controlPremium: number;
}

export function valueEquity(
  config: GameConfig,
  policyRate: number,
  sector: SectorId | 'holding',
  annual: AnnualFigures,
  growth: number,
  netDebt: Money,
  financialAssets: Money,
): EquityValuation {
  const bridge = financialAssets - netDebt;
  const multiples = multiplesValue(config, policyRate, sector, annual, growth) + bridge;
  const dcf = dcfValue(config, policyRate, annual, growth) + bridge;
  const half = config.mna.valuation.rangeWidth / 2;
  return {
    multiples,
    dcf,
    low: Math.max(0, Math.min(multiples, dcf) * (1 - half)),
    mid: Math.max(0, (multiples + dcf) / 2),
    high: Math.max(0, Math.max(multiples, dcf) * (1 + half)),
    controlPremium: config.mna.valuation.controlPremium,
  };
}

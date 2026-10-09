import type { GameState } from '@game/engine';
import type { GameRecord } from './run';

/**
 * Sanity bounds of the smoke test (not balancing targets): a value outside
 * them means the simulation diverged.
 */
export const SANITY = {
  /** Market wage / (base wage × regional index × price level). */
  wage: { min: 0.3, max: 4 },
  /** Spot price / (base price × price level). */
  commodity: { min: 0.1, max: 10 },
  /** Product price / indexed reference price (validation bounds are tighter). */
  product: { min: 0.1, max: 10 },
  /** Share price / initial share price (above the floor price). */
  share: { max: 100 },
  /** |assets − liabilities| / max(1, assets). */
  balance: 1e-6,
} as const;

export interface CompanyMetrics {
  companyId: string;
  name: string;
  kind: 'player' | 'ai';
  profileId: string;
  status: string;
  revenue: number;
  netIncome: number;
  netMargin: number;
  finalEquity: number;
  finalSharePrice: number;
  /** Std of quarterly log returns of the share price while listed. */
  shareVolatility: number;
  maxMarketShare: number;
}

export interface GameMetrics {
  seed: number;
  turns: number;
  error?: string;
  sanityViolations: string[];
  companies: CompanyMetrics[];
  aiBankruptcies: number;
  aiCount: number;
  profitableAi: number;
  /** Mean over labor pools of (real wage at the end / at the start) − 1. */
  realWageDrift: number;
  /** Mean over commodities of the std of quarterly log changes of the spot price. */
  commodityVolatility: number;
  /** Largest share of the volume sold by one firm in any quarter. */
  maxMarketShare: number;
  finalIndex: number;
  playerScore: number;
}

export function std(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((s, x) => s + x, 0) / values.length;
  return Math.sqrt(values.reduce((s, x) => s + (x - mean) ** 2, 0) / (values.length - 1));
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? (sorted[mid] as number)
    : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

const logReturns = (series: readonly number[]): number[] =>
  series.slice(1).map((x, i) => Math.log(x / (series[i] as number)));

function sanity(state: GameState, initialPrices: Record<string, number>): string[] {
  const out: string[] = [];
  const t = state.meta.turn;
  const { config, macro } = state;
  const bad = (what: string) => out.push(`t${t}: ${what}`);
  for (const [key, pool] of Object.entries(state.labor)) {
    const base =
      (config.labor.occupations[pool.occupationId]?.baseWage ?? 1) *
      (state.regions[pool.regionId]?.wageIndex ?? 1) *
      macro.priceLevel;
    const r = pool.marketWage / base;
    if (!(r >= SANITY.wage.min && r <= SANITY.wage.max)) bad(`wage ${key} ×${r.toFixed(2)}`);
  }
  for (const m of Object.values(state.commodities)) {
    const base = (config.commodities.markets[m.id]?.basePrice ?? 1) * macro.priceLevel;
    const r = m.spotPrice / base;
    if (!(r >= SANITY.commodity.min && r <= SANITY.commodity.max)) {
      bad(`commodity ${m.id} ×${r.toFixed(2)}`);
    }
  }
  for (const c of Object.values(state.companies)) {
    for (const line of Object.values(c.productLines)) {
      const ref = (state.productMarkets[line.marketId]?.refPrice ?? 1) * macro.priceLevel;
      const r = line.price / ref;
      if (!(r >= SANITY.product.min && r <= SANITY.product.max))
        bad(`price ${line.id} ×${r.toFixed(2)}`);
    }
    const b = c.books.current.balance;
    const assets = b.cash + b.inventory + b.fixedAssets + b.financialAssets;
    const gap =
      Math.abs(assets - b.debt - b.equity - b.minorityInterests) / Math.max(1, Math.abs(assets));
    if (!(gap <= SANITY.balance)) bad(`balance ${c.id} gap ${gap}`);
    const quote = state.stock.quotes[c.id];
    const p0 = initialPrices[c.id] ?? 1;
    if (quote && !(quote.price > 0 && quote.price <= SANITY.share.max * p0)) {
      bad(`share ${c.id} ${quote.price}`);
    }
  }
  return out;
}

export function gameMetrics(record: GameRecord): GameMetrics {
  const first = record.states[0] as GameState;
  const last = record.states.at(-1) as GameState;
  const initialPrices = Object.fromEntries(
    Object.entries(first.stock.quotes).map(([id, q]) => [id, q.price]),
  );
  const sanityViolations = record.states.flatMap((s) => sanity(s, initialPrices));

  const shareOf: Record<string, number> = {};
  for (const s of record.states.slice(1)) {
    for (const market of Object.values(s.productMarkets)) {
      for (const c of Object.values(s.companies)) {
        for (const lineId of Object.keys(c.productLines)) {
          const share = market.lastResult.shares[lineId] ?? 0;
          shareOf[c.id] = Math.max(shareOf[c.id] ?? 0, share);
        }
      }
    }
  }

  const companies: CompanyMetrics[] = Object.values(last.companies).map((c) => {
    const actor = Object.values(last.actors).find((a) => a.rootCompanyId === c.id);
    const quarters = c.books.history;
    const revenue = quarters.reduce((s, q) => s + q.pnl.revenue, 0);
    const netIncome = quarters.reduce((s, q) => s + q.pnl.netIncome, 0);
    const listedPrices = record.states
      .filter((s) => s.companies[c.id]?.listed)
      .map((s) => s.stock.quotes[c.id]?.price ?? 0);
    return {
      companyId: c.id,
      name: c.name,
      kind: c.id === record.playerCompanyId ? 'player' : 'ai',
      profileId: actor?.profileId ?? 'passive',
      status: c.status,
      revenue,
      netIncome,
      netMargin: revenue > 0 ? netIncome / revenue : 0,
      finalEquity: c.books.current.balance.equity,
      finalSharePrice: last.stock.quotes[c.id]?.price ?? 0,
      shareVolatility: std(logReturns(listedPrices)),
      maxMarketShare: shareOf[c.id] ?? 0,
    };
  });
  const ai = companies.filter((c) => c.kind === 'ai');

  const drifts = Object.entries(last.labor).map(([key, pool]) => {
    const start = first.labor[key as keyof typeof first.labor];
    const real = pool.marketWage / last.macro.priceLevel;
    return start ? real / (start.marketWage / first.macro.priceLevel) - 1 : 0;
  });
  const commodityVols = Object.keys(first.commodities).map((id) =>
    std(logReturns(record.states.slice(1).map((s) => s.commodities[id]?.spotPrice ?? 0))),
  );
  const playerActor = last.actors[last.meta.playerActorId];
  const held = last.stock.registry[record.playerCompanyId]?.[playerActor?.id ?? ''] ?? 0;

  const metrics: GameMetrics = {
    seed: record.seed,
    turns: last.meta.turn,
    sanityViolations,
    companies,
    aiBankruptcies: ai.filter((c) => c.status === 'bankrupt').length,
    aiCount: ai.length,
    profitableAi: ai.filter((c) => c.netIncome > 0).length,
    realWageDrift: drifts.reduce((s, x) => s + x, 0) / Math.max(1, drifts.length),
    commodityVolatility:
      commodityVols.reduce((s, x) => s + x, 0) / Math.max(1, commodityVols.length),
    maxMarketShare: Math.max(0, ...companies.map((c) => c.maxMarketShare)),
    finalIndex: last.stock.index.value,
    playerScore: held * (last.stock.quotes[record.playerCompanyId]?.price ?? 0),
  };
  if (record.error) metrics.error = record.error;
  return metrics;
}

export interface Summary {
  games: number;
  errors: number;
  sanityViolations: number;
  aiBankruptcyRate: number;
  gamesWithProfitableAi: number;
  gamesWithAllAiBankrupt: number;
  medianNetMargin: number;
  medianRealWageDrift: number;
  medianCommodityVolatility: number;
  medianShareVolatility: number;
  maxMarketShare: number;
  medianMaxMarketShare: number;
  byProfile: Record<string, { companies: number; bankruptcyRate: number; medianNetMargin: number }>;
}

export function summarize(games: readonly GameMetrics[]): Summary {
  const all = games.flatMap((g) => g.companies);
  const aiCount = games.reduce((s, g) => s + g.aiCount, 0);
  const byProfile: Summary['byProfile'] = {};
  for (const profile of [...new Set(all.map((c) => `${c.kind}:${c.profileId}`))].sort()) {
    const cs = all.filter((c) => `${c.kind}:${c.profileId}` === profile);
    byProfile[profile] = {
      companies: cs.length,
      bankruptcyRate: cs.filter((c) => c.status === 'bankrupt').length / cs.length,
      medianNetMargin: median(cs.map((c) => c.netMargin)),
    };
  }
  return {
    games: games.length,
    errors: games.filter((g) => g.error).length,
    sanityViolations: games.reduce((s, g) => s + g.sanityViolations.length, 0),
    aiBankruptcyRate: aiCount > 0 ? games.reduce((s, g) => s + g.aiBankruptcies, 0) / aiCount : 0,
    gamesWithProfitableAi: games.filter((g) => g.profitableAi > 0).length,
    gamesWithAllAiBankrupt: games.filter((g) => g.aiCount > 0 && g.aiBankruptcies === g.aiCount)
      .length,
    medianNetMargin: median(all.map((c) => c.netMargin)),
    medianRealWageDrift: median(games.map((g) => g.realWageDrift)),
    medianCommodityVolatility: median(games.map((g) => g.commodityVolatility)),
    medianShareVolatility: median(all.map((c) => c.shareVolatility)),
    maxMarketShare: Math.max(0, ...games.map((g) => g.maxMarketShare)),
    medianMaxMarketShare: median(games.map((g) => g.maxMarketShare)),
    byProfile,
  };
}

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
  /** acquired: a listing bought during the game (not a starting competitor); fund: the activist fund. */
  kind: 'player' | 'ai' | 'acquired' | 'fund';
  sector: string;
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
  /** Rank of the player by equity gain (final − initial equity) in its sector, 1 = best. */
  playerRank: number;
  /**
   * First quarter from which the player's equity gain is the highest of its
   * sector for LEAD_HOLD_QUARTERS quarters in a row (or until the end); null if never.
   */
  playerLeadTurn: number | null;
  /** Competitive moves of the AI journaled (ai_* kinds), and how many target another AI. */
  aiMoves: Record<string, { count: number; againstAi: number }>;
  /** Takeovers (by mode and by buyer), equity transactions and deals that failed. */
  deals: {
    takeovers: number;
    byPlayer: number;
    listings: number;
    blocks: number;
    tenderOffers: number;
    failed: number;
    dividends: number;
    issues: number;
    buybacks: number;
    ipos: number;
    /** Intra-group loans granted, repayments, loans written off. */
    groupLoans: number;
    groupRepayments: number;
    groupWriteOffs: number;
    /** Stock market v3: hostile offers launched (and succeeded), competing offers, raises, withdrawals, pills, mandatory offers, threshold declarations, activist campaigns. */
    hostileOffers: number;
    hostileSucceeded: number;
    competingOffers: number;
    raises: number;
    withdrawals: number;
    pills: number;
    mandatoryOffers: number;
    declarations: number;
    campaigns: number;
  };
}

/** Quarters the player must stay ahead for the lead to count. */
export const LEAD_HOLD_QUARTERS = 4;

/** First index from which `ahead` holds for `hold` entries in a row (or until the end). */
export function firstSustained(ahead: readonly boolean[], hold: number): number | null {
  let run = 0;
  for (let i = 0; i < ahead.length; i++) {
    run = ahead[i] ? run + 1 : 0;
    if (run >= hold) return i - hold + 1;
  }
  return run > 0 ? ahead.length - run : null;
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
    const assets = b.cash + b.inventory + b.fixedAssets + b.financialAssets + b.groupLoans;
    const gap =
      Math.abs(assets - b.debt - b.equity - b.minorityInterests) / Math.max(1, Math.abs(assets));
    if (!(gap <= SANITY.balance)) bad(`balance ${c.id} gap ${gap}`);
    const cons = c.books.consolidated?.at(-1)?.balance;
    if (cons) {
      const total =
        cons.cash + cons.inventory + cons.fixedAssets + cons.financialAssets + cons.groupLoans;
      const consGap =
        Math.abs(total - cons.debt - cons.equity - cons.minorityInterests) /
        Math.max(1, Math.abs(total));
      if (!(consGap <= SANITY.balance)) bad(`consolidated ${c.id} gap ${consGap}`);
    }
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
      kind:
        c.id === record.playerCompanyId
          ? 'player'
          : actor?.kind === 'fund'
            ? 'fund'
            : first.companies[c.id]
              ? 'ai'
              : 'acquired',
      sector: c.sector,
      profileId: actor?.profileId ?? c.managementProfileId ?? 'passive',
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
  const equity = (s: GameState, id: string) => s.companies[id]?.books.current.balance.equity ?? 0;
  // The player is ranked against the companies of its own sector.
  const pid = record.playerCompanyId;
  const sector = first.companies[pid]?.sector;
  const ids = Object.keys(first.companies).filter((id) => first.companies[id]?.sector === sector);
  const gain = (s: GameState, id: string) => equity(s, id) - equity(first, id);
  const ahead = record.states
    .slice(1)
    .map((s) => ids.every((id) => id === pid || gain(s, pid) > gain(s, id)));
  const lead = firstSustained(ahead, LEAD_HOLD_QUARTERS);
  const playerRank = 1 + ids.filter((id) => id !== pid && gain(last, id) >= gain(last, pid)).length;
  const aiMoves: GameMetrics['aiMoves'] = {};
  const isAi = (id: unknown) =>
    typeof id === 'string' && id !== pid && first.companies[id] !== undefined;
  record.states.slice(1).forEach((s, i) => {
    const turn = record.states[i]?.meta.turn;
    for (const e of s.log) {
      if (e.turn !== turn || !e.kind.startsWith('ai_')) continue;
      const m = (aiMoves[e.kind] ??= { count: 0, againstAi: 0 });
      m.count += 1;
      if (isAi(e.data?.rivalId)) m.againstAi += 1;
    }
  });
  const deals: GameMetrics['deals'] = {
    takeovers: 0,
    byPlayer: 0,
    listings: 0,
    blocks: 0,
    tenderOffers: 0,
    failed: 0,
    dividends: 0,
    issues: 0,
    buybacks: 0,
    ipos: 0,
    groupLoans: 0,
    groupRepayments: 0,
    groupWriteOffs: 0,
    hostileOffers: 0,
    hostileSucceeded: 0,
    competingOffers: 0,
    raises: 0,
    withdrawals: 0,
    pills: 0,
    mandatoryOffers: 0,
    declarations: 0,
    campaigns: 0,
  };
  record.states.slice(1).forEach((s, i) => {
    const turn = record.states[i]?.meta.turn;
    for (const e of s.log) {
      if (e.turn !== turn) continue;
      if (e.kind === 'takeover') {
        deals.takeovers += 1;
        if (e.companyId === pid) deals.byPlayer += 1;
        if (e.data?.mode === 'listing') deals.listings += 1;
        else if (e.data?.mode === 'block') deals.blocks += 1;
        else deals.tenderOffers += 1;
        if (e.data?.hostile) deals.hostileSucceeded += 1;
        if (Number(e.data?.mandatory ?? 0) > 0) deals.mandatoryOffers += 1;
      } else if (
        e.kind === 'deal_failed' ||
        e.kind === 'tender_offer_rejected' ||
        e.kind === 'block_purchase_rejected'
      ) {
        deals.failed += 1;
      } else if (e.kind === 'dividend_paid') deals.dividends += 1;
      else if (e.kind === 'shares_issued') deals.issues += 1;
      else if (e.kind === 'shares_bought_back') deals.buybacks += 1;
      else if (e.kind === 'ipo') deals.ipos += 1;
      else if (e.kind === 'group_loan') {
        if (Number(e.data?.lent ?? 0) > 0) deals.groupLoans += 1;
        if (Number(e.data?.repaid ?? 0) > 0) deals.groupRepayments += 1;
      } else if (e.kind === 'group_loan_written_off') deals.groupWriteOffs += 1;
      else if (e.kind === 'hostile_offer') deals.hostileOffers += 1;
      else if (e.kind === 'competing_offer') deals.competingOffers += 1;
      else if (e.kind === 'tender_offer_raised') deals.raises += 1;
      else if (e.kind === 'tender_offer_withdrawn') deals.withdrawals += 1;
      else if (e.kind === 'poison_pill') deals.pills += 1;
      else if (e.kind === 'stake_threshold') deals.declarations += 1;
      else if (e.kind === 'activist_campaign') deals.campaigns += 1;
    }
  });
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
    playerRank,
    playerLeadTurn: lead === null ? null : lead + 1,
    aiMoves,
    deals,
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
  /**
   * By sector: bankruptcies of the AI, median net margin of every company,
   * largest market share (over all games, median of the games) and games where
   * a company of the sector went above 60 %.
   */
  bySector: Record<
    string,
    {
      companies: number;
      aiBankruptcyRate: number;
      medianNetMargin: number;
      maxMarketShare: number;
      medianMaxMarketShare: number;
      gamesAbove60: number;
    }
  >;
  /** Games the player ends first by equity gain. */
  playerFirst: number;
  medianPlayerRank: number;
  /** Games where the player takes a sustained lead, and the median quarter it does. */
  playerLeads: number;
  medianPlayerLeadTurn: number;
  byProfile: Record<string, { companies: number; bankruptcyRate: number; medianNetMargin: number }>;
  /** By kind of AI move: mean count per game, share aimed at another AI. */
  aiMoves: Record<string, { perGame: number; againstAiShare: number }>;
  /** Mean per game of each kind of deal and equity transaction. */
  deals: Record<keyof GameMetrics['deals'], number>;
}

export function summarize(games: readonly GameMetrics[]): Summary {
  // The activist fund has no operations: left out of the company statistics.
  const all = games.flatMap((g) => g.companies).filter((c) => c.kind !== 'fund');
  const aiCount = games.reduce((s, g) => s + g.aiCount, 0);
  const byProfile: Summary['byProfile'] = {};
  const key = (c: CompanyMetrics) => `${c.kind}:${c.sector}:${c.profileId}`;
  for (const profile of [...new Set(all.map(key))].sort()) {
    const cs = all.filter((c) => key(c) === profile);
    byProfile[profile] = {
      companies: cs.length,
      bankruptcyRate: cs.filter((c) => c.status === 'bankrupt').length / cs.length,
      medianNetMargin: median(cs.map((c) => c.netMargin)),
    };
  }
  const bySector: Summary['bySector'] = {};
  for (const sector of [...new Set(all.map((c) => c.sector))].sort()) {
    const cs = all.filter((c) => c.sector === sector);
    const ai = cs.filter((c) => c.kind === 'ai');
    const perGame = games.map((g) =>
      Math.max(0, ...g.companies.filter((c) => c.sector === sector).map((c) => c.maxMarketShare)),
    );
    bySector[sector] = {
      companies: cs.length,
      aiBankruptcyRate:
        ai.length > 0 ? ai.filter((c) => c.status === 'bankrupt').length / ai.length : 0,
      medianNetMargin: median(cs.map((c) => c.netMargin)),
      maxMarketShare: Math.max(0, ...cs.map((c) => c.maxMarketShare)),
      medianMaxMarketShare: median(perGame),
      gamesAbove60: perGame.filter((x) => x > 0.6).length,
    };
  }
  const aiMoves: Summary['aiMoves'] = {};
  for (const kind of [...new Set(games.flatMap((g) => Object.keys(g.aiMoves)))].sort()) {
    const count = games.reduce((s, g) => s + (g.aiMoves[kind]?.count ?? 0), 0);
    const againstAi = games.reduce((s, g) => s + (g.aiMoves[kind]?.againstAi ?? 0), 0);
    aiMoves[kind] = {
      perGame: count / Math.max(1, games.length),
      againstAiShare: count > 0 ? againstAi / count : 0,
    };
  }
  const dealKeys = Object.keys(games[0]?.deals ?? {}) as (keyof GameMetrics['deals'])[];
  const deals = Object.fromEntries(
    dealKeys.map((k) => [k, games.reduce((s, g) => s + g.deals[k], 0) / Math.max(1, games.length)]),
  ) as Summary['deals'];
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
    playerFirst: games.filter((g) => g.playerRank === 1).length,
    medianPlayerRank: median(games.map((g) => g.playerRank)),
    playerLeads: games.filter((g) => g.playerLeadTurn !== null).length,
    medianPlayerLeadTurn: median(
      games.flatMap((g) => (g.playerLeadTurn === null ? [] : [g.playerLeadTurn])),
    ),
    bySector,
    byProfile,
    aiMoves,
    deals,
  };
}

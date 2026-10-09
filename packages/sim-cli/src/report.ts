import type { GameMetrics, Summary } from './metrics';

const pct = (x: number) => `${(100 * x).toFixed(1)} %`;

/** Human-readable summary, with the phase 1 balancing targets (docs/PLAN.md). */
export function formatSummary(s: Summary, turns: number): string {
  const lines = [
    `Parties : ${s.games} × ${turns} tours — erreurs : ${s.errors}, violations des bornes : ${s.sanityViolations}`,
    `Faillite des IA : ${pct(s.aiBankruptcyRate)} (cible 5–20 %) ; parties avec ≥ 1 IA rentable : ${s.gamesWithProfitableAi}/${s.games} ; toutes les IA en faillite : ${s.gamesWithAllAiBankrupt}`,
    `Marge nette médiane : ${pct(s.medianNetMargin)} (cible 4–10 %)`,
    `Dérive des salaires réels (médiane) : ${pct(s.medianRealWageDrift)} (cible ±15 % sur 10 ans)`,
    `Volatilité trimestrielle des matières (médiane) : ${pct(s.medianCommodityVolatility)} (cible 5–15 %)`,
    `Volatilité trimestrielle des cours (médiane) : ${pct(s.medianShareVolatility)} (cible 8–20 %)`,
    `Part de marché max : ${pct(s.maxMarketShare)} (médiane des parties ${pct(s.medianMaxMarketShare)} ; cible < 60 %)`,
    `Joueur : 1er (gain de fonds propres) dans ${s.playerFirst}/${s.games} parties, rang médian ${s.medianPlayerRank} ; prend la tête dans ${s.playerLeads}/${s.games} parties, au tour ${Number.isNaN(s.medianPlayerLeadTurn) ? '—' : s.medianPlayerLeadTurn} en médiane (cible : passif jamais 1er, attentif en tête en 12–20 tours)`,
    'Par secteur :',
    ...Object.entries(s.bySector).map(
      ([sector, v]) =>
        `  ${sector.padEnd(18)} ${String(v.companies).padStart(4)} sociétés, faillite des IA ${pct(v.aiBankruptcyRate).padStart(7)}, marge médiane ${pct(v.medianNetMargin)}, part de marché max ${pct(v.maxMarketShare)}`,
    ),
    'Par profil :',
    ...Object.entries(s.byProfile).map(
      ([p, v]) =>
        `  ${p.padEnd(18)} ${String(v.companies).padStart(4)} sociétés, faillite ${pct(v.bankruptcyRate).padStart(7)}, marge médiane ${pct(v.medianNetMargin)}`,
    ),
  ];
  return lines.join('\n');
}

/** One row per company and game. */
export function toCsv(games: readonly GameMetrics[]): string {
  const header = [
    'seed',
    'company',
    'kind',
    'sector',
    'profile',
    'status',
    'revenue',
    'netIncome',
    'netMargin',
    'finalEquity',
    'finalSharePrice',
    'shareVolatility',
    'maxMarketShare',
    'playerRank',
    'playerLeadTurn',
  ];
  const rows = games.flatMap((g) =>
    g.companies.map((c) =>
      [
        g.seed,
        c.companyId,
        c.kind,
        c.sector,
        c.profileId,
        c.status,
        c.revenue.toFixed(0),
        c.netIncome.toFixed(0),
        c.netMargin.toFixed(4),
        c.finalEquity.toFixed(0),
        c.finalSharePrice.toFixed(2),
        c.shareVolatility.toFixed(4),
        c.maxMarketShare.toFixed(4),
        g.playerRank,
        g.playerLeadTurn ?? '',
      ].join(','),
    ),
  );
  return [header.join(','), ...rows].join('\n') + '\n';
}

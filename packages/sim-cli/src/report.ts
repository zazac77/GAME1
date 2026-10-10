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
        `  ${sector.padEnd(18)} ${String(v.companies).padStart(4)} sociétés, faillite des IA ${pct(v.aiBankruptcyRate).padStart(7)}, marge médiane ${pct(v.medianNetMargin)}, part de marché max ${pct(v.maxMarketShare)} (médiane ${pct(v.medianMaxMarketShare)}, > 60 % dans ${v.gamesAbove60} parties)`,
    ),
    'Par profil :',
    ...Object.entries(s.byProfile).map(
      ([p, v]) =>
        `  ${p.padEnd(18)} ${String(v.companies).padStart(4)} sociétés, faillite ${pct(v.bankruptcyRate).padStart(7)}, marge médiane ${pct(v.medianNetMargin)}`,
    ),
    'Coups de l’IA (par partie, part visant une autre IA) :',
    ...Object.entries(s.aiMoves).map(
      ([kind, v]) =>
        `  ${kind.padEnd(18)} ${v.perGame.toFixed(1).padStart(6)}  (${pct(v.againstAiShare)} contre une IA)`,
    ),
    `Rachats (par partie) : ${s.deals.takeovers.toFixed(2)} prises de contrôle (joueur ${s.deals.byPlayer.toFixed(2)} ; pépites ${s.deals.listings.toFixed(2)}, blocs ${s.deals.blocks.toFixed(2)}, OPA ${s.deals.tenderOffers.toFixed(2)}), ${s.deals.failed.toFixed(2)} échecs`,
    `Opérations sur capital (par partie) : ${s.deals.dividends.toFixed(1)} dividendes, ${s.deals.issues.toFixed(2)} augmentations de capital, ${s.deals.buybacks.toFixed(2)} rachats d’actions, ${s.deals.ipos.toFixed(2)} introductions en bourse`,
    `Intra-groupe (par partie) : ${s.deals.groupLoans.toFixed(2)} prêts accordés, ${s.deals.groupRepayments.toFixed(2)} remboursements, ${s.deals.groupWriteOffs.toFixed(2)} prêts passés en perte`,
    `Bourse v3 (par partie) : ${s.deals.hostileOffers.toFixed(2)} OPA hostiles (${s.deals.hostileSucceeded.toFixed(2)} réussies), ${s.deals.competingOffers.toFixed(2)} offres concurrentes, ${s.deals.raises.toFixed(2)} surenchères, ${s.deals.withdrawals.toFixed(2)} retraits, ${s.deals.pills.toFixed(2)} pilules déclenchées, ${s.deals.mandatoryOffers.toFixed(2)} offres obligatoires, ${s.deals.declarations.toFixed(1)} déclarations de seuil, ${s.deals.campaigns.toFixed(2)} campagnes activistes`,
  ];
  return lines.join('\n');
}

/** Cross-sector balancing: one line per starting sector of the player (--sector all). */
export function formatCrossSector(rows: readonly { sector: string; summary: Summary }[]): string {
  const sectors = [...new Set(rows.flatMap((r) => Object.keys(r.summary.bySector)))].sort();
  const lines = [
    'Équilibrage croisé (une campagne par secteur de départ du joueur) :',
    `  ${'départ'.padEnd(9)} ${'faill. IA'.padStart(9)} ${'marge'.padStart(7)} ${'joueur 1er'.padStart(10)} ${'rang'.padStart(5)} ${'en tête'.padStart(8)}  ${sectors.map((s) => `part max ${s} (méd., > 60 %)`).join('  ')}`,
    ...rows.map(({ sector, summary: s }) =>
      [
        `  ${sector.padEnd(9)}`,
        pct(s.aiBankruptcyRate).padStart(9),
        pct(s.medianNetMargin).padStart(7),
        `${s.playerFirst}/${s.games}`.padStart(10),
        String(s.medianPlayerRank).padStart(5),
        `${s.playerLeads}/${s.games}`.padStart(8),
        ' ' +
          sectors
            .map((x) => {
              const v = s.bySector[x];
              return v
                ? `${pct(v.maxMarketShare)} (${pct(v.medianMaxMarketShare)}, ${v.gamesAbove60})`.padEnd(
                    `part max ${x} (méd., > 60 %)`.length,
                  )
                : '—';
            })
            .join('  '),
      ]
        .join(' ')
        .trimEnd(),
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

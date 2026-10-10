# Architecture technique

> Phase 0, document de référence. Les mécaniques de jeu (formules, secteurs,
> bourse) sont détaillées dans [`GAME_DESIGN.md`](./GAME_DESIGN.md), le
> découpage et les niveaux d'effort dans [`PLAN.md`](./PLAN.md).

## 1. Décisions validées

| Sujet | Choix |
|---|---|
| Stack | TypeScript partout. Moteur en TS pur, UI React + Vite, aucun serveur |
| Tour | 1 tour = 1 trimestre (T1 à T4, saisons natives). Partie standard : 40 tours (10 ans), bac à sable illimité |
| Secteur MVP | Industrie manufacturière (électroménager) |
| Finance | Niveau intermédiaire (compte de résultat, flux de trésorerie, bilan simplifié, dette, impôt) **+ bourse simulée** (cotation, indice, ordres, OPA) |

### Hypothèses par défaut (modifiables sans impact d'architecture)

- UI en français, code et identifiants en anglais.
- Un pays fictif, 4 régions (Capitale, Nord, Ouest, Sud), une monnaie (€).
- Marché du travail **régional**, marchés de produits **nationaux** (la région
  joue sur les coûts logistiques). On simplifie volontairement.
- 3 concurrents IA par secteur au MVP (configurable de 3 à 6).
- Solo, desktop d'abord. L'UI reste utilisable en tablette mais n'est pas
  optimisée pour mobile.

## 2. Stack

| Couche | Outil | Raison |
|---|---|---|
| Langage | TypeScript 5 (strict), Node 22 | Un seul langage pour le moteur, l'UI et les outils |
| Monorepo | npm workspaces | Natif, pas d'outil supplémentaire |
| Moteur | TS pur, **zéro dépendance DOM** | Testable et exécutable en CLI, dans un worker ou dans le navigateur |
| Validation | `zod` | Schéma de la config et des sauvegardes, avec des erreurs lisibles |
| Tests | `vitest` + `fast-check` (property-based) | Rapides ; les invariants des marchés se prêtent bien aux tests de propriétés |
| UI | React 18 + Vite | Standard et rapide à itérer |
| État UI | `zustand` | Léger, sans boilerplate |
| Graphiques | `recharts` | Suffisant pour les séries temporelles et les parts de marché |
| Style | Tailwind CSS | Pas de CSS à maintenir, cohérent |
| Persistance | IndexedDB (`idb-keyval`) + export/import JSON | Slots de sauvegarde, autosave, partage de fichier |
| Qualité | ESLint + Prettier, CI GitHub Actions (lint, typecheck, test) | |

Pas de backend : la résolution d'un tour (~20 entreprises, ~40 bassins
d'emploi, ~10 matières premières) prend moins de 50 ms. Si elle devenait
lente, le moteur passerait dans un Web Worker sans changer son API.

## 3. Structure des dossiers

```
GAME1/
├─ CLAUDE.md                      # conventions + pointeurs, lu à chaque session
├─ package.json                   # workspaces + scripts racine (test, dev, sim, lint)
├─ tsconfig.base.json
├─ docs/
│  ├─ ARCHITECTURE.md             # ce document
│  ├─ GAME_DESIGN.md              # mécaniques, formules, secteurs, bourse
│  └─ PLAN.md                     # phases, lots, critères d'acceptation, effort
├─ packages/
│  ├─ engine/                     # @game/engine : TOUTE la logique de jeu
│  │  ├─ src/
│  │  │  ├─ index.ts              # API publique (cf. §6), rien d'autre n'est exporté
│  │  │  ├─ config/
│  │  │  │  ├─ schema.ts          # schéma zod + type GameConfig
│  │  │  │  ├─ default.ts         # ★ tous les paramètres d'équilibrage
│  │  │  │  └─ presets/           # difficultés et scénarios (DeepPartial<GameConfig>)
│  │  │  ├─ model/                # types purs, sans logique
│  │  │  │  ├─ ids.ts  state.ts  company.ts  markets.ts
│  │  │  │  ├─ finance.ts  stock.ts  decisions.ts  events.ts
│  │  │  ├─ core/
│  │  │  │  ├─ rng.ts             # PRNG seedé (sfc32), état sérialisable
│  │  │  │  ├─ pipeline.ts        # ordre des systèmes, resolveTurn
│  │  │  │  ├─ context.ts         # TurnContext (draft, config, rng, log)
│  │  │  │  ├─ modifiers.ts       # effets temporaires génériques (événements, synergies)
│  │  │  │  ├─ group.ts  synergies.ts  # groupes : prêts, parts économiques ; profil de synergies (lot 3.2)
│  │  │  │  ├─ control.ts  disclosure.ts  # contrôle lu du registre ; seuils déclaratifs par groupe (lot 3.3)
│  │  │  │  └─ math.ts            # clamp, logit, lissage, utilitaires financiers
│  │  │  ├─ systems/              # un dossier par système, chacun testable seul
│  │  │  │  ├─ macro/  labor/  commodities/  production/  products/
│  │  │  │  ├─ rnd/  accounting/  finance/  stockmarket/  mna/
│  │  │  │  └─ conglomerate/  events/  victory/
│  │  │  ├─ sectors/              # implémentations de SectorModule
│  │  │  │  ├─ types.ts           # interface SectorModule
│  │  │  │  ├─ industry/  agri/  tech/
│  │  │  ├─ ai/
│  │  │  │  ├─ observation.ts     # vue filtrée de l'état (anti-triche)
│  │  │  │  ├─ planner.ts         # orchestre les modules → CompanyDecisions
│  │  │  │  ├─ modules/           # forecast, pricing, hiring, purchasing, capex, finance, mna
│  │  │  │  └─ profiles.ts        # lecture des profils depuis la config
│  │  │  ├─ scenario/             # génération du monde initial (seed, options)
│  │  │  ├─ views/                # PlayerView, rapports de tour, KPI, preview
│  │  │  └─ persistence/          # serialize/deserialize, migrations/
│  │  └─ test/
│  │     ├─ systems/              # unitaires par système
│  │     ├─ invariants/           # property-based (conservation, comptabilité)
│  │     └─ golden/               # snapshot d'une partie seedée de 8 tours
│  ├─ web/                        # @game/web : UI React, ne contient AUCUNE règle de jeu
│  │  └─ src/
│  │     ├─ app/                  # routing, layout, thème
│  │     ├─ store/                # zustand : partie courante + brouillon de décisions
│  │     ├─ screens/              # Dashboard, Decisions, Markets, Competitors, Bourse, Deals, Group, TurnReport, Saves
│  │     ├─ components/           # KPI tiles, tables, formulaires, alertes
│  │     ├─ charts/
│  │     ├─ persistence/          # IndexedDB, export/import
│  │     └─ i18n/fr.ts            # tous les libellés
│  └─ sim-cli/                    # @game/sim : parties IA-only en lot, pour l'équilibrage
│     └─ src/ (run.ts, metrics.ts, report.ts)  → CSV/JSON de statistiques
└─ .github/workflows/ci.yml
```

Règle de dépendance : `web → engine` et `sim-cli → engine`. Le moteur
n'importe jamais rien de `web`.

## 4. Principes du moteur

1. **Pureté à la frontière.** `resolveTurn(state, playerDecisions)` renvoie
   un nouvel état et un rapport, sans effet de bord. En interne, on clone
   (`structuredClone`) puis chaque système mute le brouillon : c'est simple et
   rapide.
2. **Déterminisme.** Tout l'aléa passe par `ctx.rng`, dont l'état est stocké
   dans `GameState`. `Math.random` et `Date` sont interdits dans `engine`
   (règle ESLint). Même seed + mêmes décisions = même partie : les replays,
   les tests golden et les rapports de bug en dépendent.
3. **Résolution simultanée.** Les décisions de l'IA sont calculées à partir
   de l'état de début de tour, comme celles du joueur, puis tout est résolu
   ensemble.
4. **Pas de triche de l'IA, garantie par construction.** Le planner IA reçoit
   uniquement `Observation` (produit par `ai/observation.ts`), du même type que
   ce que voit le joueur pour ses concurrents. Il n'a pas accès à `GameState`.
   Ses décisions passent par la même validation que celles du joueur
   (budget, effectifs disponibles, stocks).
5. **Aucun nombre magique.** Chaque coefficient vient de `config`. La config
   effective est copiée dans la sauvegarde pour que celle-ci reste
   reproductible après un rééquilibrage.
6. **État sérialisable.** Uniquement des objets simples et des `Record<Id, T>`
   (pas de classes, pas de `Map`), donc `JSON.stringify` suffit.
7. **Extensibilité par secteur.** Un secteur est un `SectorModule` enregistré
   dans un registre. Les systèmes génériques (travail, matières premières,
   produits, comptabilité) délèguent au secteur ce qui lui est propre.

## 5. Modèle de données (extraits normatifs)

```ts
// ---- ids & temps -------------------------------------------------------
type Id = string;                 // "co_003", "reg_nord", "occ_operator"
type Money = number;              // euros (float ; arrondi à l'affichage)
type Quarter = number;            // 0 = T1 an 1 ; saison = q % 4

// ---- racine ------------------------------------------------------------
interface GameState {
  meta: {
    schemaVersion: number; seed: number; rng: RngState;
    turn: Quarter; mode: GameMode; status: 'running' | 'won' | 'lost';
    playerActorId: Id;           // sim-cli : joueur en pilote automatique (profil IA ou passif), mode 'sandbox' (pas de 'lost')
  };
  config: GameConfig;                              // config effective figée
  macro: MacroState;                               // cycle, inflation, taux directeur
  regions: Record<Id, Region>;
  labor: Record<LaborPoolKey, LaborPool>;          // clé `${regionId}:${occupationId}`
  commodities: Record<Id, CommodityMarket>;
  productMarkets: Record<Id, ProductMarket>;
  actors: Record<Id, Actor>;                       // joueur + dirigeants IA
  companies: Record<Id, Company>;
  stock: StockMarketState;                         // cotations, registre des actionnaires, ordres, OPA
  modifiers: Modifier[];                           // effets temporaires actifs
  pendingEvents: ScheduledEffect[];
  aiMemory: Record<Id, AiMemory>;                  // par acteur IA
  log: GameEvent[];                                // journal (borné)
  history: HistoryStore;                           // séries compactes pour les graphes
}

// ---- acteurs & entreprises ---------------------------------------------
interface Actor {
  id: Id; kind: 'player' | 'ai' | 'fund'; name: string;   // fund : fonds activiste optionnel (lot 3.3)
  profileId?: AiProfileId;                         // low_cost | premium | innovator | opportunist | conglomerate
  rootCompanyId: Id;                               // société de tête (simple société, puis holding)
}

interface Company {
  id: Id; name: string;
  sector: SectorId | 'holding';
  hqRegionId: Id;
  status: 'active' | 'distressed' | 'bankrupt' | 'absorbed';
  listed: boolean; sharesOutstanding: number;
  // contrôle : déduit du registre des actionnaires (stock.registry), jamais stocké en double
  sites: Record<Id, Site>;                         // usines, fermes, bureaux (actifs, capacité, âge, VNC)
  workforce: Record<StaffKey, Staff>;              // clé `${regionId}:${occupationId}`
  inventory: Record<ItemId, StockLot>;             // matières et produits finis {qty, avgCost}
  contracts: SupplyContract[];                     // contrats d'approvisionnement long terme
  productLines: Record<Id, ProductLine>;           // {marketId, quality, price, techLevel?, users?}
  brand: number;                                   // réputation client 0..100
  employerBrand: number;                           // attractivité employeur 0..100
  rnd: RndProject[];
  loans: Loan[];                                   // kind 'term' | 'overdraft' | 'group' (prêt intra-groupe, lenderId)
  books: Books;                                    // comptes du trimestre + historique (cf. finance.ts)
  participations: Record<Id, { shares; cost }>;    // titres de sociétés du groupe, au coût (dépréciés)
  stakeValues: Record<Id, Money>;                  // valeur comptable de chaque participation (Σ = financialAssets)
  sectorState?: unknown;                           // état spécifique, typé par le SectorModule
}

interface Staff {
  headcount: number; wage: Money;                  // salaire trimestriel moyen
  rampingUp: number;                               // nouvelles recrues (productivité réduite)
  inTraining: { toOccupationId: Id; count: number; doneAt: Quarter }[];
}

// ---- marchés -----------------------------------------------------------
interface LaborPool {
  regionId: Id; occupationId: Id;
  laborForce: number;                              // population active du métier
  outsideEmployment: number;                       // emploi dans l'économie non simulée
  marketWage: Money; tension: number;              // offres / chômeurs
  // chômeurs = laborForce - outsideEmployment - Σ effectifs des entreprises (invariant testé)
}

interface CommodityMarket {
  id: Id; unit: string;
  worldPrice: Money;                               // processus exogène (retour à la moyenne + chocs)
  spotPrice: Money;                                // prix de compensation du tour
  lastSimDemand: number;                           // demande agrégée des entreprises simulées
}

interface ProductMarket {
  id: Id; sectorId: SectorId;
  baseVolume: number; refPrice: Money;
  segments: ConsumerSegment[];                     // ex. sensibles au prix / à la qualité
  lastResult: { shares: Record<Id, number>; volume: number; avgPrice: Money };
}

// ---- finance & bourse --------------------------------------------------
interface Books {
  current: Statements; history: Statements[];      // un élément par trimestre
  consolidated?: ConsolidatedStatements[];         // têtes de groupe avec filiale (lot 3.1)
}
interface Statements {
  pnl: { revenue; cogs; wages; marketing; rnd; storage; other; ebitda;
         depreciation; ebit; interest; financial; groupFinancial; tax; netIncome };  // Money
  cashFlow: { operating; investing; financing; netChange; groupInvesting };
  balance: { cash; inventory; fixedAssets; financialAssets; groupLoans;
             debt; equity; minorityInterests };                    // actif = passif (invariant)
}
interface ConsolidatedStatements extends Statements {             // intégration globale
  members: Record<Id, { share; revenue; ebitda; netIncome }>;      // part économique, contribution
  minorityNetIncome: Money;                                        // inclus dans pnl.netIncome
  eliminations: { loans; stakes; financial; flows };               // flux intra-groupe retirés
}

interface StockMarketState {
  quotes: Record<Id, Quote>;                       // cours, historique, cours de référence
  index: { value: number; history: number[] };
  registry: Record<Id, Record<HolderId, number>>;  // société → (détenteur → nb d'actions) ; HolderId = Id société | Id acteur | 'public'
                                                   // l'acteur détient en direct sa société de tête (score = cours × ces actions)
  orders: StockOrder[];                            // ordres du tour (exécutés en fin de tour)
  tenderOffers: TenderOffer[];                     // OPA en cours (hostiles, concurrentes) et récentes
  declared: Record<Id, Record<HolderId, number>>;  // seuil déclaré par société cotée et groupe détenteur
  campaigns: ActivistCampaign[];                   // campagnes du fonds activiste (dividende ou vente)
}

// ---- décisions (identiques pour joueur et IA) --------------------------
interface CompanyDecisions {
  companyId: Id;
  pricing: Record<Id, { price: Money }>;                         // par ligne de produit
  production: Record<Id, { targetOutput: number }>;              // par site
  hr: { regionId: Id; occupationId: Id; hire: number; fire: number;
        wageOffer: Money; train?: { toOccupationId: Id; count: number } }[];
  purchasing: {
    spot: { commodityId: Id; qty: number; limitPrice?: Money }[];
    newContracts: { commodityId: Id; qtyPerQuarter: number; quarters: number }[];
  };
  capex: CapexOrder[];                              // construire/agrandir/moderniser/vendre un site
  marketing: Record<Id, Money>;
  rnd: { projectId?: Id; type: RndType; budget: Money }[];
  finance: { borrow?: Money; repay?: Money; dividend?: Money;
             issueShares?: number; buyback?: number; ipo?: boolean };
  stockOrders: { targetId: Id; side: 'buy' | 'sell'; shares: number; limitPrice?: Money }[];
  mna: MnaAction[];                                 // audit, OPA (amicale, hostile, concurrente), bloc, pépite ;
                                                    // surenchère, retrait, apport de ses titres (lot 3.3)
  intraGroup?: IntraGroupTransfer[];                // dividende remonté, prêt, cash pooling, cession de titres (fin de trimestre)
  createHolding?: boolean;                          // société de tête seulement : holding créée au-dessus
}
```

Le contrôle d'une société se lit dans `stock.registry` : une société A
contrôle B si A détient plus de 50 % de B, directement ou par une chaîne de
contrôle. Le joueur dirige la société de tête de son acteur et tout ce
qu'elle contrôle. Au MVP, c'est une société seule ; la holding n'est qu'un
`Company` de secteur `holding` posé au-dessus (lot 3.1 : l'acteur lui apporte
ses actions et elle devient sa société de tête). La bourse et les rachats
n'ont donc pas besoin d'un modèle de données différent.

## 6. API publique du moteur (`packages/engine/src/index.ts`)

```ts
createGame(opts: NewGameOptions, overrides?: DeepPartial<GameConfig>): GameState
resolveTurn(state: GameState, player: CompanyDecisions[]): { state: GameState; report: TurnReport }
getPlayerView(state: GameState): PlayerView           // ce que l'UI affiche (visibilité partielle)
validateDecisions(state: GameState, d: CompanyDecisions[]): ValidationIssue[]
previewDecisions(state: GameState, d: CompanyDecisions[]): DecisionPreview  // estimations sans aléa
defaultDecisions(state: GameState, companyId: Id): CompanyDecisions          // « reconduire le tour précédent »
serializeGame(state): SaveFile ; deserializeGame(file): GameState   // + migrations
```

`resolveTurn` appelle en interne le planner IA pour chaque acteur IA. L'UI
ne connaît donc que le joueur. Pour `sim-cli`, `NewGameOptions.playerProfileId`
met la société du joueur en pilote automatique : le planner la joue dès
qu'aucune décision n'est soumise pour elle. L'étape 0 est le système
`systems/ai`, qui appelle `ai/observation.ts` puis `ai/planner.ts`.

## 7. Pipeline de résolution d'un tour

Ordre fixe, défini dans `core/pipeline.ts`. Chaque étape est une fonction
`(ctx: TurnContext) => void`.

| # | Système | Rôle |
|---|---|---|
| 0 | `ai` | Chaque acteur IA reçoit `Observation(S_t)` et produit ses `CompanyDecisions` |
| 1 | `validation` | Borne et normalise toutes les décisions (budget, crédit, stocks, effectifs) |
| 2 | `macro` + `events` + `weather` | Avance le cycle, l'inflation et le taux directeur ; tire les événements ; applique ou expire les modificateurs ; tire la météo de chaque région (rendements agricoles) |
| 3 | `finance (pré)` + `mna (pré)` | Emprunts, remboursements, dividendes, augmentations de capital, rachats d'actions, introductions en bourse ; audits d'acquisition commandés, coûts d'intégration |
| 4 | `capex` | Avancement des chantiers, mise en service, cessions d'actifs |
| 5 | `labor` | Licenciements → appariement des embauches → attrition → formation → mise à jour des salaires de marché |
| 6 | `commodities` | Livraisons des contrats → compensation du spot (prix fonction de la demande agrégée) → stocks |
| 7 | `production` | Capacité (machines × main-d'œuvre × matières) → production → qualité (délégué au SectorModule ; tech : qualité selon seniors et maintenance) |
| 8 | `products` + `perishability` | Référencement (agro) → demande totale → parts de marché (logit) → ventes limitées par les stocks → report de la demande insatisfaite → marque ; puis pertes des stocks périssables. Tech : nouveaux abonnés (logit) → churn → abonnés facturés → cloud consommé |
| 9 | `rnd` | Avance la frontière technologique (tech) ; avancement des projets (budget, ou développeurs en tech), niveau technologique, obsolescence |
| 10 | `conglomeratePre` + `accounting` | Groupes du début de trimestre (lot 3.2) : fonctions support partagées (salaires réduits) et frais de holding (répartis selon le CA du trimestre) passés au journal ; puis compte de résultat, impôt, intérêts, amortissements, stockage → trésorerie → bilan ; contrôle de solvabilité |
| 11 | `stockmarket` | Valeur fondamentale (sur les comptes publiés) → cours (avec impact des ordres) → exécution des ordres → registre → indice → juste valeur des actifs financiers. Les achats/ventes d'actions et la réévaluation sont **passés dans les états du trimestre** clos à l'étape 10 (trésorerie, actifs financiers, flux d'investissement, résultat financier) |
| 12 | `mna` / `conglomerate` | Rachats conclus (pépites, blocs avec offre obligatoire, OPA amicales), OPA hostiles ouvertes, retraits, surenchères et offres concurrentes, clôture des OPA en cours (pilule empoisonnée, lot 3.3), changements de contrôle, réévaluation des participations, déclarations de franchissement de seuil, campagnes activistes, sociétés mises en vente ; puis prêts intra-groupe d'une société disparue passés en perte, création des holdings, transferts intra-groupe (cessions de titres, dividendes remontés, prêts, cash pooling), réévaluation, comptes consolidés de chaque tête de groupe (lot 3.1) ; enfin malus des groupes en surcharge managériale pour le trimestre suivant (modificateurs, lot 3.2). Comme l'étape 11, écrit ses mouvements dans les états du trimestre ; les invariants comptables sont vérifiés après l'étape 13 |
| 13 | `victory` + `reporting` | KPI, historique, journal, rapport de tour, conditions de fin |

## 8. Configuration et équilibrage

- `config/default.ts` est un objet TypeScript commenté, validé au démarrage
  par `config/schema.ts`. Ses sections : `time`, `macro`, `regions`,
  `labor`, `commodities`, `products`, `sectors.{industry,agri,tech}`,
  `finance`, `stockMarket`, `mna`, `conglomerate`, `ai.profiles`, `events`,
  `victory`.
- Les difficultés et scénarios sont des `DeepPartial<GameConfig>` dans
  `presets/`. En mode bac à sable, l'UI permet d'importer un JSON d'overrides.
- Les événements sont **décrits en données** (probabilité, conditions,
  cibles, modificateurs, durée) et non codés un par un. Ajouter une grève ou
  une crise énergétique revient à ajouter une entrée de config.
- `sim-cli` joue N parties IA-only (`npm run sim -- --games 200 --turns 40
  --preset normal`) et produit des statistiques : taux de faillite, marges
  par secteur, dérive des salaires, volatilité des prix, concentration (HHI),
  écart-type des cours. C'est le banc d'équilibrage principal, qui ne
  nécessite ni UI ni tokens.

## 9. Sauvegarde et chargement

- Le format est `SaveFile = { schemaVersion, engineVersion, savedAt: string | null, state }`
  (`savedAt` est fourni par l'appelant via `serializeGame(state, { savedAt })` :
  le moteur n'utilise jamais `Date`)
  (l'état contient déjà la config et l'état du RNG).
- Dans le navigateur : IndexedDB avec plusieurs slots, autosave à chaque fin
  de tour (rotation sur les 3 derniers) et export/import d'un fichier
  `.json`.
- `persistence/migrations/` contient une fonction par incrément de
  `schemaVersion`, et des tests chargent des sauvegardes d'anciennes
  versions.

## 10. Stratégie de tests (moteur d'abord)

| Niveau | Exemples |
|---|---|
| Unitaires par système | Les salaires montent quand la tension dépasse la cible ; le prix spot croît avec la demande agrégée ; les parts logit somment à 1 et baissent quand le prix monte ; l'attrition augmente sous le salaire de marché |
| Invariants (fast-check) | Conservation de la main-d'œuvre (aucun effectif négatif, embauches ≤ chômeurs) ; jamais de stock négatif ; **actif = passif** à chaque tour, pour chaque société et pour les comptes consolidés (avec les intérêts minoritaires) ; variation de trésorerie = flux opérationnels + investissement + financement ; prêts intra-groupe accordés = dettes intra-groupe des emprunteurs ; actifs financiers = Σ valeurs des participations ; actions en circulation = Σ registre ; pas de NaN ni d'Infinity |
| Anti-triche | Le planner IA ne reçoit qu'une `Observation`, ce qui est vérifié au niveau des types et par un test sur les champs exposés |
| Déterminisme | Deux exécutions avec la même seed et les mêmes décisions produisent le même hash d'état |
| Golden | Snapshot d'une partie seedée de 8 tours ; toute dérive d'équilibrage est visible dans la revue |
| Sérialisation | `deserialize(serialize(s))` équivaut à `s` ; migrations |
| Smoke (sim-cli) | 50 parties × 40 tours sans exception, avec des bornes de sanité sur les prix et les salaires |
| UI | Tests de composants minimaux ; un scénario Playwright « jouer 3 tours » en phase 3 |

## 11. UI : écrans et principes

Écrans : **Tableau de bord** (KPI avec tendance, alertes), **Décisions**
(onglets Production & prix, RH, Achats, Investissements, Marketing & R&D,
Finance & bourse), **Marchés** (travail par région et métier, matières
premières, produits), **Concurrents** (vue partielle), **Bourse** (cotes,
indice, portefeuille, ordres ; lot 3.3 : franchissements de seuil, campagnes activistes), **Rachats & OPA** (pépites et concurrents,
valorisation, audits, rachat de bloc, OPA amicale, financement ; lot 3.3 : OPA hostile, offres en cours, surenchère, retrait, apport de ses titres), **Groupe**
(phase 2 : filiales et qui les dirige ; lot 3.1 : holding, flux intra-groupe, comptes consolidés et reporting par filiale ; lot 3.2 : synergies et coûts de la complexité), **Rapport de tour** (récit de ce qui s'est passé, événements,
écarts entre prévu et réalisé), **Sauvegardes**.

Pour suivre beaucoup d'indicateurs sans noyer le joueur :

- **Divulgation progressive** : 6 KPI par défaut, détails au clic.
- **Alertes** générées par le moteur (stock de matière < 1 trimestre,
  salaire sous le marché, covenant bancaire proche) plutôt que des tableaux
  à scruter.
- **Décisions par défaut** : chaque tour reprend celles du précédent, et le
  joueur ne modifie que ce qui compte.
- **Aperçu** (`previewDecisions`) : coût, trésorerie fin de tour estimée et
  capacité, affichés avant de valider.

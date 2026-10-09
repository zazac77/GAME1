// Every French label of the UI. The engine only emits ids, kinds and codes.
import type {
  Alert,
  AlertKind,
  GameEvent,
  ModifierKey,
  RndType,
  ValidationIssue,
  ValidationIssueCode,
} from '@game/engine';
import { fmtDec, fmtInt, fmtMoney, fmtPct, fmtPrice } from './format';

export const fr = {
  app: {
    title: 'GAME1',
    subtitle: 'Jeu de gestion d’entreprise',
    endTurn: 'Fin du trimestre',
    resolving: 'Résolution…',
    quarter: 'Trimestre',
    cash: 'Trésorerie',
    score: 'Score',
    quit: 'Menu principal',
    gameLost: 'Partie perdue : votre société a fait faillite.',
    gameOver: (turns: number) =>
      `Partie standard terminée (${turns} trimestres). Vous pouvez continuer à jouer ou sauvegarder.`,
    loading: 'Chargement…',
  },
  nav: {
    dashboard: 'Tableau de bord',
    decisions: 'Décisions',
    markets: 'Marchés',
    competitors: 'Concurrents',
    bourse: 'Bourse',
    report: 'Rapport de tour',
    saves: 'Sauvegardes',
  },
  start: {
    heading: 'Nouvelle partie',
    playerName: 'Votre nom',
    companyName: 'Nom de la société',
    seed: 'Graine (partie rejouable à l’identique)',
    mode: 'Mode',
    modes: { standard: 'Standard (40 trimestres)', sandbox: 'Bac à sable' },
    randomSeed: 'Au hasard',
    create: 'Créer la partie',
    continue: 'Reprendre',
    load: 'Charger une sauvegarde',
    import: 'Importer un fichier .json',
    defaultPlayer: 'Camille Durand',
    defaultCompany: 'Durand Électroménager',
    noSaves: 'Aucune sauvegarde pour l’instant.',
  },
  dashboard: {
    kpis: 'Indicateurs clés',
    revenue: 'Chiffre d’affaires',
    netIncome: 'Résultat net',
    marketShare: 'Part de marché',
    sharePrice: 'Cours de l’action',
    score: 'Valeur de votre participation',
    details: 'Détails',
    hideDetails: 'Masquer les détails',
    alerts: 'Alertes',
    noAlerts: 'Aucune alerte : tout est sous contrôle.',
    news: 'Actualité en cours',
    noNews: 'Aucun événement en cours.',
    charts: 'Évolution',
    journal: 'Journal récent',
    trend: 'vs trimestre précédent',
    macro: 'Conjoncture',
    regime: { expansion: 'Expansion', recession: 'Récession' },
    gdp: 'Croissance (annualisée)',
    inflation: 'Inflation (annualisée)',
    policyRate: 'Taux directeur',
    demandIndex: 'Indice de demande',
    operations: 'Exploitation',
    capacity: 'Capacité de production',
    staff: 'Effectifs',
    brand: 'Marque',
    employerBrand: 'Marque employeur',
    quality: 'Qualité',
    rating: 'Notation',
  },
  decisions: {
    tabs: {
      production: 'Production & prix',
      hr: 'RH',
      purchasing: 'Achats',
      capex: 'Investissements',
      marketing: 'Marketing & R&D',
      finance: 'Finance & bourse',
    },
    reset: 'Reprendre les décisions par défaut',
    resetHint:
      'Les décisions reprennent celles du trimestre précédent ; ne modifiez que ce qui compte.',
    fullCapacity: 'pleine capacité',
    // Production & pricing
    product: 'Produit',
    price: 'Prix de vente',
    refPrice: 'Prix de référence',
    marketAvg: 'Prix moyen du marché',
    quality: 'Qualité actuelle',
    qualityTarget: 'Qualité visée',
    qualityHint: 'Une qualité visée au-dessus de 50 consomme plus de matières.',
    stock: 'Stock de produits finis',
    sites: 'Usines',
    site: 'Usine',
    targetOutput: 'Objectif de production',
    ceiling: 'Plafond (effectifs et lignes)',
    capacity: 'Capacité des lignes',
    // HR
    group: 'Métier',
    region: 'Région',
    headcount: 'Effectif',
    wage: 'Salaire actuel',
    marketWage: 'Salaire du marché',
    wageVsMarket: 'Salaire / marché',
    unemployed: 'Chômeurs',
    hire: 'Embauches',
    fire: 'Licenciements',
    fireShort: 'Licenc.',
    wageOffer: 'Salaire proposé',
    train: 'Formation vers',
    trainCount: 'Nb formés',
    none: 'Aucune',
    addGroup: 'Ajouter un métier',
    add: 'Ajouter',
    productivity: 'Productivité par opérateur',
    // Purchasing
    commodity: 'Matière',
    inStock: 'En stock',
    need: 'Besoin du trimestre',
    contracted: 'Sous contrat',
    spotPrice: 'Prix spot',
    worldPrice: 'Prix mondial',
    spotQty: 'Achat spot',
    limitPrice: 'Prix limite',
    newContract: 'Nouveau contrat',
    qtyPerQuarter: 'Qté / trimestre',
    quarters: 'Durée (trim.)',
    contracts: 'Contrats en cours',
    contractPrice: 'Prix fixé',
    contractEnd: 'Fin',
    nonStorable: 'non stockable : acheté à la consommation',
    noContracts: 'Aucun contrat.',
    // Capex
    orders: 'Ordres du trimestre',
    noOrders: 'Aucun investissement ce trimestre.',
    buildSite: 'Construire une usine',
    buyFarm: 'Acheter une exploitation agricole',
    addLine: 'Ajouter une ligne',
    modernizeLine: 'Moderniser',
    sellLine: 'Vendre la ligne',
    sellSite: 'Vendre l’usine',
    cancel: 'Annuler',
    line: 'Ligne',
    status: 'État',
    age: 'Âge (trim.)',
    techLevel: 'Niveau techno',
    bookValue: 'Valeur nette',
    cost: 'Coût',
    proceeds: 'Cession',
    modernizeCost: (cost: string) => `Modernisation d’une ligne : ${cost}.`,
    // Marketing & R&D
    marketingBudget: 'Budget marketing',
    brand: 'Marque',
    rnd: 'Recherche & développement',
    rndLevel: 'Niveau',
    rndProject: 'Projet en cours',
    rndNoProject: 'Aucun projet : un budget en lance un.',
    rndProgress: 'Avancement',
    rndCost: 'Coût du projet',
    rndBudget: 'Budget du trimestre',
    rndMax: 'max',
    rndMaxed: 'Niveau maximal atteint.',
    // Finance
    debt: 'Dette',
    loans: 'Emprunts',
    noLoans: 'Aucun emprunt.',
    principal: 'Capital restant',
    spread: 'Marge',
    maturity: 'Échéance',
    borrowingCapacity: 'Capacité d’emprunt',
    borrow: 'Emprunter',
    repay: 'Rembourser',
    rating: 'Notation',
    covenant: 'Covenant bancaire',
    covenantOk: 'respecté',
    covenantBreached: 'rompu',
    stockOrders: 'Ordres de bourse',
    shares: 'Actions',
    held: 'Détenues',
    side: 'Sens',
    buy: 'Achat',
    sell: 'Vente',
    // Preview
    preview: 'Aperçu du trimestre (estimation)',
    outputCeiling: 'Plafond de production',
    plannedOutput: 'Production prévue',
    expectedDemand: 'Demande attendue',
    expectedSold: 'Ventes attendues',
    expectedRevenue: 'CA attendu',
    expectedEbitda: 'EBITDA attendu',
    expectedCash: 'Trésorerie fin de trimestre',
    overdraftRisk: 'Risque de découvert !',
    capexTotal: 'Investissements',
    disposals: 'Cessions',
    borrowing: 'Emprunt',
    repayment: 'Remboursement',
    installments: 'Échéances',
    costs: 'Charges estimées',
    issues: 'Ajustements de la validation',
    noIssues: 'Décisions valides.',
  },
  costs: {
    materials: 'Matières',
    wages: 'Salaires',
    hiring: 'Recrutement',
    severance: 'Indemnités',
    training: 'Formation',
    marketing: 'Marketing',
    rnd: 'R&D',
    maintenance: 'Maintenance',
    logistics: 'Logistique',
    storage: 'Stockage',
    interest: 'Intérêts',
  } satisfies Record<string, string>,
  markets: {
    labor: 'Marché du travail',
    commodities: 'Matières premières',
    products: 'Marché des produits',
    allRegions: 'Toutes les régions',
    tension: 'Tension',
    laborForce: 'Population active',
    unemployed: 'Chômeurs',
    marketWage: 'Salaire trimestriel',
    unit: 'Unité',
    spot: 'Prix spot',
    world: 'Prix mondial',
    demand: 'Demande simulée',
    volume: 'Volume vendu',
    avgPrice: 'Prix moyen',
    shares: 'Parts de marché',
    outside: 'Hors simulation',
    refPrice: 'Prix de référence',
    segments: 'Segments de clientèle',
    weight: 'Poids',
    history: 'Historique',
    spotIndex: 'Prix spot (base 100 au départ)',
  },
  competitors: {
    heading: 'Concurrents',
    ceo: 'Dirigeant',
    hq: 'Siège',
    price: 'Prix',
    quality: 'Qualité',
    share: 'Part',
    stockout: 'Rupture',
    brand: 'Marque',
    rating: 'Notation',
    sites: 'Usines',
    lines: 'lignes',
    published: 'Comptes publiés',
    noPublished: 'Pas encore de comptes publiés.',
    revenue: 'CA',
    ebitda: 'EBITDA',
    netIncome: 'Résultat net',
    cash: 'Trésorerie',
    debt: 'Dette',
    equity: 'Fonds propres',
    sharePrice: 'Cours',
    partialView: 'Vue partielle : seuls les faits publics et les comptes publiés sont visibles.',
    yes: 'oui',
    no: 'non',
  },
  bourse: {
    index: 'Indice',
    quotes: 'Cotations',
    company: 'Société',
    price: 'Cours',
    change: 'Var. trim.',
    fundamental: 'Valeur fondamentale',
    capitalization: 'Capitalisation',
    float: 'Flottant',
    holdings: 'Votre portefeuille',
    noHoldings: 'Aucune participation.',
    value: 'Valeur',
    you: '(vous)',
    order: 'Passer un ordre',
    orderHint:
      'Les ordres sont exécutés en fin de trimestre, au nouveau cours. Liquidité limitée par trimestre ; participation minoritaire plafonnée.',
    ownStake: 'Votre participation dans votre société',
  },
  report: {
    heading: 'Rapport du trimestre',
    none: 'Aucun trimestre joué pour l’instant.',
    plannedVsActual: 'Prévu / réalisé',
    planned: 'Prévu',
    actual: 'Réalisé',
    revenue: 'Chiffre d’affaires',
    ebitda: 'EBITDA',
    netIncome: 'Résultat net',
    cash: 'Trésorerie fin',
    output: 'Production',
    demand: 'Demande',
    sold: 'Ventes',
    lostSales: 'Ventes perdues (rupture)',
    share: 'Part de marché',
    hires: 'Embauches (demandées → obtenues)',
    quits: 'Départs volontaires',
    dismissed: 'Licenciements',
    sharePrice: 'Cours de l’action',
    index: 'Indice',
    events: 'Événements',
    eventsConcerning: 'vous concerne',
    journal: 'Ce qui s’est passé',
    nextAlerts: 'Alertes pour le trimestre suivant',
    issues: 'Ajustements de vos décisions',
  },
  saves: {
    heading: 'Sauvegardes',
    slotName: 'Nom de la sauvegarde',
    save: 'Sauvegarder',
    load: 'Charger',
    delete: 'Supprimer',
    export: 'Exporter (.json)',
    exportCurrent: 'Exporter la partie en cours',
    import: 'Importer un fichier',
    slots: 'Sauvegardes manuelles',
    autosaves: 'Sauvegardes automatiques (3 derniers trimestres)',
    empty: 'Aucune.',
    savedAt: 'Enregistrée le',
    saved: 'Partie sauvegardée.',
    imported: 'Sauvegarde importée.',
    importError: 'Fichier invalide : ',
    storageError: 'Stockage du navigateur indisponible : ',
    confirmLoad: 'Charger cette sauvegarde ? La partie en cours non sauvegardée sera perdue.',
  },
  severity: { info: 'Info', warning: 'Attention', critical: 'Critique' },
  status: {
    active: 'Active',
    distressed: 'En difficulté',
    bankrupt: 'En faillite',
    absorbed: 'Absorbée',
    operational: 'En service',
    under_construction: 'En construction',
    modernizing: 'En modernisation',
  },
  regions: {
    reg_capitale: 'Capitale',
    reg_nord: 'Nord',
    reg_ouest: 'Ouest',
    reg_sud: 'Sud',
  } as Record<string, string>,
  occupations: {
    occ_operator: 'Opérateur de production',
    occ_technician: 'Technicien de maintenance',
    occ_engineer: 'Ingénieur méthodes/qualité',
    occ_sales: 'Commercial',
    occ_manager: 'Cadre',
    occ_farmhand: 'Ouvrier agricole',
    occ_food_operator: 'Opérateur agroalimentaire',
    occ_quality_tech: 'Technicien qualité',
    occ_agronomist: 'Agronome',
    occ_support: 'Support client',
    occ_developer: 'Développeur',
    occ_senior_engineer: 'Ingénieur senior / data',
    occ_product_manager: 'Product manager',
  } as Record<string, string>,
  commodities: {
    com_steel: 'Acier',
    com_polymers: 'Polymères',
    com_electronics: 'Composants électroniques',
    com_energy: 'Énergie',
    com_cereals: 'Céréales',
    com_oilseeds: 'Oléagineux',
    com_milk: 'Lait',
    com_packaging: 'Emballages',
    com_fertilizer: 'Engrais',
    com_cloud: 'Capacité cloud',
  } as Record<string, string>,
  productMarkets: {
    mkt_appliances: 'Électroménager',
    mkt_food: 'Produits alimentaires',
    mkt_software: 'Logiciels (SaaS)',
  } as Record<string, string>,
  sectors: {
    industry: 'Industrie',
    agri: 'Agroalimentaire',
    tech: 'Technologie',
    holding: 'Holding',
  } as Record<string, string>,
  segments: { price: 'Sensibles au prix', quality: 'Sensibles à la qualité' } as Record<
    string,
    string
  >,
  events: {
    ev_strike: 'Grève régionale',
    ev_energy_crisis: 'Crise énergétique',
    ev_component_shortage: 'Pénurie de composants',
    ev_rate_hike: 'Hausse surprise des taux',
    ev_recession: 'Choc récessif',
    ev_drought: 'Sécheresse',
    ev_disruptive_innovation: 'Innovation disruptive',
  } as Record<string, string>,
  modifierKeys: {
    'macro.gdpGrowth': 'croissance',
    'macro.inflation': 'inflation',
    'macro.policyRate': 'taux directeur',
    'macro.expansionToRecession': 'risque de récession',
    'labor.productivity': 'productivité',
    'labor.wageGrowth': 'hausse des salaires',
    'labor.attrition': 'départs volontaires',
    'commodity.price': 'prix',
    'commodity.supply': 'livraisons',
    'market.demand': 'demande',
    'agri.yield': 'rendement agricole',
    'tech.frontier': 'frontière technologique',
  } satisfies Record<ModifierKey, string>,
  rndTypes: {
    process: 'Procédés',
    product: 'Produit',
  } satisfies Record<RndType, string>,
  rndEffects: {
    process: 'Productivité des opérateurs et qualité atteignable.',
    product: 'Qualité atteignable du produit.',
  } satisfies Record<RndType, string>,
  profiles: {
    low_cost: 'Low-cost',
    premium: 'Premium',
    innovator: 'Innovateur',
    opportunist: 'Opportuniste',
    conglomerate: 'Conglomérat',
  } as Record<string, string>,
  issueCodes: {
    not_controlled: 'société non contrôlée',
    inactive_company: 'société inactive : décisions ignorées',
    unknown_id: 'élément inconnu ou indisponible',
    invalid_value: 'valeur invalide, ignorée',
    clamped: 'valeur ramenée dans ses bornes',
    duplicate: 'doublon ignoré',
    budget: 'réduit faute de liquidités',
    limit: 'limite atteinte : ordre refusé',
    invalid_state: 'impossible dans l’état actuel',
    not_available: 'pas encore disponible',
  } satisfies Record<ValidationIssueCode, string>,
};

const name = <T extends Record<string, string>>(table: T, id: string | undefined): string =>
  (id !== undefined ? table[id] : undefined) ?? id ?? '';

export const regionName = (id: string | undefined) => name(fr.regions, id);
export const occupationName = (id: string | undefined) => name(fr.occupations, id);
export const commodityName = (id: string | undefined) => name(fr.commodities, id);
export const marketName = (id: string | undefined) => name(fr.productMarkets, id);
export const eventName = (id: string | undefined) => name(fr.events, id);

const SECTIONS: Record<string, string> = {
  pricing: 'Prix',
  production: 'Production',
  hr: 'RH',
  purchasing: 'Achats',
  spot: 'spot',
  newContracts: 'contrat',
  capex: 'Investissement',
  marketing: 'Marketing',
  rnd: 'R&D',
  finance: 'Finance',
  stockOrders: 'Ordre de bourse',
  mna: 'Rachats',
  intraGroup: 'Intra-groupe',
  price: 'prix',
  qualityTarget: 'qualité visée',
  targetOutput: 'objectif',
  hire: 'embauches',
  fire: 'licenciements',
  wageOffer: 'salaire proposé',
  train: 'formation',
  count: 'nombre',
  qty: 'quantité',
  limitPrice: 'prix limite',
  qtyPerQuarter: 'quantité par trimestre',
  quarters: 'durée',
  borrow: 'emprunt',
  repay: 'remboursement',
  dividend: 'dividende',
  issueShares: 'émission d’actions',
  buyback: 'rachat d’actions',
  ipo: 'introduction en bourse',
  shares: 'actions',
  side: 'sens',
  budget: 'budget',
  type: 'type',
  projectId: 'projet',
  developers: 'développeurs',
};

/** "hr[0].wageOffer" → "RH n°1 · salaire proposé". Ids in the path are kept as is. */
export function issuePath(path: string): string {
  if (path === '') return 'Décisions';
  return path
    .split('.')
    .map((part) => {
      const m = /^([A-Za-z]+)\[(\d+)\]$/.exec(part);
      if (m) return `${SECTIONS[m[1] ?? ''] ?? m[1]} n°${Number(m[2]) + 1}`;
      return SECTIONS[part] ?? part;
    })
    .join(' · ');
}

export function issueText(issue: ValidationIssue): string {
  let text = `${issuePath(issue.path)} : ${fr.issueCodes[issue.code]}`;
  if (issue.submitted !== undefined && issue.applied !== undefined) {
    text += ` (${fmtNumber(issue.submitted)} → ${fmtNumber(issue.applied)})`;
  }
  return text;
}

const fmtNumber = (x: number) => (Math.abs(x) >= 1000 ? fmtInt(x) : fmtDec(x, 2));

const num = (data: Alert['data'] | GameEvent['data'], key: string): number =>
  Number(data?.[key] ?? 0);
const str = (data: Alert['data'] | GameEvent['data'], key: string): string =>
  String(data?.[key] ?? '');

export const alertTexts: Record<AlertKind, (a: Alert) => string> = {
  material_low: (a) =>
    `Stock de ${commodityName(str(a.data, 'commodityId')).toLowerCase()} faible : ${fmtDec(num(a.data, 'coverQuarters'))} trimestre de production couvert.`,
  stockout: (a) =>
    `Rupture de stock : ${fmtInt(num(a.data, 'lostUnits'))} ventes perdues le trimestre dernier.`,
  wage_below_market: (a) =>
    `${occupationName(str(a.data, 'occupationId'))} (${regionName(str(a.data, 'regionId'))}) payés ${fmtPct(num(a.data, 'gap'))} sous le marché : risque de départs.`,
  covenant_near: (a) =>
    `Covenant bancaire proche : dette nette / EBITDA à ${fmtDec(num(a.data, 'leverage'))}.`,
  covenant_breached: () => 'Covenant bancaire rompu : marge majorée, plus d’emprunt possible.',
  overdraft: (a) => `Découvert en cours : ${fmtMoney(num(a.data, 'amount'))}.`,
  distress: (a) =>
    `Société en difficulté : faillite dans ${fmtInt(num(a.data, 'quartersLeft'))} trimestre(s) sans redressement.`,
  capacity_saturated: (a) =>
    `Capacité saturée (${fmtPct(num(a.data, 'utilization'))} utilisés) : envisagez d’investir.`,
  tech_behind: (a) =>
    `Produit en retard de ${fmtDec(num(a.data, 'gap'))} niveau sur la frontière technologique : désabonnements en hausse, nouveaux clients en baisse.`,
  maintenance_short: (a) =>
    `Maintenance insuffisante : les développeurs hors R&D ne couvrent que ${fmtPct(num(a.data, 'coverage'))} des abonnés (la qualité baisse).`,
};

export const alertText = (a: Alert): string => alertTexts[a.kind](a);

/** Name of an event or modifier target ("Nord", "Acier", "Électroménager"…). */
export function targetName(kind: string, id: string | undefined): string {
  switch (kind) {
    case 'region':
      return regionName(id);
    case 'commodity':
      return commodityName(id);
    case 'market':
      return marketName(id);
    case 'laborPool': {
      const [regionId, occupationId] = (id ?? '').split(':');
      return `${occupationName(occupationId)}, ${regionName(regionId)}`;
    }
    default:
      return id ?? '';
  }
}

const SITE_KINDS: Record<string, string> = {
  factory: 'une usine',
  farm: 'une exploitation agricole',
  office: 'un bureau',
};

/** Journal entry in French. `companyName` resolves company ids. */
export function eventText(e: GameEvent, companyName: (id: string) => string): string {
  const who = e.companyId ? companyName(e.companyId) : '';
  const d = e.data;
  switch (e.kind) {
    case 'event': {
      const target = targetName(str(d, 'targetKind'), d?.targetId as string | undefined);
      const where = target ? ` (${target})` : '';
      return `${eventName(str(d, 'eventId'))}${where} pour ${fmtInt(num(d, 'durationQuarters'))} trimestre(s).`;
    }
    case 'macro_regime':
      return str(d, 'regime') === 'recession'
        ? 'L’économie entre en récession.'
        : 'L’économie repart : expansion.';
    case 'training_completed':
      return `${who} : ${fmtInt(num(d, 'count'))} salarié(s) formé(s) au métier ${occupationName(str(d, 'toOccupationId')).toLowerCase()}.`;
    case 'dismissals':
      return `${who} licencie ${fmtInt(num(d, 'count'))} salarié(s).`;
    case 'ai_price_war':
      return `${who} riposte par une baisse de prix contre ${companyName(str(d, 'rivalId'))}.`;
    case 'overdraft':
      return `${who} est à découvert : ${fmtMoney(num(d, 'amount'))}.`;
    case 'company_bankrupt':
      return `${who} fait faillite.`;
    case 'game_lost':
      return 'Votre société a fait faillite : la partie est perdue.';
    case 'credit_rating':
      return `${who} : notation ${str(d, 'from')} → ${str(d, 'to')}.`;
    case 'covenant_breached':
      return `${who} rompt son covenant bancaire.`;
    case 'company_distressed':
      return `${who} est en difficulté.`;
    case 'delisted':
      return `${who} est radiée de la cote.`;
    case 'stock_trade':
      return `${who} ${str(d, 'side') === 'buy' ? 'achète' : 'vend'} ${fmtInt(num(d, 'shares'))} actions ${companyName(str(d, 'targetId'))} à ${fmtPrice(num(d, 'price'))}.`;
    case 'capex_started': {
      const order = str(d, 'order');
      const what =
        order === 'build_site'
          ? str(d, 'siteKind') === 'office'
            ? 'aménage un nouveau bureau'
            : 'lance la construction d’une usine'
          : order === 'buy_farm'
            ? 'achète une exploitation agricole'
            : order === 'add_line'
              ? 'installe une nouvelle ligne'
              : 'modernise une ligne';
      return `${who} ${what} (${fmtMoney(num(d, 'cost'))}).`;
    }
    case 'site_commissioned':
      return str(d, 'siteKind') === 'farm'
        ? `${who} met en culture une nouvelle exploitation.`
        : str(d, 'siteKind') === 'office'
          ? `${who} ouvre un nouveau bureau.`
          : `${who} met en service une nouvelle usine.`;
    case 'harvest':
      return `${who} récolte ${fmtInt(num(d, 'qty'))} unités de ${commodityName(str(d, 'commodityId')).toLowerCase()} sur ${fmtInt(num(d, 'hectares'))} ha.`;
    case 'line_commissioned':
      return `${who} met en service une nouvelle ligne.`;
    case 'line_modernized':
      return `${who} termine la modernisation d’une ligne.`;
    case 'asset_sold':
      return `${who} vend ${str(d, 'order') !== 'sell_site' ? 'une ligne' : (SITE_KINDS[str(d, 'siteKind')] ?? 'une usine')} pour ${fmtMoney(num(d, 'proceeds'))}.`;
    case 'rnd_started':
      return `${who} lance un projet de R&D ${fr.rndTypes[str(d, 'type') as RndType]?.toLowerCase() ?? ''}.`;
    case 'rnd_completed':
      return `${who} achève un projet de R&D ${fr.rndTypes[str(d, 'type') as RndType]?.toLowerCase() ?? ''} : niveau ${fmtDec(num(d, 'level'))}.`;
    default:
      return `${who} ${e.kind}`.trim();
  }
}

/** Kinds of journal entries the UI knows how to phrase (tested against the engine). */
export const KNOWN_EVENT_KINDS = [
  'event',
  'macro_regime',
  'training_completed',
  'dismissals',
  'ai_price_war',
  'overdraft',
  'company_bankrupt',
  'game_lost',
  'credit_rating',
  'covenant_breached',
  'company_distressed',
  'delisted',
  'stock_trade',
  'capex_started',
  'site_commissioned',
  'harvest',
  'line_commissioned',
  'line_modernized',
  'asset_sold',
  'rnd_started',
  'rnd_completed',
] as const;

/** "+50 %", "×0,7" for a modifier effect. */
export function effectText(key: ModifierKey, op: 'add' | 'mul', value: number): string {
  const label = fr.modifierKeys[key];
  if (op === 'mul') return `${label} ${value >= 1 ? '+' : ''}${fmtPct(value - 1, 0)}`;
  return `${label} ${value >= 0 ? '+' : ''}${fmtPct(value)}`;
}

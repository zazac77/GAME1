// Every French label of the UI. The engine only emits ids, kinds and codes.
import type {
  Alert,
  AlertKind,
  GameEvent,
  ModifierKey,
  RndType,
  SectorId,
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
    activeCompany: 'Société affichée',
    subsidiary: 'filiale',
  },
  nav: {
    dashboard: 'Tableau de bord',
    decisions: 'Décisions',
    markets: 'Marchés',
    competitors: 'Concurrents',
    bourse: 'Bourse',
    deals: 'Rachats & OPA',
    group: 'Groupe',
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
    activist: 'Fonds activiste',
    activistHint:
      'Un fonds prend jusqu’à 10 % des sociétés cotées sous-évaluées et fait campagne (dividende ou vente de la société).',
    create: 'Créer la partie',
    continue: 'Reprendre',
    load: 'Charger une sauvegarde',
    import: 'Importer un fichier .json',
    defaultPlayer: 'Camille Durand',
    defaultCompanies: {
      industry: 'Durand Électroménager',
      agri: 'Durand Alimentaire',
      tech: 'Durand Logiciels',
    } satisfies Record<SectorId, string>,
    sector: 'Secteur de départ',
    sectors: {
      industry: {
        title: 'Industrie',
        pitch: 'Électroménager : usines, lignes de production et matières premières.',
        traits: [
          'Capital lourd, délais de construction',
          'Matières ≈ 45 % des coûts',
          'Prix, qualité et marketing',
        ],
      },
      agri: {
        title: 'Agroalimentaire',
        pitch: 'Produits alimentaires transformés : saisons, météo et distribution.',
        traits: [
          'Récolte en T3, aléa météo régional',
          'Produits périssables, frais de référencement',
          'Marges fines (3 à 8 %)',
        ],
      },
      tech: {
        title: 'Technologie',
        pitch: 'Logiciel par abonnement : talents, R&D et effet de réseau.',
        traits: [
          'Bureaux, salaires ≈ 70 % des coûts',
          'Frontière technologique : innover ou décrocher',
          'Abonnés, churn et effet de réseau',
        ],
      },
    } satisfies Record<SectorId, { title: string; pitch: string; traits: string[] }>,
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
    distribution: 'Présence en rayon',
    users: 'Abonnés',
    acquired: 'Nouveaux abonnés (trim. dernier)',
    churn: 'Désabonnements (trim. dernier)',
    techVsFrontier: 'Niveau techno / frontière',
    techPriceHint:
      'Prix par abonné et par trimestre. La qualité dépend des seniors et des développeurs affectés à la maintenance.',
    techNoProduction:
      'Logiciel : pas de stock ni de production. La capacité dépend des développeurs (maintenance) et du support ; les places de bureau limitent les embauches.',
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
    sellAsset: 'Vendre',
    buildOffice: 'Ouvrir un bureau',
    officeSeats: (seats: number, free: number) =>
      `${fmtInt(seats)} places par bureau ; places libres dans la région : ${fmtInt(free)}.`,
    farmLand: (hectares: number, left: number) =>
      `${fmtInt(hectares)} ha par exploitation ; terres encore à vendre dans la région : ${fmtInt(left)} ha.`,
    farm: 'Exploitation agricole',
    office: 'Bureau',
    farmInfo: (hectares: number) => `${fmtInt(hectares)} ha cultivés (récolte en T3).`,
    officeInfo: (seats: number) => `${fmtInt(seats)} places.`,
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
    rndNoProjectTech: 'Aucun projet : des développeurs affectés en lancent un.',
    rndProgress: 'Avancement',
    rndCost: 'Coût du projet',
    rndBudget: 'Budget du trimestre',
    rndMax: 'max',
    rndMaxed: 'Niveau maximal atteint.',
    rndEffort: 'Effort du projet (dév.·trim.)',
    rndDevelopers: 'Développeurs affectés',
    rndDevelopersAvailable: (n: number) =>
      `Développeurs disponibles pour la R&D ce trimestre : ${fmtInt(n)} (les autres maintiennent le produit).`,
    listingFees: 'Référencement en distribution',
    listingHint:
      'Les frais de référencement maintiennent la présence en rayon, qui pèse lourd dans le choix des consommateurs.',
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
    serviceCeiling: 'Abonnés maintenables',
    expectedUsers: 'Abonnés en fin de trimestre',
    expectedBilled: 'Abonnés facturés attendus',
    equityFlows: 'Opérations sur capital (net)',
    mnaCosts: 'Audits et intégration',
    acquisitions: 'Rachats (numéraire)',
    groupTransfers: 'Flux intra-groupe (fin de trimestre)',
    acquisitionDebt: 'Dette d’acquisition',
    capexTotal: 'Investissements',
    disposals: 'Cessions',
    borrowing: 'Emprunt',
    repayment: 'Remboursement',
    installments: 'Échéances',
    costs: 'Charges estimées',
    issues: 'Ajustements de la validation',
    noIssues: 'Décisions valides.',
  },
  capital: {
    heading: 'Opérations sur le capital',
    dividend: 'Dividende total',
    issue: 'Augmentation de capital (actions)',
    buyback: 'Rachat d’actions',
    atPrice: (price: string) => `à ${price}`,
    ipo: (shares: string, price: string, proceeds: string) =>
      `Introduction en bourse : ${shares} actions nouvelles à ${price} (produit ${proceeds})`,
    ipoUnavailable: 'Société non cotée : introduction en bourse pas encore possible.',
    hint: 'Exécutées en début de trimestre. Pas de dividende en difficulté ni en bris de covenant ; une émission ne fait jamais perdre le contrôle du groupe.',
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
    holdingFees: 'Frais de holding',
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
    jobOffers: 'Offres d’emploi (dernier trimestre)',
    noJobOffers: 'aucune',
    published: 'Comptes publiés',
    noPublished: 'Pas encore de comptes publiés.',
    revenue: 'CA',
    ebitda: 'EBITDA',
    netIncome: 'Résultat net',
    cash: 'Trésorerie',
    debt: 'Dette',
    equity: 'Fonds propres',
    sharePrice: 'Cours',
    partialView:
      'Vue partielle : seuls les faits publics (prix, offres d’emploi, usines) et les comptes publiés sont visibles.',
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
    declared: 'Franchissements de seuil déclarés',
    declaredHint:
      'Tout groupe qui franchit 5, 10, 20 ou 33 % du capital d’une société cotée le déclare. En bourse, un groupe ne peut pas dépasser 30 % : au-delà, il faut déposer une offre.',
    noDeclared: 'Aucune participation déclarée hors fondateurs.',
    holder: 'Détenteur',
    level: 'Seuil franchi',
    campaigns: 'Campagnes activistes',
    campaign: (fund: string, demand: string) => `${fund} réclame ${demand}`,
    demands: { payout: 'un dividende (trésorerie nette)', sale: 'la vente de la société' },
    since: 'Depuis',
  },
  deals: {
    intro:
      'Rachetez des sociétés non cotées mises en vente (pépites) ou prenez le contrôle d’un concurrent : rachat du bloc de son actionnaire de contrôle (avec offre obligatoire aux minoritaires s’il est coté), OPA amicale ou OPA hostile sur une société que personne ne contrôle. Un audit (un trimestre de délai) révèle les vrais chiffres et les passifs cachés. Une seule opération par trimestre, conclue en fin de trimestre.',
    buyer: (name: string) => `Acheteur : ${name} (changez de société dans l’en-tête).`,
    noDraft:
      'Cette filiale est gérée par sa direction en place. Reprenez-la en main depuis l’écran Groupe pour décider pour elle.',
    thisQuarter: 'Vos opérations ce trimestre',
    nothing: 'Aucun audit ni offre ce trimestre.',
    auditOf: (name: string) => `Audit d’acquisition de ${name}`,
    tenderOfferAt: (name: string, price: string) => `OPA amicale sur ${name} à ${price} par action`,
    hostileAt: (name: string, price: string) =>
      `OPA (hostile si le conseil refuse) sur ${name} à ${price} par action`,
    competingAt: (name: string, price: string) =>
      `Offre concurrente sur ${name} à ${price} par action`,
    raiseAt: (name: string, price: string) => `Surenchère sur ${name} à ${price} par action`,
    withdrawOf: (name: string) => `Retrait de votre offre sur ${name}`,
    tenderOf: (name: string) => `Apport de vos actions ${name} à l’offre`,
    blockAt: (name: string, price: string) =>
      `Rachat du bloc de contrôle de ${name} à ${price} par action`,
    buyListing: (name: string) => `Rachat de 100 % de ${name} au prix demandé`,
    withDebt: (amount: string) => `dette d’acquisition ${amount}`,
    withShares: (share: string) => `${share} payé en actions`,
    listings: 'Sociétés à vendre',
    noListings: 'Aucune société à vendre en ce moment.',
    listingsHint:
      'Chiffres estimés (bruités) tant qu’aucun audit n’est fait. Un passif révélé par l’audit est déduit du prix.',
    companies: 'Concurrents et autres sociétés',
    noCompanies: 'Aucune cible : les sociétés non cotées ne sont évaluées qu’après un audit.',
    companiesHint:
      'Chiffres publiés (avec un trimestre de retard) ou audités. Le conseil demande une prime sur le cours ; sans prime affichée, la société n’est pas à vendre.',
    target: 'Cible',
    revenue: 'CA annuel',
    ebitda: 'EBITDA annuel',
    netDebt: 'Dette nette',
    valuationRange: 'Fourchette de valeur',
    askingPrice: 'Prix demandé',
    diligenceHead: 'Audit',
    diligence: { none: 'non', pending: 'en cours', done: 'fait' },
    notForSale: 'pas à vendre',
    notForSaleLong:
      'Pas à vendre : son actionnaire de contrôle (ou son conseil) refuse toute offre pour l’instant.',
    audit: 'Audit',
    prepare: 'Préparer une offre',
    offerOn: 'Offre sur',
    close: 'Fermer',
    valuation: 'Valorisation',
    figuresFrom: {
      audit: 'Chiffres audités',
      listing: 'Chiffres estimés (non audités)',
      company: 'Chiffres publiés (non audités)',
    },
    hiddenLiability: 'Passif caché révélé',
    multiples: 'Par les multiples',
    dcf: 'DCF simplifié',
    range: 'Fourchette (100 % des titres)',
    controlPremium: 'Prime de contrôle attendue',
    referencePrice: 'Cours de référence',
    blockShares: 'Actions du bloc de contrôle',
    auditAdvice: 'Sans audit, les chiffres peuvent être loin de la réalité.',
    offerKind: 'Type d’offre',
    offerKinds: { block: 'Rachat du bloc de contrôle', tender: 'OPA' },
    hostile: 'Passer outre le conseil (OPA hostile)',
    hostileHint:
      'Sans l’accord du conseil, l’offre reste ouverte un trimestre et s’adresse directement aux actionnaires, qui demandent alors une prime plus forte. Le conseil peut adopter une pilule empoisonnée et chercher un chevalier blanc ; d’autres peuvent surenchérir.',
    contestable: 'Personne ne contrôle cette société : une OPA hostile peut réussir.',
    controlled: 'Un actionnaire la contrôle : sans son accord, aucune offre ne peut réussir.',
    groupStake: 'Part déjà détenue par votre groupe',
    underOffer: (price: string) =>
      `Société sous offre : une offre concurrente doit atteindre ${price} par action (le rachat de bloc attend la clôture).`,
    mandatory: (shares: string) =>
      `Offre obligatoire : le même prix est proposé aux autres actionnaires (${shares} actions au plus).`,
    pricePerShare: 'Prix par action',
    boardAsks: (price: string) => `le conseil demande ${price}`,
    total: 'Montant total',
    debt: 'Dette d’acquisition',
    stockShare: 'Part payée en actions nouvelles',
    cashPart: 'Part en numéraire (sur votre trésorerie)',
    listingRules: 'Achat de 100 % des titres au prix demandé, conclu en fin de trimestre.',
    blockRules:
      'Le vendeur accepte si le prix atteint la prime qu’il demande. Vous prenez alors le contrôle de la société.',
    tenderRules:
      'Il faut l’accord du conseil ; le flottant apporte ses titres par tranches selon la prime. L’offre échoue si votre groupe ne dépasse pas 50 % ; au-delà du seuil de retrait, le reste est racheté et la société radiée.',
    submit: 'Ajouter aux décisions',
    update: 'Mettre à jour l’offre',
    tenderOffers: 'OPA récentes',
    noOffers: 'Aucune OPA récente.',
    openOffers: 'Offres en cours',
    noOpenOffers: 'Aucune offre en cours.',
    closesAt: 'Clôture',
    defenses: 'Défenses',
    pill: 'pilule empoisonnée',
    knight: 'chevalier blanc recherché',
    yours: '(la vôtre)',
    raise: 'Surenchérir',
    withdraw: 'Retirer',
    tenderShares: (shares: string) => `Apporter mes ${shares} actions`,
    cancelAction: 'Annuler',
    hostileBadge: 'hostile',
    pillHint:
      'Pilule empoisonnée : si l’offre l’emporte contre l’avis du conseil, les actionnaires qui n’ont pas apporté reçoivent 0,5 action gratuite par action ; il faut garder plus de 50 % après cette dilution.',
    bidder: 'Initiateur',
    premium: 'Prime',
    status: 'Issue',
    when: 'Lancée',
    offerStatus: {
      open: 'en cours',
      succeeded: 'réussie',
      failed: 'échouée',
      rejected: 'rejetée par le conseil',
      withdrawn: 'retirée',
    },
  },
  group: {
    intro:
      'Les sociétés que vous contrôlez (plus de 50 %, directement ou par vos filiales). Une filiale est gérée par sa direction en place, sauf si vous la reprenez en main : ses décisions s’éditent alors comme celles de votre société.',
    heading: 'Sociétés du groupe',
    companies: 'Sociétés',
    company: 'Société',
    parent: 'Détenue par',
    stake: 'Part du groupe',
    value: 'Valeur des titres',
    cost: 'Coût d’acquisition',
    revenue: 'CA (trim.)',
    netIncome: 'Résultat net (trim.)',
    cash: 'Trésorerie',
    equity: 'Fonds propres',
    runBy: 'Décisions',
    root: '(tête de groupe)',
    listed: 'cotée',
    unlisted: 'non cotée',
    integration: (until: string) => `intégration jusqu’à ${until}`,
    you: 'vous',
    management: 'direction en place',
    takeOver: 'Reprendre en main',
    delegate: 'Confier à la direction',
    open: 'Afficher',
    notConsolidated: 'Sommes non consolidées : votre groupe n’a pas encore de filiale.',
    alone:
      'Votre groupe ne compte qu’une société : rachetez-en d’autres depuis l’écran Rachats & OPA.',
    toDeals: 'Voir les rachats possibles',
    groupShare: 'Part économique',
    contribution: 'Contribution au résultat',
    groupLoans: 'Prêts accordés',
    groupDebt: 'Dette intra-groupe',
    consolidated: 'Comptes consolidés',
    consolidatedHint:
      'Intégration globale des sociétés contrôlées, flux intra-groupe éliminés (prêts, dividendes, participations). La part des actionnaires minoritaires des filiales est isolée.',
    pnl: 'Compte de résultat consolidé (trim.)',
    balance: 'Bilan consolidé',
    ebitda: 'EBITDA',
    financial: 'Résultat financier',
    groupNetIncome: 'Résultat net part du groupe',
    minorityNetIncome: 'dont part des minoritaires',
    fixedAssets: 'Immobilisations',
    inventory: 'Stocks',
    financialAssets: 'Actifs financiers',
    debt: 'Dettes financières',
    groupEquity: 'Capitaux propres part du groupe',
    minorities: 'Intérêts minoritaires',
    eliminations: 'Éliminations intra-groupe',
    elimLoans: 'Prêts entre sociétés du groupe',
    elimStakes: 'Participations (contre les fonds propres)',
    elimFinancial: 'Résultat financier intra-groupe',
    synergies: 'Synergies et coûts de la complexité',
    synergiesHint:
      'Évalués en début de trimestre sur les sociétés que le groupe contrôle. Les synergies jouent dès le trimestre ; une surcharge de direction pénalise toutes les sociétés le trimestre suivant.',
    synergyGains: 'Synergies',
    complexityCosts: 'Coûts de la diversification',
    members: 'Sociétés opérationnelles',
    sectorsInGroup: 'Secteurs',
    groupBrand: 'Marque du groupe',
    brandShare: (share: string) => `part dans la marque perçue : ${share}`,
    supportSaving: 'Fonctions support partagées (direction, commerciaux)',
    supportSavingValue: (share: string, amount: string) => `−${share} des salaires, soit ${amount}`,
    pooled: 'Achats mutualisés (volume sous contrat du groupe)',
    noPooled: 'Aucun contrat en cours.',
    holdingFee: 'Frais de holding (trim., répartis selon le CA)',
    managerial: 'Capacité managériale',
    managerialValue: (load: string, capacity: string) => `charge ${load} / capacité ${capacity}`,
    efficiency: 'Efficacité des sociétés',
    overloaded:
      'Direction surchargée : productivité réduite et départs accrus dans toutes les sociétés. Une holding de tête augmente la capacité.',
    discount: 'Décote de conglomérat (valeur de la holding)',
    noDiscount: 'aucune (holding seulement)',
    holding: 'Holding de tête',
    holdingHint:
      'Créer une holding : vos actions de la société de tête lui sont apportées et elle devient la tête du groupe (non cotée, sans dette). Vous pourrez ensuite lui céder vos filiales et faire remonter la trésorerie.',
    createHolding: 'Créer la holding en fin de trimestre',
    cancelHolding: 'Annuler la création',
    holdingPlanned: 'La holding sera créée à la fin du trimestre.',
    holdingDecisions:
      'Une holding n’a pas d’activité opérationnelle : ses décisions se limitent à la finance. Ses flux avec les filiales se décident depuis l’écran Groupe.',
    loans: 'Prêts intra-groupe en cours',
    noLoans: 'Aucun prêt intra-groupe.',
    lender: 'Prêteur',
    borrower: 'Emprunteur',
    principal: 'Encours',
    rate: 'Taux annuel',
    transfers: 'Flux intra-groupe du trimestre',
    transfersHint:
      'Exécutés en fin de trimestre, dans l’ordre, sur la trésorerie alors disponible. Un prêt rembourse d’abord ce que le prêteur doit à l’emprunteur. Le cash pooling se reconduit d’un trimestre à l’autre.',
    noTransfers: 'Aucun flux prévu.',
    kind: 'Nature',
    from: 'De',
    to: 'Vers',
    amount: 'Montant',
    target: 'Titres',
    shares: 'Actions',
    allShares: 'toutes',
    add: 'Ajouter',
    remove: 'Retirer',
    kinds: {
      dividend: 'Dividende remonté',
      loan: 'Prêt / remboursement',
      cash_pool: 'Cash pooling (trésorerie gardée)',
      stake: 'Cession de titres (restructuration)',
    },
    transferText: {
      dividend: (from: string, to: string, amount: string) =>
        `${from} verse un dividende de ${amount} (dont la part de ${to})`,
      loan: (from: string, to: string, amount: string) => `${from} prête ${amount} à ${to}`,
      cash_pool: (from: string, to: string, amount: string) =>
        `${from} garde ${amount}, le reste va à ${to} (ou ${to} comble le manque)`,
      stake: (from: string, to: string, shares: string, target: string) =>
        `${from} cède ${shares} actions ${target} à ${to}, à leur valeur (prêt intra-groupe)`,
    },
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
  rndTypesTech: {
    process: 'Plateforme',
    product: 'Nouvelle version',
  } satisfies Record<RndType, string>,
  rndEffectsTech: {
    process: 'Moins de cloud par abonné et meilleure qualité.',
    product: 'Rapproche le produit de la frontière technologique (ou la dépasse).',
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
  listing: 'Référencement',
  rnd: 'R&D',
  finance: 'Finance',
  stockOrders: 'Ordre de bourse',
  mna: 'Rachats',
  intraGroup: 'Intra-groupe',
  createHolding: 'création de la holding',
  amount: 'montant',
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
  targetId: 'cible',
  kind: 'type',
  pricePerShare: 'prix par action',
  stockShare: 'part en actions',
  debt: 'dette d’acquisition',
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
      return d?.escalation
        ? `${who} durcit sa guerre des prix contre ${companyName(str(d, 'rivalId'))}.`
        : `${who} riposte par une baisse de prix contre ${companyName(str(d, 'rivalId'))}.`;
    case 'ai_price_truce':
      return `${who} met fin à sa guerre des prix contre ${companyName(str(d, 'rivalId'))} : elle lui coûte trop cher.`;
    case 'ai_wage_outbid': {
      const job = occupationName(str(d, 'occupationId')).toLowerCase();
      const where = regionName(str(d, 'regionId'));
      return `${who} surenchérit sur les salaires${job ? ` (${job}${where ? `, ${where}` : ''})` : ''} face à ${companyName(str(d, 'rivalId'))}.`;
    }
    case 'ai_counter_launch':
      return `${who} lance une contre-offensive produit (qualité, R&D, marketing) face à ${companyName(str(d, 'rivalId'))}.`;
    case 'ai_targets_rival':
      return `${who} part à la conquête des clients de ${companyName(str(d, 'rivalId'))}, en difficulté.`;
    case 'ai_hostile_offer':
      return `${who} prépare une OPA hostile sur ${companyName(str(d, 'rivalId'))}.`;
    case 'ai_counter_bid':
      return `${who} surenchérit face à ${companyName(str(d, 'rivalId'))} sur ${companyName(str(d, 'targetId'))} (${fmtPrice(num(d, 'pricePerShare'))} par action).`;
    case 'ai_white_knight':
      return `${who} vole au secours de ${companyName(str(d, 'targetId'))} en chevalier blanc, face à ${companyName(str(d, 'rivalId'))}.`;
    case 'ai_preempt':
      return `${who} s’intéresse à ${companyName(str(d, 'rivalId'))}, convoitée par un autre groupe.`;
    case 'ai_defense_buyback':
      return `${who} rachète ${fmtInt(num(d, 'shares'))} de ses actions pour se défendre de ${companyName(str(d, 'rivalId'))}.`;
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
    case 'dividend_paid':
      return `${who} verse un dividende de ${fmtMoney(num(d, 'amount'))} (${fmtPrice(num(d, 'perShare'))} par action).`;
    case 'shares_issued':
      return `${who} augmente son capital : ${fmtInt(num(d, 'shares'))} actions nouvelles à ${fmtPrice(num(d, 'price'))}.`;
    case 'shares_bought_back':
      return `${who} rachète et annule ${fmtInt(num(d, 'shares'))} de ses actions à ${fmtPrice(num(d, 'price'))}.`;
    case 'ipo':
      return `${who} entre en bourse : ${fmtInt(num(d, 'shares'))} actions offertes à ${fmtPrice(num(d, 'price'))}.`;
    case 'company_for_sale':
      return `${str(d, 'name')} (${fr.sectors[str(d, 'sector')] ?? str(d, 'sector')}) est à vendre.`;
    case 'due_diligence':
      return `${who} mène un audit d’acquisition sur ${companyName(str(d, 'targetId'))} (${fmtMoney(num(d, 'cost'))}) : résultats au trimestre prochain.`;
    case 'hidden_liability':
      return `${who} découvre un passif caché : ${fmtMoney(num(d, 'amount'))}.`;
    case 'integration_completed':
      return `${who} achève son intégration dans son nouveau groupe.`;
    case 'takeover': {
      const mode = str(d, 'mode');
      const how =
        mode === 'tender_offer'
          ? d?.hostile
            ? 'par une OPA hostile'
            : 'par une OPA amicale'
          : mode === 'block'
            ? 'en rachetant le bloc de contrôle'
            : 'de gré à gré';
      const mandatory =
        num(d, 'mandatory') > 0
          ? ` ; ${fmtInt(num(d, 'mandatory'))} actions apportées à l’offre obligatoire`
          : '';
      return `${who} prend le contrôle de ${companyName(str(d, 'targetId'))} ${how} (${fmtMoney(num(d, 'price'))}${mandatory}).`;
    }
    case 'hostile_offer': {
      const defenses = [
        d?.pill ? 'adopte une pilule empoisonnée' : '',
        d?.whiteKnight ? 'cherche un chevalier blanc' : '',
      ].filter(Boolean);
      const board = defenses.length > 0 ? ` Le conseil ${defenses.join(' et ')}.` : '';
      return `${who} lance une OPA hostile sur ${companyName(str(d, 'targetId'))} à ${fmtPrice(num(d, 'pricePerShare'))} par action (prime de ${fmtPct(num(d, 'premium'))}).${board}`;
    }
    case 'competing_offer':
      return `${who} dépose une offre concurrente sur ${companyName(str(d, 'targetId'))} à ${fmtPrice(num(d, 'pricePerShare'))} par action.`;
    case 'tender_offer_raised':
      return `${who} relève son offre sur ${companyName(str(d, 'targetId'))} à ${fmtPrice(num(d, 'pricePerShare'))} par action.`;
    case 'tender_offer_withdrawn':
      return `${who} retire son offre sur ${companyName(str(d, 'targetId'))}.`;
    case 'poison_pill':
      return `La pilule empoisonnée de ${who} est déclenchée : ${fmtInt(num(d, 'newShares'))} actions gratuites diluent ${companyName(str(d, 'bidderId'))}.`;
    case 'stake_threshold': {
      const level = num(d, 'level');
      const holder = companyName(str(d, 'holderId'));
      return level > num(d, 'previous')
        ? `${holder} déclare avoir franchi ${fmtPct(level, 0)} du capital de ${who} (${fmtPct(num(d, 'stake'))}).`
        : `${holder} repasse sous ${fmtPct(num(d, 'previous'), 0)} du capital de ${who} (${fmtPct(num(d, 'stake'))}).`;
    }
    case 'activist_campaign':
      return `${companyName(str(d, 'fundId'))} entre en campagne chez ${who} : ${str(d, 'demand') === 'payout' ? 'il réclame un dividende' : 'il réclame la vente de la société'}.`;
    case 'tender_offer_rejected':
      return `Le conseil de ${companyName(str(d, 'targetId'))} rejette l’offre de ${who} (prime de ${fmtPct(num(d, 'premium'))}).`;
    case 'block_purchase_rejected':
      return `L’actionnaire de contrôle de ${companyName(str(d, 'targetId'))} refuse de vendre son bloc à ${who} (prime de ${fmtPct(num(d, 'premium'))}).`;
    case 'deal_failed': {
      const reason = str(d, 'reason');
      const why =
        reason === 'financing'
          ? 'financement insuffisant'
          : reason === 'no_control'
            ? 'trop peu d’actions apportées pour prendre le contrôle'
            : reason === 'outbid'
              ? 'une offre plus élevée l’emporte'
              : reason === 'pill'
                ? 'la pilule empoisonnée l’aurait privé du contrôle'
                : reason === 'under_offer'
                  ? 'la société est déjà sous offre'
                  : 'cible indisponible';
      return `${who} : le rachat de ${companyName(str(d, 'targetId'))} échoue (${why}).`;
    }
    case 'holding_created':
      return `${who} est créée et devient la société de tête du groupe de ${companyName(str(d, 'companyId'))}.`;
    case 'group_loan': {
      const to = companyName(str(d, 'toId'));
      const repaid = num(d, 'repaid');
      const lent = num(d, 'lent');
      const parts = [
        repaid > 0 ? `rembourse ${fmtMoney(repaid)} à ${to}` : '',
        lent > 0 ? `prête ${fmtMoney(lent)} à ${to}` : '',
      ].filter(Boolean);
      return `${who} ${parts.join(' et ')}${d?.pool ? ' (cash pooling)' : ''}.`;
    }
    case 'stake_transferred':
      return `${who} cède ${fmtInt(num(d, 'shares'))} actions ${companyName(str(d, 'targetId'))} à ${companyName(str(d, 'toId'))} pour ${fmtMoney(num(d, 'value'))} (prêt intra-groupe).`;
    case 'group_loan_written_off':
      return `Prêt intra-groupe à ${companyName(str(d, 'borrowerId'))} passé en perte : ${fmtMoney(num(d, 'amount'))}.`;
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
  'ai_price_truce',
  'ai_wage_outbid',
  'ai_counter_launch',
  'ai_targets_rival',
  'ai_hostile_offer',
  'ai_counter_bid',
  'ai_white_knight',
  'ai_preempt',
  'ai_defense_buyback',
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
  'dividend_paid',
  'shares_issued',
  'shares_bought_back',
  'ipo',
  'company_for_sale',
  'due_diligence',
  'hidden_liability',
  'integration_completed',
  'takeover',
  'tender_offer_rejected',
  'block_purchase_rejected',
  'hostile_offer',
  'competing_offer',
  'tender_offer_raised',
  'tender_offer_withdrawn',
  'poison_pill',
  'stake_threshold',
  'activist_campaign',
  'deal_failed',
  'holding_created',
  'group_loan',
  'stake_transferred',
  'group_loan_written_off',
] as const;

/** "+50 %", "×0,7" for a modifier effect. */
export function effectText(key: ModifierKey, op: 'add' | 'mul', value: number): string {
  const label = fr.modifierKeys[key];
  if (op === 'mul') return `${label} ${value >= 1 ? '+' : ''}${fmtPct(value - 1, 0)}`;
  return `${label} ${value >= 0 ? '+' : ''}${fmtPct(value)}`;
}

# Game design : mécaniques et formules

> Tous les coefficients notés en `code` sont des clés de `config/default.ts`.
> Les valeurs numériques citées sont des points de départ, fixés ensuite par
> l'équilibrage (sim-cli).

## 1. Temps et macroéconomie

- 1 tour = 1 trimestre ; saison `s = turn % 4` (T1 hiver … T4 automne).
- **Cycle** : la croissance du PIB suit un AR(1) avec deux régimes
  (expansion/récession) et une matrice de transition dans
  `macro.regimeTransition`. Elle module la demande, l'emploi hors simulation
  et les multiples boursiers.
- **Inflation** : AR(1) autour de `macro.inflationTarget`. Elle indexe les
  salaires de référence et les prix mondiaux.
- **Taux directeur** : suit une règle de Taylor simplifiée
  `r = r* + a·(π − π*) + b·(croissance − tendance)`, lissée. Elle sert au
  coût de la dette, à l'actualisation et aux multiples boursiers.

## 2. Marché du travail (par région × métier)

Les niveaux de qualification vont de N1 (non qualifié) à N4 (cadre ou
expert). Chaque métier appartient à un niveau et à des secteurs ; certains
métiers sont transversaux (commercial, cadre).

**Stock** : `chômeurs U = max(0, laborForce − outsideEmployment − Σ effectifs entreprises)`.
L'économie hors simulation (`outsideEmployment`) suit le cycle. Les
entreprises simulées y représentent 15 à 40 % de l'emploi du métier : une
embauche massive se voit donc sur les salaires sans vider le pays.

**Appariement** (fonction de Cobb-Douglas) :
`embauches_totales = min(V, U, μ · U^α · V^(1−α))`, où V = Σ postes ouverts.
Ces embauches sont réparties entre les entreprises au prorata de
`postes_i · (salaireOffert_i / salaireMarché)^ε_w · f(employerBrand_i)`.
Payer au-dessus du marché recrute donc plus vite et sur le même vivier que
les concurrents.

**Frictions** :
- coût de recrutement : `labor.hiringCost` × salaire trimestriel ;
- montée en compétence : les recrues produisent à `labor.rampUpProductivity`
  (≈ 50 %) au premier trimestre ;
- délai : les métiers N3 et N4 ont un plafond d'embauches par tour, en
  pourcentage du vivier.

**Attrition** : `taux = base · (salaireMarché / salaire_i)^σ · g(moral)`. Les
partants retournent au vivier, où les concurrents peuvent les embaucher.

**Licenciement** : indemnités de `labor.severanceQuarters` trimestres de
salaire, et baisse d'`employerBrand`.

**Salaires de marché** :
`w_{t+1} = w_t · (1 + π + κ · clamp(tension − tension*, −m, +m))`, avec
`tension = V / max(U, 1)` (jamais de division par zéro ; si U = 0, aucune
embauche car `min(V, U, …) = 0`). `κ` correspond à `labor.wageAdjustSpeed`.

**Offre de long terme** : les diplômés entrants par métier augmentent avec
la prime salariale du métier par rapport à la moyenne, avec 4 à 8 trimestres
de retard. Une pénurie durable se résorbe donc lentement.

**Formation interne** : un coût par personne et une durée (1 à 3 trimestres,
pendant lesquels les stagiaires ne produisent pas) font passer un salarié au
métier de niveau supérieur. La formation fidélise (attrition réduite) mais
le salarié formé exige ensuite le salaire de son nouveau métier.

## 3. Marchés des matières premières

Le choix retenu est un modèle offre/demande avec impact de prix, et non un
carnet d'ordres complet. Il est plus lisible, plus stable à équilibrer et
garde l'essentiel du comportement. Le carnet est simulé de façon simplifiée
par les **ordres à cours limité** : tant que le prix de compensation dépasse
la limite d'un ordre, on retire `1/commodities.limitOrderTranches` de sa
quantité, puis on recalcule le prix (tous les ordres en défaut à la fois,
nombre de passes borné). Le résultat est déterministe et ne dépend pas de
l'ordre des sociétés.

- **Prix mondial** (exogène) : `ln P^w` suit un processus d'Ornstein-Uhlenbeck
  autour d'une tendance indexée sur l'inflation, avec une saisonnalité
  (`seasonality[s]`) et des chocs issus des événements.
- **Prix spot de compensation** : `P = P^w · (D_sim / D_ref)^η`, où `D_sim`
  est la demande agrégée des entreprises simulées ce tour (contrats + spot)
  et `η` vaut `commodities.<id>.priceImpact`. Un gros acheteur fait monter le
  prix pour tous.
- **Ordres spot** : un ordre au marché est exécuté au prix `P`. Un ordre à
  cours limité est exécuté seulement si `P ≤ limite` (exécution partielle par
  tranches sinon). Le joueur voit le prix du tour précédent et une
  fourchette estimée.
- **Contrats long terme** : prix fixé = prix à terme (spot attendu + prime de
  risque de `commodities.forwardPremium`), moins une remise volume. Ils
  durent de 2 à 8 trimestres avec un engagement de volume (take-or-pay :
  pénalité si le volume est réduit). C'est l'arbitrage entre sécurité et
  prix.
- **Stocks** : coût de stockage par unité et par trimestre, capacité
  d'entrepôt limitée par site, et péremption pour l'agro. Une rupture de
  matière limite la production.
- **Livraison** : le spot est livré dans le tour avec une surprime de
  `commodities.spotPremium`, les contrats à chaque début de tour. Un
  événement « logistique » peut retarder les livraisons d'un tour.

## 4. Marchés des produits finis

**Demande totale** :
`Q = base · saison[s] · cycle · (prixMoyen / prixRéf)^(−ε_marché)`.

**Parts de marché (logit multinomial par segment)** : pour chaque segment `k`
de consommateurs (par exemple « prix », poids 60 %, et « qualité », poids
40 %) :

```
U_ik = −βp_k · ln(prix_i / prixRéf) + βq_k · qualité_i + βb_k · marque_i
       + βm_k · ln(1 + marketing_i/marketingUnit) + βd · distribution_i
       (+ βn · ln(1 + users_i/networkUnit) + βt · (niveauTechno_i − frontière) en tech)
part_ik = exp(U_ik) / (exp(U_0k) + Σ_j exp(U_jk))
```

`U_0` est l'option extérieure (importations, renoncement à l'achat), qui
évite qu'un monopole capte toute la demande à n'importe quel prix.

**Ventes** : `min(demande allouée, stock disponible)`. La demande non servie
est réallouée aux autres entreprises en stock, avec une perte de
`products.spilloverRate`.

**Marque** : `brand_{t+1} = clamp(brand_t·(1−δ) + a·ln(1 + marketing/products.marketingUnit) + b·(qualité − qualitéMoyenne) − scandales, 0, 100)`.
`employerBrand` est bornée de même à 0..100.

Les deux segments rendent viables les positionnements low-cost et premium.

## 5. Secteurs

### 5.1 Industrie manufacturière (MVP : électroménager)

| Aspect | Contenu |
|---|---|
| Métiers | Opérateur de production (N1), Technicien de maintenance (N2), Ingénieur méthodes/qualité (N3), Commercial (N2), Cadre (N4) |
| Intrants | Acier, polymères, composants électroniques, énergie |
| Capital | Usine (par région, foncier et délai de construction de 2 à 3 trimestres) contenant des lignes de production (capacité, âge, niveau technologique, maintenance) |
| Production | `capacité = min(Σ capacité lignes, opérateurs × productivité, matières disponibles)` ; la productivité dépend du ratio techniciens/opérateurs et de l'âge des lignes |
| Qualité | Fonction du ratio ingénieurs, du niveau techno des lignes, de la R&D procédés et d'une qualité visée (plus elle est haute, plus le coût matière unitaire monte) |
| Coûts | Fixes élevés (amortissements, maintenance, encadrement). Variables : matières ≈ 45 %, énergie, main-d'œuvre directe |
| Échelle | Coût fixe unitaire décroissant ; courbe d'apprentissage (−x % de main-d'œuvre par doublement de la production cumulée) ; remise volume aux achats |
| Différenciation | Prix, qualité, marketing, gamme (entrée ou haut de gamme) |
| Barrières | Entrée : capex et délai de construction, échelle des acteurs en place. Sortie : actifs spécifiques revendus avec une décote de 40 à 60 %, indemnités de licenciement |

### 5.2 Agroalimentaire (phase 2 : produits alimentaires transformés)

| Aspect | Contenu |
|---|---|
| Métiers | Ouvrier agricole (N1, saisonnier), Opérateur agroalimentaire (N1), Technicien qualité (N2), Agronome (N3), Commercial (N2), Cadre (N4) |
| Intrants | Céréales, oléagineux, lait, emballages, énergie, engrais (si exploitation propre) |
| Mécaniques propres | Récolte en T3 (prix agricoles bas après la récolte) ; aléa météo régional sur les rendements ; terres agricoles limitées par région (intégration amont possible) ; **périssabilité** des produits finis (perte en % par trimestre) |
| Coûts | Matières 60 à 70 %, marges nettes de 3 à 8 % |
| Demande | Peu élastique au niveau du marché, très élastique entre marques ; coût de référencement en grande distribution |
| Différenciation | Prix, labels (bio, qualité), marque, distribution |
| Barrières | Entrée : faibles en capital, fortes en distribution et marque. Sortie : moyennes |

### 5.3 Technologie / logiciel (phase 2 : SaaS)

| Aspect | Contenu |
|---|---|
| Métiers | Support (N1), Développeur (N2), Ingénieur senior/data (N3), Product manager (N4), Commercial (N2) |
| Intrants | Capacité cloud, une matière première au prix volatil |
| Mécaniques propres | **Niveau technologique** du produit face à une frontière qui avance chaque trimestre (obsolescence : l'attractivité baisse avec l'écart) ; R&D en projets mesurés en développeur·trimestres, à issue incertaine ; **base d'utilisateurs** avec effet de réseau (`βn·ln(1 + users/networkUnit)`, cf. §4) ; revenus récurrents (abonnements) avec churn |
| Coûts | Environ 70 % de salaires, quasi fixes ; coût marginal faible, donc marge brute élevée |
| Différenciation | Innovation, prix (freemium ou abonnement), marketing, qualité (bugs, fonction du ratio de seniors) |
| Barrières | Entrée : talents rares et effet de réseau des leaders. Sortie : faibles (peu d'actifs physiques) |

### 5.4 Phase 4 (optionnelle)

- **Finance / banque** : bilan de crédits, risque de défaut corrélé au cycle,
  ratio de fonds propres réglementaire, marge d'intérêt dépendant du taux
  directeur.
- **Immobilier** : foncier limité par région, projets longs (6 à 12
  trimestres), loyers et valorisation très sensibles aux taux.

L'interface `SectorModule` est conçue pour ces deux secteurs : ils
n'exigeront pas de refonte.

## 6. Finance d'entreprise

- **États financiers** (cf. `ARCHITECTURE.md` §5) produits chaque trimestre,
  avec l'invariant actif = passif.
- **Impôt sur les sociétés** forfaitaire (`finance.taxRate`) sur le résultat
  positif, avec report des déficits.
- **Dette bancaire** : `taux = directeur + spread(notation)`. La notation
  (AAA à CCC) dépend de dette nette / EBITDA et de la couverture des
  intérêts. Un covenant est déclaré : son bris entraîne un spread majoré et
  l'interdiction d'emprunter.
- **Découvert d'urgence** automatique à taux pénalisant si la trésorerie
  devient négative.
- **Difficulté puis faillite** : après `finance.distressQuarters` trimestres
  de fonds propres négatifs et de découvert, la société fait faillite.
  Le joueur perd (hors bac à sable) ; une IA est liquidée et ses actifs mis
  aux enchères, que le joueur peut racheter.

## 7. Bourse simulée

Le but est que la mécanique soit visible et jouable dès la phase 1, puis
enrichie aux phases 2 et 3.

**Valeur fondamentale** (par action) :
- `VE = EBITDA_12mois × multiple_secteur × f(croissance) × g(taux)`. Pour
  une société en perte (tech en croissance), on mélange avec
  `VE/CA × CA` selon la rentabilité.
- `F = (VE − dette nette + actifs financiers) / actions`, avec un plancher à
  la valeur liquidative puis à `stockMarket.minPrice` (> 0). Le cours est
  aussi borné à `minPrice` : `ln(F/P)` reste toujours fini.

**Formation du cours** :

```
ln P_t = ln P_{t−1} + λ·ln(F / P_{t−1})             # retour vers le fondamental
         + β·r_marché                                # sentiment global (macro, taux, krach)
         + θ·surprise_résultats                      # écart au consensus (tendance lissée)
         + γ·(achats_nets / flottant)                # impact des ordres (joueur et IA)
         + σ·ε                                       # bruit
```

- **Indice** pondéré par les capitalisations des sociétés cotées.
- **Liquidité** : au plus `stockMarket.maxFloatPerQuarter` (par exemple
  10 %) du flottant échangé par acteur et par trimestre. On ne prend donc
  pas 51 % d'une société en bourse en un tour : il faut une OPA.
- **Information** : les sociétés cotées publient leurs résultats avec un
  trimestre de retard ; les sociétés non cotées ne donnent qu'une estimation
  annuelle bruitée.

**Actions possibles, par phase** :

| Phase | Mécanique |
|---|---|
| 1 | Cotation des concurrents IA (cours, historique, indice). Cours de la société du joueur, cotée dès le départ avec environ 40 % de flottant. Achat et vente de participations minoritaires (actifs financiers à la juste valeur dans le bilan) |
| 2 | Introduction en bourse d'une filiale, augmentation de capital (dilution), dividendes, rachat d'actions. Franchissement de 50 % : filiale consolidée. **OPA amicale** (prime, acceptation par le flottant selon la prime) |
| 3 | **OPA hostile**, contre-offre de l'IA (chevalier blanc), défenses (pilule empoisonnée selon le profil), seuils déclaratifs (5, 10, 20, 33 %) qui déclenchent des réactions de l'IA, OPA obligatoire à 30 %, paiement en titres (échange d'actions), fonds activiste IA optionnel |

**Acceptation d'une OPA** : le flottant est découpé en tranches
d'investisseurs, chacune avec une prime exigée tirée d'une distribution
(`stockMarket.tenderPremiumDist`). Une tranche apporte ses titres si la prime
offerte dépasse sa prime exigée. L'IA cible peut recommander ou combattre
l'offre selon son profil et la prime.

## 8. Rachats et filiales (phase 2)

- **Cibles** : concurrents (cotés ou non), sociétés en difficulté, et
  sociétés générées dans d'autres secteurs (« pépites » non cotées).
- **Due diligence** : un coût et un tour de délai pour réduire le bruit sur
  les comptes de la cible et révéler d'éventuels passifs cachés tirés à la
  génération (litige, dette sociale).
- **Valorisation** affichée : multiples, DCF simplifié et fourchette ; prime
  de contrôle attendue.
- **Financement** : trésorerie, dette d'acquisition (LBO léger, limité par
  le levier), émission d'actions ou échange de titres.
- **Intégration** : coût et durée d'intégration ; risque social (départs de
  talents).

## 9. Conglomérat (phase 3)

- **Holding** : société de tête de secteur `holding` qui détient des
  filiales. Elle permet la remontée de dividendes, les prêts intra-groupe et
  le cash pooling.
- **Synergies** :
  - achats mutualisés : la remise volume est calculée sur le volume du
    groupe ;
  - marque partagée : une partie de la marque de la holding profite aux
    filiales, et un scandale se propage aussi ;
  - fonctions support partagées : frais généraux réduits ;
  - transferts de trésorerie entre filiales.
- **Coûts de la diversification** : frais de holding
  `base × n_filiales^1.3 × n_secteurs` ; **capacité managériale** (chaque
  filiale consomme de l'attention et, au-delà de la capacité, toutes les
  filiales subissent un malus d'efficacité) ; décote de conglomérat sur le
  cours de la holding.
- **Reporting** : comptes par filiale ; comptes consolidés (intégration
  globale au-delà de 50 % avec intérêts minoritaires, élimination des flux
  intra-groupe) ; participations minoritaires à la juste valeur.

## 10. IA concurrente

**Contraintes** : l'IA ne voit qu'une `Observation` et ses décisions passent
par la même validation que celles du joueur, sans ressources illimitées.

**Profils** (paramètres dans `ai.profiles`) :

| Profil | Prix | Qualité/R&D | Salaires | Risque | Spécificité |
|---|---|---|---|---|---|
| Low-cost | Coût + marge faible | Bas | Au marché | Modéré | Volume, réagit fort aux baisses de prix |
| Premium | Coût + marge haute | Haut | Au-dessus du marché | Faible | Défend sa marque, réagit peu aux prix |
| Innovateur | Moyen | R&D élevée | Haut (N3) | Élevé | Course technologique, surenchère sur les talents |
| Opportuniste | Variable | Moyen | Variable | Élevé | Exploite les ruptures de stock des autres et les sociétés en difficulté |
| Conglomérat | Moyen | Moyen | Au marché | Modéré | Rachats, diversification, OPA |

**Modules du planner** (heuristiques et bruit, pas d'optimiseur) :
1. **Prévision** : lissage exponentiel de la demande, des prix des matières
   et des salaires.
2. **Production** : vise une couverture de stock de produits finis
   (`ai.targetCoverage`).
3. **Prix** : coût complet + marge du profil, ajusté aux prix observés des
   concurrents. **Guerre des prix** : si un rival baisse de plus de X % et
   que la part perdue dépasse Y, l'IA riposte avec une probabilité égale à
   son agressivité.
4. **RH** : effectifs déduits du plan de production. Si l'IA perd des
   salariés au profit d'un concurrent qui paie plus, elle surenchérit
   jusqu'à une borne.
5. **Achats** : part sous contrat selon l'aversion au risque, achats spot
   opportunistes quand le prix est bas.
6. **Capex** : investit si l'utilisation des capacités dépasse le seuil et
   que la trésorerie et le levier le permettent.
7. **Marketing et R&D** : en pourcentage du CA selon le profil, avec contre-
   lancement si un rival gagne en qualité ou en technologie.
8. **Finance et M&A** (phase 2+) : rachat préventif d'une cible quand le
   joueur y franchit un seuil déclaratif, chevalier blanc, rachat de
   sociétés en faillite.

**Mémoire** (`aiMemory`) : rancune envers un rival agressif, dernière
riposte, cibles surveillées. Elle rend les réactions cohérentes dans le
temps.

## 11. Événements aléatoires

Ils sont décrits en données dans `config.events`. Chaque événement a une
probabilité par trimestre, des conditions (saison, régime macro, secteur),
des cibles (marché, région, entreprise) et des modificateurs (opération,
valeur, durée, décroissance). Exemples : grève régionale, crise énergétique,
pénurie de composants, sécheresse, nouvelle réglementation (coût de
conformité), innovation disruptive (saut de la frontière technologique),
krach boursier, hausse surprise des taux, scandale qualité.

Le rapport de tour présente chaque événement avec son impact chiffré sur le
joueur.

## 12. Objectifs et fin de partie

Modes configurables (`victory`) :
- **Bac à sable** : pas de fin, faillite optionnelle.
- **Capitalisation** : atteindre X € de valeur de groupe en N tours.
- **Domination** : plus de Y % de part d'un marché pendant 4 trimestres
  consécutifs.
- **Survie** : tenir N tours avec un scénario hostile.
- **Conglomérat** : au moins 3 secteurs, chacun rentable pendant 4
  trimestres.

Le score affiché en continu est la valeur de la participation du joueur
dans sa société de tête (cours × actions détenues, ou valorisation si elle
n'est pas cotée).

## 13. Choix d'implémentation (lot 1.2)

Précisions retenues en codant les systèmes ; les coefficients sont dans
`config/default.ts`.

- **Modificateurs** : `(base + Σ add) × Π mul`, clés listées dans
  `MODIFIER_KEYS` (`config/schema.ts`). Un modificateur `global` s'applique
  partout. Ils vieillissent au début de l'étape `events` (décroissance, puis
  expiration). Comme `macro` passe avant `events`, un événement macro (taux,
  récession) agit à partir du trimestre suivant ; les autres agissent dès le
  trimestre du tirage. Un événement ne se cumule pas avec lui-même.
- **Macro** : le choc de taux s'ajoute au taux de base lissé
  (`macro.baseRate`) sans s'accumuler. `demandIndex` suit
  `ln d = ρ·ln d₋₁ + k·(g − tendance)/4`.
- **Travail** : l'offre de salaire s'applique à tout le groupe de salariés
  du bassin. Les postes vacants V incluent ceux de l'économie hors
  simulation (`labor.outside.vacancyRate`), ce qui place la tension à sa
  cible au départ. L'économie hors simulation converge vers un chômage cible
  qui dépend du cycle. Les recrues du trimestre ne partent pas et ne sont
  pas formées ; les stagiaires partent moins. La formation déplace aussi la
  personne d'un bassin à l'autre (`laborForce`).
- **Matières** : l'énergie (non stockable) est achetée à la consommation
  (contrats d'abord, take-or-pay sur le volume inutilisé, puis spot). Son
  prix spot se forme sur la consommation prévue. Les ordres à cours limité
  sont réduits par tranches tant que `P > limite`.
- **Production** : la qualité visée (`pricing[ligne].qualityTarget`)
  augmente la consommation de matières ; la qualité atteignable dépend du
  ratio d'ingénieurs et du niveau technologique. Les produits finis sont
  valorisés au coût matière ; les salaires sont des charges de période.
- **Comptabilité** : les fonds propres ne bougent qu'avec le résultat net,
  donc actif = passif vérifie réellement chaque flux. Intérêts sur l'encours
  après les opérations de début de trimestre, puis échéances constantes des
  prêts. Découvert automatique pour que la trésorerie finisse ≥ 0. Impôt
  payé dans le trimestre.
- **Crédit** : capacité d'emprunt = max(marge sous le covenant, LTV sur les
  actifs immobilisés) ; aucune pendant un bris de covenant. Les dépenses
  discrétionnaires sont plafonnées par la liquidité disponible.
- **Faillite** : la société est gelée (plus de décisions, de production ni
  de ventes) et ses salariés retournent au marché du travail. Les enchères
  sur ses actifs viendront avec les rachats (phase 2).
- **Pas encore implémenté** : dividendes et opérations sur actions
  (phase 2). `capex` est arrivé avec le lot 1.3 (§14), `rnd` avec le
  lot 1.4 (§15).

## 14. Choix d'implémentation (lot 1.3)

- **Capex** (étape 4) : un investissement est payé à la commande, au niveau
  de prix du début de trimestre (`buildCost × landCostIndex` pour une usine),
  et immobilisé aussitôt ; un actif en chantier n'est ni amorti, ni
  entretenu, ni productif. Mise en service à `completesAt` (usine :
  `factory.buildQuarters`, ligne : `line.buildQuarters`, jamais avant son
  usine). La modernisation arrête la ligne `modernizeQuarters` trimestres,
  puis ajoute `modernizeTechGain` au niveau techno (plafond `maxTechLevel`)
  et remet l'âge à 0 ; son coût s'ajoute à la VNC et à la dotation. Chaque
  actif porte sa dotation trimestrielle. Une cession rapporte
  `VNC × (1 − assetResaleDiscount)` ; la moins-value est passée en dotations.
  Les investissements sont financés par la trésorerie et la dette nouvelle
  (pas par le découvert) et réduisent d'autant le budget des dépenses
  discrétionnaires. Limites : `factory.maxSites`, `factory.maxLines`.
- **Observation** (`ai/observation.ts`) : la seule porte de `GameState` vers
  l'IA et la base de `PlayerView`. Elle contient la société de l'acteur en
  entier, les marchés, et pour les autres : prix et qualité en rayon,
  rupture de stock (oui/non), part de marché, marque, usines visibles,
  notation, comptes publiés avec `publicationLagQuarters` de retard. La
  demande adressée à chaque ligne rivale reste privée. Une règle ESLint
  interdit au planner d'importer l'état, les systèmes ou le contexte de tour,
  et un test vérifie que modifier les données privées d'un rival ne change ni
  l'observation ni les décisions.
- **Planner IA** : prévision par lissage exponentiel de la demande
  désaisonnalisée (avant limite de stock) et des prix **mondiaux** des
  matières (le spot du trimestre passé reflète surtout la demande passée :
  s'en servir créait un cycle d'achats de période 2) ; production = prévision
  + `targetCoverage` × demande suivante − stock ; effectifs déduits du plan
  (opérateurs par la productivité observée, ingénieurs au moins au ratio de
  support car ils jouent sur la productivité) ; prix = coût complet (charges
  fixes réparties sur au moins `costingUtilization` de la capacité, sinon la
  marge sur coût complet s'emballe quand le volume baisse) × marge du profil,
  mélangé géométriquement au prix moyen des rivaux × positionnement, variation
  bornée à `maxPriceChange` par trimestre et plancher au coût variable ;
  achats calés sur max(plan, prévision) pour éviter l'effet coup de fouet ;
  contrats à hauteur de `riskAversion` des besoins ; capex selon
  l'utilisation des capacités, la trésorerie et le levier ; emprunt quand la
  trésorerie projetée passe sous le coussin, remboursement au-delà.
- **Guerre des prix** : un rival baisse de plus de `priceCutTrigger` et la
  part de l'IA recule de plus de `shareLossTrigger` → riposte avec une
  probabilité égale à l'agressivité (un tirage par planification, utilisé ou
  non), remise `discount` qui s'éteint en `durationQuarters`, délai
  `cooldownQuarters`, rancune en mémoire. La riposte est une nouvelle publique
  du journal (`ai_price_war`).
- **Surenchère salariale** : départs au-dessus de `attritionTrigger` × le
  taux de base, ou plus de `hiringShortfallTrigger` des embauches demandées
  non obtenues → prime `+step` (plafond `max`), qui retombe de `decay` sans
  pression. Les flux du trimestre sont gardés par groupe (`Staff.lastQuarter`).
- **Bourse v1** (étape 11) : fondamental sur les comptes publiés
  (`w·EBITDA·multiple + (1 − w)·CA·multiple de CA`, `w` selon la marge
  d'EBITDA, × croissance × taux), plancher à la valeur liquidative ;
  facteur de marché = bruit − sensibilité × variation du taux directeur +
  sensibilité × variation de ln(demande) ; surprise = écart de l'EBITDA publié
  au consensus (lissé). Les ordres s'exécutent au nouveau cours, qui inclut
  leur propre impact ; un ordre à cours limité non respecté ou non couvert
  par la trésorerie est réduit puis on recalcule. Liquidité :
  `maxFloatPerQuarter` du flottant par détenteur et par trimestre ;
  participation plafonnée à `maxMinorityStake` (pas de contrôle en phase 1) ;
  pas d'ordre sur ses propres titres (rachats : phase 2). Les participations
  sont à la juste valeur : variation et plus-values passent en résultat
  financier (`pnl.financial`, non imposé), après l'étape comptable, avec la
  trésorerie et le flux d'investissement du trimestre. Une société en
  faillite est radiée au cours plancher. Indice chaîné pondéré par les
  capitalisations.
- **Vues** : `defaultDecisions` reconduit prix, qualité visée, salaires,
  objectifs de production et marketing, sans les opérations ponctuelles
  (capex, contrats, emprunts, ordres, embauches, licenciements, formations) ;
  les achats spot sont recalculés pour couvrir la production prévue.
  `previewDecisions` rejoue financement et capex sur une copie puis estime
  le reste en espérance (embauches dans la limite des chômeurs, attrition
  moyenne, demande par réponse logit locale au prix et au marketing, rivaux
  supposés inchangés) : aucune information sur les décisions à venir des
  rivaux n'est utilisée. Le rapport de tour ne garde que les entrées
  publiques du journal et celles du joueur, et compare prévu et réalisé.
- **sim-cli** : le joueur est en pilote automatique (`playerProfileId`) ou
  passif (`defaultDecisions`). Bornes de sanité dans
  `packages/sim-cli/src/metrics.ts`.

## 15. Choix d'implémentation (lot 1.4)

- **R&D** (étape 9, `sectors.industry.rnd`) : deux types de projets, au plus
  un de chaque à la fois. Une décision `{ type, budget }` finance le projet
  en cours de ce type, ou en démarre un. Le coût d'un projet est fixé à son
  démarrage : `baseCost × (1 + costGrowthPerLevel × niveau) × niveau des
  prix`. Le budget d'un trimestre est plafonné à `maxSpendShare` du coût
  (durée minimale) et au reste à financer ; c'est une dépense discrétionnaire
  (réduite avec le marketing faute de liquidités), passée en charges
  (`pnl.rnd`). Avancement du trimestre = `budget / coût × U[1 − bruit,
  1 + bruit]` (`progressNoise`) : un projet peut dépasser son budget. À 100 %,
  il ajoute un niveau (plafond `maxLevel`), effectif dès le trimestre
  suivant.
  - **Procédés** (`Company.processLevel`) : productivité des opérateurs
    × `(1 + productivityPerLevel × niveau)` et qualité atteignable
    + `qualityPerLevel × niveau`.
  - **Produit** (`ProductLine.techLevel`) : qualité atteignable
    + `qualityPerLevel × niveau`.
  - **Obsolescence** : chaque niveau perd `obsolescencePerQuarter` par
    trimestre (les rivaux rattrapent). Les nouveaux projets sont chiffrés au
    niveau du début de trimestre, comme dans la validation.
- **IA** : `rndShareOfRevenue` du CA attendu, réparti entre procédés
  (`rndProcessShare`) et produit ; la marge du prix de revient couvre
  marketing et R&D.
- **Vues** : `defaultDecisions` reconduit aussi les budgets de R&D (un
  budget dont le projet s'est achevé lance le suivant) ; `previewDecisions`
  compte la R&D dans l'EBITDA et la trésorerie estimés et donne les besoins
  en matières de l'objectif de production (`materialNeeds`). `PlayerView.costs`
  chiffre les décisions ponctuelles du trimestre (usine par région, ligne,
  modernisation, valeur de cession de chaque actif, projet de R&D et budget
  maximal), pour que l'UI n'ait aucun calcul de règle à refaire. Le journal
  (`rnd_started`, `rnd_completed`) reste privé.
- **UI** (`packages/web`) : React + Vite, état `zustand`, graphiques
  `recharts`, Tailwind. Le brouillon de décisions part de
  `defaultDecisions` et l'aperçu (`previewDecisions`) se recalcule à chaque
  modification. Sauvegardes dans IndexedDB (`idb-keyval`) : slots manuels,
  autosave en rotation sur les 3 derniers tours, export/import du
  `SaveFile` en JSON (migré au chargement).


## 16. Choix d'équilibrage (lot 1.5)

Mesuré avec `npm run sim -- --games 50 --turns 40` (seeds 1 à 50).

- **Prix de référence calé sur le coût** : à 320 €, le coût complet d'une
  société de départ à 85 % de charge (~300 €) dépassait presque le prix ;
  les IA montaient leurs prix d'un tiers en termes réels, les volumes
  tombaient à ~70 % de la capacité et les marges s'écrasaient. À 365 €, le
  marché démarre près de son équilibre.
- **Régions = arbitrage** : l'écart de salaires (1,15 contre 0,92) écrasait
  l'écart logistique (8 €/unité). Salaires resserrés (0,96 à 1,06), logistique
  à 20 €/unité, plus chère loin de la Capitale. Le joueur (Capitale) n'est
  plus handicapé par sa région.
- **Qualité payante** : +2,5 % de matières par point au-delà de 50 (au lieu
  de 1 %), segment qualité à 35 % et `betaQuality` 0,05 ; premium vise 65.
  Le premium restait seul gagnant (jusqu'à 63 % du marché).
- **Faillites** : un bilan de départ plus endetté (dette 16 M€, trésorerie
  4 M€ : dette nette ≈ 2,5 × EBITDA, cohérent avec BBB) et un low-cost à
  marge fine, sous le marché. Le low-cost est le profil fragile (~20 % de
  faillites sur 40 tours). Au tour 0, la banque ne prête pas encore (pas
  d'EBITDA publié et dette au-dessus de la LTV) ; elle prête dès le
  trimestre suivant.
- **Bourse** : `earningsSurprise` 0,3 et `noise` 0,04 (volatilité ~16 %).
- **Mesure du joueur** (`sim-cli`) : rang par gain de fonds propres et
  premier trimestre d'une avance tenue 4 trimestres. Le pilote automatique
  premium sert d'approximation d'un joueur attentif.

| Indicateur (50 parties) | Cible | Résultat |
|---|---|---|
| Faillite des IA | 5–20 % | 7,3 % |
| Marge nette médiane | 4–10 % | 7,8 % |
| Dérive des salaires réels | ±15 % | +4,9 % |
| Volatilité des matières / des cours | 5–15 % / 8–20 % | 13,4 % / 16,5 % |
| Part de marché max | < 60 % | 47,9 % |
| Joueur passif 1er | jamais | 0/50 |
| Joueur « premium » en tête | 12–20 tours | 15/50 parties, tour 15 en médiane |

Limite connue : en mode passif, si le joueur et le low-cost font faillite,
le duopole restant peut dépasser 60 % (1 partie sur 50, 74 %).

## 17. Choix d'implémentation (lot 2.1 : agroalimentaire)

- **Secteurs « à usines »** : industrie et agro partagent le même modèle
  (usines, lignes, opérateurs, recette, qualité, R&D), dans `sectors/plant/`,
  paramétré par `sectors.<secteur>` (même schéma zod). L'agro y ajoute ses
  propres blocs (`farm`, `weather`, `listing`, `startingFarms`). La section
  `sectors.agri` est facultative : une ancienne sauvegarde continue sans agro.
- **Monde** : 3 IA par secteur (`scenario.aiCompetitors[].sector`). Les IA du
  secteur du joueur tournent sur les régions autres que la sienne, celles des
  autres secteurs sur toutes les régions. Le joueur peut déjà démarrer en agro
  (`scenario.playerSector`) ; l'écran de choix arrive au lot 2.5.
- **Saisons** : récolte en T3 (`farm.harvestSeason`) ; céréales et oléagineux
  moins chers après la récolte, lait bon marché au printemps (`seasonality`) ;
  demande alimentaire plus forte en T4.
- **Météo régionale** (étape 2, système `weather`) :
  `ln w = ρ·ln w_prev + σ·(√c·ε_commun + √(1−c)·ε_région)`, bornée. Le
  rendement d'une région vaut `w × modificateurs agri.yield` (sécheresse
  `ev_drought` : ×0,6). Le prix des cultures suit la récolte nationale
  (moyenne pondérée par les terres) : `P × rendement_national^(−weatherSensitivity)`.
- **Terres limitées et fermes** : `farm.landByRegion` hectares par région,
  achetables par ferme de `farm.hectares` (ordre `buy_farm`, une mise en
  culture d'un trimestre, au plus `farm.maxFarms`). Récolte =
  `ha × rendement × w × min(1, ouvriers/cible) × (1 + bonus × min(1, agronomes/cible))`,
  entrée en stock de céréales au coût de l'engrais épandu (les salaires sont
  des charges de la période). La terre n'est pas amortie (`Site.landValue`)
  et se revend avec une décote de 10 %.
- **Périssabilité** (étape 8b, système `perishability`) : en fin de
  trimestre, chaque stock perd `perishRate` (matières : lait 60 %, céréales
  2 %) ou `finishedGoodsPerishRate` (produits alimentaires : 10 %). La valeur
  perdue passe en coût des ventes.
- **Référencement** : `distribution ∈ [0, 1]` par ligne de produit, terme
  `βd · distribution` dans le logit (βd = 3 pour l'alimentaire, 0 pour
  l'électroménager). `d' = d·(1−δ) + (1 − d·(1−δ))·(1 − exp(−frais / (unité × niveau des prix)))`.
  Les frais (décision `listing`) sont une charge commerciale, comptée avec le
  marketing. L'IA paie ce qu'il faut pour revenir à
  `ai.listing.targetDistribution`, dans la limite d'une part du CA.
- **Métiers et matières** : ouvrier agricole, opérateur agroalimentaire,
  technicien qualité, agronome ; commercial et cadre restent transversaux
  (viviers agrandis). Céréales, oléagineux, lait, emballages, engrais (non
  stockable, acheté à la récolte) ; l'énergie est partagée.
- **IA agro** : mêmes profils, ajustés par `ai.sectorProfiles.agri` (marges
  plus fines : low-cost +2 %, opportuniste +8 %, premium +15 %).

Équilibrage mesuré avec `npm run sim -- --games 50 --turns 40` (seeds 1 à 50,
joueur industriel en pilote automatique) :

| Indicateur (50 parties) | Cible | Résultat |
|---|---|---|
| Marge nette médiane agro | 3–8 % | 5,8 % (low-cost 3,1 %, opportuniste 6,3 %, premium 6,5 %) |
| Marge nette médiane industrie | 4–10 % | 7,7 % |
| Faillite des IA industrie / agro | 5–20 % | 6,7 % / 0 % |
| Part de marché max (tous marchés) | < 60 % | 49,1 % |
| Volatilité des matières / des cours | 5–15 % / 8–20 % | 12,3 % / 14,7 % |
| Joueur passif 1er (de son secteur) | jamais | 0/50 |
| Joueur « premium » en tête | 12–20 tours | 23/50 parties, tour 17 en médiane |

Limite connue, pour le lot 2.5 : aucune IA agro ne fait faillite (même un
low-cost sans marge reste solvable : secteur peu capitalistique, peu
endetté). Le taux global de faillite des IA tombe donc à 3,3 %. Le volume de
base du marché alimentaire est calé pour 3 sociétés ; avec un joueur agro,
il faudra le recaler.

## 18. Choix d'implémentation (lot 2.2 : technologie)

- **Secteur sans usine** : `sectors.tech` a son propre schéma (pas de lignes).
  Une société SaaS a des **bureaux** (`Site.kind = 'office'`, `seats` places,
  ordre `build_site` : aménagement `office.buildCost × indice foncier`, un
  trimestre, loyer `office.upkeep` par trimestre, revente avec décote) ; on
  n'embauche que dans la limite des places libres de la région. Une « unité »
  est un abonné facturé un trimestre ; il n'y a ni stock ni production. La
  section `sectors.tech` est facultative : une ancienne sauvegarde continue
  sans tech.
- **Métiers et matière** : support (N1), développeur (N2), ingénieur senior
  (N3), product manager (N4) ; commercial transversal (vivier agrandi). La
  **capacité cloud** (`com_cloud`, volatile, non stockable) est achetée à la
  consommation : `cloudPerUser` par abonné facturé, en coût des ventes.
- **Abonnements** (étape 8) : le flux de nouveaux abonnés
  `Q = base · saison · cycle · (prixMoyen/prixRéf)^(−ε)` est partagé par le
  logit, avec l'effet de réseau `βn · ln(1 + abonnés / networkUnit)` et l'écart
  à la frontière `βt · (niveau − frontière)`. Chaque base perd son churn :
  `churnBase · (prix/prixMoyen)^2 · (1 + 1,5·retard) · (1 + 0,6·(50 − qualité)/50)
  · (1 + (1 − couverture du support))`, borné. Facturés = moyenne des abonnés
  d'ouverture et de clôture ; CA = facturés × prix (prix par abonné et par
  trimestre). Parts de marché = parts des abonnés facturés.
- **Qualité** (étape 7, « bugs ») : tend vers
  `base + poids · min(1,5, seniors / cible) − 30 · (1 − couverture de
  maintenance) + bonus plateforme`. Les développeurs qui ne sont pas sur un
  projet maintiennent `usersPerDeveloper` abonnés chacun.
- **Frontière technologique** (étape 9) : `ProductMarket.techFrontier`
  avance de `advancePerQuarter` par trimestre, plus le modificateur
  `tech.frontier` (événement `ev_disruptive_innovation` : +0,15 d'un coup).
- **R&D en développeur·trimestres** : la décision `rnd[].developers` affecte
  des développeurs (budget nul) ; leurs salaires passent de `wages` à `rnd`.
  Un développeur apporte `1 + 0,5 · min(1, couverture des seniors)`
  développeur·trimestre, × bruit ; au plus `maxEffortShare` de l'effort par
  trimestre (deux trimestres minimum). Une **version** (projet produit, 160
  dév·trim.) ajoute `releaseGain × U[0,5 ; 1,5] × (1 + 0,3 · couverture PM)`
  plus **30 % du retard** (imitation : rattraper coûte moins qu'innover),
  sans dépasser `frontière + maxLead`. Un projet **plateforme** (procédés)
  ajoute un niveau : −8 % de cloud par abonné et +2 points de qualité par
  niveau, avec obsolescence. Sans imitation, un petit acteur ne suivait plus
  la frontière (effort absolu constant) et le leader dépassait 70 % du marché.
- **IA tech** : prévision lissée des nouveaux abonnés et du churn ; effectifs
  = maintenance des abonnés attendus (× `ai.tech.staffingCover`) + R&D à
  `rndShareOfRevenue` du CA en développeurs, plus un **rattrapage** sur les
  versions au-delà de `gapTolerance` de retard (borné par la marge d'EBITDA,
  pour ne pas s'endetter) ; seniors au ratio qu'exige la qualité du profil,
  support par abonnés, PM par développeurs ; l'effectif est calé sur des
  projets à plein régime (pas de licenciement à chaque fin de projet). Prix :
  coût complet hors R&D réparti sur au moins `costingUtilization` des abonnés
  que l'équipe peut maintenir (pas de spirale quand la base fond), marge du
  profil, mélange avec le prix des rivaux, guerre des prix ; baisse si le
  produit, plus cher que la moyenne, perd ses abonnés plus vite que le churn de
  base. Bureau supplémentaire quand l'effectif dépasse les places.
- **Vues** : `PlayerView.costs` chiffre un bureau par région et les projets en
  développeurs (`effort`, `maxDevelopers`, places libres, frontière) ;
  `previewDecisions` estime les abonnés (`expectedUsers`) ; alertes
  `tech_behind` et `maintenance_short`. Les concurrents publient leurs abonnés
  et leur niveau technologique.
- **Bourse** : multiple d'EBITDA 12, multiple de CA 2,5 ; cotation initiale à
  12 × la valeur comptable (`initialPriceToBookBySector`), proche de la valeur
  fondamentale (une société SaaS a peu d'actifs). Financement de départ propre
  au secteur (trésorerie 6 M€, dette 4 M€).

Équilibrage mesuré avec `npm run sim -- --games 50 --turns 40` (seeds 1 à 50,
joueur industriel en pilote automatique) :

| Indicateur (50 parties) | Résultat |
|---|---|
| Marge nette médiane tech | 7,5 % (low-cost 2,7 %, opportuniste 10,0 %, premium 7,5 %) |
| Marge nette médiane industrie / agro | 8,5 % / 5,9 % |
| Faillite des IA industrie / agro / tech | 12,0 % / 0 % / 0 % (4,0 % au total) |
| Part de marché max : industrie / agro / tech | 47,9 % / 48,6 % / 46,2 % |
| Volatilité des matières / des cours | 12,5 % / 13,5 % |
| Dérive des salaires réels | +6,9 % |
| Joueur « premium » en tête (industrie) | 15/50 parties, tour 15 en médiane |
| Joueur tech en pilote automatique (`--sector tech`) | jamais en faillite, rang médian 2 |
| Joueur tech passif | toujours en faillite (sans R&D, le produit décroche de la frontière) |

Limites connues, pour le lot 2.5 : aucune IA tech ne fait faillite ; le taux de
faillite du low-cost industriel varie de 23 à 36 % selon la séquence d'aléa
(100 parties, variantes neutres), le taux global des IA reste sous la cible
(4 %). Le volume de base du marché logiciel est calé pour 3 sociétés. La
mesure « prend la tête » de sim-cli compte l'avance des premiers trimestres :
un joueur tech passif (qui ne dépense rien en R&D) mène au début avant de
s'effondrer.

## 19. Choix d'implémentation (lot 2.3 : IA avancée)

- **5 profils** (`ai.profiles`) : low-cost, premium, opportuniste, plus
  **innovateur** (R&D élevée, prime `skilledWagePremium` de 12 % sur les
  métiers N3 et N4, surenchère jusqu'à 30 %, contre-lancements quasi
  systématiques) et **conglomérat** (profil médian, risque modéré, surveille
  les sociétés en difficulté ; rachats au lot 2.4). Chaque profil porte ses
  réactions : `priceWarDepth` (profondeur des ripostes), `brandDefense`
  (marketing en plus quand une baisse de prix rivale coûte des parts),
  `counterLaunch` (probabilité de contre-lancement), `wageOutbidMax`
  (plafond de surenchère), `opportunism` (appétit pour les cibles en
  difficulté). Répartition par défaut, 3 IA par secteur : industrie
  low-cost / premium / opportuniste, agro low-cost / premium / conglomérat,
  tech low-cost / premium / innovateur.
- **Veille des rivaux** (premier module du planner, `ai/modules/rivals.ts`) :
  la mémoire (`AiMemory.rivals`) garde pour chaque rival en activité, joueur
  ou IA, sa rancune (qui s'éteint de `grudgeDecay` par trimestre), la qualité
  et le niveau technologique de son produit et le nombre de trimestres où il
  paraît fragile. Toutes les réactions s'appliquent de la même façon entre IA
  et contre le joueur, et chacune est une nouvelle publique du journal.
- **Guerre des prix** (`ai/modules/priceWar.ts`, état `AiMemory.priceWar`) :
  déclenchement inchangé (baisse > `priceCutTrigger` et part perdue >
  `shareLossTrigger`), avec une probabilité `agressivité + grudgeAggression ×
  rancune` ; remise `discount × profondeur`, qui s'éteint en
  `durationQuarters`. Un rival qui baisse encore pendant la guerre la fait
  **escalader** (+`escalationStep`, jusqu'à `maxDiscount`, × profondeur) et
  la rejoint. Sous `truceMargin` de marge d'EBITDA, l'IA signe une **trêve**
  (fin immédiate, aucune nouvelle guerre tant qu'elle saigne). Le premium
  répond surtout par la marque (profondeur 0,5, marketing +50 % quand il est
  attaqué). Une profondeur de 1,25 pour le low-cost le menait à 50 % de
  faillites : sa riposte reste à 1, son agressivité (0,7) suffit à le rendre
  réactif.
- **Surenchère salariale** : les offres d'emploi sont publiques
  (`CompetitorView.jobOffers` : salaire proposé avec les embauches du
  trimestre, gardé dans `StaffFlows.offered`). Sous pression (départs ou
  embauches manquées, comme au lot 1.3), si un rival affiche plus dans le même
  vivier, l'IA s'aligne d'un coup sur son offre + `step`, dans la limite de
  `wageOutbidMax`, et lui en garde rancune (`poachGrudge`) ; jamais sous
  `minMargin` de marge d'EBITDA. La nouvelle n'est publiée qu'une fois par
  rival tous les `cooldownQuarters` (8) : à 4, le journal en recevait plus
  d'une par trimestre.
- **Contre-lancements** : un rival dont la qualité gagne plus de
  `qualityJumpTrigger` points (ou le niveau technologique plus de
  `techJumpTrigger`) en un trimestre et dépasse le produit de l'IA déclenche,
  avec la probabilité `counterLaunch` du profil et hors délai
  `cooldownQuarters`, une campagne de `durationQuarters` : qualité visée juste
  au-dessus du rival (bornée à +`maxQualityBoost`), R&D produit +50 % (en
  tech : développeurs sur la version, dans la limite de ce que le projet
  absorbe) et marketing +30 %.
- **Opportunisme** : un rival paraît fragile s'il est en difficulté, noté B
  ou CCC, ou en perte sur ses `lossQuarters` derniers trimestres publiés ;
  au bout de `watchQuarters`, il entre dans la liste de surveillance
  (`AiMemory.watchlist`, réutilisée par les rachats du lot 2.4). S'il vend
  sur le même marché, il devient une proie : remise `predatoryDiscount ×
  opportunism` (sauf si l'IA saigne elle-même) et production prévue pour
  `captureShare × opportunism` de ses ventes. Avec 4 % et 30 %, le low-cost
  industriel, chassé par deux opportunistes (l'IA et le joueur en pilote
  automatique), faisait faillite une fois sur deux ; à 2 % et 15 %, 30 %
  (36 % avant ce lot).
- **Tension de trésorerie** : le planner compte ses dépenses discrétionnaires
  comme la validation (tous les achats spot, y compris ceux du plan de
  production) ; s'il ne peut pas les financer, il coupe d'abord marketing,
  référencement et R&D, puis les achats spot et les embauches, au lieu de
  subir la réduction proportionnelle de la validation.
- **Mémoire et sauvegardes** : `schemaVersion` 7. La migration v6 → v7
  transforme les rancunes en `rivals`, la remise de guerre en état de guerre,
  complète `StaffFlows.offered`, ajoute les paramètres des profils (le
  plafond de surenchère passe de `ai.wageOutbid.max` aux profils), les deux
  nouveaux profils et les sections `counterLaunch` et `opportunism`. Une
  ancienne partie garde ses concurrents.
- **sim-cli** compte les coups de l'IA par partie et la part qui vise une
  autre IA.

Équilibrage mesuré avec `npm run sim -- --games 50 --turns 40` (seeds 1 à 50,
joueur industriel en pilote automatique opportuniste, sauf mention) :

| Indicateur (50 parties) | Lot 2.2 | Lot 2.3 |
|---|---|---|
| Faillite des IA (toutes) | 4,0 % | 3,6 % |
| Faillite du low-cost industriel | 36 % | 30 % |
| Marge nette médiane industrie / agro / tech | 8,5 / 5,9 / 7,5 % | 7,2 / 5,6 / 8,1 % |
| Marge nette médiane innovateur tech / conglomérat agro | — | 8,2 / 6,1 % |
| Part de marché max (médiane des parties) | 46,1 % | 43,2 % |
| Volatilité des matières / des cours | 12,5 / 13,5 % | 12,4 / 13,4 % |
| Dérive des salaires réels | +6,9 % | +6,8 % |
| Joueur passif 1er | 0/50 | 0/50 |
| Joueur « premium » en tête (`--player premium`) | 15/50, tour 15 | 19/50, tour 19 |

Coups de l'IA par partie : 11 ripostes ou escalades de guerre des prix,
2 trêves, 32 surenchères salariales, 6 contre-lancements, 8 offensives
contre une cible en difficulté ; 60 à 100 % visent une autre IA selon le type.

Limites connues, pour le lot 2.5 :
- un joueur tech en pilote automatique opportuniste (`--sector tech`) finit
  premier dans 29 parties sur 50 (rang médian 2 au lot 2.2) : le profil
  opportuniste, le plus rentable en tech, n'a plus de pendant chez les IA du
  secteur. Sans low-cost en tech, les marges montent à 14 % ; sans premium,
  elles tombent à 2 %. Le profil opportuniste tech est à revoir avec
  l'équilibrage croisé ;
- comme au lot 1.5, une faillite peut laisser un duopole au-dessus de 60 % de
  parts (1 partie sur 50 en agro) ;
- le taux global de faillite des IA reste sous la cible (aucune faillite en
  tech, presque aucune en agro).

## 20. Choix d'implémentation (lot 2.4 : rachats et bourse v2)

- **Contrôle** (`core/control.ts`) : un détenteur (acteur ou société) contrôle
  une société dont il détient, avec les sociétés qu'il contrôle déjà, plus de
  `mna.controlThreshold` (50 %) du capital. Le joueur décide pour toutes les
  sociétés de son groupe (`controlledCompanyIds`). Une société sans décision
  soumise est menée par sa **direction en place** : le profil de son
  fondateur IA (même après un rachat), celui d'une pépite rachetée, sinon
  `mna.delegatedProfileId`. La société de tête du joueur n'est jouée par le
  planner qu'en pilote automatique ; ses filiales le sont tant que le joueur
  ne décide pas pour elles. La mémoire de l'IA est tenue par société.
- **Opérations sur capital** (étape 3, sociétés cotées) : dividende (dans la
  trésorerie et les fonds propres ; interdit en difficulté ou en bris de
  covenant ; versé au prorata du registre, les sociétés actionnaires le
  comptent en résultat financier non imposé ; le cours baisse du dividende par
  action), augmentation de capital (au plus `capital.maxIssueShare` du capital
  par trimestre, au cours × (1 − `issueDiscount`), frais déduits, et jamais au
  point de faire perdre le contrôle à l'acteur qui contrôle la société),
  rachat d'actions (au plus `maxBuybackShare` du capital et `maxFloatPerQuarter`
  du flottant, au cours × (1 + `buybackPremium`), actions annulées). Le cours
  passe à la moyenne pondérée avec le prix de l'opération. Les fonds propres
  bougent avec le résultat et ces opérations : actif = passif reste vérifié.
- **Introduction en bourse** d'une société non cotée (une filiale) après
  `ipo.minQuarters` trimestres clos : actions nouvelles vendues au public pour
  qu'il détienne `ipo.floatShare` (30 %) du capital, au prix de la valeur
  fondamentale de ses propres comptes × (1 − `ipo.discount`), frais déduits ;
  la société mère garde le contrôle.
- **Valeur fondamentale par action** : divisée par les actions en circulation
  à la clôture du dernier trimestre publié (`Statements.shares`), pour qu'une
  émission ne soit pas comptée dans le cours avant d'apparaître dans les
  comptes publiés.
- **Pépites** (`systems/mna/listings.ts`) : en fin de trimestre, avec la
  probabilité `listings.arrivalProbability` et au plus `maxOpen` à la fois,
  une société non cotée est mise en vente pour `durationQuarters` : secteur
  (parmi ceux qui ont des sociétés actives), région, taille (× `scale` d'une
  société de départ) et profil de direction tirés au hasard. Ses chiffres
  annuels réels = moyennes par unité de taille du secteur × sa taille ×
  performance tirée (± `performanceSpread`) ; le public n'en voit qu'une
  estimation bruitée (± `estimateNoise`). Prix demandé = milieu de la
  valorisation (au moins 80 % de ses fonds propres comptables) × (1 + prime
  tirée dans `askPremium`). Un passif caché (litige, dette sociale) existe avec
  la probabilité `hiddenLiability.probability`. Elle ne devient une société
  simulée qu'une fois achetée : construite à sa taille, non cotée, détenue à
  100 %, ses salariés pris à l'emploi hors simulation.
- **Audit d'acquisition** : payé au début du trimestre
  (max(`minCost` × niveau des prix, `costShareOfValue` × valeur de la cible)),
  résultats utilisables dès le trimestre suivant et pendant `validQuarters` :
  chiffres annuels réels (pour une société existante, ses quatre derniers
  trimestres sans décalage de publication), dette nette et passif caché. Un
  passif révélé est déduit du prix de la pépite (garantie de passif) ; révélé
  ou non, il frappe les comptes de la société au premier trimestre après
  l'achat. Les sociétés existantes n'ont pas de passif caché.
- **Valorisation** (`core/valuation.ts`, montrée au joueur et utilisée par
  l'IA) : multiples boursiers (même formule que la valeur fondamentale) et DCF
  simplifié (flux = EBITDA × `fcfShareOfEbitda`, croissance qui rejoint
  `terminalGrowth` sur `horizonYears` ans, actualisation au taux directeur +
  `equityRiskPremium`, valeur terminale de Gordon), fourchette de ± `rangeWidth`
  / 2 autour des deux méthodes, prime de contrôle attendue `controlPremium`.
- **Rachats** (étape 12, sur la trésorerie disponible après la clôture) : une
  opération par société et par trimestre ; sur une même cible, la meilleure
  offre par action l'emporte. Rachat de gré à gré du **bloc** de l'actionnaire
  qui détient seul le contrôle, s'il obtient la prime qu'il demande
  (`sellPremium` de son profil, × `distressedSellFactor` si la société est en
  difficulté) ; **OPA amicale** sur une société cotée : il faut l'accord du
  conseil (même règle), puis le fondateur apporte ses titres, chaque autre
  actionnaire selon sa propre prime et le flottant par tranches
  (`tenderPremiumDist`) ; l'offre ne réussit que si le groupe acheteur passe le
  seuil de contrôle, et au-delà de `squeezeOutThreshold` le reste est racheté
  au même prix et la société radiée. **Financement** : numéraire, dette
  d'acquisition (au plus `financing.maxDebtToEbitda` × l'EBITDA connu de la
  cible, avec une marge majorée de `spreadPremium`, aucune en bris de
  covenant), et actions nouvelles de l'acheteur (`stockShare`, au cours
  d'ouverture, dans la limite qui préserve son contrôle ; les vendeurs les
  revendent au public). Pas d'offre de l'IA sur une société du joueur
  (OPA hostiles et négociation : phase 3) ; le joueur n'est pas consulté
  quand une offre vise un titre qu'il détient en minoritaire.
- **Participations** : une participation dans une société du même groupe est
  inscrite à son coût (`Company.participations`), dépréciée sous sa valeur
  recouvrable (valeur de marché, ou valeur privée d'une société non cotée, ×
  (1 + `controlPremium`)) et reprise jusqu'au coût ; payer plus que la prime
  de contrôle se voit donc aussitôt en résultat financier. Une pépite reste au
  coût jusqu'à son premier trimestre clos. Les participations minoritaires
  restent à la juste valeur. Pas de consolidation avant le lot 3.1.
- **Intégration** après un changement de contrôle : `integration.quarters`
  trimestres de coûts (`costShareOfRevenue` du CA), de départs de talents
  (modificateur `labor.attrition` × `attritionMultiplier`) et de baisse de
  productivité (`labor.productivity` × `productivityMultiplier`).
- **IA** (`ai/modules/mna.ts`) : la tête de groupe d'un profil
  `acquisitiveness` > 0 (conglomérat 0,5, opportuniste 0,25), hors délai
  `ai.mna.cooldownQuarters` et sous `maxLeverage`, cherche avec cette
  probabilité par trimestre l'opération dont la valorisation × (1 +
  `valueMargin`) couvre le mieux le prix (pépites au prix demandé, rivaux à la
  prime de leur conseil + `extraPremium`, bloc de préférence à l'OPA), payable
  avec sa trésorerie, `debtShare` de dette et jusqu'à `stockShare` en actions.
  Elle commande un audit, puis enchérit au trimestre suivant si les chiffres
  révélés confirment l'affaire. Elle ne voit que l'`Observation` : estimations
  publiques, ses propres audits, registre public (contrôleur, bloc, prime
  demandée). Dividendes de l'IA cotée : `ai.dividends.payout` du résultat du
  dernier trimestre, sans emprunt, sous `maxLeverage` et avec
  `minCashQuarters` de trésorerie restante. L'IA ne fait ni augmentation de
  capital, ni rachat d'actions, ni introduction en bourse.
- **Vues** : `PlayerView.groupCompanies` (sociétés du groupe : part détenue,
  valeur, coût, intégration en cours), `PlayerView.deals` (chaque cible :
  chiffres connus, valorisation, prime demandée, bloc, coût d'audit, dette
  d'acquisition possible), `PlayerCosts.capital` (dividende maximal, prix et
  plafonds d'émission et de rachat, conditions d'introduction) ;
  `getPlayerView(state, companyId)` montre une filiale. `previewDecisions`
  compte les opérations sur capital, les audits et la partie en numéraire des
  rachats. Nouvelles entrées du journal : `dividend_paid`, `shares_issued`,
  `shares_bought_back`, `ipo`, `company_for_sale`, `takeover`,
  `tender_offer_rejected`, `integration_completed` (publiques),
  `due_diligence`, `hidden_liability`, `block_purchase_rejected`,
  `deal_failed` (privées).
- **Sauvegardes** : `schemaVersion` 8. La migration v7 → v8 ajoute le marché
  des rachats, les coûts de participation, les actions à la clôture de chaque
  trimestre, réindexe la mémoire de l'IA par société et ajoute les sections de
  configuration (les vieilles parties ont donc des pépites et des rachats).

Équilibrage mesuré avec `npm run sim -- --games 50 --turns 40` (seeds 1 à 50) :

| Indicateur (50 parties) | Lot 2.3 | Lot 2.4 |
|---|---|---|
| Faillite des IA (toutes) | 3,6 % | 3,8 % |
| Faillite du low-cost industriel | 30 % | 28 % |
| Marge nette médiane industrie / agro / tech | 7,2 / 5,6 / 8,1 % | 6,4 / 5,4 / 7,6 % |
| Part de marché max (max / médiane des parties) | 64,1 / 43,2 % | 55,1 / 42,9 % |
| Volatilité des matières / des cours | 12,4 / 13,4 % | 12,3 / 13,2 % |
| Dérive des salaires réels | +6,8 % | +6,9 % |
| Joueur opportuniste (pilote) 1er / rang médian | 0/50, 3 | 0/50, 3 |
| Joueur passif 1er | 0/50 | 0/50 |
| Joueur « premium » en tête (`--player premium`) | 19/50, tour 19 | 19/50, tour 13 |

Par partie : 0,8 prise de contrôle (0,5 pépite, 0,3 bloc ; dont 0,3 par le
joueur opportuniste en pilote automatique), 0,2 échec, ~100 dividendes versés. Les sociétés rachetées en cours de partie apparaissent sous le type
`acquired` de `sim-cli`. Les marges médianes baissent un peu : coûts
d'intégration, passifs cachés, dépréciations, et pépites rachetées souvent
déficitaires leur premier trimestre.

Limites connues, pour le lot 2.5 :
- l'IA préfère le bloc à l'OPA (moins cher) : aucune OPA de l'IA en 50 parties ;
  elle rachète surtout le low-cost industriel quand il fragilise (prime
  demandée réduite), ce qui le sauve rarement (la mère ne le recapitalise pas :
  prêts intra-groupe au lot 3.1) ;
- les pépites rachetées par l'IA perdent souvent de l'argent (marge médiane
  négative pour les profils innovateurs, petite taille et coûts fixes) ;
- le taux global de faillite des IA reste sous la cible de 5 %.

## 21. Choix d'implémentation (lot 2.5 : interface et équilibrage multi-secteurs)

- **Secteur de départ** : l'écran de nouvelle partie propose industrie,
  agroalimentaire ou technologie (`scenario.playerSector`, passé en override
  à `createGame`). Le joueur et 3 IA occupent son secteur, 3 IA chacun des
  deux autres.
- **Marchés dimensionnés** : `products.markets.<id>.referenceCompanies`
  (facultatif) donne le nombre de sociétés de départ pour lequel `baseVolume`
  est calé (électroménager 4, alimentaire 3, logiciel 3). À la génération, le
  volume est multiplié par `sociétés de départ du secteur / référence` : un
  joueur en agro ou en tech ne prend plus sa place aux IA, et l'industrie sans
  joueur perd un quart de son volume. La partie par défaut est inchangée
  (seul le hash du golden bouge, la configuration effective faisant partie de
  l'état ; aucune migration : le champ est facultatif et ne sert qu'à la
  génération).
- **Interface** (`packages/web`, aucune règle de jeu) :
  - décisions adaptées au secteur : en tech, prix par abonné, abonnés, churn
    et frontière ; bureaux (places libres) au lieu d'usines ; R&D en
    développeurs (plateforme et versions) ; en agro, achat d'exploitations
    (terres restantes par région) et frais de référencement (présence en
    rayon). L'aperçu montre les abonnés attendus en tech ;
  - opérations sur capital dans l'onglet Finance (dividende, augmentation de
    capital, rachat d'actions, introduction en bourse), bornées par
    `PlayerCosts.capital` ;
  - écran **Rachats & OPA** : pépites et autres sociétés avec chiffres
    (estimés, publiés ou audités), dette nette, fourchette de valeur, prix ou
    prime demandés ; audit en un clic ; offre (rachat de 100 % d'une pépite,
    bloc de contrôle ou OPA amicale) avec prix par action, dette d'acquisition
    et part payée en actions ; ajustements de la validation et OPA récentes ;
  - écran **Groupe** (version simple) : sociétés contrôlées, détenteur, part,
    valeur, coût, CA, résultat, trésorerie, fonds propres, intégration en
    cours ; sommes non consolidées. Chaque filiale est **gérée par sa
    direction en place** (le planner, lot 2.4) ou **reprise en main** : le
    store garde alors un brouillon par société (`drafts`) et les soumet tous
    à `resolveTurn` ; un sélecteur dans l'en-tête change la société affichée
    (`getPlayerView(state, companyId)`).
- **sim-cli** : `--sector all` enchaîne une campagne par secteur de départ et
  termine par un tableau croisé ; chaque secteur donne la médiane des parts
  de marché max et le nombre de parties au-dessus de 60 %.

Équilibrage croisé mesuré avec `npm run sim -- --games 50 --turns 40 --sector
all` (seeds 1 à 50, joueur en pilote automatique opportuniste) :

| Secteur de départ | Faillite des IA | Marge médiane | Joueur 1er / rang médian | Part max ind. / agro / tech (médiane, parties > 60 %) |
|---|---|---|---|---|
| Industrie | 3,8 % | 6,0 % | 0/50, 3 | 48,0 (37,3 ; 0) / 55,1 (42,1 ; 0) / 46,5 (40,9 ; 0) % |
| Agroalimentaire | 4,7 % | 5,7 % | 9/50, 2 | 66,9 (44,3 ; 7) / 44,5 (33,9 ; 0) / 46,1 (40,8 ; 0) % |
| Technologie | 3,6 % | 6,1 % | 14/50, 2 | 69,7 (45,7 ; 11) / 66,5 (42,2 ; 2) / 38,8 (34,8 ; 0) % |

Autres mesures (50 parties chacune) : joueur passif jamais premier en agro ni
en tech (rang médian 4) ; joueur « premium » en pilote automatique en tête
dans 19/50 parties en industrie (tour 13), 4/50 en agro, 3/50 en tech.
Effet du dimensionnement (joueur tech, mêmes seeds, dimensionnement neutralisé
par override) : joueur premier 21/50 → 14/50 ; faillite des IA 2,4 → 3,6 %
(industrie 4,0 → 8,7 %, le marché sans joueur étant plus petit) ; parties où
l'électroménager dépasse 60 % : 5 → 11 (toujours un duopole après la faillite
du low-cost). Salaires réels
+7 à +9 %, volatilité des matières ~12 %, des cours ~13 %, sans erreur ni
violation des bornes.

Variantes essayées et écartées (joueur industriel) : marge du low-cost tech à
0 % (`priceMarkup`) : marge 2,1 %, toujours aucune faillite ; départ tech plus
endetté (dette 8 à 10 M€) : quelques faillites tech, mais le cours initial
(12 × la valeur comptable) devient très inférieur à la valeur fondamentale et
sort des bornes de sanité dès le 4e trimestre.

Limites connues, pour la phase 3 :
- le taux global de faillite des IA reste juste sous la cible (3,6 à 4,7 %) :
  une société SaaS peu endettée ne fait pas faillite, même sans marge ;
- quand le joueur quitte l'industrie, le marché de l'électroménager n'a plus
  que 3 sociétés ; si le low-cost fait faillite (20 à 26 %), le duopole
  restant dépasse 60 % de parts (7 à 11 parties sur 50, toujours après cette
  faillite). Piste : faire entrer une pépite du secteur appauvri ;
- un joueur tech « prend la tête » dès les premiers trimestres (mesure de
  sim-cli, cf. lot 2.2), et le pilote premium, simple approximation d'un
  joueur attentif, mène rarement en agro et en tech ;
- l'IA ne lance toujours pas d'OPA (elle préfère le bloc) et les pépites
  rachetées restent souvent déficitaires.

## 22. Choix d'implémentation (lot 3.1 : holding et consolidation)

- **Holding de tête** (`systems/conglomerate/holding.ts`) : la société de tête
  d'un acteur qui la contrôle demande `createHolding` ; en fin de trimestre
  (étape 12), une société de secteur `holding` est créée, non cotée, sans
  dette ni trésorerie. L'acteur lui apporte toutes ses actions de l'ancienne
  tête contre autant d'actions de la holding (100 %) ; la holding les inscrit à
  leur valeur (actifs financiers = fonds propres) et devient
  `Actor.rootCompanyId`. Le trimestre de sa création compte comme clos (son bilan
  d'ouverture). Les comptes consolidés suivent la nouvelle tête ; un fondateur
  IA garde la direction de l'ancienne tête (`managementProfileId`). La holding
  n'a pas d'activité : pas de valorisation par les multiples, sa valeur
  fondamentale est la **somme des parties** (ses participations à leur valeur
  courante, + trésorerie + prêts accordés − dettes). Le score du joueur est sa
  part × la valeur d'une action de sa tête (le cours si elle est cotée). Le
  joueur perd si sa tête fait faillite, ou si sous une holding il ne contrôle
  plus aucune société opérationnelle. Frais de holding : lot 3.2.
- **Transferts intra-groupe** (`intraGroup`, `systems/conglomerate/transfers.ts`) :
  décidés par l'une des deux sociétés ou par la tête du groupe, entre sociétés
  opérationnelles du même groupe ; exécutés en fin de trimestre, société par
  société (par id) puis dans l'ordre donné, sur la trésorerie de clôture
  (validation : structure seulement ; les montants sont bornés à l'exécution) :
  - **prêt** : de A vers B, rembourse d'abord ce que A doit à B, puis prête le
    reste (un prêt par couple prêteur-emprunteur, `Loan.kind = 'group'`, sans
    échéances). Intérêts au taux directeur + `conglomerate.groupLoanSpread`,
    payés par l'emprunteur et reçus par le prêteur (charge d'intérêts nette,
    imposable). La banque ignore la dette intra-groupe (notation, covenant,
    capacité d'emprunt) ; elle reste une dette au bilan et dans la valeur
    fondamentale. Hors du groupe (changement de contrôle), on ne peut plus que
    rembourser ;
  - **dividende remonté** : la filiale verse un dividende total décidé par sa
    mère, au prorata du registre (les minoritaires touchent leur part), dans
    sa trésorerie et ses fonds propres ; interdit en difficulté ou en bris de
    covenant ; le cours d'une filiale cotée baisse du dividende par action ;
  - **cash pooling** : le membre garde le montant indiqué ; l'excédent est
    prêté au chef de pool, un manque est comblé par le chef de pool (dans sa
    trésorerie). C'est un ordre permanent (`defaultDecisions` le reconduit) ;
  - **cession de titres** (restructuration) : A cède à B des actions d'une
    société du groupe à leur valeur, payées par un prêt intra-groupe (B doit à
    A) ; jamais à une société que la cible contrôle (la chaîne de contrôle
    bouclerait). Le résultat de cession du vendeur est intra-groupe.
  Un prêt dont une partie ne fonctionne plus (faillite) est annulé : le prêteur
  le passe en perte, l'emprunteur survivant en est libéré.
- **Suivi comptable** : `balance.groupLoans` (prêts accordés, à l'actif),
  `pnl.groupFinancial` (part du résultat financier venant du groupe :
  dividendes, dépréciations et résultats sur titres, pertes sur prêts),
  `cashFlow.groupInvesting` (part des flux d'investissement échangés avec le
  groupe : dividendes reçus, prêts accordés ou remboursés ; la contrepartie est
  dans le financement de l'autre société). Chaque participation a sa valeur
  comptable (`Company.stakeValues`, Σ = actifs financiers) : une réévaluation
  sait ainsi quelle part du résultat porte sur le groupe (une participation qui
  est, ou était, dans `participations`).
- **Comptes consolidés** (`systems/conglomerate/consolidation.ts`) : pour
  chaque acteur qui contrôle sa tête, si le groupe compte au moins deux
  sociétés opérationnelles, intégration globale de toutes celles que la tête
  contrôle, pour tout le trimestre (une société rachetée en cours de trimestre
  est consolidée sur le trimestre entier) : somme des comptes, moins les prêts
  entre membres (prêts accordés et dettes), les participations entre membres
  (actifs financiers et fonds propres : l'écart d'acquisition est imputé sur
  les fonds propres, pas d'amortissement de goodwill), le résultat financier
  intra-groupe (résultat financier et net) et les flux intra-groupe (déplacés
  de l'investissement vers le financement). Les intérêts intra-groupe
  s'annulent dans la somme. Partage avec les minoritaires par la **part
  économique** de chaque membre : e(tête) = 1, e(s) = Σ part du capital de s
  détenue par un membre m × e(m) (chaînes et participations croisées,
  résolu par itération) ; fonds propres part du groupe = Σ e × (fonds propres −
  participations dans des membres), intérêts minoritaires = le reste ; même
  partage pour le résultat net. Actif = dettes + fonds propres + minoritaires
  par construction (testé par fast-check). Historique dans
  `Books.consolidated` de la tête (borné comme l'historique).
- **IA** (`ai/modules/group.ts`, avant les autres modules, sur l'`Observation`
  qui montre désormais les finances des sociétés de son propre groupe) : une
  tête de groupe prête à chaque filiale à découvert ou sous
  `ai.group.rescueCashQuarters` trimestre de charges décaissées de quoi revenir
  à `targetCashQuarters`, sur sa trésorerie au-delà de `keepCashQuarters` ;
  toute société rembourse sa dette intra-groupe avec la trésorerie au-delà de
  `repayAboveQuarters`. L'IA ne crée pas de holding, ne fait ni cash pooling ni
  restructuration.
- **Vues** : `PlayerView.groupCompanies` (part économique, contribution au
  résultat part du groupe, prêts accordés et dette intra-groupe, participations
  dans le groupe), `groupLoans`, `consolidated`, `canCreateHolding` ; l'aperçu
  estime les flux intra-groupe de fin de trimestre (`groupTransfers`) ; le
  rapport de tour résume, sous une holding, la société opérationnelle du groupe
  au plus gros chiffre d'affaires. Journal : `holding_created` (public),
  `group_loan`, `stake_transferred`, `group_loan_written_off` (privés) ; un
  dividende remonté est un `dividend_paid`.
- **Interface** : l'écran Groupe montre les comptes consolidés (résultat,
  bilan avec intérêts minoritaires, éliminations), le reporting par filiale,
  les prêts en cours, la création de la holding et l'édition des flux du
  trimestre (rangés dans le brouillon de la tête) ; les décisions d'une holding
  se limitent à l'onglet Finance. L'ancienne tête reste gérée par le joueur
  (au chargement d'une partie, la société opérationnelle principale du groupe
  est affichée et reprise en main).
- **Sauvegardes** : `schemaVersion` 9. La migration v8 → v9 ajoute les champs
  intra-groupe des états (à 0), la valeur comptable de chaque participation
  (au coût pour le groupe, le reste réparti au prorata de la valeur de marché),
  la section `conglomerate` et `ai.group`. Le golden ne change que par son hash
  (nouveaux champs) : la partie par défaut est identique.

Équilibrage mesuré avec `npm run sim -- --games 50 --turns 40` (seeds 1 à 50) :

| Indicateur (50 parties) | Lot 2.5 | Lot 3.1 |
|---|---|---|
| Faillite des IA (toutes) | 3,8 % | 3,3 % |
| Faillite du low-cost industriel | 28 % | 24 % |
| Faillite des sociétés rachetées | 2 sur 24 | 0 sur 24 |
| Marge nette médiane | 6,0 % | 6,0 % |
| Volatilité des matières / des cours | 12,3 / 13,2 % | 12,3 / 13,1 % |
| Prêts intra-groupe accordés (par partie) | – | 0,76 (0,08 remboursements) |

Les têtes de groupe recapitalisent désormais leurs filiales en difficulté
(limite du lot 2.4) : les sociétés rachetées ne font plus faillite et le
low-cost industriel, souvent racheté quand il fragilise, survit plus souvent.
Le taux global de faillite des IA s'éloigne encore de la cible de 5 % : à
reprendre avec l'équilibrage du lot 3.5 (par exemple `ai.group.keepCashQuarters`
plus haut, ou un plafond de soutien par filiale).

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

**Stock** : `chômeurs U = laborForce − outsideEmployment − Σ effectifs entreprises`.
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
`tension = V/U`. `κ` correspond à `labor.wageAdjustSpeed`.

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
par les **ordres à cours limité**.

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
       + βm_k · ln(1 + marketing_i) + βd · distribution_i (+ βn · ln(1+users_i) en tech)
part_ik = exp(U_ik) / (exp(U_0k) + Σ_j exp(U_jk))
```

`U_0` est l'option extérieure (importations, renoncement à l'achat), qui
évite qu'un monopole capte toute la demande à n'importe quel prix.

**Ventes** : `min(demande allouée, stock disponible)`. La demande non servie
est réallouée aux autres entreprises en stock, avec une perte de
`products.spilloverRate`.

**Marque** : `brand_{t+1} = brand_t·(1−δ) + a·ln(1+marketing) + b·(qualité − qualitéMoyenne) − scandales`.

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
| Mécaniques propres | **Niveau technologique** du produit face à une frontière qui avance chaque trimestre (obsolescence : l'attractivité baisse avec l'écart) ; R&D en projets mesurés en développeur·trimestres, à issue incertaine ; **base d'utilisateurs** avec effet de réseau (`βn·ln(users)`) ; revenus récurrents (abonnements) avec churn |
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
  la valeur liquidative.

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


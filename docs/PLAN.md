# Plan de développement

Chaque **phase** se termine par une validation par le joueur. Chaque phase
est découpée en **lots** : un lot = une session Claude Code = un ou
plusieurs commits poussés avec les tests au vert.

## Comment lancer un lot de façon économe en tokens

1. **Une nouvelle session par lot.** Le contexte d'une session longue coûte
   des tokens à chaque message. Les documents `CLAUDE.md` et `docs/*` servent
   de mémoire du projet : il n'y a rien à réexpliquer.
2. **Prompt de lancement type** :
   > Lis CLAUDE.md puis docs/PLAN.md. Réalise le lot 1.2 en respectant
   > docs/ARCHITECTURE.md et docs/GAME_DESIGN.md. Commit et push à la fin.
3. **Régler l'effort avant de lancer**, selon le tableau ci-dessous.
4. **Équilibrer avec des chiffres, pas avec du raisonnement** : lancer
   `npm run sim` et donner la sortie (ou le fichier de stats) plutôt que
   décrire un ressenti. Un rapport de bug = seed + fichier de sauvegarde
   exporté (la partie est rejouable à l'identique).
5. **Revue de code une fois par phase** (`/code-review` en medium), pas à
   chaque lot.

## Phase 1 : MVP (Industrie, marchés du travail et des matières, 3 IA, bourse v1)

| Lot | Contenu | Critères d'acceptation | Effort |
|---|---|---|---|
| **1.1 Socle** | Monorepo npm workspaces, TS strict, ESLint/Prettier, Vitest, CI. `config/schema.ts` + `default.ts` (sections MVP). Types `model/*`. RNG seedé, `TurnContext`, pipeline avec systèmes vides. Génération du monde (4 régions, bassins d'emploi, matières, marché électroménager, joueur + 3 IA). Sérialisation et migrations (v1) | `npm test` vert ; `createGame` puis `resolveTurn` ×N déterministe (test de hash) ; aller-retour de sérialisation OK | **high** |
| **1.2 Marchés & production** | Systèmes macro, labor, commodities, production (`SectorModule` industrie), products (logit 2 segments), accounting (P&L/CF/bilan, impôt, amortissements), dette, découvert, faillite. Moteur de modificateurs et 5 événements (grève, crise énergie, pénurie composants, hausse des taux, récession) | Tests unitaires par système ; invariants fast-check (actif = passif, conservation de la main-d'œuvre, stocks ≥ 0, pas de NaN) | **high** |
| **1.3 IA, bourse v1, outils** | `Observation`, planner IA (profils low-cost, premium, opportuniste), réaction de guerre des prix et de surenchère salariale de base. Bourse v1 : valeur fondamentale, formation du cours, indice, ordres d'achat/vente minoritaires, limite de liquidité. `getPlayerView`, `previewDecisions`, `defaultDecisions`, alertes, rapport de tour. `sim-cli` | 50 parties IA-only × 40 tours sans erreur ; bornes de sanité (prix, salaires, cours) ; au moins une IA rentable et pas de faillite systématique ; test anti-triche | **high** |
| **1.4 UI MVP** | App React : Tableau de bord, Décisions (6 onglets), Marchés, Concurrents, Bourse, Rapport de tour, Sauvegardes (IndexedDB, autosave, export/import JSON) | Une partie de 40 tours jouable de bout en bout dans le navigateur ; chargement d'une sauvegarde exportée | **medium** |
| **1.5 Équilibrage & playtest** | Ajustements de `default.ts` à partir de `sim-cli` et de tes retours ; corrections de bugs | Les objectifs d'équilibrage de §Équilibrage atteints | **medium** (bugs isolés : **low**) |

➡ **Validation Phase 1** : tu joues une partie complète et me fais tes retours.

## Phase 2 : secteurs, IA avancée, rachats, bourse v2

| Lot | Contenu | Effort |
|---|---|---|
| **2.1 Agroalimentaire** | `SectorModule` agro : saisons, météo régionale, terres limitées, périssabilité, référencement en distribution ; nouveaux métiers et matières ; 3 IA agro | **medium** |
| **2.2 Technologie** | `SectorModule` tech : frontière technologique et obsolescence, projets R&D, base d'utilisateurs et effet de réseau, abonnements et churn, matière « cloud » ; 3 IA tech | **high** |
| **2.3 IA avancée** | 5 profils, mémoire, guerre des prix complète, surenchère salariale, contre-lancements, comportement opportuniste (cibles en difficulté), interactions IA–IA | **high** |
| **2.4 Rachats & bourse v2** | Cibles générées, due diligence, valorisation, financement (dette, actions, échange), prise de contrôle à plus de 50 % (filiale), intégration. IPO de filiale, augmentation de capital, dividendes, rachat d'actions, OPA amicale | **high** |
| **2.5 UI & équilibrage multi-secteurs** | Écran Groupe (filiales, version simple), écrans de rachat et d'OPA, sélection du secteur de départ ; équilibrage croisé des 3 secteurs avec `sim-cli` | **medium** |

➡ **Validation Phase 2**

## Phase 3 : conglomérat complet, bourse v3, finitions

| Lot | Contenu | Effort |
|---|---|---|
| **3.1 Holding & consolidation** | Création d'une holding de tête, restructuration, remontée de dividendes, prêts intra-groupe, cash pooling. Comptes consolidés (intérêts minoritaires, éliminations intra-groupe) et reporting par filiale | **high** (la comptabilité de consolidation est délicate ; les invariants doivent tenir) |
| **3.2 Synergies & complexité** | Achats mutualisés, marque partagée, fonctions support, frais de holding, capacité managériale, décote de conglomérat | **medium** |
| **3.3 Bourse v3** | OPA hostile, contre-offre de l'IA et chevalier blanc, défenses, seuils déclaratifs avec réactions de l'IA, OPA obligatoire, paiement en titres, fonds activiste optionnel | **high** |
| **3.4 Objectifs & événements** | 5 modes de victoire, catalogue d'événements étendu, espionnage économique (option), presets de difficulté | **medium** |
| **3.5 Équilibrage fin & polish** | Campagne `sim-cli` multi-secteurs, onboarding, infobulles et glossaire, accessibilité, scénario Playwright « jouer 3 tours » | **medium** pour l'équilibrage, **low** pour le polish |

➡ **Validation Phase 3**. Ensuite, une phase 4 optionnelle : Finance/banque
et Immobilier.

## Récapitulatif des niveaux d'effort

| Niveau | Quand | Lots |
|---|---|---|
| max | Décisions structurantes, une seule fois | Phase 0 (faite) |
| **high** | Logique cœur du moteur, où une erreur se paie dans toutes les phases suivantes | 1.1, 1.2, 1.3, 2.2, 2.3, 2.4, 3.1, 3.3 |
| **medium** | Extension d'un patron déjà établi, UI, équilibrage chiffré, revues de code | 1.4, 1.5, 2.1, 2.5, 3.2, 3.4, 3.5 (équilibrage) |
| **low** | Bug isolé avec seed/sauvegarde, renommage, texte, style | Corrections ponctuelles, 3.5 (polish) |

Le niveau `xhigh` n'est utile qu'en recours, si un lot `high` échoue deux
fois sur le même problème (par exemple un invariant comptable de
consolidation qui ne tient pas).

## Objectifs d'équilibrage (mesurés par `sim-cli`, phase 1)

- Taux de faillite des IA sur 40 tours compris entre 5 et 20 %.
- Marge nette médiane en industrie entre 4 et 10 %.
- Dérive des salaires réels : ±15 % sur 10 ans hors chocs.
- Volatilité trimestrielle des matières entre 5 et 15 % ; des cours de
  bourse entre 8 et 20 %.
- Aucun acteur ne dépasse 60 % de part de marché sans action du joueur.
- Un joueur « passif » (qui reconduit ses décisions) ne gagne pas ; un
  joueur attentif peut dépasser l'IA en 12 à 20 tours.

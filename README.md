# GAME1 : jeu de gestion d'entreprises multi-secteurs

Jeu de gestion au tour par tour (1 tour = 1 trimestre) avec des marchés simulés :
travail, matières premières, produits et bourse. Une IA concurrente joue avec les
mêmes règles que le joueur, et l'objectif à long terme est de bâtir un conglomérat.

Statut : **Phase 3, lot 3.3** (bourse v3 : OPA hostile, offres concurrentes et
surenchères, contre-offre et chevalier blanc de l'IA, pilule empoisonnée et
rachats défensifs, seuils déclaratifs qui déclenchent les réactions de l'IA,
offre obligatoire, paiement en titres, fonds activiste optionnel). Lot 3.2 :
synergies de groupe (achats mutualisés, marque partagée, fonctions support) et
coûts de la complexité (frais de holding, capacité managériale, décote de
conglomérat). Lot 3.1 : holding de tête,
restructuration, remontée de dividendes, prêts intra-groupe et cash pooling ;
comptes consolidés avec intérêts minoritaires et éliminations intra-groupe,
reporting par filiale ; l'IA recapitalise ses filiales en difficulté. Phase 2 (lots 2.1 à 2.5) :
agroalimentaire, technologie, IA avancée, rachats et bourse v2, interface
multi-secteurs. Phase 1 (lots 1.1 à 1.5) : moteur, marchés, IA, bourse v1,
application web jouable, équilibrage.

```
npm install
npm run dev                            # jeu dans le navigateur (http://localhost:5173)
npm run build                          # version statique dans packages/web/dist
npm run lint && npm run typecheck && npm test
npm run sim -- --games 50 --turns 40   # options : --player passive|low_cost|premium|innovator|opportunist|conglomerate, --sector industry|agri|tech|all, --seed, --overrides f.json, --out f.json, --csv f.csv, --activist
```

- [Architecture technique](docs/ARCHITECTURE.md)
- [Game design et formules](docs/GAME_DESIGN.md)
- [Plan de développement et niveaux d'effort](docs/PLAN.md)

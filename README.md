# GAME1 : jeu de gestion d'entreprises multi-secteurs

Jeu de gestion au tour par tour (1 tour = 1 trimestre) avec des marchés simulés :
travail, matières premières, produits et bourse. Une IA concurrente joue avec les
mêmes règles que le joueur, et l'objectif à long terme est de bâtir un conglomérat.

Statut : **Phase 2, lot 2.5** (interface multi-secteurs : choix du secteur de
départ, écran Groupe avec les filiales et qui les dirige, écran Rachats & OPA,
opérations sur capital ; décisions adaptées à l'agroalimentaire et à la
technologie ; marchés dimensionnés pour leur nombre de sociétés ; équilibrage
croisé des 3 secteurs avec `sim-cli --sector all`). Lots 2.1 à 2.4 :
agroalimentaire, technologie, IA avancée, rachats et bourse v2. Phase 1 (lots
1.1 à 1.5) : moteur, marchés, IA, bourse v1, application web jouable,
équilibrage.

```
npm install
npm run dev                            # jeu dans le navigateur (http://localhost:5173)
npm run build                          # version statique dans packages/web/dist
npm run lint && npm run typecheck && npm test
npm run sim -- --games 50 --turns 40   # options : --player passive|low_cost|premium|innovator|opportunist|conglomerate, --sector industry|agri|tech|all, --seed, --overrides f.json, --out f.json, --csv f.csv
```

- [Architecture technique](docs/ARCHITECTURE.md)
- [Game design et formules](docs/GAME_DESIGN.md)
- [Plan de développement et niveaux d'effort](docs/PLAN.md)

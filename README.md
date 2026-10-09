# GAME1 : jeu de gestion d'entreprises multi-secteurs

Jeu de gestion au tour par tour (1 tour = 1 trimestre) avec des marchés simulés :
travail, matières premières, produits et bourse. Une IA concurrente joue avec les
mêmes règles que le joueur, et l'objectif à long terme est de bâtir un conglomérat.

Statut : **Phase 1, lot 1.3** (investissements, IA concurrente à 3 profils,
bourse v1, vues joueur, aperçu des décisions, alertes, rapport de tour,
`sim-cli`). Lot 1.2 : marchés et production. Lot 1.1 : socle du moteur.

```
npm install
npm run lint && npm run typecheck && npm test
npm run sim -- --games 50 --turns 40   # options : --player passive|low_cost|premium|opportunist, --seed, --overrides f.json, --out f.json, --csv f.csv
```

- [Architecture technique](docs/ARCHITECTURE.md)
- [Game design et formules](docs/GAME_DESIGN.md)
- [Plan de développement et niveaux d'effort](docs/PLAN.md)

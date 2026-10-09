# GAME1 : jeu de gestion d'entreprises multi-secteurs

Jeu de gestion au tour par tour (1 tour = 1 trimestre) avec des marchés simulés :
travail, matières premières, produits et bourse. Une IA concurrente joue avec les
mêmes règles que le joueur, et l'objectif à long terme est de bâtir un conglomérat.

Statut : **Phase 1, lot 1.4** (R&D procédés et produit côté moteur, application
web React jouable : tableau de bord, décisions en 6 onglets avec aperçu,
marchés, concurrents, bourse, rapport de tour, sauvegardes IndexedDB avec
autosave et export/import JSON). Lot 1.3 : investissements, IA concurrente,
bourse v1, vues joueur, `sim-cli`. Lot 1.2 : marchés et production. Lot 1.1 :
socle du moteur.

```
npm install
npm run dev                            # jeu dans le navigateur (http://localhost:5173)
npm run build                          # version statique dans packages/web/dist
npm run lint && npm run typecheck && npm test
npm run sim -- --games 50 --turns 40   # options : --player passive|low_cost|premium|opportunist, --seed, --overrides f.json, --out f.json, --csv f.csv
```

- [Architecture technique](docs/ARCHITECTURE.md)
- [Game design et formules](docs/GAME_DESIGN.md)
- [Plan de développement et niveaux d'effort](docs/PLAN.md)

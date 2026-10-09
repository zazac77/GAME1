# CLAUDE.md

Jeu de gestion multi-secteurs au tour par tour (1 tour = 1 trimestre), avec
des marchés simulés (travail, matières premières, produits, bourse), une IA
concurrente et un conglomérat.

## À lire avant de coder

- `docs/PLAN.md` : phases, lots, critères d'acceptation. Réaliser
  **uniquement** le lot demandé.
- `docs/ARCHITECTURE.md` : stack, dossiers, modèle de données, pipeline de
  tour, tests.
- `docs/GAME_DESIGN.md` : formules et mécaniques. Lire seulement les
  sections utiles au lot.

## Règles non négociables

- `packages/engine` est en TS pur : pas de DOM, pas de React, pas de
  `Math.random`, pas de `Date`. Tout l'aléa passe par `ctx.rng`.
- Aucun coefficient d'équilibrage en dur : tout va dans
  `packages/engine/src/config/default.ts`, validé par le schéma zod.
- L'IA ne lit qu'une `Observation`, jamais `GameState`. Ses décisions
  passent par la même validation que celles du joueur.
- L'UI (`packages/web`) ne contient aucune règle de jeu : elle appelle l'API
  publique de `@game/engine`.
- L'état reste sérialisable en JSON (objets simples, `Record`, pas de
  classes ni de `Map`).
- Tout changement de forme de `GameState` incrémente `schemaVersion` et
  ajoute une migration.

## Conventions

- Code et identifiants en anglais ; textes UI en français dans
  `packages/web/src/i18n/fr.ts`.
- Un système = un dossier `systems/<nom>/`, avec ses tests dans
  `test/systems/<nom>.test.ts`.
- Avant chaque commit : `npm run lint && npm run typecheck && npm test`.
- Équilibrage : `npm run sim -- --games 50 --turns 40`.
- Après un changement d'équilibrage volontaire, mettre à jour le snapshot
  golden (`npm test -- -u`) et le justifier dans le message de commit.

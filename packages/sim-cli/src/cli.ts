import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { gameMetrics, summarize } from './metrics';
import { formatCrossSector, formatModes, formatSummary, toCsv } from './report';
import type { DifficultyId, GameMode } from '@game/engine';
import { runGame, type PlayerMode } from './run';

// npm run sim -- --games 50 --turns 40 [--seed 1] [--player opportunist|passive]
//                [--sector industry|agri|tech|all] [--overrides file.json] [--out stats.json]
//                [--csv stats.csv] [--activist] [--difficulty easy|normal|hard]
//                [--mode sandbox|capitalization|domination|survival|conglomerate|all]
const { values } = parseArgs({
  options: {
    games: { type: 'string', default: '50' },
    turns: { type: 'string', default: '40' },
    seed: { type: 'string', default: '1' },
    player: { type: 'string', default: 'opportunist' },
    sector: { type: 'string' },
    overrides: { type: 'string' },
    out: { type: 'string' },
    csv: { type: 'string' },
    activist: { type: 'boolean', default: false },
    difficulty: { type: 'string', default: 'normal' },
    mode: { type: 'string', default: 'sandbox' },
  },
});

const games = Number(values.games);
const turns = Number(values.turns);
const seed = Number(values.seed);
const fromFile = values.overrides
  ? (JSON.parse((await import('node:fs')).readFileSync(values.overrides, 'utf8')) as Record<
      string,
      unknown
    >)
  : undefined;
// --sector: the player's starting sector (on top of the overrides file); "all" runs
// one campaign per sector and ends with a cross-sector table.
// --activist: the optional activist fund joins every game.
const base = values.activist
  ? {
      ...fromFile,
      stockMarket: {
        ...(fromFile?.stockMarket as object | undefined),
        activist: {
          ...((fromFile?.stockMarket as Record<string, unknown> | undefined)?.activist as
            object | undefined),
          enabled: true,
        },
      },
    }
  : fromFile;
const withSector = (sector: string | undefined) =>
  sector
    ? {
        ...base,
        scenario: {
          ...(base?.scenario as object | undefined),
          playerSector: sector,
        },
      }
    : base;

const sectors = values.sector === 'all' ? ['industry', 'agri', 'tech'] : [values.sector];
// --mode all: one campaign per game mode with an objective, ended by a table of the outcomes.
const modes: GameMode[] =
  values.mode === 'all'
    ? ['capitalization', 'domination', 'survival', 'conglomerate']
    : [values.mode as GameMode];
const campaigns = [];
let failed = false;
for (const mode of modes) {
  for (const sector of sectors) {
    const overrides = withSector(sector);
    const metrics = [];
    for (let i = 0; i < games; i++) {
      const record = runGame({
        seed: seed + i,
        turns,
        player: values.player as PlayerMode,
        overrides,
        // A mode with an objective ends the game when it is won or lost.
        mode,
        difficulty: values.difficulty as DifficultyId,
      });
      const m = gameMetrics(record);
      metrics.push(m);
      if (m.error) console.error(`seed ${m.seed}: ${m.error}`);
      for (const v of m.sanityViolations.slice(0, 3)) console.error(`seed ${m.seed}: ${v}`);
    }
    const summary = summarize(metrics);
    if (modes.length > 1) console.log(`\n=== Mode ${mode}`);
    if (sectors.length > 1) console.log(`\n=== Joueur en ${sector}`);
    console.log(formatSummary(summary, turns));
    campaigns.push({ mode, sector: sector ?? 'industry', summary, games: metrics });
    failed ||= summary.errors > 0 || summary.sanityViolations > 0;
  }
}
if (modes.length > 1) console.log(`\n${formatModes(campaigns)}`);
if (sectors.length > 1) {
  for (const mode of modes) {
    const rows = campaigns.filter((c) => c.mode === mode);
    console.log(`\n${modes.length > 1 ? `${mode} : ` : ''}${formatCrossSector(rows)}`);
  }
}
const out = campaigns.length > 1 ? { campaigns } : campaigns[0];
if (values.out) writeFileSync(values.out, JSON.stringify(out, null, 2));
if (values.csv) writeFileSync(values.csv, toCsv(campaigns.flatMap((c) => c.games)));
process.exitCode = failed ? 1 : 0;

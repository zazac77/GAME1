import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { gameMetrics, summarize } from './metrics';
import { formatSummary, toCsv } from './report';
import { runGame, type PlayerMode } from './run';

// npm run sim -- --games 50 --turns 40 [--seed 1] [--player opportunist|passive]
//                [--sector industry|agri|tech] [--overrides file.json] [--out stats.json]
//                [--csv stats.csv]
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
// --sector: the player's starting sector (on top of the overrides file).
const overrides = values.sector
  ? {
      ...fromFile,
      scenario: {
        ...(fromFile?.scenario as object | undefined),
        playerSector: values.sector,
      },
    }
  : fromFile;

const metrics = [];
for (let i = 0; i < games; i++) {
  const record = runGame({ seed: seed + i, turns, player: values.player as PlayerMode, overrides });
  const m = gameMetrics(record);
  metrics.push(m);
  if (m.error) console.error(`seed ${m.seed}: ${m.error}`);
  for (const v of m.sanityViolations.slice(0, 3)) console.error(`seed ${m.seed}: ${v}`);
}
const summary = summarize(metrics);
console.log(formatSummary(summary, turns));
if (values.out) writeFileSync(values.out, JSON.stringify({ summary, games: metrics }, null, 2));
if (values.csv) writeFileSync(values.csv, toCsv(metrics));
process.exitCode = summary.errors > 0 || summary.sanityViolations > 0 ? 1 : 0;

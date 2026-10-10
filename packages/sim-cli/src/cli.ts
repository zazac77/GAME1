import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { gameMetrics, summarize } from './metrics';
import { formatCrossSector, formatSummary, toCsv } from './report';
import { runGame, type PlayerMode } from './run';

// npm run sim -- --games 50 --turns 40 [--seed 1] [--player opportunist|passive]
//                [--sector industry|agri|tech|all] [--overrides file.json] [--out stats.json]
//                [--csv stats.csv] [--activist]
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
const campaigns = [];
let failed = false;
for (const sector of sectors) {
  const overrides = withSector(sector);
  const metrics = [];
  for (let i = 0; i < games; i++) {
    const record = runGame({
      seed: seed + i,
      turns,
      player: values.player as PlayerMode,
      overrides,
    });
    const m = gameMetrics(record);
    metrics.push(m);
    if (m.error) console.error(`seed ${m.seed}: ${m.error}`);
    for (const v of m.sanityViolations.slice(0, 3)) console.error(`seed ${m.seed}: ${v}`);
  }
  const summary = summarize(metrics);
  if (sectors.length > 1) console.log(`\n=== Joueur en ${sector}`);
  console.log(formatSummary(summary, turns));
  campaigns.push({ sector: sector ?? 'industry', summary, games: metrics });
  failed ||= summary.errors > 0 || summary.sanityViolations > 0;
}
if (campaigns.length > 1) console.log(`\n${formatCrossSector(campaigns)}`);
const out = campaigns.length > 1 ? { campaigns } : campaigns[0];
if (values.out) writeFileSync(values.out, JSON.stringify(out, null, 2));
if (values.csv) writeFileSync(values.csv, toCsv(campaigns.flatMap((c) => c.games)));
process.exitCode = failed ? 1 : 0;

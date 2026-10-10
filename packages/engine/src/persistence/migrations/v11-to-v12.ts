import type { RawState } from './index';

type Obj = Record<string, unknown>;
const obj = (x: unknown): Obj => (typeof x === 'object' && x !== null ? (x as Obj) : {});

/**
 * v11 → v12 (lot 3.4: objectives and events). The standard mode becomes the
 * capitalization objective (the sandbox stays), at the normal difficulty; the
 * streaks start from zero. The config gains the objectives, the events'
 * probability scale and the espionage section (off: it only joins a new
 * game); the event catalogue of the old game is kept as it was.
 */
export function migrateV11ToV12(state: RawState): RawState {
  const meta = obj(state.meta);
  if (meta.mode !== 'sandbox') meta.mode = 'capitalization';
  meta.difficulty ??= 'normal';
  const config = obj(state.config);
  const events = obj(config.events);
  events.probabilityScale ??= 1;
  config.espionage ??= {
    enabled: false,
    cost: 400_000,
    maxPerQuarter: 1,
    successProbability: 0.7,
    detectionProbability: 0.25,
    fine: 1_500_000,
    brandPenalty: 6,
    brandPenaltyQuarters: 2,
    grudge: 0.5,
    reportsKept: 12,
  };
  obj(obj(config.scenario).playerStart).cashFactor ??= 1;
  const victory = obj(config.victory);
  victory.sandbox ??= { bankruptcyEndsGame: false };
  victory.capitalization ??= { targetValue: 60_000_000 };
  victory.domination ??= { share: 0.4, quarters: 4 };
  victory.survival ??= {};
  victory.conglomerate ??= { sectors: 3, quarters: 4 };
  config.victory = victory;
  state.victory ??= { dominationStreaks: {}, profitableStreaks: {} };
  state.intel ??= {};
  return state;
}

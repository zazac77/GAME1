import {
  createGame,
  defaultDecisions,
  resolveTurn,
  type AiProfileId,
  type DeepPartial,
  type GameConfig,
  type GameState,
} from '@game/engine';

/** Who runs the player's company: the AI planner with a profile, or "same as last quarter". */
export type PlayerMode = AiProfileId | 'passive';

export interface RunOptions {
  seed: number;
  turns: number;
  player: PlayerMode;
  overrides?: DeepPartial<GameConfig>;
}

/** Start-of-quarter snapshots of one game, enough for every metric. */
export interface GameRecord {
  seed: number;
  player: PlayerMode;
  playerCompanyId: string;
  states: GameState[];
  /** Thrown by the engine, if any (the game stops there). */
  error?: string;
}

/** Plays one game; never throws (errors are recorded). */
export function runGame(opts: RunOptions): GameRecord {
  const autopilot = opts.player === 'passive' ? {} : { playerProfileId: opts.player };
  let state = createGame(
    { seed: opts.seed, playerName: 'Sim', companyName: 'Sim SA', mode: 'sandbox', ...autopilot },
    opts.overrides,
  );
  const playerActor = state.actors[state.meta.playerActorId];
  const record: GameRecord = {
    seed: opts.seed,
    player: opts.player,
    playerCompanyId: playerActor?.rootCompanyId ?? '',
    states: [state],
  };
  try {
    for (let t = 0; t < opts.turns && state.meta.status === 'running'; t++) {
      const decisions =
        opts.player === 'passive' ? [defaultDecisions(state, record.playerCompanyId)] : [];
      state = resolveTurn(state, decisions).state;
      record.states.push(state);
    }
  } catch (e) {
    record.error = e instanceof Error ? (e.stack ?? e.message) : String(e);
  }
  return record;
}

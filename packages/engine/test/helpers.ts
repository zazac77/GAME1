import { createGame, resolveTurn } from '../src';
import type { CompanyDecisions, GameState, NewGameOptions } from '../src';
import type { DeepPartial, GameConfig } from '../src/config/schema';

export const newGame = (
  seed = 42,
  overrides?: DeepPartial<GameConfig>,
  opts: Partial<NewGameOptions> = {},
): GameState =>
  createGame({ seed, playerName: 'Alice Martin', companyName: 'Martin SA', ...opts }, overrides);

export function playTurns(
  state: GameState,
  turns: number,
  decisions: (s: GameState) => CompanyDecisions[] = () => [],
): GameState {
  let s = state;
  for (let i = 0; i < turns; i++) s = resolveTurn(s, decisions(s)).state;
  return s;
}

/**
 * Throws unless `value` survives JSON unchanged: plain objects and arrays,
 * finite numbers, no undefined, no class instances (Map, Set, Date…).
 */
export function assertJsonSafe(value: unknown, path = '$'): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${path} is not finite: ${value}`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertJsonSafe(v, `${path}[${i}]`));
    return;
  }
  if (typeof value === 'object') {
    const proto = Object.getPrototypeOf(value) as unknown;
    if (proto !== Object.prototype && proto !== null) {
      throw new Error(`${path} is not a plain object`);
    }
    for (const [k, v] of Object.entries(value)) {
      if (v === undefined) throw new Error(`${path}.${k} is undefined`);
      assertJsonSafe(v, `${path}.${k}`);
    }
    return;
  }
  throw new Error(`${path} has unsupported type ${typeof value}`);
}

import { sum } from '../../core/math';
import type { LaborPoolKey } from '../../model/ids';
import type { GameState } from '../../model/state';

/** Σ headcount of the simulated companies in a pool (trainees included). */
export function simulatedEmployment(state: GameState, key: LaborPoolKey): number {
  return sum(Object.values(state.companies).map((c) => c.workforce[key]?.headcount ?? 0));
}

/** unemployed = laborForce − outsideEmployment − Σ company headcount. */
export function unemployed(state: GameState, key: LaborPoolKey): number {
  const pool = state.labor[key];
  if (!pool) return 0;
  return pool.laborForce - pool.outsideEmployment - simulatedEmployment(state, key);
}

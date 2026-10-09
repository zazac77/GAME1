import type { Id } from '../model/ids';
import type { GameMeta } from '../model/state';
import { idNumber } from './math';

/** Allocates the next id for a prefix: "co_001", "site_004"… Counters live in the state. */
export function newId(meta: GameMeta, prefix: string): Id {
  const n = (meta.idCounters[prefix] ?? 0) + 1;
  meta.idCounters[prefix] = n;
  return `${prefix}_${idNumber(n)}`;
}

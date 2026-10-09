import type { ModifierKey } from '../config/schema';
import type { Modifier, ModifierTargetKind } from '../model/events';
import type { Id } from '../model/ids';

export interface ModifierTarget {
  kind: ModifierTargetKind;
  id: Id;
}

/** A global modifier applies everywhere; any other one only to its exact target. */
function matches(modifier: Modifier, targets: readonly ModifierTarget[]): boolean {
  if (modifier.target.kind === 'global') return true;
  return targets.some((t) => t.kind === modifier.target.kind && t.id === modifier.target.id);
}

/**
 * Applies every active modifier of `key` to `base`: (base + Σ add) · Π mul.
 * `targets` lists the entities the quantity belongs to (e.g. a region and a
 * labor pool); an empty list only picks up global modifiers.
 */
export function applyModifiers(
  modifiers: readonly Modifier[],
  key: ModifierKey,
  base: number,
  targets: readonly ModifierTarget[] = [],
): number {
  let add = 0;
  let mul = 1;
  for (const m of modifiers) {
    if (m.key !== key || !matches(m, targets)) continue;
    if (m.op === 'add') add += m.value;
    else mul *= m.value;
  }
  return (base + add) * mul;
}

/**
 * Ages modifiers by one quarter: drops the expired ones and fades the others
 * by their decay (an `add` shrinks towards 0, a `mul` towards 1).
 */
export function ageModifiers(modifiers: readonly Modifier[]): Modifier[] {
  const out: Modifier[] = [];
  for (const m of modifiers) {
    const remaining = m.remaining - 1;
    if (remaining <= 0) continue;
    const keep = 1 - m.decay;
    const value = m.op === 'add' ? m.value * keep : 1 + (m.value - 1) * keep;
    out.push({ ...m, remaining, value });
  }
  return out;
}

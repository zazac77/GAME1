import { deepMerge } from '../merge';
import type { DeepPartial, DifficultyId, GameConfig, GameMode } from '../schema';
import { DIFFICULTY_PRESETS } from './difficulty';
import { MODE_PRESETS } from './scenarios';

export { DIFFICULTY_PRESETS } from './difficulty';
export { MODE_PRESETS } from './scenarios';

/**
 * Overrides of a new game: the difficulty preset, then the scenario of the
 * mode (scales multiply: a hard survival has 1.5 × 2 the event probability,
 * a cash factor of 0.7 × 0.8), then the caller's own overrides.
 */
export function presetOverrides(
  mode: GameMode,
  difficulty: DifficultyId,
  overrides?: DeepPartial<GameConfig>,
): DeepPartial<GameConfig> {
  const level = DIFFICULTY_PRESETS[difficulty];
  const scenario = MODE_PRESETS[mode];
  const merged = deepMerge<DeepPartial<GameConfig>>(level, scenario);
  const scale = (a?: number, b?: number) => (a === undefined || b === undefined ? (b ?? a) : a * b);
  const probabilityScale = scale(level.events?.probabilityScale, scenario.events?.probabilityScale);
  if (probabilityScale !== undefined) (merged.events ??= {}).probabilityScale = probabilityScale;
  const cashFactor = scale(
    level.scenario?.playerStart?.cashFactor,
    scenario.scenario?.playerStart?.cashFactor,
  );
  if (cashFactor !== undefined) {
    ((merged.scenario ??= {}).playerStart ??= {}).cashFactor = cashFactor;
  }
  return deepMerge(merged, overrides);
}

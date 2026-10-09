import { defaultConfig } from './default';
import { parseConfig, type DeepPartial, type GameConfig } from './schema';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Deep merge: objects are merged key by key, arrays and scalars are replaced. */
export function deepMerge<T>(base: T, overrides: DeepPartial<T> | undefined): T {
  if (overrides === undefined) return base;
  if (!isPlainObject(base) || !isPlainObject(overrides)) return overrides as T;
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) continue;
    out[key] = deepMerge(out[key], value as DeepPartial<unknown>);
  }
  return out as T;
}

/** Default config + overrides (presets, sandbox JSON), validated. */
export function resolveConfig(overrides?: DeepPartial<GameConfig>): GameConfig {
  return parseConfig(deepMerge(defaultConfig, overrides));
}

import type { AgriConfig } from '../../config/schema';
import { clamp, sum } from '../../core/math';
import { applyModifiers } from '../../core/modifiers';
import type { Rng } from '../../core/rng';
import type { Id } from '../../model/ids';
import type { GameState } from '../../model/state';

/** Crop yield index of a region this quarter: its weather × agri.yield modifiers (drought). */
export function regionalYield(state: GameState, regionId: Id): number {
  const weather = state.regions[regionId]?.weather ?? 1;
  const modifier = applyModifiers(state.modifiers, 'agri.yield', 1, [
    { kind: 'region', id: regionId },
  ]);
  return weather * Math.max(0, modifier);
}

/** National yield index, weighted by the farmland of each region (1 without agrifood). */
export function nationalYield(state: GameState): number {
  const land = state.config.sectors.agri?.farm.landByRegion;
  if (!land) return 1;
  const ids = Object.keys(land)
    .filter((r) => state.regions[r])
    .sort();
  const total = sum(ids.map((r) => land[r] ?? 0));
  if (total <= 0) return 1;
  return sum(ids.map((r) => (land[r] ?? 0) * regionalYield(state, r))) / total;
}

/**
 * Weather of the quarter, by region: ln w = persistence·ln w_prev +
 * volatility·(√c·ε_common + √(1 − c)·ε_region), within [min, max]. The common
 * shock is drawn first, then the regions in id order.
 */
export function advanceWeather(state: GameState, cfg: AgriConfig['weather'], rng: Rng): void {
  const common = rng.normal(0, 1);
  const c = cfg.commonShare;
  for (const regionId of Object.keys(state.regions).sort()) {
    const region = state.regions[regionId];
    if (!region) continue;
    const shock = Math.sqrt(c) * common + Math.sqrt(1 - c) * rng.normal(0, 1);
    const ln = cfg.persistence * Math.log(region.weather) + cfg.volatility * shock;
    region.weather = clamp(Math.exp(ln), cfg.min, cfg.max);
  }
}

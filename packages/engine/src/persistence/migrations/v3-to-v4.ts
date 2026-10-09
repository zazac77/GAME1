import type { RawState } from './index';

type Obj = Record<string, unknown>;
const obj = (x: unknown): Obj => (typeof x === 'object' && x !== null ? (x as Obj) : {});

/** R&D split of the profiles added in v4, by profile (first release values). */
const PROCESS_SHARE: Record<string, number> = { low_cost: 0.8, premium: 0.3, opportunist: 0.5 };

/**
 * v3 → v4 (lot 1.4: R&D). State: process level of each company, product
 * level of each product line, cost and start of the projects (none could
 * exist before: R&D decisions were refused). Config: the rnd section and the
 * R&D split of the AI profiles, with the values of their first release.
 */
export function migrateV3ToV4(state: RawState): RawState {
  const turn = typeof obj(state.meta).turn === 'number' ? (obj(state.meta).turn as number) : 0;
  for (const company of Object.values(obj(state.companies)).map(obj)) {
    company.processLevel ??= 0;
    for (const line of Object.values(obj(company.productLines)).map(obj)) line.techLevel ??= 0;
    if (!Array.isArray(company.rnd)) company.rnd = [];
    for (const project of (company.rnd as unknown[]).map(obj)) {
      project.cost ??= 0;
      project.startedAt ??= turn;
    }
  }

  const config = obj(state.config);
  const industry = obj(obj(config.sectors).industry);
  industry.rnd ??= {
    process: { baseCost: 1_500_000, qualityPerLevel: 2, productivityPerLevel: 0.04 },
    product: { baseCost: 2_000_000, qualityPerLevel: 6, productivityPerLevel: 0 },
    costGrowthPerLevel: 0.5,
    maxLevel: 5,
    maxSpendShare: 0.35,
    progressNoise: 0.2,
    obsolescencePerQuarter: 0.02,
  };
  for (const [id, profile] of Object.entries(obj(obj(config.ai).profiles))) {
    obj(profile).rndProcessShare ??= PROCESS_SHARE[id] ?? 0.5;
  }
  return state;
}

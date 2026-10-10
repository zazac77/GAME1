import type { RawState } from './index';

type Obj = Record<string, unknown>;
const obj = (x: unknown): Obj => (typeof x === 'object' && x !== null ? (x as Obj) : {});

/**
 * v9 → v10 (lot 3.2: synergies and complexity). Config only: the synergies,
 * holding fees, managerial capacity and conglomerate discount of the
 * conglomerate section. Groups are read from the registry: the effects start
 * with the next quarter (an overloaded group gets its malus at its end).
 */
export function migrateV9ToV10(state: RawState): RawState {
  const config = obj(state.config);
  const occupations = obj(obj(config.labor).occupations);
  const conglomerate = obj((config.conglomerate ??= { groupLoanSpread: 0.015 }));
  conglomerate.synergies ??= {
    pooledPurchasingShare: 1,
    sharedBrandWeight: 0.25,
    supportOccupationIds: ['occ_manager', 'occ_sales'].filter((o) => o in occupations),
    supportMaxSaving: 0.3,
  };
  conglomerate.holdingFee ??= { base: 100000, subsidiaryExponent: 1.3 };
  conglomerate.management ??= {
    capacity: 3,
    holdingBonus: 2,
    companyLoad: 1,
    sectorLoad: 1,
    lossPerUnit: 0.04,
    minEfficiency: 0.8,
    attritionWeight: 2,
  };
  conglomerate.discount ??= { perExtraSector: 0.08, max: 0.2 };
  return state;
}

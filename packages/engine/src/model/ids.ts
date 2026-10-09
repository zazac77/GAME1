export type { SectorId, AiProfileId, MacroRegime, CreditRating } from '../config/schema';

export type Id = string; // "co_003", "reg_nord", "occ_operator"
export type Money = number; // euros (float; rounded for display only)
export type Quarter = number; // 0 = Q1 of year 1; season = quarter % 4

/** `${regionId}:${occupationId}` */
export type LaborPoolKey = `${string}:${string}`;
/** `${regionId}:${occupationId}` */
export type StaffKey = LaborPoolKey;
/** Commodity id (materials) or product line id (finished goods). */
export type ItemId = Id;
/** A company id, an actor id (founder stake) or the public float. */
export type HolderId = Id | 'public';

export type GameMode = 'standard' | 'sandbox';

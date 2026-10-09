import type { Id, LaborPoolKey } from '../model/ids';

export const laborPoolKey = (regionId: Id, occupationId: Id): LaborPoolKey =>
  `${regionId}:${occupationId}`;

import type { System } from '../../core/system';
import { recordHistory, trimLog } from './history';

/** Last step: closes the quarter, then records the opening point of the next one. */
export const reportingSystem: System = {
  id: 'reporting',
  run(ctx) {
    ctx.draft.meta.turn = ctx.turn + 1;
    recordHistory(ctx.draft);
    trimLog(ctx.draft);
  },
};

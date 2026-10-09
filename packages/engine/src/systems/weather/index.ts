import type { System } from '../../core/system';
import { advanceWeather } from '../../sectors/agri/weather';

/**
 * Step 2 (after the events): draws the weather of the quarter in every
 * region when agrifood is configured. The farms harvest under it (step 7)
 * and crop prices follow the national harvest (step 6).
 */
export const weatherSystem: System = {
  id: 'weather',
  run(ctx) {
    const agri = ctx.config.sectors.agri;
    if (agri) advanceWeather(ctx.draft, agri.weather, ctx.rng);
  },
};

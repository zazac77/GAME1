import { operatingCompanies } from '../../core/companies';
import type { System } from '../../core/system';
import { sectorModule } from '../../sectors';

/** Step 7: each company produces through its sector's module. */
export const productionSystem: System = {
  id: 'production',
  run(ctx) {
    for (const company of operatingCompanies(ctx.draft)) {
      sectorModule(company.sector)?.produce(ctx, company);
    }
  },
};

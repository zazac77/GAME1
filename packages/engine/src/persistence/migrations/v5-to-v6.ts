import type { RawState } from './index';

type Obj = Record<string, unknown>;
const obj = (x: unknown): Obj => (typeof x === 'object' && x !== null ? (x as Obj) : {});
const list = (x: unknown): Obj[] => (Array.isArray(x) ? x.map(obj) : []);

/**
 * v5 → v6 (lot 2.2: technology). State: βn and βt of the market segments
 * (0: no network effect, no technology frontier). Config: the same for the
 * configured markets, the network unit of the utilities, per-sector listing
 * price / book (none), the tech parameters of the AI and the tech alerts.
 * The tech section stays absent: an old game goes on without SaaS companies.
 */
export function migrateV5ToV6(state: RawState): RawState {
  for (const market of Object.values(obj(state.productMarkets)).map(obj)) {
    for (const segment of list(market.segments)) {
      segment.betaNetwork ??= 0;
      segment.betaTech ??= 0;
    }
  }

  const config = obj(state.config);
  const products = obj(config.products);
  for (const market of Object.values(obj(products.markets)).map(obj)) {
    for (const segment of list(market.segments)) {
      segment.betaNetwork ??= 0;
      segment.betaTech ??= 0;
    }
  }
  products.networkUnit ??= 1000;
  obj(config.stockMarket).initialPriceToBookBySector ??= {};
  obj(config.ai).tech ??= {
    staffingCover: 1.05,
    gapTolerance: 0.05,
    catchUpPerGap: 0.5,
    maxRndShare: 0.3,
    churnPriceResponse: 0.3,
  };
  const alerts = obj(obj(config.views).alerts);
  alerts.techGap ??= 0.15;
  alerts.maintenanceCoverage ??= 0.9;
  return state;
}

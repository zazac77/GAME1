import { declaredLevels } from '../../core/disclosure';
import type { GameState } from '../../model/state';
import type { RawState } from './index';

type Obj = Record<string, unknown>;
const obj = (x: unknown): Obj => (typeof x === 'object' && x !== null ? (x as Obj) : {});

const POISON_PILL: Record<string, number> = {
  low_cost: 0.3,
  premium: 0.6,
  innovator: 0.5,
  opportunist: 0.2,
  conglomerate: 0.4,
};

/**
 * v10 → v11 (lot 3.3: stock market v3). Tender offers get their base price,
 * financing, hostility, raises and defenses; the holdings above a disclosure
 * threshold are declared as they stand (no news); no activist campaign. The
 * config gains the offer contest, defenses, disclosure, mandatory offer and
 * activist fund sections (the fund stays off: it only joins a new game), and
 * the AI its hostile offers, counter-offers, white knights and defenses. The
 * world keeps its founders' stakes.
 */
export function migrateV10ToV11(state: RawState): RawState {
  const config = obj(state.config);
  const sm = obj(config.stockMarket);
  sm.founderStakeByProfile ??= {};
  sm.disclosureThresholds ??= [0.05, 0.1, 0.2, 0.33];
  sm.mandatoryOfferThreshold ??= 0.3;
  sm.activist ??= {
    enabled: false,
    name: 'Vautour Capital',
    capital: 40_000_000,
    minUndervaluation: 0.25,
    maxStake: 0.1,
    maxPositions: 3,
    positionShareOfCash: 0.25,
    exitUndervaluation: 0.05,
    holdQuarters: 12,
    campaignStake: 0.05,
    tenderPremium: 0.1,
  };
  const mna = obj(config.mna);
  mna.offers ??= {
    periodQuarters: 1,
    maxQuarters: 3,
    minOverbid: 0.02,
    oppositionPremium: 0.05,
    whiteKnightAskFactor: 0.6,
    pillShareRatio: 0.5,
  };
  const ai = obj(config.ai);
  for (const [id, profile] of Object.entries(obj(ai.profiles))) {
    obj(profile).poisonPill ??= POISON_PILL[id] ?? 0.3;
  }
  obj(ai.dividends).campaignPayout ??= 0.6;
  ai.defense ??= { buybackTrigger: 0.1, minCashQuarters: 1.5 };
  const aiMna = obj(ai.mna);
  aiMna.hostileMaxPremium ??= 0.35;
  aiMna.hostileSafety ??= 0.1;
  aiMna.counterBidStep ??= 0.05;
  aiMna.maxCounterBids ??= 2;
  aiMna.knightMargin ??= 0.03;
  aiMna.preemptThreshold ??= 0.1;
  aiMna.preemptValueMargin ??= 0.25;

  const stock = obj(state.stock);
  const offers = Array.isArray(stock.tenderOffers) ? (stock.tenderOffers as Obj[]) : [];
  for (const offer of offers) {
    const price = Number(offer.pricePerShare ?? 0);
    const premium = Number(offer.premium ?? 0);
    offer.basePrice ??= premium > -1 ? price / (1 + premium) : price;
    offer.debt ??= 0;
    offer.hostile ??= false;
    offer.raises ??= 0;
    offer.defenses ??= { pill: false, whiteKnight: false };
  }
  stock.campaigns ??= [];
  stock.declared = declaredLevels(state as unknown as GameState);
  return state;
}

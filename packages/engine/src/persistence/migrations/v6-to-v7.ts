import type { RawState } from './index';

type Obj = Record<string, unknown>;
const obj = (x: unknown): Obj => (typeof x === 'object' && x !== null ? (x as Obj) : {});
const num = (x: unknown, fallback = 0): number => (typeof x === 'number' ? x : fallback);

/** Parameters added to every AI profile, by profile id (values of the lot 2.3 engine). */
const PROFILE_TACTICS: Record<string, Obj> = {
  low_cost: {
    skilledWagePremium: 0,
    wageOutbidMax: 0.15,
    priceWarDepth: 1,
    brandDefense: 0,
    counterLaunch: 0.1,
    opportunism: 0,
  },
  premium: {
    skilledWagePremium: 0,
    wageOutbidMax: 0.15,
    priceWarDepth: 0.5,
    brandDefense: 0.5,
    counterLaunch: 0.6,
    opportunism: 0,
  },
  innovator: {
    skilledWagePremium: 0.12,
    wageOutbidMax: 0.3,
    priceWarDepth: 0.8,
    brandDefense: 0.2,
    counterLaunch: 0.9,
    opportunism: 0,
  },
  opportunist: {
    skilledWagePremium: 0,
    wageOutbidMax: 0.15,
    priceWarDepth: 1,
    brandDefense: 0,
    counterLaunch: 0.3,
    opportunism: 1,
  },
  conglomerate: {
    skilledWagePremium: 0,
    wageOutbidMax: 0.1,
    priceWarDepth: 1,
    brandDefense: 0.1,
    counterLaunch: 0.3,
    opportunism: 0.4,
  },
};

/** The two profiles the lot 2.3 engine adds (an old game keeps its line-up). */
const NEW_PROFILES: Record<string, Obj> = {
  innovator: {
    priceMarkup: 0.22,
    qualityTarget: 60,
    startPriceIndex: 1.05,
    competitorPriceWeight: 0.4,
    wagePremium: 0.03,
    riskAversion: 0.25,
    aggressiveness: 0.4,
    stockoutPremium: 0,
    marketingShareOfRevenue: 0.03,
    rndShareOfRevenue: 0.06,
    rndProcessShare: 0.4,
  },
  conglomerate: {
    priceMarkup: 0.15,
    qualityTarget: 55,
    startPriceIndex: 1,
    competitorPriceWeight: 0.5,
    wagePremium: 0,
    riskAversion: 0.5,
    aggressiveness: 0.4,
    stockoutPremium: 0,
    marketingShareOfRevenue: 0.03,
    rndShareOfRevenue: 0.02,
    rndProcessShare: 0.5,
  },
};

/**
 * v6 → v7 (lot 2.3: advanced AI). State: the AI memory remembers each rival
 * (the grudges move into `rivals`), the price war becomes a state (rivals,
 * discount, escalations), staff flows keep the wage offered with the hires
 * (public job ads; the wage of a group that asked for hires, else 0).
 * Config: the profiles get their tactics (the outbidding cap moves from
 * ai.wageOutbid.max to each profile), innovator and conglomerate are added,
 * the price war gets escalation and truce, plus counter-launches and
 * opportunism. The line-up of an old game is kept.
 */
export function migrateV6ToV7(state: RawState): RawState {
  const turn = num(obj(state.meta).turn);
  for (const memory of Object.values(obj(state.aiMemory)).map(obj)) {
    const grudges = obj(memory.grudges);
    if (memory.rivals === undefined) {
      const rivals: Obj = {};
      for (const [id, grudge] of Object.entries(grudges)) {
        rivals[id] = { grudge: num(grudge), weakQuarters: 0 };
      }
      memory.rivals = rivals;
    }
    const discount = num(memory.priceWarDiscount);
    if (discount > 0 && memory.priceWar === undefined) {
      memory.priceWar = {
        rivalIds: Object.keys(grudges).sort(),
        discount,
        startedAt: num(memory.lastRetaliationAt, turn),
        escalations: 0,
      };
    }
    delete memory.grudges;
    delete memory.priceWarDiscount;
  }
  for (const company of Object.values(obj(state.companies)).map(obj)) {
    for (const staff of Object.values(obj(company.workforce)).map(obj)) {
      const flows = obj(staff.lastQuarter);
      flows.offered ??= num(flows.requested) > 0 ? num(staff.wage) : 0;
      staff.lastQuarter = flows;
    }
  }

  const ai = obj(obj(state.config).ai);
  const wageOutbid = obj(ai.wageOutbid);
  const profiles = obj(ai.profiles);
  for (const [id, profile] of Object.entries(NEW_PROFILES)) profiles[id] ??= { ...profile };
  for (const [id, profile] of Object.entries(profiles).map(([k, v]) => [k, obj(v)] as const)) {
    const tactics = PROFILE_TACTICS[id] ?? PROFILE_TACTICS.conglomerate ?? {};
    for (const [key, value] of Object.entries(tactics)) profile[key] ??= value;
    if (typeof wageOutbid.max === 'number' && !(id in NEW_PROFILES)) {
      profile.wageOutbidMax = wageOutbid.max;
    }
  }
  delete wageOutbid.max;
  wageOutbid.minMargin ??= 0;
  wageOutbid.poachGrudge ??= 0.2;
  wageOutbid.cooldownQuarters ??= 8;
  wageOutbid.skilledLevel ??= 3;
  const priceWar = obj(ai.priceWar);
  priceWar.grudgeAggression ??= 0.3;
  priceWar.escalationStep ??= 0.04;
  priceWar.maxDiscount ??= Math.max(0.16, num(priceWar.discount));
  priceWar.truceMargin ??= 0.02;
  ai.counterLaunch ??= {
    qualityJumpTrigger: 2,
    techJumpTrigger: 0.15,
    durationQuarters: 4,
    cooldownQuarters: 6,
    qualityMargin: 2,
    maxQualityBoost: 8,
    rndBoost: 0.5,
    marketingBoost: 0.3,
  };
  ai.opportunism ??= {
    weakRatings: ['B', 'CCC'],
    lossQuarters: 2,
    watchQuarters: 2,
    predatoryDiscount: 0.02,
    captureShare: 0.15,
  };
  return state;
}

import type { TurnContext } from '../../core/context';
import { operatingCompanies } from '../../core/companies';
import { newId } from '../../core/ids';
import { laborPoolKey } from '../../core/keys';
import { sum } from '../../core/math';
import type { Rng } from '../../core/rng';
import { valueEquity } from '../../core/valuation';
import type { Company } from '../../model/company';
import type { AnnualFigures, TargetListing } from '../../model/mna';
import type { Id, SectorId } from '../../model/ids';
import type { GameState } from '../../model/state';
import { buildCompany, type Participant } from '../../scenario/generate';
import { TARGET_NAMES } from '../../scenario/names';
import { plantConfigOf, techConfigOf } from '../../sectors/config';
import { unemployed } from '../labor/pools';

/** Sectors configured in this game. */
const sectorsOf = (state: GameState): SectorId[] =>
  (['industry', 'agri', 'tech'] as const).filter(
    (s) =>
      plantConfigOf(state.config, s) !== undefined || techConfigOf(state.config, s) !== undefined,
  );

/** Size of a company for the sector averages: line capacity (plants) or subscribers (tech). */
function size(state: GameState, company: Company): number {
  if (techConfigOf(state.config, company.sector)) {
    return sum(Object.values(company.productLines).map((l) => l.users ?? 0));
  }
  return sum(
    Object.values(company.sites).flatMap((s) =>
      Object.values(s.lines)
        .filter((l) => l.status !== 'under_construction')
        .map((l) => l.capacity),
    ),
  );
}

/** Trailing annual revenue and EBITDA from the closed quarters (up to four). */
export function trailingFigures(company: Company): AnnualFigures {
  const last = company.books.history.slice(-4);
  const scale = last.length > 0 ? 4 / last.length : 0;
  return {
    revenue: sum(last.map((s) => s.pnl.revenue)) * scale,
    ebitda: sum(last.map((s) => s.pnl.ebitda)) * scale,
  };
}

/** Revenue and EBITDA per unit of size of the operating companies of a sector. */
function sectorAverages(state: GameState, sector: SectorId): AnnualFigures | undefined {
  let units = 0;
  let revenue = 0;
  let ebitda = 0;
  for (const c of operatingCompanies(state)) {
    if (c.sector !== sector || c.books.history.length === 0) continue;
    const figures = trailingFigures(c);
    units += size(state, c);
    revenue += figures.revenue;
    ebitda += figures.ebitda;
  }
  return units > 0 ? { revenue: revenue / units, ebitda: ebitda / units } : undefined;
}

/** The participant a listing becomes when bought. */
export const listingParticipant = (listing: TargetListing): Participant => ({
  kind: 'ai',
  sector: listing.sector,
  profileId: listing.managementProfileId,
  regionId: listing.regionId,
  actorName: '',
  companyName: listing.name,
  scale: listing.scale,
});

/** A name no company nor listing bears yet. */
function freshName(state: GameState, rng: Rng): string {
  const taken = new Set([
    ...Object.values(state.companies).map((c) => c.name),
    ...state.mna.listings.map((l) => l.name),
  ]);
  const free = TARGET_NAMES.filter((n) => !taken.has(n));
  if (free.length > 0) return free[rng.int(0, free.length - 1)] as string;
  const base = TARGET_NAMES[rng.int(0, TARGET_NAMES.length - 1)] ?? 'Cible';
  let i = 2;
  while (taken.has(`${base} ${i}`)) i++;
  return `${base} ${i}`;
}

/**
 * A new unlisted company for sale: a sector with operating companies, a
 * region, a size and a management profile at random; its actual annual
 * figures are the sector's per-unit averages × its size, × a performance
 * draw; the public sees them through a noisy estimate. Its opening balance
 * is the one it will have when bought (built on a copy of the state); the
 * asking price is its valuation mid-point (at least 80 % of its book
 * equity) plus a premium; an undeclared liability may hide behind it.
 */
export function drawListing(state: GameState, rng: Rng, turn: number): TargetListing | undefined {
  const L = state.config.mna.listings;
  const sectors = sectorsOf(state)
    .map((s) => [s, sectorAverages(state, s)] as const)
    .filter((x): x is readonly [SectorId, AnnualFigures] => x[1] !== undefined);
  if (sectors.length === 0) return undefined;
  const [sector, average] = sectors[rng.int(0, sectors.length - 1)] as readonly [
    SectorId,
    AnnualFigures,
  ];
  const regions = Object.keys(state.regions).sort();
  const regionId = regions[rng.int(0, regions.length - 1)] as Id;
  const scale = rng.range(L.scale.min, L.scale.max);
  const managementProfileId = L.profiles[rng.int(0, L.profiles.length - 1)] as NonNullable<
    TargetListing['managementProfileId']
  >;
  const name = freshName(state, rng);
  const listing: TargetListing = {
    id: '',
    name,
    sector,
    regionId,
    scale,
    managementProfileId,
    listedAt: turn,
    expiresAt: turn + 1 + L.durationQuarters,
    askingPrice: 0,
    estimate: { revenue: 0, ebitda: 0 },
    netDebt: 0,
    actual: { revenue: 0, ebitda: 0 },
    hiddenLiability: 0,
  };
  // What the company would be: built on a copy, without any random jitter.
  const sandbox = structuredClone(state);
  const company = buildCompany(sandbox, listingParticipant(listing), (x) => x);
  const performance = rng.range(-L.performanceSpread, L.performanceSpread);
  const units = size(sandbox, company);
  listing.actual = {
    revenue: average.revenue * units * (1 + performance / 2),
    ebitda: average.ebitda * units * (1 + performance),
  };
  const noise = () => rng.range(1 - L.estimateNoise, 1 + L.estimateNoise);
  listing.estimate = {
    revenue: listing.actual.revenue * noise(),
    ebitda: listing.actual.ebitda * noise(),
  };
  const b = company.books.current.balance;
  listing.netDebt = b.debt - b.cash;
  const value = valueEquity(
    state.config,
    state.macro.policyRate,
    sector,
    listing.actual,
    0,
    listing.netDebt,
    0,
  );
  listing.askingPrice =
    Math.max(value.mid, 0.8 * b.equity) * (1 + rng.range(L.askPremium.min, L.askPremium.max));
  if (rng.chance(L.hiddenLiability.probability)) {
    listing.hiddenLiability =
      listing.askingPrice * rng.range(L.hiddenLiability.min, L.hiddenLiability.max);
  }
  listing.id = newId(state.meta, 'tgt');
  return listing;
}

/** End of quarter: listings past their date are withdrawn, a new one may arrive. */
export function updateListings(ctx: TurnContext): void {
  const { draft, rng, turn } = ctx;
  const L = draft.config.mna.listings;
  draft.mna.listings = draft.mna.listings.filter((l) => l.expiresAt > turn + 1);
  if (draft.mna.listings.length >= L.maxOpen || !rng.chance(L.arrivalProbability)) return;
  const listing = drawListing(draft, rng, turn + 1);
  if (!listing) return;
  draft.mna.listings.push(listing);
  ctx.log({
    kind: 'company_for_sale',
    severity: 'info',
    data: { listingId: listing.id, name: listing.name, sector: listing.sector },
  });
}

/**
 * A bought listing becomes a company: built at its size in its region,
 * unlisted, run by its management in place, wholly owned by the buyer. Its
 * staff come out of the economy outside the simulation (or the unemployed).
 */
export function instantiateListing(ctx: TurnContext, listing: TargetListing, buyerId: Id): Company {
  const { draft, rng } = ctx;
  const jitter = (x: number): number =>
    x * (1 + draft.config.scenario.initialJitter * rng.range(-1, 1));
  const company = buildCompany(draft, listingParticipant(listing), jitter);
  company.listed = false;
  company.managementProfileId = listing.managementProfileId;
  for (const staff of Object.values(company.workforce)) {
    const poolKey = laborPoolKey(staff.regionId, staff.occupationId);
    const pool = draft.labor[poolKey];
    if (!pool) continue;
    const available = pool.outsideEmployment + Math.max(0, unemployed(draft, poolKey));
    staff.headcount = Math.min(staff.headcount, Math.floor(available));
    pool.outsideEmployment -= Math.min(pool.outsideEmployment, staff.headcount);
  }
  company.workforce = Object.fromEntries(
    Object.entries(company.workforce).filter(([, staff]) => staff.headcount > 0),
  );
  draft.companies[company.id] = company;
  draft.stock.registry[company.id] = { [buyerId]: company.sharesOutstanding };
  return company;
}

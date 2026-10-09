import { createGame, resolveTurn } from '../src';
import type { CompanyDecisions, GameState, NewGameOptions, TurnReport } from '../src';
import type { DeepPartial, GameConfig } from '../src/config/schema';
import { isOperating } from '../src/core/companies';
import { createTurnContext, type TurnContext } from '../src/core/context';
import { laborPoolKey } from '../src/core/keys';
import { PIPELINE, runPipeline } from '../src/core/pipeline';
import type { System, SystemId } from '../src/core/system';
import { industryModule, mainProductLine } from '../src/sectors/industry';
import { emptyDecisions } from '../src/systems/validation';

export const newGame = (
  seed = 42,
  overrides?: DeepPartial<GameConfig>,
  opts: Partial<NewGameOptions> = {},
): GameState =>
  createGame({ seed, playerName: 'Alice Martin', companyName: 'Martin SA', ...opts }, overrides);

/** Plays N quarters through resolveTurn; by default the player runs steady decisions. */
export function playTurns(
  state: GameState,
  turns: number,
  decisions: (s: GameState) => CompanyDecisions[] = (s) => [steadyDecisions(s, playerCompanyId(s))],
): GameState {
  let s = state;
  for (let i = 0; i < turns; i++) s = resolveTurn(s, decisions(s)).state;
  return s;
}

export const playerCompanyId = (state: GameState): string =>
  state.actors[state.meta.playerActorId]?.rootCompanyId ?? '';

/**
 * Resolves a quarter with decisions for any company (the AI planner arrives
 * in lot 1.3), optionally stopping after a given system.
 */
export function resolveAll(
  state: GameState,
  decisions: CompanyDecisions[],
  opts: { until?: SystemId; systems?: readonly System[] } = {},
): { state: GameState; report: TurnReport; ctx: TurnContext } {
  const draft = structuredClone(state);
  const ctx = createTurnContext(draft, structuredClone(decisions));
  let systems = opts.systems ?? PIPELINE;
  if (opts.until) {
    const end = systems.findIndex((s) => s.id === opts.until);
    systems = systems.slice(0, end + 1);
  }
  runPipeline(ctx, systems);
  return { state: draft, report: { turn: ctx.turn, events: ctx.events, issues: ctx.issues }, ctx };
}

/**
 * A plausible manager: keeps the starting staff, buys the materials of the
 * planned output, produces what it expects to sell, spends on marketing and
 * indexes its price. Good enough to keep a company alive in tests.
 */
export function steadyDecisions(state: GameState, companyId: string): CompanyDecisions {
  const d = emptyDecisions(companyId);
  const company = state.companies[companyId];
  if (!company || !isOperating(company)) return d;
  const { config } = state;
  const industry = config.sectors.industry;
  for (const [occupationId, target] of Object.entries(industry.startingCompany.staff)) {
    const key = laborPoolKey(company.hqRegionId, occupationId);
    const pool = state.labor[key];
    if (!pool) continue;
    const staff = company.workforce[key];
    const headcount = staff?.headcount ?? 0;
    d.hr.push({
      regionId: company.hqRegionId,
      occupationId,
      hire: Math.max(0, target - headcount) + Math.ceil(target * config.labor.attrition.baseRate),
      fire: 0,
      wageOffer: Math.max(staff?.wage ?? 0, pool.marketWage),
    });
  }
  const line = mainProductLine(state, company);
  if (!line) return d;
  const capacity = industryModule.plannedOutput(state, company, undefined);
  const stock = company.inventory[line.id]?.qty ?? 0;
  const output = stock > 0.5 * capacity ? 0.5 * capacity : capacity;
  const site = Object.keys(company.sites)[0];
  if (site) d.production[site] = { targetOutput: output };
  const perUnit = industryModule.materialsPerUnit(state, company, line);
  for (const [commodityId, q] of Object.entries(perUnit)) {
    if (!config.commodities.markets[commodityId]?.storable) continue;
    const need = Math.min(output, capacity) * q * 1.05 - (company.inventory[commodityId]?.qty ?? 0);
    if (need > 0) d.purchasing.spot.push({ commodityId, qty: need });
  }
  d.pricing[line.id] = { price: line.price * (1 + state.macro.inflation / 4) };
  d.marketing[line.id] = 100_000;
  return d;
}

export const steadyAll = (state: GameState): CompanyDecisions[] =>
  Object.keys(state.companies).map((id) => steadyDecisions(state, id));

/** Plays N quarters with steady decisions for every company. */
export function playSteady(state: GameState, turns: number): GameState {
  let s = state;
  for (let i = 0; i < turns && s.meta.status === 'running'; i++) {
    s = resolveAll(s, steadyAll(s)).state;
  }
  return s;
}

/**
 * Throws unless `value` survives JSON unchanged: plain objects and arrays,
 * finite numbers, no undefined, no class instances (Map, Set, Date…).
 */
export function assertJsonSafe(value: unknown, path = '$'): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${path} is not finite: ${value}`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertJsonSafe(v, `${path}[${i}]`));
    return;
  }
  if (typeof value === 'object') {
    const proto = Object.getPrototypeOf(value) as unknown;
    if (proto !== Object.prototype && proto !== null) {
      throw new Error(`${path} is not a plain object`);
    }
    for (const [k, v] of Object.entries(value)) {
      if (v === undefined) throw new Error(`${path}.${k} is undefined`);
      assertJsonSafe(v, `${path}.${k}`);
    }
    return;
  }
  throw new Error(`${path} has unsupported type ${typeof value}`);
}

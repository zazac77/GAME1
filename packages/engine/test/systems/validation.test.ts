import { describe, expect, it } from 'vitest';
import { resolveTurn, validateDecisions } from '../../src';
import type { CompanyDecisions } from '../../src';
import { laborPoolKey } from '../../src/core/keys';
import { emptyDecisions, normalizeDecisions } from '../../src/systems/validation';
import { newGame, playerCompanyId } from '../helpers';

const setup = () => {
  const state = newGame(5);
  const id = playerCompanyId(state);
  const company = state.companies[id];
  if (!company) throw new Error('no player company');
  const lineId = Object.keys(company.productLines)[0] ?? '';
  const siteId = Object.keys(company.sites)[0] ?? '';
  return { state, id, company, lineId, siteId };
};

const codes = (issues: { path: string; code: string }[]) =>
  issues.map((i) => `${i.path}:${i.code}`);

describe('validation', () => {
  it('fills in empty decisions and accepts sane ones untouched', () => {
    const { state, company, lineId, siteId } = setup();
    expect(normalizeDecisions(state, company, undefined)).toEqual({
      decisions: emptyDecisions(company.id),
      issues: [],
    });
    const d = emptyDecisions(company.id);
    d.pricing[lineId] = { price: 330, qualityTarget: 60 };
    d.production[siteId] = { targetOutput: 20000 };
    d.marketing[lineId] = 50000;
    d.purchasing.spot.push({ commodityId: 'com_steel', qty: 100, limitPrice: 800 });
    const { decisions, issues } = normalizeDecisions(state, company, d);
    expect(issues).toEqual([]);
    expect(decisions).toEqual(d);
  });

  it('clamps prices, wages and headcounts to their bounds', () => {
    const { state, company, lineId } = setup();
    const key = laborPoolKey(company.hqRegionId, 'occ_operator');
    const market = state.labor[key]?.marketWage ?? 0;
    const d = emptyDecisions(company.id);
    d.pricing[lineId] = { price: 1e9, qualityTarget: 150 };
    d.hr.push({
      regionId: company.hqRegionId,
      occupationId: 'occ_operator',
      hire: 1e6,
      fire: 1e6,
      wageOffer: 1,
    });
    const { decisions, issues } = normalizeDecisions(state, company, d);
    expect(decisions.pricing[lineId]?.price).toBeCloseTo(5 * 320, 6);
    expect(decisions.pricing[lineId]?.qualityTarget).toBe(100);
    const hr = decisions.hr[0];
    expect(hr?.wageOffer).toBeCloseTo(0.6 * market, 6);
    expect(hr?.fire).toBe(company.workforce[key]?.headcount);
    expect(hr?.hire).toBe(state.labor[key]?.laborForce); // N1: up to the whole pool
    expect(issues.every((i) => i.code === 'clamped' || i.code === 'budget')).toBe(true);
  });

  it('drops unknown ids, garbage numbers and features of later lots', () => {
    const { state, company } = setup();
    const d: CompanyDecisions = {
      ...emptyDecisions(company.id),
      pricing: { pl_999: { price: 300 } },
      production: { site_999: { targetOutput: 10 } },
      hr: [
        { regionId: 'reg_nord', occupationId: 'occ_operator', hire: 5, fire: 0, wageOffer: 9000 },
      ],
      purchasing: {
        spot: [
          { commodityId: 'com_gold', qty: 1 },
          { commodityId: 'com_steel', qty: Number.NaN },
          { commodityId: 'com_energy', qty: 10 },
        ],
        newContracts: [{ commodityId: 'com_steel', qtyPerQuarter: -3, quarters: 4 }],
      },
      capex: [{ kind: 'build_site', regionId: 'reg_nord' }],
      finance: { dividend: 1000, borrow: -5 },
      stockOrders: [{ targetId: 'co_002', side: 'buy', shares: 10 }],
    };
    const { decisions, issues } = normalizeDecisions(state, company, d);
    expect(decisions).toEqual(emptyDecisions(company.id));
    expect(codes(issues)).toEqual([
      'pricing.pl_999:unknown_id',
      'production.site_999:unknown_id',
      'hr[0].hire:unknown_id', // no site in reg_nord
      'purchasing.spot[0]:unknown_id',
      'purchasing.spot[1].qty:invalid_value',
      'purchasing.spot[2]:invalid_value', // energy is bought at consumption
      'purchasing.newContracts[0].qtyPerQuarter:invalid_value',
      'capex:not_available',
      'stockOrders:not_available',
      'finance.dividend:not_available',
      'finance.borrow:invalid_value',
    ]);
  });

  it('caps borrowing at the bank capacity and forbids it under a breached covenant', () => {
    const { state, company } = setup();
    const d = { ...emptyDecisions(company.id), finance: { borrow: 1e12 } };
    const capped = normalizeDecisions(state, company, d).decisions.finance.borrow ?? 0;
    expect(capped).toBeGreaterThan(0);
    expect(capped).toBeLessThan(1e8);
    company.credit.covenantBreached = true;
    expect(normalizeDecisions(state, company, d).decisions.finance.borrow).toBeUndefined();
  });

  it('scales discretionary spending down to the available liquidity', () => {
    const { state, company, lineId } = setup();
    const d = emptyDecisions(company.id);
    d.marketing[lineId] = 1e9;
    d.purchasing.spot.push({ commodityId: 'com_steel', qty: 1e6 });
    const { decisions, issues } = normalizeDecisions(state, company, d);
    expect(codes(issues)).toEqual([':budget']);
    const cash = company.books.current.balance.cash;
    const steel = state.commodities.com_steel?.spotPrice ?? 0;
    const spend =
      (decisions.marketing[lineId] ?? 0) + (decisions.purchasing.spot[0]?.qty ?? 0) * steel * 1.02;
    expect(spend).toBeCloseTo(cash, 0);
  });

  it('only lets the player decide for the companies it controls', () => {
    const { state, id } = setup();
    const rival = Object.keys(state.companies).find((c) => c !== id) ?? '';
    const issues = validateDecisions(state, [
      emptyDecisions(rival),
      emptyDecisions(id),
      emptyDecisions(id),
    ]);
    expect(codes(issues)).toEqual([':not_controlled', ':duplicate']);
    const before = state.companies[rival]?.productLines;
    const hostile = emptyDecisions(rival);
    const lineId = Object.keys(before ?? {})[0] ?? '';
    hostile.pricing[lineId] = { price: 1 };
    const { state: next, report } = resolveTurn(state, [hostile]);
    expect(report.issues.map((i) => i.code)).toContain('not_controlled');
    expect(next.companies[rival]?.productLines[lineId]?.price).toBe(before?.[lineId]?.price);
  });

  it('ignores the decisions of a bankrupt company', () => {
    const { state, company, lineId } = setup();
    company.status = 'bankrupt';
    const d = emptyDecisions(company.id);
    d.marketing[lineId] = 1000;
    const { decisions, issues } = normalizeDecisions(state, company, d);
    expect(decisions).toEqual(emptyDecisions(company.id));
    expect(codes(issues)).toEqual([':inactive_company']);
  });
});

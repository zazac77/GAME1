import { describe, expect, it } from 'vitest';
import type { AlertKind, ValidationIssueCode } from '@game/engine';
import { defaultConfig } from '../../engine/src/config/default';
import { AI_PROFILE_IDS, MODIFIER_KEYS } from '../../engine/src/config/schema';
import { parseNumber, quarterLabel } from '../src/i18n/format';
import { alertTexts, eventText, fr, issuePath, issueText, KNOWN_EVENT_KINDS } from '../src/i18n/fr';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const engineSrc = join(__dirname, '../../engine/src');

/** Every journal kind the engine logs (from the source: ctx.log({ kind: '…' }) and log('…', …)). */
function engineEventKinds(): Set<string> {
  const kinds = new Set<string>();
  const walk = (dir: string) => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith('.ts')) {
        const src = readFileSync(p, 'utf8');
        for (const m of src.matchAll(/log\(\{\s*kind: '([a-z_]+)'/g)) kinds.add(m[1] ?? '');
        for (const m of src.matchAll(/\bkind: '([a-z_]+)',\s*\n\s*severity/g))
          kinds.add(m[1] ?? '');
        for (const m of src.matchAll(/\blog\('([a-z_]+)'/g)) kinds.add(m[1] ?? '');
        for (const m of src.matchAll(/'(line_modernized|line_commissioned)'/g))
          kinds.add(m[1] ?? '');
      }
    }
  };
  walk(join(engineSrc, 'systems'));
  return kinds;
}

describe('French labels', () => {
  it('cover the ids of the default config', () => {
    for (const id of Object.keys(defaultConfig.regions)) expect(fr.regions[id]).toBeDefined();
    for (const id of Object.keys(defaultConfig.labor.occupations)) {
      expect(fr.occupations[id]).toBeDefined();
    }
    for (const id of Object.keys(defaultConfig.commodities.markets)) {
      expect(fr.commodities[id]).toBeDefined();
    }
    for (const [id, m] of Object.entries(defaultConfig.products.markets)) {
      expect(fr.productMarkets[id]).toBeDefined();
      for (const s of m.segments) expect(fr.segments[s.id]).toBeDefined();
    }
    for (const ev of defaultConfig.events.definitions) expect(fr.events[ev.id]).toBeDefined();
    for (const key of MODIFIER_KEYS) expect(fr.modifierKeys[key]).toBeDefined();
    for (const id of AI_PROFILE_IDS) expect(fr.profiles[id]).toBeDefined();
  });

  it('phrase every journal entry the engine logs', () => {
    const known = new Set<string>(KNOWN_EVENT_KINDS);
    const logged = engineEventKinds();
    expect(logged.size).toBeGreaterThan(15);
    expect([...logged].filter((k) => !known.has(k))).toEqual([]);
    const name = (id: string) => `<${id}>`;
    for (const kind of KNOWN_EVENT_KINDS) {
      const text = eventText({ turn: 0, kind, severity: 'info', companyId: 'co_001' }, name);
      expect(text).not.toContain(kind);
    }
  });

  it('render alerts and validation issues', () => {
    const kinds = Object.keys(alertTexts) as AlertKind[];
    expect(kinds.length).toBe(8);
    const codes = Object.keys(fr.issueCodes) as ValidationIssueCode[];
    expect(codes.length).toBe(10);
    expect(issuePath('hr[0].wageOffer')).toBe('RH n°1 · salaire proposé');
    expect(
      issueText({
        companyId: 'c',
        path: 'rnd[1].budget',
        code: 'clamped',
        submitted: 1e6,
        applied: 7e5,
      }),
    ).toMatch(/^R&D n°2 · budget : valeur ramenée/);
  });

  it('formats quarters and parses French numbers', () => {
    expect(quarterLabel(0)).toBe('T1 an 1');
    expect(quarterLabel(39)).toBe('T4 an 10');
    expect(parseNumber('1 234,5')).toBe(1234.5);
    expect(parseNumber('12.5')).toBe(12.5);
    expect(Number.isNaN(parseNumber('abc'))).toBe(true);
  });
});

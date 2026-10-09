import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { deserializeGame, serializeGame } from '../../src';
import { hashState } from '../../src/core/hash';
import { SCHEMA_VERSION } from '../../src/core/version';
import { migrateState } from '../../src/persistence/migrations';
import { newGame, playTurns } from '../helpers';

const roundTrip = (s: ReturnType<typeof newGame>) =>
  deserializeGame(
    JSON.parse(JSON.stringify(serializeGame(s, { savedAt: '2026-01-01T00:00:00Z' }))),
  );

describe('save files', () => {
  it('wraps the state with its versions', () => {
    const file = serializeGame(newGame(), { savedAt: '2026-01-01T00:00:00Z' });
    expect(file).toMatchObject({ schemaVersion: SCHEMA_VERSION, savedAt: '2026-01-01T00:00:00Z' });
    expect(file.engineVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(serializeGame(newGame()).savedAt).toBeNull();
  });

  it('round-trips any game exactly', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 0xffffffff }),
        fc.integer({ min: 0, max: 6 }),
        (seed, turns) => {
          const state = playTurns(newGame(seed), turns);
          const loaded = roundTrip(state);
          expect(loaded).toEqual(state);
          expect(hashState(loaded)).toBe(hashState(state));
        },
      ),
      { numRuns: 15 },
    );
  });

  it('accepts JSON text', () => {
    const state = newGame(3);
    expect(deserializeGame(JSON.stringify(serializeGame(state)))).toEqual(state);
  });

  it('resumes a loaded game exactly as the original', () => {
    const state = playTurns(newGame(11), 4);
    const continued = playTurns(state, 5);
    const reloaded = playTurns(roundTrip(state), 5);
    expect(hashState(reloaded)).toBe(hashState(continued));
  });

  it('rejects malformed or future saves', () => {
    const file = serializeGame(newGame());
    expect(() => deserializeGame({})).toThrow(/Invalid save file/);
    expect(() => deserializeGame({ ...file, schemaVersion: SCHEMA_VERSION + 1 })).toThrow(/newer/);
    const broken = structuredClone(file);
    (broken.state as unknown as Record<string, unknown>).companies = 'nope';
    expect(() => deserializeGame(broken)).toThrow(/Invalid save state/);
    const badConfig = structuredClone(file);
    badConfig.state.config.finance.taxRate = 7;
    expect(() => deserializeGame(badConfig)).toThrow(/taxRate/);
  });

  it('chains migrations up to the target version', () => {
    const v1 = { meta: { schemaVersion: 1 }, a: 1 };
    const migrated = migrateState(v1, 1, 3, {
      1: (s) => ({ ...s, b: 2 }),
      2: (s) => ({ ...s, c: (s.a as number) + (s.b as number) }),
    });
    expect(migrated).toEqual({ meta: { schemaVersion: 3 }, a: 1, b: 2, c: 3 });
    expect(() => migrateState(v1, 1, 3, { 1: (s) => s })).toThrow(/v2 to v3/);
  });
});

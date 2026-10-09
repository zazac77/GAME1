import { SCHEMA_VERSION } from '../../core/version';
import { migrateV1ToV2 } from './v1-to-v2';
import { migrateV2ToV3 } from './v2-to-v3';
import { migrateV3ToV4 } from './v3-to-v4';
import { migrateV4ToV5 } from './v4-to-v5';
import { migrateV5ToV6 } from './v5-to-v6';
import { migrateV6ToV7 } from './v6-to-v7';

export type RawState = Record<string, unknown>;
/** Upgrades a raw state by exactly one schema version. */
export type Migration = (state: RawState) => RawState;

/** MIGRATIONS[v] upgrades a state from schemaVersion v to v + 1. */
export const MIGRATIONS: Readonly<Record<number, Migration>> = {
  1: migrateV1ToV2,
  2: migrateV2ToV3,
  3: migrateV3ToV4,
  4: migrateV4ToV5,
  5: migrateV5ToV6,
  6: migrateV6ToV7,
};

export function migrateState(
  state: RawState,
  fromVersion: number,
  targetVersion: number = SCHEMA_VERSION,
  migrations: Readonly<Record<number, Migration>> = MIGRATIONS,
): RawState {
  if (fromVersion > targetVersion) {
    throw new Error(
      `Save schema v${fromVersion} is newer than this engine (v${targetVersion}); update the game`,
    );
  }
  let current = state;
  for (let v = fromVersion; v < targetVersion; v++) {
    const migration = migrations[v];
    if (!migration) throw new Error(`No migration from schema v${v} to v${v + 1}`);
    current = migration(current);
    const meta = current.meta as Record<string, unknown> | undefined;
    if (meta) meta.schemaVersion = v + 1;
  }
  return current;
}

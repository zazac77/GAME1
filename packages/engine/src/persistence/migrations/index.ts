import { SCHEMA_VERSION } from '../../core/version';

export type RawState = Record<string, unknown>;
/** Upgrades a raw state by exactly one schema version. */
export type Migration = (state: RawState) => RawState;

/**
 * MIGRATIONS[v] upgrades a state from schemaVersion v to v + 1.
 * v1 is the first released shape: nothing to migrate yet.
 */
export const MIGRATIONS: Readonly<Record<number, Migration>> = {};

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

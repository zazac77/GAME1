import { z } from 'zod';
import { parseConfig } from '../config/schema';
import { ENGINE_VERSION, SCHEMA_VERSION } from '../core/version';
import type { GameState } from '../model/state';
import { migrateState, type RawState } from './migrations';

export interface SaveFile {
  schemaVersion: number;
  engineVersion: string;
  /** ISO timestamp supplied by the caller (the engine never reads the clock). */
  savedAt: string | null;
  state: GameState;
}

const envelopeSchema = z.object({
  schemaVersion: z.number().int().positive(),
  engineVersion: z.string(),
  savedAt: z.string().nullable(),
  state: z.record(z.string(), z.unknown()),
});

const uint32 = z.number().int().min(0).max(0xffffffff);
const metaSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  seed: uint32,
  rng: z.strictObject({ a: uint32, b: uint32, c: uint32, d: uint32 }),
  turn: z.number().int().min(0),
  mode: z.enum(['standard', 'sandbox']),
  status: z.enum(['running', 'won', 'lost']),
  playerActorId: z.string().min(1),
  idCounters: z.record(z.string(), z.number().int().min(0)),
});

const record = z.record(z.string(), z.unknown());
const stateShapeSchema = z.object({
  meta: metaSchema,
  config: z.unknown(),
  macro: record,
  regions: record,
  labor: record,
  commodities: record,
  productMarkets: record,
  actors: record,
  companies: record,
  stock: record,
  mna: z.object({
    listings: z.array(z.unknown()),
    diligence: z.array(z.unknown()),
    integrations: z.array(z.unknown()),
  }),
  modifiers: z.array(z.unknown()),
  pendingEvents: z.array(z.unknown()),
  aiMemory: record,
  log: z.array(z.unknown()),
  history: z.object({ turns: z.array(z.number()), series: record }),
});

export function serializeGame(state: GameState, opts: { savedAt?: string } = {}): SaveFile {
  return {
    schemaVersion: SCHEMA_VERSION,
    engineVersion: ENGINE_VERSION,
    savedAt: opts.savedAt ?? null,
    state: structuredClone(state),
  };
}

/** Loads a save (object or JSON text), migrating it to the current schema. */
export function deserializeGame(file: unknown): GameState {
  const raw: unknown = typeof file === 'string' ? JSON.parse(file) : file;
  const envelope = envelopeSchema.safeParse(raw);
  if (!envelope.success) {
    throw new Error(`Invalid save file:\n${z.prettifyError(envelope.error)}`);
  }
  const migrated = migrateState(
    structuredClone(envelope.data.state) as RawState,
    envelope.data.schemaVersion,
  );
  const shape = stateShapeSchema.safeParse(migrated);
  if (!shape.success) {
    throw new Error(`Invalid save state:\n${z.prettifyError(shape.error)}`);
  }
  const state = migrated as unknown as GameState;
  state.config = parseConfig(migrated.config);
  return state;
}

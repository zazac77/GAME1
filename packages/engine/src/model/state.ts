import type { GameConfig } from '../config/schema';
import type { AiMemory } from './ai';
import type { Actor, Company } from './company';
import type { GameEvent, Modifier, ScheduledEffect } from './events';
import type { GameMode, Id, LaborPoolKey, Quarter } from './ids';
import type { CommodityMarket, LaborPool, MacroState, ProductMarket, Region } from './markets';
import type { StockMarketState } from './stock';

/** sfc32 state: four uint32 words. */
export interface RngState {
  a: number;
  b: number;
  c: number;
  d: number;
}

export interface GameMeta {
  schemaVersion: number;
  seed: number;
  rng: RngState;
  turn: Quarter;
  mode: GameMode;
  status: 'running' | 'won' | 'lost';
  playerActorId: Id;
  /** Last number allocated per id prefix ("co" → 4 means co_004 exists). */
  idCounters: Record<string, number>;
}

/** Compact series for the charts. Point i describes the start of quarter turns[i]. */
export interface HistoryStore {
  turns: Quarter[];
  /** e.g. "macro.inflation", "company.co_001.cash", "commodity.com_steel.spotPrice". */
  series: Record<string, number[]>;
}

export interface GameState {
  meta: GameMeta;
  /** Effective config, frozen into the save. */
  config: GameConfig;
  macro: MacroState;
  regions: Record<Id, Region>;
  labor: Record<LaborPoolKey, LaborPool>;
  commodities: Record<Id, CommodityMarket>;
  productMarkets: Record<Id, ProductMarket>;
  actors: Record<Id, Actor>;
  companies: Record<Id, Company>;
  stock: StockMarketState;
  modifiers: Modifier[];
  pendingEvents: ScheduledEffect[];
  aiMemory: Record<Id, AiMemory>;
  /** Bounded journal. */
  log: GameEvent[];
  history: HistoryStore;
}

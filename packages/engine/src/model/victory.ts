import type { RndType } from './company';
import type { Statements } from './finance';
import type { GameMode, Id, LaborPoolKey, Money, Quarter, SectorId } from './ids';

export type VictoryReason =
  /** The objective of the mode is reached. */
  | 'objective'
  /** Survival: still standing at the end of the game. */
  | 'survived'
  /** The objective was not reached by the end of the game. */
  | 'deadline'
  /** The player's company (or its last operating company) went bankrupt. */
  | 'bankruptcy';

/** Progress towards the objective of the mode, updated at the end of every quarter (step 13). */
export interface VictoryState {
  /** Quarters in a row the player's group sold more than domination.share, by product market. */
  dominationStreaks: Record<Id, number>;
  /** Quarters in a row the player's group made a net profit in the sector, by sector. */
  profitableStreaks: Partial<Record<SectorId, number>>;
  /** Set when the game ends. */
  outcome?: { status: 'won' | 'lost'; reason: VictoryReason; turn: Quarter };
}

/** What the UI shows of the objective (PlayerView.objective). */
export interface ObjectiveView {
  mode: GameMode;
  /** Last quarter of the game (absent: sandbox, no end). */
  lastTurn?: Quarter;
  /** 0..1 towards the objective (survival: share of the game played). */
  progress: number;
  /** Capitalization: score and target (indexed on the price level). */
  score?: Money;
  target?: Money;
  /** Domination: required share and quarters, best market of the group, its share and streak. */
  share?: number;
  quarters?: number;
  bestMarketId?: Id;
  bestShare?: number;
  streak?: number;
  /** Conglomerate: sectors needed and the group's streak of profitable quarters by sector. */
  sectors?: number;
  sectorStreaks?: Partial<Record<SectorId, number>>;
  outcome?: VictoryState['outcome'];
}

/** What an espionage operation brought back on a rival (private figures at the start of a quarter). */
export interface IntelReport {
  id: Id;
  /** Quarter the operation ran (figures as of the start of that quarter). */
  turn: Quarter;
  spyId: Id;
  targetId: Id;
  /** Last closed quarter's statements, published or not. */
  statements?: Statements;
  cash: Money;
  debt: Money;
  /** Staff by labor pool: headcount and average wage. */
  workforce: { key: LaborPoolKey; headcount: number; wage: Money }[];
  /** Stocks by item (commodities and finished goods). */
  inventory: Record<Id, number>;
  /** Product lines: price, quality, quality aimed at, tech level. */
  lines: { lineId: Id; price: Money; quality: number; qualityTarget: number; techLevel?: number }[];
  /** R&D projects under way. */
  rnd: { type: RndType; progress: number; spent: Money }[];
}

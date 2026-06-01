// ============================================================
// ArcadeStrike — Shared Types (server + client)
// ============================================================

export type PlayerId = string;
export type MatchId  = string;
export type RoomId   = string;

// ─── Matchmaking ─────────────────────────────────────────────
export interface QueueEntry {
  playerId: PlayerId;
  displayName: string;
  mmr: number;
  enqueuedAt: number; // Date.now()
  wager?: bigint;
}

export type MatchmakingStatus =
  | 'idle'
  | 'searching'
  | 'found'
  | 'joining'
  | 'in_game';

// ─── Room / Game ──────────────────────────────────────────────
export type GamePhase =
  | 'waiting'
  | 'countdown'
  | 'fighting'
  | 'round_end'
  | 'match_end';

export interface PlayerInputPayload {
  seq:   number;
  tick:  number;
  left:  boolean;
  right: boolean;
  jump:  boolean;
  attack: boolean;
  block:  boolean;
}

export interface Vec2 {
  x: number;
  y: number;
}

// ─── Messages: Client → Server ───────────────────────────────
export const MSG_INPUT      = 'input';
export const MSG_READY      = 'ready';
export const MSG_PING       = 'ping';

// ─── Messages: Server → Client ───────────────────────────────
export const MSG_PONG            = 'pong';
export const MSG_MATCH_FOUND     = 'match_found';
export const MSG_COUNTDOWN       = 'countdown';
export const MSG_ROUND_START     = 'round_start';
export const MSG_ROUND_END       = 'round_end';
export const MSG_MATCH_END       = 'match_end';
export const MSG_PLAYER_HIT      = 'player_hit';
export const MSG_GAME_ERROR      = 'game_error';

// ─── Combat ──────────────────────────────────────────────────
export interface HitResult {
  attackerId: PlayerId;
  defenderId: PlayerId;
  damage:     number;
  tick:       number;
  type:       'normal' | 'critical' | 'blocked';
}

export interface RoundResult {
  winnerId: PlayerId | null; // null = draw
  reason:   'hp' | 'timeout' | 'disconnect';
  tick:     number;
}

export interface MatchResult {
  matchId:    MatchId;
  winnerId:   PlayerId;
  loserId:    PlayerId;
  rounds:     RoundResult[];
  durationMs: number;
}

// ─── Economy ─────────────────────────────────────────────────
export type CreditType = 'REAL' | 'PROMO';

export interface WalletSnapshot {
  playerId:     PlayerId;
  realCredits:  string; // bigint as string
  promoCredits: string;
}

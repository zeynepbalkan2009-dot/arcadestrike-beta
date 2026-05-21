// ============================================================
// @arcadestrike/shared — canonical type definitions
// Used verbatim by both server and client (no duplication)
// ============================================================

// ----------------------------------------------------------
// PRIMITIVES
// ----------------------------------------------------------

export type PlayerId = string;
export type MatchId = string;
export type WalletAddress = `0x${string}`;

// ----------------------------------------------------------
// INPUT SYSTEM
// ----------------------------------------------------------

export const INPUT_MOVE_LEFT  = 0b0001 as const;
export const INPUT_MOVE_RIGHT = 0b0010 as const;
export const INPUT_ATTACK     = 0b0100 as const;
export const INPUT_SPECIAL    = 0b1000 as const;

export type InputBitmask = number; // 4 bits: moveLeft | moveRight | attack | special

export interface PlayerInput {
  seq:       number;       // monotonic sequence number, server validates order
  tick:      number;       // client-reported tick (server verifies against real tick)
  bitmask:   InputBitmask;
  timestamp: number;       // client ms — used for latency estimate only
}

// ----------------------------------------------------------
// PHYSICS / COMBAT CONSTANTS  (shared deterministic values)
// ----------------------------------------------------------

export const ARENA_WIDTH       = 800;
export const ARENA_HEIGHT      = 450;
export const GROUND_Y          = 400;
export const PLAYER_WIDTH      = 40;
export const PLAYER_HEIGHT     = 70;
export const MOVE_SPEED        = 220;       // px/sec
export const GRAVITY           = 980;       // px/sec²
export const JUMP_VELOCITY     = -520;      // px/sec (unused in v1 — flat arena)
export const ATTACK_RANGE      = 90;        // px — melee reach
export const ATTACK_DAMAGE     = 12;        // HP per hit
export const SPECIAL_DAMAGE    = 28;        // HP per special
export const ATTACK_COOLDOWN   = 0.5;       // sec
export const SPECIAL_COOLDOWN  = 4.0;       // sec
export const COMBO_WINDOW      = 0.35;      // sec — second hit must land within window
export const COMBO_MULTIPLIER  = 1.5;       // damage * multiplier for second combo hit
export const MAX_HP            = 100;
export const MATCH_DURATION    = 60;        // seconds
export const TICK_RATE         = 20;        // server ticks per second
export const TICK_MS           = 1000 / TICK_RATE;

// ----------------------------------------------------------
// PLAYER STATE
// ----------------------------------------------------------

export type PlayerAnimState =
  | 'idle'
  | 'run'
  | 'attack'
  | 'special'
  | 'hit'
  | 'dead';

export interface Vec2 { x: number; y: number }

export interface PlayerState {
  id:              PlayerId;
  x:               number;
  y:               number;
  vx:              number;       // velocity x
  vy:              number;       // velocity y
  facingRight:     boolean;
  hp:              number;
  maxHp:           number;
  attackCooldown:  number;       // seconds remaining
  specialCooldown: number;       // seconds remaining
  comboCount:      number;       // 0 or 1
  comboTimer:      number;       // time left in combo window
  animState:       PlayerAnimState;
  lastInputSeq:    number;
  isGrounded:      boolean;
  invincibleTimer: number;       // brief i-frames after taking hit
}

// ----------------------------------------------------------
// MATCH STATE
// ----------------------------------------------------------

export type MatchPhase =
  | 'waiting'     // < 2 players connected
  | 'countdown'   // 3-2-1 before fight
  | 'fighting'    // active combat
  | 'result'      // match over, result determined
  | 'settling';   // blockchain settlement in progress

export interface MatchState {
  matchId:      MatchId;
  phase:        MatchPhase;
  tick:         number;
  elapsedSec:   number;
  remainingSec: number;
  players:      Record<PlayerId, PlayerState>;
  winnerId:     PlayerId | null;
  reason:       'timeout' | 'knockout' | null;
  wagerAmountUSD: number;
}

// ----------------------------------------------------------
// NETWORK MESSAGES  (client → server)
// ----------------------------------------------------------

export type ClientMessageType =
  | 'INPUT'
  | 'PING'
  | 'READY'
  | 'REMATCH_REQUEST';

export interface ClientMessage<T = unknown> {
  type: ClientMessageType;
  payload: T;
}

export interface InputMessage extends ClientMessage<PlayerInput> {
  type: 'INPUT';
}

export interface PingMessage extends ClientMessage<{ clientTs: number }> {
  type: 'PING';
}

// ----------------------------------------------------------
// NETWORK MESSAGES  (server → client)
// ----------------------------------------------------------

export type ServerMessageType =
  | 'STATE_SNAPSHOT'
  | 'STATE_DELTA'
  | 'MATCH_START'
  | 'MATCH_END'
  | 'HIT_CONFIRM'
  | 'PONG'
  | 'ERROR'
  | 'SETTLEMENT_UPDATE';

export interface ServerMessage<T = unknown> {
  type: ServerMessageType;
  payload: T;
  serverTick: number;
}

export interface StateSnapshotPayload {
  state: MatchState;
  yourPlayerId: PlayerId;
}

export interface HitConfirmPayload {
  attackerId:   PlayerId;
  targetId:     PlayerId;
  damage:       number;
  isCombo:      boolean;
  isSpecial:    boolean;
  targetHpLeft: number;
}

export interface MatchEndPayload {
  winnerId:        PlayerId | null;
  reason:          'timeout' | 'knockout';
  finalState:      MatchState;
  settlementNonce: string;   // signed by server for oracle verification
  signature:       string;   // EIP-712 signature
}

export interface SettlementUpdatePayload {
  status: 'pending' | 'confirmed' | 'failed';
  txHash?: string;
  error?:  string;
}

// ----------------------------------------------------------
// MATCHMAKING
// ----------------------------------------------------------

export type WagerTier = '0.50' | '1.00' | '2.00' | '5.00' | '10.00' | '25.00';

export const WAGER_TIERS: WagerTier[] = ['0.50', '1.00', '2.00', '5.00', '10.00', '25.00'];

export interface QueueEntry {
  playerId:   PlayerId;
  walletAddr: WalletAddress;
  wagerTier:  WagerTier;
  queuedAt:   number;       // unix ms
  rating:     number;       // simple ELO, starts at 1000
}

export interface MatchFoundPayload {
  matchId:    MatchId;
  opponentId: PlayerId;
  wagerTier:  WagerTier;
  escrowAddr: string;
}

// ----------------------------------------------------------
// ECONOMY
// ----------------------------------------------------------

export type CreditType = 'real' | 'promo';

export interface WalletBalance {
  real:  number;   // USD-backed, withdrawable
  promo: number;   // ad-earned, non-withdrawable
}

export interface Transaction {
  id:        string;
  playerId:  PlayerId;
  type:      'deposit' | 'withdraw' | 'wager_lock' | 'wager_win' | 'wager_loss' | 'fee' | 'ad_reward';
  amount:    number;
  credit:    CreditType;
  timestamp: number;
  matchId?:  MatchId;
  txHash?:   string;
}

export interface DailyLimitStatus {
  lossToday:  number;    // USD
  hardLimit:  number;    // 50.00
  softLimit:  number;    // 30.00
  warningIssued: boolean;
  resetAt:    number;    // unix ms — midnight UTC
}

// ----------------------------------------------------------
// ANTI-CHEAT
// ----------------------------------------------------------

export interface InputValidationResult {
  valid:  boolean;
  reason?: string;
}

// ----------------------------------------------------------
// SETTLEMENT / WEB3
// ----------------------------------------------------------

export interface MatchResult {
  matchId:   MatchId;
  winnerId:  PlayerId;
  player1:   WalletAddress;
  player2:   WalletAddress;
  wagerWei:  bigint;
  nonce:     string;         // unique per match, prevents replay
  timestamp: number;
}

// EIP-712 domain for oracle signature
export const ORACLE_DOMAIN_NAME    = 'ArcadeStrikeOracle';
export const ORACLE_DOMAIN_VERSION = '1';

export interface OracleSignedResult {
  result:    MatchResult;
  signature: string;         // secp256k1 signature from oracle EOA
}

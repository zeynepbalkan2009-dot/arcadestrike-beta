// ============================================================
// @arcadestrike/shared — canonical source of truth for all
// types shared between server and client.
// ============================================================

// ─── Player / Fighter ───────────────────────────────────────

export interface Vec2 {
  x: number;
  y: number;
}

export interface FighterState {
  id: string;
  playerId: string;
  pos: Vec2;
  vel: Vec2;
  hp: number;            // 0-100
  facing: 1 | -1;       // 1 = right, -1 = left
  actionState: ActionState;
  attackCooldown: number; // ticks remaining
  specialCooldown: number;
  comboCount: number;    // 0-2 consecutive hits
  comboTimer: number;    // ticks until combo resets
  isGrounded: boolean;
  stunTicks: number;     // ticks of stun remaining
  lastProcessedInput: number; // sequence number
}

export type ActionState =
  | 'idle'
  | 'walking'
  | 'jumping'
  | 'attacking'
  | 'special'
  | 'blocking'
  | 'hit'
  | 'knockback'
  | 'dead';

// ─── Inputs ─────────────────────────────────────────────────

export interface PlayerInput {
  seq: number;           // monotonically increasing per player
  tick: number;
  left: boolean;
  right: boolean;
  jump: boolean;
  attack: boolean;
  special: boolean;
  timestamp: number;     // client epoch ms (for anti-cheat timing)
}

// ─── Game State ─────────────────────────────────────────────

export interface GameState {
  tick: number;
  fighters: Record<string, FighterState>;
  matchTimer: number;    // ticks remaining
  phase: MatchPhase;
  roundWinner: string | null;
  scores: Record<string, number>; // player id -> rounds won
  winnerId?: string | null;
  loserId?: string | null;
  endReason?: MatchEndReason | null;
}

export type MatchPhase =
  | 'waiting'
  | 'countdown'
  | 'fighting'
  | 'round_end'
  | 'match_end';

export type MatchEndReason =
  | 'ko'
  | 'timeout'
  | 'disconnect'
  | 'afk'
  | 'forfeit';

// ─── Match Lifecycle ─────────────────────────────────────────

export type MatchLifecycleStage =
  | 'lobby'
  | 'queue'
  | 'match_found'
  | 'escrow_locking'
  | 'escrow_locked'
  | 'countdown'
  | 'fighting'
  | 'result'
  | 'oracle_verifying'
  | 'payout_complete';

export interface MatchConfig {
  matchId: string;
  players: [string, string];  // [player1Id, player2Id]
  wagerAmount: string;        // in wei / smallest unit
  currency: 'REAL' | 'PROMO';
  maxRounds: number;          // typically 3
  tickRate: number;           // 20
  matchDurationTicks: number; // 20 * 60 = 1200 (60s)
  arenaId: string;
}

// ─── Network Messages ────────────────────────────────────────

// Client → Server
export type C2SMessage =
  | { type: 'INPUT'; payload: PlayerInput }
  | { type: 'JOIN_QUEUE'; payload: JoinQueueRequest }
  | { type: 'LEAVE_QUEUE' }
  | { type: 'REMATCH_VOTE'; payload: { vote: boolean } }
  | { type: 'ESCROW_CONFIRMED'; payload: { txHash: string } };

// Server → Client
export type S2CMessage =
  | { type: 'STATE_SNAPSHOT'; payload: StateSnapshot }
  | { type: 'STATE_DELTA'; payload: StateDelta }
  | { type: 'MATCH_FOUND'; payload: MatchFoundPayload }
  | { type: 'MATCH_START'; payload: MatchConfig }
  | { type: 'ROUND_END'; payload: RoundEndPayload }
  | { type: 'MATCH_END'; payload: MatchEndPayload }
  | { type: 'QUEUE_UPDATE'; payload: QueueUpdatePayload }
  | { type: 'INPUT_ACK'; payload: { seq: number; tick: number } }
  | { type: 'ORACLE_RESULT'; payload: OracleResult }
  | { type: 'REMATCH_START'; payload: Record<string, never> }
  | { type: 'REMATCH_DECLINED'; payload: Record<string, never> }
  | { type: 'ERROR'; payload: { code: ErrorCode; message: string } };

export interface StateSnapshot {
  tick: number;
  state: GameState;
  yourPlayerId: string;
}

export interface StateDelta {
  tick: number;
  // Partial changes only — fighter position/hp updates
  fighters?: Partial<Record<string, Partial<FighterState>>>;
  matchTimer?: number;
  phase?: MatchPhase;
  roundWinner?: string | null;
}

export interface MatchFoundPayload {
  matchId: string;
  opponent: PublicPlayerProfile;
  wagerAmount: string;
  escrowAddress: string;
  currency: 'REAL' | 'PROMO';
  expiresAt: number; // epoch ms to accept/decline
}

export interface RoundEndPayload {
  round: number;
  winnerId: string;
  scores: Record<string, number>;
}

export interface MatchEndPayload {
  matchId: string;
  winnerId: string;
  loserId: string;
  reason?: MatchEndReason;
  scores: Record<string, number>;
  oracleSignatureRequest?: OracleSignatureRequest;
  payout?: PayoutInfo;
}

export interface QueueUpdatePayload {
  position: number;
  estimatedWaitMs: number;
}

export interface OracleSignatureRequest {
  matchId: string;
  winnerId: string;
  loserId: string;
  wagerAmount: string;
  nonce: string;  // prevent replay
}

export interface OracleResult {
  matchId: string;
  signature: string;  // oracle-signed EIP-712 payload
  txHash?: string;    // set after on-chain resolution
}

export interface PayoutInfo {
  gross: string;    // total pot in wei
  fee: string;      // 5% in wei
  net: string;      // winner receives
  treasury: string; // 2% portion
  burn: string;     // 3% portion
}

// ─── Matchmaking / Queue ─────────────────────────────────────

export interface JoinQueueRequest {
  wagerAmount: string;
  currency: 'REAL' | 'PROMO';
  queueMode?: QueueMode;
}

export type QueueMode = 'quick' | 'ranked';

export interface QueueEntry {
  playerId: string;
  wagerAmount: string;
  currency: 'REAL' | 'PROMO';
  queueMode: QueueMode;
  joinedAt: number;
  elo: number;
}

// ─── Economy ─────────────────────────────────────────────────

export type CreditType = 'REAL' | 'PROMO';

export interface PlayerWallet {
  playerId: string;
  realCredits: string;   // stored as BigInt string (wei)
  promoCredits: string;
  dailyLossUsed: string; // resets at midnight UTC
  dailyLossDate: string; // YYYY-MM-DD
}

export const DAILY_LOSS_LIMIT = '50000000000000000000'; // $50 in wei
export const DAILY_LOSS_WARNING = '30000000000000000000'; // $30 warning

// ─── Player Profile ──────────────────────────────────────────

export interface PublicPlayerProfile {
  id: string;
  username: string;
  elo: number;
  wins: number;
  losses: number;
  winStreak: number;
  avatarId: number;
}

export interface PrivatePlayerProfile extends PublicPlayerProfile {
  walletAddress?: string;
  embeddedWalletAddress: string;
  wallet: PlayerWallet;
}

// ─── Constants ──────────────────────────────────────────────

export const GAME_CONSTANTS = {
  // Physics
  ARENA_WIDTH: 800,
  ARENA_HEIGHT: 400,
  GROUND_Y: 350,
  GRAVITY: 1.2,
  JUMP_FORCE: -18,
  MOVE_SPEED: 4,
  MAX_FALL_SPEED: 20,

  // Fighter
  MAX_HP: 100,
  FIGHTER_WIDTH: 48,
  FIGHTER_HEIGHT: 80,

  // Combat
  ATTACK_DAMAGE: 12,
  SPECIAL_DAMAGE: 22,
  ATTACK_COOLDOWN_TICKS: 14,  // ~0.7s at 20 ticks
  SPECIAL_COOLDOWN_TICKS: 60, // ~3s
  ATTACK_RANGE: 80,
  COMBO_WINDOW_TICKS: 20,     // hits within window = combo
  COMBO_MULTIPLIER: 1.4,
  STUN_TICKS: 8,
  KNOCKBACK_FORCE: 10,

  // Server
  TICK_RATE: 20,
  MATCH_DURATION_TICKS: 1200, // 60s
  COUNTDOWN_TICKS: 60,        // 3s
  MAX_ROUNDS: 3,
  INPUT_BUFFER_SIZE: 10,
  MAX_INPUT_RATE: 25,          // inputs per second anti-cheat
  MAX_ROLLBACK_TICKS: 5,

  // Economy
  FEE_TOTAL_BPS: 500,          // 5%
  FEE_TREASURY_BPS: 200,       // 2%
  FEE_BURN_BPS: 300,           // 3%
};

// ─── Error Codes ─────────────────────────────────────────────

export type ErrorCode =
  | 'DAILY_LOSS_LIMIT_REACHED'
  | 'DAILY_LOSS_WARNING'
  | 'INSUFFICIENT_BALANCE'
  | 'QUEUE_FULL'
  | 'INVALID_WAGER'
  | 'MATCH_NOT_FOUND'
  | 'ALREADY_IN_QUEUE'
  | 'ESCROW_FAILED'
  | 'ORACLE_FAILED'
  | 'RATE_LIMITED'
  | 'INVALID_INPUT';

// ─── Anti-Cheat ──────────────────────────────────────────────

export interface AntiCheatReport {
  playerId: string;
  matchId: string;
  violations: AntiCheatViolation[];
  severity: 'warn' | 'ban';
}

export interface AntiCheatViolation {
  type: 'input_rate' | 'impossible_position' | 'invalid_action' | 'replay_input';
  tick: number;
  details: string;
}

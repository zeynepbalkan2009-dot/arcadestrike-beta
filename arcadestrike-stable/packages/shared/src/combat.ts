// ============================================================
// ArcadeStrike — Combat Constants (authoritative, shared)
// Both server (simulation) and client (prediction) import these.
// ============================================================

export const TICK_RATE        = 20;          // ticks per second
export const TICK_MS          = 1000 / TICK_RATE;

export const STAGE_WIDTH      = 800;
export const STAGE_HEIGHT     = 450;
export const GROUND_Y         = 380;

export const GRAVITY          = 1800;        // px/s²
export const JUMP_VELOCITY    = -620;        // px/s
export const MOVE_SPEED       = 220;         // px/s
export const MAX_HP           = 100;
export const ROUND_DURATION_S = 99;
export const ROUNDS_TO_WIN    = 2;

// Attack hitbox & damage
export const ATTACK_RANGE     = 80;          // px
export const ATTACK_DAMAGE    = 12;
export const CRIT_MULTIPLIER  = 1.5;
export const BLOCK_REDUCTION  = 0.25;        // 75% damage reduction when blocking
export const ATTACK_COOLDOWN_MS = 400;

// Anti-cheat thresholds
export const MAX_POSITION_DELTA_PER_TICK = MOVE_SPEED * (TICK_MS / 1000) * 2.5; // generous for lag
export const MAX_INPUT_RATE_PER_SECOND   = TICK_RATE * 3;
export const MAX_SEQ_GAP                 = 10; // flag if client skips >10 sequence numbers

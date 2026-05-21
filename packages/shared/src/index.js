"use strict";
// ============================================================
// @arcadestrike/shared — canonical source of truth for all
// types shared between server and client.
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.GAME_CONSTANTS = exports.DAILY_LOSS_WARNING = exports.DAILY_LOSS_LIMIT = void 0;
exports.DAILY_LOSS_LIMIT = '50000000000000000000'; // $50 in wei
exports.DAILY_LOSS_WARNING = '30000000000000000000'; // $30 warning
// ─── Constants ──────────────────────────────────────────────
exports.GAME_CONSTANTS = {
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
    ATTACK_COOLDOWN_TICKS: 14, // ~0.7s at 20 ticks
    SPECIAL_COOLDOWN_TICKS: 60, // ~3s
    ATTACK_RANGE: 80,
    COMBO_WINDOW_TICKS: 20, // hits within window = combo
    COMBO_MULTIPLIER: 1.4,
    STUN_TICKS: 8,
    KNOCKBACK_FORCE: 10,
    // Server
    TICK_RATE: 20,
    MATCH_DURATION_TICKS: 1200, // 60s
    COUNTDOWN_TICKS: 60, // 3s
    MAX_ROUNDS: 3,
    INPUT_BUFFER_SIZE: 10,
    MAX_INPUT_RATE: 25, // inputs per second anti-cheat
    MAX_ROLLBACK_TICKS: 5,
    // Economy
    FEE_TOTAL_BPS: 500, // 5%
    FEE_TREASURY_BPS: 200, // 2%
    FEE_BURN_BPS: 300, // 3%
};

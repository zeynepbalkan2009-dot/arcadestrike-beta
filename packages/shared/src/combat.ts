// ============================================================
// @arcadestrike/shared — Deterministic Combat Engine
//
// This module is THE source of truth for all physics and
// combat logic. It runs server-side (authoritative) and
// client-side (prediction / reconciliation).
//
// RULES:
//   - Pure functions only (no side effects, no Date.now())
//   - All state transitions must be deterministic given same input
//   - Never import from Node.js or browser APIs
// ============================================================

import type { PlayerState, PlayerInput, MatchState } from './types.js';
import {
  ARENA_WIDTH,
  GROUND_Y,
  PLAYER_WIDTH,
  PLAYER_HEIGHT,
  MOVE_SPEED,
  ATTACK_RANGE,
  ATTACK_DAMAGE,
  SPECIAL_DAMAGE,
  ATTACK_COOLDOWN,
  SPECIAL_COOLDOWN,
  COMBO_WINDOW,
  COMBO_MULTIPLIER,
  MAX_HP,
  MATCH_DURATION,
  TICK_MS,
  INPUT_MOVE_LEFT,
  INPUT_MOVE_RIGHT,
  INPUT_ATTACK,
  INPUT_SPECIAL,
} from './types.js';

const DT = TICK_MS / 1000; // seconds per tick

// ----------------------------------------------------------
// PLAYER FACTORY
// ----------------------------------------------------------

export function createPlayerState(id: string, spawnX: number): PlayerState {
  return {
    id,
    x: spawnX,
    y: GROUND_Y - PLAYER_HEIGHT,
    vx: 0,
    vy: 0,
    facingRight: spawnX < ARENA_WIDTH / 2 ? false : true,
    hp: MAX_HP,
    maxHp: MAX_HP,
    attackCooldown: 0,
    specialCooldown: 0,
    comboCount: 0,
    comboTimer: 0,
    animState: 'idle',
    lastInputSeq: 0,
    isGrounded: true,
    invincibleTimer: 0,
  };
}

// ----------------------------------------------------------
// INPUT VALIDATION
// ----------------------------------------------------------

export function validateInput(
  input: PlayerInput,
  player: PlayerState,
  serverTick: number,
): { valid: boolean; reason?: string } {
  // Sequence must advance (prevents replay)
  if (input.seq <= player.lastInputSeq) {
    return { valid: false, reason: 'stale_seq' };
  }
  // Tick must be within ±3 ticks of server tick (handles network jitter)
  if (Math.abs(input.tick - serverTick) > 5) {
    return { valid: false, reason: 'tick_too_far' };
  }
  // Bitmask must only use 4 valid bits
  if ((input.bitmask & ~0b1111) !== 0) {
    return { valid: false, reason: 'invalid_bitmask' };
  }
  // Cannot move left AND right simultaneously
  if ((input.bitmask & INPUT_MOVE_LEFT) && (input.bitmask & INPUT_MOVE_RIGHT)) {
    return { valid: false, reason: 'contradictory_input' };
  }
  return { valid: true };
}

// ----------------------------------------------------------
// PHYSICS STEP  (pure, no side effects)
// ----------------------------------------------------------

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function applyMovement(p: PlayerState, input: PlayerInput): PlayerState {
  let vx = 0;
  if (input.bitmask & INPUT_MOVE_LEFT)  vx = -MOVE_SPEED;
  if (input.bitmask & INPUT_MOVE_RIGHT) vx =  MOVE_SPEED;

  const newX = clamp(
    p.x + vx * DT,
    PLAYER_WIDTH / 2,
    ARENA_WIDTH - PLAYER_WIDTH / 2
  );

  // Facing direction follows movement
  const facingRight = vx > 0 ? true : vx < 0 ? false : p.facingRight;

  return { ...p, x: newX, vx, facingRight };
}

// ----------------------------------------------------------
// COMBAT RESOLUTION
// ----------------------------------------------------------

function resolveAttack(
  attacker: PlayerState,
  defender: PlayerState,
  isSpecial: boolean,
): { attacker: PlayerState; defender: PlayerState; hitConfirmed: boolean } {
  const baseDmg  = isSpecial ? SPECIAL_DAMAGE : ATTACK_DAMAGE;
  const cooldown = isSpecial ? SPECIAL_COOLDOWN : ATTACK_COOLDOWN;

  // Range check (axis-aligned)
  const dist = Math.abs(attacker.x - defender.x);
  if (dist > ATTACK_RANGE) {
    // Whiff — still apply cooldown
    const a = { ...attacker };
    if (isSpecial) a.specialCooldown = cooldown;
    else           a.attackCooldown  = cooldown;
    a.animState = isSpecial ? 'special' : 'attack';
    return { attacker: a, defender, hitConfirmed: false };
  }

  // Combo multiplier
  let damage = baseDmg;
  let newComboCount = 0;
  let newComboTimer = 0;

  if (!isSpecial && attacker.comboCount === 1 && attacker.comboTimer > 0) {
    damage = Math.round(baseDmg * COMBO_MULTIPLIER);
    newComboCount = 0; // combo exhausted
  } else if (!isSpecial) {
    newComboCount = 1;
    newComboTimer = COMBO_WINDOW;
  }

  // Defender i-frames prevent hit stacking
  let actualDamage = 0;
  let newDefender = { ...defender };
  if (defender.invincibleTimer <= 0) {
    actualDamage = damage;
    newDefender.hp = Math.max(0, defender.hp - actualDamage);
    newDefender.invincibleTimer = 0.25; // 250ms i-frames
    newDefender.animState = newDefender.hp <= 0 ? 'dead' : 'hit';
  }

  const newAttacker = { ...attacker };
  if (isSpecial) newAttacker.specialCooldown = cooldown;
  else           newAttacker.attackCooldown  = cooldown;
  newAttacker.comboCount = newComboCount;
  newAttacker.comboTimer = newComboTimer;
  newAttacker.animState  = isSpecial ? 'special' : 'attack';

  return { attacker: newAttacker, defender: newDefender, hitConfirmed: actualDamage > 0 };
}

// ----------------------------------------------------------
// TICK SIMULATION  (main entry point)
// ----------------------------------------------------------

export interface TickResult {
  state:       MatchState;
  hitEvents:   HitEvent[];
  matchEnded:  boolean;
}

export interface HitEvent {
  attackerId:   string;
  targetId:     string;
  damage:       number;
  isCombo:      boolean;
  isSpecial:    boolean;
  targetHpLeft: number;
}

export function simulateTick(
  state: MatchState,
  inputs: Record<string, PlayerInput>,
): TickResult {
  const hitEvents: HitEvent[] = [];
  const players = { ...state.players };

  // Clone all players immutably
  for (const id of Object.keys(players)) {
    players[id] = { ...players[id]! };
  }

  const playerIds = Object.keys(players);

  // 1. Advance timers
  for (const id of playerIds) {
    const p = players[id]!;
    players[id] = {
      ...p,
      attackCooldown:  Math.max(0, p.attackCooldown  - DT),
      specialCooldown: Math.max(0, p.specialCooldown - DT),
      comboTimer:      Math.max(0, p.comboTimer      - DT),
      invincibleTimer: Math.max(0, p.invincibleTimer - DT),
    };
  }

  // 2. Apply inputs per player
  for (const id of playerIds) {
    const input = inputs[id];
    if (!input) continue;

    let p = players[id]!;
    const valid = validateInput(input, p, state.tick);
    if (!valid.valid) continue;

    p = { ...p, lastInputSeq: input.seq };

    // Movement
    p = applyMovement(p, input);

    // Attack
    const wantsAttack  = !!(input.bitmask & INPUT_ATTACK);
    const wantsSpecial = !!(input.bitmask & INPUT_SPECIAL);

    if (wantsSpecial && p.specialCooldown <= 0 && p.hp > 0) {
      // Find opponent
      const opponentId = playerIds.find(oid => oid !== id);
      if (opponentId) {
        const opp = players[opponentId]!;
        if (opp.hp > 0) {
          const result = resolveAttack(p, opp, true);
          p = result.attacker;
          players[opponentId] = result.defender;
          if (result.hitConfirmed) {
            const prevHp = opp.hp;
            hitEvents.push({
              attackerId:   id,
              targetId:     opponentId,
              damage:       prevHp - players[opponentId]!.hp,
              isCombo:      false,
              isSpecial:    true,
              targetHpLeft: players[opponentId]!.hp,
            });
          }
        }
      }
    } else if (wantsAttack && p.attackCooldown <= 0 && p.hp > 0) {
      const opponentId = playerIds.find(oid => oid !== id);
      if (opponentId) {
        const opp = players[opponentId]!;
        if (opp.hp > 0) {
          const wasCombo = p.comboCount === 1 && p.comboTimer > 0;
          const result   = resolveAttack(p, opp, false);
          p = result.attacker;
          players[opponentId] = result.defender;
          if (result.hitConfirmed) {
            const prevHp = opp.hp;
            hitEvents.push({
              attackerId:   id,
              targetId:     opponentId,
              damage:       prevHp - players[opponentId]!.hp,
              isCombo:      wasCombo,
              isSpecial:    false,
              targetHpLeft: players[opponentId]!.hp,
            });
          }
        }
      }
    }

    // Animation state
    if (p.animState !== 'attack' && p.animState !== 'special' && p.animState !== 'hit' && p.hp > 0) {
      p.animState = Math.abs(p.vx) > 0 ? 'run' : 'idle';
    }
    // Decay hit/attack anim after a tick
    if (p.animState === 'hit' && p.invincibleTimer < 0.15) p.animState = 'idle';

    players[id] = p;
  }

  // 3. Advance time
  const newElapsed    = state.elapsedSec + DT;
  const newRemaining  = Math.max(0, MATCH_DURATION - newElapsed);
  const newTick       = state.tick + 1;

  // 4. Check win condition
  let winnerId: string | null = null;
  let reason: 'timeout' | 'knockout' | null = null;
  let matchEnded = false;

  const p1Id = playerIds[0];
  const p2Id = playerIds[1];

  if (p1Id && p2Id) {
    const p1 = players[p1Id]!;
    const p2 = players[p2Id]!;

    if (p1.hp <= 0 && p2.hp <= 0) {
      // Simultaneous KO — earlier death loses (whoever has lower hp wins)
      winnerId = p1.hp <= p2.hp ? p2Id : p1Id;
      reason   = 'knockout';
      matchEnded = true;
    } else if (p1.hp <= 0) {
      winnerId = p2Id;
      reason   = 'knockout';
      matchEnded = true;
    } else if (p2.hp <= 0) {
      winnerId = p1Id;
      reason   = 'knockout';
      matchEnded = true;
    } else if (newRemaining <= 0) {
      // Timeout — higher HP wins
      winnerId = p1.hp >= p2.hp ? p1Id : p2Id;
      reason   = 'timeout';
      matchEnded = true;
    }
  }

  const newState: MatchState = {
    ...state,
    tick:         newTick,
    elapsedSec:   newElapsed,
    remainingSec: newRemaining,
    players,
    phase:        matchEnded ? 'result' : state.phase,
    winnerId:     matchEnded ? winnerId : state.winnerId,
    reason:       matchEnded ? reason   : state.reason,
  };

  return { state: newState, hitEvents, matchEnded };
}

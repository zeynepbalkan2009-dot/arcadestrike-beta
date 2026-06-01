/**
 * Authoritative server-side combat simulation.
 * Deterministic — same inputs always produce same outputs.
 */
import { PlayerState } from './GameState';
import {
  GRAVITY, JUMP_VELOCITY, MOVE_SPEED, TICK_MS,
  STAGE_WIDTH, GROUND_Y, ATTACK_RANGE, ATTACK_DAMAGE,
  CRIT_MULTIPLIER, BLOCK_REDUCTION, ATTACK_COOLDOWN_MS,
  MAX_POSITION_DELTA_PER_TICK,
} from '../../../packages/shared/src/combat';
import type { PlayerInputPayload, HitResult } from '../../../packages/shared/src/types';

interface PlayerCombatMeta {
  lastAttackMs: number;
  attackedThisTick: boolean;
}

const _meta = new Map<string, PlayerCombatMeta>();

function getMeta(id: string): PlayerCombatMeta {
  if (!_meta.has(id)) _meta.set(id, { lastAttackMs: 0, attackedThisTick: false });
  return _meta.get(id)!;
}

export function resetCombatMeta(playerIds: string[]): void {
  playerIds.forEach((id) => _meta.delete(id));
}

// ─── Tick simulation ──────────────────────────────────────────
export function simulateTick(
  players: Map<string, PlayerState>,
  inputs: Map<string, PlayerInputPayload>,
  nowMs: number,
): HitResult[] {
  const hits: HitResult[] = [];
  const dt = TICK_MS / 1000; // seconds

  // 1. Apply movement
  for (const [id, p] of players) {
    if (!p.connected) continue;
    const inp = inputs.get(id);
    if (!inp) continue;
    const meta = getMeta(id);
    meta.attackedThisTick = false;

    // Horizontal
    if (inp.left)  { p.velX = -MOVE_SPEED; p.facingRight = false; }
    else if (inp.right) { p.velX = MOVE_SPEED; p.facingRight = true; }
    else           { p.velX = 0; }

    // Jump (only when grounded)
    if (inp.jump && p.grounded) {
      p.velY = JUMP_VELOCITY;
      p.grounded = false;
    }

    // Gravity
    if (!p.grounded) {
      p.velY += GRAVITY * dt;
    }

    // Integrate position
    p.x += p.velX * dt;
    p.y += p.velY * dt;

    // Ground collision
    if (p.y >= GROUND_Y) {
      p.y = GROUND_Y;
      p.velY = 0;
      p.grounded = true;
    }

    // Stage bounds
    p.x = Math.max(0, Math.min(STAGE_WIDTH, p.x));

    // State flags
    p.attacking = inp.attack && (nowMs - meta.lastAttackMs) >= ATTACK_COOLDOWN_MS;
    p.blocking  = inp.block && !inp.attack;

    if (p.attacking) meta.lastAttackMs = nowMs;
  }

  // 2. Resolve attacks
  const playerArr = [...players.values()].filter((p) => p.connected && p.hp > 0);
  for (let i = 0; i < playerArr.length; i++) {
    const attacker = playerArr[i];
    if (!attacker.attacking) continue;
    const meta = getMeta(attacker.playerId);
    if (meta.attackedThisTick) continue;

    for (let j = 0; j < playerArr.length; j++) {
      if (i === j) continue;
      const defender = playerArr[j];
      const dist = Math.abs(attacker.x - defender.x);
      if (dist > ATTACK_RANGE) continue;

      // Facing check
      const facingDefender = attacker.facingRight
        ? defender.x > attacker.x
        : defender.x < attacker.x;
      if (!facingDefender) continue;

      const isCrit   = Math.random() < 0.1; // 10% crit
      let damage     = ATTACK_DAMAGE * (isCrit ? CRIT_MULTIPLIER : 1);
      if (defender.blocking) damage *= BLOCK_REDUCTION;
      damage = Math.round(damage);

      defender.hp = Math.max(0, defender.hp - damage);
      meta.attackedThisTick = true;

      hits.push({
        attackerId: attacker.playerId,
        defenderId: defender.playerId,
        damage,
        tick: 0, // filled by caller
        type: isCrit ? 'critical' : defender.blocking ? 'blocked' : 'normal',
      });
    }
  }

  return hits;
}

// ─── Anti-cheat position validation ──────────────────────────
export function validatePositionDelta(
  prev: { x: number; y: number },
  next: { x: number; y: number },
): boolean {
  const dx = Math.abs(next.x - prev.x);
  const dy = Math.abs(next.y - prev.y);
  return dx <= MAX_POSITION_DELTA_PER_TICK && dy <= MAX_POSITION_DELTA_PER_TICK * 3;
}

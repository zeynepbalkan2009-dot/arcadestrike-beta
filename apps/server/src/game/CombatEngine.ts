/**
 * CombatEngine — deterministic, server-authoritative.
 * Pure functions: same inputs → same outputs, no RNG.
 * Runs at TICK_RATE (20 ticks/sec).
 */
import { GAME_CONSTANTS as C } from "@arcadestrike/shared";
import type { PlayerInput } from "@arcadestrike/shared";
import { FighterSchema } from "./GameState";

export interface CombatEvent {
  type: "hit" | "miss" | "ko" | "combo";
  attackerId: string;
  targetId: string;
  damage: number;
  isCombo: boolean;
}

type AttackKind = "attack" | "special";

export class CombatEngine {
  /**
   * Advance one simulation tick for both fighters.
   */
  static tick(
    fighters: FighterSchema[],
    inputs: Map<string, PlayerInput>
  ): CombatEvent[] {
    const events: CombatEvent[] = [];

    // 1. Apply inputs → velocity/intent
    for (const fighter of fighters) {
      const input = inputs.get(fighter.playerId);
      if (input) CombatEngine.applyInput(fighter, CombatEngine.sanitizeInput(input));
    }

    // 2. Physics
    for (const fighter of fighters) {
      CombatEngine.applyPhysics(fighter);
    }

    // 3. Combat resolution
    if (fighters.length === 2) {
      const [f0, f1] = fighters;
      events.push(...CombatEngine.resolveAttack(f0, f1));
      events.push(...CombatEngine.resolveAttack(f1, f0));
    }

    // 4. Tick cooldowns
    for (const fighter of fighters) {
      CombatEngine.tickCooldowns(fighter);
    }

    return events;
  }

  static applyInput(f: FighterSchema, input: PlayerInput): void {
    if (f.stunTicks > 0 || f.actionState === "dead") return;

    const isAction = f.actionState === "attacking" || f.actionState === "special";

    if (!isAction) {
      if (input.left) {
        f.vel.x = -C.MOVE_SPEED;
        f.facing = -1;
        if (f.isGrounded) f.actionState = "walking";
      } else if (input.right) {
        f.vel.x = C.MOVE_SPEED;
        f.facing = 1;
        if (f.isGrounded) f.actionState = "walking";
      } else {
        f.vel.x = f.vel.x * 0.7;
        if (Math.abs(f.vel.x) < 0.1) f.vel.x = 0;
        if (f.isGrounded && f.actionState === "walking") f.actionState = "idle";
      }
    }

    if (input.jump && f.isGrounded && !isAction) {
      f.vel.y = C.JUMP_FORCE;
      f.isGrounded = false;
      f.actionState = "jumping";
    }

    if (input.attack && f.attackCooldown <= 0 && !isAction) {
      f.actionState = "attacking";
      f.attackCooldown = C.ATTACK_COOLDOWN_TICKS;
    }

    if (input.special && f.specialCooldown <= 0 && !isAction) {
      f.actionState = "special";
      f.specialCooldown = C.SPECIAL_COOLDOWN_TICKS;
    }

    f.lastProcessedInput = input.seq;
  }

  static applyPhysics(f: FighterSchema): void {
    if (f.actionState === "dead") return;

    if (!f.isGrounded) {
      f.vel.y = Math.min(f.vel.y + C.GRAVITY, C.MAX_FALL_SPEED);
    }

    f.pos.x += f.vel.x;
    f.pos.y += f.vel.y;

    if (f.pos.y >= C.GROUND_Y) {
      f.pos.y = C.GROUND_Y;
      f.vel.y = 0;
      f.isGrounded = true;
      if (f.actionState === "jumping" || f.actionState === "knockback") {
        f.actionState = "idle";
      }
    }

    const halfW = C.FIGHTER_WIDTH / 2;
    if (f.pos.x < halfW) { f.pos.x = halfW; f.vel.x = 0; }
    if (f.pos.x > C.ARENA_WIDTH - halfW) { f.pos.x = C.ARENA_WIDTH - halfW; f.vel.x = 0; }

    if (f.stunTicks > 0) {
      f.stunTicks--;
      if (f.stunTicks === 0 && f.actionState === "hit") f.actionState = "idle";
    }
  }

  static resolveAttack(attacker: FighterSchema, target: FighterSchema): CombatEvent[] {
    const attackKind = CombatEngine.getActiveAttack(attacker);
    if (!attackKind) return [];
    if (target.actionState === "dead") return [];

    const isSpecial = attackKind === "special";
    const isFirstTick = isSpecial
      ? attacker.specialCooldown === C.SPECIAL_COOLDOWN_TICKS
      : attacker.attackCooldown === C.ATTACK_COOLDOWN_TICKS;
    if (!isFirstTick) return [];

    if (!CombatEngine.isHitConfirmed(attacker, target)) {
      return [{
        type: "miss",
        attackerId: attacker.playerId,
        targetId: target.playerId,
        damage: 0,
        isCombo: false,
      }];
    }

    const { damage, isCombo } = CombatEngine.calculateDamage(attacker, attackKind);
    attacker.comboTimer = C.COMBO_WINDOW_TICKS;

    target.hp = Math.max(0, target.hp - damage);
    target.stunTicks = C.STUN_TICKS;
    target.actionState = "hit";
    target.vel.x = attacker.facing * C.KNOCKBACK_FORCE;
    target.vel.y = -5;
    target.isGrounded = false;

    const events: CombatEvent[] = [{
      type: isCombo ? "combo" : "hit",
      attackerId: attacker.playerId,
      targetId: target.playerId,
      damage,
      isCombo,
    }];

    if (target.hp <= 0) {
      target.actionState = "dead";
      events.push({ type: "ko", attackerId: attacker.playerId, targetId: target.playerId, damage: 0, isCombo: false });
    }

    return events;
  }

  private static sanitizeInput(input: PlayerInput): PlayerInput {
    const left = Boolean(input.left);
    const right = Boolean(input.right);
    const attack = Boolean(input.attack);
    const special = Boolean(input.special);

    return {
      seq: Number.isInteger(input.seq) ? input.seq : -1,
      tick: Number.isInteger(input.tick) ? input.tick : -1,
      timestamp: Number.isFinite(input.timestamp) ? input.timestamp : 0,
      left: left && !right,
      right: right && !left,
      jump: Boolean(input.jump),
      attack: attack && !special,
      special: special && !attack,
    };
  }

  private static getActiveAttack(attacker: FighterSchema): AttackKind | null {
    if (attacker.actionState === "attacking" && attacker.attackCooldown > 0) return "attack";
    if (attacker.actionState === "special" && attacker.specialCooldown > 0) return "special";
    return null;
  }

  private static isHitConfirmed(attacker: FighterSchema, target: FighterSchema): boolean {
    const dx = Math.abs(attacker.pos.x - target.pos.x);
    const dy = Math.abs(attacker.pos.y - target.pos.y);
    if (dx > C.ATTACK_RANGE || dy > C.FIGHTER_HEIGHT) return false;

    return (target.pos.x - attacker.pos.x) * attacker.facing > 0 ||
      dx < C.FIGHTER_WIDTH * 0.5;
  }

  private static calculateDamage(attacker: FighterSchema, attackKind: AttackKind): { damage: number; isCombo: boolean } {
    const base = attackKind === "special" ? C.SPECIAL_DAMAGE : C.ATTACK_DAMAGE;
    const canCombo = attackKind === "attack" &&
      attacker.comboTimer > 0 &&
      attacker.comboCount > 0 &&
      attacker.comboCount < 2;

    if (canCombo) {
      attacker.comboCount = 2;
      return {
        damage: Math.max(1, Math.floor(base * C.COMBO_MULTIPLIER)),
        isCombo: true,
      };
    }

    attacker.comboCount = attackKind === "attack" ? 1 : 0;
    return { damage: base, isCombo: false };
  }

  static tickCooldowns(f: FighterSchema): void {
    if (f.attackCooldown > 0) {
      f.attackCooldown--;
      if (f.attackCooldown === 0 && f.actionState === "attacking") f.actionState = "idle";
    }
    if (f.specialCooldown > 0) {
      f.specialCooldown--;
      if (f.specialCooldown === 0 && f.actionState === "special") f.actionState = "idle";
    }
    if (f.comboTimer > 0) {
      f.comboTimer--;
      if (f.comboTimer === 0) f.comboCount = 0;
    }
  }

  static resetFighter(f: FighterSchema, spawnX: number): void {
    f.hp          = C.MAX_HP;
    f.pos.x       = spawnX;
    f.pos.y       = C.GROUND_Y;
    f.vel.x       = 0;
    f.vel.y       = 0;
    f.facing      = spawnX < C.ARENA_WIDTH / 2 ? 1 : -1;
    f.actionState = "idle";
    f.attackCooldown  = 0;
    f.specialCooldown = 0;
    f.comboCount  = 0;
    f.comboTimer  = 0;
    f.isGrounded  = true;
    f.stunTicks   = 0;
  }
}

import type { PlayerInput } from "@arcadestrike/shared";
import { GAME_CONSTANTS as C } from "@arcadestrike/shared";
import { CombatEngine } from "../../src/game/CombatEngine";
import { FighterSchema } from "../../src/game/GameState";

export interface ReplayResult {
  fighters: Array<Record<string, unknown>>;
  events: Array<Record<string, unknown>>;
}

export function makeInput(seq: number, tick: number, patch: Partial<PlayerInput> = {}): PlayerInput {
  return {
    seq,
    tick,
    timestamp: 1_700_000_000_000 + tick * 50,
    left: false,
    right: false,
    jump: false,
    attack: false,
    special: false,
    ...patch,
  };
}

export function makeFighters(): FighterSchema[] {
  const p1 = new FighterSchema();
  p1.playerId = "p1";
  CombatEngine.resetFighter(p1, C.ARENA_WIDTH * 0.48);

  const p2 = new FighterSchema();
  p2.playerId = "p2";
  CombatEngine.resetFighter(p2, C.ARENA_WIDTH * 0.52);

  return [p1, p2];
}

export function runReplay(inputsByTick: Map<number, Map<string, PlayerInput>>, ticks = 80): ReplayResult {
  const fighters = makeFighters();
  const events: Array<Record<string, unknown>> = [];

  for (let tick = 0; tick < ticks; tick++) {
    const tickEvents = CombatEngine.tick(fighters, inputsByTick.get(tick) || new Map());
    for (const event of tickEvents) events.push({ tick, ...event });
  }

  return {
    fighters: fighters.map(snapshotFighter),
    events,
  };
}

export function snapshotFighter(fighter: FighterSchema): Record<string, unknown> {
  return {
    playerId: fighter.playerId,
    x: Number(fighter.pos.x.toFixed(4)),
    y: Number(fighter.pos.y.toFixed(4)),
    vx: Number(fighter.vel.x.toFixed(4)),
    vy: Number(fighter.vel.y.toFixed(4)),
    hp: fighter.hp,
    facing: fighter.facing,
    actionState: fighter.actionState,
    attackCooldown: fighter.attackCooldown,
    specialCooldown: fighter.specialCooldown,
    comboCount: fighter.comboCount,
    comboTimer: fighter.comboTimer,
    stunTicks: fighter.stunTicks,
  };
}

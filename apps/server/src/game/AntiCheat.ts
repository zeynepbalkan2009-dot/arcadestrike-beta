/**
 * AntiCheat — server-side input validation.
 * Runs every tick before inputs are processed.
 */
import { GAME_CONSTANTS as C } from "@arcadestrike/shared";
import type { PlayerInput, AntiCheatViolation } from "@arcadestrike/shared";
import type { FighterSchema } from "./GameState";

interface PlayerInputHistory {
  lastInputTime: number;
  inputCount: number;
  windowStart: number;
  lastSeq: number;
  lastTimestamp: number;
}

export class AntiCheat {
  private histories = new Map<string, PlayerInputHistory>();
  private violations = new Map<string, AntiCheatViolation[]>();

  validateInput(
    playerId: string,
    input: PlayerInput,
    serverTick: number,
    fighter?: FighterSchema
  ): boolean {
    const now = Date.now();
    let h = this.histories.get(playerId);
    if (!h) {
      h = { lastInputTime: now, inputCount: 0, windowStart: now, lastSeq: -1, lastTimestamp: 0 };
      this.histories.set(playerId, h);
    }

    const viols: AntiCheatViolation[] = [];

    // 0. Basic shape validation. Runtime clients can bypass TypeScript.
    if (!Number.isInteger(input.seq) || input.seq < 0) {
      viols.push({
        type: "invalid_action",
        tick: Number.isFinite(input.tick) ? input.tick : serverTick,
        details: `invalid seq ${input.seq}`,
      });
    }
    if (!Number.isInteger(input.tick) || input.tick < 0) {
      viols.push({
        type: "invalid_action",
        tick: serverTick,
        details: `invalid tick ${input.tick}`,
      });
    }
    for (const key of ["left", "right", "jump", "attack", "special"] as const) {
      if (typeof input[key] !== "boolean") {
        viols.push({
          type: "invalid_action",
          tick: Number.isFinite(input.tick) ? input.tick : serverTick,
          details: `input.${key} must be boolean`,
        });
      }
    }

    // 1. Replay protection: seq must be monotonically increasing
    if (input.seq <= h.lastSeq) {
      viols.push({
        type: "replay_input",
        tick: input.tick,
        details: `seq ${input.seq} <= lastSeq ${h.lastSeq}`,
      });
    }

    // 1b. Reject impossible client tick drift. A small lead/lag window absorbs latency.
    if (Number.isInteger(input.tick) && Math.abs(input.tick - serverTick) > C.MAX_ROLLBACK_TICKS * 2) {
      viols.push({
        type: "replay_input",
        tick: input.tick,
        details: `client tick ${input.tick} too far from server tick ${serverTick}`,
      });
    }

    // 1c. Prevent batching huge sequence gaps to skip cooldown windows.
    if (h.lastSeq >= 0 && input.seq - h.lastSeq > C.INPUT_BUFFER_SIZE) {
      viols.push({
        type: "input_rate",
        tick: input.tick,
        details: `seq gap ${input.seq - h.lastSeq} exceeds buffer ${C.INPUT_BUFFER_SIZE}`,
      });
    }

    // 2. Input rate limiting: max C.MAX_INPUT_RATE per second
    const windowMs = 1000;
    if (now - h.windowStart > windowMs) {
      h.inputCount = 0;
      h.windowStart = now;
    }
    h.inputCount++;
    if (h.inputCount > C.MAX_INPUT_RATE * 1.5) { // 50% grace
      viols.push({
        type: "input_rate",
        tick: input.tick,
        details: `${h.inputCount} inputs in 1s window (max ${C.MAX_INPUT_RATE})`,
      });
    }

    // 3. Timestamp sanity (client clock must be roughly in sync and monotonic)
    const clientDrift = Math.abs(input.timestamp - now);
    if (clientDrift > 5000) { // 5 second tolerance
      viols.push({
        type: "invalid_action",
        tick: input.tick,
        details: `client timestamp drift ${clientDrift}ms`,
      });
    }
    if (input.timestamp < h.lastTimestamp) {
      viols.push({
        type: "replay_input",
        tick: input.tick,
        details: `timestamp ${input.timestamp} < lastTimestamp ${h.lastTimestamp}`,
      });
    }

    // 4. Impossible input combinations.
    if (input.left && input.right) {
      viols.push({
        type: "invalid_action",
        tick: input.tick,
        details: "left and right pressed simultaneously",
      });
    }
    if (input.attack && input.special) {
      viols.push({
        type: "invalid_action",
        tick: input.tick,
        details: "attack and special pressed simultaneously",
      });
    }

    // 5. Cooldown/action verification. The server owns cooldown truth.
    if (fighter) {
      const busy = fighter.stunTicks > 0 ||
        fighter.actionState === "attacking" ||
        fighter.actionState === "special" ||
        fighter.actionState === "dead";

      if (input.attack && (busy || fighter.attackCooldown > 0)) {
        viols.push({
          type: "invalid_action",
          tick: input.tick,
          details: `attack during ${fighter.actionState} cd=${fighter.attackCooldown}`,
        });
      }
      if (input.special && (busy || fighter.specialCooldown > 0)) {
        viols.push({
          type: "invalid_action",
          tick: input.tick,
          details: `special during ${fighter.actionState} cd=${fighter.specialCooldown}`,
        });
      }
    }

    h.lastSeq = input.seq;
    h.lastInputTime = now;
    h.lastTimestamp = input.timestamp;

    if (viols.length > 0) {
      const existing = this.violations.get(playerId) || [];
      this.violations.set(playerId, [...existing, ...viols]);
      // Soft ban after accumulating violations
      return existing.length + viols.length < 10;
    }

    return true;
  }

  getViolations(playerId: string): AntiCheatViolation[] {
    return this.violations.get(playerId) || [];
  }

  isBanned(playerId: string): boolean {
    return (this.violations.get(playerId) || []).length >= 10;
  }

  reset(playerId: string): void {
    this.histories.delete(playerId);
    this.violations.delete(playerId);
  }
}

/**
 * ClientPredictor
 *
 * Implements client-side prediction and server reconciliation.
 *
 * Flow each tick:
 *  1. We apply the local input immediately to our PREDICTED state
 *     (zero-latency feel — no waiting for server round-trip)
 *  2. We buffer the input with its sequence number
 *  3. Server sends back STATE_SNAPSHOT with lastProcessedInput
 *  4. We reconcile: rewind to server state, re-apply all un-acked inputs
 *
 * Result: local fighter moves instantly; rubber-bands to server
 *         state transparently. Other fighters use server state only.
 */
import { GAME_CONSTANTS as C } from "@arcadestrike/shared";
import type { PlayerInput, FighterState, GameState } from "@arcadestrike/shared";

// Thin mutable copy of FighterState for prediction
export type PredictedFighter = {
  pos:            { x: number; y: number };
  vel:            { x: number; y: number };
  hp:             number;
  facing:         number;
  actionState:    string;
  attackCooldown: number;
  specialCooldown:number;
  comboCount:     number;
  comboTimer:     number;
  isGrounded:     boolean;
  stunTicks:      number;
};

type BufferedInput = PlayerInput & { localTick: number };

interface FighterSnapshot {
  tick: number;
  receivedAt: number;
  fighter: PredictedFighter;
}

const INTERPOLATION_DELAY_MS = 100;
const MAX_SNAPSHOT_HISTORY = 16;
const MAX_CORRECTION_PER_FRAME = 0.35;

export class ClientPredictor {
  // Predicted local state for ALL fighters (opponent uses server state)
  private predicted = new Map<string, PredictedFighter>();
  private renderState = new Map<string, PredictedFighter>();
  private correctionOffsets = new Map<string, { x: number; y: number }>();
  private opponentHistory = new Map<string, FighterSnapshot[]>();

  // Unacknowledged inputs ring-buffer
  private pendingInputs: BufferedInput[] = [];
  private localTick = 0;
  private latestServerTick = 0;

  /** Initialise a fighter from its authoritative spawn state */
  initFighter(playerId: string, serverState: FighterState): void {
    const fighter = this.copyFighterState(serverState);
    this.predicted.set(playerId, fighter);
    this.renderState.set(playerId, this.copyFighterState(fighter));
  }

  getLocalFighter(playerId: string): PredictedFighter | undefined {
    return this.predicted.get(playerId);
  }

  getPendingInputCount(): number {
    return this.pendingInputs.length;
  }

  getPredictedServerTick(): number {
    return this.latestServerTick + this.localTick;
  }

  getRenderFighter(playerId: string, isLocal: boolean, now: number): PredictedFighter | undefined {
    if (isLocal) {
      return this.getCorrectedLocalRender(playerId);
    }

    return this.getInterpolatedOpponent(playerId, now) ??
      this.renderState.get(playerId) ??
      this.predicted.get(playerId);
  }

  /** Apply local input to ONLY the local player's predicted state */
  applyInput(fighter: PredictedFighter, input: Omit<PlayerInput,"seq"|"tick"|"timestamp">): void {
    this.simulateInput(fighter, this.normalizeInput(input));
    this.simulatePhysics(fighter);
    this.localTick++;
  }

  /** Buffer an input that's been sent to server */
  pushInput(input: PlayerInput): void {
    this.pendingInputs.push({ ...input, localTick: this.localTick });
    // Cap buffer to prevent unbounded growth
    if (this.pendingInputs.length > C.INPUT_BUFFER_SIZE * 3) {
      this.pendingInputs.shift();
    }
  }

  /** Server acknowledged up to this seq — prune older inputs */
  acknowledge(seq: number): void {
    // Receipt acknowledgements are not authoritative simulation acks.
    // Prune only when fighter.lastProcessedInput arrives in a snapshot.
    void seq;
  }

  /**
   * Reconcile predicted state with authoritative server snapshot.
   *
   * Algorithm:
   *  1. Copy server state into predicted (reset misprediction)
   *  2. Re-apply all pending un-acked inputs on top
   *
   * This corrects any divergence while keeping the local fighter
   * responsive — the visual "jump" is small because we re-apply
   * the buffered inputs immediately.
   */
  reconcile(serverState: GameState, myPlayerId: string): void {
    this.latestServerTick = Math.max(this.latestServerTick, serverState.tick);
    const now = performance.now();

    for (const [pid, serverFighter] of Object.entries(serverState.fighters)) {
      // For the local player: reset to server then re-simulate
      if (pid === myPlayerId) {
        const before = this.predicted.get(pid);
        const predicted = this.copyFighterState(serverFighter);
        const lastProcessed = serverFighter.lastProcessedInput;
        let replayedInputs = 0;
        this.pendingInputs = this.pendingInputs.filter(input => input.seq > lastProcessed);

        // Re-apply inputs server hasn't seen yet
        for (const input of this.pendingInputs) {
          this.simulateInput(predicted, this.normalizeInput(input));
          this.simulatePhysics(predicted);
          replayedInputs++;
        }

        if (before) {
          this.correctionOffsets.set(pid, {
            x: before.pos.x - predicted.pos.x,
            y: before.pos.y - predicted.pos.y,
          });
        }

        this.predicted.set(pid, predicted);
        this.renderState.set(pid, this.copyFighterState(predicted));
        this.localTick = replayedInputs;
      } else {
        const fighter = this.copyFighterState(serverFighter);
        this.predicted.set(pid, fighter);
        this.pushOpponentSnapshot(pid, {
          tick: serverState.tick,
          receivedAt: now,
          fighter,
        });
      }
    }
  }

  private getCorrectedLocalRender(playerId: string): PredictedFighter | undefined {
    const predicted = this.predicted.get(playerId);
    if (!predicted) return undefined;

    const render = this.copyFighterState(predicted);
    const offset = this.correctionOffsets.get(playerId);
    if (offset) {
      render.pos.x += offset.x;
      render.pos.y += offset.y;

      offset.x *= 1 - MAX_CORRECTION_PER_FRAME;
      offset.y *= 1 - MAX_CORRECTION_PER_FRAME;

      if (Math.abs(offset.x) < 0.1 && Math.abs(offset.y) < 0.1) {
        this.correctionOffsets.delete(playerId);
      }
    }

    this.renderState.set(playerId, this.copyFighterState(render));
    return render;
  }

  private pushOpponentSnapshot(playerId: string, snapshot: FighterSnapshot): void {
    const history = this.opponentHistory.get(playerId) ?? [];
    const previous = history[history.length - 1];

    if (previous && previous.tick === snapshot.tick) {
      history[history.length - 1] = snapshot;
    } else {
      history.push(snapshot);
    }

    while (history.length > MAX_SNAPSHOT_HISTORY) history.shift();
    this.opponentHistory.set(playerId, history);
  }

  private getInterpolatedOpponent(playerId: string, now: number): PredictedFighter | undefined {
    const history = this.opponentHistory.get(playerId);
    if (!history || history.length === 0) return undefined;
    if (history.length === 1) return this.copyFighterState(history[0].fighter);

    const renderAt = now - INTERPOLATION_DELAY_MS;
    let older = history[0];
    let newer = history[history.length - 1];

    for (let i = 0; i < history.length - 1; i++) {
      const a = history[i];
      const b = history[i + 1];
      if (a.receivedAt <= renderAt && b.receivedAt >= renderAt) {
        older = a;
        newer = b;
        break;
      }
    }

    const span = Math.max(1, newer.receivedAt - older.receivedAt);
    const alpha = Math.max(0, Math.min(1, (renderAt - older.receivedAt) / span));
    const interpolated = this.copyFighterState(newer.fighter);

    interpolated.pos.x = older.fighter.pos.x + (newer.fighter.pos.x - older.fighter.pos.x) * alpha;
    interpolated.pos.y = older.fighter.pos.y + (newer.fighter.pos.y - older.fighter.pos.y) * alpha;
    interpolated.vel.x = older.fighter.vel.x + (newer.fighter.vel.x - older.fighter.vel.x) * alpha;
    interpolated.vel.y = older.fighter.vel.y + (newer.fighter.vel.y - older.fighter.vel.y) * alpha;

    this.renderState.set(playerId, this.copyFighterState(interpolated));
    return interpolated;
  }

  // ─── Deterministic simulation (mirrors CombatEngine on server) ────────────

  private simulateInput(f: PredictedFighter, input: Omit<PlayerInput,"seq"|"tick"|"timestamp">): void {
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
        f.vel.x *= 0.7;
        if (Math.abs(f.vel.x) < 0.1) f.vel.x = 0;
        if (f.isGrounded && f.actionState === "walking") f.actionState = "idle";
      }
    }

    if (input.jump && f.isGrounded && !isAction) {
      f.vel.y     = C.JUMP_FORCE;
      f.isGrounded = false;
      f.actionState = "jumping";
    }

    if (input.attack && f.attackCooldown === 0 && !isAction) {
      f.actionState    = "attacking";
      f.attackCooldown = C.ATTACK_COOLDOWN_TICKS;
    }

    if (input.special && f.specialCooldown === 0 && !isAction) {
      f.actionState     = "special";
      f.specialCooldown = C.SPECIAL_COOLDOWN_TICKS;
    }
  }

  private normalizeInput(input: Omit<PlayerInput,"seq"|"tick"|"timestamp">): Omit<PlayerInput,"seq"|"tick"|"timestamp"> {
    const left = Boolean(input.left);
    const right = Boolean(input.right);
    const attack = Boolean(input.attack);
    const special = Boolean(input.special);

    return {
      left: left && !right,
      right: right && !left,
      jump: Boolean(input.jump),
      attack: attack && !special,
      special: special && !attack,
    };
  }

  private simulatePhysics(f: PredictedFighter): void {
    if (f.actionState === "dead") return;

    if (!f.isGrounded) f.vel.y = Math.min(f.vel.y + C.GRAVITY, C.MAX_FALL_SPEED);

    f.pos.x += f.vel.x;
    f.pos.y += f.vel.y;

    if (f.pos.y >= C.GROUND_Y) {
      f.pos.y      = C.GROUND_Y;
      f.vel.y      = 0;
      f.isGrounded = true;
      if (f.actionState === "jumping" || f.actionState === "knockback") f.actionState = "idle";
    }

    const hw = C.FIGHTER_WIDTH / 2;
    if (f.pos.x < hw) { f.pos.x = hw; f.vel.x = 0; }
    if (f.pos.x > C.ARENA_WIDTH - hw) { f.pos.x = C.ARENA_WIDTH - hw; f.vel.x = 0; }

    if (f.attackCooldown  > 0) { f.attackCooldown--;  if (f.attackCooldown  === 0 && f.actionState === "attacking") f.actionState = "idle"; }
    if (f.specialCooldown > 0) { f.specialCooldown--; if (f.specialCooldown === 0 && f.actionState === "special")   f.actionState = "idle"; }
    if (f.stunTicks       > 0) { f.stunTicks--;       if (f.stunTicks       === 0 && f.actionState === "hit")       f.actionState = "idle"; }
    if (f.comboTimer      > 0) { f.comboTimer--;      if (f.comboTimer      === 0) f.comboCount = 0; }
  }

  private copyFighterState(s: FighterState | PredictedFighter): PredictedFighter {
    const pos = "pos" in s ? s.pos : { x: 0, y: 0 };
    const vel = "vel" in s ? s.vel : { x: 0, y: 0 };
    return {
      pos:             { x: pos.x, y: pos.y },
      vel:             { x: vel.x, y: vel.y },
      hp:              s.hp,
      facing:          s.facing,
      actionState:     s.actionState,
      attackCooldown:  s.attackCooldown,
      specialCooldown: s.specialCooldown,
      comboCount:      s.comboCount,
      comboTimer:      s.comboTimer,
      isGrounded:      s.isGrounded,
      stunTicks:       s.stunTicks,
    };
  }
}

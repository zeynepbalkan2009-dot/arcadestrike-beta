/**
 * MatchStateMachine
 *
 * Owns the full lifecycle of one match. Each state transition is
 * an async method. Side-effects (blockchain, economy, logging)
 * are called here — ArcadeRoom delegates to this class.
 *
 * State graph:
 *   LOBBY ──► QUEUE ──► MATCH_FOUND ──► ESCROW_LOCKING
 *        ──► ESCROW_LOCKED ──► COUNTDOWN ──► FIGHTING
 *        ──► RESULT ──► ORACLE_VERIFYING ──► PAYOUT_COMPLETE
 *
 * Any state can transition to CANCELLED (refund path).
 */
import { EventEmitter } from "events";
import {
  MatchLifecycleStage,
  MatchConfig,
  MatchEndPayload,
  OracleResult,
  PayoutInfo,
  GAME_CONSTANTS as C,
} from "@arcadestrike/shared";
import { OracleService } from "../web3/OracleService";
import { EconomyService, EconomyError } from "../economy/EconomyService";
import { EscrowWatcher } from "../web3/EscrowWatcher";
import { createLogger } from "../utils/logger";
import { nanoid } from "nanoid";

const log = createLogger("MatchStateMachine");

export interface MatchPlayer {
  id: string;
  address: string;  // Ethereum address for payout
  elo: number;
}

export interface MatchContext {
  matchId: string;
  config: MatchConfig;
  players: [MatchPlayer, MatchPlayer];
  winnerId?: string;
  loserId?: string;
  cancelReason?: string;
  oracleResult?: OracleResult;
  payout?: PayoutInfo;
  escrowTxHash?: string;
  startedAt?: number;
  endedAt?: number;
}

export type MachineEvent =
  | "state_changed"
  | "escrow_locked"
  | "match_started"
  | "match_ended"
  | "payout_complete"
  | "cancelled"
  | "error";

export class MatchStateMachine extends EventEmitter {
  private stage: MatchLifecycleStage = "lobby";
  private ctx: MatchContext;
  private oracle = new OracleService();
  private economy = new EconomyService();
  private escrowWatcher = new EscrowWatcher();

  // Timeouts for each stage (ms)
  private static readonly TIMEOUTS: Partial<Record<MatchLifecycleStage, number>> = {
    match_found:     30_000,  // 30s to accept
    escrow_locking:  60_000,  // 60s for both deposits
    oracle_verifying: 15_000, // 15s for signature
  };

  private stageTimeout?: ReturnType<typeof setTimeout>;

  constructor(players: [MatchPlayer, MatchPlayer], config: Partial<MatchConfig> = {}) {
    super();
    this.ctx = {
      matchId: nanoid(16),
      players,
      config: {
        matchId:              nanoid(16),
        players:              [players[0].id, players[1].id],
        wagerAmount:          config.wagerAmount  || "0",
        currency:             config.currency     || "REAL",
        maxRounds:            config.maxRounds    || C.MAX_ROUNDS,
        tickRate:             config.tickRate     || C.TICK_RATE,
        matchDurationTicks:   C.MATCH_DURATION_TICKS,
        arenaId:              config.arenaId      || "arena_01",
      },
    };
  }

  // ─── Public API ──────────────────────────────────────────────

  getStage(): MatchLifecycleStage { return this.stage; }
  getContext(): Readonly<MatchContext> { return this.ctx; }
  getMatchId(): string { return this.ctx.matchId; }

  /** Step 1: Both players confirmed in matchmaking */
  async toMatchFound(): Promise<void> {
    this.assertStage("queue");
    await this.transition("match_found", async () => {
      log.info({ matchId: this.ctx.matchId }, "Match found — awaiting player acknowledgement");
      this.armTimeout("match_found", () => this.cancel("match_accept_timeout"));
    });
  }

  /** Step 2: Begin escrow deposit process */
  async toEscrowLocking(): Promise<void> {
    this.assertStage("match_found");
    await this.transition("escrow_locking", async () => {
      log.info({ matchId: this.ctx.matchId }, "Locking escrow...");
      this.armTimeout("escrow_locking", () => this.cancel("escrow_timeout"));

      // Lock off-chain credits immediately for promo-credit matches
      if (this.ctx.config.currency === "PROMO") {
        await Promise.all(this.ctx.players.map(p =>
          this.economy.lockWager(p.id, this.ctx.config.wagerAmount, "PROMO")
        ));
        await this.toEscrowLocked(); // promo: no on-chain deposit needed
      }
      // For REAL: watch for on-chain deposit events
    });
  }

  /** Step 3: Both on-chain deposits confirmed */
  async toEscrowLocked(txHash?: string): Promise<void> {
    this.assertStage("escrow_locking");
    this.ctx.escrowTxHash = txHash;
    await this.transition("escrow_locked", async () => {
      this.clearTimeout();
      log.info({ matchId: this.ctx.matchId, txHash }, "Escrow locked — ready to fight");
      this.emit("escrow_locked", this.ctx);
    });
  }

  /** Step 4: Countdown finished, fight begins */
  async toFighting(): Promise<void> {
    this.assertStage("escrow_locked");
    await this.transition("fighting", async () => {
      this.ctx.startedAt = Date.now();
      log.info({ matchId: this.ctx.matchId }, "Fight started");
      this.emit("match_started", this.ctx);
    });
  }

  /** Step 5: Match ended — record result */
  async toResult(winnerId: string, loserId: string): Promise<void> {
    this.assertStage("fighting");
    this.ctx.winnerId = winnerId;
    this.ctx.loserId  = loserId;
    this.ctx.endedAt  = Date.now();
    await this.transition("result", async () => {
      log.info({ matchId: this.ctx.matchId, winnerId }, "Match result recorded");
      this.emit("match_ended", this.ctx);
    });
  }

  /** Step 6: Request oracle signature */
  async toOracleVerifying(): Promise<void> {
    this.assertStage("result");
    await this.transition("oracle_verifying", async () => {
      this.armTimeout("oracle_verifying", () => this.cancel("oracle_timeout"));

      const winner = this.ctx.players.find(p => p.id === this.ctx.winnerId)!;
      const loser  = this.ctx.players.find(p => p.id === this.ctx.loserId)!;

      const result = await this.oracle.signMatchResult({
        matchId:      this.ctx.matchId,
        winnerId:     winner.address,
        loserId:      loser.address,
        wagerAmount:  this.ctx.config.wagerAmount,
      });

      this.ctx.oracleResult = {
        matchId:   this.ctx.matchId,
        signature: result.signature,
      };
      this.ctx.payout = result.payout;
      this.clearTimeout();

      await this.toPayoutComplete();
    });
  }

  /** Step 7: Funds distributed */
  async toPayoutComplete(): Promise<void> {
    this.assertStage("oracle_verifying");
    await this.transition("payout_complete", async () => {
      // Off-chain settlement (always happens)
      await this.economy.settleMatch(
        this.ctx.winnerId!,
        this.ctx.loserId!,
        this.ctx.config.wagerAmount,
        this.ctx.config.currency,
      );

      log.info({
        matchId: this.ctx.matchId,
        winner:  this.ctx.winnerId,
        payout:  this.ctx.payout?.net,
      }, "Payout complete ✓");

      this.emit("payout_complete", this.ctx);
    });
  }

  /** Cancel from any stage — refunds both players */
  async cancel(reason: string): Promise<void> {
    this.clearTimeout();
    const prev = this.stage;
    this.ctx.cancelReason = reason;

    log.warn({ matchId: this.ctx.matchId, reason, from: prev }, "Match cancelled");

    // Refund if funds were already locked
    if (["escrow_locking","escrow_locked","fighting","result","oracle_verifying"].includes(prev)) {
      await Promise.allSettled([
        this.economy.refundMatch(
          this.ctx.players[0].id,
          this.ctx.players[1].id,
          this.ctx.config.wagerAmount,
          this.ctx.config.currency,
        ),
      ]);
    }

    this.stage = "lobby"; // reset (room will dispose)
    this.emit("cancelled", { matchId: this.ctx.matchId, reason });
  }

  // ─── Initialise from queue stage ────────────────────────────

  async startFromQueue(): Promise<void> {
    this.stage = "queue";
    await this.toMatchFound();
  }

  // ─── Helpers ─────────────────────────────────────────────────

  private async transition(
    next: MatchLifecycleStage,
    fn: () => Promise<void>
  ): Promise<void> {
    const prev = this.stage;
    try {
      this.stage = next;
      this.emit("state_changed", { from: prev, to: next, ctx: this.ctx });
      await fn();
    } catch (err) {
      log.error({ err, from: prev, to: next }, "State transition failed");
      this.stage = prev; // rollback
      this.emit("error", { err, stage: next });
      throw err;
    }
  }

  private assertStage(expected: MatchLifecycleStage | MatchLifecycleStage[]): void {
    const valid = Array.isArray(expected) ? expected : [expected];
    if (!valid.includes(this.stage)) {
      throw new Error(
        `Invalid transition: cannot move from "${this.stage}" (expected: ${valid.join("|")})`
      );
    }
  }

  private armTimeout(stage: MatchLifecycleStage, fn: () => void): void {
    const ms = MatchStateMachine.TIMEOUTS[stage];
    if (!ms) return;
    this.clearTimeout();
    this.stageTimeout = setTimeout(fn, ms);
  }

  private clearTimeout(): void {
    if (this.stageTimeout) {
      clearTimeout(this.stageTimeout);
      this.stageTimeout = undefined;
    }
  }
}

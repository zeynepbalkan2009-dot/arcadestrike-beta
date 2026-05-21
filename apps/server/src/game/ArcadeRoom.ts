/**
 * ArcadeRoom - server-authoritative 1v1 match lifecycle.
 *
 * Owns queue-created room joins, reconnect restoration, countdown,
 * round resets, AFK/disconnect forfeits, and result publication.
 * Combat simulation remains delegated to CombatEngine.
 */
import { Room, Client } from "colyseus";
import { GAME_CONSTANTS as C, PlayerInput, MatchConfig } from "@arcadestrike/shared";
import { ArcadeGameState, FighterSchema } from "./GameState";
import { CombatEngine } from "./CombatEngine";
import { AntiCheat } from "./AntiCheat";
import { createLogger } from "../utils/logger";
import { nanoid } from "nanoid";
import { ReplayService } from "../replay/ReplayService";
import { metrics } from "../infra/metrics";
import { redisInfrastructure } from "../infra/redis";
import { clearPresence, consumeDistributedLimit, fingerprint, recordAbuseSignal, recordPresence } from "../infra/security";
import { withCorrelation } from "../infra/correlation";

const log = createLogger("ArcadeRoom");

export interface RoomOptions {
  wagerAmount: string;
  currency: "REAL" | "PROMO";
  queueMode?: "quick" | "ranked";
  players?: [string, string];
}

type MatchEndReason = "ko" | "timeout" | "disconnect" | "afk" | "forfeit";

const RECONNECT_GRACE_SECONDS = 15;
const AFK_WARNING_TICKS = C.TICK_RATE * 8;
const AFK_FORFEIT_TICKS = C.TICK_RATE * 15;
const ROUND_RESET_TICKS = C.TICK_RATE * 3;

export class ArcadeRoom extends Room<ArcadeGameState> {
  private matchConfig!: MatchConfig;
  private inputBuffers = new Map<string, PlayerInput[]>();
  private antiCheat = new AntiCheat();
  private tickInterval?: ReturnType<typeof setInterval>;
  private lastTickTime = 0;
  private expectedPlayers: string[] = [];
  private joinOrder: string[] = [];
  private clientToPlayerId = new Map<string, string>();
  private playerToClient = new Map<string, Client>();
  private lastInputTick = new Map<string, number>();
  private afkWarned = new Set<string>();
  private rematchVotes = new Map<string, boolean>();
  private replay = new ReplayService();

  maxClients = 2;

  onCreate(options: RoomOptions): void {
    this.autoDispose = true;
    this.setState(new ArcadeGameState());
    this.state.matchId = nanoid(16);
    this.state.phase = "waiting";
    this.state.matchTimer = 0;

    this.expectedPlayers = options.players ? [...options.players] : [];
    this.matchConfig = {
      matchId: this.state.matchId,
      players: [
        this.expectedPlayers[0] || "",
        this.expectedPlayers[1] || "",
      ],
      wagerAmount: options.wagerAmount || "0",
      currency: options.currency || "PROMO",
      maxRounds: C.MAX_ROUNDS,
      tickRate: C.TICK_RATE,
      matchDurationTicks: C.MATCH_DURATION_TICKS,
      arenaId: "arena_01",
    };

    void this.replay.recordEvent(this.state.matchId, this.state.tick, "room_created", options as any);
    void redisInfrastructure.publish("arcadestrike:room-events", {
      type: "room_created",
      roomId: this.roomId,
      matchId: this.state.matchId,
    });
    metrics.counter("arcadestrike_rooms_created_total", "Created Colyseus rooms");
    log.info({ matchId: this.state.matchId, options }, "Room created");

    this.onMessage("INPUT", (client, input: PlayerInput) => this.handleInput(client, input));
    this.onMessage("REMATCH_VOTE", (client, data: { vote: boolean }) => {
      this.handleRematch(client, data.vote);
    });
  }

  onJoin(client: Client, options: any, auth: any): void {
    const playerId = this.resolveJoiningPlayerId(client, options, auth);
    this.clientToPlayerId.set(client.sessionId, playerId);
    this.playerToClient.set(playerId, client);
    this.inputBuffers.set(playerId, []);
    this.lastInputTick.set(playerId, this.state.tick);

    let fighter = this.state.fighters.get(playerId);
    if (!fighter) {
      fighter = new FighterSchema();
      fighter.id = nanoid(8);
      fighter.playerId = playerId;
      this.joinOrder.push(playerId);

      const spawnX = this.joinOrder.length === 1
        ? C.ARENA_WIDTH * 0.25
        : C.ARENA_WIDTH * 0.75;

      CombatEngine.resetFighter(fighter, spawnX);
      this.state.fighters.set(playerId, fighter);
      this.state.scores.set(playerId, 0);
    }

    client.send("STATE_SNAPSHOT", {
      tick: this.state.tick,
      state: this.state,
      yourPlayerId: playerId,
    });

    const fp = fingerprint([
      playerId,
      (client as any).ip,
      (client as any).request?.headers["user-agent"]?.toString(),
      (client as any).request?.headers["x-forwarded-for"]?.toString(),
    ]);
    void recordPresence(playerId, this.roomId, client.sessionId);
    void recordAbuseSignal("wallet_fingerprint", { playerId, fingerprint: fp, roomId: this.roomId });
    void this.replay.recordEvent(this.state.matchId, this.state.tick, "player_joined", {
      playerId,
      sessionId: client.sessionId,
      fingerprint: fp,
    }, playerId);
    metrics.counter("arcadestrike_room_joins_total", "Room joins");
    log.info({ playerId, roomId: this.roomId, phase: this.state.phase }, "Player joined");

    if (this.state.fighters.size === 2 && this.state.phase === "waiting") {
      this.startGameLoop();
      this.startCountdown();
    }
  }

  async onLeave(client: Client, consented: boolean): Promise<void> {
    const playerId = this.getPlayerIdForClient(client);
    if (!playerId) return;

    this.playerToClient.delete(playerId);
    this.clientToPlayerId.delete(client.sessionId);
    void clearPresence(playerId);
    void this.replay.recordEvent(this.state.matchId, this.state.tick, "player_left", { playerId, consented }, playerId);
    log.info({ playerId, consented }, "Player left");

    if (!["countdown", "fighting", "round_end"].includes(this.state.phase)) return;

    try {
      const reconnected = await this.allowReconnection(client, RECONNECT_GRACE_SECONDS);
      this.clientToPlayerId.set(reconnected.sessionId, playerId);
      this.playerToClient.set(playerId, reconnected);
      this.lastInputTick.set(playerId, this.state.tick);
      void recordPresence(playerId, this.roomId, reconnected.sessionId);
      reconnected.send("STATE_SNAPSHOT", {
        tick: this.state.tick,
        state: this.state,
        yourPlayerId: playerId,
      });
      void this.replay.recordEvent(this.state.matchId, this.state.tick, "player_reconnected", { playerId }, playerId);
      log.info({ playerId }, "Player reconnected");
    } catch {
      const winnerId = this.getOpponentId(playerId);
      if (winnerId) await this.endMatch(winnerId, "disconnect");
    }
  }

  onDispose(): void {
    if (this.tickInterval) clearInterval(this.tickInterval);
    for (const playerId of this.playerToClient.keys()) void clearPresence(playerId);
    void this.replay.recordEvent(this.state.matchId, this.state.tick, "room_disposed");
    log.info({ matchId: this.state.matchId }, "Room disposed");
  }

  private startGameLoop(): void {
    if (this.tickInterval) return;

    const tickMs = 1000 / C.TICK_RATE;
    this.lastTickTime = Date.now();

    this.tickInterval = setInterval(() => {
      const now = Date.now();
      const elapsed = now - this.lastTickTime;
      const ticksToDo = Math.min(Math.floor(elapsed / tickMs), 3);

      for (let i = 0; i < ticksToDo; i++) this.tick();
      if (ticksToDo > 0) this.lastTickTime = now;
    }, tickMs);
  }

  private tick(): void {
    this.state.tick++;

    switch (this.state.phase) {
      case "countdown":
        this.tickCountdown();
        break;
      case "fighting":
        this.tickFighting();
        break;
      case "round_end":
        this.tickRoundEnd();
        break;
    }
  }

  private startCountdown(): void {
    this.state.phase = "countdown";
    this.state.matchTimer = C.COUNTDOWN_TICKS;
    this.state.countdownStartTick = this.state.tick;
    this.broadcast("MATCH_START", this.currentMatchConfig());
    void this.replay.recordEvent(this.state.matchId, this.state.tick, "match_countdown_started", this.currentMatchConfig() as any);
    void redisInfrastructure.publish("arcadestrike:room-events", {
      type: "match_countdown_started",
      roomId: this.roomId,
      matchId: this.state.matchId,
    });
  }

  private tickCountdown(): void {
    this.state.matchTimer--;
    if (this.state.matchTimer <= 0) {
      this.state.phase = "fighting";
      this.state.matchTimer = C.MATCH_DURATION_TICKS;
      for (const [pid] of this.state.fighters) this.lastInputTick.set(pid, this.state.tick);
      log.info({ matchId: this.state.matchId }, "Fight started");
      void this.replay.recordEvent(this.state.matchId, this.state.tick, "fight_started");
    }
  }

  private tickFighting(): void {
    this.state.matchTimer--;
    this.checkAfkForfeits();
    if (this.state.phase !== "fighting") return;

    const inputs = new Map<string, PlayerInput>();
    for (const [playerId, buffer] of this.inputBuffers) {
      const input = buffer.shift();
      if (input) inputs.set(playerId, input);
    }

    const fighters = Array.from(this.state.fighters.values());
    const events = CombatEngine.tick(fighters, inputs);

    for (const event of events) {
      if (event.type === "ko") {
        void this.replay.recordEvent(this.state.matchId, this.state.tick, "combat_event", event as any, event.attackerId);
        void this.handleRoundEnd(event.attackerId, "ko");
        return;
      }
      void this.replay.recordEvent(this.state.matchId, this.state.tick, "combat_event", event as any, event.attackerId);
    }

    if (this.state.matchTimer <= 0) {
      const sorted = fighters.sort((a, b) => b.hp - a.hp);
      const winnerId = sorted[0].hp > sorted[1].hp ? sorted[0].playerId : undefined;
      void this.handleRoundEnd(winnerId, "timeout");
    }
  }

  private async handleRoundEnd(winnerId?: string, reason: MatchEndReason = "ko"): Promise<void> {
    this.state.phase = "round_end";
    this.state.roundWinner = winnerId || "";
    this.state.roundEndsAtTick = this.state.tick + ROUND_RESET_TICKS;
    this.state.matchTimer = ROUND_RESET_TICKS;

    if (winnerId) {
      this.state.scores.set(winnerId, (this.state.scores.get(winnerId) || 0) + 1);
    }

    this.broadcast("ROUND_END", {
      round: this.state.currentRound,
      winnerId: winnerId || "",
      scores: Object.fromEntries(this.state.scores),
    });
    void this.replay.recordEvent(this.state.matchId, this.state.tick, "round_end", {
      round: this.state.currentRound,
      winnerId: winnerId || "",
      reason,
      scores: Object.fromEntries(this.state.scores),
    }, winnerId);

    const winsNeeded = Math.ceil(C.MAX_ROUNDS / 2);
    for (const [pid, score] of this.state.scores) {
      if (score >= winsNeeded) {
        await this.endMatch(pid, reason);
        return;
      }
    }
  }

  private tickRoundEnd(): void {
    this.state.matchTimer = Math.max(0, this.state.roundEndsAtTick - this.state.tick);
    if (this.state.matchTimer <= 0) this.startNextRound();
  }

  private startNextRound(): void {
    this.state.currentRound++;
    this.state.roundWinner = "";
    this.state.roundEndsAtTick = 0;
    this.afkWarned.clear();
    this.rematchVotes.clear();

    for (const [pid, fighter] of this.state.fighters) {
      const spawnX = this.joinOrder.indexOf(pid) === 0
        ? C.ARENA_WIDTH * 0.25
        : C.ARENA_WIDTH * 0.75;
      CombatEngine.resetFighter(fighter, spawnX);
      this.inputBuffers.set(pid, []);
      this.lastInputTick.set(pid, this.state.tick);
    }

    this.startCountdown();
  }

  private async endMatch(winnerId: string, reason: MatchEndReason): Promise<void> {
    if (this.state.phase === "match_end") return;

    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = undefined;
    }

    const loserId = this.getOpponentId(winnerId) || "";
    this.state.phase = "match_end";
    this.state.winnerId = winnerId;
    this.state.loserId = loserId;
    this.state.endReason = reason;
    this.state.matchTimer = 0;

    this.broadcast("MATCH_END", {
      matchId: this.state.matchId,
      winnerId,
      loserId,
      reason,
      scores: Object.fromEntries(this.state.scores),
    });

    void this.replay.recordEvent(this.state.matchId, this.state.tick, "match_end", {
      winnerId,
      loserId,
      reason,
      scores: Object.fromEntries(this.state.scores),
    }, winnerId);
    void redisInfrastructure.publish("arcadestrike:room-events", {
      type: "match_end",
      roomId: this.roomId,
      matchId: this.state.matchId,
      winnerId,
      loserId,
      reason,
    });
    metrics.counter("arcadestrike_matches_ended_total", "Ended matches", { reason });
    log.info({ matchId: this.state.matchId, winnerId, loserId, reason }, "Match ended");
    setTimeout(() => this.disconnect(), 30_000);
  }

  private handleInput(client: Client, input: PlayerInput): void {
    const playerId = this.getPlayerIdForClient(client);
    if (!playerId) return;

    void withCorrelation({ correlationId: `match:${this.state.matchId}`, matchId: this.state.matchId, playerId }, async () => {
      const allowed = await consumeDistributedLimit(`ws:flood:${this.roomId}:${playerId}`, C.MAX_INPUT_RATE * 2, 1000);
      if (!allowed) {
        metrics.counter("arcadestrike_ws_flood_rejections_total", "WebSocket flood rejections");
        await recordAbuseSignal("websocket_flood", { playerId, roomId: this.roomId, matchId: this.state.matchId });
        client.send("ERROR", { code: "RATE_LIMITED", message: "Input flood protection triggered" });
        return;
      }
      await this.recordValidatedInput(client, playerId, input);
    });
  }

  private async recordValidatedInput(client: Client, playerId: string, input: PlayerInput): Promise<void> {
    const fighter = this.state.fighters.get(playerId);
    if (!fighter || !this.antiCheat.validateInput(playerId, input, this.state.tick, fighter)) {
      metrics.counter("arcadestrike_anticheat_rejections_total", "Rejected anti-cheat inputs");
      void this.replay.recordEvent(this.state.matchId, this.state.tick, "anticheat_rejection", {
        input,
        violations: this.antiCheat.getViolations(playerId),
      } as any, playerId);
      log.warn({ playerId }, "Anti-cheat: input rejected");
      client.send("ERROR", { code: "INVALID_INPUT", message: "Input rejected by server validation" });
      return;
    }

    const buffer = this.inputBuffers.get(playerId);
    if (buffer && buffer.length < C.INPUT_BUFFER_SIZE) buffer.push(input);
    await this.replay.recordInput(this.state.matchId, playerId, input);
    metrics.counter("arcadestrike_inputs_accepted_total", "Accepted player inputs");

    this.lastInputTick.set(playerId, this.state.tick);
    this.afkWarned.delete(playerId);
    client.send("INPUT_ACK", { seq: input.seq, tick: this.state.tick });
  }

  private handleRematch(client: Client, vote: boolean): void {
    const playerId = this.getPlayerIdForClient(client);
    if (!playerId || this.state.phase !== "match_end") return;

    this.rematchVotes.set(playerId, vote);
    if (this.rematchVotes.size !== 2) return;

    const allYes = Array.from(this.rematchVotes.values()).every(Boolean);
    if (!allYes) {
      this.broadcast("REMATCH_DECLINED", {});
      return;
    }

    this.broadcast("REMATCH_START", {});
    this.resetForRematch();
  }

  private resetForRematch(): void {
    this.rematchVotes.clear();
    this.state.currentRound = 1;
    this.state.matchId = nanoid(16);
    this.state.winnerId = "";
    this.state.loserId = "";
    this.state.endReason = "";
    this.state.roundWinner = "";
    this.state.matchTimer = 0;

    for (const [pid] of this.state.scores) this.state.scores.set(pid, 0);
    for (const [pid, fighter] of this.state.fighters) {
      const spawnX = this.joinOrder.indexOf(pid) === 0
        ? C.ARENA_WIDTH * 0.25
        : C.ARENA_WIDTH * 0.75;
      CombatEngine.resetFighter(fighter, spawnX);
      this.inputBuffers.set(pid, []);
      this.lastInputTick.set(pid, this.state.tick);
    }

    this.matchConfig.matchId = this.state.matchId;
    this.startGameLoop();
    this.startCountdown();
  }

  private checkAfkForfeits(): void {
    for (const [playerId] of this.state.fighters) {
      const last = this.lastInputTick.get(playerId) ?? this.state.tick;
      const idleTicks = this.state.tick - last;

      if (idleTicks >= AFK_FORFEIT_TICKS) {
        const winnerId = this.getOpponentId(playerId);
        if (winnerId) void this.endMatch(winnerId, "afk");
        return;
      }

      if (idleTicks >= AFK_WARNING_TICKS && !this.afkWarned.has(playerId)) {
        this.afkWarned.add(playerId);
        this.playerToClient.get(playerId)?.send("ERROR", {
          code: "RATE_LIMITED",
          message: "AFK warning: send input or forfeit the match.",
        });
      }
    }
  }

  private currentMatchConfig(): MatchConfig {
    return {
      ...this.matchConfig,
      matchId: this.state.matchId,
      players: this.joinOrder.slice(0, 2) as [string, string],
    };
  }

  private getPlayerIdForClient(client: Client): string | undefined {
    return this.clientToPlayerId.get(client.sessionId);
  }

  private getOpponentId(playerId: string): string | undefined {
    for (const [pid] of this.state.fighters) {
      if (pid !== playerId) return pid;
    }
    return undefined;
  }

  private resolveJoiningPlayerId(client: Client, options: any, auth: any): string {
    const requested = auth?.playerId || options?.playerId;
    if (requested && (!this.expectedPlayers.length || this.expectedPlayers.includes(requested))) {
      return requested;
    }

    const nextExpected = this.expectedPlayers.find(pid => !this.state.fighters.has(pid));
    return nextExpected || client.sessionId;
  }
}

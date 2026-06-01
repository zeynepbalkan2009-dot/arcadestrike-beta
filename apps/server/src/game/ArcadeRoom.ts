/**
 * ArcadeRoom - server-authoritative 1v1 match lifecycle.
 */

import { Room, Client } from "colyseus";
import { GAME_CONSTANTS as C, PlayerInput, MatchConfig } from "@arcadestrike/shared";
import { ArcadeGameState, FighterSchema } from "./GameState";
import { CombatEngine } from "./CombatEngine";
import { AntiCheat } from "./AntiCheat";
import { createLogger } from "../utils/logger";
import { nanoid } from "nanoid";

const log = createLogger("ArcadeRoom");

export interface RoomOptions {
  wagerAmount: string;
  currency: "REAL" | "PROMO";
  queueMode?: "quick" | "ranked";
  players?: [string, string];
}

export class ArcadeRoom extends Room<ArcadeGameState> {
  private matchConfig!: MatchConfig;
  private inputBuffers = new Map<string, PlayerInput[]>();
  private antiCheat = new AntiCheat();
  private tickInterval?: ReturnType<typeof setInterval>;
  private matchEndDisconnectTimer?: ReturnType<typeof setTimeout>;
  private expectedPlayers: string[] = [];
  private joinOrder: string[] = [];
  private clientToPlayerId = new Map<string, string>();

  maxClients = 2;

  onCreate(options: RoomOptions): void {
    this.autoDispose = false;

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

    this.onMessage("INPUT", (client, input: PlayerInput) => {
      this.handleInput(client, input);
    });

    log.info({ roomId: this.roomId }, "Room created");
  }

  onJoin(client: Client, options: any, auth: any): void {
    const playerId =
      auth?.playerId ||
      options?.playerId ||
      this.expectedPlayers.find(
        pid => !Array.from(this.clientToPlayerId.values()).includes(pid)
      ) ||
      client.sessionId;

    this.clientToPlayerId.set(client.sessionId, playerId);

    let fighter = this.state.fighters.get(playerId);

    if (!fighter) {
      fighter = new FighterSchema();

      fighter.id = nanoid(8);
      fighter.playerId = playerId;

      this.joinOrder.push(playerId);

      const spawnX =
        this.joinOrder.length === 1
          ? C.ARENA_WIDTH * 0.25
          : C.ARENA_WIDTH * 0.75;

      CombatEngine.resetFighter(fighter, spawnX);

      this.state.fighters.set(playerId, fighter);
      this.state.scores.set(playerId, 0);
    }

    this.inputBuffers.set(playerId, []);

    client.send("STATE_SNAPSHOT", {
      tick: this.state.tick,
      state: this.state,
      yourPlayerId: playerId,
    });

    log.info({
      roomId: this.roomId,
      playerId,
      fighterCount: this.state.fighters.size,
    }, "Player joined");

    if (this.state.fighters.size === 2) {
      this.startGameLoop();

      this.state.phase = "fighting";
      this.state.matchTimer = C.MATCH_DURATION_TICKS;

      this.broadcast("MATCH_START", {
        roomId: this.roomId,
      });
    }
  }

  async onLeave(client: Client): Promise<void> {
    const playerId = this.clientToPlayerId.get(client.sessionId);

    if (!playerId) return;

    this.clientToPlayerId.delete(client.sessionId);

    if (this.state.phase === "fighting") {
      const remaining = Array.from(this.state.fighters.keys()).find(
        p => p !== playerId
      );

      if (remaining) {
        this.state.winnerId = remaining;
        this.state.phase = "match_end";

        this.broadcast("MATCH_END", {
          winnerId: remaining,
          loserId: playerId,
        });
      }
    }
  }

  onDispose(): void {
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
    }
    if (this.matchEndDisconnectTimer) {
      clearTimeout(this.matchEndDisconnectTimer);
    }
  }

  private startGameLoop(): void {
    if (this.tickInterval) return;

    const tickMs = 1000 / C.TICK_RATE;

    this.tickInterval = setInterval(() => {
      this.tick();
    }, tickMs);
  }

  private tick(): void {
    this.state.tick++;

    if (this.state.phase !== "fighting") return;

    this.state.matchTimer--;

    const inputs = new Map<string, PlayerInput>();

    for (const [playerId, buffer] of this.inputBuffers) {
      const input = buffer.shift();

      if (input) {
        inputs.set(playerId, input);
      }
    }

    const fighters = Array.from(this.state.fighters.values());

    const events = CombatEngine.tick(fighters, inputs);

    for (const event of events) {
      if (event.type === "ko") {
        this.endMatch(event.attackerId);
        return;
      }
    }

    if (this.state.matchTimer <= 0) {
      const sorted = fighters.sort((a, b) => b.hp - a.hp);

      this.endMatch(sorted[0].playerId);
    }
  }

  private endMatch(winnerId: string): void {
    if (this.state.phase === "match_end") return;

    this.state.phase = "match_end";

    const loserId = Array.from(this.state.fighters.keys()).find(
      p => p !== winnerId
    );

    this.state.winnerId = winnerId;
    this.state.loserId = loserId || "";

    this.broadcast("MATCH_END", {
      winnerId,
      loserId,
    });

    log.info({ roomId: this.roomId, winnerId, loserId }, "Match ended");

    this.matchEndDisconnectTimer = setTimeout(() => {
      this.disconnect();
    }, 5000);
  }

  private handleInput(client: Client, input: PlayerInput): void {
    const playerId = this.clientToPlayerId.get(client.sessionId);

    if (!playerId) return;

    const fighter = this.state.fighters.get(playerId);

    if (!fighter) return;

    const valid = this.antiCheat.validateInput(
      playerId,
      input,
      this.state.tick,
      fighter
    );

    if (!valid) return;

    const buffer = this.inputBuffers.get(playerId);

    if (buffer && buffer.length < C.INPUT_BUFFER_SIZE) {
      buffer.push(input);
    }

    client.send("INPUT_ACK", {
      seq: input.seq,
      tick: this.state.tick,
    });
  }
}

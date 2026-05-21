/**
 * MatchmakingQueue — pairing players by wager amount & ELO.
 *
 * Strategy:
 *  1. Exact wager match first
 *  2. ELO range expands with wait time
 *  3. Target <5s average wait
 *
 */
import { matchMaker, Server as ColyseusServer } from "colyseus";
import { QueueEntry, QueueMode } from "@arcadestrike/shared";
import { EconomyService, EconomyError } from "../economy/EconomyService";
import { createLogger } from "../utils/logger";
import { redisInfrastructure } from "../infra/redis";
import { metrics } from "../infra/metrics";
import { recordAbuseSignal } from "../infra/security";

const log = createLogger("MatchmakingQueue");

const ELO_INITIAL_RANGE = 100;
const ELO_EXPAND_RATE  = 50;   // expand by 50 per second of wait
const ELO_MAX_RANGE    = 500;
const MATCH_TICK_MS    = 500;   // check for matches every 500ms

export class MatchmakingQueue {
  private queue: QueueEntry[] = [];
  private pendingMatches = new Map<string, MatchTicket>();
  private economy = new EconomyService();
  private colyseusServer: ColyseusServer;
  private matchTicker?: ReturnType<typeof setInterval>;

  constructor(server: ColyseusServer) {
    this.colyseusServer = server;
  }

  async initialize(): Promise<void> {
    this.matchTicker = setInterval(() => this.processQueue(), MATCH_TICK_MS);
    await redisInfrastructure.subscribe("arcadestrike:room-events", event => {
      log.info({ event }, "Room event received");
    });
    log.info("Matchmaking queue initialized");
  }

  async join(entry: QueueEntry): Promise<void> {
    // Validate balance & daily limits
    await this.economy.lockWager(entry.playerId, entry.wagerAmount, entry.currency);

    const existingQueueKey = await this.getPlayerQueueKey(entry.playerId);
    if (existingQueueKey || this.queue.some(e => e.playerId === entry.playerId)) {
      await this.economy.refundMatch(entry.playerId, entry.playerId, entry.wagerAmount, entry.currency);
      await recordAbuseSignal("matchmaking_abuse", { playerId: entry.playerId, reason: "duplicate_queue_join" });
      throw new Error("ALREADY_IN_QUEUE");
    }

    this.pendingMatches.delete(entry.playerId);
    const queuedEntry = { ...entry, joinedAt: Date.now(), queueMode: entry.queueMode || "quick" };
    this.queue.push(queuedEntry);
    await this.addDistributedEntry(queuedEntry);
    metrics.counter("arcadestrike_matchmaking_join_total", "Players joining matchmaking", { mode: queuedEntry.queueMode });
    log.info({ playerId: entry.playerId, wager: entry.wagerAmount, mode: entry.queueMode }, "Player joined queue");
  }

  async leave(playerId: string): Promise<void> {
    const idx = this.queue.findIndex(e => e.playerId === playerId);
    const distributedEntry = await this.removeDistributedEntry(playerId);
    if (idx === -1 && !distributedEntry) return;

    const entry = idx === -1 ? distributedEntry! : this.queue.splice(idx, 1)[0];
    // Refund locked wager
    await this.economy.refundMatch(playerId, playerId, entry.wagerAmount, entry.currency);
    log.info({ playerId }, "Player left queue");
  }

  async getPosition(playerId: string): Promise<number> {
    const queueKey = await this.getPlayerQueueKey(playerId);
    if (queueKey && redisInfrastructure.client) {
      const rank = await redisInfrastructure.client.zrank(queueKey, playerId);
      return rank === null ? 0 : rank + 1;
    }
    return this.queue.findIndex(e => e.playerId === playerId) + 1;
  }

  async getPendingMatch(playerId: string): Promise<MatchTicket | undefined> {
    const redis = redisInfrastructure.client;
    if (redis) {
      const raw = await redis.get(`matchmaking:pending:${playerId}`);
      return raw ? JSON.parse(raw) as MatchTicket : undefined;
    }
    return this.pendingMatches.get(playerId);
  }

  async consumePendingMatch(playerId: string): Promise<MatchTicket | undefined> {
    const ticket = this.pendingMatches.get(playerId);
    if (ticket) this.pendingMatches.delete(playerId);
    const redis = redisInfrastructure.client;
    if (redis) await redis.del(`matchmaking:pending:${playerId}`);
    return ticket;
  }

  private async processQueue(): Promise<void> {
    await this.hydrateDistributedQueue();
    if (this.queue.length < 2) return;

    const now = Date.now();
    const matched = new Set<string>();

    for (let i = 0; i < this.queue.length; i++) {
      if (matched.has(this.queue[i].playerId)) continue;
      const p1 = this.queue[i];

      for (let j = i + 1; j < this.queue.length; j++) {
        if (matched.has(this.queue[j].playerId)) continue;
        const p2 = this.queue[j];

        if (this.canMatch(p1, p2, now)) {
          matched.add(p1.playerId);
          matched.add(p2.playerId);
          await this.createMatch(p1, p2);
          await this.removeDistributedEntry(p1.playerId, false);
          await this.removeDistributedEntry(p2.playerId, false);
          break;
        }
      }
    }

    // Remove matched players from queue
    this.queue = this.queue.filter(e => !matched.has(e.playerId));
  }

  private canMatch(p1: QueueEntry, p2: QueueEntry, now: number): boolean {
    if (p1.queueMode !== p2.queueMode) return false;

    // Must match on currency type
    if (p1.currency !== p2.currency) return false;

    // Must match on wager amount (exact)
    if (p1.wagerAmount !== p2.wagerAmount) return false;

    if (p1.queueMode === "quick") return true;

    // Ranked ELO range expands with wait time
    const p1Wait = (now - p1.joinedAt) / 1000;
    const p2Wait = (now - p2.joinedAt) / 1000;
    const maxWait = Math.max(p1Wait, p2Wait);

    const eloRange = Math.min(
      ELO_INITIAL_RANGE + ELO_EXPAND_RATE * maxWait,
      ELO_MAX_RANGE
    );

    return Math.abs(p1.elo - p2.elo) <= eloRange;
  }

  private async createMatch(p1: QueueEntry, p2: QueueEntry): Promise<void> {
    log.info({ p1: p1.playerId, p2: p2.playerId }, "Match found! Creating room...");

    try {
      const room = await matchMaker.createRoom("arcade_room", {
        wagerAmount: p1.wagerAmount,
        currency: p1.currency,
        queueMode: p1.queueMode,
        players: [p1.playerId, p2.playerId],
      });

      const ticket: MatchTicket = {
        matchId: room.roomId,
        roomId: room.roomId,
        roomName: "arcade_room",
        players: [p1.playerId, p2.playerId],
        wagerAmount: p1.wagerAmount,
        currency: p1.currency,
        queueMode: p1.queueMode,
        createdAt: Date.now(),
      };
      this.pendingMatches.set(p1.playerId, ticket);
      this.pendingMatches.set(p2.playerId, ticket);
      await this.storePendingMatch(ticket);
      await redisInfrastructure.publish("arcadestrike:room-events", {
        type: "match_found",
        matchId: ticket.matchId,
        players: ticket.players,
        queueMode: ticket.queueMode,
      });
      metrics.counter("arcadestrike_matches_created_total", "Matchmaking-created rooms", { mode: ticket.queueMode });

      log.info({ roomId: room.roomId, p1: p1.playerId, p2: p2.playerId }, "Room created for match");
    } catch (err) {
      log.error({ err }, "Failed to create match room");
      // Refund both players
      await Promise.allSettled([
        this.economy.refundMatch(p1.playerId, p1.playerId, p1.wagerAmount, p1.currency),
        this.economy.refundMatch(p2.playerId, p2.playerId, p2.wagerAmount, p2.currency),
      ]);
    }
  }

  dispose(): void {
    if (this.matchTicker) clearInterval(this.matchTicker);
  }

  private queueKey(entry: Pick<QueueEntry, "queueMode" | "currency" | "wagerAmount">): string {
    return `matchmaking:queue:${entry.queueMode || "quick"}:${entry.currency}:${entry.wagerAmount}`;
  }

  private async addDistributedEntry(entry: QueueEntry): Promise<void> {
    const redis = redisInfrastructure.client;
    if (!redis) return;
    const key = this.queueKey(entry);
    await redis.multi()
      .sadd("matchmaking:queue-keys", key)
      .zadd(key, entry.joinedAt, entry.playerId)
      .set(`matchmaking:entry:${entry.playerId}`, JSON.stringify(entry), "EX", 120)
      .set(`matchmaking:player:${entry.playerId}`, key, "EX", 120)
      .exec();
  }

  private async removeDistributedEntry(playerId: string, deleteEntry = true): Promise<QueueEntry | undefined> {
    const redis = redisInfrastructure.client;
    if (!redis) return undefined;
    const [queueKey, raw] = await Promise.all([
      redis.get(`matchmaking:player:${playerId}`),
      redis.get(`matchmaking:entry:${playerId}`),
    ]);
    if (queueKey) await redis.zrem(queueKey, playerId);
    if (deleteEntry) await redis.del(`matchmaking:player:${playerId}`, `matchmaking:entry:${playerId}`);
    return raw ? JSON.parse(raw) as QueueEntry : undefined;
  }

  private async getPlayerQueueKey(playerId: string): Promise<string | null> {
    return redisInfrastructure.client?.get(`matchmaking:player:${playerId}`) ?? null;
  }

  private async hydrateDistributedQueue(): Promise<void> {
    const redis = redisInfrastructure.client;
    if (!redis) return;
    const keys = await redis.smembers("matchmaking:queue-keys");
    const seen = new Set(this.queue.map(entry => entry.playerId));
    for (const key of keys) {
      const playerIds = await redis.zrange(key, 0, 49);
      for (const playerId of playerIds) {
        if (seen.has(playerId)) continue;
        const raw = await redis.get(`matchmaking:entry:${playerId}`);
        if (!raw) continue;
        const entry = JSON.parse(raw) as QueueEntry;
        this.queue.push(entry);
        seen.add(playerId);
      }
    }
  }

  private async storePendingMatch(ticket: MatchTicket): Promise<void> {
    const redis = redisInfrastructure.client;
    if (!redis) return;
    await redis.multi()
      .set(`matchmaking:pending:${ticket.players[0]}`, JSON.stringify(ticket), "EX", 60)
      .set(`matchmaking:pending:${ticket.players[1]}`, JSON.stringify(ticket), "EX", 60)
      .exec();
  }
}

export interface MatchTicket {
  matchId: string;
  roomId: string;
  roomName: string;
  players: [string, string];
  wagerAmount: string;
  currency: "REAL" | "PROMO";
  queueMode: QueueMode;
  createdAt: number;
}

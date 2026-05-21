import type { PlayerInput } from "@arcadestrike/shared";
import { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../db/prisma";
import { getCorrelationId } from "../infra/correlation";
import { metrics } from "../infra/metrics";
import { createLogger } from "../utils/logger";

const log = createLogger("ReplayService");

export class ReplayService {
  private static pendingWrites = new Set<Promise<unknown>>();

  constructor(private readonly db: PrismaClient = prisma) {}

  async recordInput(matchId: string, playerId: string, input: PlayerInput): Promise<void> {
    const write = this.persistInput(matchId, playerId, input);
    ReplayService.pendingWrites.add(write);
    write.finally(() => ReplayService.pendingWrites.delete(write));
    await write;
  }

  async recordEvent(
    matchId: string,
    tick: number,
    type: string,
    payload?: Prisma.InputJsonValue,
    playerId?: string
  ): Promise<void> {
    const write = this.persistEvent(matchId, tick, type, payload, playerId);
    ReplayService.pendingWrites.add(write);
    write.finally(() => ReplayService.pendingWrites.delete(write));
    await write;
  }

  static async flushAll(timeoutMs = 5000): Promise<void> {
    const writes = Array.from(ReplayService.pendingWrites);
    if (writes.length === 0) return;

    await Promise.race([
      Promise.allSettled(writes),
      new Promise(resolve => setTimeout(resolve, timeoutMs)),
    ]);
  }

  private async persistInput(matchId: string, playerId: string, input: PlayerInput): Promise<void> {
    try {
      await this.db.replayInput.upsert({
        where: {
          matchId_playerId_seq: {
            matchId,
            playerId,
            seq: input.seq,
          },
        },
        update: {},
        create: {
          matchId,
          playerId,
          seq: input.seq,
          tick: input.tick,
          payload: input as unknown as Prisma.InputJsonValue,
        },
      });
      metrics.counter("arcadestrike_replay_inputs_total", "Persisted replay inputs");
    } catch (err) {
      log.error({ err, matchId, playerId }, "Failed to persist replay input");
    }
  }

  private async persistEvent(
    matchId: string,
    tick: number,
    type: string,
    payload?: Prisma.InputJsonValue,
    playerId?: string
  ): Promise<void> {
    try {
      await this.db.matchEvent.create({
        data: {
          matchId,
          tick,
          type,
          playerId,
          correlationId: getCorrelationId(),
          payload,
        },
      });
      metrics.counter("arcadestrike_match_events_total", "Persisted match timeline events", { type });
    } catch (err) {
      log.error({ err, matchId, type }, "Failed to persist match event");
    }
  }

  async exportMatch(matchId: string): Promise<unknown> {
    const [inputs, events] = await Promise.all([
      this.db.replayInput.findMany({ where: { matchId }, orderBy: [{ tick: "asc" }, { seq: "asc" }] }),
      this.db.matchEvent.findMany({ where: { matchId }, orderBy: [{ tick: "asc" }, { createdAt: "asc" }] }),
    ]);

    return {
      matchId,
      exportedAt: new Date().toISOString(),
      inputs: inputs.map(input => ({
        playerId: input.playerId,
        seq: input.seq,
        tick: input.tick,
        payload: input.payload,
      })),
      events: events.map(event => ({
        tick: event.tick,
        type: event.type,
        playerId: event.playerId,
        correlationId: event.correlationId,
        payload: event.payload,
        createdAt: event.createdAt.toISOString(),
      })),
    };
  }
}

import { createHash } from "crypto";
import { redisInfrastructure } from "./redis";
import { metrics } from "./metrics";
import { createLogger } from "../utils/logger";

const log = createLogger("security");

interface LocalWindow {
  count: number;
  resetAt: number;
}

const localWindows = new Map<string, LocalWindow>();

export function fingerprint(parts: Array<string | undefined>): string {
  return createHash("sha256")
    .update(parts.filter(Boolean).join("|"))
    .digest("hex");
}

export async function consumeDistributedLimit(
  key: string,
  limit: number,
  windowMs: number
): Promise<boolean> {
  const redis = redisInfrastructure.client;
  if (redis) {
    const current = await redis.incr(key);
    if (current === 1) await redis.pexpire(key, windowMs);
    return current <= limit;
  }

  const now = Date.now();
  const local = localWindows.get(key);
  if (!local || local.resetAt <= now) {
    localWindows.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  local.count++;
  return local.count <= limit;
}

export async function recordPresence(
  playerId: string,
  roomId: string,
  sessionId: string,
  ttlSeconds = 60
): Promise<void> {
  const redis = redisInfrastructure.client;
  if (!redis) return;
  await redis.set(
    `presence:player:${playerId}`,
    JSON.stringify({ roomId, sessionId, updatedAt: Date.now() }),
    "EX",
    ttlSeconds
  );
}

export async function clearPresence(playerId: string): Promise<void> {
  const redis = redisInfrastructure.client;
  if (!redis) return;
  await redis.del(`presence:player:${playerId}`);
}

export async function recordAbuseSignal(
  type: "websocket_flood" | "matchmaking_abuse" | "wallet_fingerprint",
  payload: Record<string, unknown>
): Promise<void> {
  metrics.counter("arcadestrike_security_events_total", "Security abuse signals", { type });
  log.warn({ type, ...payload }, "Security abuse signal");
  await redisInfrastructure.publish("arcadestrike:security", { type, ...payload, at: Date.now() });
}

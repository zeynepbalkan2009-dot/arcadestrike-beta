import { prisma } from "../db/prisma";
import { redisInfrastructure } from "./redis";

export interface HealthStatus {
  status: "ok" | "degraded" | "unready";
  checks: Record<string, "ok" | "skipped" | "failed">;
  timestamp: number;
}

export async function healthCheck(): Promise<HealthStatus> {
  return {
    status: "ok",
    checks: { process: "ok" },
    timestamp: Date.now(),
  };
}

export async function readinessCheck(): Promise<HealthStatus> {
  const checks: HealthStatus["checks"] = { database: "failed", redis: "skipped" };

  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = "ok";
  } catch {
    checks.database = "failed";
  }

  if (redisInfrastructure.client) {
    try {
      await redisInfrastructure.client.ping();
      checks.redis = "ok";
    } catch {
      checks.redis = "failed";
    }
  }

  const failed = Object.values(checks).includes("failed");
  return {
    status: failed ? "unready" : "ok",
    checks,
    timestamp: Date.now(),
  };
}

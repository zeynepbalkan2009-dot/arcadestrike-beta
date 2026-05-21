/**
 * ArcadeStrike Game Server — Entry Point
 *
 * Wires together:
 *  - Express REST API (auth, wallet, matchmaking, escrow, stats)
 *  - Colyseus WebSocket game server (ArcadeRoom)
 *  - MatchmakingQueue (background ticker)
 *  - EscrowWatcher (on-chain event listener)
 *  - Colyseus Monitor (dev only)
 */
import "dotenv/config";
import http from "http";
import express from "express";
import { Server as ColyseusServer } from "colyseus";
import { monitor } from "@colyseus/monitor";

import { ArcadeRoom } from "./game/ArcadeRoom";
import { MatchmakingQueue } from "./matchmaking/MatchmakingQueue";
import { EscrowWatcher } from "./web3/EscrowWatcher";

import { createApiRouter } from "./routes/api";
import { createAuthRouter } from "./routes/auth";
import { createWalletRouter } from "./routes/wallet";
import { createMatchmakingRouter, setQueueInstance } from "./routes/matchmaking";
import { createEscrowRouter } from "./routes/escrow";
import { createStatsRouter } from "./routes/stats";
import { createReplayRouter } from "./routes/replay";

import { rateLimitApi } from "./middleware/rateLimit";
import { createLogger } from "./utils/logger";
import { redisInfrastructure } from "./infra/redis";
import { correlationMiddleware } from "./infra/correlation";
import { metrics, metricsMiddleware } from "./infra/metrics";
import { WithdrawalQueue } from "./withdrawals/WithdrawalQueue";
import { ReplayService } from "./replay/ReplayService";

const log = createLogger("server");
const PORT = parseInt(process.env.PORT || "2567", 10);
const IS_PROD = process.env.NODE_ENV === "production";

async function bootstrap(): Promise<void> {
  await redisInfrastructure.connect();

  const app = express();

  // ─── Body parsing ──────────────────────────────────────────
  app.use(express.json({ limit: "64kb" }));

  // ─── CORS ──────────────────────────────────────────────────
  app.use((req, res, next) => {
    const origin = process.env.CLIENT_ORIGIN || "http://localhost:5173";
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization,X-Correlation-Id,X-Request-Id,Idempotency-Key");
    res.setHeader("Access-Control-Allow-Credentials", "true");
    if (req.method === "OPTIONS") { res.sendStatus(200); return; }
    next();
  });

  // ─── Security headers ──────────────────────────────────────
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("X-XSS-Protection", "1; mode=block");
    if (IS_PROD) res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    next();
  });

  app.use(correlationMiddleware);
  app.use(metricsMiddleware);

  // ─── API Routes ────────────────────────────────────────────
  app.use("/api/auth",        createAuthRouter());
  app.use("/api/wallet",      createWalletRouter());
  app.use("/api/matchmaking", createMatchmakingRouter());
  app.use("/api/escrow",      createEscrowRouter());
  app.use("/api/stats",       createStatsRouter());
  app.use("/api/replays",     createReplayRouter());
  app.get("/metrics", rateLimitApi, (_req, res) => {
    res.setHeader("Content-Type", "text/plain; version=0.0.4");
    res.send(metrics.render());
  });
  app.use("/api",             createApiRouter());      // catch-all + health

  // ─── Colyseus Monitor (dev) ────────────────────────────────
  if (!IS_PROD) {
    app.use("/colyseus", monitor());
    log.info("Colyseus monitor: http://localhost:%d/colyseus", PORT);
  }

  // ─── 404 fallback ──────────────────────────────────────────
  app.use((_req, res) => res.status(404).json({ error: "Not found" }));

  // ─── Error handler ─────────────────────────────────────────
  app.use((err: any, _req: any, res: any, _next: any) => {
    log.error({ err }, "Unhandled error");
    const status = err.status || err.statusCode || 500;
    res.status(status).json({ error: IS_PROD ? "Internal error" : err.message });
  });

  // ─── HTTP server ───────────────────────────────────────────
  const httpServer = http.createServer(app);

  // ─── Colyseus setup ────────────────────────────────────────
  const gameServer = new ColyseusServer({ server: httpServer });

  gameServer.define("arcade_room", ArcadeRoom).filterBy(["wagerAmount", "currency"]);

  // ─── Matchmaking queue ─────────────────────────────────────
  const matchmaking = new MatchmakingQueue(gameServer);
  await matchmaking.initialize();
  setQueueInstance(matchmaking); // expose to REST router

  const withdrawalQueue = new WithdrawalQueue();
  await withdrawalQueue.start();

  // ─── On-chain event watcher ────────────────────────────────
  const escrowWatcher = new EscrowWatcher();
  await escrowWatcher.initialize();

  // Wire escrow events into matchmaking state machine
  escrowWatcher.on("match_locked", ({ matchId }: { matchId: string }) => {
    log.info({ matchId }, "Escrow locked on-chain — match can begin");
    // Room advancement is handled by room's WS flow; this is audit logging
  });

  // ─── Graceful shutdown ─────────────────────────────────────
  const shutdown = async (signal: string) => {
    log.info({ signal }, "Shutting down...");
    escrowWatcher.dispose();
    matchmaking.dispose();
    withdrawalQueue.stop();
    await ReplayService.flushAll();
    await redisInfrastructure.disconnect();
    await gameServer.gracefullyShutdown();
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT",  () => shutdown("SIGINT"));

  // ─── Unhandled rejections ──────────────────────────────────
  process.on("unhandledRejection", (reason) => {
    log.error({ reason }, "Unhandled promise rejection");
  });

  // ─── Listen ────────────────────────────────────────────────
  await gameServer.listen(PORT);

  log.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  log.info("  🎮  ArcadeStrike Server ONLINE");
  log.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  log.info("  WebSocket : ws://localhost:%d",          PORT);
  log.info("  REST API  : http://localhost:%d/api",    PORT);
  if (!IS_PROD) {
    log.info("  Monitor   : http://localhost:%d/colyseus", PORT);
  }
  log.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
}

bootstrap().catch(err => {
  console.error("Fatal bootstrap error:", err);
  process.exit(1);
});

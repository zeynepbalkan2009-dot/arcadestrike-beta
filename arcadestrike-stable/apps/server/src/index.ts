/**
 * ArcadeStrike Server — Entry Point
 *
 * BOOT ORDER (critical — do not reorder):
 *   1. dotenv.config()          ← env vars loaded FIRST
 *   2. logger                   ← uses LOG_LEVEL from env
 *   3. Redis init               ← graceful degradation
 *   4. Prisma lazy singleton    ← only called on first DB use
 *   5. Fastify + Colyseus       ← HTTP + WS server
 *   6. Route registration
 *   7. Background workers       ← WithdrawalQueue etc.
 *   8. Listen
 */

// ── Step 1: Load env BEFORE any other import that might read process.env ──
import path from 'path';
import dotenv from 'dotenv';

const envPath = path.resolve(__dirname, '../../../.env');
dotenv.config({ path: envPath });

// ── Step 2: Imports (after env is loaded) ────────────────────────────────
import Fastify from 'fastify';
import { Server }          from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { monitor }         from '@colyseus/monitor';

import { logger }          from './utils/logger';
import { initRedis, disconnectRedis } from './infra/redis';
import { disconnectPrisma }           from './db/prisma';
import { registerHealthRoutes }       from './infra/health';
import { registerSecurityMiddleware } from './infra/security';
import { walletRoutes }               from './routes/wallet';
import { matchmakingRoutes }          from './routes/matchmaking';
import { replayRoutes }               from './routes/replay';
import { statsRoutes }                from './routes/stats';
import { ArcadeRoom }                 from './game/ArcadeRoom';
import { matchmakingQueue }           from './matchmaking/MatchmakingQueue';
import { withdrawalQueue }            from './withdrawals/WithdrawalQueue';

const PORT = parseInt(process.env.PORT ?? '2567', 10);

// ── Validate critical env ─────────────────────────────────────────────────
if (!process.env.DATABASE_URL) {
  logger.error('[Boot] DATABASE_URL is not set. Check your .env file.');
  process.exit(1);
}

async function main(): Promise<void> {
  // ── Step 3: Redis ───────────────────────────────────────────────────────
  await initRedis();

  // ── Step 4: Fastify ─────────────────────────────────────────────────────
  const app = Fastify({
    logger: false, // we use pino directly
    trustProxy: true,
  });

  await registerSecurityMiddleware(app);
  await registerHealthRoutes(app);

  await app.register(walletRoutes,      { prefix: '/api' });
  await app.register(matchmakingRoutes, { prefix: '/api' });
  await app.register(replayRoutes,      { prefix: '/api' });
  await app.register(statsRoutes,       { prefix: '/api' });

  // ── Step 5: Colyseus ────────────────────────────────────────────────────
  const gameServer = new Server({
    transport: new WebSocketTransport({ server: app.server }),
  });

  gameServer.define('arcade', ArcadeRoom);

  // Colyseus monitor (dev only)
  if (process.env.NODE_ENV !== 'production') {
    app.register(monitor as any, { path: '/colyseus' });
  }

  // ── Step 6: Start background workers ───────────────────────────────────
  matchmakingQueue.start();
  withdrawalQueue.start();

  // ── Step 7: Listen ──────────────────────────────────────────────────────
  await app.listen({ port: PORT, host: '0.0.0.0' });
  await gameServer.listen(PORT);

  logger.info(`
╔══════════════════════════════════════════╗
║      ArcadeStrike Server — ONLINE        ║
║  HTTP  → http://localhost:${PORT}           ║
║  WS    → ws://localhost:${PORT}             ║
║  Health→ http://localhost:${PORT}/health    ║
╚══════════════════════════════════════════╝
`);
}

// ── Graceful shutdown ─────────────────────────────────────────────────────
async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, '[Boot] shutting down gracefully...');
  matchmakingQueue.stop();
  withdrawalQueue.stop();
  await disconnectRedis();
  await disconnectPrisma();
  process.exit(0);
}

process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Catch unhandled rejections — log them but don't crash the server
process.on('unhandledRejection', (reason, promise) => {
  logger.error({ reason, promise }, '[Boot] unhandledRejection — investigate immediately');
});

process.on('uncaughtException', (err) => {
  logger.error({ err }, '[Boot] uncaughtException — shutting down');
  process.exit(1);
});

main().catch((err) => {
  logger.error({ err }, '[Boot] fatal startup error');
  process.exit(1);
});

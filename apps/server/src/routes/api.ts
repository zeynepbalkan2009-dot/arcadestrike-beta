/**
 * Main API Router — mounts all sub-routers
 */
import { Router } from "express";
import { createAuthRouter } from "./auth";
import { createWalletRouter } from "./wallet";
import { requireAuth } from "../middleware/auth";
import { rateLimitApi } from "../middleware/rateLimit";
import { EconomyService } from "../economy/EconomyService";
import { healthCheck, readinessCheck } from "../infra/health";
import { createLogger } from "../utils/logger";

const log = createLogger("api");
const economy = new EconomyService();

export function createApiRouter(): Router {
  const router = Router();

  // ─── Health ──────────────────────────────────────────────
  router.get("/health", async (_req, res) => {
    res.json({
      ...(await healthCheck()),
      version: process.env.npm_package_version || "1.0.0",
    });
  });

  router.get("/ready", async (_req, res) => {
    const readiness = await readinessCheck();
    res.status(readiness.status === "ok" ? 200 : 503).json(readiness);
  });

  // ─── Auth ────────────────────────────────────────────────
  router.use("/auth", createAuthRouter());

  // ─── Wallet ──────────────────────────────────────────────
  router.use("/wallet", createWalletRouter());

  // ─── Player Profile ──────────────────────────────────────
  router.get("/profile/:playerId", rateLimitApi, async (req, res) => {
    try {
      const wallet = await economy.getWallet(req.params.playerId);
      res.json({ playerId: req.params.playerId, wallet });
    } catch {
      res.status(404).json({ error: "Player not found" });
    }
  });

  // ─── Daily limits ────────────────────────────────────────
  router.get("/limits", requireAuth, rateLimitApi, async (req, res) => {
    try {
      const remaining = await economy.getDailyLossRemaining(req.auth!.playerId);
      res.json({ dailyLossRemaining: remaining });
    } catch {
      res.status(500).json({ error: "Internal error" });
    }
  });

  return router;
}

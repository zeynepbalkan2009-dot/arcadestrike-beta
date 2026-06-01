/**
 * Matchmaking routes for quick and ranked queues.
 *
 * Queue membership and match tickets are server-owned. Clients poll
 * /status and join only the room id returned by the server.
 */
import { Router, Request, Response } from "express";
import { requireAuth } from "../middleware/auth";
import { rateLimitApi } from "../middleware/rateLimit";
import { MatchmakingQueue } from "../matchmaking/MatchmakingQueue";
import { EconomyService, EconomyError } from "../economy/EconomyService";
import { createLogger } from "../utils/logger";
import { ethers } from "ethers";
import type { JoinQueueRequest, QueueMode } from "@arcadestrike/shared";

const log = createLogger("routes/matchmaking");
const economy = new EconomyService();

let queueInstance: MatchmakingQueue | null = null;

export function setQueueInstance(q: MatchmakingQueue): void {
  queueInstance = q;
}

const VALID_WAGERS = new Set([
  ethers.parseEther("0.5").toString(),
  ethers.parseEther("1").toString(),
  ethers.parseEther("5").toString(),
  ethers.parseEther("10").toString(),
  ethers.parseEther("25").toString(),
]);

export function createMatchmakingRouter(): Router {
  const router = Router();

  /**
   * TEMP BETA AUTH BYPASS
   * ------------------------------------------------
   * If no auth exists, create a temporary guest user.
   * This is ONLY for local beta testing.
   */
  const ensureBetaAuth = (req: Request): string => {
    if (!req.auth) {
      req.auth = {
        playerId: `guest_${Math.random().toString(36).slice(2, 10)}`,
      } as any;
    }

    return req.auth!.playerId;
  };

  const joinQueueHandler = async (req: Request, res: Response) => {
    const playerId = ensureBetaAuth(req);

    const {
      wagerAmount,
      currency,
      queueMode = "quick",
    } = req.body as JoinQueueRequest;

    if (!wagerAmount || typeof wagerAmount !== "string") {
      return res.status(400).json({ error: "Invalid wagerAmount" });
    }

    if (!VALID_WAGERS.has(wagerAmount)) {
      return res.status(400).json({
        error: "Invalid wager amount. Valid amounts: 0.5, 1, 5, 10, 25",
        validWagers: Array.from(VALID_WAGERS).map((w) =>
          ethers.formatEther(w)
        ),
      });
    }

    if (currency !== "REAL" && currency !== "PROMO") {
      return res
        .status(400)
        .json({ error: "currency must be REAL or PROMO" });
    }

    if (queueMode !== "quick" && queueMode !== "ranked") {
      return res
        .status(400)
        .json({ error: "queueMode must be quick or ranked" });
    }

    if (!queueInstance) {
      return res
        .status(503)
        .json({ error: "Matchmaking service unavailable" });
    }

    /**
     * BETA MODE:
     * Skip wallet + loss limit validation for local testing.
     */
    const IS_BETA_MODE = true;

    if (!IS_BETA_MODE) {
      const remaining = await economy.getDailyLossRemaining(playerId);

      if (BigInt(remaining) < BigInt(wagerAmount)) {
        return res.status(403).json({
          error: "Daily loss limit reached. Limit resets at midnight UTC.",
          code: "DAILY_LOSS_LIMIT_REACHED",
          remaining,
        });
      }

      const wallet = await economy.getWallet(playerId);

      const balance =
        currency === "REAL"
          ? wallet.realCredits
          : wallet.promoCredits;

      if (BigInt(balance) < BigInt(wagerAmount)) {
        return res.status(402).json({
          error: "Insufficient balance",
          code: "INSUFFICIENT_BALANCE",
          balance,
          required: wagerAmount,
        });
      }
    }

    try {
      await queueInstance.join({
        playerId,
        wagerAmount,
        currency,
        queueMode,
        joinedAt: Date.now(),
        elo: 1200,
      });

      const position = await queueInstance.getPosition(playerId);

      log.info(
        {
          playerId,
          wagerAmount,
          currency,
          queueMode,
          position,
        },
        "Joined queue"
      );

      return res.status(201).json({
        status: "queued",
        position,
        estimatedWaitMs: estimateWait(position),
        wagerAmount,
        currency,
        queueMode,
      });
    } catch (err: any) {
      if (err instanceof EconomyError) {
        return res
          .status(402)
          .json({ error: err.message, code: err.code });
      }

      if (err.message === "ALREADY_IN_QUEUE") {
        return res.status(409).json({
          error: "Already in queue",
          code: "ALREADY_IN_QUEUE",
        });
      }

      log.error({ err, playerId }, "Failed to join queue");

      return res.status(500).json({ error: "Internal error" });
    }
  };

  /**
   * BETA:
   * auth middleware temporarily removed
   */

  router.post("/queue", rateLimitApi, joinQueueHandler);

  router.post("/queue/quick", rateLimitApi, (req, res) => {
    req.body = {
      ...req.body,
      queueMode: "quick" satisfies QueueMode,
    };

    return joinQueueHandler(req, res);
  });

  router.post("/queue/ranked", rateLimitApi, (req, res) => {
    req.body = {
      ...req.body,
      queueMode: "ranked" satisfies QueueMode,
    };

    return joinQueueHandler(req, res);
  });

  router.delete("/queue", rateLimitApi, async (req, res) => {
    const playerId = ensureBetaAuth(req);

    if (!queueInstance) {
      return res
        .status(503)
        .json({ error: "Matchmaking service unavailable" });
    }

    try {
      await queueInstance.leave(playerId);

      return res.json({ status: "left_queue" });
    } catch (err) {
      log.error({ err, playerId }, "Failed to leave queue");

      return res.status(500).json({ error: "Internal error" });
    }
  });

  router.get("/status", rateLimitApi, async (req, res) => {
    const playerId = ensureBetaAuth(req);

    if (!queueInstance) {
      return res.json({
        inQueue: false,
        matchFound: false,
      });
    }

    const match = await queueInstance.getPendingMatch(playerId);

    if (match) {
      return res.json({
        inQueue: false,
        matchFound: true,
        match,
      });
    }

    const position = await queueInstance.getPosition(playerId);

    if (position === 0) {
      return res.json({
        inQueue: false,
        matchFound: false,
      });
    }

    return res.json({
      inQueue: true,
      matchFound: false,
      position,
      estimatedWaitMs: estimateWait(position),
    });
  });

  router.post("/accept", rateLimitApi, async (req, res) => {
    const playerId = ensureBetaAuth(req);

    const match = await queueInstance?.getPendingMatch(playerId);

    if (!match) {
      return res.status(404).json({
        error: "No pending match",
        code: "MATCH_NOT_FOUND",
      });
    }

    return res.json({
      status: "accepted",
      match,
    });
  });

  router.post("/decline", rateLimitApi, async (req, res) => {
    const playerId = ensureBetaAuth(req);

    if (!queueInstance) {
      return res
        .status(503)
        .json({ error: "Service unavailable" });
    }

    try {
      await queueInstance.leave(playerId);

      return res.json({
        status: "declined",
        refunded: true,
      });
    } catch {
      return res.status(500).json({
        error: "Internal error",
      });
    }
  });

  return router;
}

function estimateWait(position: number): number {
  return Math.max(1, position) * 3000;
}

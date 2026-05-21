import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { rateLimitApi } from "../middleware/rateLimit";
import { ReplayService } from "../replay/ReplayService";
import { createLogger } from "../utils/logger";

const log = createLogger("routes/replay");
const replay = new ReplayService();

export function createReplayRouter(): Router {
  const router = Router();

  router.get("/:matchId/export", requireAuth, rateLimitApi, async (req, res) => {
    try {
      const exported = await replay.exportMatch(req.params.matchId);
      return res.json(exported);
    } catch (err) {
      log.error({ err, matchId: req.params.matchId }, "Replay export failed");
      return res.status(500).json({ error: "Replay export failed" });
    }
  });

  return router;
}

import { Request, Response, NextFunction } from "express";
import { consumeDistributedLimit } from "../infra/security";
import { metrics } from "../infra/metrics";
import { createLogger } from "../utils/logger";

const log = createLogger("rateLimit");

function limiter(name: string, capacity: number, windowMs: number, keyFn: (req: Request) => string) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const key = `rate:${name}:${keyFn(req)}`;
    try {
      const allowed = await consumeDistributedLimit(key, capacity, windowMs);
      if (!allowed) {
        metrics.counter("arcadestrike_rate_limited_total", "Distributed rate limit rejections", { limiter: name });
        log.warn({ key, path: req.path }, "Rate limit exceeded");
        res.status(429).json({ error: "Too many requests", retryAfter: Math.ceil(windowMs / 1000) });
        return;
      }
      next();
    } catch (err) {
      log.error({ err, key }, "Rate limiter failed closed");
      res.status(429).json({ error: "Rate limiter unavailable", retryAfter: 1 });
    }
  };
}

export const rateLimitApi = limiter("api", 600, 60_000, req => req.ip || "unknown");
export const rateLimitAuth = limiter("auth", 5, 60_000, req => req.ip || "unknown");
export const rateLimitPayout = limiter(
  "payout",
  3,
  60_000,
  req => req.auth?.playerId || req.ip || "unknown"
);

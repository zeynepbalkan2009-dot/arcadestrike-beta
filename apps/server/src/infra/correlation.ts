import { AsyncLocalStorage } from "async_hooks";
import { Request, Response, NextFunction } from "express";
import { randomUUID } from "crypto";

interface CorrelationContext {
  correlationId: string;
  requestId?: string;
  matchId?: string;
  playerId?: string;
}

const storage = new AsyncLocalStorage<CorrelationContext>();

export function withCorrelation<T>(context: CorrelationContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function getCorrelationContext(): CorrelationContext | undefined {
  return storage.getStore();
}

export function getCorrelationId(): string {
  return storage.getStore()?.correlationId || randomUUID();
}

export function correlationMiddleware(req: Request, res: Response, next: NextFunction): void {
  const inbound = req.get("X-Correlation-Id") || req.get("X-Request-Id");
  const correlationId = inbound && inbound.length <= 128 ? inbound : randomUUID();
  res.setHeader("X-Correlation-Id", correlationId);

  storage.run(
    {
      correlationId,
      requestId: correlationId,
      playerId: req.auth?.playerId,
    },
    next
  );
}

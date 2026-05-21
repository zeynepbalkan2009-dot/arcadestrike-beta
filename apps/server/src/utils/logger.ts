import pino from "pino";
import { getCorrelationContext } from "../infra/correlation";

export function createLogger(name: string) {
  return pino({
    name,
    level: process.env.LOG_LEVEL || "info",
    base: {
      service: "arcadestrike-server",
      env: process.env.NODE_ENV || "development",
    },
    mixin() {
      const context = getCorrelationContext();
      return context ? { ...context } : {};
    },
    ...(process.env.NODE_ENV === "development" ? {
      transport: { target: "pino-pretty", options: { colorize: true } },
    } : {}),
  });
}

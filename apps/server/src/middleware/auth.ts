/**
 * Auth Middleware
 *
 * Validates JWTs on REST endpoints and Colyseus room connections.
 * In production: integrate with your identity provider (Auth0, Supabase, etc.)
 */
import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { createLogger } from "../utils/logger";

const log = createLogger("auth");

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-in-production";

export interface AuthPayload {
  playerId: string;
  address?: string;     // Ethereum address (if wallet connected)
  iat: number;
  exp: number;
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthPayload;
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing or invalid Authorization header" });
    return;
  }

  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET) as AuthPayload;
    req.auth = payload;
    next();
  } catch (err) {
    log.warn({ err }, "JWT verification failed");
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) {
    try {
      req.auth = jwt.verify(header.slice(7), JWT_SECRET) as AuthPayload;
    } catch { /* ignore */ }
  }
  next();
}

/** Generate a JWT for a player (called after wallet verification) */
export function issueToken(playerId: string, address?: string): string {
  return jwt.sign(
    { playerId, address } satisfies Omit<AuthPayload,"iat"|"exp">,
    JWT_SECRET,
    { expiresIn: "7d" }
  );
}

/** Colyseus onAuth hook — called before onJoin */
export async function colyseusAuth(
  token: string,
  _req: any
): Promise<AuthPayload> {
  if (!token) throw new Error("No auth token provided");
  try {
    return jwt.verify(token, JWT_SECRET) as AuthPayload;
  } catch {
    throw new Error("Invalid token");
  }
}

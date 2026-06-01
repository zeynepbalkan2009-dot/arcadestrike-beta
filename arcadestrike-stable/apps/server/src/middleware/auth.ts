import { FastifyRequest, FastifyReply } from 'fastify';
import { logger } from '../utils/logger';

export interface AuthPayload {
  playerId:    string;
  displayName: string;
  mmr:         number;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthPayload;
  }
}

/**
 * JWT auth middleware.
 * In dev mode with no JWT_SECRET, auth is bypassed with a mock identity.
 */
export async function authMiddleware(
  req:   FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const secret = process.env.JWT_SECRET;

  if (!secret || process.env.NODE_ENV === 'development') {
    // Dev bypass — use header or query param as player ID
    const devId = (req.headers['x-player-id'] as string) || 'dev-player-1';
    req.auth = { playerId: devId, displayName: devId, mmr: 1000 };
    return;
  }

  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    reply.status(401).send({ error: 'Missing authorization header' });
    return;
  }

  try {
    // Stub: replace with actual JWT verify once better-auth is wired
    const token = header.slice(7);
    if (!token) throw new Error('Empty token');
    // TODO: verify with better-auth
    req.auth = { playerId: token, displayName: token, mmr: 1000 };
  } catch (err) {
    logger.warn({ err }, '[Auth] invalid token');
    reply.status(401).send({ error: 'Invalid token' });
  }
}

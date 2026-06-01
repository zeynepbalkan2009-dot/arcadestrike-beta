import { FastifyRequest, FastifyReply } from 'fastify';

const _hits = new Map<string, { count: number; resetAt: number }>();

export async function rateLimitMiddleware(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const ip  = req.ip ?? '0.0.0.0';
  const now = Date.now();
  const window = 60_000; // 1 minute
  const max    = 120;    // requests per window

  let entry = _hits.get(ip);
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + window };
    _hits.set(ip, entry);
  }

  entry.count++;
  if (entry.count > max) {
    reply.status(429).send({ error: 'Too many requests' });
  }
}

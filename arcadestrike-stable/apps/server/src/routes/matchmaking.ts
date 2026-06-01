import { FastifyInstance } from 'fastify';
import { authMiddleware } from '../middleware/auth';
import { matchmakingQueue } from '../matchmaking/MatchmakingQueue';

export async function matchmakingRoutes(app: FastifyInstance): Promise<void> {
  app.post('/matchmaking/join', { preHandler: authMiddleware }, async (req, reply) => {
    const { playerId, displayName, mmr } = req.auth!;
    matchmakingQueue.enqueue({ playerId, displayName, mmr, enqueuedAt: Date.now() });
    reply.send({ status: 'queued', queueSize: matchmakingQueue.size() });
  });

  app.post('/matchmaking/leave', { preHandler: authMiddleware }, async (req, reply) => {
    matchmakingQueue.dequeue(req.auth!.playerId);
    reply.send({ status: 'left' });
  });

  app.get('/matchmaking/status', { preHandler: authMiddleware }, async (req, reply) => {
    reply.send({
      queued:    matchmakingQueue.isQueued(req.auth!.playerId),
      queueSize: matchmakingQueue.size(),
    });
  });
}

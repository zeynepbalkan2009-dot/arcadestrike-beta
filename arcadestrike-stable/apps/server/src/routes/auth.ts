import { FastifyInstance } from 'fastify';

export async function authRoutes(app: FastifyInstance): Promise<void> {
  // Placeholder — wire better-auth here when ready
  app.get('/auth/me', async (req, reply) => {
    const playerId = req.headers['x-player-id'] ?? 'anonymous';
    reply.send({ playerId });
  });
}

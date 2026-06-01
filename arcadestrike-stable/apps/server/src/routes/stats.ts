import { FastifyInstance } from 'fastify';
import { metrics } from '../infra/metrics';

export async function statsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/stats', async (_req, reply) => {
    reply.send(metrics.getSnapshot());
  });
}

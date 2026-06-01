import { FastifyInstance } from 'fastify';
import { getPrisma } from '../db/prisma';
import { getRedisStatus } from './redis';

export async function registerHealthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async (_req, reply) => {
    let dbOk = false;
    try {
      await getPrisma().$queryRaw`SELECT 1`;
      dbOk = true;
    } catch {
      dbOk = false;
    }

    const status = dbOk ? 'ok' : 'degraded';
    reply.status(dbOk ? 200 : 503).send({
      status,
      uptime: process.uptime(),
      db: dbOk ? 'ok' : 'error',
      redis: getRedisStatus(),
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/ping', async (_req, reply) => reply.send({ pong: true }));
}

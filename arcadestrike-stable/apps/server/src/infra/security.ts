import { FastifyInstance } from 'fastify';

export async function registerSecurityMiddleware(app: FastifyInstance): Promise<void> {
  // CORS
  await app.register(import('@fastify/cors'), {
    origin: process.env.CLIENT_ORIGIN ?? 'http://localhost:5173',
    credentials: true,
  });

  // Helmet-style headers
  app.addHook('onSend', async (_req, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('X-XSS-Protection', '1; mode=block');
  });
}

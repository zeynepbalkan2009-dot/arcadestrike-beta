import { FastifyInstance } from 'fastify';

export async function escrowRoutes(app: FastifyInstance): Promise<void> {
  // Placeholder — wire EscrowWatcher when RPC_URL is configured
  app.get('/escrow/status', async (_req, reply) => {
    const configured = !!process.env.RPC_URL && !!process.env.ESCROW_ADDRESS;
    reply.send({ enabled: configured });
  });
}

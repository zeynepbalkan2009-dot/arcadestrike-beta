import { FastifyInstance } from 'fastify';
import { authMiddleware } from '../middleware/auth';
import { economyService } from '../economy/EconomyService';

export async function walletRoutes(app: FastifyInstance): Promise<void> {
  app.get('/wallet/balance', { preHandler: authMiddleware }, async (req, reply) => {
    try {
      const balance = await economyService.getOrCreateWallet(req.auth!.playerId);
      reply.send({
        playerId:     req.auth!.playerId,
        realCredits:  balance.realCredits.toString(),
        promoCredits: balance.promoCredits.toString(),
      });
    } catch (err: any) {
      reply.status(500).send({ error: err.message });
    }
  });
}

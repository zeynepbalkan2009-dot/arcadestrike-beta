import { FastifyInstance } from 'fastify';
import { replayService } from '../replay/ReplayService';

export async function replayRoutes(app: FastifyInstance): Promise<void> {
  app.get('/replay/:matchId', async (req, reply) => {
    const { matchId } = req.params as { matchId: string };
    try {
      const data = await replayService.getReplay(matchId);
      reply.send(data);
    } catch (err: any) {
      reply.status(500).send({ error: err.message });
    }
  });
}

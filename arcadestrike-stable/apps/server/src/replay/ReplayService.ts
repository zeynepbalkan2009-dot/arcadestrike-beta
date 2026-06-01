import { getPrisma } from '../db/prisma';
import { logger } from '../utils/logger';
import type { PlayerInputPayload } from '../../../packages/shared/src/types';

export const replayService = {
  async recordInput(
    matchId:  string,
    playerId: string,
    seq:      number,
    tick:     number,
    payload:  PlayerInputPayload,
  ): Promise<void> {
    try {
      const prisma = getPrisma();
      await prisma.replayInput.create({
        data: { matchId, playerId, seq, tick, payload: payload as any },
      });
    } catch (err) {
      // Non-fatal — replay recording should never crash the game
      logger.warn({ err, matchId, playerId }, '[Replay] failed to record input');
    }
  },

  async recordEvent(
    matchId:       string,
    tick:          number,
    type:          string,
    playerId?:     string,
    correlationId?: string,
    payload?:      Record<string, unknown>,
  ): Promise<void> {
    try {
      const prisma = getPrisma();
      await prisma.matchEvent.create({
        data: { matchId, tick, type, playerId, correlationId, payload: payload as any },
      });
    } catch (err) {
      logger.warn({ err, matchId }, '[Replay] failed to record event');
    }
  },

  async getReplay(matchId: string) {
    const prisma = getPrisma();
    const [inputs, events] = await Promise.all([
      prisma.replayInput.findMany({ where: { matchId }, orderBy: [{ tick: 'asc' }, { seq: 'asc' }] }),
      prisma.matchEvent.findMany({ where: { matchId }, orderBy: { tick: 'asc' } }),
    ]);
    return { matchId, inputs, events };
  },
};

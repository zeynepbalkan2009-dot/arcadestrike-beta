import { logger } from '../utils/logger';
import { metrics } from '../infra/metrics';
import {
  MAX_INPUT_RATE_PER_SECOND,
  MAX_SEQ_GAP,
  TICK_RATE,
} from '../../../packages/shared/src/combat';
import type { PlayerInputPayload } from '../../../packages/shared/src/types';

interface PlayerACState {
  inputsThisSecond: number;
  windowStart: number;
  lastSeq: number;
  violations: number;
}

const _state = new Map<string, PlayerACState>();

function getState(id: string): PlayerACState {
  if (!_state.has(id)) {
    _state.set(id, { inputsThisSecond: 0, windowStart: Date.now(), lastSeq: -1, violations: 0 });
  }
  return _state.get(id)!;
}

export function resetAntiCheat(playerIds: string[]): void {
  playerIds.forEach((id) => _state.delete(id));
}

export type ACVerdict = 'ok' | 'warn' | 'kick';

export function checkInput(
  playerId: string,
  input: PlayerInputPayload,
  matchId: string,
): ACVerdict {
  const ac = getState(playerId);
  const now = Date.now();

  // Rate window reset (1 second)
  if (now - ac.windowStart >= 1000) {
    ac.inputsThisSecond = 0;
    ac.windowStart = now;
  }

  ac.inputsThisSecond++;

  // Input rate check
  if (ac.inputsThisSecond > MAX_INPUT_RATE_PER_SECOND) {
    ac.violations++;
    logger.warn({ playerId, matchId, rate: ac.inputsThisSecond }, '[AntiCheat] input rate exceeded');
    metrics.increment('anticheat.rate_violation');
    if (ac.violations >= 5) return 'kick';
    return 'warn';
  }

  // Sequence gap check
  if (ac.lastSeq >= 0 && input.seq > ac.lastSeq + MAX_SEQ_GAP) {
    ac.violations++;
    logger.warn({ playerId, matchId, gap: input.seq - ac.lastSeq }, '[AntiCheat] seq gap');
    metrics.increment('anticheat.seq_gap');
  }

  // Sequence must not go backwards (replay attack)
  if (input.seq <= ac.lastSeq && ac.lastSeq >= 0) {
    ac.violations++;
    logger.warn({ playerId, matchId, seq: input.seq, lastSeq: ac.lastSeq }, '[AntiCheat] seq replay');
    metrics.increment('anticheat.seq_replay');
    if (ac.violations >= 10) return 'kick';
    return 'warn';
  }

  ac.lastSeq = input.seq;
  return 'ok';
}

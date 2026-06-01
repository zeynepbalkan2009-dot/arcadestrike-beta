import { matchmakingQueue } from '../src/matchmaking/MatchmakingQueue';

describe('MatchmakingQueue', () => {
  afterEach(() => {
    matchmakingQueue.stop();
  });

  it('enqueues and dequeues players', () => {
    matchmakingQueue.enqueue({ playerId: 'p1', displayName: 'P1', mmr: 1000, enqueuedAt: Date.now() });
    expect(matchmakingQueue.isQueued('p1')).toBe(true);
    matchmakingQueue.dequeue('p1');
    expect(matchmakingQueue.isQueued('p1')).toBe(false);
  });

  it('does not double-enqueue', () => {
    matchmakingQueue.enqueue({ playerId: 'p2', displayName: 'P2', mmr: 1000, enqueuedAt: Date.now() });
    matchmakingQueue.enqueue({ playerId: 'p2', displayName: 'P2', mmr: 1000, enqueuedAt: Date.now() });
    expect(matchmakingQueue.size()).toBe(1);
    matchmakingQueue.dequeue('p2');
  });
});

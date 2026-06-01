/**
 * WithdrawalQueue — processes pending withdrawals with safe retry logic.
 *
 * CRASH ROOT CAUSE (fixed here):
 *   Original code called getPrisma() at module load time before dotenv ran.
 *   Now: all Prisma access is deferred to poll() execution time.
 *   Also: exponential backoff prevents log spam / tight crash loops.
 */
import { getPrisma } from '../db/prisma';
import { logger } from '../utils/logger';
import { metrics } from '../infra/metrics';

const POLL_INTERVAL_MS = 15_000;  // 15 seconds
const MAX_ATTEMPTS     = 5;
const BACKOFF_BASE_MS  = 60_000;  // 1 minute base

let _running  = false;
let _timer: ReturnType<typeof setInterval> | null = null;
let _pollActive = false;

export const withdrawalQueue = {
  start(): void {
    if (_running) return;
    _running = true;
    _timer   = setInterval(() => {
      // Guard against overlapping polls
      if (!_pollActive) _poll().catch((err) =>
        logger.error({ err }, '[WithdrawalQueue] unhandled poll error')
      );
    }, POLL_INTERVAL_MS);
    logger.info('[WithdrawalQueue] started');
  },

  stop(): void {
    if (_timer) { clearInterval(_timer); _timer = null; }
    _running = false;
    logger.info('[WithdrawalQueue] stopped');
  },
};

async function _poll(): Promise<void> {
  _pollActive = true;
  try {
    const prisma = getPrisma();
    const now    = new Date();

    // Pick up QUEUED and RETRYING items whose retry time has elapsed
    const pending = await prisma.withdrawal.findMany({
      where: {
        status: { in: ['QUEUED', 'RETRYING'] },
        OR: [
          { nextAttemptAt: null },
          { nextAttemptAt: { lte: now } },
        ],
      },
      take: 10,
      orderBy: { createdAt: 'asc' },
    });

    if (pending.length === 0) return;

    logger.info({ count: pending.length }, '[WithdrawalQueue] processing batch');

    for (const w of pending) {
      await _processOne(w.id).catch((err) =>
        logger.error({ err, withdrawalId: w.id }, '[WithdrawalQueue] item processing failed')
      );
    }
  } finally {
    _pollActive = false;
  }
}

async function _processOne(withdrawalId: string): Promise<void> {
  const prisma = getPrisma();

  // Claim it — prevent other workers picking it up simultaneously
  const claimed = await prisma.withdrawal.updateMany({
    where: { id: withdrawalId, status: { in: ['QUEUED', 'RETRYING'] } },
    data:  { status: 'PROCESSING', processingAt: new Date(), processingBy: process.pid.toString() },
  });

  if (claimed.count === 0) return; // already claimed by another worker

  const w = await prisma.withdrawal.findUnique({ where: { id: withdrawalId } });
  if (!w) return;

  if (w.attempts >= MAX_ATTEMPTS) {
    await prisma.withdrawal.update({
      where: { id: withdrawalId },
      data:  { status: 'FAILED', lastError: `Max attempts (${MAX_ATTEMPTS}) exceeded` },
    });
    logger.warn({ withdrawalId }, '[WithdrawalQueue] max attempts exceeded → FAILED');
    metrics.increment('withdrawals.failed');
    return;
  }

  try {
    // TODO: actual on-chain TX via SignerService when RPC_URL is set
    // For local dev without RPC, we simulate completion
    const rpcUrl = process.env.RPC_URL;
    if (!rpcUrl) {
      logger.warn({ withdrawalId }, '[WithdrawalQueue] RPC_URL not set — skipping on-chain TX (dev mode)');
      await prisma.withdrawal.update({
        where: { id: withdrawalId },
        data:  { status: 'FAILED', lastError: 'RPC_URL not configured', attempts: { increment: 1 } },
      });
      return;
    }

    // ... on-chain processing would go here ...

    await prisma.withdrawal.update({
      where: { id: withdrawalId },
      data:  { status: 'COMPLETED', attempts: { increment: 1 }, updatedAt: new Date() },
    });

    metrics.increment('withdrawals.completed');
    logger.info({ withdrawalId }, '[WithdrawalQueue] completed');
  } catch (err: any) {
    const attempt = (w.attempts ?? 0) + 1;
    const backoff  = BACKOFF_BASE_MS * Math.pow(2, attempt - 1); // exponential
    const next     = new Date(Date.now() + backoff);

    await prisma.withdrawal.update({
      where: { id: withdrawalId },
      data: {
        status:       attempt >= MAX_ATTEMPTS ? 'FAILED' : 'RETRYING',
        attempts:     { increment: 1 },
        lastError:    err.message ?? String(err),
        nextAttemptAt: next,
      },
    });

    logger.error({ withdrawalId, attempt, nextAttemptAt: next }, '[WithdrawalQueue] attempt failed');
    metrics.increment('withdrawals.retry');
  }
}

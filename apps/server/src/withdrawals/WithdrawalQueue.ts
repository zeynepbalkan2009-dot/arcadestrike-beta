import { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../db/prisma";
import { redisInfrastructure } from "../infra/redis";
import { metrics } from "../infra/metrics";
import { createLogger } from "../utils/logger";
import { DisabledSignerService, SignerService } from "./SignerService";

const log = createLogger("WithdrawalQueue");

const CHANNEL = "arcadestrike:withdrawals";
const MAX_ATTEMPTS = Number(process.env.WITHDRAWAL_MAX_ATTEMPTS || 5);
const WORKER_ID = process.env.WITHDRAWAL_WORKER_ID || `worker-${process.pid}`;

export class WithdrawalQueue {
  private timer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly db: PrismaClient = prisma,
    private readonly signer: SignerService = new DisabledSignerService()
  ) {}

  async enqueue(withdrawalId: string): Promise<void> {
    await redisInfrastructure.publish(CHANNEL, { withdrawalId });
    metrics.counter("arcadestrike_withdrawals_enqueued_total", "Queued withdrawals");
  }

  async start(): Promise<void> {
    await redisInfrastructure.subscribe(CHANNEL, payload => {
      if (typeof payload?.withdrawalId === "string") {
        void this.process(payload.withdrawalId);
      }
    });

    this.timer = setInterval(() => {
      void this.recoverPending();
    }, 15_000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async process(withdrawalId: string): Promise<void> {
    const claimed = await this.claim(withdrawalId);
    if (!claimed) return;

    try {
      const result = await this.signer.sendWithdrawal({
        withdrawalId: claimed.id,
        playerId: claimed.playerId,
        amountWei: claimed.amount.toFixed(0),
        toAddress: claimed.toAddress,
      });

      await this.db.withdrawal.update({
        where: { id: withdrawalId },
        data: {
          status: "COMPLETED",
          txHash: result.txHash,
          processingBy: null,
          processingAt: null,
          lastError: null,
        },
      });
      await this.recordAttempt(withdrawalId, "COMPLETED", claimed.attempts, result.txHash);
      metrics.counter("arcadestrike_withdrawals_completed_total", "Completed withdrawals");
    } catch (err: any) {
      await this.failOrRetry(withdrawalId, claimed.attempts + 1, err?.message || "Unknown signer error");
    }
  }

  private async recoverPending(): Promise<void> {
    const now = new Date();
    const staleProcessingBefore = new Date(Date.now() - 5 * 60_000);
    const withdrawals = await this.db.withdrawal.findMany({
      where: {
        OR: [
          { status: "QUEUED" },
          { status: "RETRYING", nextAttemptAt: { lte: now } },
          { status: "PROCESSING", processingAt: { lte: staleProcessingBefore } },
        ],
      },
      orderBy: { createdAt: "asc" },
      take: 25,
    });

    for (const withdrawal of withdrawals) {
      await this.enqueue(withdrawal.id);
    }
  }

  private async claim(withdrawalId: string) {
    return this.db.$transaction(async tx => {
      const withdrawal = await tx.withdrawal.findUnique({ where: { id: withdrawalId } });
      if (!withdrawal || !["QUEUED", "RETRYING", "PROCESSING"].includes(withdrawal.status)) return null;
      if (withdrawal.nextAttemptAt && withdrawal.nextAttemptAt > new Date()) return null;

      return tx.withdrawal.update({
        where: { id: withdrawalId },
        data: {
          status: "PROCESSING",
          attempts: { increment: 1 },
          processingBy: WORKER_ID,
          processingAt: new Date(),
        },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  private async failOrRetry(withdrawalId: string, attempt: number, error: string): Promise<void> {
    const finalFailure = attempt >= MAX_ATTEMPTS;
    const status = finalFailure ? "FAILED" : "RETRYING";
    const nextAttemptAt = finalFailure ? null : new Date(Date.now() + Math.min(60_000 * attempt, 15 * 60_000));

    await this.db.withdrawal.update({
      where: { id: withdrawalId },
      data: {
        status,
        nextAttemptAt,
        lastError: error.slice(0, 1000),
        processingBy: null,
        processingAt: null,
      },
    });
    await this.recordAttempt(withdrawalId, status, attempt, undefined, error);
    metrics.counter("arcadestrike_withdrawals_failed_total", "Failed withdrawal attempts", { final: String(finalFailure) });
    log.error({ withdrawalId, attempt, finalFailure, error }, "Withdrawal processing failed");
  }

  private async recordAttempt(
    withdrawalId: string,
    status: "COMPLETED" | "FAILED" | "RETRYING",
    attempt: number,
    txHash?: string,
    error?: string
  ): Promise<void> {
    await this.db.withdrawalAttempt.create({
      data: {
        withdrawalId,
        status,
        attempt,
        txHash,
        error,
        workerId: WORKER_ID,
      },
    });
  }
}

/**
 * EconomyService - PostgreSQL-backed off-chain credit accounting.
 *
 * Ledger entries are the authoritative balance source. Wallet balance columns are
 * a materialized projection updated under row-level locks for fast reads.
 */
import {
  GAME_CONSTANTS as C,
  DAILY_LOSS_LIMIT,
  DAILY_LOSS_WARNING,
  CreditType,
  PlayerWallet,
  ErrorCode,
} from "@arcadestrike/shared";
import {
  FraudEventType,
  LedgerCreditType,
  LedgerEntryType,
  Prisma,
  PrismaClient,
} from "@prisma/client";
import { randomUUID } from "crypto";
import { prisma } from "../db/prisma";
import { metrics } from "../infra/metrics";
import { getCorrelationId } from "../infra/correlation";
import { createLogger } from "../utils/logger";

const log = createLogger("EconomyService");

type TxClient = Prisma.TransactionClient;
type DbClient = TxClient | PrismaClient;

interface LedgerBalances {
  real: bigint;
  promo: bigint;
}

export class EconomyError extends Error {
  constructor(public code: ErrorCode, message: string) {
    super(message);
    this.name = "EconomyError";
  }
}

export interface WithdrawalRequest {
  withdrawalId: string;
  wallet: PlayerWallet;
}

export class EconomyService {
  constructor(private readonly db: PrismaClient = prisma) {}

  async getWallet(playerId: string): Promise<PlayerWallet> {
    const wallet = await this.serializable(async tx => {
      const wallet = await this.lockWallet(tx, playerId);
      const resetWallet = await this.resetDailyLossIfNeeded(tx, wallet);
      return this.syncWalletProjection(tx, resetWallet.playerId);
    });

    return this.toPlayerWallet(wallet);
  }

  async depositReal(playerId: string, amountWei: string, txHash?: string): Promise<PlayerWallet> {
    const amount = this.parsePositiveAmount(amountWei);
    const wallet = await this.serializable(async tx => {
      await this.lockWallet(tx, playerId);

      const existingDeposit = txHash
        ? await tx.ledgerEntry.findFirst({ where: { txHash, type: "DEPOSIT" } })
        : null;
      if (existingDeposit) {
        await this.recordFraudEvent(tx, {
          playerId,
          type: "DUPLICATE_DEPOSIT",
          severity: "info",
          metadata: { txHash, reason: "duplicate_deposit_tx" },
        });
        return this.syncWalletProjection(tx, playerId);
      }

      await this.appendLedgerEntry(tx, {
        playerId,
        type: "DEPOSIT",
        creditType: "REAL",
        amount,
        txHash,
        metadata: { txHash },
      });

      return this.syncWalletProjection(tx, playerId);
    });

    log.info({ playerId, amountWei, txHash }, "Real credit deposit");
    return this.toPlayerWallet(wallet);
  }

  async awardPromo(playerId: string, amountWei: string): Promise<PlayerWallet> {
    const amount = this.parsePositiveAmount(amountWei);
    const wallet = await this.serializable(async tx => {
      await this.lockWallet(tx, playerId);
      await this.appendLedgerEntry(tx, {
        playerId,
        type: "PROMO_AWARD",
        creditType: "PROMO",
        amount,
      });
      return this.syncWalletProjection(tx, playerId);
    });

    log.info({ playerId, amountWei }, "Promo credit awarded");
    return this.toPlayerWallet(wallet);
  }

  async withdrawReal(
    playerId: string,
    amountWei: string,
    toAddress: string,
    idempotencyKey?: string
  ): Promise<WithdrawalRequest> {
    const amount = this.parsePositiveAmount(amountWei);
    const normalizedAddress = toAddress.toLowerCase();
    const key = this.normalizeIdempotencyKey(
      idempotencyKey,
      `withdraw:${playerId}:${amount.toString()}:${normalizedAddress}`
    );

    const result = await this.serializable(async tx => {
      await this.lockWallet(tx, playerId);

      const existing = await tx.withdrawal.findUnique({ where: { idempotencyKey: key } });
      if (existing) {
        await this.recordFraudEvent(tx, {
          playerId,
          type: "DUPLICATE_WITHDRAWAL",
          severity: "info",
          withdrawalId: existing.id,
          metadata: { idempotencyKey: key },
        });

        return {
          withdrawalId: existing.id,
          wallet: await this.syncWalletProjection(tx, playerId),
        };
      }

      const balances = await this.getLedgerBalances(tx, playerId);
      if (balances.real < amount) {
        await this.recordFraudEvent(tx, {
          playerId,
          type: "INSUFFICIENT_BALANCE",
          severity: "warn",
          metadata: {
            requested: amount.toString(),
            available: balances.real.toString(),
            action: "withdrawal",
          },
        });
        throw new EconomyError("INSUFFICIENT_BALANCE", "Insufficient real credits for withdrawal");
      }

      const withdrawal = await tx.withdrawal.create({
        data: {
          playerId,
          amount: amount.toString(),
          toAddress,
          status: "QUEUED",
          idempotencyKey: key,
        },
      });

      await this.appendLedgerEntry(tx, {
        playerId,
        type: "WITHDRAWAL",
        creditType: "REAL",
        amount: -amount,
        idempotencyKey: key,
        metadata: { withdrawalId: withdrawal.id, toAddress },
      });

      await tx.auditLog.create({
        data: {
          playerId,
          action: "WITHDRAWAL_CREATED",
          withdrawalId: withdrawal.id,
          metadata: { amount: amount.toString(), toAddress, idempotencyKey: key, correlationId: getCorrelationId() },
        },
      });
      metrics.counter("arcadestrike_withdrawals_created_total", "Created withdrawal requests");

      return {
        withdrawalId: withdrawal.id,
        wallet: await this.syncWalletProjection(tx, playerId),
      };
    });

    log.info({ playerId, amountWei, toAddress, withdrawalId: result.withdrawalId }, "Withdrawal queued");
    return {
      withdrawalId: result.withdrawalId,
      wallet: this.toPlayerWallet(result.wallet),
    };
  }

  async lockWager(playerId: string, amountWei: string, currency: CreditType): Promise<void> {
    const amount = this.parsePositiveAmount(amountWei);

    await this.serializable(async tx => {
      const wallet = await this.resetDailyLossIfNeeded(tx, await this.lockWallet(tx, playerId));
      const balances = await this.getLedgerBalances(tx, playerId);
      const balance = currency === "REAL" ? balances.real : balances.promo;

      if (currency === "REAL") {
        const dailyLossAfter =
          BigInt(wallet.dailyLossUsed.toFixed(0)) +
          BigInt(wallet.dailyLossReserved.toFixed(0)) +
          amount;

        if (dailyLossAfter > BigInt(DAILY_LOSS_LIMIT)) {
          await this.recordFraudEvent(tx, {
            playerId,
            type: "DAILY_LIMIT_EXCEEDED",
            severity: "warn",
            metadata: { requested: amount.toString(), dailyLossAfter: dailyLossAfter.toString() },
          });
          throw new EconomyError(
            "DAILY_LOSS_LIMIT_REACHED",
            "Daily loss limit of $50 reached. Limit resets at midnight UTC."
          );
        }
        if (dailyLossAfter > BigInt(DAILY_LOSS_WARNING)) {
          log.warn({ playerId, dailyLoss: dailyLossAfter.toString() }, "Daily loss warning threshold reached");
        }
      }

      if (balance < amount) {
        await this.recordFraudEvent(tx, {
          playerId,
          type: "INSUFFICIENT_BALANCE",
          severity: "warn",
          metadata: {
            requested: amount.toString(),
            available: balance.toString(),
            action: "wager_lock",
            currency,
          },
        });
        throw new EconomyError("INSUFFICIENT_BALANCE", "Insufficient credits for wager");
      }

      await this.appendLedgerEntry(tx, {
        playerId,
        type: "WAGER_LOCK",
        creditType: currency,
        amount: -amount,
      });

      if (currency === "REAL") {
        await tx.wallet.update({
          where: { playerId },
          data: {
            dailyLossReserved: {
              increment: amount.toString(),
            },
          },
        });
      }
    });

    log.info({ playerId, amountWei, currency }, "Wager locked");
  }

  async settleMatch(
    winnerId: string,
    loserId: string,
    wagerAmountWei: string,
    currency: CreditType,
    matchId?: string
  ): Promise<void> {
    const wager = this.parsePositiveAmount(wagerAmountWei);
    const settlementId = matchId ?? `legacy-settlement:${randomUUID()}`;

    await this.serializable(async tx => {
      await this.lockWallets(tx, [winnerId, loserId]);

      const existing = await tx.matchSettlement.findUnique({ where: { matchId: settlementId } });
      if (existing) {
        await this.recordFraudEvent(tx, {
          playerId: winnerId,
          type: "DUPLICATE_MATCH_SETTLEMENT",
          severity: "info",
          matchId: settlementId,
          metadata: { loserId, wager: wager.toString(), currency },
        });
        return;
      }

      const totalPot = wager * 2n;
      const fee = (totalPot * BigInt(C.FEE_TOTAL_BPS)) / 10000n;
      const payout = totalPot - fee;

      await this.appendLedgerEntry(tx, {
        playerId: winnerId,
        type: "MATCH_PAYOUT",
        creditType: currency,
        amount: payout,
        matchId: settlementId,
        metadata: { loserId, fee: fee.toString(), grossPot: totalPot.toString() },
      });

      await this.appendLedgerEntry(tx, {
        playerId: loserId,
        type: "MATCH_LOSS",
        creditType: currency,
        amount: 0n,
        matchId: settlementId,
        metadata: { winnerId },
      });

      if (fee > 0n) {
        await this.appendLedgerEntry(tx, {
          playerId: winnerId,
          type: "FEE",
          creditType: currency,
          amount: 0n,
          matchId: settlementId,
          metadata: { fee: fee.toString(), treasuryBps: C.FEE_TREASURY_BPS, burnBps: C.FEE_BURN_BPS },
        });
      }

      if (currency === "REAL") {
        await this.releaseReservedLoss(tx, winnerId, wager);
        await this.releaseReservedLoss(tx, loserId, wager);
        await tx.wallet.update({
          where: { playerId: loserId },
          data: {
            dailyLossUsed: {
              increment: wager.toString(),
            },
          },
        });
      }

      await tx.matchSettlement.create({
        data: {
          matchId: settlementId,
          winnerId,
          loserId,
          wagerAmount: wager.toString(),
          currency,
          payout: payout.toString(),
          fee: fee.toString(),
        },
      });

      await tx.auditLog.create({
        data: {
          action: "MATCH_SETTLED",
          matchId: settlementId,
          metadata: {
            winnerId,
            loserId,
            wager: wager.toString(),
            payout: payout.toString(),
            fee: fee.toString(),
            currency,
            legacyKey: !matchId,
            correlationId: getCorrelationId(),
          },
        },
      });
      metrics.counter("arcadestrike_economy_match_settlements_total", "Economy match settlements", { currency });
    });

    log.info({ winnerId, loserId, wagerAmountWei, currency, matchId: settlementId }, "Match settled");
  }

  async refundMatch(
    player1Id: string,
    player2Id: string,
    wagerAmountWei: string,
    currency: CreditType
  ): Promise<void> {
    const amount = this.parsePositiveAmount(wagerAmountWei);

    await this.serializable(async tx => {
      const playerIds = player1Id === player2Id ? [player1Id] : [player1Id, player2Id];
      await this.lockWallets(tx, playerIds);

      for (const playerId of playerIds) {
        await this.appendLedgerEntry(tx, {
          playerId,
          type: "WAGER_REFUND",
          creditType: currency,
          amount,
          metadata: { player1Id, player2Id },
        });

        if (currency === "REAL") {
          await this.releaseReservedLoss(tx, playerId, amount);
        }
      }
    });

    log.info({ player1Id, player2Id, wagerAmountWei, currency }, "Match refunded");
  }

  async getDailyLossRemaining(playerId: string): Promise<string> {
    const wallet = await this.serializable(async tx => {
      const locked = await this.lockWallet(tx, playerId);
      return this.resetDailyLossIfNeeded(tx, locked);
    });
    const consumed = BigInt(wallet.dailyLossUsed.toFixed(0)) + BigInt(wallet.dailyLossReserved.toFixed(0));
    const remaining = BigInt(DAILY_LOSS_LIMIT) - consumed;
    return remaining > 0n ? remaining.toString() : "0";
  }

  private serializable<T>(fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.db.$transaction(fn, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      maxWait: 5000,
      timeout: 10000,
    });
  }

  private async getOrCreateWallet(db: DbClient, playerId: string) {
    return db.wallet.upsert({
      where: { playerId },
      update: {},
      create: {
        playerId,
        realCredits: "0",
        promoCredits: "0",
        dailyLossUsed: "0",
        dailyLossReserved: "0",
        dailyLossDate: this.today(),
      },
    });
  }

  private async lockWallet(tx: TxClient, playerId: string) {
    await this.getOrCreateWallet(tx, playerId);
    await tx.$queryRawUnsafe(
      'SELECT "playerId" FROM "Wallet" WHERE "playerId" = $1 FOR UPDATE',
      playerId
    );
    return tx.wallet.findUniqueOrThrow({ where: { playerId } });
  }

  private async lockWallets(tx: TxClient, playerIds: string[]): Promise<void> {
    const uniqueIds = Array.from(new Set(playerIds)).sort();
    for (const playerId of uniqueIds) {
      await this.lockWallet(tx, playerId);
    }
  }

  private async resetDailyLossIfNeeded<T extends { playerId: string; dailyLossDate: string }>(
    db: DbClient,
    wallet: T
  ) {
    if (wallet.dailyLossDate === this.today()) return wallet as any;

    const updated = await db.wallet.update({
      where: { playerId: wallet.playerId },
      data: {
        dailyLossUsed: "0",
        dailyLossReserved: "0",
        dailyLossDate: this.today(),
      },
    });

    await db.auditLog.create({
      data: {
        playerId: wallet.playerId,
        action: "DAILY_LOSS_RESET",
        metadata: { date: this.today() },
      },
    });

    return updated;
  }

  private async getLedgerBalances(tx: TxClient, playerId: string): Promise<LedgerBalances> {
    const totals = await tx.ledgerEntry.groupBy({
      by: ["creditType"],
      where: { playerId },
      _sum: { amount: true },
    });

    const balances: LedgerBalances = { real: 0n, promo: 0n };
    for (const row of totals) {
      const amount = row._sum.amount ? BigInt(row._sum.amount.toFixed(0)) : 0n;
      if (row.creditType === "REAL") balances.real = amount;
      if (row.creditType === "PROMO") balances.promo = amount;
    }
    return balances;
  }

  private async appendLedgerEntry(
    tx: TxClient,
    input: {
      playerId: string;
      type: LedgerEntryType;
      creditType: LedgerCreditType;
      amount: bigint;
      matchId?: string;
      txHash?: string;
      idempotencyKey?: string;
      metadata?: Prisma.InputJsonValue;
    }
  ): Promise<void> {
    const before = await this.getLedgerBalances(tx, input.playerId);
    const beforeSelected = input.creditType === "REAL" ? before.real : before.promo;
    const afterSelected = beforeSelected + input.amount;

    if (afterSelected < 0n) {
      await this.recordFraudEvent(tx, {
        playerId: input.playerId,
        type: "INSUFFICIENT_BALANCE",
        severity: "warn",
        matchId: input.matchId,
        metadata: {
          action: input.type,
          creditType: input.creditType,
          attemptedAmount: input.amount.toString(),
          balance: beforeSelected.toString(),
        },
      });
      throw new EconomyError("INSUFFICIENT_BALANCE", "Insufficient credits for balance mutation");
    }

    const after: LedgerBalances = {
      real: input.creditType === "REAL" ? afterSelected : before.real,
      promo: input.creditType === "PROMO" ? afterSelected : before.promo,
    };

    const entry = await tx.ledgerEntry.create({
      data: {
        playerId: input.playerId,
        type: input.type,
        creditType: input.creditType,
        amount: input.amount.toString(),
        balanceAfter: afterSelected.toString(),
        matchId: input.matchId,
        txHash: input.txHash,
        idempotencyKey: input.idempotencyKey,
        metadata: input.metadata,
      },
    });

    await tx.wallet.update({
      where: { playerId: input.playerId },
      data: {
        realCredits: after.real.toString(),
        promoCredits: after.promo.toString(),
      },
    });

    await tx.auditLog.create({
      data: {
        playerId: input.playerId,
        action: "BALANCE_MUTATION",
        ledgerEntryId: entry.id,
        matchId: input.matchId,
        beforeReal: before.real.toString(),
        afterReal: after.real.toString(),
        beforePromo: before.promo.toString(),
        afterPromo: after.promo.toString(),
        metadata: {
          type: input.type,
          creditType: input.creditType,
          amount: input.amount.toString(),
          idempotencyKey: input.idempotencyKey,
          correlationId: getCorrelationId(),
        },
      },
    });
    metrics.counter("arcadestrike_ledger_entries_total", "Economy ledger entries", {
      type: input.type,
      creditType: input.creditType,
    });
  }

  private async syncWalletProjection(tx: TxClient, playerId: string) {
    const wallet = await tx.wallet.findUniqueOrThrow({ where: { playerId } });
    const balances = await this.getLedgerBalances(tx, playerId);
    const realCredits = BigInt(wallet.realCredits.toFixed(0));
    const promoCredits = BigInt(wallet.promoCredits.toFixed(0));

    if (realCredits !== balances.real || promoCredits !== balances.promo) {
      await this.recordFraudEvent(tx, {
        playerId,
        type: "LEDGER_BALANCE_MISMATCH",
        severity: "warn",
        metadata: {
          projectedReal: realCredits.toString(),
          ledgerReal: balances.real.toString(),
          projectedPromo: promoCredits.toString(),
          ledgerPromo: balances.promo.toString(),
        },
      });
    }

    return tx.wallet.update({
      where: { playerId },
      data: {
        realCredits: balances.real.toString(),
        promoCredits: balances.promo.toString(),
      },
    });
  }

  private async releaseReservedLoss(tx: TxClient, playerId: string, amount: bigint): Promise<void> {
    const wallet = await tx.wallet.findUniqueOrThrow({ where: { playerId } });
    const reserved = BigInt(wallet.dailyLossReserved.toFixed(0));
    const nextReserved = reserved > amount ? reserved - amount : 0n;
    await tx.wallet.update({
      where: { playerId },
      data: { dailyLossReserved: nextReserved.toString() },
    });
  }

  private async recordFraudEvent(
    tx: TxClient,
    input: {
      playerId?: string;
      type: FraudEventType;
      severity: "info" | "warn" | "critical";
      matchId?: string;
      withdrawalId?: string;
      metadata?: Prisma.InputJsonValue;
    }
  ): Promise<void> {
    await tx.fraudEvent.create({
      data: {
        playerId: input.playerId,
        type: input.type,
        severity: input.severity,
        matchId: input.matchId,
        withdrawalId: input.withdrawalId,
        metadata: input.metadata,
      },
    });
    metrics.counter("arcadestrike_fraud_events_total", "Economy fraud events", {
      type: input.type,
      severity: input.severity,
    });

    await tx.auditLog.create({
      data: {
        playerId: input.playerId,
        action: "FRAUD_EVENT",
        matchId: input.matchId,
        withdrawalId: input.withdrawalId,
        metadata: {
          type: input.type,
          severity: input.severity,
          ...(input.metadata && typeof input.metadata === "object" && !Array.isArray(input.metadata)
            ? input.metadata
            : {}),
        },
      },
    });

    log.warn(input, "Economy fraud event recorded");
  }

  private toPlayerWallet(wallet: {
    playerId: string;
    realCredits: Prisma.Decimal;
    promoCredits: Prisma.Decimal;
    dailyLossUsed: Prisma.Decimal;
    dailyLossDate: string;
  }): PlayerWallet {
    return {
      playerId: wallet.playerId,
      realCredits: wallet.realCredits.toFixed(0),
      promoCredits: wallet.promoCredits.toFixed(0),
      dailyLossUsed: wallet.dailyLossUsed.toFixed(0),
      dailyLossDate: wallet.dailyLossDate,
    };
  }

  private parsePositiveAmount(amountWei: string): bigint {
    if (!/^\d+$/.test(amountWei)) {
      throw new EconomyError("INVALID_WAGER", "Amount must be an unsigned integer string");
    }
    const amount = BigInt(amountWei);
    if (amount <= 0n) {
      throw new EconomyError("INVALID_WAGER", "Amount must be greater than zero");
    }
    return amount;
  }

  private normalizeIdempotencyKey(idempotencyKey: string | undefined, fallback: string): string {
    const key = idempotencyKey?.trim() || fallback;
    return key.slice(0, 191);
  }

  private today(): string {
    return new Date().toISOString().slice(0, 10);
  }
}

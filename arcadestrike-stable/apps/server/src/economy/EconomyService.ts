/**
 * Economy Service — wallet operations with double-entry ledger.
 * All mutations go through this service for auditability.
 */
import { Decimal } from '@prisma/client/runtime/library';
import { getPrisma } from '../db/prisma';
import { logger } from '../utils/logger';
import type { LedgerCreditType, LedgerEntryType } from '@prisma/client';

export interface WalletBalance {
  realCredits:  bigint;
  promoCredits: bigint;
}

function d(v: bigint): Decimal {
  return new Decimal(v.toString());
}

export const economyService = {
  /**
   * Get or create wallet for player.
   */
  async getOrCreateWallet(playerId: string): Promise<WalletBalance> {
    const prisma = getPrisma();
    const today  = new Date().toISOString().slice(0, 10);

    const wallet = await prisma.wallet.upsert({
      where:  { playerId },
      update: {},
      create: { playerId, dailyLossDate: today },
    });

    return {
      realCredits:  BigInt(wallet.realCredits.toString()),
      promoCredits: BigInt(wallet.promoCredits.toString()),
    };
  },

  /**
   * Credit player wallet.
   */
  async credit(
    playerId:      string,
    amount:        bigint,
    creditType:    LedgerCreditType,
    entryType:     LedgerEntryType,
    idempotencyKey?: string,
    metadata?:     Record<string, unknown>,
  ): Promise<void> {
    const prisma = getPrisma();
    const field  = creditType === 'REAL' ? 'realCredits' : 'promoCredits';

    await prisma.$transaction(async (tx) => {
      const wallet = await tx.wallet.update({
        where: { playerId },
        data:  { [field]: { increment: d(amount) } },
      });

      const balance = BigInt(
        (creditType === 'REAL' ? wallet.realCredits : wallet.promoCredits).toString()
      );

      await tx.ledgerEntry.create({
        data: {
          playerId,
          type:          entryType,
          creditType,
          amount:        d(amount),
          balanceAfter:  d(balance),
          idempotencyKey,
          metadata:      metadata ? (metadata as any) : undefined,
        },
      });
    });
  },

  /**
   * Debit player wallet — throws if insufficient balance.
   */
  async debit(
    playerId:      string,
    amount:        bigint,
    creditType:    LedgerCreditType,
    entryType:     LedgerEntryType,
    idempotencyKey?: string,
    metadata?:     Record<string, unknown>,
  ): Promise<void> {
    const prisma = getPrisma();
    const field  = creditType === 'REAL' ? 'realCredits' : 'promoCredits';

    await prisma.$transaction(async (tx) => {
      const wallet = await tx.wallet.findUniqueOrThrow({ where: { playerId } });
      const current = BigInt((creditType === 'REAL' ? wallet.realCredits : wallet.promoCredits).toString());

      if (current < amount) {
        throw new Error(`Insufficient ${creditType} balance: have ${current}, need ${amount}`);
      }

      const updated = await tx.wallet.update({
        where: { playerId },
        data:  { [field]: { decrement: d(amount) } },
      });

      const balance = BigInt(
        (creditType === 'REAL' ? updated.realCredits : updated.promoCredits).toString()
      );

      await tx.ledgerEntry.create({
        data: {
          playerId,
          type:          entryType,
          creditType,
          amount:        d(amount),
          balanceAfter:  d(balance),
          idempotencyKey,
          metadata:      metadata ? (metadata as any) : undefined,
        },
      });
    });
  },

  /**
   * Settle a match — pays winner, records loss for loser.
   */
  async settleMatch(params: {
    matchId:    string;
    winnerId:   string;
    loserId:    string;
    wager:      bigint;
    creditType: LedgerCreditType;
  }): Promise<void> {
    const { matchId, winnerId, loserId, wager, creditType } = params;
    const prisma = getPrisma();

    const FEE_BPS = 250n; // 2.5%
    const fee     = (wager * FEE_BPS) / 10_000n;
    const payout  = wager - fee;

    await prisma.$transaction(async (tx) => {
      // Idempotency check
      const existing = await tx.matchSettlement.findUnique({ where: { matchId } });
      if (existing) {
        logger.warn({ matchId }, '[Economy] match already settled — skipping');
        return;
      }

      // Debit loser
      await tx.wallet.update({
        where: { playerId: loserId },
        data:  { [creditType === 'REAL' ? 'realCredits' : 'promoCredits']: { decrement: d(wager) } },
      });

      // Credit winner
      await tx.wallet.update({
        where: { playerId: winnerId },
        data:  { [creditType === 'REAL' ? 'realCredits' : 'promoCredits']: { increment: d(payout) } },
      });

      // Record settlement
      await tx.matchSettlement.create({
        data: { matchId, winnerId, loserId, wagerAmount: d(wager), currency: creditType, payout: d(payout), fee: d(fee) },
      });

      logger.info({ matchId, winnerId, payout: payout.toString(), fee: fee.toString() }, '[Economy] match settled');
    });
  },
};

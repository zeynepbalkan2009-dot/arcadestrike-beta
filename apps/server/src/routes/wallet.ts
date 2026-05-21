/**
 * Wallet Routes — balance, deposit, withdraw, payout, ads
 */
import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { rateLimitApi, rateLimitPayout } from "../middleware/rateLimit";
import { EconomyError, EconomyService } from "../economy/EconomyService";
import { createLogger } from "../utils/logger";
import { WithdrawalQueue } from "../withdrawals/WithdrawalQueue";
import { ethers } from "ethers";

const log = createLogger("routes/wallet");
const economy = new EconomyService();
const withdrawalQueue = new WithdrawalQueue();

// Promo credit per ad view (in wei — $0.10 equivalent)
const AD_PROMO_REWARD = ethers.parseEther("0.1").toString();
// Minimum withdrawal
const MIN_WITHDRAWAL = ethers.parseEther("5").toString();

export function createWalletRouter(): Router {
  const router = Router();

  /** Get full wallet status */
  router.get("/", requireAuth, rateLimitApi, async (req, res) => {
    try {
      const wallet = await economy.getWallet(req.auth!.playerId);
      const dailyRemaining = await economy.getDailyLossRemaining(req.auth!.playerId);
      res.json({ wallet, dailyLossRemaining: dailyRemaining });
    } catch (err) {
      log.error({ err }, "Failed to fetch wallet");
      res.status(500).json({ error: "Internal error" });
    }
  });

  /**
   * Confirm on-chain deposit and credit account.
   * Client calls this after deposit tx confirms on-chain.
   * Server verifies the tx before crediting.
   */
  router.post("/deposit/confirm", requireAuth, rateLimitApi, async (req, res) => {
    const { txHash } = req.body;
    if (!txHash || typeof txHash !== "string") {
      return res.status(400).json({ error: "Missing txHash" });
    }

    try {
      // Verify transaction on-chain before crediting
      const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
      const receipt = await provider.getTransactionReceipt(txHash);

      if (!receipt || receipt.status !== 1) {
        return res.status(400).json({ error: "Transaction not confirmed or failed" });
      }

      // TODO: Parse the MatchCreated/Deposit event to get exact amount
      // For now, parse from request body (validated server-side in production)
      const { amountWei } = req.body;
      if (!amountWei) return res.status(400).json({ error: "Missing amountWei" });

      const wallet = await economy.depositReal(req.auth!.playerId, amountWei, txHash);
      log.info({ playerId: req.auth!.playerId, amountWei, txHash }, "Deposit confirmed");
      res.json({ wallet });

    } catch (err) {
      log.error({ err }, "Deposit confirmation failed");
      res.status(500).json({ error: "Deposit confirmation failed" });
    }
  });

  /**
   * Request withdrawal of real credits.
   * Triggers on-chain transfer from treasury to player address.
   */
  router.post("/withdraw", requireAuth, rateLimitPayout, async (req, res) => {
    const { amountWei, toAddress, idempotencyKey: bodyIdempotencyKey } = req.body;
    const idempotencyKey = req.get("Idempotency-Key") || bodyIdempotencyKey;

    if (!amountWei || !toAddress) {
      return res.status(400).json({ error: "Missing amountWei or toAddress" });
    }

    if (typeof amountWei !== "string" || !/^\d+$/.test(amountWei)) {
      return res.status(400).json({ error: "amountWei must be an unsigned integer string" });
    }

    if (!ethers.isAddress(toAddress)) {
      return res.status(400).json({ error: "Invalid Ethereum address" });
    }

    if (BigInt(amountWei) < BigInt(MIN_WITHDRAWAL)) {
      return res.status(400).json({
        error: `Minimum withdrawal is ${ethers.formatEther(MIN_WITHDRAWAL)} MATIC`,
      });
    }

    try {
      const withdrawal = await economy.withdrawReal(
        req.auth!.playerId,
        amountWei,
        toAddress,
        typeof idempotencyKey === "string" ? idempotencyKey : undefined
      );

      // TODO: Trigger on-chain treasury transfer
      // In production: queue this for treasury multi-sig or automated payout contract
      await withdrawalQueue.enqueue(withdrawal.withdrawalId);
      log.info({
        playerId: req.auth!.playerId,
        amountWei,
        toAddress,
        withdrawalId: withdrawal.withdrawalId,
        idempotencyKey,
      }, "Withdrawal queued");

      res.json({
        success: true,
        message: "Withdrawal queued — funds will arrive within 24 hours",
        withdrawalId: withdrawal.withdrawalId,
        remainingBalance: withdrawal.wallet.realCredits,
      });
    } catch (err) {
      log.error({ err }, "Withdrawal failed");
      if (err instanceof EconomyError) {
        return res.status(400).json({ error: err.message, code: err.code });
      }
      res.status(500).json({ error: "Withdrawal failed" });
    }
  });

  /**
   * Record ad view and award promo credits.
   * In production: validate ad impression receipt from ad network SDK.
   */
  router.post("/ads/complete", requireAuth, rateLimitApi, async (req, res) => {
    const { adId, impressionToken } = req.body;

    // TODO: Validate impression token with ad network (Google AdMob / Unity Ads)
    if (!adId) return res.status(400).json({ error: "Missing adId" });

    try {
      const wallet = await economy.awardPromo(req.auth!.playerId, AD_PROMO_REWARD);
      log.info({ playerId: req.auth!.playerId, adId }, "Promo credit awarded for ad view");
      res.json({
        wallet,
        awarded: AD_PROMO_REWARD,
        message: `+$${ethers.formatEther(AD_PROMO_REWARD)} promo credit added`,
      });
    } catch (err) {
      res.status(500).json({ error: "Failed to award promo credit" });
    }
  });

  return router;
}

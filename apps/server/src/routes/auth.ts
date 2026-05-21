/**
 * Auth Routes
 *
 * Flow for wallet-based auth (EIP-4361 "Sign In With Ethereum"):
 *   1. GET  /api/auth/nonce?address=0x...   → returns {nonce}
 *   2. POST /api/auth/verify                → {address, signature, nonce} → {token}
 *   3. Client uses JWT Bearer token for all subsequent requests
 *
 * For embedded wallets (no MetaMask):
 *   POST /api/auth/embedded  → {playerId} → {token}  (dev/demo only)
 */
import { Router } from "express";
import { ethers } from "ethers";
import { issueToken } from "../middleware/auth";
import { rateLimitAuth } from "../middleware/rateLimit";
import { createLogger } from "../utils/logger";
import { nanoid } from "nanoid";

const log = createLogger("routes/auth");

// In-memory nonce store (Redis in production)
const nonces = new Map<string, { nonce: string; expiresAt: number }>();

export function createAuthRouter(): Router {
  const router = Router();

  /** Step 1: Get a sign-in nonce for an address */
  router.get("/nonce", rateLimitAuth, (req, res) => {
    const address = (req.query.address as string)?.toLowerCase();
    if (!address || !ethers.isAddress(address)) {
      return res.status(400).json({ error: "Invalid address" });
    }

    const nonce = nanoid(32);
    nonces.set(address, { nonce, expiresAt: Date.now() + 5 * 60_000 }); // 5 min TTL

    res.json({
      nonce,
      message: buildSiweMessage(address, nonce),
    });
  });

  /** Step 2: Verify signature and issue JWT */
  router.post("/verify", rateLimitAuth, async (req, res) => {
    const { address, signature, nonce } = req.body;

    if (!address || !signature || !nonce) {
      return res.status(400).json({ error: "Missing address, signature, or nonce" });
    }

    const normalizedAddress = address.toLowerCase();
    const stored = nonces.get(normalizedAddress);

    if (!stored || stored.nonce !== nonce || Date.now() > stored.expiresAt) {
      return res.status(401).json({ error: "Invalid or expired nonce" });
    }

    try {
      const message = buildSiweMessage(normalizedAddress, nonce);
      const recoveredAddress = ethers.verifyMessage(message, signature).toLowerCase();

      if (recoveredAddress !== normalizedAddress) {
        return res.status(401).json({ error: "Signature verification failed" });
      }

      // Nonce consumed — one-time use
      nonces.delete(normalizedAddress);

      // playerId is derived deterministically from address
      const playerId = `eth_${normalizedAddress.slice(2, 10)}`;
      const token = issueToken(playerId, address);

      log.info({ playerId, address }, "Wallet auth successful");
      res.json({ token, playerId, address });

    } catch (err) {
      log.error({ err }, "Signature verification error");
      res.status(401).json({ error: "Verification failed" });
    }
  });

  /** Embedded wallet auth (no external wallet required) */
  router.post("/embedded", rateLimitAuth, (req, res) => {
    if (process.env.NODE_ENV === "production") {
      // In production, embedded wallet auth uses server-generated keys
      // This endpoint is for dev/demo only
      return res.status(403).json({ error: "Use wallet auth in production" });
    }

    const playerId = req.body.playerId || `anon_${nanoid(8)}`;
    const token = issueToken(playerId);
    res.json({ token, playerId });
  });

  return router;
}

function buildSiweMessage(address: string, nonce: string): string {
  const domain = process.env.CLIENT_ORIGIN || "localhost";
  return [
    `${domain} wants you to sign in with your Ethereum account:`,
    address,
    "",
    "Sign in to ArcadeStrike",
    "",
    `URI: ${process.env.CLIENT_ORIGIN || "http://localhost:5173"}`,
    "Version: 1",
    "Chain ID: 137",
    `Nonce: ${nonce}`,
    `Issued At: ${new Date().toISOString()}`,
    `Expiration Time: ${new Date(Date.now() + 5 * 60_000).toISOString()}`,
  ].join("\n");
}

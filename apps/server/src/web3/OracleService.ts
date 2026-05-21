/**
 * OracleService — signs match results with the server's private key.
 * The signature is used on-chain to settle the escrow contract
 * without admin transactions.
 *
 * Key management: in production, use a KMS (AWS KMS, HashiCorp Vault)
 * to sign — never store raw private keys on the server disk.
 */
import { ethers } from "ethers";
import { GAME_CONSTANTS as C } from "@arcadestrike/shared";
import type { OracleSignatureRequest, OracleResult, PayoutInfo } from "@arcadestrike/shared";
import { createLogger } from "../utils/logger";

const log = createLogger("OracleService");

const RESULT_TYPEHASH = ethers.keccak256(
  ethers.toUtf8Bytes(
    "MatchResult(bytes32 matchId,address winner,address loser,uint256 wagerAmount,bytes32 nonce)"
  )
);

export class OracleService {
  private signer: ethers.Wallet;
  private provider: ethers.JsonRpcProvider;
  private escrowAddress: string;
  private domainSeparator: string | null = null;

  constructor() {
    if (!process.env.ORACLE_PRIVATE_KEY) {
      throw new Error("ORACLE_PRIVATE_KEY not set");
    }
    this.provider = new ethers.JsonRpcProvider(process.env.RPC_URL || "https://polygon-rpc.com");
    this.signer = new ethers.Wallet(process.env.ORACLE_PRIVATE_KEY, this.provider);
    this.escrowAddress = process.env.ESCROW_ADDRESS || "";
    log.info({ address: this.signer.address }, "Oracle signer initialized");
  }

  async signMatchResult(params: {
    matchId: string;
    winnerId: string;   // Ethereum address
    loserId: string;
    wagerAmount: string;
  }): Promise<{ request: OracleSignatureRequest; payout: PayoutInfo; signature: string }> {
    const nonce = ethers.randomBytes(32);
    const nonceHex = ethers.hexlify(nonce);
    const matchIdBytes = ethers.keccak256(ethers.toUtf8Bytes(params.matchId));

    // EIP-712 domain separator (fetched once from contract)
    if (!this.domainSeparator) {
      this.domainSeparator = await this.fetchDomainSeparator();
    }

    const structHash = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["bytes32", "bytes32", "address", "address", "uint256", "bytes32"],
        [RESULT_TYPEHASH, matchIdBytes, params.winnerId, params.loserId, params.wagerAmount, nonceHex]
      )
    );

    const digest = ethers.keccak256(
      ethers.concat([
        ethers.toUtf8Bytes("\x19\x01"),
        this.domainSeparator!,
        structHash,
      ])
    );

    const signature = await this.signer.signMessage(ethers.getBytes(digest));

    log.info({ matchId: params.matchId, winner: params.winnerId }, "Match result signed");

    const wager = BigInt(params.wagerAmount);
    const totalPot = wager * 2n;
    const fee = (totalPot * BigInt(C.FEE_TOTAL_BPS)) / 10000n;
    const treasury = (totalPot * BigInt(C.FEE_TREASURY_BPS)) / 10000n;
    const burn = fee - treasury;

    const request: OracleSignatureRequest = {
      matchId: params.matchId,
      winnerId: params.winnerId,
      loserId: params.loserId,
      wagerAmount: params.wagerAmount,
      nonce: nonceHex,
    };

    const payout: PayoutInfo = {
      gross: totalPot.toString(),
      fee: fee.toString(),
      net: (totalPot - fee).toString(),
      treasury: treasury.toString(),
      burn: burn.toString(),
    };

    return { request, payout, signature };
  }

  private async fetchDomainSeparator(): Promise<string> {
    if (!this.escrowAddress) return ethers.ZeroHash;
    try {
      const abi = ["function domainSeparator() view returns (bytes32)"];
      const contract = new ethers.Contract(this.escrowAddress, abi, this.provider);
      return await contract.domainSeparator();
    } catch {
      log.warn("Could not fetch domain separator from contract");
      return ethers.ZeroHash;
    }
  }
}

/**
 * WalletManager
 *
 * Singleton. Manages all Web3 wallet interactions.
 *
 * Priority:
 *  1. Embedded wallet (no extension needed — best UX)
 *  2. MetaMask / injected provider
 *  3. WalletConnect (mobile deeplinks)
 *
 * Responsibilities:
 *  - Connect / disconnect
 *  - Sign SIWE (Sign In With Ethereum) messages for auth
 *  - Read balances (native + ERC-20 token)
 *  - Approve ERC-20 spend for escrow
 *  - Get/create embedded wallet key (localStorage-backed in dev,
 *    TEE-backed in production via Privy/Dynamic/Turnkey)
 */
import { ethers } from "ethers";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:2567";
const TOKEN_ADDRESS = import.meta.env.VITE_TOKEN_ADDRESS || "";
const ESCROW_ADDRESS = import.meta.env.VITE_ESCROW_ADDRESS || "";
const CHAIN_ID = parseInt(import.meta.env.VITE_CHAIN_ID || "137"); // Polygon

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
];

export class WalletManager {
  private static instance: WalletManager | null = null;

  private provider:   ethers.BrowserProvider | ethers.JsonRpcProvider | null = null;
  private signer:     ethers.Signer | null = null;
  private address:    string = "";
  private authToken:  string = "";
  private isEmbedded: boolean = false;

  private constructor() {
    // Restore persisted session
    this.authToken = localStorage.getItem("arcadestrike_token") || "";
    this.address   = localStorage.getItem("arcadestrike_address") || "";
  }

  static getInstance(): WalletManager {
    if (!WalletManager.instance) WalletManager.instance = new WalletManager();
    return WalletManager.instance;
  }

  isConnected(): boolean {
    return !!this.address && !!this.authToken;
  }

  getAddress(): string { return this.address; }
  getToken(): string   { return this.authToken; }

  shortAddress(): string {
    if (!this.address) return "";
    return `${this.address.slice(0, 6)}…${this.address.slice(-4)}`;
  }

  // ─── Connection ─────────────────────────────────────────────

  /**
   * Connect wallet. Tries in order:
   *  1. MetaMask / injected
   *  2. WalletConnect (if WC provider configured)
   *  3. Embedded (auto-created dev key)
   */
  async connect(): Promise<string> {
    if ((window as any).ethereum) {
      return this.connectInjected();
    }
    return this.connectEmbedded();
  }

  async connectInjected(): Promise<string> {
    if (!(window as any).ethereum) throw new Error("No injected wallet found");

    this.provider = new ethers.BrowserProvider((window as any).ethereum);
    await this.provider.send("eth_requestAccounts", []);

    // Ensure correct chain
    await this.ensureChain();

    this.signer  = await this.provider.getSigner();
    this.address = await this.signer.getAddress();
    this.isEmbedded = false;

    await this.authenticate();
    return this.address;
  }

  /**
   * Embedded wallet: generates a random key stored in localStorage.
   * In production: replace with Privy / Dynamic / Turnkey for secure key custody.
   */
  async connectEmbedded(): Promise<string> {
    let privKey = localStorage.getItem("arcadestrike_embedded_pk");
    if (!privKey) {
      privKey = ethers.hexlify(ethers.randomBytes(32));
      localStorage.setItem("arcadestrike_embedded_pk", privKey);
    }

    const wallet = new ethers.Wallet(privKey);
    this.signer    = wallet;
    this.address   = wallet.address;
    this.isEmbedded = true;

    await this.authenticate();
    return this.address;
  }

  disconnect(): void {
    this.provider  = null;
    this.signer    = null;
    this.address   = "";
    this.authToken = "";
    this.isEmbedded = false;
    localStorage.removeItem("arcadestrike_token");
    localStorage.removeItem("arcadestrike_address");
  }

  // ─── Authentication (SIWE) ──────────────────────────────────

  async authenticate(): Promise<string> {
    if (!this.signer || !this.address) throw new Error("Wallet not connected");

    // 1. Get nonce
    const nonceRes = await fetch(`${API_BASE}/api/auth/nonce?address=${this.address}`);
    if (!nonceRes.ok) throw new Error("Failed to get nonce");
    const { nonce, message } = await nonceRes.json();

    // 2. Sign message
    const signature = await this.signer.signMessage(message);

    // 3. Verify + get JWT
    const verifyRes = await fetch(`${API_BASE}/api/auth/verify`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ address: this.address, signature, nonce }),
    });
    if (!verifyRes.ok) {
      const err = await verifyRes.json();
      throw new Error(err.error || "Authentication failed");
    }

    const { token, playerId } = await verifyRes.json();
    this.authToken = token;

    localStorage.setItem("arcadestrike_token", token);
    localStorage.setItem("arcadestrike_address", this.address);

    return token;
  }

  // ─── Balances ───────────────────────────────────────────────

  async getNativeBalance(): Promise<string> {
    if (!this.provider || !this.address) return "0";
    const bal = await this.provider.getBalance(this.address);
    return bal.toString();
  }

  async getTokenBalance(): Promise<string> {
    if (!this.provider || !TOKEN_ADDRESS || !this.address) return "0";
    const contract = new ethers.Contract(TOKEN_ADDRESS, ERC20_ABI, this.provider);
    const bal = await contract.balanceOf(this.address);
    return bal.toString();
  }

  async getOffchainBalance(): Promise<{ real: string; promo: string }> {
    if (!this.authToken) return { real: "0", promo: "0" };
    const res = await fetch(`${API_BASE}/api/wallet`, {
      headers: { Authorization: `Bearer ${this.authToken}` },
    });
    if (!res.ok) return { real: "0", promo: "0" };
    const { wallet } = await res.json();
    return { real: wallet.realCredits, promo: wallet.promoCredits };
  }

  // ─── Escrow helpers ─────────────────────────────────────────

  /**
   * Approve ERC-20 spend for escrow contract.
   * Only needed for token-based wagers (not native MATIC).
   */
  async approveERC20ForEscrow(amountWei: string): Promise<string> {
    if (!this.signer || !TOKEN_ADDRESS || !ESCROW_ADDRESS) {
      throw new Error("Signer or contract addresses not configured");
    }
    const contract = new ethers.Contract(TOKEN_ADDRESS, ERC20_ABI, this.signer);
    const current  = await contract.allowance(this.address, ESCROW_ADDRESS);

    if (BigInt(current.toString()) >= BigInt(amountWei)) {
      return "already_approved"; // No tx needed
    }

    const tx = await contract.approve(ESCROW_ADDRESS, amountWei);
    const receipt = await tx.wait();
    return receipt.hash;
  }

  /**
   * Sign and broadcast a raw transaction prepared by the server
   * (e.g., createMatch / joinMatch on the escrow contract).
   */
  async sendPreparedTx(txData: {
    to: string;
    data: string;
    value: string;
  }): Promise<string> {
    if (!this.signer) throw new Error("Wallet not connected");

    const tx = await this.signer.sendTransaction({
      to:    txData.to,
      data:  txData.data,
      value: BigInt(txData.value),
    });

    const receipt = await tx.wait();
    if (!receipt || receipt.status !== 1) throw new Error("Transaction failed");
    return receipt.hash;
  }

  // ─── Chain management ────────────────────────────────────────

  private async ensureChain(): Promise<void> {
    if (!this.provider) return;
    const network = await this.provider.getNetwork();
    if (Number(network.chainId) !== CHAIN_ID) {
      try {
        await (this.provider as ethers.BrowserProvider).send("wallet_switchEthereumChain", [
          { chainId: `0x${CHAIN_ID.toString(16)}` },
        ]);
      } catch (err: any) {
        if (err.code === 4902) {
          // Chain not added — add Polygon
          await (this.provider as ethers.BrowserProvider).send("wallet_addEthereumChain", [{
            chainId:          `0x${CHAIN_ID.toString(16)}`,
            chainName:        "Polygon",
            nativeCurrency:   { name: "MATIC", symbol: "MATIC", decimals: 18 },
            rpcUrls:          ["https://polygon-rpc.com"],
            blockExplorerUrls:["https://polygonscan.com"],
          }]);
        }
      }
    }
  }
}

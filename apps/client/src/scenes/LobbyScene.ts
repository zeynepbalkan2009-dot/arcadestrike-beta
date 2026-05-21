/**
 * LobbyScene — main menu: wallet connect, wager selection, queue join.
 */
import Phaser from "phaser";
import { WalletManager } from "../web3/WalletManager";
import { NetworkManager } from "../network/NetworkManager";
import { GAME_CONSTANTS as C } from "@arcadestrike/shared";

const WAGER_OPTIONS = ["0.5", "1", "5", "10", "25"];

export class LobbyScene extends Phaser.Scene {
  private wallet!: WalletManager;
  private network!: NetworkManager;
  private selectedWager = "1";
  private selectedCurrency: "REAL" | "PROMO" = "REAL";
  private wagerButtons: Phaser.GameObjects.Container[] = [];

  constructor() { super({ key: "LobbyScene" }); }

  create(): void {
    this.wallet  = WalletManager.getInstance();
    this.network = NetworkManager.getInstance();

    this.drawBackground();
    this.drawLogo();
    this.drawWagerSelector();
    this.drawCurrencyToggle();
    this.drawPlayButton();
    this.drawWalletSection();
    this.drawStats();
  }

  private drawBackground(): void {
    const { width, height } = this.scale;
    // Dark gradient panels
    const bg = this.add.rectangle(0, 0, width, height, 0x0a0a0f).setOrigin(0);
    // Grid lines for neon aesthetic
    const g = this.add.graphics();
    g.lineStyle(1, 0x00ff8820, 1);
    for (let x = 0; x < width; x += 40) g.lineBetween(x, 0, x, height);
    for (let y = 0; y < height; y += 40) g.lineBetween(0, y, width, y);
  }

  private drawLogo(): void {
    const cx = this.scale.width / 2;
    this.add.text(cx, 50, "⚡ ARCADESTRIKE", {
      fontSize: "36px",
      color: "#00ff88",
      fontFamily: "Courier New",
      stroke: "#005533",
      strokeThickness: 4,
    }).setOrigin(0.5);

    this.add.text(cx, 85, "1v1 PvP · Wager · Win · Repeat", {
      fontSize: "14px",
      color: "#888888",
      fontFamily: "Courier New",
    }).setOrigin(0.5);
  }

  private drawWagerSelector(): void {
    const cx = this.scale.width / 2;
    const baseY = 150;

    this.add.text(cx, baseY, "SELECT WAGER", {
      fontSize: "13px", color: "#888", fontFamily: "Courier New",
    }).setOrigin(0.5);

    const totalWidth = WAGER_OPTIONS.length * 70;
    const startX = cx - totalWidth / 2 + 35;

    WAGER_OPTIONS.forEach((amount, i) => {
      const x = startX + i * 70;
      const container = this.add.container(x, baseY + 35);

      const bg = this.add.rectangle(0, 0, 60, 36,
        amount === this.selectedWager ? 0x00ff88 : 0x1a1a2e
      ).setStrokeStyle(1, 0x00ff88);

      const text = this.add.text(0, 0, `$${amount}`, {
        fontSize: "13px",
        color: amount === this.selectedWager ? "#000000" : "#00ff88",
        fontFamily: "Courier New",
      }).setOrigin(0.5);

      container.add([bg, text]);
      container.setInteractive(new Phaser.Geom.Rectangle(-30, -18, 60, 36), Phaser.Geom.Rectangle.Contains);
      container.on("pointerdown", () => this.selectWager(amount));
      container.on("pointerover", () => { if (amount !== this.selectedWager) bg.setFillStyle(0x1a2a1a); });
      container.on("pointerout",  () => { if (amount !== this.selectedWager) bg.setFillStyle(0x1a1a2e); });

      this.wagerButtons.push(container);
    });
  }

  private selectWager(amount: string): void {
    this.selectedWager = amount;
    // Refresh button states
    this.scene.restart();
  }

  private drawCurrencyToggle(): void {
    const cx = this.scale.width / 2;

    this.add.text(cx - 50, 220, "REAL $", {
      fontSize: "13px",
      color: this.selectedCurrency === "REAL" ? "#00ff88" : "#555",
      fontFamily: "Courier New",
    }).setOrigin(0.5).setInteractive().on("pointerdown", () => {
      this.selectedCurrency = "REAL";
      this.scene.restart();
    });

    this.add.text(cx + 50, 220, "PROMO 🎁", {
      fontSize: "13px",
      color: this.selectedCurrency === "PROMO" ? "#ffaa00" : "#555",
      fontFamily: "Courier New",
    }).setOrigin(0.5).setInteractive().on("pointerdown", () => {
      this.selectedCurrency = "PROMO";
      this.scene.restart();
    });

    if (this.selectedCurrency === "PROMO") {
      this.add.text(cx, 240, "Promo credits are non-withdrawable", {
        fontSize: "10px", color: "#ffaa0088", fontFamily: "Courier New",
      }).setOrigin(0.5);
    }
  }

  private drawPlayButton(): void {
    const cx = this.scale.width / 2;

    const btn = this.add.container(cx, 290);
    const bg = this.add.rectangle(0, 0, 200, 48, 0x00ff88).setStrokeStyle(2, 0xffffff);
    const text = this.add.text(0, 0, "▶  FIND MATCH", {
      fontSize: "16px", color: "#000000", fontFamily: "Courier New", fontStyle: "bold",
    }).setOrigin(0.5);
    btn.add([bg, text]);
    btn.setInteractive(new Phaser.Geom.Rectangle(-100, -24, 200, 48), Phaser.Geom.Rectangle.Contains);

    btn.on("pointerdown", () => this.joinQueue());
    btn.on("pointerover", () => bg.setFillStyle(0x00cc66));
    btn.on("pointerout",  () => bg.setFillStyle(0x00ff88));

    // Pulse animation
    this.tweens.add({
      targets: btn,
      scaleX: 1.03, scaleY: 1.03,
      yoyo: true, repeat: -1, duration: 800, ease: "Sine.InOut",
    });
  }

  private drawWalletSection(): void {
    const cx = this.scale.width / 2;
    const isConnected = this.wallet.isConnected();

    const btn = this.add.text(
      cx, 360,
      isConnected ? `🔗 ${this.wallet.shortAddress()}` : "🔗 Connect Wallet",
      { fontSize: "12px", color: isConnected ? "#00ff88" : "#888", fontFamily: "Courier New" }
    ).setOrigin(0.5).setInteractive();

    btn.on("pointerdown", () => {
      if (!isConnected) this.wallet.connect().then(() => this.scene.restart());
    });
  }

  private drawStats(): void {
    const cy = this.scale.height - 30;
    this.add.text(20, cy, "WIN RATE: -- | STREAK: -- | ELO: 1200", {
      fontSize: "11px", color: "#444", fontFamily: "Courier New",
    });
  }

  private async joinQueue(): Promise<void> {
    const wagerWei = BigInt(Math.floor(parseFloat(this.selectedWager) * 1e18)).toString();

    this.scene.start("QueueScene", {
      wagerAmount: wagerWei,
      wagerDisplay: this.selectedWager,
      currency: this.selectedCurrency,
    });
  }
}

/**
 * LobbyScene - arcade cabinet style fighter, arena, wager, and queue entry.
 */
import Phaser from "phaser";
import { WalletManager } from "../web3/WalletManager";
import { NetworkManager } from "../network/NetworkManager";
import {
  ARENAS,
  DEFAULT_ARENA_ID,
  DEFAULT_FIGHTER_ID,
  FIGHTERS,
  SELECTED_ARENA_KEY,
  SELECTED_FIGHTER_KEY,
  getArena,
  getFighter,
  type ArenaId,
  type FighterId,
} from "../game/CanonContent";

const WAGER_OPTIONS = ["0.5", "1", "5", "10", "25"];

export class LobbyScene extends Phaser.Scene {
  private wallet!: WalletManager;
  private network!: NetworkManager;
  private selectedWager = "1";
  private selectedCurrency: "REAL" | "PROMO" = "REAL";
  private selectedFighter: FighterId = DEFAULT_FIGHTER_ID;
  private selectedArena: ArenaId = DEFAULT_ARENA_ID;
  private statusToast?: Phaser.GameObjects.Text;

  constructor() { super({ key: "LobbyScene" }); }

  create(): void {
    this.wallet = WalletManager.getInstance();
    this.network = NetworkManager.getInstance();
    this.selectedFighter = (localStorage.getItem(SELECTED_FIGHTER_KEY) as FighterId) || DEFAULT_FIGHTER_ID;
    this.selectedArena = (localStorage.getItem(SELECTED_ARENA_KEY) as ArenaId) || DEFAULT_ARENA_ID;

    this.drawBackground();
    this.drawHeader();
    this.drawFighterSelect();
    this.drawArenaSelect();
    this.drawEconomyPanel();
    this.drawPlayButton();
    this.drawFooter();
  }

  private drawBackground(): void {
    const { width, height } = this.scale;
    const arena = getArena(this.selectedArena);
    this.add.image(width / 2, height / 2, `arena_${arena.id}`)
      .setDisplaySize(width, height)
      .setAlpha(0.55);

    const g = this.add.graphics();
    g.fillGradientStyle(0x060612, 0x060612, 0x101026, 0x060612, 0.95);
    g.fillRect(0, 0, width, height);
    g.lineStyle(1, arena.palette.neonA, 0.14);
    for (let x = 0; x < width; x += 42) g.lineBetween(x, 0, x + 70, height);
    for (let y = 0; y < height; y += 42) g.lineBetween(0, y, width, y);

    this.add.rectangle(width / 2, 34, width - 70, 56, 0x101032, 0.96)
      .setStrokeStyle(3, arena.palette.neonA, 0.95);
  }

  private drawHeader(): void {
    const cx = this.scale.width / 2;
    this.add.text(cx, 28, "ARCADESTRIKE", {
      fontSize: "34px",
      color: "#ffffff",
      fontFamily: "Courier New",
      stroke: "#000000",
      strokeThickness: 7,
    }).setOrigin(0.5);

    this.add.text(cx, 60, "UNDERGROUND NEON PVP TOURNAMENT", {
      fontSize: "11px",
      color: "#34f7ff",
      fontFamily: "Courier New",
    }).setOrigin(0.5);
  }

  private drawFighterSelect(): void {
    const { width } = this.scale;
    const y = 128;
    this.add.text(24, 92, "FIGHTER SELECT", {
      fontSize: "13px",
      color: "#ffffff",
      fontFamily: "Courier New",
      stroke: "#000",
      strokeThickness: 4,
    });

    const cardW = Math.min(150, (width - 64) / FIGHTERS.length - 6);
    const startX = 28 + cardW / 2;
    FIGHTERS.forEach((fighter, index) => {
      const selected = fighter.id === this.selectedFighter;
      const x = startX + index * (cardW + 8);
      const card = this.add.container(x, y);
      const bg = this.add.rectangle(0, 0, cardW, 116, selected ? 0x1d203b : 0x0d0d1c, 0.96)
        .setStrokeStyle(selected ? 3 : 1, selected ? fighter.palette.glow : 0x335577, selected ? 1 : 0.7);
      const portrait = this.add.image(0, -16, `portrait_${fighter.id}`).setDisplaySize(cardW - 10, 70);
      const name = this.add.text(0, 32, fighter.name.toUpperCase(), {
        fontSize: "10px",
        color: "#ffffff",
        fontFamily: "Courier New",
        stroke: "#000",
        strokeThickness: 3,
      }).setOrigin(0.5);
      const archetype = this.add.text(0, 49, fighter.archetype.toUpperCase(), {
        fontSize: "8px",
        color: selected ? "#ffdd00" : "#99aacc",
        fontFamily: "Courier New",
      }).setOrigin(0.5);
      card.add([bg, portrait, name, archetype]);
      card.setInteractive(new Phaser.Geom.Rectangle(-cardW / 2, -58, cardW, 116), Phaser.Geom.Rectangle.Contains);
      card.on("pointerdown", () => this.selectFighter(fighter.id));
      card.on("pointerover", () => bg.setFillStyle(0x20244a));
      card.on("pointerout", () => bg.setFillStyle(selected ? 0x1d203b : 0x0d0d1c));
    });

    const fighter = getFighter(this.selectedFighter);
    this.add.text(width / 2, 198, fighter.intro, {
      fontSize: "11px",
      color: "#34f7ff",
      fontFamily: "Courier New",
    }).setOrigin(0.5);
  }

  private drawArenaSelect(): void {
    const { width } = this.scale;
    const y = 282;
    this.add.text(24, 228, "ARENA SELECT", {
      fontSize: "13px",
      color: "#ffffff",
      fontFamily: "Courier New",
      stroke: "#000",
      strokeThickness: 4,
    });

    const cardW = (width - 80) / ARENAS.length;
    ARENAS.forEach((arena, index) => {
      const selected = arena.id === this.selectedArena;
      const x = 32 + cardW / 2 + index * cardW;
      const card = this.add.container(x, y);
      const bg = this.add.rectangle(0, 0, cardW - 14, 92, 0x080914, 0.98)
        .setStrokeStyle(selected ? 3 : 1, selected ? arena.palette.neonA : 0x335577, selected ? 1 : 0.65);
      const image = this.add.image(0, -8, `arena_card_${arena.id}`).setDisplaySize(cardW - 24, 58);
      const label = this.add.text(0, 30, arena.name.toUpperCase(), {
        fontSize: "10px",
        color: "#ffffff",
        fontFamily: "Courier New",
        stroke: "#000",
        strokeThickness: 3,
      }).setOrigin(0.5);
      const sub = this.add.text(0, 45, arena.subtitle.toUpperCase(), {
        fontSize: "8px",
        color: selected ? "#ffdd00" : "#8aa0b8",
        fontFamily: "Courier New",
      }).setOrigin(0.5);
      card.add([bg, image, label, sub]);
      card.setInteractive(new Phaser.Geom.Rectangle(-(cardW - 14) / 2, -46, cardW - 14, 92), Phaser.Geom.Rectangle.Contains);
      card.on("pointerdown", () => this.selectArena(arena.id));
      card.on("pointerover", () => bg.setFillStyle(0x172038));
      card.on("pointerout", () => bg.setFillStyle(0x080914));
    });
  }

  private drawEconomyPanel(): void {
    const { width } = this.scale;
    const y = 374;
    const cx = width / 2;
    this.add.rectangle(cx, y, width - 72, 72, 0x080914, 0.92)
      .setStrokeStyle(2, 0xff4df0, 0.75);

    this.add.text(54, y - 24, "ENTRY", {
      fontSize: "11px", color: "#8aa0b8", fontFamily: "Courier New",
    });
    const totalWidth = WAGER_OPTIONS.length * 60;
    const startX = cx - totalWidth / 2 + 30;
    WAGER_OPTIONS.forEach((amount, i) => {
      const selected = amount === this.selectedWager;
      const x = startX + i * 60;
      const btn = this.add.rectangle(x, y + 6, 52, 30, selected ? 0xffdd00 : 0x16172e, 1)
        .setStrokeStyle(1, 0xffdd00);
      const label = this.add.text(x, y + 6, `$${amount}`, {
        fontSize: "11px",
        color: selected ? "#000000" : "#ffdd00",
        fontFamily: "Courier New",
      }).setOrigin(0.5);
      btn.setInteractive().on("pointerdown", () => this.selectWager(amount));
      label.setInteractive().on("pointerdown", () => this.selectWager(amount));
    });

    const real = this.add.text(width - 210, y - 10, "REAL", {
      fontSize: "12px",
      color: this.selectedCurrency === "REAL" ? "#00ff88" : "#667085",
      fontFamily: "Courier New",
    }).setInteractive();
    const promo = this.add.text(width - 142, y - 10, "PROMO", {
      fontSize: "12px",
      color: this.selectedCurrency === "PROMO" ? "#ffdd00" : "#667085",
      fontFamily: "Courier New",
    }).setInteractive();
    real.on("pointerdown", () => this.selectCurrency("REAL"));
    promo.on("pointerdown", () => this.selectCurrency("PROMO"));

    this.add.text(width - 210, y + 16, "5% PLATFORM FEE", {
      fontSize: "9px", color: "#8aa0b8", fontFamily: "Courier New",
    });
  }

  private drawPlayButton(): void {
    const cx = this.scale.width / 2;
    const y = 448;
    const fighter = getFighter(this.selectedFighter);
    const arena = getArena(this.selectedArena);
    const btn = this.add.container(cx, y);
    const bg = this.add.rectangle(0, 0, 252, 46, arena.palette.neonA, 1)
      .setStrokeStyle(3, 0xffffff, 0.95);
    const text = this.add.text(0, -4, "FIND MATCH", {
      fontSize: "18px", color: "#02030a", fontFamily: "Courier New", fontStyle: "bold",
    }).setOrigin(0.5);
    const sub = this.add.text(0, 15, `${fighter.name} / ${arena.name}`, {
      fontSize: "8px", color: "#02030a", fontFamily: "Courier New",
    }).setOrigin(0.5);
    btn.add([bg, text, sub]);
    btn.setInteractive(new Phaser.Geom.Rectangle(-126, -23, 252, 46), Phaser.Geom.Rectangle.Contains);
    btn.on("pointerdown", () => this.joinQueue());
    btn.on("pointerover", () => btn.setScale(1.035));
    btn.on("pointerout", () => btn.setScale(1));
    this.tweens.add({ targets: btn, y: y + 3, yoyo: true, repeat: -1, duration: 720, ease: "Sine.InOut" });
  }

  private drawFooter(): void {
    const y = this.scale.height - 26;
    const isConnected = this.wallet.isConnected();
    const walletLabel = isConnected ? this.wallet.shortAddress() : "CONNECT WALLET";
    const wallet = this.add.text(this.scale.width - 24, y, walletLabel, {
      fontSize: "11px",
      color: isConnected ? "#00ff88" : "#8aa0b8",
      fontFamily: "Courier New",
    }).setOrigin(1, 0.5).setInteractive();
    wallet.on("pointerdown", () => {
      if (!isConnected) {
        this.showToast("Connecting wallet...");
        this.wallet.connect()
          .then(() => this.scene.restart())
          .catch(() => this.showToast("Wallet connection unavailable"));
      }
    });

    this.add.text(24, y, "ELO 1200  /  SKILL-BASED MATCHING", {
      fontSize: "11px",
      color: "#667085",
      fontFamily: "Courier New",
    }).setOrigin(0, 0.5);

    this.add.text(this.scale.width / 2, y, `Closed Beta ${import.meta.env.VITE_APP_VERSION || "0.9.0"}`, {
      fontSize: "10px",
      color: "#4f6b7a",
      fontFamily: "Courier New",
    }).setOrigin(0.5);
  }

  private selectFighter(id: FighterId): void {
    this.selectedFighter = id;
    localStorage.setItem(SELECTED_FIGHTER_KEY, id);
    this.scene.restart();
  }

  private selectArena(id: ArenaId): void {
    this.selectedArena = id;
    localStorage.setItem(SELECTED_ARENA_KEY, id);
    this.scene.restart();
  }

  private selectCurrency(currency: "REAL" | "PROMO"): void {
    this.selectedCurrency = currency;
    this.scene.restart();
  }

  private selectWager(amount: string): void {
    this.selectedWager = amount;
    this.scene.restart();
  }

  private async joinQueue(): Promise<void> {
    const wagerWei = BigInt(Math.floor(parseFloat(this.selectedWager) * 1e18)).toString();
    localStorage.setItem(SELECTED_FIGHTER_KEY, this.selectedFighter);
    localStorage.setItem(SELECTED_ARENA_KEY, this.selectedArena);

    this.scene.start("QueueScene", {
      wagerAmount: wagerWei,
      wagerDisplay: this.selectedWager,
      currency: this.selectedCurrency,
      fighterId: this.selectedFighter,
      arenaId: this.selectedArena,
    });
  }

  private showToast(message: string): void {
    this.statusToast?.destroy();
    this.statusToast = this.add.text(this.scale.width / 2, this.scale.height - 62, message, {
      fontSize: "12px",
      color: "#ffffff",
      fontFamily: "Courier New",
      backgroundColor: "#111827",
      padding: { x: 12, y: 7 },
    }).setOrigin(0.5).setDepth(200);
    this.tweens.add({
      targets: this.statusToast,
      alpha: 0,
      y: this.statusToast.y - 16,
      delay: 1200,
      duration: 260,
      onComplete: () => {
        this.statusToast?.destroy();
        this.statusToast = undefined;
      },
    });
  }
}

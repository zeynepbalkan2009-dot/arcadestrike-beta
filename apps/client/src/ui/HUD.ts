/**
 * HUD — in-game heads-up display.
 *
 * Renders:
 *  - HP bars (both fighters, top left/right)
 *  - Match timer (center, countdown)
 *  - Round indicators (● circles)
 *  - Wager amount reminder
 *  - Cooldown indicators for attack/special
 *  - Daily loss warning banner
 *  - Connection status icon
 */
import Phaser from "phaser";
import { GAME_CONSTANTS as C } from "@arcadestrike/shared";
import type { GameState } from "@arcadestrike/shared";

// We inline a minimal formatEther since we can't import node ethers directly
function fmtWei(wei: string): string {
  try {
    const val = Number(BigInt(wei)) / 1e18;
    return val.toFixed(2);
  } catch { return "?"; }
}

const HP_BAR_W    = 260;
const HP_BAR_H    = 18;
const HP_P1_X     = 20;
const HP_P2_X_END = 780;
const HP_Y        = 18;
const ROUND_DOT_R = 7;

export class HUD {
  private scene: Phaser.Scene;

  // HP bars
  private p1HpBg!:   Phaser.GameObjects.Rectangle;
  private p1HpFill!: Phaser.GameObjects.Rectangle;
  private p2HpBg!:   Phaser.GameObjects.Rectangle;
  private p2HpFill!: Phaser.GameObjects.Rectangle;

  // Labels
  private p1HpText!:  Phaser.GameObjects.Text;
  private p2HpText!:  Phaser.GameObjects.Text;
  private timerText!: Phaser.GameObjects.Text;
  private wagerText!: Phaser.GameObjects.Text;
  private roundText!: Phaser.GameObjects.Text;

  // Round dots
  private p1Dots: Phaser.GameObjects.Arc[] = [];
  private p2Dots: Phaser.GameObjects.Arc[] = [];

  // Cooldown bars
  private atkCdBar!:  Phaser.GameObjects.Rectangle;
  private spcCdBar!:  Phaser.GameObjects.Rectangle;

  // Misc
  private connIcon!:        Phaser.GameObjects.Text;
  private lossWarningBanner!: Phaser.GameObjects.Container;
  private myPlayerId = "";
  private wagerAmount = "";

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.build();
  }

  private build(): void {
    const { width } = this.scene.scale;
    const cx = width / 2;

    // ─── Dark panel background ────────────────────────────────
    const panelH = 52;
    this.scene.add.rectangle(0, 0, width, panelH, 0x000000, 0.75)
      .setOrigin(0, 0).setDepth(49);

    // ─── P1 HP bar (left) ─────────────────────────────────────
    this.p1HpBg = this.scene.add.rectangle(HP_P1_X, HP_Y, HP_BAR_W, HP_BAR_H, 0x333333)
      .setOrigin(0, 0.5).setDepth(50);
    this.p1HpFill = this.scene.add.rectangle(HP_P1_X, HP_Y, HP_BAR_W, HP_BAR_H, 0x00dd55)
      .setOrigin(0, 0.5).setDepth(51);
    this.p1HpText = this.scene.add.text(HP_P1_X + 5, HP_Y, "100", {
      fontSize: "11px", color: "#fff", fontFamily: "Courier New",
    }).setOrigin(0, 0.5).setDepth(52);

    // P1 label
    this.scene.add.text(HP_P1_X, HP_Y - 14, "YOU", {
      fontSize: "10px", color: "#00ff88", fontFamily: "Courier New",
    }).setOrigin(0, 0.5).setDepth(52);

    // ─── P2 HP bar (right, fills right-to-left) ───────────────
    this.p2HpBg = this.scene.add.rectangle(HP_P2_X_END, HP_Y, HP_BAR_W, HP_BAR_H, 0x333333)
      .setOrigin(1, 0.5).setDepth(50);
    this.p2HpFill = this.scene.add.rectangle(HP_P2_X_END, HP_Y, HP_BAR_W, HP_BAR_H, 0xdd3333)
      .setOrigin(1, 0.5).setDepth(51);
    this.p2HpText = this.scene.add.text(HP_P2_X_END - 5, HP_Y, "100", {
      fontSize: "11px", color: "#fff", fontFamily: "Courier New",
    }).setOrigin(1, 0.5).setDepth(52);

    this.scene.add.text(HP_P2_X_END, HP_Y - 14, "OPP", {
      fontSize: "10px", color: "#ff4444", fontFamily: "Courier New",
    }).setOrigin(1, 0.5).setDepth(52);

    // ─── Timer (center) ───────────────────────────────────────
    this.timerText = this.scene.add.text(cx, 14, "60", {
      fontSize: "28px",
      color:    "#ffffff",
      fontFamily: "Courier New",
      stroke:   "#000",
      strokeThickness: 4,
    }).setOrigin(0.5, 0.5).setDepth(52);

    // ─── Round indicators ─────────────────────────────────────
    for (let i = 0; i < Math.ceil(C.MAX_ROUNDS / 2); i++) {
      const dot = this.scene.add.circle(cx - 30 + i * 22, 40, ROUND_DOT_R, 0x444444)
        .setDepth(52);
      this.p1Dots.push(dot);
    }

    // ─── Wager reminder ───────────────────────────────────────
    this.wagerText = this.scene.add.text(cx, 48, "", {
      fontSize: "10px", color: "#888", fontFamily: "Courier New",
    }).setOrigin(0.5).setDepth(52);

    // ─── Cooldown bars (bottom-left) ──────────────────────────
    const cdY = C.GROUND_Y + 55;
    this.scene.add.text(20, cdY - 14, "ATK", { fontSize: "10px", color: "#888", fontFamily: "Courier New" }).setDepth(52);
    this.scene.add.rectangle(20, cdY, 80, 8, 0x333333).setOrigin(0, 0.5).setDepth(51);
    this.atkCdBar = this.scene.add.rectangle(20, cdY, 80, 8, 0x00aaff).setOrigin(0, 0.5).setDepth(52);

    this.scene.add.text(110, cdY - 14, "SPL", { fontSize: "10px", color: "#888", fontFamily: "Courier New" }).setDepth(52);
    this.scene.add.rectangle(110, cdY, 80, 8, 0x333333).setOrigin(0, 0.5).setDepth(51);
    this.spcCdBar = this.scene.add.rectangle(110, cdY, 80, 8, 0xaa44ff).setOrigin(0, 0.5).setDepth(52);

    // ─── Connection indicator ─────────────────────────────────
    this.connIcon = this.scene.add.text(width - 16, 8, "●", {
      fontSize: "12px", color: "#00ff88", fontFamily: "Courier New",
    }).setOrigin(1, 0).setDepth(52);
  }

  // ─── Per-frame update ────────────────────────────────────────

  update(state: GameState, myPlayerId: string): void {
    this.myPlayerId = myPlayerId;
    const fighters = Object.values(state.fighters);
    if (fighters.length < 2) return;

    const me  = fighters.find(f => f.playerId === myPlayerId);
    const opp = fighters.find(f => f.playerId !== myPlayerId);
    if (!me || !opp) return;

    // ─── HP bars ─────────────────────────────────────────────
    const p1Pct = Math.max(0, me.hp  / C.MAX_HP);
    const p2Pct = Math.max(0, opp.hp / C.MAX_HP);

    this.p1HpFill.width = HP_BAR_W * p1Pct;
    this.p2HpFill.width = HP_BAR_W * p2Pct;

    // Colour gradient: green → yellow → red
    this.p1HpFill.setFillStyle(this.hpColor(p1Pct));
    this.p2HpFill.setFillStyle(this.hpColor(p2Pct));

    this.p1HpText.setText(Math.ceil(me.hp).toString());
    this.p2HpText.setText(Math.ceil(opp.hp).toString());

    // ─── Timer ───────────────────────────────────────────────
    const seconds = Math.ceil(state.matchTimer / C.TICK_RATE);
    this.timerText.setText(seconds > 0 ? seconds.toString() : "0");
    if (seconds <= 10) {
      this.timerText.setColor(seconds % 2 === 0 ? "#ff4444" : "#ffffff");
    } else {
      this.timerText.setColor("#ffffff");
    }

    // ─── Cooldown bars ───────────────────────────────────────
    const atkPct = me.attackCooldown  > 0 ? 1 - (me.attackCooldown  / C.ATTACK_COOLDOWN_TICKS)  : 1;
    const spcPct = me.specialCooldown > 0 ? 1 - (me.specialCooldown / C.SPECIAL_COOLDOWN_TICKS) : 1;
    this.atkCdBar.width = 80 * atkPct;
    this.spcCdBar.width = 80 * spcPct;

    // ─── Round scores ────────────────────────────────────────
    const myScore = state.scores[myPlayerId] || 0;
    this.p1Dots.forEach((dot, i) => {
      dot.setFillStyle(i < myScore ? 0x00ff88 : 0x444444);
    });
  }

  setWager(amountWei: string): void {
    this.wagerAmount = amountWei;
    this.wagerText.setText(`WAGER $${fmtWei(amountWei)}`);
  }

  setConnectionStatus(connected: boolean): void {
    this.connIcon.setColor(connected ? "#00ff88" : "#ff4444");
    this.connIcon.setText(connected ? "●" : "⚠");
  }

  showDailyLossWarning(remaining: string): void {
    if (this.lossWarningBanner) return; // already showing

    const { width, height } = this.scene.scale;
    const banner = this.scene.add.container(width / 2, height - 30).setDepth(200);
    const bg = this.scene.add.rectangle(0, 0, 360, 28, 0xff8800, 0.9);
    const txt = this.scene.add.text(0, 0,
      `⚠ Daily loss limit: $${fmtWei(remaining)} remaining`,
      { fontSize: "12px", color: "#000", fontFamily: "Courier New" }
    ).setOrigin(0.5);
    banner.add([bg, txt]);
    this.lossWarningBanner = banner;
  }

  pulseCombo(hits: number): void {
    if (hits < 2) return;
    this.timerText.setScale(1.18);
    this.timerText.setColor("#ffdd00");
    this.scene.tweens.add({
      targets: this.timerText,
      scale: 1,
      duration: 180,
      ease: "Back.Out",
    });
  }

  private hpColor(pct: number): number {
    if (pct > 0.6) return 0x00dd55;
    if (pct > 0.3) return 0xddaa00;
    return 0xdd2222;
  }
}

/**
 * ResultScene — match over screen with payout info.
 */
import Phaser from "phaser";
import { ethers } from "ethers";
import type { MatchEndPayload } from "@arcadestrike/shared";

export class ResultScene extends Phaser.Scene {
  private resultData!: { result: MatchEndPayload; myPlayerId: string };

  constructor() { super({ key: "ResultScene" }); }

  init(data: any): void { this.resultData = data; }

  create(): void {
    const { width, height } = this.scale;
    const cx = width / 2, cy = height / 2;
    const { result, myPlayerId } = this.resultData;
    const isWinner = result.winnerId === myPlayerId;

    this.add.rectangle(0, 0, width, height, 0x0a0a0f).setOrigin(0);

    // Title
    this.add.text(cx, cy - 120, isWinner ? "🏆 VICTORY!" : "💀 DEFEAT", {
      fontSize: "40px",
      color: isWinner ? "#00ff88" : "#ff4444",
      fontFamily: "Courier New",
    }).setOrigin(0.5);

    // Score
    const scores = Object.entries(result.scores);
    scores.forEach(([pid, score], i) => {
      const isMe = pid === myPlayerId;
      this.add.text(cx + (i === 0 ? -80 : 80), cy - 50, score.toString(), {
        fontSize: "48px",
        color: isMe ? "#00ff88" : "#ff4444",
        fontFamily: "Courier New",
      }).setOrigin(0.5);
    });

    // Payout info
    if (isWinner && result.payout) {
      const netEth = ethers.formatEther(result.payout.net);
      this.add.text(cx, cy + 10, `+$${parseFloat(netEth).toFixed(2)} credited`, {
        fontSize: "20px", color: "#00ff88", fontFamily: "Courier New",
      }).setOrigin(0.5);

      this.add.text(cx, cy + 35, `(${ethers.formatEther(result.payout.fee)} fee deducted)`, {
        fontSize: "11px", color: "#555", fontFamily: "Courier New",
      }).setOrigin(0.5);
    }

    this.drawButtons(cx, cy + 100);
  }

  private drawButtons(cx: number, y: number): void {
    // Rematch
    const rematch = this.add.container(cx - 90, y);
    const rbg = this.add.rectangle(0, 0, 160, 44, 0x00ff88).setStrokeStyle(1, 0x00ff88);
    const rt = this.add.text(0, 0, "↺  REMATCH", { fontSize: "14px", color: "#000", fontFamily: "Courier New" }).setOrigin(0.5);
    rematch.add([rbg, rt]);
    rematch.setInteractive(new Phaser.Geom.Rectangle(-80, -22, 160, 44), Phaser.Geom.Rectangle.Contains);
    rematch.on("pointerdown", () => this.scene.start("LobbyScene", { quickRematch: true }));

    // Lobby
    const lobby = this.add.container(cx + 90, y);
    const lbg = this.add.rectangle(0, 0, 160, 44, 0x1a1a2e).setStrokeStyle(1, 0x666);
    const lt = this.add.text(0, 0, "⌂  LOBBY", { fontSize: "14px", color: "#aaa", fontFamily: "Courier New" }).setOrigin(0.5);
    lobby.add([lbg, lt]);
    lobby.setInteractive(new Phaser.Geom.Rectangle(-80, -22, 160, 44), Phaser.Geom.Rectangle.Contains);
    lobby.on("pointerdown", () => this.scene.start("LobbyScene"));
  }
}

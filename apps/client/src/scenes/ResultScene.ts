/**
 * ResultScene — match over screen with payout info.
 */
import Phaser from "phaser";
import { ethers } from "ethers";
import type { MatchEndPayload } from "@arcadestrike/shared";
import { NetworkManager } from "../network/NetworkManager";

export class ResultScene extends Phaser.Scene {
  private resultData!: { result: MatchEndPayload; myPlayerId: string };
  private unsubscribeNetwork: Array<() => void> = [];
  private rematchTimer?: Phaser.Time.TimerEvent;

  constructor() { super({ key: "ResultScene" }); }

  init(data: any): void { this.resultData = data; }

  create(): void {
    const { width, height } = this.scale;
    const cx = width / 2, cy = height / 2;
    const { result, myPlayerId } = this.resultData;
    const isWinner = result.winnerId === myPlayerId;

    this.add.rectangle(0, 0, width, height, 0x0a0a0f).setOrigin(0);
    const network = NetworkManager.getInstance();
    this.unsubscribeNetwork = [
      network.on("REMATCH_START", () => {
        this.rematchTimer?.remove(false);
        this.scene.start("FightScene", {});
      }),
      network.on("REMATCH_DECLINED", () => {
        this.rematchTimer?.remove(false);
        this.showToast("Rematch declined");
      }),
    ];
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.rematchTimer?.remove(false);
      this.unsubscribeNetwork.forEach(unsub => unsub());
      this.unsubscribeNetwork = [];
    });

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

    this.drawButtons(cx, cy + 100, result.matchId);
  }

  private drawButtons(cx: number, y: number, matchId?: string): void {
    // Rematch
    const rematch = this.add.container(cx - 180, y);
    const rbg = this.add.rectangle(0, 0, 160, 44, 0x00ff88).setStrokeStyle(1, 0x00ff88);
    const rt = this.add.text(0, 0, "↺  REMATCH", { fontSize: "14px", color: "#000", fontFamily: "Courier New" }).setOrigin(0.5);
    rematch.add([rbg, rt]);
    rematch.setInteractive(new Phaser.Geom.Rectangle(-80, -22, 160, 44), Phaser.Geom.Rectangle.Contains);
    rematch.on("pointerdown", () => {
      NetworkManager.getInstance().sendRematchVote(true);
      rt.setText("WAITING...");
      rbg.setFillStyle(0xffdd00);
      this.showToast("Rematch request sent");
      this.rematchTimer?.remove(false);
      this.rematchTimer = this.time.delayedCall(12000, () => {
        rt.setText("REMATCH");
        rbg.setFillStyle(0x00ff88);
        this.showToast("No response. Try queue again.");
      });
    });

    // Lobby
    const replay = this.add.container(cx, y);
    const vbg = this.add.rectangle(0, 0, 160, 44, 0x101828).setStrokeStyle(1, 0x00aaff);
    const vt = this.add.text(0, 0, "VIEW REPLAY", { fontSize: "13px", color: "#88ddff", fontFamily: "Courier New" }).setOrigin(0.5);
    replay.add([vbg, vt]);
    replay.setInteractive(new Phaser.Geom.Rectangle(-80, -22, 160, 44), Phaser.Geom.Rectangle.Contains);
    replay.on("pointerdown", () => {
      if (matchId) this.scene.start("ReplayScene", { matchId });
      else this.showToast("Replay unavailable");
    });

    // Lobby
    const lobby = this.add.container(cx + 180, y);
    const lbg = this.add.rectangle(0, 0, 160, 44, 0x1a1a2e).setStrokeStyle(1, 0x666);
    const lt = this.add.text(0, 0, "⌂  LOBBY", { fontSize: "14px", color: "#aaa", fontFamily: "Courier New" }).setOrigin(0.5);
    lobby.add([lbg, lt]);
    lobby.setInteractive(new Phaser.Geom.Rectangle(-80, -22, 160, 44), Phaser.Geom.Rectangle.Contains);
    lobby.on("pointerdown", () => {
      void NetworkManager.getInstance().leaveRoom().finally(() => this.scene.start("LobbyScene"));
    });
  }

  private showToast(message: string): void {
    const toast = this.add.text(this.scale.width / 2, this.scale.height - 92, message, {
      fontSize: "12px",
      color: "#ffffff",
      fontFamily: "Courier New",
      backgroundColor: "#111827",
      padding: { x: 12, y: 7 },
    }).setOrigin(0.5).setDepth(200);
    this.tweens.add({
      targets: toast,
      alpha: 0,
      y: toast.y - 18,
      delay: 900,
      duration: 260,
      onComplete: () => toast.destroy(),
    });
  }
}

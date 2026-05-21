/**
 * QueueScene — waiting for opponent.
 */
import Phaser from "phaser";
import { NetworkManager } from "../network/NetworkManager";
import type { MatchFoundPayload } from "@arcadestrike/shared";

export class QueueScene extends Phaser.Scene {
  private network!: NetworkManager;
  private dots = 0;
  private dotTimer = 0;
  private waitText!: Phaser.GameObjects.Text;
  private cancelBtn!: Phaser.GameObjects.Container;
  private queueData!: { wagerAmount: string; wagerDisplay: string; currency: "REAL" | "PROMO" };
  private statusTimer?: Phaser.Time.TimerEvent;

  constructor() { super({ key: "QueueScene" }); }

  init(data: any): void {
    this.queueData = data;
  }

  async create(): Promise<void> {
    this.network = NetworkManager.getInstance();
    this.drawUI();

    try {
      await this.network.joinQueue({
        wagerAmount: this.queueData.wagerAmount,
        currency: this.queueData.currency,
        queueMode: "quick",
      });
      this.statusTimer = this.time.addEvent({
        delay: 750,
        loop: true,
        callback: () => void this.pollQueueStatus(),
      });

      this.network.on("MATCH_FOUND", (payload: MatchFoundPayload) => {
        this.onMatchFound(payload);
      });

      this.network.on("QUEUE_UPDATE", ({ position, estimatedWaitMs }: any) => {
        this.waitText.setText(
          `Queue position: #${position}\nEst. wait: ${Math.ceil(estimatedWaitMs / 1000)}s`
        );
      });

    } catch (err: any) {
      this.showError(err.message || "Failed to join queue");
    }
  }

  update(_time: number, delta: number): void {
    this.dotTimer += delta;
    if (this.dotTimer > 400) {
      this.dotTimer = 0;
      this.dots = (this.dots + 1) % 4;
    }
  }

  private drawUI(): void {
    const { width, height } = this.scale;
    const cx = width / 2, cy = height / 2;

    this.add.rectangle(0, 0, width, height, 0x0a0a0f).setOrigin(0);

    this.add.text(cx, cy - 80, "FINDING OPPONENT", {
      fontSize: "22px", color: "#00ff88", fontFamily: "Courier New",
    }).setOrigin(0.5);

    this.add.text(cx, cy - 50, `Wager: $${this.queueData.wagerDisplay} ${this.queueData.currency}`, {
      fontSize: "13px", color: "#888", fontFamily: "Courier New",
    }).setOrigin(0.5);

    // Animated spinner
    const spinner = this.add.text(cx, cy, "◐", {
      fontSize: "40px", color: "#00ff88", fontFamily: "Courier New",
    }).setOrigin(0.5);
    this.tweens.add({ targets: spinner, angle: 360, repeat: -1, duration: 1000 });

    this.waitText = this.add.text(cx, cy + 60, "Searching...", {
      fontSize: "13px", color: "#666", fontFamily: "Courier New", align: "center",
    }).setOrigin(0.5);

    // Cancel button
    const cancelBtn = this.add.container(cx, cy + 110);
    const bg = this.add.rectangle(0, 0, 140, 36, 0x1a0000).setStrokeStyle(1, 0xff4444);
    const text = this.add.text(0, 0, "✕ CANCEL", { fontSize: "13px", color: "#ff4444", fontFamily: "Courier New" }).setOrigin(0.5);
    cancelBtn.add([bg, text]);
    cancelBtn.setInteractive(new Phaser.Geom.Rectangle(-70, -18, 140, 36), Phaser.Geom.Rectangle.Contains);
    cancelBtn.on("pointerdown", () => this.cancelQueue());
  }

  private async cancelQueue(): Promise<void> {
    await this.network.leaveQueue();
    this.scene.start("LobbyScene");
  }

  private onMatchFound(payload: MatchFoundPayload): void {
    this.scene.start("FightScene", { matchPayload: payload, queueData: this.queueData });
  }

  private async pollQueueStatus(): Promise<void> {
    try {
      const status = await this.network.getQueueStatus();
      if (status.matchFound && status.match) {
        this.statusTimer?.remove(false);
        const token = localStorage.getItem("arcadestrike_token") || "";
        await this.network.joinMatchedRoom(status.match.roomId, token);
        this.scene.start("FightScene", { matchPayload: status.match, queueData: this.queueData });
        return;
      }

      if (status.inQueue) {
        this.waitText.setText(
          `Queue position: #${status.position}\nEst. wait: ${Math.ceil(status.estimatedWaitMs / 1000)}s`
        );
      }
    } catch {
      // Keep the queue screen stable during transient REST failures.
    }
  }

  private showError(msg: string): void {
    const cx = this.scale.width / 2;
    this.add.text(cx, this.scale.height / 2 + 100, `Error: ${msg}`, {
      fontSize: "12px", color: "#ff4444", fontFamily: "Courier New",
    }).setOrigin(0.5);

    this.time.delayedCall(3000, () => this.scene.start("LobbyScene"));
  }
}

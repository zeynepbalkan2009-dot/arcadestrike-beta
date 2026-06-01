/**
 * QueueScene — waiting for opponent.
 */
import Phaser from "phaser";
import { NetworkManager } from "../network/NetworkManager";
import type { MatchFoundPayload } from "@arcadestrike/shared";
import { getArena, getFighter, type ArenaId, type FighterId } from "../game/CanonContent";

export class QueueScene extends Phaser.Scene {
  private network!: NetworkManager;
  private dots = 0;
  private dotTimer = 0;
  private waitText!: Phaser.GameObjects.Text;
  private cancelBtn!: Phaser.GameObjects.Container;
  private queueData!: { wagerAmount: string; wagerDisplay: string; currency: "REAL" | "PROMO"; fighterId?: FighterId; arenaId?: ArenaId };
  private statusTimer?: Phaser.Time.TimerEvent;
  private pulseText!: Phaser.GameObjects.Text;
  private found = false;
  private unsubscribeNetwork: Array<() => void> = [];
  private canceling = false;
  private joinedAt = 0;

  constructor() { super({ key: "QueueScene" }); }

  init(data: any): void {
    this.queueData = data;
  }

  async create(): Promise<void> {
    this.network = NetworkManager.getInstance();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.cleanup());
    this.drawUI();

    try {
      this.joinedAt = Date.now();
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

      this.unsubscribeNetwork = [
        this.network.on("MATCH_FOUND", (payload: MatchFoundPayload) => this.onMatchFound(payload)),
        this.network.on("QUEUE_UPDATE", ({ position, estimatedWaitMs }: any) => {
          this.waitText.setText(
            `Queue position: #${position}\nEst. wait: ${Math.ceil(estimatedWaitMs / 1000)}s`
          );
        }),
      ];

    } catch (err: any) {
      this.showError(err.message || "Failed to join queue");
    }
  }

  update(_time: number, delta: number): void {
    this.dotTimer += delta;
    if (this.dotTimer > 400) {
      this.dotTimer = 0;
      this.dots = (this.dots + 1) % 4;
      if (!this.found && this.joinedAt > 0) {
        const waitSeconds = Math.floor((Date.now() - this.joinedAt) / 1000);
        if (waitSeconds >= 20) {
          this.pulseText.setText("Still searching - widening fair match range");
        }
      }
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
    const fighter = getFighter(this.queueData.fighterId);
    const arena = getArena(this.queueData.arenaId);
    this.add.text(cx, cy - 30, `${fighter.name.toUpperCase()}  /  ${arena.name.toUpperCase()}`, {
      fontSize: "10px", color: "#34f7ff", fontFamily: "Courier New",
    }).setOrigin(0.5);

    // Animated spinner
    const spinner = this.add.text(cx, cy, "◐", {
      fontSize: "40px", color: "#00ff88", fontFamily: "Courier New",
    }).setOrigin(0.5);
    this.tweens.add({ targets: spinner, angle: 360, repeat: -1, duration: 1000 });

    this.waitText = this.add.text(cx, cy + 60, "Searching...", {
      fontSize: "13px", color: "#666", fontFamily: "Courier New", align: "center",
    }).setOrigin(0.5);

    this.pulseText = this.add.text(cx, cy + 84, "Warm up your first hit", {
      fontSize: "11px", color: "#00ff88", fontFamily: "Courier New", align: "center",
    }).setOrigin(0.5).setAlpha(0.8);
    this.tweens.add({ targets: this.pulseText, alpha: 0.35, yoyo: true, repeat: -1, duration: 700 });

    // Cancel button
    const cancelBtn = this.add.container(cx, cy + 110);
    const bg = this.add.rectangle(0, 0, 140, 36, 0x1a0000).setStrokeStyle(1, 0xff4444);
    const text = this.add.text(0, 0, "✕ CANCEL", { fontSize: "13px", color: "#ff4444", fontFamily: "Courier New" }).setOrigin(0.5);
    cancelBtn.add([bg, text]);
    cancelBtn.setInteractive(new Phaser.Geom.Rectangle(-70, -18, 140, 36), Phaser.Geom.Rectangle.Contains);
    cancelBtn.on("pointerdown", () => this.cancelQueue());
  }

  private async cancelQueue(): Promise<void> {
    if (this.canceling || this.found) return;
    this.canceling = true;
    this.waitText.setText("Leaving queue...");
    this.statusTimer?.remove(false);
    try {
      await this.network.leaveQueue();
    } finally {
      this.scene.start("LobbyScene");
    }
  }

  private onMatchFound(payload: MatchFoundPayload): void {
    if (this.found) return;
    this.found = true;
    this.showMatchFound();
    this.time.delayedCall(300, () => {
      this.scene.start("FightScene", { matchPayload: payload, queueData: this.queueData });
    });
  }

  private async pollQueueStatus(): Promise<void> {
    try {
      const status = await this.network.getQueueStatus();
      if (status.matchFound && status.match) {
        if (this.found) return;
        this.found = true;
        this.statusTimer?.remove(false);
        this.showMatchFound();
        const token = localStorage.getItem("arcadestrike_token") || "";
        await this.network.joinMatchedRoom(status.match.roomId, token);
        this.time.delayedCall(300, () => {
          this.scene.start("FightScene", { matchPayload: status.match, queueData: this.queueData });
        });
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

  private cleanup(): void {
    this.statusTimer?.remove(false);
    this.unsubscribeNetwork.forEach(unsub => unsub());
    this.unsubscribeNetwork = [];
  }

  private showMatchFound(): void {
    const { width, height } = this.scale;
    this.add.rectangle(0, 0, width, height, 0x00ff88, 0.08).setOrigin(0).setDepth(20);
    const text = this.add.text(width / 2, height / 2, "MATCH FOUND", {
      fontSize: "34px",
      color: "#00ff88",
      fontFamily: "Courier New",
      stroke: "#000",
      strokeThickness: 7,
    }).setOrigin(0.5).setDepth(21).setScale(0.8);
    this.tweens.add({ targets: text, scale: 1.08, duration: 180, ease: "Back.Out" });
  }
}

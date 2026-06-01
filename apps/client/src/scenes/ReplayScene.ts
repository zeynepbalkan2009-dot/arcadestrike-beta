import Phaser from "phaser";
import { GAME_CONSTANTS as C } from "@arcadestrike/shared";

interface ReplayEvent {
  tick: number;
  type: string;
  playerId?: string;
  payload?: any;
  createdAt?: string;
}

interface ReplayInputRow {
  playerId: string;
  seq: number;
  tick: number;
  payload: any;
}

interface ReplayExport {
  matchId: string;
  inputs: ReplayInputRow[];
  events: ReplayEvent[];
}

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:2567";

export class ReplayScene extends Phaser.Scene {
  private matchId = "";
  private replay?: ReplayExport;
  private playheadTick = 0;
  private maxTick = 1;
  private playing = true;
  private speed = 1;
  private accumulator = 0;
  private title!: Phaser.GameObjects.Text;
  private timelineText!: Phaser.GameObjects.Text;
  private eventText!: Phaser.GameObjects.Text;
  private playButton!: Phaser.GameObjects.Text;
  private speedText!: Phaser.GameObjects.Text;
  private scrubber!: Phaser.GameObjects.Rectangle;
  private scrubberFill!: Phaser.GameObjects.Rectangle;
  private fighterGhosts = new Map<string, Phaser.GameObjects.Container>();
  private abort?: AbortController;

  constructor() { super({ key: "ReplayScene" }); }

  init(data: any): void {
    this.matchId = data.matchId || "";
  }

  async create(): Promise<void> {
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.cleanup());
    this.drawShell();
    this.input.keyboard?.on("keydown-SPACE", this.togglePlayback, this);
    this.input.keyboard?.on("keydown-LEFT", this.seekBackward, this);
    this.input.keyboard?.on("keydown-RIGHT", this.seekForward, this);
    if (!this.matchId) {
      this.eventText.setText("No match id supplied.");
      return;
    }
    await this.loadReplay();
  }

  update(_time: number, delta: number): void {
    if (!this.replay || !this.playing) return;
    this.accumulator += delta * this.speed;
    const tickMs = 1000 / C.TICK_RATE;
    while (this.accumulator >= tickMs) {
      this.accumulator -= tickMs;
      this.setPlayhead(Math.min(this.maxTick, this.playheadTick + 1));
      if (this.playheadTick >= this.maxTick) this.playing = false;
    }
  }

  private drawShell(): void {
    const { width, height } = this.scale;
    const cx = width / 2;
    this.add.rectangle(0, 0, width, height, 0x08080d).setOrigin(0);
    this.add.rectangle(0, 0, width, 58, 0x000000, 0.78).setOrigin(0);
    this.title = this.add.text(cx, 22, "REPLAY VIEWER", {
      fontSize: "20px",
      color: "#00ff88",
      fontFamily: "Courier New",
      stroke: "#000",
      strokeThickness: 4,
    }).setOrigin(0.5);

    this.add.rectangle(0, C.GROUND_Y + C.FIGHTER_HEIGHT / 2, width, height, 0x111120, 1).setOrigin(0);
    this.add.line(0, 0, 0, C.GROUND_Y + C.FIGHTER_HEIGHT / 2, width, C.GROUND_Y + C.FIGHTER_HEIGHT / 2, 0x00ff88, 0.65);

    this.timelineText = this.add.text(20, 72, "Loading...", {
      fontSize: "12px",
      color: "#aaaaaa",
      fontFamily: "Courier New",
    });
    this.eventText = this.add.text(20, 96, "", {
      fontSize: "14px",
      color: "#ffffff",
      fontFamily: "Courier New",
      wordWrap: { width: width - 40 },
    });

    this.playButton = this.add.text(20, height - 42, "PAUSE", {
      fontSize: "13px",
      color: "#000000",
      backgroundColor: "#00ff88",
      padding: { x: 12, y: 8 },
      fontFamily: "Courier New",
    }).setInteractive().on("pointerdown", () => {
      this.togglePlayback();
    });

    this.speedText = this.add.text(112, height - 42, "1x", {
      fontSize: "13px",
      color: "#ffffff",
      backgroundColor: "#1a1a2e",
      padding: { x: 12, y: 8 },
      fontFamily: "Courier New",
    }).setInteractive().on("pointerdown", () => {
      this.speed = this.speed === 1 ? 2 : this.speed === 2 ? 0.5 : 1;
      this.speedText.setText(`${this.speed}x`);
    });

    const back = this.add.text(width - 20, height - 42, "LOBBY", {
      fontSize: "13px",
      color: "#aaaaaa",
      backgroundColor: "#1a1a2e",
      padding: { x: 12, y: 8 },
      fontFamily: "Courier New",
    }).setOrigin(1, 0).setInteractive();
    back.on("pointerdown", () => this.scene.start("LobbyScene"));

    this.scrubber = this.add.rectangle(190, height - 25, width - 340, 6, 0x333333).setOrigin(0, 0.5);
    this.scrubberFill = this.add.rectangle(190, height - 25, 0, 6, 0x00ff88).setOrigin(0, 0.5);
    this.scrubber.setInteractive();
    this.scrubber.on("pointerdown", (p: Phaser.Input.Pointer) => this.seekFromPointer(p));
    this.scrubber.on("pointermove", (p: Phaser.Input.Pointer) => {
      if (p.isDown) this.seekFromPointer(p);
    });
  }

  private async loadReplay(): Promise<void> {
    try {
      const token = localStorage.getItem("arcadestrike_token") || "";
      this.abort = new AbortController();
      const res = await fetch(`${API_URL}/api/replays/${this.matchId}/export`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: this.abort.signal,
      });
      if (!res.ok) throw new Error("Replay export failed");
      const replay = await res.json() as ReplayExport;
      this.replay = replay;
      this.maxTick = Math.max(
        1,
        ...replay.events.map(event => event.tick),
        ...replay.inputs.map(input => input.tick)
      );
      this.title.setText(`REPLAY ${replay.matchId}`);
      this.setPlayhead(0);
    } catch (err: any) {
      if (err?.name !== "AbortError") this.eventText.setText(err.message || "Replay unavailable.");
      this.playing = false;
    }
  }

  private setPlayhead(tick: number): void {
    if (!this.replay) return;
    this.playheadTick = tick;
    this.timelineText.setText(`Tick ${tick}/${this.maxTick}  |  ${Math.ceil((this.maxTick - tick) / C.TICK_RATE)}s remaining`);
    this.scrubberFill.width = this.scrubber.width * (tick / Math.max(1, this.maxTick));

    const recentEvents = this.replay.events
      .filter(event => event.tick <= tick)
      .slice(-6);
    this.eventText.setText(recentEvents.map(event => this.describeEvent(event)).join("\n"));

    const recentInputs = this.replay.inputs
      .filter(input => input.tick <= tick)
      .slice(-24);
    this.renderInputGhosts(recentInputs);
  }

  private renderInputGhosts(inputs: ReplayInputRow[]): void {
    const players = Array.from(new Set(inputs.map(input => input.playerId))).slice(0, 2);
    players.forEach((playerId, index) => {
      let ghost = this.fighterGhosts.get(playerId);
      if (!ghost) {
        const x = index === 0 ? C.ARENA_WIDTH * 0.35 : C.ARENA_WIDTH * 0.65;
        ghost = this.add.container(x, C.GROUND_Y).setDepth(20);
        const body = this.add.rectangle(0, -40, C.FIGHTER_WIDTH, C.FIGHTER_HEIGHT, index === 0 ? 0x00ff88 : 0xff4444, 0.75);
        const label = this.add.text(0, -92, index === 0 ? "P1" : "P2", {
          fontSize: "11px",
          color: "#ffffff",
          fontFamily: "Courier New",
          stroke: "#000",
          strokeThickness: 3,
        }).setOrigin(0.5);
        ghost.add([body, label]);
        this.fighterGhosts.set(playerId, ghost);
      }

      const latest = inputs.filter(input => input.playerId === playerId).at(-1);
      if (!latest) return;
      const payload = latest.payload || {};
      const dir = payload.left ? -1 : payload.right ? 1 : 0;
      ghost.x = Phaser.Math.Clamp(ghost.x + dir * 8, C.FIGHTER_WIDTH, C.ARENA_WIDTH - C.FIGHTER_WIDTH);
      ghost.setScale(payload.attack || payload.special ? 1.08 : 1);
    });
  }

  private describeEvent(event: ReplayEvent): string {
    const payload = event.payload || {};
    if (event.type === "combat_event") {
      return `${event.tick}: ${payload.type || "combat"} ${payload.damage ? `-${payload.damage}` : ""}`;
    }
    if (event.type === "match_end") return `${event.tick}: match end winner=${payload.winnerId || "?"}`;
    if (event.type === "round_end") return `${event.tick}: round ${payload.round} winner=${payload.winnerId || "none"}`;
    return `${event.tick}: ${event.type}`;
  }

  private seekFromPointer(pointer: Phaser.Input.Pointer): void {
    const left = this.scrubber.x;
    const pct = Phaser.Math.Clamp((pointer.x - left) / this.scrubber.width, 0, 1);
    this.setPlayhead(Math.floor(this.maxTick * pct));
  }

  private togglePlayback(): void {
    this.playing = !this.playing;
    this.playButton.setText(this.playing ? "PAUSE" : "PLAY");
  }

  private seekBackward(): void {
    this.setPlayhead(Math.max(0, this.playheadTick - C.TICK_RATE));
  }

  private seekForward(): void {
    this.setPlayhead(Math.min(this.maxTick, this.playheadTick + C.TICK_RATE));
  }

  private cleanup(): void {
    this.abort?.abort();
    this.input.keyboard?.off("keydown-SPACE", this.togglePlayback, this);
    this.input.keyboard?.off("keydown-LEFT", this.seekBackward, this);
    this.input.keyboard?.off("keydown-RIGHT", this.seekForward, this);
  }
}

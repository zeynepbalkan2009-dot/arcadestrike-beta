/**
 * FightScene — the main 1v1 battle screen.
 *
 * Client-side systems:
 *  - Input collection & sending at TICK_RATE
 *  - Client prediction (immediate local response)
 *  - Server reconciliation (correct mispredictions)
 *  - Visual interpolation between server ticks
 */
import Phaser from "phaser";
import { GAME_CONSTANTS as C } from "@arcadestrike/shared";
import type { GameState, FighterState, MatchFoundPayload, MatchEndPayload } from "@arcadestrike/shared";
import { NetworkManager } from "../network/NetworkManager";
import { InputManager } from "../game/InputManager";
import { ClientPredictor } from "../game/ClientPredictor";
import { HUD } from "../ui/HUD";
import { FighterSprite } from "../game/FighterSprite";
import { FXManager } from "../game/FXManager";
import { AudioManager } from "../game/AudioManager";
import {
  DEFAULT_ARENA_ID,
  DEFAULT_FIGHTER_ID,
  SELECTED_ARENA_KEY,
  SELECTED_FIGHTER_KEY,
  getArena,
  getFighter,
  type ArenaId,
  type FighterId,
} from "../game/CanonContent";

export class FightScene extends Phaser.Scene {
  // Systems
  private network!: NetworkManager;
  private inputManager!: InputManager;
  private predictor!: ClientPredictor;
  private hud!: HUD;
  private fx!: FXManager;
  private audio!: AudioManager;

  // Game objects
  private fighters = new Map<string, FighterSprite>();
  private myPlayerId = "";
  private matchPayload!: MatchFoundPayload;
  private selectedFighter: FighterId = DEFAULT_FIGHTER_ID;
  private selectedArena: ArenaId = DEFAULT_ARENA_ID;

  // State
  private serverState: GameState | null = null;
  private currentPhase: string = "countdown";
  private countdownText!: Phaser.GameObjects.Text;
  private phaseText!: Phaser.GameObjects.Text;
  private inputSeq = 0;
  private tickAccum = 0;
  private readonly TICK_MS = 1000 / C.TICK_RATE;
  private previousHp = new Map<string, number>();
  private previousAction = new Map<string, string>();
  private hitstopUntil = 0;
  private comboHits = 0;
  private comboResetTimer?: Phaser.Time.TimerEvent;
  private koShown = false;
  private mobileControls?: Phaser.GameObjects.Container;
  private unsubscribeNetwork: Array<() => void> = [];
  private lastCountdownSecond: number | null = null;
  private isShuttingDown = false;
  private visibilityHandler?: () => void;

  constructor() { super({ key: "FightScene" }); }

  init(data: any): void {
    this.matchPayload = data.matchPayload;
    this.selectedFighter =
      data.queueData?.fighterId ||
      localStorage.getItem(SELECTED_FIGHTER_KEY) as FighterId ||
      DEFAULT_FIGHTER_ID;
    this.selectedArena =
      data.queueData?.arenaId ||
      localStorage.getItem(SELECTED_ARENA_KEY) as ArenaId ||
      DEFAULT_ARENA_ID;
  }

  async create(): Promise<void> {
    this.network = NetworkManager.getInstance();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.shutdown());
    this.visibilityHandler = () => {
      if (document.hidden) {
        this.inputManager?.clearAllTouch();
        this.hud?.showReconnectBanner("TAB PAUSED");
      } else {
        this.hud?.hideReconnectBanner();
      }
    };
    document.addEventListener("visibilitychange", this.visibilityHandler);

    // Draw arena
    this.drawArena();

    // Init subsystems
    this.inputManager = new InputManager(this);
    this.predictor = new ClientPredictor();
    this.hud      = new HUD(this);
    this.fx       = new FXManager(this);
    this.audio    = new AudioManager(this);
    this.fx.playBGM();
    this.mountMobileControls();
    if (this.matchPayload?.wagerAmount) this.hud.setWager(this.matchPayload.wagerAmount);

    // Register network handlers
    this.unsubscribeNetwork = [
      this.network.on("STATE_SNAPSHOT", (s: any) => this.onSnapshot(s)),
      this.network.on("STATE_DELTA",    (d: any) => this.onDelta(d)),
      this.network.on("MATCH_END",      (p: MatchEndPayload) => this.onMatchEnd(p)),
      this.network.on("ROUND_END",      (p: any) => this.onRoundEnd(p)),
      this.network.on("INPUT_ACK",      (p: any) => this.predictor.acknowledge(p.seq)),
      this.network.on("REMATCH_START",  () => this.scene.restart()),
      this.network.on("LATENCY",        ({ latencyMs }: any) => this.hud.setLatency(latencyMs)),
      this.network.on("DISCONNECTED",   () => this.hud.setConnectionStatus(false)),
      this.network.on("RECONNECTING",   ({ attempt }: any) => this.hud.showReconnectBanner(`RECONNECTING ${attempt}/8`)),
      this.network.on("STATE_SNAPSHOT", () => this.hud.setConnectionStatus(true)),
      this.network.on("REMATCH_DECLINED", () => this.showPhaseText("REMATCH DECLINED")),
    ];

    // Get our player ID from the network session
    this.myPlayerId = this.network.getPlayerId();

    // Show waiting for escrow message
    this.showPhaseText("ESCROW LOCKING...");
  }

  update(time: number, delta: number): void {
    if (this.currentPhase !== "fighting" && this.currentPhase !== "countdown") return;

    this.tickAccum += delta;
    while (this.tickAccum >= this.TICK_MS) {
      this.tickAccum -= this.TICK_MS;
      this.clientTick();
    }

    // Render local prediction and remote interpolation every frame.
    this.interpolateSprites(performance.now());

    // Update HUD
    if (this.serverState) {
      this.hud.update(this.serverState, this.myPlayerId);
      const mine = this.serverState.fighters[this.myPlayerId];
      this.audio.setLowHealthTension(Boolean(mine && mine.hp > 0 && mine.hp <= C.MAX_HP * 0.25));
    }
  }

  // ─── Client Simulation Tick ─────────────────────────────────

  private clientTick(): void {
    const input = this.inputManager.sample();
    const msg = {
      ...input,
      seq: ++this.inputSeq,
      tick: this.predictor.getPredictedServerTick() + 1,
      timestamp: Date.now(),
    };

    // Client prediction: apply input locally for zero-latency feel
    const myFighter = this.predictor.getLocalFighter(this.myPlayerId);
    if (myFighter) {
      this.predictor.applyInput(myFighter, input);
    }

    // Send every simulation tick; the server tick rate and anti-cheat limit are aligned at 20Hz.
    this.network.sendInput(msg);
    this.predictor.pushInput(msg);
    this.inputManager.clearMomentary();
  }

  // ─── Server State Handling ──────────────────────────────────

  private onSnapshot(snapshot: { tick: number; state: GameState; yourPlayerId: string }): void {
    this.myPlayerId = snapshot.yourPlayerId;
    this.serverState = snapshot.state;
    this.currentPhase = snapshot.state.phase;

    // Reconcile predictor with authoritative state
    this.predictor.reconcile(snapshot.state, this.myPlayerId);
    this.processCombatFeel(snapshot.state);

    // Create sprites for all fighters if not yet done
    for (const [pid, fs] of Object.entries(snapshot.state.fighters)) {
      if (!this.fighters.has(pid)) {
        this.spawnFighter(pid, fs, pid === this.myPlayerId);
      }
    }

    this.updatePhaseUI(snapshot.state);
  }

  private onDelta(delta: any): void {
    if (!this.serverState) return;

    // Apply delta patch to server state
    if (delta.fighters) {
      for (const [pid, patch] of Object.entries(delta.fighters as any)) {
        const existing = this.serverState.fighters[pid];
        if (existing) Object.assign(existing, patch);
      }
    }
    if (delta.matchTimer !== undefined) this.serverState.matchTimer = delta.matchTimer;
    if (delta.phase)       this.currentPhase = delta.phase;
    if (delta.roundWinner !== undefined) this.serverState.roundWinner = delta.roundWinner;

    // Reconcile if fighter state has authoritative updates
    if (delta.fighters) this.predictor.reconcile(this.serverState, this.myPlayerId);
    this.processCombatFeel(this.serverState);

    this.updatePhaseUI(this.serverState);
  }

  // ─── Visual Updates ──────────────────────────────────────────

  private interpolateSprites(now: number): void {
    for (const [pid, sprite] of this.fighters) {
      const render = this.predictor.getRenderFighter(pid, pid === this.myPlayerId, now);
      if (!render) continue;

      if (performance.now() >= this.hitstopUntil) {
        sprite.setPosition(render.pos.x, render.pos.y);
        sprite.updateAnimation(render.actionState, render.facing);
        sprite.updateReadiness(render.attackCooldown <= 0, render.specialCooldown <= 0);
      }

      // Hit flash effect
      if (render.stunTicks > 0 && (render.stunTicks % 2 === 0)) {
        sprite.setTint(0xff6666);
      } else {
        sprite.clearTint();
      }
    }
  }

  private spawnFighter(playerId: string, state: FighterState, isLocal: boolean): void {
    const opponentId = this.selectedFighter === "sokak-krali" ? "golge-danscisi" : "sokak-krali";
    const fighterId = isLocal ? this.selectedFighter : opponentId;
    const texture = `fighter_${fighterId}`;
    const sprite = new FighterSprite(this, state.pos.x, state.pos.y, texture, playerId, isLocal, getFighter(fighterId));
    this.fighters.set(playerId, sprite);
    this.predictor.initFighter(playerId, state);
  }

  private processCombatFeel(state: GameState): void {
    for (const [playerId, fighter] of Object.entries(state.fighters)) {
      const prevHp = this.previousHp.get(playerId);
      const prevAction = this.previousAction.get(playerId);

      if (prevAction !== fighter.actionState) {
        this.handleActionTransition(playerId, fighter, prevAction);
      }

      if (prevHp !== undefined && fighter.hp < prevHp) {
        this.handleConfirmedDamage(playerId, fighter, prevHp - fighter.hp);
      }

      this.previousHp.set(playerId, fighter.hp);
      this.previousAction.set(playerId, fighter.actionState);
    }
  }

  private handleActionTransition(playerId: string, fighter: FighterState, previousAction?: string): void {
    const sprite = this.fighters.get(playerId);
    if (!sprite) return;

    if (fighter.actionState === "attacking" && previousAction !== "attacking") {
      sprite.playAnticipation("attack");
      if (playerId === this.myPlayerId) this.audio.playUI();
    }
    if (fighter.actionState === "special" && previousAction !== "special") {
      sprite.playAnticipation("special");
      this.fx.spawnSpecialFX(fighter.pos.x, fighter.pos.y, sprite.accentColor);
      this.audio.playSpecial();
    }
  }

  private handleConfirmedDamage(targetId: string, target: FighterState, damage: number): void {
    const sprite = this.fighters.get(targetId);
    const isHeavy = damage >= C.SPECIAL_DAMAGE;
    const isCombo = damage > C.ATTACK_DAMAGE && damage < C.SPECIAL_DAMAGE;
    const hitstopMs = isHeavy ? 105 : isCombo ? 85 : 62;

    this.hitstopUntil = Math.max(this.hitstopUntil, performance.now() + hitstopMs);
    this.fx.hitStop(hitstopMs);
    this.fx.spawnHitFX(target.pos.x, target.pos.y, isCombo, sprite?.accentColor);
    this.fx.spawnDamageNumber(target.pos.x, target.pos.y, damage, isCombo, isHeavy);
    this.fx.playHit(isCombo);
    this.audio.playHit(isCombo, isHeavy);

    if (sprite) {
      sprite.flashHit();
      sprite.freezeVisual(hitstopMs);
    }

    for (const other of this.fighters.values()) {
      if (other.playerId !== targetId) other.freezeVisual(Math.max(40, hitstopMs - 20));
    }

    if (isHeavy) this.fx.screenShake(170, 0.011);

    this.comboHits = isCombo ? Math.max(2, this.comboHits + 1) : 1;
    if (this.comboHits >= 2) {
      this.fx.showComboCounter(this.comboHits, damage);
      this.hud.pulseCombo(this.comboHits);
    }
    this.comboResetTimer?.remove(false);
    this.comboResetTimer = this.time.delayedCall(700, () => {
      this.comboHits = 0;
      this.comboResetTimer = undefined;
    });

    if (target.hp <= 0 && !this.koShown) {
      this.koShown = true;
      this.fx.playKO();
      this.audio.playKO();
      this.fx.spawnKOFX(target.pos.x, target.pos.y);
      this.fx.showKOText(this.scale.width / 2, this.scale.height / 2);
      this.fx.showFinishOverlay(targetId !== this.myPlayerId);
      sprite?.playDeathAnim();
      this.fx.screenShake(360, 0.018);
    }

    const mine = this.serverState?.fighters[this.myPlayerId];
    this.audio.setLowHealthTension(Boolean(mine && mine.hp > 0 && mine.hp <= C.MAX_HP * 0.25));
  }

  // ─── Phase UI ────────────────────────────────────────────────

  private updatePhaseUI(state: GameState): void {
    switch (state.phase) {
      case "countdown": {
        this.koShown = false;
        this.comboHits = 0;
        const seconds = Math.ceil(state.matchTimer / C.TICK_RATE);
        this.showCountdown(seconds);
        break;
      }
      case "fighting":
        this.lastCountdownSecond = null;
        this.hideCountdown();
        break;
      case "round_end":
        if (state.roundWinner) {
          const isMe = state.roundWinner === this.myPlayerId;
          this.showPhaseText(isMe ? "ROUND WIN!" : "ROUND LOST");
        }
        break;
    }
  }

  private showCountdown(seconds: number): void {
    const clamped = Math.max(0, seconds);
    if (!this.countdownText) {
      this.countdownText = this.add.text(
        this.scale.width / 2, this.scale.height / 2,
        "",
        { fontSize: "72px", color: "#ffffff", fontFamily: "Courier New",
          stroke: "#000", strokeThickness: 6 }
      ).setOrigin(0.5).setDepth(200);
    }
    this.countdownText.setText(clamped > 0 ? clamped.toString() : "FIGHT!");
    this.countdownText.setScale(1);
    if (this.lastCountdownSecond === clamped) return;
    this.lastCountdownSecond = clamped;
    if (clamped === 0) {
      this.tweens.add({
        targets: this.countdownText, scale: 2, alpha: 0,
        duration: 800, onComplete: () => this.countdownText?.destroy()
      });
      this.audio.playCountdown(1.5);
    } else {
      this.audio.playCountdown();
    }
  }

  private hideCountdown(): void {
    if (this.countdownText) {
      this.countdownText.destroy();
      (this.countdownText as any) = null;
    }
  }

  private showPhaseText(text: string): void {
    if (this.phaseText) this.phaseText.destroy();
    this.phaseText = this.add.text(
      this.scale.width / 2, 40, text,
      { fontSize: "18px", color: "#00ff88", fontFamily: "Courier New",
        stroke: "#000", strokeThickness: 3 }
    ).setOrigin(0.5).setDepth(200);

    this.tweens.add({
      targets: this.phaseText, alpha: 0, delay: 2000, duration: 500,
      onComplete: () => this.phaseText?.destroy(),
    });
  }

  private async onRoundEnd(payload: any): Promise<void> {
    const isWinner = payload.winnerId === this.myPlayerId;
    this.showPhaseText(isWinner ? `ROUND ${payload.round}: WIN!` : `ROUND ${payload.round}: DEFEAT`);
  }

  private onMatchEnd(payload: MatchEndPayload): void {
    this.fx.stopBGM();
    this.audio.setLowHealthTension(false);
    this.time.delayedCall(1500, () => {
      this.scene.start("ResultScene", {
        result: payload,
        myPlayerId: this.myPlayerId,
      });
    });
  }

  // ─── Arena Drawing ───────────────────────────────────────────

  private drawArena(): void {
    const { width, height } = this.scale;
    const arena = getArena(this.selectedArena);

    // Background
    this.add.image(width / 2, height / 2, `arena_${arena.id}`).setDisplaySize(width, height);
    this.add.rectangle(0, 0, width, height, 0x050511, 0.18).setOrigin(0);
    this.drawArenaAtmosphere(arena);

    // Platform/ground
    const g = this.add.graphics();
    g.fillStyle(arena.palette.floor, 0.96);
    g.fillRect(0, C.GROUND_Y + C.FIGHTER_HEIGHT / 2, width, height - C.GROUND_Y);
    g.lineStyle(3, arena.palette.neonA, 0.9);
    g.lineBetween(0, C.GROUND_Y + C.FIGHTER_HEIGHT / 2, width, C.GROUND_Y + C.FIGHTER_HEIGHT / 2);
  }

  private drawArenaAtmosphere(arena: ReturnType<typeof getArena>): void {
    const { width, height } = this.scale;
    for (let i = 0; i < 18; i++) {
      const color = i % 2 ? arena.palette.neonA : arena.palette.neonB;
      const dot = this.add.circle((i * 97) % width, 96 + ((i * 41) % 220), 1 + (i % 3), color, 0.28)
        .setDepth(1);
      this.tweens.add({
        targets: dot,
        y: dot.y - 18 - (i % 5) * 4,
        alpha: 0.05,
        yoyo: true,
        repeat: -1,
        duration: 1600 + i * 90,
        ease: "Sine.InOut",
      });
    }

    const sign = this.add.text(width / 2, 78, arena.name.toUpperCase(), {
      fontSize: "18px",
      color: "#ffffff",
      fontFamily: "Courier New",
      stroke: "#000000",
      strokeThickness: 5,
    }).setOrigin(0.5).setDepth(2).setAlpha(0.78);
    this.tweens.add({
      targets: sign,
      alpha: 0.38,
      yoyo: true,
      repeat: -1,
      duration: 740,
      ease: "Stepped",
    });
  }

  private mountMobileControls(): void {
    const isTouch = this.sys.game.device.input.touch;
    if (!isTouch && this.scale.width > 700) return;
    this.mobileControls = this.inputManager.createMobileControls(this);
    this.scale.on("resize", this.positionMobileControls, this);
    this.positionMobileControls();
  }

  private positionMobileControls(): void {
    if (!this.mobileControls) return;
    this.mobileControls.setPosition(0, 0);
  }

  shutdown(): void {
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;
    this.unsubscribeNetwork.forEach(unsub => unsub());
    this.unsubscribeNetwork = [];
    this.mobileControls?.destroy(true);
    this.inputManager?.destroy();
    this.fx?.destroy();
    this.audio?.destroy();
    this.scale.off("resize", this.positionMobileControls, this);
    if (this.visibilityHandler) document.removeEventListener("visibilitychange", this.visibilityHandler);
  }
}

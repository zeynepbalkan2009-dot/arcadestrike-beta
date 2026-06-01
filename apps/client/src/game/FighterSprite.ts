/**
 * FighterSprite
 *
 * Phaser GameObject that renders one fighter.
 * Driven entirely by authoritative state from the server
 * (via ClientPredictor interpolation).
 *
 * Responsibilities:
 *  - Play correct animation for each ActionState
 *  - Flip sprite based on facing direction
 *  - Render player name + "YOU" badge
 *  - Hit flash, death fade
 */
import Phaser from "phaser";
import type { FighterDefinition } from "./CanonContent";

const ANIM_MAP: Record<string, string> = {
  idle:       "idle",
  walking:    "walk",
  jumping:    "jump",
  attacking:  "attack",
  special:    "special",
  hit:        "hit",
  knockback:  "hit",
  dead:       "dead",
  blocking:   "idle",
};

export class FighterSprite extends Phaser.GameObjects.Container {
  private sprite: Phaser.GameObjects.Sprite;
  private shadow: Phaser.GameObjects.Ellipse;
  private nameTag: Phaser.GameObjects.Text;
  private readinessRing: Phaser.GameObjects.Arc;
  private badgeText: Phaser.GameObjects.Text | null = null;

  private currentAnim = "";
  private lastFacing  = 1;
  private attackTween?: Phaser.Tweens.Tween;
  private transitionTween?: Phaser.Tweens.Tween;
  private recoveryTween?: Phaser.Tweens.Tween;
  public  playerId: string;
  public  isLocal: boolean;
  public  accentColor: number;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    textureKey: string,
    playerId: string,
    isLocal: boolean,
    private readonly fighter?: FighterDefinition
  ) {
    super(scene, x, y);
    this.playerId = playerId;
    this.isLocal  = isLocal;
    this.accentColor = fighter?.palette.glow ?? (isLocal ? 0x00ff88 : 0xff4444);

    // ─── Sprite ──────────────────────────────────────────────
    this.shadow = scene.add.ellipse(0, 2, 46, 10, 0x000000, 0.42).setOrigin(0.5, 0.5);
    this.add(this.shadow);

    this.sprite = scene.add.sprite(0, 0, textureKey).setOrigin(0.5, 1);
    this.add(this.sprite);

    this.readinessRing = scene.add.circle(0, -42, 36, this.accentColor, 0)
      .setStrokeStyle(2, this.accentColor, 0)
      .setDepth(9);
    this.add(this.readinessRing);

    // ─── Name tag ────────────────────────────────────────────
    const color = isLocal ? "#00ff88" : "#ff4444";
    this.nameTag = scene.add.text(0, -95, isLocal ? "YOU" : "OPP", {
      fontSize: "11px",
      color,
      fontFamily: "Courier New",
      stroke: "#000",
      strokeThickness: 3,
    }).setOrigin(0.5, 1);
    this.add(this.nameTag);

    if (fighter) {
      const archetype = scene.add.text(0, -124, fighter.archetype.toUpperCase(), {
        fontSize: "8px",
        color: "#d7f9ff",
        fontFamily: "Courier New",
        stroke: "#000",
        strokeThickness: 3,
      }).setOrigin(0.5, 1).setAlpha(isLocal ? 0.95 : 0.7);
      this.add(archetype);
    }

    // "YOU" indicator badge for local player
    if (isLocal) {
      const arrow = scene.add.text(0, -110, "▼", {
        fontSize: "12px", color: "#00ff88", fontFamily: "Courier New",
      }).setOrigin(0.5);
      this.add(arrow);
      scene.tweens.add({
        targets: arrow, y: "-=6",
        yoyo: true, repeat: -1, duration: 600, ease: "Sine.InOut",
      });
    }

    scene.add.existing(this);
    this.setDepth(10);
    this.playAnim("idle");
  }

  // ─── State sync ──────────────────────────────────────────────

  updateAnimation(actionState: string, facing: number): void {
    // Flip sprite based on facing direction
    if (facing !== this.lastFacing) {
      this.sprite.setFlipX(facing === -1);
      this.lastFacing = facing;
    }

    const animKey = ANIM_MAP[actionState] || "idle";
    this.playAnim(animKey);
    this.applyStatePose(actionState);
  }

  updateReadiness(attackReady: boolean, specialReady: boolean): void {
    if (!this.isLocal) return;
    const alpha = specialReady ? 0.9 : attackReady ? 0.45 : 0;
    const color = specialReady ? (this.fighter?.palette.accent ?? 0xaa44ff) : this.accentColor;
    this.readinessRing.setStrokeStyle(specialReady ? 3 : 2, color, alpha);
    if (alpha > 0 && !this.recoveryTween?.isPlaying()) {
      this.readinessRing.setScale(0.92);
      this.scene.tweens.add({
        targets: this.readinessRing,
        scale: 1.04,
        alpha: 0.85,
        yoyo: true,
        duration: 260,
        ease: "Sine.InOut",
      });
    }
  }

  playAnticipation(kind: "attack" | "special"): void {
    this.attackTween?.stop();
    const lean = kind === "special" ? -7 : -4;
    const heavy = this.fighter?.silhouette === "chains" || this.fighter?.silhouette === "claws";
    const stretch = kind === "special" ? (heavy ? 1.12 : 1.08) : 1.04;
    this.sprite.setScale(1, 1);
    this.attackTween = this.scene.tweens.add({
      targets: this.sprite,
      x: lean * this.lastFacing,
      angle: kind === "special" ? -3 * this.lastFacing : -1.5 * this.lastFacing,
      scaleX: stretch,
      scaleY: 0.96,
      duration: kind === "special" ? 95 : 65,
      yoyo: true,
      ease: "Sine.Out",
      onComplete: () => {
        this.sprite.setX(0);
        this.sprite.setAngle(0);
        this.sprite.setScale(1, 1);
      },
    });
  }

  freezeVisual(durationMs: number): void {
    this.sprite.anims.pause();
    this.scene.time.delayedCall(durationMs, () => {
      if (this.active) this.sprite.anims.resume();
    });
  }

  private playAnim(key: string): void {
    const fullKey = `${this.isLocal ? "p1" : "p2"}_${key}`;
    if (this.currentAnim === fullKey) return;

    // Don't interrupt death animation
    if (this.currentAnim.endsWith("_dead")) return;

    try {
      this.sprite.play(fullKey, true);
      this.currentAnim = fullKey;
    } catch {
      // Spritesheet not loaded in dev — silently skip
    }
  }

  // ─── Visual FX ───────────────────────────────────────────────

  flashHit(): void {
    this.recoveryTween?.stop();
    this.sprite.setX(8 * -this.lastFacing);
    this.sprite.setAngle(4 * -this.lastFacing);
    this.scene.tweens.add({
      targets:  this.sprite,
      tint:     0xff6666,
      duration: 60,
      yoyo:     true,
      repeat:   2,
      onComplete: () => {
        this.sprite.clearTint();
        this.recoveryTween = this.scene.tweens.add({
          targets: this.sprite,
          x: 0,
          angle: 0,
          duration: 110,
          ease: "Cubic.Out",
        });
      },
    });
  }

  setTint(color: number): this {
    this.sprite.setTint(color);
    return this;
  }

  clearTint(): this {
    this.sprite.clearTint();
    return this;
  }

  playDeathAnim(): void {
    this.scene.tweens.add({
      targets:  this,
      alpha:    0,
      y:        this.y + 20,
      duration: 600,
      ease:     "Power2",
      delay:    200,
    });
  }

  showComboText(hits: number, damage: number): void {
    const text = this.scene.add.text(
      this.x, this.y - 120,
      hits >= 2 ? `${hits}x COMBO! -${damage}` : `-${damage}`,
      {
        fontSize:        hits >= 2 ? "18px" : "14px",
        color:           hits >= 2 ? "#ffdd00" : "#ffffff",
        fontFamily:      "Courier New",
        stroke:          "#000",
        strokeThickness: 3,
      }
    ).setOrigin(0.5).setDepth(50);

    this.scene.tweens.add({
      targets:  text,
      y:        text.y - 30,
      alpha:    0,
      duration: 900,
      ease:     "Power1",
      onComplete: () => text.destroy(),
    });
  }

  setPosition(x: number, y: number): this {
    super.setPosition(x, y);
    return this;
  }

  private applyStatePose(actionState: string): void {
    this.transitionTween?.stop();
    const pose = {
      idle: { y: 0, sx: 1, sy: 1, shadow: 1 },
      walking: { y: 0, sx: 1.02, sy: 0.99, shadow: 1.05 },
      jumping: { y: -3, sx: 0.96, sy: 1.04, shadow: 0.75 },
      attacking: { y: 0, sx: 1.05, sy: 0.97, shadow: 1.05 },
      special: { y: -1, sx: 1.08, sy: 0.95, shadow: 1.08 },
      hit: { y: 2, sx: 1.06, sy: 0.94, shadow: 1.1 },
      dead: { y: 8, sx: 1.1, sy: 0.82, shadow: 1.2 },
    }[actionState] ?? { y: 0, sx: 1, sy: 1, shadow: 1 };

    this.transitionTween = this.scene.tweens.add({
      targets: this.sprite,
      y: pose.y,
      scaleX: pose.sx,
      scaleY: pose.sy,
      duration: actionState === "idle" ? 120 : 70,
      ease: "Sine.Out",
    });
    this.shadow.setScale(pose.shadow, Math.max(0.65, 1 / pose.shadow));
  }
}

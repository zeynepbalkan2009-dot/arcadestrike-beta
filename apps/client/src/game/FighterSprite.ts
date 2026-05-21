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
  private nameTag: Phaser.GameObjects.Text;
  private badgeText: Phaser.GameObjects.Text | null = null;

  private currentAnim = "";
  private lastFacing  = 1;
  private attackTween?: Phaser.Tweens.Tween;
  public  playerId: string;
  public  isLocal: boolean;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    textureKey: string,
    playerId: string,
    isLocal: boolean
  ) {
    super(scene, x, y);
    this.playerId = playerId;
    this.isLocal  = isLocal;

    // ─── Sprite ──────────────────────────────────────────────
    this.sprite = scene.add.sprite(0, 0, textureKey).setOrigin(0.5, 1);
    this.add(this.sprite);

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
  }

  playAnticipation(kind: "attack" | "special"): void {
    this.attackTween?.stop();
    const lean = kind === "special" ? -7 : -4;
    const stretch = kind === "special" ? 1.08 : 1.04;
    this.sprite.setScale(1, 1);
    this.attackTween = this.scene.tweens.add({
      targets: this.sprite,
      x: lean * this.lastFacing,
      scaleX: stretch,
      scaleY: 0.96,
      duration: kind === "special" ? 95 : 65,
      yoyo: true,
      ease: "Sine.Out",
      onComplete: () => {
        this.sprite.setX(0);
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
    this.scene.tweens.add({
      targets:  this.sprite,
      tint:     0xff6666,
      duration: 60,
      yoyo:     true,
      repeat:   2,
      onComplete: () => this.sprite.clearTint(),
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
}

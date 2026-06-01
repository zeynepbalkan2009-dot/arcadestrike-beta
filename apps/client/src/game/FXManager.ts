/**
 * FXManager
 *
 * Manages all visual and audio effects:
 *  - Hit sparks
 *  - KO explosion
 *  - Special move aura
 *  - Screen shake
 *  - Sound playback with volume control
 *
 * All effects are fire-and-forget — no external management needed.
 */
import Phaser from "phaser";

export class FXManager {
  private scene: Phaser.Scene;
  private sfxVolume = 0.8;
  private musicVolume = 0.4;
  private bgm: Phaser.Sound.BaseSound | null = null;
  private isMuted = false;
  private pooledTexts: Phaser.GameObjects.Text[] = [];
  private pooledCircles: Phaser.GameObjects.Arc[] = [];

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  // ─── Audio ───────────────────────────────────────────────────

  playBGM(): void {
    if (this.bgm?.isPlaying) return;
    try {
      this.bgm = this.scene.sound.add("bgm_fight", {
        loop:   true,
        volume: this.isMuted ? 0 : this.musicVolume,
      });
      this.bgm.play();
    } catch { /* audio not loaded */ }
  }

  stopBGM(): void {
    this.bgm?.stop();
    this.bgm = null;
  }

  playHit(isCombo = false): void {
    this.playSFX("hit_sound", isCombo ? 1.0 : 0.7);
  }

  playSpecial(): void {
    this.playSFX("special_sound", 1.0);
  }

  playKO(): void {
    this.playSFX("ko_sound", 1.0);
    this.stopBGM();
  }

  playCountdownBeep(pitch: number = 1.0): void {
    this.playSFX("countdown_beep", 0.6, pitch);
  }

  private playSFX(key: string, volume = 0.7, rate = 1.0): void {
    if (this.isMuted) return;
    try {
      this.scene.sound.play(key, {
        volume: volume * this.sfxVolume,
        rate,
      });
    } catch { /* not loaded */ }
  }

  toggleMute(): boolean {
    this.isMuted = !this.isMuted;
    if (this.bgm) {
      (this.bgm as any).setVolume(this.isMuted ? 0 : this.musicVolume);
    }
    return this.isMuted;
  }

  // ─── Hit FX ──────────────────────────────────────────────────

  spawnHitFX(x: number, y: number, isCombo: boolean, accentColor = 0xffffff): void {
    const scale = isCombo ? 1.4 : 1.0;

    try {
      const fx = this.scene.add.sprite(x, y - 30, "hit_fx")
        .setScale(scale)
        .setDepth(100);
      fx.play("hit_fx");
      fx.on("animationcomplete", () => fx.destroy());
    } catch {
      // Fallback: simple circle burst
      this.spawnCircleBurst(x, y - 30, isCombo ? 0xffdd00 : accentColor, scale);
    }

    if (isCombo) this.spawnComboFlash(x, y);
  }

  spawnDamageNumber(x: number, y: number, damage: number, isCombo: boolean, isHeavy: boolean): void {
    const text = this.getPooledText();
    text
      .setPosition(x, y - 96)
      .setText(`-${damage}`)
      .setStyle({
        fontSize: isHeavy ? "26px" : isCombo ? "22px" : "18px",
        color: isHeavy ? "#ff6644" : isCombo ? "#ffdd00" : "#ffffff",
        fontFamily: "Courier New",
        stroke: "#000000",
        strokeThickness: 5,
      })
      .setOrigin(0.5)
      .setDepth(260)
      .setScale(0.8)
      .setAlpha(1)
      .setVisible(true);

    this.scene.tweens.add({
      targets: text,
      y: text.y - 44,
      x: x + (isCombo ? 18 : -12),
      alpha: 0,
      scale: 1.15,
      duration: isHeavy ? 760 : 620,
      ease: "Cubic.Out",
      onComplete: () => this.releaseText(text),
    });
  }

  showComboCounter(hits: number, damage: number): void {
    if (hits < 2) return;
    const { width } = this.scene.scale;
    const text = this.scene.add.text(width / 2, 92, `${hits} HIT COMBO`, {
      fontSize: "24px",
      color: "#ffdd00",
      fontFamily: "Courier New",
      stroke: "#000000",
      strokeThickness: 6,
    }).setOrigin(0.5).setDepth(280).setScale(0.7);

    const sub = this.scene.add.text(width / 2, 120, `${damage} DAMAGE`, {
      fontSize: "12px",
      color: "#ffffff",
      fontFamily: "Courier New",
      stroke: "#000000",
      strokeThickness: 4,
    }).setOrigin(0.5).setDepth(280).setAlpha(0.9);

    this.scene.tweens.add({
      targets: text,
      scale: 1,
      duration: 120,
      ease: "Back.Out",
      onComplete: () => {
        this.scene.tweens.add({
          targets: [text, sub],
          alpha: 0,
          y: "-=18",
          delay: 420,
          duration: 220,
          onComplete: () => {
            text.destroy();
            sub.destroy();
          },
        });
      },
    });
  }

  spawnKOFX(x: number, y: number): void {
    try {
      const fx = this.scene.add.sprite(x, y, "ko_fx")
        .setScale(1.5)
        .setDepth(200);
      fx.play("ko_fx");
      fx.on("animationcomplete", () => fx.destroy());
    } catch {
      this.spawnCircleBurst(x, y, 0xff4400, 2.5);
    }

    this.screenShake(300, 0.015);
  }

  spawnSpecialFX(x: number, y: number, accentColor = 0xaa44ff): void {
    try {
      const fx = this.scene.add.sprite(x, y - 20, "special_fx")
        .setScale(1.2)
        .setDepth(80);
      fx.play("special_fx");
      fx.on("animationcomplete", () => fx.destroy());
    } catch {
      this.spawnCircleBurst(x, y - 20, accentColor, 1.8);
    }
  }

  screenShake(duration = 150, intensity = 0.008): void {
    this.scene.cameras.main.shake(duration, intensity);
  }

  hitStop(durationMs = 70): void {
    this.flashScreen(0xffffff, 0.12, Math.min(durationMs, 90));
  }

  // ─── UI FX ───────────────────────────────────────────────────

  flashScreen(color = 0xffffff, alpha = 0.4, duration = 120): void {
    const flash = this.scene.add.rectangle(
      0, 0,
      this.scene.scale.width,
      this.scene.scale.height,
      color, alpha
    ).setOrigin(0).setDepth(500);

    this.scene.tweens.add({
      targets:  flash,
      alpha:    0,
      duration,
      onComplete: () => flash.destroy(),
    });
  }

  showKOText(cx: number, cy: number): void {
    const txt = this.scene.add.text(cx, cy, "K.O.!", {
      fontSize:        "80px",
      color:           "#ff4400",
      fontFamily:      "Courier New",
      stroke:          "#000",
      strokeThickness: 8,
    }).setOrigin(0.5).setDepth(300).setScale(0.1);

    this.scene.tweens.add({
      targets:  txt,
      scale:    1.2,
      duration: 400,
      ease:     "Back.Out",
      onComplete: () => {
        this.scene.tweens.add({
          targets: txt, alpha: 0, delay: 800, duration: 400,
          onComplete: () => txt.destroy(),
        });
      },
    });
  }

  showFinishOverlay(winnerIsLocal: boolean): void {
    const { width, height } = this.scene.scale;
    const overlay = this.scene.add.rectangle(0, 0, width, height, 0x000000, 0.1)
      .setOrigin(0)
      .setDepth(240);
    const banner = this.scene.add.rectangle(width / 2, height / 2, width, 86, winnerIsLocal ? 0x00ff88 : 0xff3344, 0.16)
      .setDepth(241);
    const label = this.scene.add.text(width / 2, height / 2, winnerIsLocal ? "FINISH!" : "K.O.", {
      fontSize: "58px",
      color: winnerIsLocal ? "#00ff88" : "#ff6644",
      fontFamily: "Courier New",
      stroke: "#000000",
      strokeThickness: 8,
    }).setOrigin(0.5).setDepth(242).setScale(0.8);

    this.scene.tweens.add({
      targets: label,
      scale: 1.08,
      duration: 180,
      ease: "Back.Out",
    });
    this.scene.tweens.add({
      targets: [overlay, banner, label],
      alpha: 0,
      delay: 1050,
      duration: 420,
      onComplete: () => {
        overlay.destroy();
        banner.destroy();
        label.destroy();
      },
    });
  }

  showFightText(cx: number, cy: number): void {
    const txt = this.scene.add.text(cx, cy, "FIGHT!", {
      fontSize:        "64px",
      color:           "#00ff88",
      fontFamily:      "Courier New",
      stroke:          "#000",
      strokeThickness: 6,
    }).setOrigin(0.5).setDepth(300).setAlpha(0).setScale(2);

    this.scene.tweens.add({
      targets:  txt,
      scale:    1,
      alpha:    1,
      duration: 300,
      ease:     "Back.Out",
      onComplete: () => {
        this.scene.tweens.add({
          targets: txt, alpha: 0, scale: 1.5, delay: 500, duration: 300,
          onComplete: () => txt.destroy(),
        });
      },
    });
  }

  // ─── Particle fallback ───────────────────────────────────────

  private spawnCircleBurst(x: number, y: number, color: number, scale: number): void {
    const count = Math.floor(6 * scale);
    for (let i = 0; i < count; i++) {
      const angle  = (i / count) * Math.PI * 2;
      const speed  = 70 + ((i * 37) % 48);
      const circle = this.getPooledCircle(x, y, 4 * scale, color).setDepth(100);

      this.scene.tweens.add({
        targets:  circle,
        x:        x + Math.cos(angle) * speed,
        y:        y + Math.sin(angle) * speed - 20,
        alpha:    0,
        scale:    0,
        duration: 350 + ((i * 53) % 160),
        ease:     "Power2",
        onComplete: () => this.releaseCircle(circle),
      });
    }
  }

  private spawnComboFlash(x: number, y: number): void {
    const flash = this.scene.add.circle(x, y, 60, 0xffdd00, 0.5).setDepth(90);
    this.scene.tweens.add({
      targets: flash, scaleX: 2, scaleY: 2, alpha: 0,
      duration: 200,
      onComplete: () => flash.destroy(),
    });
  }

  destroy(): void {
    this.stopBGM();
    this.pooledTexts.forEach(text => text.destroy());
    this.pooledCircles.forEach(circle => circle.destroy());
    this.pooledTexts = [];
    this.pooledCircles = [];
  }

  private getPooledText(): Phaser.GameObjects.Text {
    return this.pooledTexts.pop() ?? this.scene.add.text(0, 0, "", {
      fontFamily: "Courier New",
      fontSize: "18px",
      color: "#ffffff",
    });
  }

  private releaseText(text: Phaser.GameObjects.Text): void {
    text.setVisible(false).setAlpha(0);
    this.pooledTexts.push(text);
  }

  private getPooledCircle(x: number, y: number, radius: number, color: number): Phaser.GameObjects.Arc {
    const circle = this.pooledCircles.pop() ?? this.scene.add.circle(x, y, radius, color, 1);
    circle
      .setPosition(x, y)
      .setRadius(radius)
      .setFillStyle(color, 1)
      .setScale(1)
      .setAlpha(1)
      .setVisible(true);
    return circle;
  }

  private releaseCircle(circle: Phaser.GameObjects.Arc): void {
    circle.setVisible(false).setAlpha(0);
    this.pooledCircles.push(circle);
  }
}

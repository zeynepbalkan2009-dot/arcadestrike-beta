/**
 * PreloadScene — loads all game assets with progress bar.
 */
import Phaser from "phaser";
import { ARENAS, FIGHTERS, type ArenaDefinition, type FighterDefinition } from "../game/CanonContent";

export class PreloadScene extends Phaser.Scene {
  constructor() { super({ key: "PreloadScene" }); }

  preload(): void {
    this.createProgressBar();

    // ─── Spritesheets (128x80 per frame) ───
    this.load.spritesheet("fighter_p1", "/assets/fighter_p1.png", { frameWidth: 48, frameHeight: 80 });
    this.load.spritesheet("fighter_p2", "/assets/fighter_p2.png", { frameWidth: 48, frameHeight: 80 });

    // ─── Backgrounds ───
    this.load.image("arena_bg", "/assets/arena_bg.png");
    this.load.image("arena_platform", "/assets/arena_platform.png");

    // ─── UI ───
    this.load.image("hp_bar_bg", "/assets/ui/hp_bar_bg.png");
    this.load.image("hp_bar_fill", "/assets/ui/hp_bar_fill.png");
    this.load.image("btn_primary", "/assets/ui/btn_primary.png");
    this.load.image("wager_icon", "/assets/ui/wager_icon.png");

    // ─── FX ───
    this.load.spritesheet("hit_fx", "/assets/fx/hit.png", { frameWidth: 64, frameHeight: 64 });
    this.load.spritesheet("ko_fx",  "/assets/fx/ko.png",  { frameWidth: 128, frameHeight: 128 });
    this.load.spritesheet("special_fx", "/assets/fx/special.png", { frameWidth: 96, frameHeight: 96 });

    // ─── Audio ───
    this.load.audio("hit_sound",     "/assets/audio/hit.ogg");
    this.load.audio("special_sound", "/assets/audio/special.ogg");
    this.load.audio("ko_sound",      "/assets/audio/ko.ogg");
    this.load.audio("bgm_fight",     "/assets/audio/bgm_fight.ogg");
    this.load.audio("bgm_lobby",     "/assets/audio/bgm_lobby.ogg");
    this.load.audio("countdown_beep","/assets/audio/beep.ogg");
  }

  create(): void {
    this.ensureFallbackAssets();
    this.createAnimations();
    this.scene.start("LobbyScene");
  }

  private createProgressBar(): void {
    const { width, height } = this.scale;
    const cx = width / 2;
    const cy = height / 2;

    const bg = this.add.rectangle(cx, cy, 400, 32, 0x333333);
    const bar = this.add.rectangle(cx - 200, cy, 0, 28, 0x00ff88);
    bar.setOrigin(0, 0.5);

    this.add.text(cx, cy - 40, "ARCADESTRIKE", {
      fontSize: "28px", color: "#00ff88", fontFamily: "Courier New",
    }).setOrigin(0.5);

    this.load.on("progress", (value: number) => {
      bar.width = 396 * value;
    });
  }

  private createAnimations(): void {
    const anims = this.anims;
    if (this.textures.get("fighter_p1").frameTotal <= 1 || this.textures.get("fighter_p2").frameTotal <= 1) {
      return;
    }

    // Fighter P1
    [
      { key: "p1_idle",    frames: [0, 1, 2, 3],       frameRate: 8,  repeat: -1 },
      { key: "p1_walk",    frames: [4, 5, 6, 7],       frameRate: 10, repeat: -1 },
      { key: "p1_jump",    frames: [8],                frameRate: 1,  repeat: 0  },
      { key: "p1_attack",  frames: [9, 10, 11],        frameRate: 16, repeat: 0  },
      { key: "p1_special", frames: [12, 13, 14, 15],   frameRate: 16, repeat: 0  },
      { key: "p1_hit",     frames: [16, 17],           frameRate: 10, repeat: 0  },
      { key: "p1_dead",    frames: [18, 19, 20],       frameRate: 8,  repeat: 0  },
    ].forEach(({ key, frames, frameRate, repeat }) => {
      if (!anims.exists(key)) {
        anims.create({ key, frames: anims.generateFrameNumbers("fighter_p1", { frames }), frameRate, repeat });
      }
    });

    // Fighter P2 (same layout, different spritesheet)
    [
      { key: "p2_idle",    frames: [0, 1, 2, 3],       frameRate: 8,  repeat: -1 },
      { key: "p2_walk",    frames: [4, 5, 6, 7],       frameRate: 10, repeat: -1 },
      { key: "p2_jump",    frames: [8],                frameRate: 1,  repeat: 0  },
      { key: "p2_attack",  frames: [9, 10, 11],        frameRate: 16, repeat: 0  },
      { key: "p2_special", frames: [12, 13, 14, 15],   frameRate: 16, repeat: 0  },
      { key: "p2_hit",     frames: [16, 17],           frameRate: 10, repeat: 0  },
      { key: "p2_dead",    frames: [18, 19, 20],       frameRate: 8,  repeat: 0  },
    ].forEach(({ key, frames, frameRate, repeat }) => {
      if (!anims.exists(key)) {
        anims.create({ key, frames: anims.generateFrameNumbers("fighter_p2", { frames }), frameRate, repeat });
      }
    });

    // FX
    anims.create({ key: "hit_fx",     frames: anims.generateFrameNumbers("hit_fx",     { start: 0, end: 5 }), frameRate: 24, repeat: 0 });
    anims.create({ key: "ko_fx",      frames: anims.generateFrameNumbers("ko_fx",      { start: 0, end: 7 }), frameRate: 16, repeat: 0 });
    anims.create({ key: "special_fx", frames: anims.generateFrameNumbers("special_fx", { start: 0, end: 7 }), frameRate: 20, repeat: 0 });
  }

  private ensureFallbackAssets(): void {
    if (!this.textures.exists("fighter_p1")) this.createFallbackFighter("fighter_p1", 0x00ff88);
    if (!this.textures.exists("fighter_p2")) this.createFallbackFighter("fighter_p2", 0xff4444);
    if (!this.textures.exists("arena_bg")) this.createFallbackArena();
    if (!this.textures.exists("hit_fx")) this.createFallbackBurst("hit_fx", 0xffffff, 64);
    if (!this.textures.exists("ko_fx")) this.createFallbackBurst("ko_fx", 0xff4400, 128);
    if (!this.textures.exists("special_fx")) this.createFallbackBurst("special_fx", 0xaa44ff, 96);

    for (const fighter of FIGHTERS) {
      this.createCanonFighterTexture(`fighter_${fighter.id}`, fighter);
      this.createCanonPortrait(`portrait_${fighter.id}`, fighter);
    }
    for (const arena of ARENAS) {
      this.createCanonArenaTexture(`arena_${arena.id}`, arena);
      this.createCanonArenaTexture(`arena_card_${arena.id}`, arena, 240, 104);
    }
  }

  private createFallbackFighter(key: string, color: number): void {
    const g = this.add.graphics();
    g.fillStyle(0x000000, 0.35);
    g.fillEllipse(24, 78, 36, 8);
    g.fillStyle(color, 1);
    g.fillRoundedRect(12, 18, 24, 54, 5);
    g.fillStyle(0xffffff, 0.9);
    g.fillCircle(24, 12, 10);
    g.lineStyle(3, 0x000000, 0.75);
    g.strokeRoundedRect(12, 18, 24, 54, 5);
    g.generateTexture(key, 48, 80);
    g.destroy();
  }

  private createFallbackArena(): void {
    const g = this.add.graphics();
    g.fillGradientStyle(0x07070d, 0x07070d, 0x151529, 0x151529, 1);
    g.fillRect(0, 0, this.scale.width, this.scale.height);
    g.lineStyle(1, 0x00ff88, 0.18);
    for (let x = 0; x < this.scale.width; x += 40) g.lineBetween(x, 0, x, this.scale.height);
    for (let y = 0; y < this.scale.height; y += 40) g.lineBetween(0, y, this.scale.width, y);
    g.generateTexture("arena_bg", this.scale.width, this.scale.height);
    g.destroy();
  }

  private createFallbackBurst(key: string, color: number, size: number): void {
    const g = this.add.graphics();
    g.fillStyle(color, 0.9);
    g.fillCircle(size / 2, size / 2, size * 0.12);
    g.lineStyle(3, color, 0.75);
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2;
      g.lineBetween(
        size / 2,
        size / 2,
        size / 2 + Math.cos(angle) * size * 0.35,
        size / 2 + Math.sin(angle) * size * 0.35
      );
    }
    g.generateTexture(key, size, size);
    g.destroy();
  }

  private createCanonFighterTexture(key: string, fighter: FighterDefinition): void {
    if (this.textures.exists(key)) return;
    const g = this.add.graphics();
    const { primary, secondary, accent, glow } = fighter.palette;
    g.fillStyle(0x000000, 0.38);
    g.fillEllipse(24, 78, 42, 9);
    g.fillStyle(secondary, 1);
    g.fillRoundedRect(12, 20, 24, 48, 4);
    g.fillStyle(primary, 1);
    g.fillRoundedRect(15, 26, 18, 34, 3);
    g.fillStyle(accent, 1);
    g.fillCircle(24, 14, 9);
    g.lineStyle(3, glow, 0.85);

    switch (fighter.silhouette) {
      case "claws":
        g.strokeCircle(8, 42, 10);
        g.strokeCircle(40, 42, 10);
        g.lineBetween(8, 42, 2, 32);
        g.lineBetween(40, 42, 46, 32);
        break;
      case "bat":
        g.lineStyle(5, accent, 1);
        g.lineBetween(9, 24, 42, 8);
        g.lineStyle(2, glow, 0.9);
        g.lineBetween(10, 55, 2, 65);
        break;
      case "naginata":
        g.lineStyle(3, accent, 1);
        g.lineBetween(7, 70, 43, 8);
        g.lineStyle(3, glow, 1);
        g.lineBetween(40, 8, 48, 2);
        break;
      case "chains":
        g.lineStyle(4, accent, 0.95);
        g.strokeCircle(10, 36, 7);
        g.strokeCircle(38, 36, 7);
        g.lineBetween(10, 36, 38, 58);
        break;
      case "hologram":
        g.lineStyle(2, glow, 0.9);
        g.strokeTriangle(24, 4, 6, 60, 42, 60);
        g.strokeCircle(12, 30, 5);
        g.strokeCircle(38, 26, 4);
        break;
    }

    g.lineStyle(2, 0x05050a, 0.9);
    g.strokeRoundedRect(12, 20, 24, 48, 4);
    g.generateTexture(key, 48, 80);
    g.destroy();
  }

  private createCanonPortrait(key: string, fighter: FighterDefinition): void {
    if (this.textures.exists(key)) return;
    const g = this.add.graphics();
    const { primary, secondary, accent, glow } = fighter.palette;
    g.fillGradientStyle(0x111126, 0x111126, secondary, primary, 1);
    g.fillRect(0, 0, 150, 88);
    g.lineStyle(3, glow, 1);
    g.strokeRect(2, 2, 146, 84);
    g.fillStyle(0x05050a, 0.55);
    g.fillRect(10, 10, 130, 68);
    g.fillStyle(primary, 1);
    g.fillRoundedRect(56, 20, 38, 48, 5);
    g.fillStyle(accent, 1);
    g.fillCircle(75, 20, 15);
    g.lineStyle(4, glow, 0.9);
    if (fighter.silhouette === "bat") g.lineBetween(34, 30, 116, 8);
    if (fighter.silhouette === "naginata") g.lineBetween(35, 74, 120, 10);
    if (fighter.silhouette === "chains") g.strokeCircle(45, 44, 14);
    if (fighter.silhouette === "claws") g.strokeCircle(45, 48, 15);
    if (fighter.silhouette === "hologram") g.strokeTriangle(75, 8, 34, 76, 118, 76);
    g.generateTexture(key, 150, 88);
    g.destroy();
  }

  private createCanonArenaTexture(key: string, arena: ArenaDefinition, width = this.scale.width, height = this.scale.height): void {
    if (this.textures.exists(key)) return;
    const g = this.add.graphics();
    const p = arena.palette;
    g.fillGradientStyle(p.sky, p.sky, p.mid, p.floor, 1);
    g.fillRect(0, 0, width, height);
    g.lineStyle(2, p.neonA, 0.28);
    for (let x = 0; x < width; x += 42) g.lineBetween(x, height * 0.58, x + width * 0.12, height);
    for (let y = Math.floor(height * 0.62); y < height; y += 22) g.lineBetween(0, y, width, y + 8);

    if (arena.motif === "arcade") {
      for (let i = 0; i < 6; i++) {
        const x = 18 + i * (width / 6);
        g.fillStyle(i % 2 ? p.neonB : p.neonA, 0.6);
        g.fillRect(x, height * 0.26 + (i % 3) * 10, 48, 26);
        g.fillStyle(0x060611, 0.9);
        g.fillRect(x + 8, height * 0.26 + (i % 3) * 10 + 6, 32, 14);
      }
    } else if (arena.motif === "core") {
      g.lineStyle(2, p.neonB, 0.8);
      g.strokeCircle(width / 2, height * 0.44, Math.min(width, height) * 0.18);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        g.lineBetween(width / 2, height * 0.44, width / 2 + Math.cos(a) * 160, height * 0.44 + Math.sin(a) * 80);
      }
    } else {
      for (let i = 0; i < 9; i++) {
        const x = i * (width / 8);
        g.lineStyle(5, p.neonA, 0.35);
        g.lineBetween(x, height, x + 22 * (i % 2 ? -1 : 1), height * 0.28);
        g.fillStyle(i % 2 ? p.neonB : p.neonA, 0.55);
        g.fillCircle(x + 10, height * 0.36 + (i % 3) * 22, 9);
      }
    }

    g.lineStyle(4, p.neonB, 0.75);
    g.lineBetween(0, height * 0.78, width, height * 0.78);
    g.generateTexture(key, width, height);
    g.destroy();
  }
}

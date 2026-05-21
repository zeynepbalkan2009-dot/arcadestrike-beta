/**
 * PreloadScene — loads all game assets with progress bar.
 */
import Phaser from "phaser";

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
}

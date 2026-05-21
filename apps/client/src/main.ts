/**
 * ArcadeStrike — Phaser 3 entry point
 */
import Phaser from "phaser";
import { BootScene } from "./scenes/BootScene";
import { PreloadScene } from "./scenes/PreloadScene";
import { LobbyScene } from "./scenes/LobbyScene";
import { QueueScene } from "./scenes/QueueScene";
import { FightScene } from "./scenes/FightScene";
import { ResultScene } from "./scenes/ResultScene";
import { GAME_CONSTANTS as C } from "@arcadestrike/shared";

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  width: C.ARENA_WIDTH,
  height: C.ARENA_HEIGHT + 100, // extra for HUD
  parent: "game-container",
  backgroundColor: "#0a0a0f",
  pixelArt: true,
  antialias: false,
  physics: {
    default: "arcade",
    arcade: { gravity: { x: 0, y: 0 }, debug: import.meta.env.DEV },
  },
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    min: { width: 400, height: 250 },
    max: { width: 1600, height: 900 },
  },
  scene: [BootScene, PreloadScene, LobbyScene, QueueScene, FightScene, ResultScene],
};

new Phaser.Game(config);

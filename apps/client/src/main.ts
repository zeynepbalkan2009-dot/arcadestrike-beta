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
import { ReplayScene } from "./scenes/ReplayScene";
import { GAME_CONSTANTS as C } from "@arcadestrike/shared";

function showFatalOverlay(message: string): void {
  const existing = document.getElementById("fatal-overlay");
  if (existing) existing.remove();
  const overlay = document.createElement("div");
  overlay.id = "fatal-overlay";
  overlay.innerHTML = `
    <div class="fatal-panel">
      <strong>ARCADESTRIKE RECOVERY</strong>
      <span>${message}</span>
      <button type="button" onclick="location.reload()">RELOAD</button>
    </div>
  `;
  document.body.appendChild(overlay);
}

window.addEventListener("error", event => {
  showFatalOverlay(event.message || "Runtime error");
});
window.addEventListener("unhandledrejection", event => {
  showFatalOverlay(event.reason?.message || "Unexpected network/runtime error");
});

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  width: C.ARENA_WIDTH,
  height: C.ARENA_HEIGHT + 100, // extra for HUD
  parent: "game-container",
  backgroundColor: "#0a0a0f",
  pixelArt: true,
  antialias: false,
  roundPixels: true,
  powerPreference: "high-performance",
  fps: {
    target: 60,
    min: 30,
    smoothStep: true,
  },
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
  scene: [BootScene, PreloadScene, LobbyScene, QueueScene, FightScene, ResultScene, ReplayScene],
};

new Phaser.Game(config);

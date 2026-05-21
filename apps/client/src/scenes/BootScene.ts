/**
 * BootScene — minimal first scene.
 * Sets up global game config, then moves to Preload.
 */
import Phaser from "phaser";

export class BootScene extends Phaser.Scene {
  constructor() { super({ key: "BootScene" }); }

  preload(): void {
    // Load only what we need for the loading screen
    this.load.image("logo", "/assets/logo.png");
  }

  create(): void {
    // Set global scale settings
    this.scale.on("resize", this.resize, this);
    this.scene.start("PreloadScene");
  }

  private resize(): void {
    // Handled by Phaser Scale Manager
  }
}

import Phaser from 'phaser';

export class PreloadScene extends Phaser.Scene {
  constructor() { super({ key: 'Preload' }); }

  preload(): void {
    this.load.on('progress', (v: number) => {
      // could draw a loading bar here
    });
  }

  create(): void {
    this.scene.start('Lobby');
  }
}

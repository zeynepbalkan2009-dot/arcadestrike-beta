import Phaser from 'phaser';
import { networkManager } from '../network/NetworkManager';

export class BootScene extends Phaser.Scene {
  constructor() { super({ key: 'Boot' }); }

  create(): void {
    const serverUrl = import.meta.env.VITE_SERVER_URL ?? 'ws://localhost:2567';
    networkManager.init(serverUrl);
    this.scene.start('Preload');
  }
}

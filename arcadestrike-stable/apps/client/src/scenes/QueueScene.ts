import Phaser from 'phaser';
import { networkManager } from '../network/NetworkManager';

export class QueueScene extends Phaser.Scene {
  private _statusText!: Phaser.GameObjects.Text;
  private _dotTimer = 0;
  private _dots = 0;

  constructor() { super({ key: 'Queue' }); }

  create(): void {
    const { width, height } = this.scale;

    this.add.text(width / 2, height / 2 - 80, 'FINDING MATCH', {
      fontSize: '36px', color: '#e94560', fontStyle: 'bold',
    }).setOrigin(0.5);

    this._statusText = this.add.text(width / 2, height / 2, 'Searching', {
      fontSize: '22px', color: '#aaaaaa',
    }).setOrigin(0.5);

    const cancelBtn = this.add.text(width / 2, height / 2 + 80, '[ CANCEL ]', {
      fontSize: '18px', color: '#888888',
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });

    cancelBtn.on('pointerdown', () => {
      networkManager.disconnect().then(() => this.scene.start('Lobby'));
    });

    // Register network events
    networkManager.on('countdown', (data) => {
      this.scene.start('Fight', { countdown: data.seconds });
    });

    networkManager.on('error', (data) => {
      this._statusText.setText(`Error: ${data?.message ?? 'Unknown'}`);
      this.time.delayedCall(3000, () => this.scene.start('Lobby'));
    });

    // Join queue
    const playerId    = `player-${Math.random().toString(36).slice(2, 8)}`;
    const displayName = `Fighter${Math.floor(Math.random() * 9999)}`;

    networkManager.joinMatchmaking(playerId, displayName).catch((err) => {
      console.error('[Queue] join failed:', err);
      this._statusText.setText('Connection failed. Retrying...');
      this.time.delayedCall(2000, () => this.scene.start('Lobby'));
    });
  }

  update(_time: number, delta: number): void {
    this._dotTimer += delta;
    if (this._dotTimer >= 500) {
      this._dotTimer = 0;
      this._dots = (this._dots + 1) % 4;
      this._statusText.setText('Searching' + '.'.repeat(this._dots));
    }
  }
}

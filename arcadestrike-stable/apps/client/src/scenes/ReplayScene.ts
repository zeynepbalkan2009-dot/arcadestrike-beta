import Phaser from 'phaser';

export class ReplayScene extends Phaser.Scene {
  constructor() { super({ key: 'Replay' }); }

  create(data: { matchId?: string }): void {
    const { width, height } = this.scale;
    this.add.text(width / 2, height / 2, `Replay: ${data.matchId ?? 'N/A'}`, {
      fontSize: '24px', color: '#ffffff',
    }).setOrigin(0.5);

    this.input.keyboard!.once('keydown-ESC', () => this.scene.start('Lobby'));
  }
}

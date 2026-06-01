import Phaser from 'phaser';

export class ResultScene extends Phaser.Scene {
  constructor() { super({ key: 'Result' }); }

  create(data: { winnerId?: string; matchId?: string }): void {
    const { width, height } = this.scale;

    this.add.text(width / 2, height / 2 - 100, 'MATCH OVER', {
      fontSize: '48px', color: '#e94560', fontStyle: 'bold',
    }).setOrigin(0.5);

    if (data.winnerId) {
      this.add.text(width / 2, height / 2 - 20, `Winner: ${data.winnerId}`, {
        fontSize: '28px', color: '#ffffff',
      }).setOrigin(0.5);
    }

    const replayBtn = this.add.text(width / 2, height / 2 + 60, '[ PLAY AGAIN ]', {
      fontSize: '24px', color: '#ffffff',
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });

    replayBtn.on('pointerover',  () => replayBtn.setStyle({ color: '#e94560' }));
    replayBtn.on('pointerout',   () => replayBtn.setStyle({ color: '#ffffff' }));
    replayBtn.on('pointerdown',  () => this.scene.start('Queue'));
  }
}

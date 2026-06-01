import Phaser from 'phaser';

export class LobbyScene extends Phaser.Scene {
  constructor() { super({ key: 'Lobby' }); }

  create(): void {
    const { width, height } = this.scale;

    this.add.text(width / 2, height / 2 - 60, 'ARCADE STRIKE', {
      fontSize: '48px', color: '#e94560', fontStyle: 'bold',
    }).setOrigin(0.5);

    const btn = this.add.text(width / 2, height / 2 + 40, '[ FIND MATCH ]', {
      fontSize: '28px', color: '#ffffff',
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });

    btn.on('pointerover',  () => btn.setStyle({ color: '#e94560' }));
    btn.on('pointerout',   () => btn.setStyle({ color: '#ffffff' }));
    btn.on('pointerdown',  () => {
      btn.setStyle({ color: '#888888' });
      this.scene.start('Queue');
    });
  }
}

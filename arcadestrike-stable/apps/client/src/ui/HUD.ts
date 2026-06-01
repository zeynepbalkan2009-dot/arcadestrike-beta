import Phaser from 'phaser';
import { MAX_HP } from '../../../../packages/shared/src/combat';

export class HUD {
  private timerText:  Phaser.GameObjects.Text;
  private roundText:  Phaser.GameObjects.Text;
  private pingText:   Phaser.GameObjects.Text;

  constructor(scene: Phaser.Scene) {
    const { width } = scene.scale;

    this.timerText = scene.add.text(width / 2, 16, '99', {
      fontSize: '32px', color: '#ffffff', fontStyle: 'bold',
    }).setOrigin(0.5, 0).setDepth(10);

    this.roundText = scene.add.text(width / 2, 52, 'ROUND 1', {
      fontSize: '14px', color: '#aaaaaa',
    }).setOrigin(0.5, 0).setDepth(10);

    this.pingText = scene.add.text(8, 8, 'ping: --', {
      fontSize: '11px', color: '#888888',
    }).setDepth(10);
  }

  setTimer(seconds: number): void { this.timerText.setText(String(Math.ceil(seconds))); }
  setRound(round: number): void   { this.roundText.setText(`ROUND ${round}`); }
  setPing(ms: number): void       { this.pingText.setText(`ping: ${ms}ms`); }
}

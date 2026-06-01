import Phaser from 'phaser';

export class FXManager {
  constructor(private scene: Phaser.Scene) {}

  hitEffect(x: number, y: number, type: 'normal' | 'critical' | 'blocked'): void {
    const color = type === 'critical' ? '#ffff00' : type === 'blocked' ? '#aaaaff' : '#ff4444';
    const label = type === 'critical' ? 'CRITICAL!' : type === 'blocked' ? 'BLOCKED' : '';
    if (label) {
      const txt = this.scene.add.text(x, y - 30, label, { fontSize: '14px', color, fontStyle: 'bold' });
      this.scene.tweens.add({ targets: txt, y: y - 70, alpha: 0, duration: 800, onComplete: () => txt.destroy() });
    }

    const flash = this.scene.add.circle(x, y, 20, parseInt(color.slice(1), 16), 0.6);
    this.scene.tweens.add({ targets: flash, scaleX: 2, scaleY: 2, alpha: 0, duration: 300, onComplete: () => flash.destroy() });
  }

  screenShake(intensity = 4): void {
    this.scene.cameras.main.shake(150, intensity / 1000);
  }
}

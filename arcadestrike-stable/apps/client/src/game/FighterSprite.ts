import Phaser from 'phaser';
import { MAX_HP } from '../../../../packages/shared/src/combat';

/**
 * FighterSprite — visual representation of a player in the fight scene.
 * Uses simple rectangles for beta; replace with sprite sheets in production.
 */
export class FighterSprite {
  private body:    Phaser.GameObjects.Rectangle;
  private hpBarBg: Phaser.GameObjects.Rectangle;
  private hpBar:   Phaser.GameObjects.Rectangle;
  private nameTag: Phaser.GameObjects.Text;

  constructor(
    scene:       Phaser.Scene,
    x:           number,
    y:           number,
    color:       number,
    displayName: string,
  ) {
    this.body    = scene.add.rectangle(x, y - 25, 44, 50, color);
    this.hpBarBg = scene.add.rectangle(x - 30, y - 72, 60, 8, 0x333333).setOrigin(0, 0.5);
    this.hpBar   = scene.add.rectangle(x - 30, y - 72, 60, 8, 0x44ff44).setOrigin(0, 0.5);
    this.nameTag = scene.add.text(x, y - 85, displayName, { fontSize: '11px', color: '#ffffff' }).setOrigin(0.5);
  }

  update(x: number, y: number, hp: number): void {
    this.body.setPosition(x, y - 25);
    this.hpBarBg.setPosition(x - 30, y - 72);
    this.hpBar.setPosition(x - 30, y - 72);
    this.nameTag.setPosition(x, y - 85);

    const pct = Math.max(0, hp / MAX_HP);
    this.hpBar.setScale(pct, 1);
    this.hpBar.setFillStyle(pct > 0.5 ? 0x44ff44 : pct > 0.25 ? 0xffaa00 : 0xff3333);
  }

  flash(scene: Phaser.Scene): void {
    scene.tweens.add({ targets: this.body, alpha: 0.2, duration: 80, yoyo: true, repeat: 2 });
  }

  destroy(): void {
    this.body.destroy();
    this.hpBarBg.destroy();
    this.hpBar.destroy();
    this.nameTag.destroy();
  }
}

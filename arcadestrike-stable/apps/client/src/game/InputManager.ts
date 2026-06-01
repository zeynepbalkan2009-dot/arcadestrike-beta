import Phaser from 'phaser';
import type { PlayerInputPayload } from '../../../../packages/shared/src/types';

export class InputManager {
  private cursors:    Phaser.Types.Input.Keyboard.CursorKeys;
  private attackKey:  Phaser.Input.Keyboard.Key;
  private blockKey:   Phaser.Input.Keyboard.Key;
  private seq = 0;

  constructor(scene: Phaser.Scene) {
    this.cursors   = scene.input.keyboard!.createCursorKeys();
    this.attackKey = scene.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.Z);
    this.blockKey  = scene.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.X);
  }

  sample(tick: number): PlayerInputPayload {
    return {
      seq:    this.seq++,
      tick,
      left:   this.cursors.left?.isDown    ?? false,
      right:  this.cursors.right?.isDown   ?? false,
      jump:   this.cursors.up?.isDown      ?? false,
      attack: Phaser.Input.Keyboard.JustDown(this.attackKey),
      block:  this.blockKey.isDown,
    };
  }
}

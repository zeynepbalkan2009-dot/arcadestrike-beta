import Phaser from 'phaser';
import { networkManager } from '../network/NetworkManager';
import {
  STAGE_WIDTH, STAGE_HEIGHT, GROUND_Y,
  TICK_MS, MAX_HP,
} from '../../../../packages/shared/src/combat';
import type { PlayerInputPayload } from '../../../../packages/shared/src/types';

let _seq = 0;
let _tick = 0;

export class FightScene extends Phaser.Scene {
  private _fighters = new Map<string, Phaser.GameObjects.Rectangle>();
  private _hpBars   = new Map<string, Phaser.GameObjects.Rectangle>();
  private _nameTexts = new Map<string, Phaser.GameObjects.Text>();
  private _timerText!: Phaser.GameObjects.Text;
  private _roundText!: Phaser.GameObjects.Text;
  private _cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private _attackKey!: Phaser.Input.Keyboard.Key;
  private _blockKey!: Phaser.Input.Keyboard.Key;
  private _inputTimer = 0;
  private _mySessionId = '';

  constructor() { super({ key: 'Fight' }); }

  create(data: { countdown?: number }): void {
    const { width } = this.scale;
    _seq = 0; _tick = 0;

    // Stage background
    this.add.rectangle(width / 2, GROUND_Y + 35, STAGE_WIDTH, 70, 0x16213e);
    this.add.rectangle(width / 2, GROUND_Y, STAGE_WIDTH, 8, 0xe94560);

    // HUD
    this._timerText = this.add.text(width / 2, 24, '99', {
      fontSize: '32px', color: '#ffffff', fontStyle: 'bold',
    }).setOrigin(0.5, 0);

    this._roundText = this.add.text(width / 2, 54, 'ROUND 1', {
      fontSize: '16px', color: '#aaaaaa',
    }).setOrigin(0.5, 0);

    // Input
    this._cursors   = this.input.keyboard!.createCursorKeys();
    this._attackKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.Z);
    this._blockKey  = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.X);

    // Countdown overlay
    if (data.countdown) {
      const overlay = this.add.text(width / 2, STAGE_HEIGHT / 2, String(data.countdown), {
        fontSize: '96px', color: '#e94560', fontStyle: 'bold', alpha: 0.8,
      }).setOrigin(0.5);
      this.tweens.add({
        targets: overlay, alpha: 0, duration: 800,
        onComplete: () => overlay.destroy(),
      });
    }

    // Network events
    networkManager.on('roundStart', (d) => {
      this._roundText.setText(`ROUND ${d.round}`);
    });

    networkManager.on('roundEnd', (d) => {
      this._showMessage(d.winnerId ? `${d.winnerId} wins round!` : 'DRAW!');
    });

    networkManager.on('matchEnd', (d) => {
      this.scene.start('Result', d);
    });

    networkManager.on('playerHit', (d) => {
      this._flashFighter(d.defenderId);
    });

    // State sync
    const state = networkManager.state;
    if (state?.players) {
      state.players.onAdd((player: any, sessionId: string) => {
        this._spawnFighter(sessionId, player);
      });
    }

    networkManager.sendReady();
  }

  update(_time: number, delta: number): void {
    // Update fighter positions from server state
    const state = networkManager.state;
    if (state?.players) {
      state.players.forEach((player: any, sessionId: string) => {
        const sprite = this._fighters.get(sessionId);
        if (sprite) {
          sprite.setPosition(player.x, player.y - 25);
        }
        const bar = this._hpBars.get(sessionId);
        if (bar) {
          const pct = player.hp / MAX_HP;
          bar.setScale(pct, 1);
          bar.setFillStyle(pct > 0.5 ? 0x44ff44 : pct > 0.25 ? 0xffaa00 : 0xff3333);
        }
        const txt = this._nameTexts.get(sessionId);
        if (txt) txt.setPosition(player.x, player.y - 65);
      });

      if (state.roundTimer !== undefined) {
        this._timerText.setText(String(Math.ceil(state.roundTimer)));
      }
    }

    // Send input every tick
    this._inputTimer += delta;
    if (this._inputTimer >= TICK_MS) {
      this._inputTimer -= TICK_MS;
      this._sendInput();
      _tick++;
    }
  }

  private _sendInput(): void {
    const input: PlayerInputPayload = {
      seq:    _seq++,
      tick:   _tick,
      left:   this._cursors.left?.isDown    ?? false,
      right:  this._cursors.right?.isDown   ?? false,
      jump:   this._cursors.up?.isDown      ?? false,
      attack: Phaser.Input.Keyboard.JustDown(this._attackKey),
      block:  this._blockKey.isDown,
    };
    networkManager.sendInput(input);
  }

  private _spawnFighter(sessionId: string, player: any): void {
    const isLeft = this._fighters.size === 0;
    const color  = isLeft ? 0x4488ff : 0xff4444;

    const body = this.add.rectangle(player.x, player.y - 25, 44, 50, color);
    this._fighters.set(sessionId, body);

    // HP bar background
    const barBg = this.add.rectangle(player.x, player.y - 75, 60, 8, 0x333333);
    // HP bar fill
    const bar   = this.add.rectangle(player.x, player.y - 75, 60, 8, 0x44ff44);
    bar.setOrigin(0, 0.5);
    barBg.setOrigin(0, 0.5);
    barBg.setX(player.x - 30);
    bar.setX(player.x - 30);
    this._hpBars.set(sessionId, bar);

    const name = this.add.text(player.x, player.y - 65, player.displayName, {
      fontSize: '12px', color: '#ffffff',
    }).setOrigin(0.5);
    this._nameTexts.set(sessionId, name);
  }

  private _flashFighter(sessionId: string): void {
    const sprite = this._fighters.get(sessionId);
    if (!sprite) return;
    this.tweens.add({
      targets: sprite, alpha: 0.2, duration: 80, yoyo: true, repeat: 2,
    });
  }

  private _showMessage(msg: string): void {
    const { width } = this.scale;
    const txt = this.add.text(width / 2, STAGE_HEIGHT / 2 - 40, msg, {
      fontSize: '36px', color: '#e94560', fontStyle: 'bold',
    }).setOrigin(0.5);
    this.time.delayedCall(2000, () => txt.destroy());
  }
}

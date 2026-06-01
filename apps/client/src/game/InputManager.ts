/**
 * InputManager
 *
 * Captures raw keyboard/touch inputs and produces a clean
 * PlayerInput snapshot each tick. Handles:
 *  - Keyboard (WASD + arrow keys)
 *  - On-screen touch buttons (mobile)
 *  - Input de-bounce (prevents repeat key spam)
 */
import Phaser from "phaser";
import type { PlayerInput } from "@arcadestrike/shared";

export interface RawInput {
  left:    boolean;
  right:   boolean;
  jump:    boolean;
  attack:  boolean;
  special: boolean;
}

export class InputManager {
  private keys!: {
    left:    Phaser.Input.Keyboard.Key;
    right:   Phaser.Input.Keyboard.Key;
    jump:    Phaser.Input.Keyboard.Key;
    attack:  Phaser.Input.Keyboard.Key;
    special: Phaser.Input.Keyboard.Key;
    leftAlt:    Phaser.Input.Keyboard.Key;
    rightAlt:   Phaser.Input.Keyboard.Key;
    jumpAlt:    Phaser.Input.Keyboard.Key;
  };

  // Touch state (set by on-screen buttons in mobile HUD)
  private touchState: RawInput = {
    left:    false,
    right:   false,
    jump:    false,
    attack:  false,
    special: false,
  };

  private seq = 0;
  private gamepadIndex: number | null = null;

  constructor(private scene: Phaser.Scene) {
    this.setupKeyboard();
    this.setupGamepad();
  }

  private setupKeyboard(): void {
    const kb = this.scene.input.keyboard!;

    this.keys = {
      left:     kb.addKey(Phaser.Input.Keyboard.KeyCodes.LEFT),
      right:    kb.addKey(Phaser.Input.Keyboard.KeyCodes.RIGHT),
      jump:     kb.addKey(Phaser.Input.Keyboard.KeyCodes.UP),
      attack:   kb.addKey(Phaser.Input.Keyboard.KeyCodes.Z),
      special:  kb.addKey(Phaser.Input.Keyboard.KeyCodes.X),
      // WASD alternates
      leftAlt:  kb.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      rightAlt: kb.addKey(Phaser.Input.Keyboard.KeyCodes.D),
      jumpAlt:  kb.addKey(Phaser.Input.Keyboard.KeyCodes.W),
    };
  }

  /**
   * Called once per client tick to produce a snapshot.
   */
  sample(): Omit<PlayerInput, "seq" | "tick" | "timestamp"> {
    const k = this.keys;
    const pad = this.currentGamepad();
    const axisX = pad?.axes.length ? pad.axes[0].getValue() : 0;
    const padA = Boolean(pad?.buttons[0]?.pressed);
    const padB = Boolean(pad?.buttons[1]?.pressed);
    const padX = Boolean(pad?.buttons[2]?.pressed);
    return {
      left:    k.left.isDown    || k.leftAlt.isDown    || axisX < -0.35 || this.touchState.left,
      right:   k.right.isDown   || k.rightAlt.isDown   || axisX > 0.35  || this.touchState.right,
      jump:    Phaser.Input.Keyboard.JustDown(k.jump)   ||
               Phaser.Input.Keyboard.JustDown(k.jumpAlt)|| padA || this.touchState.jump,
      attack:  Phaser.Input.Keyboard.JustDown(k.attack) || padX || this.touchState.attack,
      special: Phaser.Input.Keyboard.JustDown(k.special)|| padB || this.touchState.special,
    };
  }

  // ─── Mobile touch controls ──────────────────────────────────

  setTouch(key: keyof RawInput, value: boolean): void {
    this.touchState[key] = value;
  }

  // Clear momentary inputs after one tick to mimic JustDown
  clearMomentary(): void {
    this.touchState.jump    = false;
    this.touchState.attack  = false;
    this.touchState.special = false;
  }

  clearAllTouch(): void {
    this.touchState.left = false;
    this.touchState.right = false;
    this.clearMomentary();
  }

  private setupGamepad(): void {
    this.scene.input.gamepad?.once("connected", (pad: Phaser.Input.Gamepad.Gamepad) => {
      this.gamepadIndex = pad.index;
    });
  }

  private currentGamepad(): Phaser.Input.Gamepad.Gamepad | undefined {
    const pads = this.scene.input.gamepad?.gamepads;
    if (!pads?.length) return undefined;
    if (this.gamepadIndex !== null) return pads.find(pad => pad?.index === this.gamepadIndex) ?? pads[0];
    return pads[0];
  }

  /**
   * Render on-screen D-pad and buttons for mobile.
   * Returns the container so FightScene can position it.
   */
  createMobileControls(scene: Phaser.Scene): Phaser.GameObjects.Container {
    const { width, height } = scene.scale;
    const container = scene.add.container(0, 0).setDepth(300);

    const BTN_SIZE = 60;
    const BTN_ALPHA = 0.55;
    const DPAD_X = 90;
    const DPAD_Y = height - 80;
    const ACTION_X = width - 90;
    const ACTION_Y = height - 80;

    // ─── D-pad ───────────────────────────────────────────────
    const mkDpad = (x: number, y: number, label: string, key: keyof RawInput) => {
      const bg = scene.add.circle(x, y, BTN_SIZE / 2, 0xffffff, BTN_ALPHA);
      const txt = scene.add.text(x, y, label, {
        fontSize: "20px", color: "#000", fontFamily: "Courier New",
      }).setOrigin(0.5);
      bg.setInteractive();
      bg.on("pointerdown",   () => this.setTouch(key, true));
      bg.on("pointerup",     () => this.setTouch(key, false));
      bg.on("pointerout",    () => this.setTouch(key, false));
      bg.on("pointercancel", () => this.setTouch(key, false));
      container.add([bg, txt]);
    };

    mkDpad(DPAD_X - 50, DPAD_Y, "◀", "left");
    mkDpad(DPAD_X + 50, DPAD_Y, "▶", "right");
    mkDpad(DPAD_X,      DPAD_Y - 55, "▲", "jump");

    // ─── Action buttons ──────────────────────────────────────
    const mkAction = (x: number, y: number, label: string, color: number, key: keyof RawInput) => {
      const bg = scene.add.circle(x, y, BTN_SIZE / 2, color, BTN_ALPHA);
      const txt = scene.add.text(x, y, label, {
        fontSize: "14px", color: "#fff", fontFamily: "Courier New",
      }).setOrigin(0.5);
      bg.setInteractive();
      bg.on("pointerdown",   () => { this.setTouch(key, true);  });
      bg.on("pointerup",     () => { this.setTouch(key, false); this.clearMomentary(); });
      bg.on("pointerout",    () => { this.setTouch(key, false); });
      bg.on("pointercancel", () => { this.setTouch(key, false); });
      container.add([bg, txt]);
    };

    mkAction(ACTION_X + 50,  ACTION_Y,      "ATK",  0xff4444, "attack");
    mkAction(ACTION_X,       ACTION_Y - 50, "SPL",  0xaa44ff, "special");

    return container;
  }

  destroy(): void {
    const kb = this.scene.input.keyboard;
    if (kb) {
      Object.values(this.keys).forEach(k => kb.removeKey(k));
    }
  }
}

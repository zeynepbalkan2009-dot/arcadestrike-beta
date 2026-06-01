/**
 * ClientPredictor — client-side prediction for responsive feel.
 * Applies local input immediately, then reconciles against server state.
 */
import {
  GRAVITY, JUMP_VELOCITY, MOVE_SPEED, TICK_MS,
  STAGE_WIDTH, GROUND_Y,
} from '../../../../packages/shared/src/combat';
import type { PlayerInputPayload } from '../../../../packages/shared/src/types';

export interface LocalPlayerState {
  x: number; y: number;
  velX: number; velY: number;
  grounded: boolean;
}

export class ClientPredictor {
  state: LocalPlayerState = { x: 150, y: GROUND_Y, velX: 0, velY: 0, grounded: true };

  applyInput(input: PlayerInputPayload): void {
    const dt = TICK_MS / 1000;

    this.state.velX = input.left ? -MOVE_SPEED : input.right ? MOVE_SPEED : 0;
    if (input.jump && this.state.grounded) { this.state.velY = JUMP_VELOCITY; this.state.grounded = false; }
    if (!this.state.grounded) this.state.velY += GRAVITY * dt;

    this.state.x += this.state.velX * dt;
    this.state.y += this.state.velY * dt;

    if (this.state.y >= GROUND_Y) { this.state.y = GROUND_Y; this.state.velY = 0; this.state.grounded = true; }
    this.state.x = Math.max(0, Math.min(STAGE_WIDTH, this.state.x));
  }

  reconcile(serverX: number, serverY: number): void {
    const dx = Math.abs(this.state.x - serverX);
    const dy = Math.abs(this.state.y - serverY);
    // Hard snap if too far off (>40px)
    if (dx > 40 || dy > 40) { this.state.x = serverX; this.state.y = serverY; }
    else {
      // Lerp toward server position
      this.state.x += (serverX - this.state.x) * 0.2;
      this.state.y += (serverY - this.state.y) * 0.2;
    }
  }
}

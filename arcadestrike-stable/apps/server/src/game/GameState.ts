import { Schema, MapSchema, type, Context } from '@colyseus/schema';
import { MAX_HP, STAGE_WIDTH, GROUND_Y } from '../../../packages/shared/src/combat';

// ─── Player State ─────────────────────────────────────────────
export class PlayerState extends Schema {
  @type('string')  playerId    = '';
  @type('string')  displayName = '';
  @type('number')  x           = 100;
  @type('number')  y           = GROUND_Y;
  @type('number')  velX        = 0;
  @type('number')  velY        = 0;
  @type('number')  hp          = MAX_HP;
  @type('boolean') grounded    = true;
  @type('boolean') attacking   = false;
  @type('boolean') blocking    = false;
  @type('boolean') facingRight = true;
  @type('number')  lastSeq     = 0;
  @type('boolean') connected   = true;
  @type('number')  roundsWon   = 0;
  @type('number')  ping        = 0;
}

// ─── Room State ───────────────────────────────────────────────
export class ArcadeRoomState extends Schema {
  @type({ map: PlayerState })
  players = new MapSchema<PlayerState>();

  @type('string')  phase        = 'waiting'; // waiting|countdown|fighting|round_end|match_end
  @type('number')  countdown    = 0;
  @type('number')  tick         = 0;
  @type('number')  roundTimer   = 99;
  @type('number')  currentRound = 1;
  @type('string')  winnerId     = '';
  @type('string')  matchId      = '';
}

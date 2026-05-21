import { Schema, type, MapSchema } from "@colyseus/schema";

export class Vec2Schema extends Schema {
  @type("float32") x: number = 0;
  @type("float32") y: number = 0;
}

export class FighterSchema extends Schema {
  @type("string")   id: string = "";
  @type("string")   playerId: string = "";
  @type(Vec2Schema) pos: Vec2Schema = new Vec2Schema();
  @type(Vec2Schema) vel: Vec2Schema = new Vec2Schema();
  @type("float32")  hp: number = 100;
  @type("int8")     facing: number = 1;
  @type("string")   actionState: string = "idle";
  @type("int16")    attackCooldown: number = 0;
  @type("int16")    specialCooldown: number = 0;
  @type("int8")     comboCount: number = 0;
  @type("int16")    comboTimer: number = 0;
  @type("boolean")  isGrounded: boolean = true;
  @type("int8")     stunTicks: number = 0;
  @type("int32")    lastProcessedInput: number = 0;
}

export class ArcadeGameState extends Schema {
  @type("int32")                tick: number = 0;
  @type({ map: FighterSchema }) fighters = new MapSchema<FighterSchema>();
  @type("int32")                matchTimer: number = 0;
  @type("string")               phase: string = "countdown";
  @type("string")               roundWinner: string = "";
  @type({ map: "int8" })        scores = new MapSchema<number>();
  @type("string")               matchId: string = "";
  @type("int8")                 currentRound: number = 1;
  @type("string")               winnerId: string = "";
  @type("string")               loserId: string = "";
  @type("string")               endReason: string = "";
  @type("int32")                countdownStartTick: number = 0;
  @type("int32")                roundEndsAtTick: number = 0;
}

import Phaser from 'phaser';
import { BootScene }    from './scenes/BootScene';
import { PreloadScene } from './scenes/PreloadScene';
import { LobbyScene }   from './scenes/LobbyScene';
import { QueueScene }   from './scenes/QueueScene';
import { FightScene }   from './scenes/FightScene';
import { ResultScene }  from './scenes/ResultScene';

const config: Phaser.Types.Core.GameConfig = {
  type:            Phaser.AUTO,
  width:           800,
  height:          450,
  backgroundColor: '#1a1a2e',
  parent:          'game-container',
  physics: {
    default: 'arcade',
    arcade:  { gravity: { y: 0, x: 0 }, debug: import.meta.env.DEV },
  },
  scene: [BootScene, PreloadScene, LobbyScene, QueueScene, FightScene, ResultScene],
  scale: {
    mode:            Phaser.Scale.FIT,
    autoCenter:      Phaser.Scale.CENTER_BOTH,
    min:             { width: 480, height: 270 },
    max:             { width: 1920, height: 1080 },
  },
};

new Phaser.Game(config);

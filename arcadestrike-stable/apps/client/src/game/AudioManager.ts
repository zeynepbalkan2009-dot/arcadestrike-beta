/**
 * AudioManager — stub for Web Audio API integration.
 * Replace with actual sound assets in production.
 */
export class AudioManager {
  private _ctx: AudioContext | null = null;

  init(): void {
    try {
      this._ctx = new AudioContext();
    } catch {
      console.warn('[Audio] Web Audio API not available');
    }
  }

  playHit(): void    { this._beep(220, 0.05, 'square'); }
  playBlock(): void  { this._beep(110, 0.05, 'sawtooth'); }
  playCrit(): void   { this._beep(440, 0.1,  'square'); }
  playKO(): void     { this._beep(80,  0.3,  'sawtooth'); }

  private _beep(freq: number, duration: number, type: OscillatorType): void {
    if (!this._ctx) return;
    const osc  = this._ctx.createOscillator();
    const gain = this._ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.15, this._ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this._ctx.currentTime + duration);
    osc.connect(gain);
    gain.connect(this._ctx.destination);
    osc.start();
    osc.stop(this._ctx.currentTime + duration);
  }
}

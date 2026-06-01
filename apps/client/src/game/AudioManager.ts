/**
 * Lightweight combat audio layer with procedural fallbacks.
 * Uses Phaser-loaded sounds when present and WebAudio tones when assets are absent.
 */
import Phaser from "phaser";

type ToneKind = "ui" | "hit" | "heavy" | "combo" | "ko" | "countdown" | "low";

export class AudioManager {
  private context: AudioContext | null = null;
  private enabled = true;
  private lowHealthLoop: OscillatorNode | null = null;
  private lowHealthGain: GainNode | null = null;
  private lastPlayed = new Map<string, number>();

  constructor(private readonly scene: Phaser.Scene) {}

  playUI(): void {
    this.play("ui", "countdown_beep", 0.35, 1.25);
  }

  playCountdown(pitch = 1): void {
    this.play("countdown", "countdown_beep", 0.45, pitch);
  }

  playHit(combo = false, heavy = false): void {
    this.play(heavy ? "heavy" : combo ? "combo" : "hit", "hit_sound", heavy ? 0.95 : combo ? 0.85 : 0.7, heavy ? 0.82 : combo ? 1.18 : 1);
  }

  playSpecial(): void {
    this.play("heavy", "special_sound", 0.9, 0.9);
  }

  playKO(): void {
    this.play("ko", "ko_sound", 1, 0.72);
    this.stopLowHealthTension();
  }

  setLowHealthTension(active: boolean): void {
    if (active) this.startLowHealthTension();
    else this.stopLowHealthTension();
  }

  toggle(): boolean {
    this.enabled = !this.enabled;
    if (!this.enabled) this.stopLowHealthTension();
    return this.enabled;
  }

  destroy(): void {
    this.stopLowHealthTension();
  }

  private play(kind: ToneKind, assetKey: string, volume: number, rate: number): void {
    if (!this.enabled) return;
    if (!this.canPlay(kind)) return;
    try {
      if (this.scene.cache.audio.exists(assetKey)) {
        this.scene.sound.play(assetKey, { volume, rate });
        return;
      }
    } catch {
      // Fall through to procedural audio.
    }
    this.playTone(kind, volume);
  }

  private canPlay(kind: ToneKind): boolean {
    const now = performance.now();
    const minGap = {
      ui: 45,
      hit: 55,
      heavy: 90,
      combo: 90,
      ko: 500,
      countdown: 220,
      low: 200,
    }[kind];
    const previous = this.lastPlayed.get(kind) ?? -Infinity;
    if (now - previous < minGap) return false;
    this.lastPlayed.set(kind, now);
    return true;
  }

  private getContext(): AudioContext | null {
    if (this.context) return this.context;
    const AudioCtor = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtor) return null;
    this.context = new AudioCtor();
    return this.context;
  }

  private playTone(kind: ToneKind, volume: number): void {
    const ctx = this.getContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();

    const settings = {
      ui: { f0: 740, f1: 980, dur: 0.06, type: "square" as OscillatorType },
      countdown: { f0: 520, f1: 680, dur: 0.08, type: "sine" as OscillatorType },
      hit: { f0: 190, f1: 75, dur: 0.08, type: "sawtooth" as OscillatorType },
      heavy: { f0: 110, f1: 42, dur: 0.14, type: "sawtooth" as OscillatorType },
      combo: { f0: 420, f1: 760, dur: 0.1, type: "triangle" as OscillatorType },
      ko: { f0: 95, f1: 28, dur: 0.45, type: "sawtooth" as OscillatorType },
      low: { f0: 60, f1: 60, dur: 0.2, type: "sine" as OscillatorType },
    }[kind];

    osc.type = settings.type;
    osc.frequency.setValueAtTime(settings.f0, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, settings.f1), now + settings.dur);

    filter.type = "lowpass";
    filter.frequency.setValueAtTime(kind === "combo" ? 1800 : 900, now);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, volume * 0.16), now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + settings.dur);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + settings.dur + 0.02);
  }

  private startLowHealthTension(): void {
    if (!this.enabled || this.lowHealthLoop) return;
    const ctx = this.getContext();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 58;
    gain.gain.value = 0.018;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    this.lowHealthLoop = osc;
    this.lowHealthGain = gain;
  }

  private stopLowHealthTension(): void {
    this.lowHealthGain?.gain.exponentialRampToValueAtTime(0.0001, this.lowHealthGain.context.currentTime + 0.08);
    this.lowHealthLoop?.stop(this.lowHealthLoop.context.currentTime + 0.1);
    this.lowHealthLoop = null;
    this.lowHealthGain = null;
  }
}

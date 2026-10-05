/**
 * Web Audio motoru: HRTF ile 3B konumlu ses, mesafe zayıflaması, duvar arkasında
 * low-pass (kapanma), sabit döngüler (sis, ateş, rüzgar).
 */
import { Vec3 } from '@kervan/shared';
import { synthesizeAll, SR } from './synth';
import { settings } from '../settings';

export interface PlayOpts {
  gain?: number;
  rate?: number;
  /** Bu mesafeye kadar tam ses (inç). */
  ref?: number;
  /** Duyulma sınırı (inç). */
  max?: number;
  occlude?: boolean;
  loop?: boolean;
}

export interface Handle {
  stop(): void;
  setPos(p: Vec3): void;
  setGain(g: number): void;
}

export class AudioEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private buffers = new Map<string, AudioBuffer[]>();
  private listener = { x: 0, y: 0, z: 0 };
  /** Dünya görüş hattı testi (true = engel var). */
  occluded: (a: Vec3, b: Vec3) => boolean = () => false;
  ready = false;
  private flashGain: GainNode | null = null;

  async init() {
    if (this.ctx) return;
    const ctx = new AudioContext({ latencyHint: 'interactive', sampleRate: SR });
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = settings.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -10;
    comp.knee.value = 8;
    comp.ratio.value = 4;
    comp.attack.value = 0.002;
    comp.release.value = 0.15;
    this.master.connect(comp).connect(ctx.destination);
    // flaş kulak çınlaması sırasında diğer sesleri bastırmak için
    this.flashGain = ctx.createGain();
    this.flashGain.connect(this.master);
    const bank = synthesizeAll();
    for (const [name, list] of Object.entries(bank)) {
      this.buffers.set(
        name,
        list.map((data) => {
          const b = ctx.createBuffer(1, data.length, SR);
          b.copyToChannel(data as Float32Array<ArrayBuffer>, 0);
          return b;
        }),
      );
    }
    this.ready = true;
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume();
  }

  setVolume(v: number) {
    if (this.master) this.master.gain.value = v;
  }

  has(name: string) {
    return this.buffers.has(name);
  }

  private pick(name: string): AudioBuffer | null {
    const l = this.buffers.get(name);
    if (!l || !l.length) return null;
    return l[Math.floor(Math.random() * l.length)]!;
  }

  /** Dinleyici konumu/yönü (sim koordinatları + yaw/pitch). */
  setListener(pos: Vec3, forward: Vec3, up: Vec3) {
    this.listener = { ...pos };
    const ctx = this.ctx;
    if (!ctx) return;
    const L = ctx.listener;
    const t = ctx.currentTime;
    // Web Audio sağ el Y-yukarı; sim → (x, z, -y)
    if (L.positionX) {
      L.positionX.setValueAtTime(pos.x, t);
      L.positionY.setValueAtTime(pos.z, t);
      L.positionZ.setValueAtTime(-pos.y, t);
      L.forwardX.setValueAtTime(forward.x, t);
      L.forwardY.setValueAtTime(forward.z, t);
      L.forwardZ.setValueAtTime(-forward.y, t);
      L.upX.setValueAtTime(up.x, t);
      L.upY.setValueAtTime(up.z, t);
      L.upZ.setValueAtTime(-up.y, t);
    } else {
      L.setPosition(pos.x, pos.z, -pos.y);
      L.setOrientation(forward.x, forward.z, -forward.y, up.x, up.z, -up.y);
    }
  }

  play2D(name: string, gain = 1, rate = 1): Handle | null {
    const ctx = this.ctx;
    if (!ctx || !this.ready) return null;
    const b = this.pick(name);
    if (!b) return null;
    const src = ctx.createBufferSource();
    src.buffer = b;
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(g).connect(this.flashGain!);
    src.start();
    return {
      stop: () => {
        try {
          src.stop();
        } catch {
          /* */
        }
      },
      setPos: () => {},
      setGain: (v) => (g.gain.value = v),
    };
  }

  play3D(name: string, pos: Vec3, o: PlayOpts = {}): Handle | null {
    const ctx = this.ctx;
    if (!ctx || !this.ready) return null;
    const b = this.pick(name);
    if (!b) return null;
    const ref = o.ref ?? 120;
    const max = o.max ?? 3500;
    const L = this.listener;
    const dist = Math.hypot(pos.x - L.x, pos.y - L.y, pos.z - L.z);
    if (dist > max && !o.loop) return null;

    const src = ctx.createBufferSource();
    src.buffer = b;
    src.loop = !!o.loop;
    src.playbackRate.value = (o.rate ?? 1) * (0.97 + Math.random() * 0.06);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    const g = ctx.createGain();
    const panner = ctx.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'linear';
    panner.rolloffFactor = 0;
    panner.refDistance = 1;
    panner.maxDistance = 1e6;
    const setPos = (p: Vec3) => {
      const t = ctx.currentTime;
      if (panner.positionX) {
        panner.positionX.setValueAtTime(p.x, t);
        panner.positionY.setValueAtTime(p.z, t);
        panner.positionZ.setValueAtTime(-p.y, t);
      } else panner.setPosition(p.x, p.z, -p.y);
    };
    const baseGain = o.gain ?? 1;
    const apply = (p: Vec3) => {
      const d = Math.hypot(p.x - this.listener.x, p.y - this.listener.y, p.z - this.listener.z);
      let gain = baseGain / (1 + Math.pow(Math.max(0, d - ref) / (ref * 2.2), 1.15));
      gain *= Math.max(0, 1 - d / max);
      let cutoff = 20000 - Math.min(14000, d * 3.2);
      if (o.occlude !== false && d > 64 && this.occluded(p, this.listener)) {
        gain *= 0.55;
        cutoff = Math.min(cutoff, 1100);
      }
      g.gain.setTargetAtTime(gain, ctx.currentTime, 0.02);
      filter.frequency.setTargetAtTime(cutoff, ctx.currentTime, 0.02);
    };
    setPos(pos);
    {
      // ilk değerleri hemen uygula
      const d = dist;
      let gain = baseGain / (1 + Math.pow(Math.max(0, d - ref) / (ref * 2.2), 1.15));
      gain *= Math.max(0, 1 - d / max);
      let cutoff = 20000 - Math.min(14000, d * 3.2);
      if (o.occlude !== false && d > 64 && this.occluded(pos, this.listener)) {
        gain *= 0.55;
        cutoff = Math.min(cutoff, 1100);
      }
      g.gain.value = gain;
      filter.frequency.value = cutoff;
    }
    src.connect(filter).connect(g).connect(panner).connect(this.flashGain!);
    src.start();
    return {
      stop: () => {
        try {
          src.stop();
        } catch {
          /* */
        }
      },
      setPos: (p) => {
        setPos(p);
        apply(p);
      },
      setGain: (v) => g.gain.setTargetAtTime(v, ctx.currentTime, 0.05),
    };
  }

  /** Flaşlanınca diğer sesler kısılır, kulak çınlar. */
  flashDeafen(duration: number) {
    if (!this.ctx || !this.flashGain) return;
    const t = this.ctx.currentTime;
    const g = this.flashGain.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(0.15, t);
    g.linearRampToValueAtTime(1, t + Math.max(0.5, duration));
    const b = this.pick('tinnitus');
    if (b) {
      const src = this.ctx.createBufferSource();
      src.buffer = b;
      const gg = this.ctx.createGain();
      gg.gain.value = Math.min(0.5, 0.15 + duration * 0.08);
      src.connect(gg).connect(this.master);
      src.start();
    }
  }
}

export const audio = new AudioEngine();

/**
 * Prosedürel ses sentezi: silah atışları, ayak sesleri, şarjör, bıçak, bombalar, C4,
 * arayüz sesleri. Harici dosya yok; tüm sesler Float32Array'e DSP ile yazılır.
 */
import { WEAPONS, WeaponDef } from '@kervan/shared';

export const SR = 44100;

class Rng {
  constructor(private s: number) {}
  next() {
    this.s = (this.s * 1664525 + 1013904223) >>> 0;
    return this.s / 4294967296;
  }
  noise() {
    return this.next() * 2 - 1;
  }
}

/** RBJ biquad filtresi. */
class Biquad {
  private b0 = 1;
  private b1 = 0;
  private b2 = 0;
  private a1 = 0;
  private a2 = 0;
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;
  constructor(type: 'lp' | 'hp' | 'bp', freq: number, q = 0.707) {
    this.set(type, freq, q);
  }
  set(type: 'lp' | 'hp' | 'bp', freq: number, q = 0.707) {
    const w0 = (2 * Math.PI * Math.min(freq, SR * 0.45)) / SR;
    const cs = Math.cos(w0);
    const alpha = Math.sin(w0) / (2 * q);
    let b0: number;
    let b1: number;
    let b2: number;
    if (type === 'lp') {
      b0 = (1 - cs) / 2;
      b1 = 1 - cs;
      b2 = (1 - cs) / 2;
    } else if (type === 'hp') {
      b0 = (1 + cs) / 2;
      b1 = -(1 + cs);
      b2 = (1 + cs) / 2;
    } else {
      b0 = alpha;
      b1 = 0;
      b2 = -alpha;
    }
    const a0 = 1 + alpha;
    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = (-2 * cs) / a0;
    this.a2 = (1 - alpha) / a0;
  }
  run(x: number) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

function buf(sec: number) {
  return new Float32Array(Math.ceil(sec * SR));
}

function normalize(b: Float32Array, peak = 0.95) {
  let m = 0;
  for (let i = 0; i < b.length; i++) m = Math.max(m, Math.abs(b[i]!));
  if (m > 0) {
    const k = peak / m;
    for (let i = 0; i < b.length; i++) b[i]! *= k;
  }
  return b;
}

/** Filtrelenmiş gürültü katmanı ekle. */
function noiseLayer(out: Float32Array, rng: Rng, start: number, attack: number, decay: number, gain: number, filters: Biquad[]) {
  const s0 = Math.floor(start * SR);
  for (let i = s0; i < out.length; i++) {
    const t = (i - s0) / SR;
    const env = (t < attack ? t / attack : 1) * Math.exp(-(t - Math.min(t, attack)) / decay);
    if (env < 1e-4 && t > attack) break;
    let x = rng.noise();
    for (const f of filters) x = f.run(x);
    out[i]! += x * env * gain;
  }
}

/** Düşen frekanslı sinüs (gümbürtü). */
function thump(out: Float32Array, start: number, f0: number, f1: number, decay: number, gain: number) {
  const s0 = Math.floor(start * SR);
  let ph = 0;
  for (let i = s0; i < out.length; i++) {
    const t = (i - s0) / SR;
    const env = Math.exp(-t / decay);
    if (env < 1e-4) break;
    const f = f1 + (f0 - f1) * Math.exp(-t / (decay * 0.5));
    ph += (2 * Math.PI * f) / SR;
    out[i]! += Math.sin(ph) * env * gain;
  }
}

function ring(out: Float32Array, start: number, freqs: number[], decay: number, gain: number) {
  const s0 = Math.floor(start * SR);
  for (let i = s0; i < out.length; i++) {
    const t = (i - s0) / SR;
    const env = Math.exp(-t / decay);
    if (env < 1e-4) break;
    let x = 0;
    for (let k = 0; k < freqs.length; k++) x += Math.sin(2 * Math.PI * freqs[k]! * t) / (k + 1);
    out[i]! += x * env * gain;
  }
}

function softClip(b: Float32Array, drive: number) {
  for (let i = 0; i < b.length; i++) b[i] = Math.tanh(b[i]! * drive);
}

/** Basit yankı (açık alan geri tepmesi). */
function echo(b: Float32Array, delays: [number, number][]) {
  const src = b.slice();
  for (const [d, g] of delays) {
    const off = Math.floor(d * SR);
    const lp = new Biquad('lp', 1800);
    for (let i = off; i < b.length; i++) b[i]! += lp.run(src[i - off]!) * g;
  }
}

interface GunParams {
  crack: number;
  bodyF: number;
  bodyT: number;
  thumpF: number;
  thumpT: number;
  tailT: number;
  tailF: number;
  mech: number;
  len: number;
  drive: number;
}

function gunParams(w: WeaponDef): GunParams {
  const h = [...w.key].reduce((a, c) => a + c.charCodeAt(0), 0);
  const v = ((h % 17) / 17 - 0.5) * 0.25;
  switch (w.category) {
    case 'pistol':
      if (w.key === 'deagle') return { crack: 1, bodyF: 1300, bodyT: 0.06, thumpF: 75, thumpT: 0.11, tailT: 0.45, tailF: 1100, mech: 0.3, len: 1.1, drive: 2.2 };
      return { crack: 0.9, bodyF: 1900 * (1 + v), bodyT: 0.035, thumpF: 115 * (1 + v), thumpT: 0.05, tailT: 0.28, tailF: 1500, mech: 0.35, len: 0.8, drive: 1.8 };
    case 'smg':
      return { crack: 0.8, bodyF: 2100 * (1 + v), bodyT: 0.03, thumpF: 100 * (1 + v), thumpT: 0.045, tailT: 0.25, tailF: 1600, mech: 0.3, len: 0.75, drive: 1.8 };
    case 'heavy':
      if (w.numBullets > 1) return { crack: 1, bodyF: 950, bodyT: 0.08, thumpF: 62, thumpT: 0.14, tailT: 0.7, tailF: 900, mech: 0.2, len: 1.3, drive: 2.4 };
      return { crack: 0.9, bodyF: 1300 * (1 + v), bodyT: 0.05, thumpF: 80, thumpT: 0.08, tailT: 0.5, tailF: 1200, mech: 0.25, len: 1, drive: 2 };
    case 'sniper':
      if (w.key === 'awp') return { crack: 1.25, bodyF: 850, bodyT: 0.09, thumpF: 52, thumpT: 0.2, tailT: 1.1, tailF: 800, mech: 0.15, len: 1.8, drive: 2.6 };
      return { crack: 1.1, bodyF: 1150 * (1 + v), bodyT: 0.07, thumpF: 65, thumpT: 0.14, tailT: 0.8, tailF: 1000, mech: 0.2, len: 1.4, drive: 2.3 };
    default:
      // tüfekler
      if (w.key === 'ak47' || w.key === 'galilar') return { crack: 1, bodyF: 1150 * (1 + v), bodyT: 0.06, thumpF: 72, thumpT: 0.1, tailT: 0.6, tailF: 1100, mech: 0.25, len: 1.2, drive: 2.3 };
      return { crack: 0.95, bodyF: 1600 * (1 + v), bodyT: 0.048, thumpF: 86 * (1 + v), thumpT: 0.085, tailT: 0.55, tailF: 1300, mech: 0.25, len: 1.1, drive: 2.1 };
  }
}

function gunshot(w: WeaponDef, seed: number): Float32Array {
  const p = gunParams(w);
  const rng = new Rng(seed);
  const out = buf(p.len);
  noiseLayer(out, rng, 0, 0.0004, 0.004, 1.2 * p.crack, [new Biquad('hp', 2600)]);
  noiseLayer(out, rng, 0.0005, 0.001, p.bodyT, 1.0, [new Biquad('lp', p.bodyF, 0.9), new Biquad('hp', 120)]);
  thump(out, 0, p.thumpF * 2.2, p.thumpF, p.thumpT, 0.9);
  noiseLayer(out, rng, 0.004, 0.02, p.tailT, 0.28, [new Biquad('lp', p.tailF), new Biquad('hp', 150)]);
  ring(out, 0.012, [3100 + rng.next() * 900, 5200], 0.02, 0.06 * p.mech);
  softClip(out, p.drive);
  echo(out, [
    [0.11, 0.18],
    [0.23, 0.1],
  ]);
  return normalize(out, 0.95);
}

function silenced(w: WeaponDef, seed: number): Float32Array {
  const rng = new Rng(seed);
  const pistol = w.category === 'pistol';
  const out = buf(0.5);
  noiseLayer(out, rng, 0, 0.002, 0.03, 0.9, [new Biquad('bp', pistol ? 1400 : 1100, 0.9)]);
  thump(out, 0, 220, 120, 0.03, 0.4);
  ring(out, 0.004, [2400, 4100], 0.03, 0.2);
  noiseLayer(out, rng, 0.01, 0.01, 0.12, 0.12, [new Biquad('lp', 900)]);
  return normalize(out, 0.8);
}

type StepKind = 'concrete' | 'sand' | 'wood' | 'metal' | 'tile' | 'dirt' | 'glass' | 'fabric';

function footstep(kind: StepKind, seed: number, heavy = false): Float32Array {
  const rng = new Rng(seed);
  const out = buf(heavy ? 0.4 : 0.25);
  const g = heavy ? 1.3 : 1;
  switch (kind) {
    case 'sand':
    case 'dirt':
      for (let k = 0; k < 6; k++) noiseLayer(out, rng, k * 0.008 + rng.next() * 0.01, 0.002, 0.03, 0.4 * g, [new Biquad('bp', 1500 + rng.next() * 1500, 0.8)]);
      thump(out, 0, 140, 80, 0.04, 0.25 * g);
      break;
    case 'wood':
      thump(out, 0, 260, 160, 0.06, 0.8 * g);
      ring(out, 0, [310, 520], 0.05, 0.25 * g);
      noiseLayer(out, rng, 0, 0.001, 0.015, 0.3 * g, [new Biquad('bp', 2500, 1)]);
      break;
    case 'metal':
      thump(out, 0, 220, 140, 0.04, 0.6 * g);
      ring(out, 0.002, [870, 1420, 2330], 0.16, 0.35 * g);
      noiseLayer(out, rng, 0, 0.001, 0.02, 0.3 * g, [new Biquad('hp', 2000)]);
      break;
    case 'tile':
    case 'glass':
      noiseLayer(out, rng, 0, 0.0005, 0.012, 0.6 * g, [new Biquad('bp', 3200, 1.2)]);
      thump(out, 0.002, 230, 150, 0.035, 0.5 * g);
      break;
    default:
      noiseLayer(out, rng, 0, 0.0008, 0.02, 0.6 * g, [new Biquad('bp', 2200 + rng.next() * 600, 1)]);
      thump(out, 0.001, 170, 110, 0.04, 0.55 * g);
      noiseLayer(out, rng, 0.03, 0.002, 0.02, 0.15 * g, [new Biquad('bp', 1800, 1)]);
  }
  return normalize(out, heavy ? 0.9 : 0.7);
}

function click(seed: number, f: number, len = 0.08, gain = 1): Float32Array {
  const rng = new Rng(seed);
  const out = buf(len);
  noiseLayer(out, rng, 0, 0.0004, 0.006, gain, [new Biquad('hp', f)]);
  ring(out, 0.001, [f * 0.9, f * 1.6], 0.012, 0.4 * gain);
  return normalize(out, 0.7);
}

function slide(seed: number, f0: number, f1: number, len: number): Float32Array {
  const rng = new Rng(seed);
  const out = buf(len + 0.08);
  const bp = new Biquad('bp', f0, 2);
  for (let i = 0; i < len * SR; i++) {
    const t = i / SR / len;
    bp.set('bp', f0 + (f1 - f0) * t, 2);
    out[i] = bp.run(rng.noise()) * Math.sin(t * Math.PI) * 0.8;
  }
  const end = click(seed + 1, 2400, 0.08);
  const off = Math.floor(len * SR);
  for (let i = 0; i < end.length && off + i < out.length; i++) out[off + i]! += end[i]!;
  return normalize(out, 0.7);
}

function whoosh(seed: number, len = 0.22): Float32Array {
  const rng = new Rng(seed);
  const out = buf(len);
  const bp = new Biquad('bp', 600, 1.4);
  for (let i = 0; i < out.length; i++) {
    const t = i / out.length;
    bp.set('bp', 500 + 2500 * Math.sin(t * Math.PI), 1.4);
    out[i] = bp.run(rng.noise()) * Math.sin(t * Math.PI);
  }
  return normalize(out, 0.6);
}

function explosion(seed: number, big: boolean): Float32Array {
  const rng = new Rng(seed);
  const out = buf(big ? 3.5 : 2.4);
  noiseLayer(out, rng, 0, 0.001, 0.01, 1.4, [new Biquad('hp', 1500)]);
  noiseLayer(out, rng, 0, 0.004, big ? 0.6 : 0.35, 1.2, [new Biquad('lp', big ? 500 : 700), new Biquad('hp', 40)]);
  thump(out, 0, 90, 32, big ? 0.5 : 0.3, 1.2);
  noiseLayer(out, rng, 0.05, 0.05, big ? 1.4 : 0.9, 0.35, [new Biquad('lp', 400)]);
  // enkaz tıkırtıları
  for (let k = 0; k < 25; k++) noiseLayer(out, rng, 0.2 + rng.next() * 1.2, 0.001, 0.01, 0.15 * rng.next(), [new Biquad('bp', 1500 + rng.next() * 3000, 2)]);
  softClip(out, 2.5);
  echo(out, [
    [0.2, 0.3],
    [0.45, 0.18],
  ]);
  return normalize(out, 0.98);
}

function beep(f: number, len: number, gain = 1): Float32Array {
  const out = buf(len + 0.02);
  for (let i = 0; i < len * SR; i++) {
    const t = i / SR;
    const env = Math.min(1, t / 0.004) * Math.min(1, (len - t) / 0.01);
    out[i] = (Math.sin(2 * Math.PI * f * t) * 0.8 + Math.sin(4 * Math.PI * f * t) * 0.2) * env * gain;
  }
  return out;
}

function chord(freqs: number[], len: number, arp = 0.08): Float32Array {
  const out = buf(len);
  freqs.forEach((f, k) => {
    const s0 = Math.floor(k * arp * SR);
    for (let i = s0; i < out.length; i++) {
      const t = (i - s0) / SR;
      const env = Math.min(1, t / 0.02) * Math.exp(-t / (len * 0.45));
      out[i]! += (Math.sin(2 * Math.PI * f * t) + 0.3 * Math.sin(4 * Math.PI * f * t) + 0.15 * Math.sin(6 * Math.PI * f * t)) * env * 0.3;
    }
  });
  return normalize(out, 0.6);
}

function loopNoise(seed: number, len: number, lp: number, hp: number, mod: number): Float32Array {
  const rng = new Rng(seed);
  const out = buf(len);
  const f1 = new Biquad('lp', lp);
  const f2 = new Biquad('hp', hp);
  for (let i = 0; i < out.length; i++) {
    const t = i / SR;
    const m = 1 - mod + mod * (0.5 + 0.5 * Math.sin((2 * Math.PI * t) / len) * Math.sin((2 * Math.PI * 3 * t) / len));
    out[i] = f2.run(f1.run(rng.noise())) * m;
  }
  // kenarları yumuşat (döngü)
  const fade = Math.floor(0.05 * SR);
  for (let i = 0; i < fade; i++) {
    const k = i / fade;
    out[i]! *= k;
    out[out.length - 1 - i]! *= k;
  }
  return normalize(out, 0.6);
}

function fireLoop(seed: number): Float32Array {
  const rng = new Rng(seed);
  const out = loopNoise(seed, 3, 700, 60, 0.4);
  for (let k = 0; k < 140; k++) noiseLayer(out, rng, rng.next() * 2.9, 0.0005, 0.006, 0.5 * rng.next(), [new Biquad('bp', 1500 + rng.next() * 3500, 2)]);
  return normalize(out, 0.7);
}

function glassBreak(seed: number): Float32Array {
  const rng = new Rng(seed);
  const out = buf(0.8);
  noiseLayer(out, rng, 0, 0.001, 0.05, 0.8, [new Biquad('hp', 3000)]);
  for (let k = 0; k < 30; k++) ring(out, rng.next() * 0.4, [3000 + rng.next() * 5000], 0.03, 0.2 * rng.next());
  return normalize(out, 0.8);
}

function fleshHit(seed: number): Float32Array {
  const rng = new Rng(seed);
  const out = buf(0.2);
  thump(out, 0, 180, 70, 0.05, 1);
  noiseLayer(out, rng, 0, 0.001, 0.03, 0.6, [new Biquad('lp', 900)]);
  return normalize(out, 0.8);
}

function helmetDink(): Float32Array {
  const out = buf(0.6);
  ring(out, 0, [2350, 3170, 4520], 0.18, 0.9);
  return normalize(out, 0.75);
}

function tinnitus(): Float32Array {
  const out = buf(3);
  for (let i = 0; i < out.length; i++) {
    const t = i / SR;
    out[i] = Math.sin(2 * Math.PI * 3400 * t) * Math.exp(-t / 1.4) * 0.35 + Math.sin(2 * Math.PI * 3530 * t) * Math.exp(-t / 1.1) * 0.15;
  }
  return out;
}

export interface SoundBank {
  [name: string]: Float32Array[];
}

/** Tüm sesleri üret. */
export function synthesizeAll(): SoundBank {
  const bank: SoundBank = {};
  const add = (name: string, ...b: Float32Array[]) => {
    (bank[name] ??= []).push(...b);
  };
  for (const w of WEAPONS) {
    if (['knife', 'c4', 'grenade'].includes(w.category)) continue;
    add(`shot_${w.key}`, gunshot(w, w.num * 31 + 1), gunshot(w, w.num * 31 + 2));
    if (w.silencer !== 'none') add(`shot_${w.key}_sil`, silenced(w, w.num * 37), silenced(w, w.num * 37 + 5));
  }
  for (const k of ['concrete', 'sand', 'wood', 'metal', 'tile', 'dirt', 'glass', 'fabric'] as StepKind[]) {
    for (let i = 0; i < 4; i++) add(`step_${k}`, footstep(k, 100 + i * 7 + k.length * 13));
    add(`land_${k}`, footstep(k, 900 + k.length, true));
  }
  add('dryfire', click(5, 3500, 0.06));
  add('mag_out', slide(11, 900, 1500, 0.12));
  add('mag_in', click(12, 1800, 0.1, 1));
  add('bolt', slide(13, 1200, 2600, 0.18));
  add('pump', slide(14, 600, 1300, 0.2));
  add('shell_in', click(15, 1400, 0.1));
  add('deploy', slide(16, 700, 1600, 0.15));
  add('zoom', click(17, 2800, 0.05, 0.6));
  add('silencer', slide(18, 1500, 3000, 0.3));
  add('knife_swing', whoosh(21), whoosh(22));
  add('knife_hit', fleshHit(23));
  add('knife_wall', click(24, 3000, 0.15));
  add('hit_body', fleshHit(25), fleshHit(26));
  add('hit_head', helmetDink());
  add('hit_headnohelm', fleshHit(27));
  add('pin', click(31, 2600, 0.1));
  add('throw', whoosh(32, 0.3));
  add('bounce', click(33, 1600, 0.08), click(34, 1900, 0.08));
  add('he', explosion(41, false));
  add('c4_explode', explosion(42, true));
  add('flash', explosion(43, false));
  add('smoke_pop', click(44, 900, 0.3));
  add('smoke_hiss', loopNoise(45, 3, 9000, 2500, 0.3));
  add('glass', glassBreak(46));
  add('fire_loop', fireLoop(47));
  add('tinnitus', tinnitus());
  add('c4_beep', beep(1650, 0.11));
  add('c4_key', beep(1200, 0.05), beep(1350, 0.05));
  add('c4_plant', chord([880, 1320], 0.4, 0.05));
  add('defuse_tick', click(48, 2200, 0.05, 0.6));
  add('defused', chord([660, 880, 1320], 1.2, 0.12));
  add('ui_click', beep(900, 0.03, 0.5));
  add('ui_buy', chord([1046, 1568], 0.25, 0.05));
  add('ui_deny', beep(220, 0.12, 0.6));
  add('round_start', chord([196, 247, 294, 392], 1.6, 0.06));
  add('round_win', chord([523, 659, 784, 1046], 2.2, 0.12));
  add('round_lose', chord([440, 523, 659], 2, 0.15));
  add('wind', loopNoise(49, 8, 500, 60, 0.7));
  add('pickup', click(50, 1600, 0.1));
  return bank;
}

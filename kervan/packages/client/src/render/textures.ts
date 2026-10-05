/**
 * Prosedürel PBR dokuları: albedo + normal + pürüzlülük. Tekrarlanabilir (tileable)
 * değer gürültüsü ile tarayıcıda üretilir; harici dosya gerekmez.
 */
import * as THREE from 'three';
import { Mat } from '@kervan/shared';

type RGB = [number, number, number];

class Noise {
  private perm: Uint8Array;
  constructor(seed: number) {
    this.perm = new Uint8Array(512);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    let s = seed >>> 0 || 1;
    for (let i = 255; i > 0; i--) {
      s = (s * 1664525 + 1013904223) >>> 0;
      const j = s % (i + 1);
      const t = p[i]!;
      p[i] = p[j]!;
      p[j] = t;
    }
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255]!;
  }
  private h(x: number, y: number): number {
    return this.perm[(this.perm[x & 255]! + y) & 511]! / 255;
  }
  /** Periyodik değer gürültüsü (period hücre). */
  value(x: number, y: number, period: number): number {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const u = xf * xf * (3 - 2 * xf);
    const v = yf * yf * (3 - 2 * yf);
    const x0 = ((xi % period) + period) % period;
    const y0 = ((yi % period) + period) % period;
    const x1 = (x0 + 1) % period;
    const y1 = (y0 + 1) % period;
    const a = this.h(x0, y0);
    const b = this.h(x1, y0);
    const c = this.h(x0, y1);
    const d = this.h(x1, y1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  fbm(x: number, y: number, period: number, octaves: number, gain = 0.5): number {
    let sum = 0;
    let amp = 0.5;
    let f = 1;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += amp * this.value(x * f, y * f, period * f);
      norm += amp;
      amp *= gain;
      f *= 2;
    }
    return sum / norm;
  }
}

interface Layers {
  size: number;
  albedo: Float32Array; // rgb 0..1
  height: Float32Array; // 0..1
  rough: Float32Array; // 0..1
}

function layers(size: number): Layers {
  return { size, albedo: new Float32Array(size * size * 3), height: new Float32Array(size * size), rough: new Float32Array(size * size) };
}

const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const hex = (h: number): RGB => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

function genSand(L: Layers, n: Noise) {
  const S = L.size;
  const base = hex(0xc9a873);
  const dark = hex(0xa7834f);
  const light = hex(0xe2c795);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const u = x / S;
      const v = y / S;
      const big = n.fbm(u * 4, v * 4, 4, 4);
      const ripple = Math.sin((u * 3 + n.fbm(u * 2, v * 2, 2, 2) * 1.4) * Math.PI * 2 * 3) * 0.5 + 0.5;
      const grain = n.value(x * 0.9, y * 0.9, S * 0.9) * 0.6 + n.value(x * 0.37, y * 0.37, Math.round(S * 0.37)) * 0.4;
      let c = mix(dark, light, clamp01(big * 1.2 - 0.1));
      c = mix(c, base, 0.35);
      const g = (grain - 0.5) * 0.12;
      const i = y * S + x;
      L.albedo[i * 3] = clamp01(c[0] + g);
      L.albedo[i * 3 + 1] = clamp01(c[1] + g);
      L.albedo[i * 3 + 2] = clamp01(c[2] + g * 0.8);
      L.height[i] = big * 0.5 + ripple * 0.2 + grain * 0.3;
      L.rough[i] = 0.92 + grain * 0.06;
    }
  // çakıllar
  for (let k = 0; k < 140; k++) {
    const cx = n.value(k * 13.1, 3.7, 1e6) * S;
    const cy = n.value(7.3, k * 11.7, 1e6) * S;
    const r = 1.5 + n.value(k * 3.3, k * 5.1, 1e6) * 3.5;
    blob(L, cx, cy, r, mix(dark, hex(0x8a7a66), 0.5), 0.35);
  }
}

function blob(L: Layers, cx: number, cy: number, r: number, col: RGB, h: number) {
  const S = L.size;
  for (let dy = -Math.ceil(r); dy <= Math.ceil(r); dy++)
    for (let dx = -Math.ceil(r); dx <= Math.ceil(r); dx++) {
      const d = Math.hypot(dx, dy) / r;
      if (d > 1) continue;
      const x = (((Math.round(cx) + dx) % S) + S) % S;
      const y = (((Math.round(cy) + dy) % S) + S) % S;
      const i = y * S + x;
      const t = (1 - d * d) * 0.85;
      L.albedo[i * 3] = L.albedo[i * 3]! * (1 - t) + col[0] * t;
      L.albedo[i * 3 + 1] = L.albedo[i * 3 + 1]! * (1 - t) + col[1] * t;
      L.albedo[i * 3 + 2] = L.albedo[i * 3 + 2]! * (1 - t) + col[2] * t;
      L.height[i] = Math.max(L.height[i]!, h + (1 - d) * 0.5);
    }
}

function genPlaster(L: Layers, n: Noise) {
  const S = L.size;
  const a = hex(0xeadcc0);
  const b = hex(0xc9b08a);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const u = x / S;
      const v = y / S;
      const patch = n.fbm(u * 3, v * 3, 3, 5);
      const fine = n.fbm(u * 32, v * 32, 32, 2);
      const stain = Math.pow(n.fbm(u * 6 + 10, v * 6, 6, 4), 3);
      let c = mix(a, b, clamp01(patch * 1.6 - 0.35));
      c = mix(c, hex(0xa88a62), stain * 0.85);
      const i = y * S + x;
      const g = (fine - 0.5) * 0.1;
      L.albedo[i * 3] = clamp01(c[0] + g);
      L.albedo[i * 3 + 1] = clamp01(c[1] + g);
      L.albedo[i * 3 + 2] = clamp01(c[2] + g);
      L.height[i] = patch * 0.5 + fine * 0.5;
      L.rough[i] = 0.88;
    }
  // çatlaklar
  for (let k = 0; k < 6; k++) {
    let x = n.value(k * 9.1, 1.3, 1e6) * S;
    let y = n.value(2.1, k * 7.7, 1e6) * S;
    let ang = n.value(k, k, 1e6) * Math.PI * 2;
    for (let s = 0; s < 90; s++) {
      ang += (n.value(s * 0.3 + k * 10, 4, 1e6) - 0.5) * 0.9;
      x += Math.cos(ang) * 1.3;
      y += Math.sin(ang) * 1.3;
      const xi = ((Math.round(x) % S) + S) % S;
      const yi = ((Math.round(y) % S) + S) % S;
      const i = yi * S + xi;
      L.albedo[i * 3]! *= 0.72;
      L.albedo[i * 3 + 1]! *= 0.7;
      L.albedo[i * 3 + 2]! *= 0.68;
      L.height[i] = 0.05;
    }
  }
}

/** Düzensiz taş döşeme / blok duvar. */
function genStone(L: Layers, n: Noise, rows: number, cols: number, colA: number, colB: number, mortarCol: number) {
  const S = L.size;
  const A = hex(colA);
  const B = hex(colB);
  const M = hex(mortarCol);
  const ch = S / rows;
  const cw = S / cols;
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const row = Math.floor(y / ch);
      const off = row % 2 ? cw * 0.5 : 0;
      const xx = (x + off) % S;
      const col = Math.floor(xx / cw);
      const lx = (xx - col * cw) / cw;
      const ly = (y - row * ch) / ch;
      const edge = Math.min(lx, 1 - lx, ly * (ch / cw), (1 - ly) * (ch / cw));
      const wob = (n.fbm(x / S * 8, y / S * 8, 8, 3) - 0.5) * 0.06;
      const mortar = edge + wob < 0.045;
      const tileTone = n.value(col * 7.13 + row * 3.1, row * 5.7, 1e6);
      const u = x / S;
      const v = y / S;
      const fine = n.fbm(u * 24, v * 24, 24, 3);
      let c = mix(A, B, tileTone);
      c = mix(c, hex(0x7d6a52), Math.pow(n.fbm(u * 5, v * 5, 5, 4), 2.5) * 0.7);
      const i = y * S + x;
      if (mortar) c = mix(M, c, 0.2);
      const g = (fine - 0.5) * 0.12;
      L.albedo[i * 3] = clamp01(c[0] + g);
      L.albedo[i * 3 + 1] = clamp01(c[1] + g);
      L.albedo[i * 3 + 2] = clamp01(c[2] + g);
      L.height[i] = mortar ? 0.1 : 0.55 + Math.min(edge * 3, 0.3) + fine * 0.15;
      L.rough[i] = mortar ? 0.95 : 0.78 + fine * 0.12;
    }
}

function genWood(L: Layers, n: Noise, crate: boolean) {
  const S = L.size;
  const dark = hex(0x6b4a2b);
  const mid = hex(0x9a6e42);
  const light = hex(0xb98b57);
  const planks = 6;
  const pw = S / planks;
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const u = x / S;
      const v = y / S;
      const p = Math.floor(y / pw);
      const ly = (y - p * pw) / pw;
      const tone = n.value(p * 9.7, 1.1, 1e6);
      const grain = Math.sin((u * 40 + n.fbm(u * 3, v * 3 + p, 3, 3) * 6 + p * 1.7) * Math.PI) * 0.5 + 0.5;
      const knot = Math.pow(n.fbm(u * 6 + p, v * 6, 6, 3), 4);
      let c = mix(mid, light, tone * 0.7);
      c = mix(c, dark, grain * 0.25 + knot * 0.6);
      const gap = ly < 0.035 || ly > 0.965;
      let h = 0.6 + grain * 0.15;
      if (gap) {
        c = mix(c, hex(0x2b1d10), 0.75);
        h = 0.1;
      }
      if (crate) {
        // çerçeve: kenarlarda kalın tahta ve çapraz destek
        const fx = Math.min(u, 1 - u);
        const fy = Math.min(v, 1 - v);
        const frame = Math.min(fx, fy) < 0.11;
        const diag = Math.abs(u - v) < 0.07 && !frame;
        if (frame || diag) {
          const g2 = Math.sin((frame && fx < fy ? v : u) * 120 + n.value(x * 0.1, y * 0.1, 1e6) * 4) * 0.5 + 0.5;
          c = mix(mix(hex(0x8a5f36), hex(0xa77a48), g2 * 0.5), dark, 0.15);
          h = 0.95;
          const border = Math.abs(Math.min(fx, fy) - 0.11) < 0.008 || (diag && Math.abs(Math.abs(u - v) - 0.07) < 0.008);
          if (border) {
            c = mix(c, hex(0x3a2614), 0.6);
            h = 0.5;
          }
          // çiviler
          const nx = Math.abs(((u * 8) % 1) - 0.5) < 0.05 && fy < 0.055 && fy > 0.03;
          const ny = Math.abs(((v * 8) % 1) - 0.5) < 0.05 && fx < 0.055 && fx > 0.03;
          if (nx || ny) {
            c = hex(0x55534f);
            h = 1;
          }
        }
      }
      const i = y * S + x;
      L.albedo[i * 3] = c[0];
      L.albedo[i * 3 + 1] = c[1];
      L.albedo[i * 3 + 2] = c[2];
      L.height[i] = h;
      L.rough[i] = 0.82 - grain * 0.06;
    }
}

function genTile(L: Layers, n: Noise) {
  const S = L.size;
  const tiles = 4;
  const tw = S / tiles;
  const A = hex(0xb86f4a);
  const B = hex(0xd18b5f);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const tx = Math.floor(x / tw);
      const ty = Math.floor(y / tw);
      const lx = (x - tx * tw) / tw;
      const ly = (y - ty * tw) / tw;
      const edge = Math.min(lx, 1 - lx, ly, 1 - ly);
      const grout = edge < 0.035;
      const tone = n.value(tx * 3.3 + 1, ty * 7.1, 1e6);
      const u = x / S;
      const v = y / S;
      const wear = n.fbm(u * 8, v * 8, 8, 4);
      let c = mix(A, B, tone);
      c = mix(c, hex(0xd9c3a0), Math.pow(wear, 3) * 0.8);
      if (grout) c = hex(0x9c8c76);
      const i = y * S + x;
      const g = (n.value(x * 0.7, y * 0.7, Math.round(S * 0.7)) - 0.5) * 0.06;
      L.albedo[i * 3] = clamp01(c[0] + g);
      L.albedo[i * 3 + 1] = clamp01(c[1] + g);
      L.albedo[i * 3 + 2] = clamp01(c[2] + g);
      L.height[i] = grout ? 0.15 : 0.6 + Math.min(edge * 4, 0.2) - wear * 0.1;
      L.rough[i] = grout ? 0.95 : 0.65 + wear * 0.2;
    }
}

function genConcrete(L: Layers, n: Noise) {
  const S = L.size;
  const A = hex(0x8f8a82);
  const B = hex(0xa9a397);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const u = x / S;
      const v = y / S;
      const big = n.fbm(u * 4, v * 4, 4, 5);
      const pores = n.value(x * 0.8, y * 0.8, Math.round(S * 0.8));
      const stain = Math.pow(n.fbm(u * 3 + 5, v * 3, 3, 4), 2.2);
      let c = mix(A, B, big);
      c = mix(c, hex(0x5f5a52), stain * 0.6);
      const p = pores > 0.92 ? -0.12 : 0;
      const i = y * S + x;
      L.albedo[i * 3] = clamp01(c[0] + p);
      L.albedo[i * 3 + 1] = clamp01(c[1] + p);
      L.albedo[i * 3 + 2] = clamp01(c[2] + p);
      L.height[i] = big * 0.7 + (pores > 0.92 ? 0 : 0.3);
      L.rough[i] = 0.9;
    }
}

function genMetal(L: Layers, n: Noise) {
  const S = L.size;
  const paint = hex(0x4f6b5a);
  const rust = hex(0x7a4a2a);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const u = x / S;
      const v = y / S;
      const r = Math.pow(n.fbm(u * 6, v * 6, 6, 5), 3);
      const scratch = n.value(x * 0.05, y * 2.0, 1e6) > 0.97 ? 1 : 0;
      const panel = Math.abs(((u * 2) % 1) - 0.5) > 0.48 || Math.abs(((v * 2) % 1) - 0.5) > 0.48;
      let c = mix(paint, rust, clamp01(r * 2));
      if (scratch) c = mix(c, hex(0xb0b0aa), 0.6);
      if (panel) c = mix(c, hex(0x222222), 0.5);
      const i = y * S + x;
      L.albedo[i * 3] = c[0];
      L.albedo[i * 3 + 1] = c[1];
      L.albedo[i * 3 + 2] = c[2];
      L.height[i] = panel ? 0.2 : 0.6 - r * 0.2;
      L.rough[i] = 0.45 + r * 0.45;
    }
}

function toTextures(L: Layers, normalStrength: number, anisotropy: number) {
  const S = L.size;
  const alb = new Uint8Array(S * S * 4);
  const nor = new Uint8Array(S * S * 4);
  const rgh = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      // sRGB'ye çevir (albedo değerleri doğrusal kabul edilerek yazılır; renkler zaten sRGB tasarlandı)
      alb[i * 4] = Math.round(L.albedo[i * 3]! * 255);
      alb[i * 4 + 1] = Math.round(L.albedo[i * 3 + 1]! * 255);
      alb[i * 4 + 2] = Math.round(L.albedo[i * 3 + 2]! * 255);
      alb[i * 4 + 3] = 255;
      const hL = L.height[y * S + ((x - 1 + S) % S)]!;
      const hR = L.height[y * S + ((x + 1) % S)]!;
      const hD = L.height[((y - 1 + S) % S) * S + x]!;
      const hU = L.height[((y + 1) % S) * S + x]!;
      let nx = (hL - hR) * normalStrength;
      let ny = (hD - hU) * normalStrength;
      let nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l;
      ny /= l;
      nz /= l;
      nor[i * 4] = Math.round((nx * 0.5 + 0.5) * 255);
      nor[i * 4 + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      nor[i * 4 + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      nor[i * 4 + 3] = 255;
      const r = Math.round(clamp01(L.rough[i]!) * 255);
      rgh[i * 4] = 255;
      rgh[i * 4 + 1] = r;
      rgh[i * 4 + 2] = 0;
      rgh[i * 4 + 3] = 255;
    }
  const mk = (data: Uint8Array, srgb: boolean) => {
    const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = anisotropy;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.needsUpdate = true;
    return t;
  };
  return { map: mk(alb, true), normalMap: mk(nor, false), roughnessMap: mk(rgh, false) };
}

export interface SurfaceMaterial {
  material: THREE.MeshStandardMaterial;
  /** Dünya birimi cinsinden doku tekrar boyu. */
  scale: number;
}

export function createSurfaceMaterials(quality: 'low' | 'medium' | 'high', anisotropy: number): Record<number, SurfaceMaterial> {
  const S = quality === 'low' ? 256 : 512;
  const n = new Noise(1337);
  const make = (gen: (L: Layers) => void, scale: number, normal: number, extra: Partial<THREE.MeshStandardMaterialParameters> = {}): SurfaceMaterial => {
    const L = layers(S);
    gen(L);
    const t = toTextures(L, normal, anisotropy);
    const material = new THREE.MeshStandardMaterial({
      map: t.map,
      normalMap: t.normalMap,
      roughnessMap: t.roughnessMap,
      roughness: 1,
      metalness: 0,
      vertexColors: true,
      ...extra,
    });
    return { material, scale };
  };
  const sand = make((L) => genSand(L, n), 256, 3);
  const plaster = make((L) => genPlaster(L, n), 256, 2.5);
  const stone = make((L) => genStone(L, n, 6, 4, 0xc2ab86, 0xd8c39c, 0x8c7b63), 192, 5);
  const tile = make((L) => genTile(L, n), 128, 4);
  const wood = make((L) => genWood(L, n, false), 96, 4);
  const crate = make((L) => genWood(L, n, true), 64, 5);
  const concrete = make((L) => genConcrete(L, n), 256, 2.5);
  const metal = make((L) => genMetal(L, n), 128, 3, { metalness: 0.6 });
  const brick = make((L) => genStone(L, n, 16, 6, 0xb0704f, 0xc58560, 0x9c8c78), 128, 5);
  return {
    [Mat.Sand]: sand,
    [Mat.Dirt]: sand,
    [Mat.Plaster]: plaster,
    [Mat.Stone]: stone,
    [Mat.Tile]: tile,
    [Mat.Wood]: crate,
    [Mat.Cardboard]: wood,
    [Mat.Fabric]: wood,
    [Mat.Concrete]: concrete,
    [Mat.Metal]: metal,
    [Mat.MetalThin]: metal,
    [Mat.Brick]: brick,
    [Mat.Glass]: concrete,
    [Mat.Clip]: concrete,
  };
}

/** Düz ahşap (kapılar) — kasa olmayan ahşap yüzeyler. */
export function plainWoodKey(): number {
  return Mat.Cardboard;
}

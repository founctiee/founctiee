/**
 * CS2 tarzı hacimsel sis: patlama noktasından voksel taşma (flood fill). Duvarlardan
 * geçmez, koridorlara akar (hacim korunur). İstemci ve sunucu aynı veriden aynı sisi üretir.
 */
import { Vec3 } from '../math';
import { World } from '../world/world';
import { MASK_SHOT } from '../world/brush';

export const SMOKE_VOXEL = 16;
export const SMOKE_NX = 48;
export const SMOKE_NY = 48;
export const SMOKE_NZ = 20;
/** Sisin dolduracağı voksel sayısı (≈ 144x144x110 elipsoid). */
export const SMOKE_BUDGET = 2300;
/** Genişleme süresi (s). */
export const SMOKE_GROW_TIME = 1.2;

export interface SmokeVolume {
  id: number;
  center: Vec3;
  /** Izgaranın (0,0,0) vokselinin alt köşesi. */
  origin: Vec3;
  /** 0 = boş, k>0 = doldurma sırası (1..budget). */
  order: Uint16Array;
  count: number;
  /** Mermi/HE ile açılan geçici delikler: 0..1 (1 = tamamen açık). */
  hole: Float32Array;
  bornAt: number;
}

export function voxelIndex(x: number, y: number, z: number): number {
  return x + SMOKE_NX * (y + SMOKE_NY * z);
}

class MinHeap {
  private keys: number[] = [];
  private vals: number[] = [];
  get size() {
    return this.keys.length;
  }
  push(k: number, v: number) {
    const ks = this.keys;
    const vs = this.vals;
    ks.push(k);
    vs.push(v);
    let i = ks.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (ks[p]! <= ks[i]!) break;
      [ks[p], ks[i]] = [ks[i]!, ks[p]!];
      [vs[p], vs[i]] = [vs[i]!, vs[p]!];
      i = p;
    }
  }
  pop(): number {
    const ks = this.keys;
    const vs = this.vals;
    const top = vs[0]!;
    const lk = ks.pop()!;
    const lv = vs.pop()!;
    if (ks.length > 0) {
      ks[0] = lk;
      vs[0] = lv;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < ks.length && ks[l]! < ks[m]!) m = l;
        if (r < ks.length && ks[r]! < ks[m]!) m = r;
        if (m === i) break;
        [ks[m], ks[i]] = [ks[i]!, ks[m]!];
        [vs[m], vs[i]] = [vs[i]!, vs[m]!];
        i = m;
      }
    }
    return top;
  }
}

export function fillSmoke(world: World, id: number, pos: Vec3, bornAt: number): SmokeVolume {
  const origin = {
    x: pos.x - (SMOKE_NX * SMOKE_VOXEL) / 2,
    y: pos.y - (SMOKE_NY * SMOKE_VOXEL) / 2,
    z: pos.z - SMOKE_VOXEL * 3,
  };
  const n = SMOKE_NX * SMOKE_NY * SMOKE_NZ;
  const order = new Uint16Array(n);
  const visited = new Uint8Array(n);
  const center = (x: number, y: number, z: number): Vec3 => ({
    x: origin.x + (x + 0.5) * SMOKE_VOXEL,
    y: origin.y + (y + 0.5) * SMOKE_VOXEL,
    z: origin.z + (z + 0.5) * SMOKE_VOXEL,
  });

  // başlangıç vokseli: patlama noktası (biraz yukarı kaydırılarak katıdan kaçın)
  let sx = Math.floor((pos.x - origin.x) / SMOKE_VOXEL);
  let sy = Math.floor((pos.y - origin.y) / SMOKE_VOXEL);
  let sz = Math.floor((pos.z + 4 - origin.z) / SMOKE_VOXEL);
  for (let k = 0; k < 4 && world.pointInSolid(center(sx, sy, sz), MASK_SHOT); k++) sz++;
  void sx;
  void sy;

  const heap = new MinHeap();
  const key = (x: number, y: number, z: number) => {
    const c = center(x, y, z);
    const dx = c.x - pos.x;
    const dy = c.y - pos.y;
    const dz = (c.z - pos.z - 40) * 1.35;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  };
  const start = voxelIndex(sx, sy, sz);
  visited[start] = 1;
  heap.push(0, start);
  let count = 0;
  const NB: [number, number, number][] = [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1],
  ];
  while (heap.size > 0 && count < SMOKE_BUDGET) {
    const idx = heap.pop();
    const x = idx % SMOKE_NX;
    const y = Math.floor(idx / SMOKE_NX) % SMOKE_NY;
    const z = Math.floor(idx / (SMOKE_NX * SMOKE_NY));
    const c = center(x, y, z);
    if (world.pointInSolid(c, MASK_SHOT)) continue;
    order[idx] = ++count;
    for (const [dx, dy, dz] of NB) {
      const nx = x + dx;
      const ny = y + dy;
      const nz = z + dz;
      if (nx < 0 || ny < 0 || nz < 0 || nx >= SMOKE_NX || ny >= SMOKE_NY || nz >= SMOKE_NZ) continue;
      const ni = voxelIndex(nx, ny, nz);
      if (visited[ni]) continue;
      visited[ni] = 1;
      const nc = center(nx, ny, nz);
      const tr = world.traceRay(c, nc, MASK_SHOT);
      if (tr.fraction < 1) continue;
      heap.push(key(nx, ny, nz), ni);
    }
  }
  return { id, center: { ...pos }, origin, order, count, hole: new Float32Array(n), bornAt };
}

/** t anında vokselin yoğunluğu (0..1): büyüme, sönme ve delikler dahil. */
export function smokeDensity(v: SmokeVolume, idx: number, age: number, duration: number, fade: number): number {
  const o = v.order[idx]!;
  if (o === 0) return 0;
  const appear = (o / v.count) * SMOKE_GROW_TIME;
  if (age < appear) return 0;
  let d = Math.min(1, (age - appear) / 0.35);
  const remain = duration - age;
  if (remain < fade) d *= Math.max(0, remain / fade);
  return d * (1 - v.hole[idx]!);
}

/** Mermi sisin içinden geçince geçici tünel açar. */
export function carveSmokeLine(v: SmokeVolume, a: Vec3, b: Vec3, radius = 14): boolean {
  const len = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  const steps = Math.ceil(len / (SMOKE_VOXEL * 0.5));
  let touched = false;
  const r = Math.ceil(radius / SMOKE_VOXEL);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const px = a.x + (b.x - a.x) * t;
    const py = a.y + (b.y - a.y) * t;
    const pz = a.z + (b.z - a.z) * t;
    const gx = Math.floor((px - v.origin.x) / SMOKE_VOXEL);
    const gy = Math.floor((py - v.origin.y) / SMOKE_VOXEL);
    const gz = Math.floor((pz - v.origin.z) / SMOKE_VOXEL);
    for (let z = gz - r; z <= gz + r; z++)
      for (let y = gy - r; y <= gy + r; y++)
        for (let x = gx - r; x <= gx + r; x++) {
          if (x < 0 || y < 0 || z < 0 || x >= SMOKE_NX || y >= SMOKE_NY || z >= SMOKE_NZ) continue;
          const idx = voxelIndex(x, y, z);
          if (!v.order[idx]) continue;
          const cx = v.origin.x + (x + 0.5) * SMOKE_VOXEL - px;
          const cy = v.origin.y + (y + 0.5) * SMOKE_VOXEL - py;
          const cz = v.origin.z + (z + 0.5) * SMOKE_VOXEL - pz;
          const d = Math.sqrt(cx * cx + cy * cy + cz * cz);
          if (d > radius + SMOKE_VOXEL * 0.5) continue;
          const amount = Math.max(0, 1 - d / (radius + SMOKE_VOXEL * 0.5));
          if (amount > v.hole[idx]!) {
            v.hole[idx] = amount;
            touched = true;
          }
        }
  }
  return touched;
}

/** HE patlaması sisi iter (küresel boşluk). */
export function carveSmokeSphere(v: SmokeVolume, p: Vec3, radius: number): void {
  const r = Math.ceil(radius / SMOKE_VOXEL);
  const gx = Math.floor((p.x - v.origin.x) / SMOKE_VOXEL);
  const gy = Math.floor((p.y - v.origin.y) / SMOKE_VOXEL);
  const gz = Math.floor((p.z - v.origin.z) / SMOKE_VOXEL);
  for (let z = gz - r; z <= gz + r; z++)
    for (let y = gy - r; y <= gy + r; y++)
      for (let x = gx - r; x <= gx + r; x++) {
        if (x < 0 || y < 0 || z < 0 || x >= SMOKE_NX || y >= SMOKE_NY || z >= SMOKE_NZ) continue;
        const idx = voxelIndex(x, y, z);
        if (!v.order[idx]) continue;
        const cx = v.origin.x + (x + 0.5) * SMOKE_VOXEL - p.x;
        const cy = v.origin.y + (y + 0.5) * SMOKE_VOXEL - p.y;
        const cz = v.origin.z + (z + 0.5) * SMOKE_VOXEL - p.z;
        const d = Math.sqrt(cx * cx + cy * cy + cz * cz);
        if (d > radius) continue;
        const amount = Math.min(1, 1.6 * (1 - d / radius));
        if (amount > v.hole[idx]!) v.hole[idx] = amount;
      }
}

/** Delikler zamanla tekrar dolar. */
export function healSmoke(v: SmokeVolume, dt: number, rate = 0.7): void {
  const h = v.hole;
  for (let i = 0; i < h.length; i++) {
    if (h[i]! > 0) {
      h[i] = Math.max(0, h[i]! - dt * rate);
    }
  }
}

/** Işın hattı boyunca sis yoğunluğu toplamı (görüş engeli testi). */
export function smokeOpticalDepth(v: SmokeVolume, a: Vec3, b: Vec3, age: number, duration: number, fade: number): number {
  const len = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  const steps = Math.max(1, Math.ceil(len / (SMOKE_VOXEL * 0.5)));
  let acc = 0;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const gx = Math.floor((a.x + (b.x - a.x) * t - v.origin.x) / SMOKE_VOXEL);
    const gy = Math.floor((a.y + (b.y - a.y) * t - v.origin.y) / SMOKE_VOXEL);
    const gz = Math.floor((a.z + (b.z - a.z) * t - v.origin.z) / SMOKE_VOXEL);
    if (gx < 0 || gy < 0 || gz < 0 || gx >= SMOKE_NX || gy >= SMOKE_NY || gz >= SMOKE_NZ) continue;
    acc += smokeDensity(v, voxelIndex(gx, gy, gz), age, duration, fade) * (len / steps);
  }
  return acc;
}

export function pointInSmoke(v: SmokeVolume, p: Vec3, age: number, duration: number, fade: number): number {
  const gx = Math.floor((p.x - v.origin.x) / SMOKE_VOXEL);
  const gy = Math.floor((p.y - v.origin.y) / SMOKE_VOXEL);
  const gz = Math.floor((p.z - v.origin.z) / SMOKE_VOXEL);
  if (gx < 0 || gy < 0 || gz < 0 || gx >= SMOKE_NX || gy >= SMOKE_NY || gz >= SMOKE_NZ) return 0;
  return smokeDensity(v, voxelIndex(gx, gy, gz), age, duration, fade);
}

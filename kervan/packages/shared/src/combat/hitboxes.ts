/**
 * Oyuncu hitbox'ları: iskelete bağlı kapsüller. Görsel model de aynı noktaları kullanır,
 * böylece görüntü ile vuruş alanı örtüşür.
 */
import { Vec3, vdot, vsub, DEG2RAD } from '../math';

export enum HitGroup {
  Generic = 0,
  Head = 1,
  Chest = 2,
  Stomach = 3,
  LeftArm = 4,
  RightArm = 5,
  LeftLeg = 6,
  RightLeg = 7,
}

export interface Capsule {
  a: Vec3;
  b: Vec3;
  r: number;
  group: HitGroup;
}

interface LocalCapsule {
  a: [number, number, number];
  b: [number, number, number];
  r: number;
  group: HitGroup;
}

// yerel uzay: x ileri, y sol, z yukarı, orijin ayaklar
const STAND: LocalCapsule[] = [
  { a: [1.5, 0, 61.2], b: [1.5, 0, 66.6], r: 4.5, group: HitGroup.Head },
  { a: [0, 0, 46], b: [0, 0, 55], r: 7.6, group: HitGroup.Chest },
  { a: [0, 0, 34], b: [0, 0, 43], r: 7.0, group: HitGroup.Stomach },
  { a: [-1, -8.5, 54], b: [6, -9, 45], r: 2.9, group: HitGroup.RightArm },
  { a: [6, -9, 45], b: [15, -3, 47], r: 2.5, group: HitGroup.RightArm },
  { a: [0, 8.5, 54], b: [9, 7.5, 46], r: 2.9, group: HitGroup.LeftArm },
  { a: [9, 7.5, 46], b: [21, 1.5, 49], r: 2.5, group: HitGroup.LeftArm },
  { a: [0, 4.2, 32], b: [1.5, 4.6, 18], r: 4.3, group: HitGroup.LeftLeg },
  { a: [1.5, 4.6, 18], b: [-0.5, 4.6, 3.5], r: 3.4, group: HitGroup.LeftLeg },
  { a: [0, -4.2, 32], b: [1.5, -4.6, 18], r: 4.3, group: HitGroup.RightLeg },
  { a: [1.5, -4.6, 18], b: [-0.5, -4.6, 3.5], r: 3.4, group: HitGroup.RightLeg },
];

const CROUCH: LocalCapsule[] = [
  { a: [5, 0, 43.2], b: [5, 0, 48.6], r: 4.5, group: HitGroup.Head },
  { a: [3, 0, 29], b: [4, 0, 37.5], r: 7.6, group: HitGroup.Chest },
  { a: [1, 0, 18.5], b: [2, 0, 26.5], r: 7.0, group: HitGroup.Stomach },
  { a: [2, -8.5, 36.5], b: [9, -9, 28], r: 2.9, group: HitGroup.RightArm },
  { a: [9, -9, 28], b: [17, -3, 30], r: 2.5, group: HitGroup.RightArm },
  { a: [3, 8.5, 36.5], b: [12, 7.5, 29], r: 2.9, group: HitGroup.LeftArm },
  { a: [12, 7.5, 29], b: [23, 1.5, 32], r: 2.5, group: HitGroup.LeftArm },
  { a: [-1, 4.6, 17], b: [10, 5, 13], r: 4.3, group: HitGroup.LeftLeg },
  { a: [10, 5, 13], b: [-1, 5, 3], r: 3.4, group: HitGroup.LeftLeg },
  { a: [-1, -4.6, 17], b: [10, -5, 13], r: 4.3, group: HitGroup.RightLeg },
  { a: [10, -5, 13], b: [-1, -5, 3], r: 3.4, group: HitGroup.RightLeg },
];

export interface HitboxPose {
  origin: Vec3;
  yaw: number;
  duckAmount: number;
}

export function buildHitboxes(pose: HitboxPose): Capsule[] {
  const t = pose.duckAmount;
  const e = t * t * (3 - 2 * t);
  const c = Math.cos(pose.yaw * DEG2RAD);
  const s = Math.sin(pose.yaw * DEG2RAD);
  const o = pose.origin;
  const tw = (l: [number, number, number], m: [number, number, number]): Vec3 => {
    const lx = l[0] + (m[0] - l[0]) * e;
    const ly = l[1] + (m[1] - l[1]) * e;
    const lz = l[2] + (m[2] - l[2]) * e;
    return { x: o.x + lx * c - ly * s, y: o.y + lx * s + ly * c, z: o.z + lz };
  };
  const out: Capsule[] = [];
  for (let i = 0; i < STAND.length; i++) {
    const a = STAND[i]!;
    const b = CROUCH[i]!;
    out.push({ a: tw(a.a, b.a), b: tw(a.b, b.b), r: a.r + (b.r - a.r) * e, group: a.group });
  }
  return out;
}

/** Işın-kapsül kesişimi (rd birim vektör). Mesafe ya da -1. */
export function rayCapsule(ro: Vec3, rd: Vec3, cap: Capsule): number {
  const ba = vsub(cap.b, cap.a);
  const oa = vsub(ro, cap.a);
  const baba = vdot(ba, ba);
  const bard = vdot(ba, rd);
  const baoa = vdot(ba, oa);
  const rdoa = vdot(rd, oa);
  const oaoa = vdot(oa, oa);
  const ra = cap.r;
  const a = baba - bard * bard;
  let b = baba * rdoa - baoa * bard;
  let c = baba * oaoa - baoa * baoa - ra * ra * baba;
  let h = b * b - a * c;
  if (a > 1e-8 && h >= 0) {
    const t = (-b - Math.sqrt(h)) / a;
    const y = baoa + t * bard;
    if (y > 0 && y < baba) return t;
  }
  // uç küreler
  let best = -1;
  for (const p of [cap.a, cap.b]) {
    const oc = vsub(ro, p);
    b = vdot(rd, oc);
    c = vdot(oc, oc) - ra * ra;
    h = b * b - c;
    if (h > 0) {
      const t = -b - Math.sqrt(h);
      if (t >= 0 && (best < 0 || t < best)) best = t;
    }
  }
  return best;
}

export interface HitTarget {
  id: number;
  team: number;
  /** Kaba eleme için sınır kutusu. */
  mins: Vec3;
  maxs: Vec3;
  hitboxes: Capsule[];
}

export function makeHitTarget(id: number, team: number, pose: HitboxPose): HitTarget {
  const hb = buildHitboxes(pose);
  const o = pose.origin;
  return {
    id,
    team,
    mins: { x: o.x - 30, y: o.y - 30, z: o.z - 2 },
    maxs: { x: o.x + 30, y: o.y + 30, z: o.z + 76 },
    hitboxes: hb,
  };
}

function rayAabb(ro: Vec3, rd: Vec3, mins: Vec3, maxs: Vec3, maxT: number): boolean {
  let t0 = 0;
  let t1 = maxT;
  for (const ax of ['x', 'y', 'z'] as const) {
    const inv = 1 / (rd[ax] || 1e-12);
    let ta = (mins[ax] - ro[ax]) * inv;
    let tb = (maxs[ax] - ro[ax]) * inv;
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
    if (t0 > t1) return false;
  }
  return true;
}

/** Işının en yakın oyuncu hitbox'ına çarpması. */
export function traceHitTargets(
  ro: Vec3,
  rd: Vec3,
  maxT: number,
  targets: readonly HitTarget[],
  skip: ReadonlySet<number>,
): { target: HitTarget; group: HitGroup; t: number } | null {
  let best: { target: HitTarget; group: HitGroup; t: number } | null = null;
  for (const tg of targets) {
    if (skip.has(tg.id)) continue;
    if (!rayAabb(ro, rd, tg.mins, tg.maxs, maxT)) continue;
    for (const cap of tg.hitboxes) {
      const t = rayCapsule(ro, rd, cap);
      if (t >= 0 && t <= maxT && (!best || t < best.t)) best = { target: tg, group: cap.group, t };
    }
  }
  return best;
}

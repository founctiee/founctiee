import { Vec3, vec3 } from '../math';
import { Brush, Plane, MASK_PLAYERSOLID } from './brush';
import { Mat } from './materials';

/** Source/Quake DIST_EPSILON: yüzeyden bu kadar önde durulur. */
export const DIST_EPSILON = 0.03125;

export interface TraceResult {
  /** 0..1, yolun ne kadarının engelsiz olduğu. */
  fraction: number;
  endpos: Vec3;
  normal: Vec3;
  planeDist: number;
  startsolid: boolean;
  allsolid: boolean;
  brush: Brush | null;
  /** Çarpılan ek kutunun (ör. oyuncu) id'si; dünya ise -1. */
  entity: number;
  mat: Mat;
}

/** Hareket eden varlıklar için ek çarpışma kutusu (ör. diğer oyuncular). */
export interface EntityBox {
  id: number;
  mins: Vec3; // mutlak
  maxs: Vec3; // mutlak
}

export interface Trigger {
  name: string;
  kind: 'bombsite' | 'buyzone_t' | 'buyzone_ct' | 'spawn_t' | 'spawn_ct';
  mins: Vec3;
  maxs: Vec3;
}

export function emptyTrace(): TraceResult {
  return {
    fraction: 1,
    endpos: vec3(),
    normal: vec3(),
    planeDist: 0,
    startsolid: false,
    allsolid: false,
    brush: null,
    entity: -1,
    mat: Mat.Concrete,
  };
}

const CELL = 256;

/**
 * Brush tabanlı statik dünya. Çarpışma Quake/Source clipping hull yöntemiyle yapılır:
 * brush düzlemleri hull'ın yarı boyutları kadar dışarı itilir, sonra ışın konveks
 * cisimle kesiştirilir. Tam ve deterministik.
 */
export class World {
  readonly brushes: Brush[] = [];
  readonly triggers: Trigger[] = [];
  private grid = new Map<number, Brush[]>();
  private stamp = 1;
  mins = vec3(Infinity, Infinity, Infinity);
  maxs = vec3(-Infinity, -Infinity, -Infinity);

  constructor(brushes: Brush[] = [], triggers: Trigger[] = []) {
    for (const b of brushes) this.addBrush(b);
    this.triggers.push(...triggers);
  }

  addBrush(b: Brush): void {
    this.brushes.push(b);
    const x0 = Math.floor(b.mins.x / CELL);
    const x1 = Math.floor(b.maxs.x / CELL);
    const y0 = Math.floor(b.mins.y / CELL);
    const y1 = Math.floor(b.maxs.y / CELL);
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        const k = cellKey(x, y);
        let list = this.grid.get(k);
        if (!list) this.grid.set(k, (list = []));
        list.push(b);
      }
    }
    this.mins.x = Math.min(this.mins.x, b.mins.x);
    this.mins.y = Math.min(this.mins.y, b.mins.y);
    this.mins.z = Math.min(this.mins.z, b.mins.z);
    this.maxs.x = Math.max(this.maxs.x, b.maxs.x);
    this.maxs.y = Math.max(this.maxs.y, b.maxs.y);
    this.maxs.z = Math.max(this.maxs.z, b.maxs.z);
  }

  /** AABB hull'ı start→end süpürür. mins/maxs hull'ın orijine göre sınırlarıdır. */
  traceHull(
    start: Vec3,
    end: Vec3,
    mins: Vec3,
    maxs: Vec3,
    mask: number = MASK_PLAYERSOLID,
    entities?: readonly EntityBox[],
    ignoreEntity = -1,
  ): TraceResult {
    const tr = emptyTrace();
    const sx0 = Math.min(start.x, end.x) + mins.x - 1;
    const sx1 = Math.max(start.x, end.x) + maxs.x + 1;
    const sy0 = Math.min(start.y, end.y) + mins.y - 1;
    const sy1 = Math.max(start.y, end.y) + maxs.y + 1;
    const sz0 = Math.min(start.z, end.z) + mins.z - 1;
    const sz1 = Math.max(start.z, end.z) + maxs.z + 1;

    const stamp = ++this.stamp;
    const cx0 = Math.floor(sx0 / CELL);
    const cx1 = Math.floor(sx1 / CELL);
    const cy0 = Math.floor(sy0 / CELL);
    const cy1 = Math.floor(sy1 / CELL);
    const cellCount = (cx1 - cx0 + 1) * (cy1 - cy0 + 1);

    const test = (b: Brush) => {
      if (b.stamp === stamp) return;
      b.stamp = stamp;
      if ((b.contents & mask) === 0) return;
      if (b.maxs.x < sx0 || b.mins.x > sx1 || b.maxs.y < sy0 || b.mins.y > sy1 || b.maxs.z < sz0 || b.mins.z > sz1) return;
      clipToPlanes(b.planes, start, end, mins, maxs, tr, b, -1);
    };

    if (cellCount > 64) {
      for (const b of this.brushes) {
        test(b);
        if (tr.allsolid) break;
      }
    } else {
      outer: for (let x = cx0; x <= cx1; x++) {
        for (let y = cy0; y <= cy1; y++) {
          const list = this.grid.get(cellKey(x, y));
          if (!list) continue;
          for (const b of list) {
            test(b);
            if (tr.allsolid) break outer;
          }
        }
      }
    }

    if (entities && !tr.allsolid) {
      for (const e of entities) {
        if (e.id === ignoreEntity) continue;
        if (e.maxs.x < sx0 || e.mins.x > sx1 || e.maxs.y < sy0 || e.mins.y > sy1 || e.maxs.z < sz0 || e.mins.z > sz1) continue;
        clipToBox(e.mins, e.maxs, start, end, mins, maxs, tr, e.id);
        if (tr.allsolid) break;
      }
    }

    if (tr.fraction === 1) {
      tr.endpos = { x: end.x, y: end.y, z: end.z };
    } else {
      tr.endpos = {
        x: start.x + (end.x - start.x) * tr.fraction,
        y: start.y + (end.y - start.y) * tr.fraction,
        z: start.z + (end.z - start.z) * tr.fraction,
      };
    }
    return tr;
  }

  traceRay(start: Vec3, end: Vec3, mask: number, entities?: readonly EntityBox[], ignoreEntity = -1): TraceResult {
    return this.traceHull(start, end, ZERO, ZERO, mask, entities, ignoreEntity);
  }

  /** Noktayı içeren brush'lar (penetrasyon çıkış araması için). */
  pointInSolid(p: Vec3, mask: number): Brush | null {
    const list = this.grid.get(cellKey(Math.floor(p.x / CELL), Math.floor(p.y / CELL)));
    if (!list) return null;
    for (const b of list) {
      if ((b.contents & mask) === 0) continue;
      if (p.x < b.mins.x || p.x > b.maxs.x || p.y < b.mins.y || p.y > b.maxs.y || p.z < b.mins.z || p.z > b.maxs.z) continue;
      let inside = true;
      for (const pl of b.planes) {
        if (pl.n.x * p.x + pl.n.y * p.y + pl.n.z * p.z - pl.d > 0) {
          inside = false;
          break;
        }
      }
      if (inside) return b;
    }
    return null;
  }

  triggersAt(p: Vec3): Trigger[] {
    return this.triggers.filter(
      (t) => p.x >= t.mins.x && p.x <= t.maxs.x && p.y >= t.mins.y && p.y <= t.maxs.y && p.z >= t.mins.z && p.z <= t.maxs.z,
    );
  }

  inTrigger(p: Vec3, kind: Trigger['kind']): Trigger | null {
    for (const t of this.triggers) {
      if (t.kind !== kind) continue;
      if (p.x >= t.mins.x && p.x <= t.maxs.x && p.y >= t.mins.y && p.y <= t.maxs.y && p.z >= t.mins.z && p.z <= t.maxs.z) return t;
    }
    return null;
  }
}

const ZERO: Vec3 = { x: 0, y: 0, z: 0 };

function cellKey(x: number, y: number): number {
  return (x + 32768) * 65536 + (y + 32768);
}

/** Quake 3 CM_TraceThroughBrush uyarlaması. */
function clipToPlanes(
  planes: Plane[],
  start: Vec3,
  end: Vec3,
  mins: Vec3,
  maxs: Vec3,
  tr: TraceResult,
  brush: Brush | null,
  entity: number,
): void {
  let enterFrac = -1;
  let leaveFrac = 1;
  let clip: Plane | null = null;
  let clipDist = 0;
  let getout = false;
  let startout = false;

  for (let i = 0; i < planes.length; i++) {
    const p = planes[i]!;
    const n = p.n;
    // hull'ın düzleme en yakın köşesi
    const ox = n.x < 0 ? maxs.x : mins.x;
    const oy = n.y < 0 ? maxs.y : mins.y;
    const oz = n.z < 0 ? maxs.z : mins.z;
    const dist = p.d - (n.x * ox + n.y * oy + n.z * oz);
    const d1 = n.x * start.x + n.y * start.y + n.z * start.z - dist;
    const d2 = n.x * end.x + n.y * end.y + n.z * end.z - dist;

    if (d2 > 0) getout = true;
    if (d1 > 0) startout = true;

    // tamamen düzlemin önünde → bu brush'a hiç girmiyor
    if (d1 > 0 && (d2 >= DIST_EPSILON || d2 >= d1)) return;
    // tamamen arkasında → bu düzlem kısıtlamıyor
    if (d1 <= 0 && d2 <= 0) continue;

    if (d1 > d2) {
      // giriyor
      const f = (d1 - DIST_EPSILON) / (d1 - d2);
      if (f > enterFrac) {
        enterFrac = f;
        clip = p;
        clipDist = dist;
      }
    } else {
      // çıkıyor
      const f = (d1 + DIST_EPSILON) / (d1 - d2);
      if (f < leaveFrac) leaveFrac = f;
    }
  }

  if (!startout) {
    tr.startsolid = true;
    if (!getout) {
      tr.allsolid = true;
      tr.fraction = 0;
      tr.brush = brush;
      tr.entity = entity;
      if (brush) tr.mat = brush.mat;
    }
    return;
  }

  if (enterFrac < leaveFrac && enterFrac > -1 && enterFrac < tr.fraction && clip) {
    if (enterFrac < 0) enterFrac = 0;
    tr.fraction = enterFrac;
    tr.normal = { x: clip.n.x, y: clip.n.y, z: clip.n.z };
    tr.planeDist = clipDist;
    tr.brush = brush;
    tr.entity = entity;
    tr.mat = clip.mat ?? (brush ? brush.mat : Mat.Fabric);
  }
}

const boxPlaneCache: Plane[] = [
  { n: { x: 1, y: 0, z: 0 }, d: 0 },
  { n: { x: -1, y: 0, z: 0 }, d: 0 },
  { n: { x: 0, y: 1, z: 0 }, d: 0 },
  { n: { x: 0, y: -1, z: 0 }, d: 0 },
  { n: { x: 0, y: 0, z: 1 }, d: 0 },
  { n: { x: 0, y: 0, z: -1 }, d: 0 },
];

function clipToBox(bmins: Vec3, bmaxs: Vec3, start: Vec3, end: Vec3, mins: Vec3, maxs: Vec3, tr: TraceResult, entity: number) {
  boxPlaneCache[0]!.d = bmaxs.x;
  boxPlaneCache[1]!.d = -bmins.x;
  boxPlaneCache[2]!.d = bmaxs.y;
  boxPlaneCache[3]!.d = -bmins.y;
  boxPlaneCache[4]!.d = bmaxs.z;
  boxPlaneCache[5]!.d = -bmins.z;
  clipToPlanes(boxPlaneCache, start, end, mins, maxs, tr, null, entity);
}

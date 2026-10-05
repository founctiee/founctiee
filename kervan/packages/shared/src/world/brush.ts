import { Vec3, vcross, vdot, vsub, vnormalize, vadd, vscale } from '../math';
import { Mat } from './materials';

/** İçerik bayrakları (Source CONTENTS_* benzeri). */
export const CONTENTS_SOLID = 1;
export const CONTENTS_PLAYERCLIP = 2;
export const CONTENTS_GRENADECLIP = 4;
/** Mermiyi durdurmaz ama görünür (ör. ince tel çit) — şimdilik kullanılmıyor. */
export const CONTENTS_GRATE = 8;

export const MASK_PLAYERSOLID = CONTENTS_SOLID | CONTENTS_PLAYERCLIP;
export const MASK_SHOT = CONTENTS_SOLID;
export const MASK_GRENADE = CONTENTS_SOLID | CONTENTS_GRENADECLIP;
export const MASK_VISIBLE = CONTENTS_SOLID;

/** n·p <= d olan noktalar düzlemin içindedir (n dışa bakar). */
export interface Plane {
  n: Vec3;
  d: number;
  /** Sadece çarpışma için eklenen eksenel bevel düzlemi; çizilmez. */
  bevel?: boolean;
  /** Bu yüzeyin materyali (yoksa brush materyali). */
  mat?: Mat;
}

export interface Brush {
  id: number;
  planes: Plane[];
  mins: Vec3;
  maxs: Vec3;
  contents: number;
  mat: Mat;
  /** Çizilmeyecek (clip brush). */
  nodraw?: boolean;
  /** Görsel ipucu: doku ölçeği, renk tonu vb. */
  tint?: number;
  texScale?: number;
  /** Çarpışma döngüsü için ziyaret damgası. */
  stamp: number;
}

export interface BrushOpts {
  contents?: number;
  nodraw?: boolean;
  tint?: number;
  texScale?: number;
  /** Üst yüzeyin farklı materyali (ör. kasanın üstü). */
  topMat?: Mat;
}

const EPS = 1e-6;

/** Konveks çokyüzlünün yüz çokgenlerini düzlemlerden üretir (render ve sınır hesabı için). */
export function planePolygon(planes: Plane[], index: number): Vec3[] {
  const p = planes[index]!;
  const n = p.n;
  // düzlem üzerinde büyük bir kare
  const up = Math.abs(n.z) > 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 0, z: 1 };
  const u = vnormalize(vcross(up, n));
  const v = vcross(n, u);
  const c = vscale(n, p.d);
  const S = 65536;
  let poly: Vec3[] = [
    vadd(c, vadd(vscale(u, -S), vscale(v, -S))),
    vadd(c, vadd(vscale(u, S), vscale(v, -S))),
    vadd(c, vadd(vscale(u, S), vscale(v, S))),
    vadd(c, vadd(vscale(u, -S), vscale(v, S))),
  ];
  for (let j = 0; j < planes.length && poly.length > 0; j++) {
    if (j === index) continue;
    poly = clipPolygon(poly, planes[j]!);
  }
  return poly;
}

/** Çokgeni düzlemin içinde (n·p <= d) kalacak şekilde kırpar. */
export function clipPolygon(poly: Vec3[], plane: Plane): Vec3[] {
  const out: Vec3[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const da = vdot(plane.n, a) - plane.d;
    const db = vdot(plane.n, b) - plane.d;
    if (da <= EPS) out.push(a);
    if ((da < -EPS && db > EPS) || (da > EPS && db < -EPS)) {
      const t = da / (da - db);
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });
    }
  }
  return out;
}

export function polygonArea(poly: Vec3[]): number {
  if (poly.length < 3) return 0;
  let acc = { x: 0, y: 0, z: 0 };
  for (let i = 1; i < poly.length - 1; i++) {
    acc = vadd(acc, vcross(vsub(poly[i]!, poly[0]!), vsub(poly[i + 1]!, poly[0]!)));
  }
  return Math.hypot(acc.x, acc.y, acc.z) * 0.5;
}

let nextBrushId = 1;

/** Düzlem listesinden brush oluşturur: sınırları hesaplar ve eksenel bevel'leri ekler. */
export function makeBrush(planes: Plane[], mat: Mat, opts: BrushOpts = {}): Brush {
  const mins = { x: Infinity, y: Infinity, z: Infinity };
  const maxs = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (let i = 0; i < planes.length; i++) {
    for (const v of planePolygon(planes, i)) {
      mins.x = Math.min(mins.x, v.x);
      mins.y = Math.min(mins.y, v.y);
      mins.z = Math.min(mins.z, v.z);
      maxs.x = Math.max(maxs.x, v.x);
      maxs.y = Math.max(maxs.y, v.y);
      maxs.z = Math.max(maxs.z, v.z);
    }
  }
  const axes: [Vec3, number][] = [
    [{ x: 1, y: 0, z: 0 }, maxs.x],
    [{ x: -1, y: 0, z: 0 }, -mins.x],
    [{ x: 0, y: 1, z: 0 }, maxs.y],
    [{ x: 0, y: -1, z: 0 }, -mins.y],
    [{ x: 0, y: 0, z: 1 }, maxs.z],
    [{ x: 0, y: 0, z: -1 }, -mins.z],
  ];
  const all = planes.slice();
  for (const [n, d] of axes) {
    const exists = planes.some((p) => vdot(p.n, n) > 1 - 1e-6);
    if (!exists) all.push({ n, d, bevel: true });
  }
  return {
    id: nextBrushId++,
    planes: all,
    mins,
    maxs,
    contents: opts.contents ?? CONTENTS_SOLID,
    mat,
    nodraw: opts.nodraw,
    tint: opts.tint,
    texScale: opts.texScale,
    stamp: 0,
  };
}

export function boxPlanes(mins: Vec3, maxs: Vec3, topMat?: Mat): Plane[] {
  return [
    { n: { x: 1, y: 0, z: 0 }, d: maxs.x },
    { n: { x: -1, y: 0, z: 0 }, d: -mins.x },
    { n: { x: 0, y: 1, z: 0 }, d: maxs.y },
    { n: { x: 0, y: -1, z: 0 }, d: -mins.y },
    { n: { x: 0, y: 0, z: 1 }, d: maxs.z, mat: topMat },
    { n: { x: 0, y: 0, z: -1 }, d: -mins.z },
  ];
}

export function boxBrush(mins: Vec3, maxs: Vec3, mat: Mat, opts: BrushOpts = {}): Brush {
  return makeBrush(boxPlanes(mins, maxs, opts.topMat), mat, opts);
}

export type RampDir = '+x' | '-x' | '+y' | '-y';

/**
 * Kama/rampa: (mins,maxs) kutusu içinde, `dir` yönüne doğru zeminden tepeye yükselen eğim.
 * Yüksek uçta dikey duvar vardır.
 */
export function rampBrush(mins: Vec3, maxs: Vec3, dir: RampDir, mat: Mat, opts: BrushOpts = {}): Brush {
  const h = maxs.z - mins.z;
  const planes: Plane[] = [{ n: { x: 0, y: 0, z: -1 }, d: -mins.z }];
  const along = dir[1] === 'x' ? 'x' : 'y';
  const side = along === 'x' ? 'y' : 'x';
  const sign = dir[0] === '+' ? 1 : -1;
  // yan duvarlar
  planes.push({ n: axis(side, 1), d: maxs[side] });
  planes.push({ n: axis(side, -1), d: -mins[side] });
  // yüksek uç
  if (sign > 0) planes.push({ n: axis(along, 1), d: maxs[along] });
  else planes.push({ n: axis(along, -1), d: -mins[along] });
  // eğim: alçak uçta z=mins.z, yüksek uçta z=maxs.z
  const len = maxs[along] - mins[along];
  // eğim düzlemi normali: (-sign*h, 0, len) normalize (along ekseninde)
  const nx = -sign * h;
  const nz = len;
  const l = Math.hypot(nx, nz);
  const n = { x: 0, y: 0, z: nz / l };
  n[along] = nx / l;
  // düzlem yüksek uçtaki tepe kenarından geçer
  const top = { x: 0, y: 0, z: maxs.z };
  top[along] = sign > 0 ? maxs[along] : mins[along];
  top[side] = mins[side];
  planes.push({ n, d: vdot(n, top), mat: opts.topMat });
  return makeBrush(planes, mat, opts);
}

/** Z ekseninde, verilen 2B konveks çokgen tabanlı prizma (sütun vb.). */
export function prismBrush(points2d: [number, number][], zmin: number, zmax: number, mat: Mat, opts: BrushOpts = {}): Brush {
  const planes: Plane[] = [
    { n: { x: 0, y: 0, z: 1 }, d: zmax, mat: opts.topMat },
    { n: { x: 0, y: 0, z: -1 }, d: -zmin },
  ];
  // saat yönünün tersi kabul edilir; normal dışa
  let area = 0;
  for (let i = 0; i < points2d.length; i++) {
    const [x1, y1] = points2d[i]!;
    const [x2, y2] = points2d[(i + 1) % points2d.length]!;
    area += x1 * y2 - x2 * y1;
  }
  const ccw = area > 0;
  for (let i = 0; i < points2d.length; i++) {
    const [x1, y1] = points2d[i]!;
    const [x2, y2] = points2d[(i + 1) % points2d.length]!;
    let nx = y2 - y1;
    let ny = -(x2 - x1);
    if (!ccw) {
      nx = -nx;
      ny = -ny;
    }
    const l = Math.hypot(nx, ny);
    const n = { x: nx / l, y: ny / l, z: 0 };
    planes.push({ n, d: n.x * x1 + n.y * y1 });
  }
  return makeBrush(planes, mat, opts);
}

export function cylinderBrush(cx: number, cy: number, r: number, zmin: number, zmax: number, sides: number, mat: Mat, opts: BrushOpts = {}): Brush {
  const pts: [number, number][] = [];
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2 + Math.PI / sides;
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return prismBrush(pts, zmin, zmax, mat, opts);
}

function axis(a: 'x' | 'y' | 'z', s: number): Vec3 {
  const v = { x: 0, y: 0, z: 0 };
  v[a] = s;
  return v;
}

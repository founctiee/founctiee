/**
 * de_kervan — orijinal Wingman haritası (çöl kasabası, tek bomba bölgesi).
 * Yürünebilir alanlar dikdörtgenlerle tanımlanır; aradaki her şey otomatik olarak
 * bina bloklarıyla doldurulur. Ardından kasalar, kemerler, merdivenler eklenir.
 */
import { Vec3 } from '../math';
import { Brush, boxBrush, rampBrush, cylinderBrush, CONTENTS_SOLID } from '../world/brush';
import { Mat } from '../world/materials';
import { Trigger } from '../world/world';
import { hashSeed } from '../random';

export interface SpawnPoint {
  pos: Vec3;
  yaw: number;
}

export interface MapArea {
  name: string;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

export type PropKind = 'lamp' | 'awning' | 'cloth' | 'palm' | 'pot' | 'wire' | 'window' | 'sign' | 'bombsite_a';

export interface MapProp {
  kind: PropKind;
  pos: Vec3;
  yaw?: number;
  size?: Vec3;
  color?: number;
}

export interface MapDef {
  name: string;
  brushes: Brush[];
  triggers: Trigger[];
  spawns: { T: SpawnPoint[]; CT: SpawnPoint[] };
  areas: MapArea[];
  props: MapProp[];
  /** Güneş yönü (güneşe doğru). */
  sun: Vec3;
  bounds: { mins: Vec3; maxs: Vec3 };
}

interface Walk {
  name: string;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  floor: Mat;
  /** Üstü kapalı (tünel) ise tavan yüksekliği. */
  roof?: number;
}

const WALKS: Walk[] = [
  { name: 'T Doğuş', x0: -500, x1: 500, y0: -1500, y1: -1050, floor: Mat.Sand },
  { name: 'T Geçidi', x0: -1500, x1: -500, y0: -1400, y1: -1150, floor: Mat.Stone },
  { name: 'Uzun', x0: -1500, x1: -1250, y0: -1150, y1: 400, floor: Mat.Sand },
  { name: 'Uzun Ağzı', x0: -1500, x1: -1000, y0: 400, y1: 700, floor: Mat.Stone },
  { name: 'A Bölgesi', x0: -1000, x1: -200, y0: 350, y1: 1150, floor: Mat.Tile },
  { name: 'Tünel', x0: -160, x1: 0, y0: -1050, y1: -600, floor: Mat.Concrete, roof: 128 },
  { name: 'Tünel', x0: -360, x1: 0, y0: -600, y1: -450, floor: Mat.Concrete, roof: 128 },
  { name: 'Tünel', x0: -360, x1: -200, y0: -450, y1: -250, floor: Mat.Concrete, roof: 128 },
  { name: 'Avlu', x0: -500, x1: 150, y0: -250, y1: 120, floor: Mat.Stone },
  { name: 'Kısa', x0: -500, x1: -280, y0: 120, y1: 350, floor: Mat.Stone },
  { name: 'Orta', x0: 150, x1: 750, y0: -500, y1: 500, floor: Mat.Sand },
  { name: 'T Rampası', x0: 250, x1: 450, y0: -1050, y1: -500, floor: Mat.Sand },
  { name: 'Orta Geçit', x0: 450, x1: 750, y0: 500, y1: 750, floor: Mat.Stone },
  { name: 'CT Doğuş', x0: 450, x1: 1300, y0: 750, y1: 1300, floor: Mat.Stone },
  { name: 'CT Geçidi', x0: -200, x1: 450, y0: 850, y1: 1100, floor: Mat.Tile },
];

const BOUNDS = { x0: -1600, x1: 1400, y0: -1600, y1: 1400 };
const WALL_TOP = 320;

const WALL_TINTS = [0xe3cfa8, 0xd9bf91, 0xead9b8, 0xcfb187, 0xe8d3a6];

function inWalk(x: number, y: number): Walk | null {
  for (const w of WALKS) if (x > w.x0 && x < w.x1 && y > w.y0 && y < w.y1) return w;
  return null;
}

/** Yürünebilir alanların tümleyenini bina bloklarına çevirir (koordinat sıkıştırma). */
function buildingBlocks(): Brush[] {
  const xs = new Set<number>([BOUNDS.x0, BOUNDS.x1]);
  const ys = new Set<number>([BOUNDS.y0, BOUNDS.y1]);
  for (const w of WALKS) {
    xs.add(w.x0);
    xs.add(w.x1);
    ys.add(w.y0);
    ys.add(w.y1);
  }
  const X = [...xs].sort((a, b) => a - b);
  const Y = [...ys].sort((a, b) => a - b);
  const solid: boolean[][] = [];
  for (let j = 0; j < Y.length - 1; j++) {
    const row: boolean[] = [];
    for (let i = 0; i < X.length - 1; i++) {
      const cx = (X[i]! + X[i + 1]!) / 2;
      const cy = (Y[j]! + Y[j + 1]!) / 2;
      row.push(!inWalk(cx, cy));
    }
    solid.push(row);
  }
  // satır içi şeritler, sonra dikeyde birleştirme
  interface Strip {
    i0: number;
    i1: number;
    j0: number;
    j1: number;
  }
  let open: Strip[] = [];
  const done: Strip[] = [];
  for (let j = 0; j < solid.length; j++) {
    const strips: Strip[] = [];
    let i = 0;
    while (i < X.length - 1) {
      if (!solid[j]![i]) {
        i++;
        continue;
      }
      const s = i;
      while (i < X.length - 1 && solid[j]![i]) i++;
      strips.push({ i0: s, i1: i, j0: j, j1: j + 1 });
    }
    const next: Strip[] = [];
    for (const st of strips) {
      const prev = open.find((o) => o.i0 === st.i0 && o.i1 === st.i1);
      if (prev) {
        prev.j1 = j + 1;
        next.push(prev);
      } else next.push(st);
    }
    for (const o of open) if (!next.includes(o)) done.push(o);
    open = next;
  }
  done.push(...open);

  return done.map((s) => {
    const x0 = X[s.i0]!;
    const x1 = X[s.i1]!;
    const y0 = Y[s.j0]!;
    const y1 = Y[s.j1]!;
    const h = hashSeed(x0, y0, x1, y1);
    const top = WALL_TOP + (h % 3) * 48;
    return boxBrush({ x: x0, y: y0, z: -32 }, { x: x1, y: y1, z: top }, Mat.Plaster, {
      tint: WALL_TINTS[h % WALL_TINTS.length],
      topMat: Mat.Tile,
    });
  });
}

function crate(x: number, y: number, size = 64, z = 0, h = size): Brush {
  return boxBrush({ x, y, z }, { x: x + size, y: y + size, z: z + h }, Mat.Wood, { texScale: size });
}

function box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, mat: Mat, tint?: number): Brush {
  return boxBrush({ x: x0, y: y0, z: z0 }, { x: x1, y: y1, z: z1 }, mat, { tint });
}

/** x ekseni boyunca basamaklar; `rising` yönünde yükselir. */
function stairsX(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, mat: Mat, rising: 1 | -1): Brush[] {
  const n = Math.max(1, Math.ceil((z1 - z0) / 12));
  const dx = (x1 - x0) / n;
  const out: Brush[] = [];
  for (let k = 0; k < n; k++) {
    const h = z0 + ((k + 1) * (z1 - z0)) / n;
    if (rising > 0) out.push(box(x0 + k * dx, y0, z0, x1, y1, h, mat));
    else out.push(box(x0, y0, z0, x1 - k * dx, y1, h, mat));
  }
  return out;
}

export function buildKervan(): MapDef {
  const brushes: Brush[] = [];

  // zeminler
  for (const w of WALKS) {
    brushes.push(box(w.x0, w.y0, -32, w.x1, w.y1, 0, w.floor));
    if (w.roof) brushes.push(box(w.x0, w.y0, w.roof, w.x1, w.y1, w.roof + 40, Mat.Concrete));
  }
  brushes.push(...buildingBlocks());

  // ── Uzun kapıları (y = -300): ortada 128'lik kapı aralığı ──
  brushes.push(box(-1500, -316, 0, -1440, -284, WALL_TOP, Mat.Plaster, 0xd9bf91));
  brushes.push(box(-1310, -316, 0, -1250, -284, WALL_TOP, Mat.Plaster, 0xd9bf91));
  brushes.push(box(-1440, -316, 120, -1310, -284, WALL_TOP, Mat.Plaster, 0xd9bf91));
  // açık duran ahşap kapı kanatları (delinebilir)
  brushes.push(box(-1440, -284, 0, -1434, -224, 116, Mat.Wood));
  brushes.push(box(-1316, -284, 0, -1310, -224, 116, Mat.Wood));
  // uzunda siper kasaları
  brushes.push(crate(-1490, -800));
  brushes.push(crate(-1490, -736, 64, 0, 40));
  brushes.push(crate(-1330, 120, 72));
  brushes.push(box(-1500, -60, 0, -1440, 40, 40, Mat.Stone));

  // ── Uzun → A kemeri (x = -1000) ──
  brushes.push(box(-1032, 400, 0, -1000, 490, WALL_TOP, Mat.Plaster, 0xead9b8));
  brushes.push(box(-1032, 610, 0, -1000, 700, WALL_TOP, Mat.Plaster, 0xead9b8));
  brushes.push(box(-1032, 490, 128, -1000, 610, WALL_TOP, Mat.Plaster, 0xead9b8));
  brushes.push(crate(-1200, 600, 64));
  brushes.push(crate(-1480, 420, 56));

  // ── A bölgesi ──
  // kuzeybatı platformu (balkon) + basamaklar
  brushes.push(box(-1000, 930, 0, -660, 1150, 48, Mat.Stone));
  brushes.push(...stairsX(-660, -600, 990, 1150, 0, 48, Mat.Stone, -1));
  // korkuluk
  brushes.push(box(-1000, 922, 48, -760, 930, 84, Mat.Stone));
  // varsayılan çift kasa
  brushes.push(crate(-660, 690, 64));
  brushes.push(crate(-650, 700, 44, 64));
  brushes.push(crate(-596, 690, 48, 0, 48));
  // tekli kasalar
  brushes.push(crate(-880, 470));
  brushes.push(crate(-460, 900));
  brushes.push(crate(-396, 900, 48, 0, 32));
  // alçak duvar (çömelme siperi)
  brushes.push(box(-560, 470, 0, -400, 506, 42, Mat.Stone));
  // sütun ve kuyu
  brushes.push(cylinderBrush(-290, 640, 22, 0, 320, 12, Mat.Stone));
  brushes.push(cylinderBrush(-760, 520, 44, 0, 34, 16, Mat.Stone));
  // site'ın CT tarafında kemer (x = -200)
  brushes.push(box(-232, 850, 0, -200, 930, WALL_TOP, Mat.Plaster, 0xe3cfa8));
  brushes.push(box(-232, 1040, 0, -200, 1100, WALL_TOP, Mat.Plaster, 0xe3cfa8));
  brushes.push(box(-232, 930, 128, -200, 1040, WALL_TOP, Mat.Plaster, 0xe3cfa8));

  // ── Tünel girişi T doğuşta: kemer ──
  brushes.push(box(-160, -1070, 128, 0, -1050, WALL_TOP, Mat.Plaster));

  // ── Avlu ──
  brushes.push(cylinderBrush(-120, -60, 56, 0, 30, 16, Mat.Stone)); // çeşme havuzu
  brushes.push(cylinderBrush(-120, -60, 10, 30, 70, 8, Mat.Stone));
  brushes.push(crate(-480, -230));
  brushes.push(crate(-480, -166, 48, 0, 48));
  brushes.push(crate(60, 40, 64));
  // avlu → orta: kısmi duvar, iki geçit
  brushes.push(box(150, -250, 0, 182, -150, WALL_TOP, Mat.Plaster, 0xd9bf91));
  brushes.push(box(150, -40, 0, 182, 10, WALL_TOP, Mat.Plaster, 0xd9bf91));
  brushes.push(box(150, -150, 120, 182, -40, WALL_TOP, Mat.Plaster, 0xd9bf91));
  brushes.push(box(150, 10, 0, 182, 120, 56, Mat.Stone)); // pencere/alçak duvar
  brushes.push(box(150, 10, 120, 182, 120, WALL_TOP, Mat.Plaster, 0xd9bf91));

  // ── Orta ──
  brushes.push(crate(380, -120));
  brushes.push(crate(390, -110, 44, 64));
  brushes.push(crate(260, 220, 56, 0, 48));
  brushes.push(box(560, -480, 0, 740, -400, 64, Mat.Wood)); // araba kasası benzeri
  // CT tarafı balkon + rampa
  brushes.push(box(600, 300, 0, 750, 500, 96, Mat.Stone));
  brushes.push(rampBrush({ x: 600, y: 100, z: 0 }, { x: 750, y: 300, z: 96 }, '+y', Mat.Stone));
  brushes.push(box(600, 296, 96, 610, 500, 130, Mat.Stone)); // korkuluk
  // T rampası ağzında kasalar
  brushes.push(crate(260, -620, 56));

  // ── CT Geçidi ──
  brushes.push(crate(80, 1036));
  brushes.push(crate(-120, 860, 56, 0, 40));

  // ── CT doğuş ──
  brushes.push(crate(1180, 1180, 72));
  brushes.push(crate(500, 1220, 64));
  brushes.push(box(700, 760, 0, 780, 860, 44, Mat.Stone));

  // ── T doğuş ──
  brushes.push(crate(-420, -1480, 64));
  brushes.push(crate(380, -1200, 64));
  brushes.push(crate(-300, -1120, 48, 0, 48));

  // haritanın üstünde görünmez tavan (bombalar dışarı uçmasın)
  brushes.push(
    boxBrush({ x: BOUNDS.x0, y: BOUNDS.y0, z: 900 }, { x: BOUNDS.x1, y: BOUNDS.y1, z: 940 }, Mat.Clip, {
      contents: CONTENTS_SOLID,
      nodraw: true,
    }),
  );
  const triggers: Trigger[] = [
    { name: 'A', kind: 'bombsite', mins: { x: -960, y: 400, z: -10 }, maxs: { x: -260, y: 1120, z: 200 } },
    { name: 'T', kind: 'buyzone_t', mins: { x: -500, y: -1500, z: -10 }, maxs: { x: 500, y: -1000, z: 200 } },
    { name: 'CT', kind: 'buyzone_ct', mins: { x: 450, y: 700, z: -10 }, maxs: { x: 1300, y: 1300, z: 200 } },
  ];

  const spawns = {
    T: [
      { pos: { x: -150, y: -1380, z: 1 }, yaw: 90 },
      { pos: { x: 150, y: -1380, z: 1 }, yaw: 90 },
      { pos: { x: -300, y: -1300, z: 1 }, yaw: 90 },
      { pos: { x: 300, y: -1300, z: 1 }, yaw: 90 },
      { pos: { x: 0, y: -1250, z: 1 }, yaw: 90 },
    ],
    CT: [
      { pos: { x: 900, y: 1050, z: 1 }, yaw: 200 },
      { pos: { x: 1050, y: 1000, z: 1 }, yaw: 200 },
      { pos: { x: 800, y: 1150, z: 1 }, yaw: 200 },
      { pos: { x: 1100, y: 1150, z: 1 }, yaw: 200 },
      { pos: { x: 950, y: 880, z: 1 }, yaw: 200 },
    ],
  };

  const areas: MapArea[] = WALKS.map((w) => ({ name: w.name, x0: w.x0, x1: w.x1, y0: w.y0, y1: w.y1 }));

  const props: MapProp[] = [
    { kind: 'bombsite_a', pos: { x: -620, y: 1149, z: 160 }, yaw: 270 },
    { kind: 'lamp', pos: { x: -80, y: -900, z: 120 } },
    { kind: 'lamp', pos: { x: -180, y: -525, z: 120 } },
    { kind: 'lamp', pos: { x: -280, y: -350, z: 120 } },
    { kind: 'awning', pos: { x: -1500, y: -1000, z: 140 }, yaw: 0, size: { x: 60, y: 160, z: 8 }, color: 0x9a3b2c },
    { kind: 'awning', pos: { x: 500, y: -1300, z: 150 }, yaw: 180, size: { x: 60, y: 200, z: 8 }, color: 0x2f5f8a },
    { kind: 'awning', pos: { x: -200, y: 300, z: 150 }, yaw: 180, size: { x: 50, y: 120, z: 8 }, color: 0x7c8a2f },
    { kind: 'awning', pos: { x: 1300, y: 1000, z: 160 }, yaw: 180, size: { x: 70, y: 220, z: 8 }, color: 0x9a3b2c },
    { kind: 'cloth', pos: { x: -1375, y: 0, z: 230 }, size: { x: 250, y: 0, z: 0 }, color: 0xb2452f },
    { kind: 'cloth', pos: { x: 450, y: 200, z: 240 }, size: { x: 600, y: 0, z: 0 }, color: 0x3e6a8f, yaw: 0 },
    { kind: 'palm', pos: { x: 1150, y: 850, z: 0 } },
    { kind: 'palm', pos: { x: -420, y: 40, z: 0 } },
    { kind: 'pot', pos: { x: -980, y: 380, z: 0 } },
    { kind: 'pot', pos: { x: 720, y: 520, z: 0 } },
    { kind: 'pot', pos: { x: -230, y: -1440, z: 0 } },
    { kind: 'window', pos: { x: -1250, y: -700, z: 150 }, yaw: 0 },
    { kind: 'window', pos: { x: -1250, y: 200, z: 150 }, yaw: 0 },
    { kind: 'window', pos: { x: -200, y: 500, z: 170 }, yaw: 0 },
    { kind: 'window', pos: { x: 750, y: 0, z: 160 }, yaw: 180 },
    { kind: 'window', pos: { x: 450, y: -800, z: 150 }, yaw: 0 },
    { kind: 'sign', pos: { x: -1250, y: -1020, z: 160 }, yaw: 180 },
  ];

  return {
    name: 'de_kervan',
    brushes,
    triggers,
    spawns,
    areas,
    props,
    sun: normalize({ x: -0.45, y: -0.55, z: 0.72 }),
    bounds: { mins: { x: BOUNDS.x0, y: BOUNDS.y0, z: -32 }, maxs: { x: BOUNDS.x1, y: BOUNDS.y1, z: 500 } },
  };
}

function normalize(v: Vec3): Vec3 {
  const l = Math.hypot(v.x, v.y, v.z);
  return { x: v.x / l, y: v.y / l, z: v.z / l };
}

export function areaName(map: MapDef, p: Vec3): string {
  for (const a of map.areas) if (p.x >= a.x0 && p.x <= a.x1 && p.y >= a.y0 && p.y <= a.y1) return a.name;
  return '';
}

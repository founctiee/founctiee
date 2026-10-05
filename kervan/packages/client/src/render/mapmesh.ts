/**
 * Brush listesinden harita meshleri üretir: materyal başına tek geometri, dünya
 * uzayında UV, zemine yakın duvar diplerinde vertex-color ile ucuz ortam kapanması (AO).
 */
import * as THREE from 'three';
import { Brush, Mat, planePolygon, polygonArea, clipPolygon, Vec3, MapDef } from '@kervan/shared';
import { SurfaceMaterial } from './textures';

/** Simülasyon (Z-yukarı) → three (Y-yukarı). */
export function toThree(v: Vec3, out = new THREE.Vector3()): THREE.Vector3 {
  return out.set(v.x, v.z, -v.y);
}

interface GeoBuilder {
  pos: number[];
  nor: number[];
  uv: number[];
  col: number[];
}

const AO_BANDS = [0, 24, 64, 128];

function aoAt(z: number): number {
  if (z <= 0) return 0.62;
  if (z >= 72) return 1;
  const t = z / 72;
  return 0.62 + (1 - 0.62) * (t * t * (3 - 2 * t));
}

export function buildMapMeshes(map: MapDef, mats: Record<number, SurfaceMaterial>, plank: SurfaceMaterial): THREE.Group {
  const group = new THREE.Group();
  group.name = 'map';
  const builders = new Map<SurfaceMaterial, GeoBuilder>();
  const get = (m: SurfaceMaterial) => {
    let b = builders.get(m);
    if (!b) builders.set(m, (b = { pos: [], nor: [], uv: [], col: [] }));
    return b;
  };

  for (const brush of map.brushes) {
    if (brush.nodraw) continue;
    addBrush(brush, (mat, crate) => (mat === Mat.Wood && !crate ? plank : mats[mat] ?? mats[Mat.Concrete]!), get);
  }

  for (const [m, b] of builders) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(b.nor, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 3));
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, m.material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}

function addBrush(brush: Brush, pick: (mat: Mat, crate: boolean) => SurfaceMaterial, get: (m: SurfaceMaterial) => GeoBuilder) {
  const tint = new THREE.Color(brush.tint ?? 0xffffff);
  const crate = brush.texScale !== undefined;
  for (let i = 0; i < brush.planes.length; i++) {
    const pl = brush.planes[i]!;
    if (pl.bevel) continue;
    let poly = planePolygon(brush.planes, i);
    if (poly.length < 3 || polygonArea(poly) < 0.5) continue;
    const mat = pl.mat ?? brush.mat;
    const sm = pick(mat, crate);
    const b = get(sm);
    const n = pl.n;
    const ax = Math.abs(n.x);
    const ay = Math.abs(n.y);
    const az = Math.abs(n.z);
    const scale = crate && mat === brush.mat ? brush.texScale! : sm.scale;
    const ox = crate ? brush.mins.x : 0;
    const oy = crate ? brush.mins.y : 0;
    const oz = crate ? brush.mins.z : 0;
    const uvOf = (p: Vec3): [number, number] => {
      if (az >= ax && az >= ay) return [(p.x - ox) / scale, (p.y - oy) / scale];
      if (ax >= ay) return [(n.x > 0 ? p.y - oy : -(p.y - oy)) / scale, (p.z - oz) / scale];
      return [(n.y > 0 ? -(p.x - ox) : p.x - ox) / scale, (p.z - oz) / scale];
    };
    const vertical = az < 0.3;
    // dikey yüzleri AO bantlarına böl
    const polys: Vec3[][] = [];
    if (vertical) {
      let rest = poly;
      for (const z of AO_BANDS) {
        if (rest.length < 3) break;
        const below = clipPolygon(rest, { n: { x: 0, y: 0, z: 1 }, d: z });
        const above = clipPolygon(rest, { n: { x: 0, y: 0, z: -1 }, d: -z });
        if (below.length >= 3 && polygonArea(below) > 0.1) polys.push(below);
        rest = above;
      }
      if (rest.length >= 3 && polygonArea(rest) > 0.1) polys.push(rest);
    } else polys.push(poly);

    for (poly of polys) {
      for (let k = 1; k < poly.length - 1; k++) {
        for (const p of [poly[0]!, poly[k]!, poly[k + 1]!]) {
          b.pos.push(p.x, p.z, -p.y);
          b.nor.push(n.x, n.z, -n.y);
          const [u, v] = uvOf(p);
          b.uv.push(u, v);
          let ao = vertical ? aoAt(p.z) : 1;
          // aşağı bakan yüzler (tavan, kemer altı) biraz koyu
          if (n.z < -0.5) ao = 0.7;
          b.col.push(tint.r * ao, tint.g * ao, tint.b * ao);
        }
      }
    }
  }
}

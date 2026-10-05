/**
 * Mermi izi: dünya + oyuncu hitbox'ları, CS'in HandleBulletPenetration formülü ile
 * duvar delme (wallbang).
 */
import { Vec3 } from '../math';
import { World } from '../world/world';
import { MASK_SHOT } from '../world/brush';
import { Mat, MATERIALS } from '../world/materials';
import { HitGroup, HitTarget, traceHitTargets } from './hitboxes';
import { bulletDamage } from './damage';
import type { WeaponDef } from '../weapons/data';

export interface BulletImpact {
  point: Vec3;
  normal: Vec3;
  mat: Mat;
  exit: boolean;
}

export interface BulletPlayerHit {
  id: number;
  group: HitGroup;
  /** Zırhtan önceki hasar. */
  damage: number;
  point: Vec3;
  distance: number;
  /** Kaç yüzey delindi (wallbang). */
  penetrated: number;
}

export interface BulletResult {
  impacts: BulletImpact[];
  hits: BulletPlayerHit[];
  end: Vec3;
}

const MAX_PENETRATIONS = 4;
const EXIT_STEP = 4;
const EXIT_MAX = 90;

export function traceBullet(
  world: World,
  origin: Vec3,
  dir: Vec3,
  def: WeaponDef,
  targets: readonly HitTarget[],
  shooterId: number,
): BulletResult {
  const impacts: BulletImpact[] = [];
  const hits: BulletPlayerHit[] = [];
  const skip = new Set<number>([shooterId]);
  let damage = def.damage;
  let distance = 0;
  let src = { ...origin };
  let pens = 0;
  const maxRange = def.range;
  let end = { ...origin };

  for (let guard = 0; guard < 12 && damage >= 1; guard++) {
    const left = maxRange - distance;
    if (left <= 1) break;
    const far = { x: src.x + dir.x * left, y: src.y + dir.y * left, z: src.z + dir.z * left };
    const tr = world.traceRay(src, far, MASK_SHOT);
    const segLen = left * tr.fraction;

    const ph = traceHitTargets(src, dir, segLen, targets, skip);
    if (ph) {
      const hitDist = distance + ph.t;
      const point = { x: src.x + dir.x * ph.t, y: src.y + dir.y * ph.t, z: src.z + dir.z * ph.t };
      hits.push({
        id: ph.target.id,
        group: ph.group,
        damage: bulletDamage(def, damage, hitDist, ph.group),
        point,
        distance: hitDist,
        penetrated: pens,
      });
      skip.add(ph.target.id);
      // oyuncudan geçiş (et): kalınlık ~ 12 birim, modifikatör 1
      damage -= penetrationLoss(damage, def.penetration, 1, 12, 0.16);
      pens++;
      if (pens > MAX_PENETRATIONS) break;
      distance = hitDist + 1;
      src = { x: point.x + dir.x, y: point.y + dir.y, z: point.z + dir.z };
      end = point;
      continue;
    }

    end = tr.endpos;
    if (tr.fraction >= 1) break;
    distance += segLen;
    const enterMat = tr.mat;
    impacts.push({ point: tr.endpos, normal: tr.normal, mat: enterMat, exit: false });

    if (pens >= MAX_PENETRATIONS || def.penetration <= 0) break;
    const exit = findExit(world, tr.endpos, dir);
    if (!exit) break;
    const thickness = Math.hypot(exit.point.x - tr.endpos.x, exit.point.y - tr.endpos.y, exit.point.z - tr.endpos.z);

    let mod: number;
    let lost = 0.16;
    const enterInfo = MATERIALS[enterMat]!;
    const exitInfo = MATERIALS[exit.mat]!;
    if (enterMat === Mat.Glass) {
      mod = 3;
      lost = 0.05;
    } else if (enterMat === exit.mat && (enterMat === Mat.Wood || enterMat === Mat.Cardboard)) {
      mod = 3;
    } else {
      mod = (enterInfo.penetration + exitInfo.penetration) / 2;
    }
    damage -= penetrationLoss(damage, def.penetration, mod, thickness, lost);
    if (damage < 1) break;
    pens++;
    impacts.push({ point: exit.point, normal: exit.normal, mat: exit.mat, exit: true });
    distance += thickness;
    src = { x: exit.point.x + dir.x * 0.5, y: exit.point.y + dir.y * 0.5, z: exit.point.z + dir.z * 0.5 };
  }
  return { impacts, hits, end };
}

/** CS:GO HandleBulletPenetration hasar kaybı. */
export function penetrationLoss(current: number, penetrationPower: number, modifier: number, thickness: number, lostPercent: number): number {
  const penMod = Math.max(0, 1 / modifier);
  const chunk = current * lostPercent;
  const wep = chunk + Math.max(0, (3 / penetrationPower) * 1.25) * (penMod * 3);
  const obj = (penMod * thickness * thickness) / 24;
  return Math.max(0, wep + obj);
}

function findExit(world: World, entry: Vec3, dir: Vec3): { point: Vec3; normal: Vec3; mat: Mat } | null {
  for (let d = EXIT_STEP; d <= EXIT_MAX; d += EXIT_STEP) {
    const p = { x: entry.x + dir.x * d, y: entry.y + dir.y * d, z: entry.z + dir.z * d };
    if (world.pointInSolid(p, MASK_SHOT)) continue;
    // katıdan çıktık: geri doğru iz sürerek çıkış yüzeyini bul
    const back = { x: p.x - dir.x * (EXIT_STEP + 0.5), y: p.y - dir.y * (EXIT_STEP + 0.5), z: p.z - dir.z * (EXIT_STEP + 0.5) };
    const tr = world.traceRay(p, back, MASK_SHOT);
    if (tr.fraction < 1 && !tr.startsolid) return { point: tr.endpos, normal: tr.normal, mat: tr.mat };
    return { point: p, normal: { x: dir.x, y: dir.y, z: dir.z }, mat: Mat.Concrete };
  }
  return null;
}

/** Molotof/yangın bombası alevleri: zemine yayılan deterministik alev noktaları. */
import { Vec3 } from '../math';
import { World } from '../world/world';
import { MASK_SHOT } from '../world/brush';
import { UniformRandomStream } from '../random';

export interface Flame {
  pos: Vec3;
  /** Alev oluşma zamanı (patlamaya göre). */
  t: number;
}

export interface Inferno {
  id: number;
  owner: number;
  ownerTeam: number;
  center: Vec3;
  flames: Flame[];
  bornAt: number;
  /** Sis tarafından söndürüldü. */
  extinguished: boolean;
}

export const FLAME_RADIUS = 36;
export const MAX_FLAMES = 22;
export const INFERNO_SPREAD_TIME = 1.6;

export function spawnInferno(world: World, id: number, owner: number, ownerTeam: number, pos: Vec3, bornAt: number): Inferno {
  const rnd = new UniformRandomStream(id * 7919 + 17);
  const flames: Flame[] = [];
  // patlama noktasının altındaki zemini bul
  const down = world.traceRay({ x: pos.x, y: pos.y, z: pos.z + 8 }, { x: pos.x, y: pos.y, z: pos.z - 200 }, MASK_SHOT);
  const center = down.fraction < 1 ? { x: down.endpos.x, y: down.endpos.y, z: down.endpos.z + 1 } : { ...pos };
  flames.push({ pos: center, t: 0 });
  let attempts = 0;
  while (flames.length < MAX_FLAMES && attempts < 120) {
    attempts++;
    const parent = flames[rnd.randomInt(0, flames.length - 1)]!;
    const ang = rnd.randomFloat(0, Math.PI * 2);
    const dist = rnd.randomFloat(28, 52);
    const from = { x: parent.pos.x, y: parent.pos.y, z: parent.pos.z + 18 };
    const to = { x: from.x + Math.cos(ang) * dist, y: from.y + Math.sin(ang) * dist, z: from.z };
    // merkezden çok uzaklaşma
    if (Math.hypot(to.x - center.x, to.y - center.y) > 175) continue;
    const side = world.traceRay(from, to, MASK_SHOT);
    if (side.fraction < 1) continue;
    const fl = world.traceRay(to, { x: to.x, y: to.y, z: to.z - 72 }, MASK_SHOT);
    if (fl.fraction >= 1 || fl.normal.z < 0.6) continue;
    const p = { x: fl.endpos.x, y: fl.endpos.y, z: fl.endpos.z + 1 };
    if (flames.some((f) => Math.hypot(f.pos.x - p.x, f.pos.y - p.y) < 26 && Math.abs(f.pos.z - p.z) < 24)) continue;
    const t = parent.t + rnd.randomFloat(0.05, 0.22);
    flames.push({ pos: p, t: Math.min(INFERNO_SPREAD_TIME, t) });
  }
  return { id, owner, ownerTeam, center, flames, bornAt, extinguished: false };
}

/** Bu noktadaki oyuncu ateşte mi (ayak pozisyonu). */
export function inFire(inf: Inferno, feet: Vec3, age: number): boolean {
  if (inf.extinguished) return false;
  for (const f of inf.flames) {
    if (f.t > age) continue;
    if (Math.hypot(f.pos.x - feet.x, f.pos.y - feet.y) < FLAME_RADIUS && feet.z - f.pos.z < 60 && feet.z - f.pos.z > -30) return true;
  }
  return false;
}

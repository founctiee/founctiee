/**
 * Bomba fiziği (CS: MOVETYPE_FLYBOUNCE, yerçekimi 0.4, esneklik 0.45) ve patlama
 * zamanlamaları.
 */
import { Vec3, vdot } from '../math';
import { cvars } from '../constants';
import { World, EntityBox } from '../world/world';
import { MASK_GRENADE } from '../world/brush';
import { GRENADE_KEYS } from '../weapons/data';

export enum GrenadeType {
  HE = 0,
  Flash = 1,
  Smoke = 2,
  Molotov = 3,
  Incendiary = 4,
  Decoy = 5,
}

export function grenadeKey(t: GrenadeType): string {
  return GRENADE_KEYS[t]!;
}

export interface Grenade {
  id: number;
  type: GrenadeType;
  owner: number;
  ownerTeam: number;
  pos: Vec3;
  vel: Vec3;
  /** Atıldıktan beri geçen süre. */
  age: number;
  /** Durgun kaldığı süre (smoke/decoy durunca patlar). */
  restTime: number;
  resting: boolean;
  detonated: boolean;
  bounces: number;
  /** Molotof zemine çarptı mı. */
  hitFloor: boolean;
}

export const GRENADE_GRAVITY = 0.4;
export const GRENADE_ELASTICITY = 0.45;
export const GRENADE_RADIUS = 2;
const MINS = { x: -GRENADE_RADIUS, y: -GRENADE_RADIUS, z: -GRENADE_RADIUS };
const MAXS = { x: GRENADE_RADIUS, y: GRENADE_RADIUS, z: GRENADE_RADIUS };

export const FUSE_TIME: Record<GrenadeType, number> = {
  [GrenadeType.HE]: 1.5,
  [GrenadeType.Flash]: 1.5,
  [GrenadeType.Smoke]: 1.5,
  [GrenadeType.Molotov]: 2.0,
  [GrenadeType.Incendiary]: 2.0,
  [GrenadeType.Decoy]: 2.0,
};

export interface GrenadeStepResult {
  bounced: boolean;
  /** Bu adımda patlamalı. */
  detonate: boolean;
}

/** Bir tick'lik bomba hareketi. */
export function stepGrenade(g: Grenade, world: World, dt: number, players?: readonly EntityBox[]): GrenadeStepResult {
  const res: GrenadeStepResult = { bounced: false, detonate: false };
  g.age += dt;
  if (g.detonated) return res;

  if (!g.resting) {
    g.vel.z -= cvars.sv_gravity * GRENADE_GRAVITY * dt;
    let timeLeft = dt;
    for (let i = 0; i < 4 && timeLeft > 0; i++) {
      const end = { x: g.pos.x + g.vel.x * timeLeft, y: g.pos.y + g.vel.y * timeLeft, z: g.pos.z + g.vel.z * timeLeft };
      const tr = world.traceHull(g.pos, end, MINS, MAXS, MASK_GRENADE, players, g.owner);
      if (tr.allsolid) {
        g.vel = { x: 0, y: 0, z: 0 };
        break;
      }
      g.pos = tr.endpos;
      if (tr.fraction >= 1) break;
      timeLeft -= timeLeft * tr.fraction;
      res.bounced = true;
      g.bounces++;
      const n = tr.normal;
      const hitPlayer = tr.entity >= 0;
      const elasticity = Math.min(0.9, GRENADE_ELASTICITY * (hitPlayer ? 0.3 : 1));
      // yansıt (overbounce 2) ve esnekliği uygula
      const back = vdot(g.vel, n) * 2;
      g.vel = {
        x: (g.vel.x - n.x * back) * elasticity,
        y: (g.vel.y - n.y * back) * elasticity,
        z: (g.vel.z - n.z * back) * elasticity,
      };
      if (n.z > 0.7) {
        if (g.type === GrenadeType.Molotov || g.type === GrenadeType.Incendiary) {
          g.hitFloor = true;
          res.detonate = true;
          g.vel = { x: 0, y: 0, z: 0 };
          break;
        }
        const sp2 = g.vel.x * g.vel.x + g.vel.y * g.vel.y + g.vel.z * g.vel.z;
        if (sp2 < 20 * 20) {
          g.vel = { x: 0, y: 0, z: 0 };
          g.resting = true;
          break;
        }
      }
    }
  }

  if (g.resting) g.restTime += dt;

  switch (g.type) {
    case GrenadeType.HE:
    case GrenadeType.Flash:
      if (g.age >= FUSE_TIME[g.type]) res.detonate = true;
      break;
    case GrenadeType.Smoke:
    case GrenadeType.Decoy: {
      const speed = Math.hypot(g.vel.x, g.vel.y, g.vel.z);
      if (g.age >= FUSE_TIME[g.type] && (g.resting || speed < 10)) res.detonate = true;
      break;
    }
    case GrenadeType.Molotov:
    case GrenadeType.Incendiary:
      if (g.age >= FUSE_TIME[g.type]) res.detonate = true;
      break;
  }
  if (res.detonate) g.detonated = true;
  return res;
}

// ───────────── patlama etkileri ─────────────

export const HE_DAMAGE = 99;
export const HE_RADIUS = 350;
export const HE_ARMOR_RATIO = 1.2;

/** HE hasarı (doğrusal düşüş), görüş hattı ayrıca kontrol edilir. */
export function heDamageAt(distance: number): number {
  if (distance >= HE_RADIUS) return 0;
  return HE_DAMAGE * (1 - distance / HE_RADIUS);
}

/**
 * Flaş: açıya ve mesafeye göre körlük süresi (saniye). dot = bakış yönü · flaşa yön.
 */
export function flashDuration(distance: number, dot: number): number {
  let dist = 1;
  if (distance > 300) dist = Math.max(0, 1 - (distance - 300) / 1700);
  let ang: number;
  if (dot >= 0.6) ang = 1;
  else if (dot >= 0.3) ang = 0.6 + ((dot - 0.3) / 0.3) * 0.4;
  else if (dot >= -0.3) ang = 0.4 + ((dot + 0.3) / 0.6) * 0.2;
  else ang = 0.2;
  const d = 4.9 * dist * ang;
  return d < 0.15 ? 0 : d;
}

export const SMOKE_DURATION = 18;
export const SMOKE_FADE = 2;
export const INFERNO_DURATION = 7;
export const INFERNO_DPS = 40;
export const DECOY_DURATION = 15;

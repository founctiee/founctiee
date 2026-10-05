/**
 * CS isabetsizlik modeli (CWeaponCSBase::GetInaccuracy / UpdateAccuracyPenalty)
 * ve seed'li spread yönü.
 */
import { DUCK_SPEED_MODIFIER, cvars } from '../constants';
import { Vec3, angleVectors, remap, remapClamped, clamp } from '../math';
import { UniformRandomStream } from '../random';
import type { WeaponDef, WeaponMode } from './data';

export interface AccuracyInput {
  speed2d: number;
  vz: number;
  onGround: boolean;
  ducked: boolean;
  walking: boolean;
}

export function recoveryTime(w: WeaponDef, ducked: boolean, recoilIndex: number): number {
  let t = ducked ? w.recoveryTimeCrouch : w.recoveryTimeStand;
  const final = ducked ? w.recoveryTimeCrouchFinal : w.recoveryTimeStandFinal;
  if (final !== -1 && w.recoveryTransitionEnd > 0) {
    t = remapClamped(Math.floor(recoilIndex), w.recoveryTransitionStart, w.recoveryTransitionEnd, t, final);
  }
  return Math.max(0.01, t);
}

/** Her tick: taban isabetsizliğe doğru üstel toparlanma. */
export function updateAccuracyPenalty(
  w: WeaponDef,
  mode: WeaponMode,
  penalty: number,
  ducked: boolean,
  reloading: boolean,
  recoilIndex: number,
  dt: number,
): number {
  let target = ducked ? w.inaccuracyCrouch[mode] : w.inaccuracyStand[mode];
  if (reloading) target += w.inaccuracyReload;
  if (target > penalty) return target;
  const decay = Math.log(10) / recoveryTime(w, ducked, recoilIndex);
  const k = Math.exp(-dt * decay);
  return target + (penalty - target) * k;
}

export function getInaccuracy(w: WeaponDef, mode: WeaponMode, penalty: number, a: AccuracyInput): number {
  let acc = penalty;
  const maxSpeed = w.maxSpeed[mode];
  const moveScale = remapClamped(a.speed2d, maxSpeed * DUCK_SPEED_MODIFIER, maxSpeed * 0.95, 0, 1);
  if (moveScale > 0) acc += moveScale * w.inaccuracyMove[mode];
  if (!a.onGround) {
    const sqrtMax = Math.sqrt(cvars.sv_jump_impulse);
    const sqrtV = Math.sqrt(Math.abs(a.vz));
    let air = remap(sqrtV, sqrtMax * 0.25, sqrtMax, 0, 1);
    air = clamp(air, 0, 2);
    acc += air * w.inaccuracyJump[mode];
  }
  return Math.min(acc, 1);
}

/** Seed'li spread: her saçma için yön üretir (FireBullets mantığı). */
export function spreadDirections(
  seed: number,
  pitch: number,
  yaw: number,
  inaccuracy: number,
  spread: number,
  pellets: number,
): Vec3[] {
  const rnd = new UniformRandomStream(seed);
  const { forward, right, up } = angleVectors(pitch, yaw);
  const out: Vec3[] = [];
  for (let i = 0; i < pellets; i++) {
    const r1 = rnd.randomFloat(0, 1);
    const p1 = rnd.randomFloat(0, Math.PI * 2);
    const r2 = rnd.randomFloat(0, 1);
    const p2 = rnd.randomFloat(0, Math.PI * 2);
    const sx = Math.cos(p1) * r1 * inaccuracy + Math.cos(p2) * r2 * spread;
    const sy = Math.sin(p1) * r1 * inaccuracy + Math.sin(p2) * r2 * spread;
    const d = {
      x: forward.x + right.x * sx + up.x * sy,
      y: forward.y + right.y * sx + up.y * sy,
      z: forward.z + right.z * sx + up.z * sy,
    };
    const l = Math.hypot(d.x, d.y, d.z);
    out.push({ x: d.x / l, y: d.y / l, z: d.z / l });
  }
  return out;
}

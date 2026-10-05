/**
 * CS recoil (sekme) sistemi: her silah için 64 elemanlık deterministik tablo
 * (CCSWeaponInfo::GenerateRecoilTable mantığı) ve aim punch dinamiği.
 */
import { UniformRandomStream } from '../random';
import { DEG2RAD, lerp } from '../math';
import type { WeaponDef, WeaponMode } from './data';

export const recoilCvars = {
  /** Mermilerin aim punch'ı kaç kat takip ettiği. */
  weapon_recoil_scale: 2.0,
  /** Kameranın aim punch'ı ne kadar takip ettiği. */
  view_recoil_tracking: 0.45,
  weapon_recoil_decay2_exp: 8,
  weapon_recoil_decay2_lin: 18,
  weapon_recoil_vel_decay: 4.5,
  weapon_recoil_view_punch_extra: 0.055,
  weapon_recoil_suppression_shots: 4,
  weapon_recoil_suppression_factor: 0.75,
  weapon_recoil_variance: 0.55,
  view_punch_decay: 18,
};

export const RECOIL_TABLE_SIZE = 64;

export interface RecoilEntry {
  angle: number;
  magnitude: number;
}

const cache = new Map<string, RecoilEntry[]>();

export function recoilTable(w: WeaponDef, mode: WeaponMode): RecoilEntry[] {
  const key = `${w.num}:${mode}`;
  let t = cache.get(key);
  if (t) return t;
  t = generateRecoilTable(w, mode);
  cache.set(key, t);
  return t;
}

export function generateRecoilTable(w: WeaponDef, mode: WeaponMode): RecoilEntry[] {
  const rnd = new UniformRandomStream(w.recoilSeed);
  const c = recoilCvars;
  const out: RecoilEntry[] = [];
  let angle = 0;
  let magnitude = 0;
  for (let j = 0; j < RECOIL_TABLE_SIZE; j++) {
    const angleNew = w.recoilAngle[mode] + rnd.randomFloat(-w.recoilAngleVariance[mode], w.recoilAngleVariance[mode]);
    const magNew = w.recoilMagnitude[mode] + rnd.randomFloat(-w.recoilMagnitudeVariance[mode], w.recoilMagnitudeVariance[mode]);
    if (w.fullAuto && j > 0) {
      angle = lerp(angle, angleNew, c.weapon_recoil_variance);
      magnitude = lerp(magnitude, magNew, c.weapon_recoil_variance);
    } else {
      angle = angleNew;
      magnitude = magNew;
    }
    let m = magnitude;
    if (w.fullAuto && j < c.weapon_recoil_suppression_shots) {
      const f = lerp(c.weapon_recoil_suppression_factor, 1, j / c.weapon_recoil_suppression_shots);
      m *= f;
    }
    out.push({ angle, magnitude: m });
  }
  return out;
}

/** Açı çifti (derece): p = pitch (pozitif aşağı), y = yaw. */
export interface Punch {
  p: number;
  y: number;
}

/** Atış anında aim punch hızına darbe ekler. */
export function applyRecoil(w: WeaponDef, mode: WeaponMode, recoilIndex: number, aimVel: Punch, view: Punch): void {
  const table = recoilTable(w, mode);
  const i = Math.max(0, Math.min(RECOIL_TABLE_SIZE - 1, Math.floor(recoilIndex)));
  const e = table[i]!;
  const a = e.angle * DEG2RAD;
  aimVel.p -= Math.cos(a) * e.magnitude;
  aimVel.y -= Math.sin(a) * e.magnitude;
  view.p -= e.magnitude * recoilCvars.weapon_recoil_view_punch_extra;
}

/** Her tick: aim punch açısı ve hızı söner (CCSPlayer::DecayAimPunchAngle). */
export function decayPunch(aim: Punch, vel: Punch, view: Punch, dt: number): void {
  const c = recoilCvars;
  // üstel + doğrusal sönüm
  const k = Math.exp(-c.weapon_recoil_decay2_exp * dt);
  aim.p *= k;
  aim.y *= k;
  const len = Math.hypot(aim.p, aim.y);
  if (len > 0) {
    const nl = Math.max(0, len - c.weapon_recoil_decay2_lin * dt);
    aim.p *= nl / len;
    aim.y *= nl / len;
  }
  // hızı entegre et
  aim.p += vel.p * dt * 0.5;
  aim.y += vel.y * dt * 0.5;
  const kv = Math.exp(-c.weapon_recoil_vel_decay * dt);
  vel.p *= kv;
  vel.y *= kv;
  aim.p += vel.p * dt * 0.5;
  aim.y += vel.y * dt * 0.5;
  if (Math.abs(vel.p) < 1e-4) vel.p = 0;
  if (Math.abs(vel.y) < 1e-4) vel.y = 0;

  const kvp = Math.exp(-c.view_punch_decay * dt);
  view.p *= kvp;
  view.y *= kvp;
}

/** Basit 3B vektör yardımcıları. Simülasyon Source birimleri (inç) ve Z-yukarı kullanır. */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export const vec3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });
export const vclone = (a: Vec3): Vec3 => ({ x: a.x, y: a.y, z: a.z });
export const vset = (out: Vec3, x: number, y: number, z: number): Vec3 => {
  out.x = x;
  out.y = y;
  out.z = z;
  return out;
};
export const vcopy = (out: Vec3, a: Vec3): Vec3 => {
  out.x = a.x;
  out.y = a.y;
  out.z = a.z;
  return out;
};
export const vadd = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const vsub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const vscale = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const vma = (a: Vec3, s: number, b: Vec3): Vec3 => ({ x: a.x + b.x * s, y: a.y + b.y * s, z: a.z + b.z * s });
export const vdot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const vcross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
export const vlen = (a: Vec3): number => Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
export const vlen2d = (a: Vec3): number => Math.sqrt(a.x * a.x + a.y * a.y);
export const vdist = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
export const vlerp = (a: Vec3, b: Vec3, t: number): Vec3 => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
  z: a.z + (b.z - a.z) * t,
});
export function vnormalize(a: Vec3): Vec3 {
  const l = vlen(a);
  return l > 1e-9 ? { x: a.x / l, y: a.y / l, z: a.z / l } : { x: 0, y: 0, z: 0 };
}

export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;
export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export function remapClamped(v: number, a: number, b: number, c: number, d: number): number {
  if (a === b) return v >= b ? d : c;
  const t = clamp((v - a) / (b - a), 0, 1);
  return c + (d - c) * t;
}
export function remap(v: number, a: number, b: number, c: number, d: number): number {
  if (a === b) return v >= b ? d : c;
  return c + ((d - c) * (v - a)) / (b - a);
}

/** Açıyı (-180, 180] aralığına getirir. */
export function normalizeAngle(a: number): number {
  a %= 360;
  if (a > 180) a -= 360;
  if (a <= -180) a += 360;
  return a;
}

export function lerpAngle(a: number, b: number, t: number): number {
  return a + normalizeAngle(b - a) * t;
}

/**
 * Source AngleVectors: pitch (aşağı pozitif), yaw (derece). İleri, sağ, yukarı vektörleri.
 * Source'ta pitch pozitif = aşağı bakmak.
 */
export function angleVectors(pitch: number, yaw: number): { forward: Vec3; right: Vec3; up: Vec3 } {
  const sp = Math.sin(pitch * DEG2RAD);
  const cp = Math.cos(pitch * DEG2RAD);
  const sy = Math.sin(yaw * DEG2RAD);
  const cy = Math.cos(yaw * DEG2RAD);
  const forward = { x: cp * cy, y: cp * sy, z: -sp };
  // roll = 0
  const right = { x: sy, y: -cy, z: 0 };
  const up = { x: sp * cy, y: sp * sy, z: cp };
  return { forward, right, up };
}

export function forwardFromAngles(pitch: number, yaw: number): Vec3 {
  const sp = Math.sin(pitch * DEG2RAD);
  const cp = Math.cos(pitch * DEG2RAD);
  return { x: cp * Math.cos(yaw * DEG2RAD), y: cp * Math.sin(yaw * DEG2RAD), z: -sp };
}

/** Yön vektöründen (pitch, yaw) — Source VectorAngles. */
export function vectorAngles(d: Vec3): { pitch: number; yaw: number } {
  const yaw = Math.atan2(d.y, d.x) * RAD2DEG;
  const pitch = Math.atan2(-d.z, Math.hypot(d.x, d.y)) * RAD2DEG;
  return { pitch, yaw };
}

/**
 * Ağ protokolü. Yüksek frekanslı veriler (komutlar, snapshot) ikili; düşük frekanslı
 * olaylar ve oyun durumu JSON olarak gider.
 */
import { Writer, Reader } from './binary';
import { UserCmd } from '../movement/usercmd';
import { PlayerSim, WeaponItem, createPlayerSim, Team } from '../game/player';
import { Vec3 } from '../math';
import { GRENADE_KEYS } from '../weapons/data';

export const PROTOCOL_VERSION = 3;

export const MSG_CMD = 1;
export const MSG_SNAPSHOT = 2;

// ───────────── komutlar ─────────────

export function encodeCmds(cmds: readonly UserCmd[]): Uint8Array {
  const w = new Writer(32 + cmds.length * 32);
  w.u8w(MSG_CMD);
  w.u8w(cmds.length);
  for (const c of cmds) {
    w.u32(c.seq);
    w.u16(c.buttons);
    w.f32(c.yaw);
    w.f32(c.pitch);
    w.u8w(c.weapon);
    w.f64(c.renderTick);
    w.u8w(c.fireFrac);
  }
  return w.finish();
}

export function decodeCmds(r: Reader): UserCmd[] {
  const n = r.u8();
  const out: UserCmd[] = [];
  for (let i = 0; i < n && r.remaining >= 24; i++) {
    out.push({
      seq: r.u32(),
      buttons: r.u16(),
      yaw: r.f32(),
      pitch: r.f32(),
      weapon: r.u8(),
      renderTick: r.f64(),
      fireFrac: r.u8(),
    });
  }
  return out;
}

// ───────────── yerel oyuncu durumu (tahmin için tam) ─────────────

function writeItem(w: Writer, it: WeaponItem | null) {
  w.bool(it !== null);
  if (!it) return;
  w.u8w(it.num);
  w.u16(it.clip);
  w.u16(it.reserve);
  w.bool(it.silencer);
  w.bool(it.burst);
}
function readItem(r: Reader): WeaponItem | null {
  if (!r.bool()) return null;
  return { num: r.u8(), clip: r.u16(), reserve: r.u16(), silencer: r.bool(), burst: r.bool() };
}

export function writePlayerSim(w: Writer, p: PlayerSim) {
  const m = p.move;
  w.u8w(p.id);
  w.u8w(p.team);
  w.bool(p.alive);
  w.f64(p.time);
  w.i16(p.health);
  w.u8w(p.armor);
  w.bool(p.helmet);
  w.u8w(p.active);
  w.u8w(p.lastActive);
  w.bool(p.defusing);
  w.bool(p.infiniteAmmo);
  w.f64(m.origin.x);
  w.f64(m.origin.y);
  w.f64(m.origin.z);
  w.f64(m.velocity.x);
  w.f64(m.velocity.y);
  w.f64(m.velocity.z);
  w.bool(m.onGround);
  w.u8w(m.groundMat);
  w.bool(m.ducked);
  w.f64(m.duckAmount);
  w.f64(m.duckSpeed);
  w.f64(m.stamina);
  w.f64(m.velocityModifier);
  w.u16(m.oldButtons);
  w.f32(m.lastLandSpeed);
  w.bool(m.noclip);
  writeItem(w, p.inv.primary);
  writeItem(w, p.inv.secondary);
  for (let i = 0; i < GRENADE_KEYS.length; i++) w.u8w(p.inv.grenades[i] ?? 0);
  w.bool(p.inv.c4);
  w.bool(p.inv.defuser);
  const k = p.wpn;
  w.f64(k.nextAttack);
  w.f64(k.nextAttack2);
  w.f64(k.reloadEnd);
  w.bool(k.shellReloading);
  w.f64(k.deployEnd);
  w.f64(k.silencerEnd);
  w.f64(k.recoilIndex);
  w.f64(k.accuracyPenalty);
  w.f64(k.lastShotTime);
  w.u8w(k.zoom);
  w.u8w(k.resumeZoom);
  w.u8w(k.burstLeft);
  w.f64(k.nextBurst);
  w.f64(k.aimPunch.p);
  w.f64(k.aimPunch.y);
  w.f64(k.aimPunchVel.p);
  w.f64(k.aimPunchVel.y);
  w.f64(k.viewPunch.p);
  w.f64(k.viewPunch.y);
  w.bool(k.pinPulled);
  w.f32(k.throwStrength);
  w.u8w(k.knifeChain);
  w.f64(k.plantProgress);
  w.f64(k.inspectEnd);
  w.u32(k.shotCounter);
}

export function readPlayerSim(r: Reader): PlayerSim {
  const p = createPlayerSim(r.u8(), r.u8() as Team);
  p.alive = r.bool();
  p.time = r.f64();
  p.health = r.i16();
  p.armor = r.u8();
  p.helmet = r.bool();
  p.active = r.u8();
  p.lastActive = r.u8();
  p.defusing = r.bool();
  p.infiniteAmmo = r.bool();
  const m = p.move;
  m.origin = { x: r.f64(), y: r.f64(), z: r.f64() };
  m.velocity = { x: r.f64(), y: r.f64(), z: r.f64() };
  m.onGround = r.bool();
  m.groundMat = r.u8();
  m.ducked = r.bool();
  m.duckAmount = r.f64();
  m.duckSpeed = r.f64();
  m.stamina = r.f64();
  m.velocityModifier = r.f64();
  m.oldButtons = r.u16();
  m.lastLandSpeed = r.f32();
  m.noclip = r.bool();
  p.inv.primary = readItem(r);
  p.inv.secondary = readItem(r);
  for (let i = 0; i < GRENADE_KEYS.length; i++) p.inv.grenades[i] = r.u8();
  p.inv.c4 = r.bool();
  p.inv.defuser = r.bool();
  const k = p.wpn;
  k.nextAttack = r.f64();
  k.nextAttack2 = r.f64();
  k.reloadEnd = r.f64();
  k.shellReloading = r.bool();
  k.deployEnd = r.f64();
  k.silencerEnd = r.f64();
  k.recoilIndex = r.f64();
  k.accuracyPenalty = r.f64();
  k.lastShotTime = r.f64();
  k.zoom = r.u8();
  k.resumeZoom = r.u8();
  k.burstLeft = r.u8();
  k.nextBurst = r.f64();
  k.aimPunch = { p: r.f64(), y: r.f64() };
  k.aimPunchVel = { p: r.f64(), y: r.f64() };
  k.viewPunch = { p: r.f64(), y: r.f64() };
  k.pinPulled = r.bool();
  k.throwStrength = r.f32();
  k.knifeChain = r.u8();
  k.plantProgress = r.f64();
  k.inspectEnd = r.f64();
  k.shotCounter = r.u32();
  return p;
}

// ───────────── diğer oyuncular / varlıklar ─────────────

export const EF_ALIVE = 1;
export const EF_DUCKED = 2;
export const EF_ONGROUND = 4;
export const EF_SCOPED = 8;
export const EF_DEFUSING = 16;
export const EF_PLANTING = 32;
export const EF_RELOADING = 64;
export const EF_WALKING = 128;

export interface EntityState {
  id: number;
  team: Team;
  flags: number;
  pos: Vec3;
  vel: Vec3;
  yaw: number;
  pitch: number;
  duck: number;
  weapon: number;
  /** Son atış sayacı (atış animasyonu için). */
  shots: number;
}

export interface GrenadeState {
  id: number;
  type: number;
  pos: Vec3;
}

export interface DroppedState {
  id: number;
  weapon: number;
  pos: Vec3;
  yaw: number;
}

export interface Snapshot {
  tick: number;
  ackSeq: number;
  /** Yerel oyuncu (izleyiciyse null). */
  local: PlayerSim | null;
  /** İzlenen oyuncu (öldüyse). */
  spectating: number;
  entities: EntityState[];
  grenades: GrenadeState[];
  dropped: DroppedState[];
  bomb: { state: number; pos: Vec3 } | null;
}

export function encodeSnapshot(s: Snapshot): Uint8Array {
  const w = new Writer(2048);
  w.u8w(MSG_SNAPSHOT);
  w.u32(s.tick);
  w.u32(s.ackSeq);
  w.u8w(s.spectating);
  w.bool(s.local !== null);
  if (s.local) writePlayerSim(w, s.local);
  w.u8w(s.entities.length);
  for (const e of s.entities) {
    w.u8w(e.id);
    w.u8w(e.team);
    w.u8w(e.flags);
    w.f32(e.pos.x);
    w.f32(e.pos.y);
    w.f32(e.pos.z);
    w.i16(Math.round(e.vel.x));
    w.i16(Math.round(e.vel.y));
    w.i16(Math.round(e.vel.z));
    w.u16(Math.round((((e.yaw % 360) + 360) % 360) * (65535 / 360)));
    w.i16(Math.round(e.pitch * 300));
    w.u8w(Math.round(e.duck * 255));
    w.u8w(e.weapon);
    w.u8w(e.shots & 255);
  }
  w.u8w(s.grenades.length);
  for (const g of s.grenades) {
    w.u16(g.id);
    w.u8w(g.type);
    w.f32(g.pos.x);
    w.f32(g.pos.y);
    w.f32(g.pos.z);
  }
  w.u8w(s.dropped.length);
  for (const d of s.dropped) {
    w.u16(d.id);
    w.u8w(d.weapon);
    w.f32(d.pos.x);
    w.f32(d.pos.y);
    w.f32(d.pos.z);
    w.u16(Math.round((((d.yaw % 360) + 360) % 360) * (65535 / 360)));
  }
  w.bool(s.bomb !== null);
  if (s.bomb) {
    w.u8w(s.bomb.state);
    w.f32(s.bomb.pos.x);
    w.f32(s.bomb.pos.y);
    w.f32(s.bomb.pos.z);
  }
  return w.finish();
}

export function decodeSnapshot(r: Reader): Snapshot {
  const tick = r.u32();
  const ackSeq = r.u32();
  const spectating = r.u8();
  const local = r.bool() ? readPlayerSim(r) : null;
  const ne = r.u8();
  const entities: EntityState[] = [];
  for (let i = 0; i < ne; i++) {
    entities.push({
      id: r.u8(),
      team: r.u8() as Team,
      flags: r.u8(),
      pos: { x: r.f32(), y: r.f32(), z: r.f32() },
      vel: { x: r.i16(), y: r.i16(), z: r.i16() },
      yaw: r.u16() * (360 / 65535),
      pitch: r.i16() / 300,
      duck: r.u8() / 255,
      weapon: r.u8(),
      shots: r.u8(),
    });
  }
  const ng = r.u8();
  const grenades: GrenadeState[] = [];
  for (let i = 0; i < ng; i++) grenades.push({ id: r.u16(), type: r.u8(), pos: { x: r.f32(), y: r.f32(), z: r.f32() } });
  const nd = r.u8();
  const dropped: DroppedState[] = [];
  for (let i = 0; i < nd; i++)
    dropped.push({ id: r.u16(), weapon: r.u8(), pos: { x: r.f32(), y: r.f32(), z: r.f32() }, yaw: r.u16() * (360 / 65535) });
  const bomb = r.bool() ? { state: r.u8(), pos: { x: r.f32(), y: r.f32(), z: r.f32() } } : null;
  return { tick, ackSeq, local, spectating, entities, grenades, dropped, bomb };
}

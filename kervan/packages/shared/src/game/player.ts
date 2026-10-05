/**
 * Oyuncu simülasyonu: hareket + envanter + silah durumu. İstemci (tahmin) ve sunucu
 * (yetkili) bu dosyadaki simulateCmd fonksiyonunu birebir aynı şekilde çalıştırır.
 */
import { Vec3, vec3, angleVectors, DEG2RAD } from '../math';
import { TICK_DT } from '../constants';
import { MoveState, createMoveState, playerMove, eyeHeight, cloneMoveState } from '../movement/gamemovement';
import {
  UserCmd,
  IN_ATTACK,
  IN_ATTACK2,
  IN_RELOAD,
  IN_INSPECT,
  IN_SPEED,
  IN_USE,
} from '../movement/usercmd';
import { World, EntityBox } from '../world/world';
import {
  WeaponDef,
  WeaponMode,
  weaponByNum,
  KNIFE,
  C4,
  GRENADE_KEYS,
  WEAPON_BY_KEY,
  ITEM_PRIMARY,
  ITEM_SECONDARY,
  ITEM_KNIFE,
  ITEM_GRENADE0,
  ITEM_C4,
  ITEM_NONE,
} from '../weapons/data';
import { Punch, applyRecoil, decayPunch, recoilCvars } from '../weapons/recoil';
import { getInaccuracy, updateAccuracyPenalty, spreadDirections } from '../weapons/inaccuracy';
import { hashSeed } from '../random';

export enum Team {
  None = 0,
  T = 1,
  CT = 2,
  Spectator = 3,
}

export interface WeaponItem {
  num: number;
  clip: number;
  reserve: number;
  /** Susturucu takılı (USP-S/M4A1-S). */
  silencer: boolean;
  /** Burst modu (Glock/FAMAS). */
  burst: boolean;
}

export interface Inventory {
  primary: WeaponItem | null;
  secondary: WeaponItem | null;
  /** GRENADE_KEYS sırasıyla adetler. */
  grenades: number[];
  c4: boolean;
  defuser: boolean;
}

export interface WeaponRuntime {
  nextAttack: number;
  nextAttack2: number;
  reloadEnd: number;
  /** Pompalı: fişek doldurma modunda mı. */
  shellReloading: boolean;
  deployEnd: number;
  silencerEnd: number;
  recoilIndex: number;
  accuracyPenalty: number;
  lastShotTime: number;
  zoom: number;
  /** Atış sonrası tekrar zoom yapılacak seviye (AWP). */
  resumeZoom: number;
  burstLeft: number;
  nextBurst: number;
  aimPunch: Punch;
  aimPunchVel: Punch;
  viewPunch: Punch;
  /** Bomba pimi çekildi; bırakınca atılır. */
  pinPulled: boolean;
  throwStrength: number;
  /** Bıçak sol tık serisi (ilk vuruş daha güçlü). */
  knifeChain: number;
  plantProgress: number;
  inspectEnd: number;
  /** Atış sayacı (seed için). */
  shotCounter: number;
}

export interface PlayerSim {
  id: number;
  team: Team;
  alive: boolean;
  move: MoveState;
  /** Oyuncunun tick tabanı (saniye). */
  time: number;
  health: number;
  armor: number;
  helmet: boolean;
  inv: Inventory;
  active: number;
  lastActive: number;
  wpn: WeaponRuntime;
  /** İmha ediyor (sunucu belirler; hareket kilitli). */
  defusing: boolean;
  /** Sonsuz mermi (antrenman). */
  infiniteAmmo: boolean;
}

export function createWeaponRuntime(): WeaponRuntime {
  return {
    nextAttack: 0,
    nextAttack2: 0,
    reloadEnd: 0,
    shellReloading: false,
    deployEnd: 0,
    silencerEnd: 0,
    recoilIndex: 0,
    accuracyPenalty: 0,
    lastShotTime: -10,
    zoom: 0,
    resumeZoom: 0,
    burstLeft: 0,
    nextBurst: 0,
    aimPunch: { p: 0, y: 0 },
    aimPunchVel: { p: 0, y: 0 },
    viewPunch: { p: 0, y: 0 },
    pinPulled: false,
    throwStrength: 1,
    knifeChain: 0,
    plantProgress: 0,
    inspectEnd: 0,
    shotCounter: 0,
  };
}

export function emptyInventory(): Inventory {
  return { primary: null, secondary: null, grenades: GRENADE_KEYS.map(() => 0), c4: false, defuser: false };
}

export function createPlayerSim(id: number, team: Team, origin: Vec3 = vec3()): PlayerSim {
  return {
    id,
    team,
    alive: false,
    move: createMoveState(origin),
    time: 0,
    health: 100,
    armor: 0,
    helmet: false,
    inv: emptyInventory(),
    active: ITEM_KNIFE,
    lastActive: ITEM_KNIFE,
    wpn: createWeaponRuntime(),
    defusing: false,
    infiniteAmmo: false,
  };
}

export function clonePlayerSim(p: PlayerSim): PlayerSim {
  return {
    ...p,
    move: cloneMoveState(p.move),
    inv: {
      primary: p.inv.primary ? { ...p.inv.primary } : null,
      secondary: p.inv.secondary ? { ...p.inv.secondary } : null,
      grenades: p.inv.grenades.slice(),
      c4: p.inv.c4,
      defuser: p.inv.defuser,
    },
    wpn: {
      ...p.wpn,
      aimPunch: { ...p.wpn.aimPunch },
      aimPunchVel: { ...p.wpn.aimPunchVel },
      viewPunch: { ...p.wpn.viewPunch },
    },
  };
}

export function makeWeaponItem(def: WeaponDef): WeaponItem {
  return {
    num: def.num,
    clip: def.clip,
    reserve: def.reserve,
    silencer: def.silencer === 'detachable',
    burst: false,
  };
}

/** Aktif yuvadaki silah tanımı. */
export function activeDef(p: PlayerSim): WeaponDef {
  return itemDef(p, p.active) ?? KNIFE;
}

export function itemDef(p: PlayerSim, item: number): WeaponDef | null {
  switch (item) {
    case ITEM_PRIMARY:
      return p.inv.primary ? weaponByNum(p.inv.primary.num)! : null;
    case ITEM_SECONDARY:
      return p.inv.secondary ? weaponByNum(p.inv.secondary.num)! : null;
    case ITEM_KNIFE:
      return KNIFE;
    case ITEM_C4:
      return p.inv.c4 ? C4 : null;
    default:
      if (item >= ITEM_GRENADE0 && item < ITEM_GRENADE0 + GRENADE_KEYS.length) {
        const gi = item - ITEM_GRENADE0;
        return p.inv.grenades[gi]! > 0 ? WEAPON_BY_KEY[GRENADE_KEYS[gi]!]! : null;
      }
      return null;
  }
}

export function activeItem(p: PlayerSim): WeaponItem | null {
  if (p.active === ITEM_PRIMARY) return p.inv.primary;
  if (p.active === ITEM_SECONDARY) return p.inv.secondary;
  return null;
}

export function hasItem(p: PlayerSim, item: number): boolean {
  return itemDef(p, item) !== null;
}

export function weaponMode(p: PlayerSim, def: WeaponDef, item: WeaponItem | null): WeaponMode {
  if (def.silencer === 'detachable') return item?.silencer ? 1 : 0;
  if (def.zoomLevels > 0) return p.wpn.zoom > 0 ? 1 : 0;
  if (def.burst) return item?.burst ? 1 : 0;
  return 0;
}

/** Silahın şu anki modda izin verdiği azami hız. */
export function currentMaxSpeed(p: PlayerSim): number {
  const def = activeDef(p);
  const mode = def.zoomLevels > 0 && p.wpn.zoom > 0 ? 1 : 0;
  return def.maxSpeed[mode];
}

export function eyePosition(p: PlayerSim): Vec3 {
  return { x: p.move.origin.x, y: p.move.origin.y, z: p.move.origin.z + eyeHeight(p.move) };
}

/** Bir sonraki/ilk kullanılabilir silah (öldükten, bomba atınca vb.). */
export function bestItem(p: PlayerSim): number {
  if (p.inv.primary) return ITEM_PRIMARY;
  if (p.inv.secondary) return ITEM_SECONDARY;
  return ITEM_KNIFE;
}

// ───────────────────────── olaylar ─────────────────────────

export interface ShotEvent {
  kind: 'shot';
  weapon: number;
  mode: WeaponMode;
  origin: Vec3;
  dirs: Vec3[];
  seed: number;
  /** Subtick kesri (0..1) ya da -1. */
  fireFrac: number;
  silenced: boolean;
}
export interface MeleeEvent {
  kind: 'melee';
  heavy: boolean;
  first: boolean;
  origin: Vec3;
  dir: Vec3;
}
export interface ThrowEvent {
  kind: 'throw';
  grenade: number; // GRENADE_KEYS indeksi
  origin: Vec3;
  velocity: Vec3;
}
export interface PlantEvent {
  kind: 'plant';
  origin: Vec3;
}
export interface SimpleEvent {
  kind: 'reload' | 'dryfire' | 'deploy' | 'zoom' | 'silencer' | 'burstmode' | 'jump' | 'land' | 'inspect' | 'pin' | 'plantstart';
  value?: number;
}
export type SimEvent = ShotEvent | MeleeEvent | ThrowEvent | PlantEvent | SimpleEvent;

export interface SimEnv {
  world: World;
  entities?: readonly EntityBox[];
  /** Freeze time vb.: hareket yok, ateş yok. */
  frozen: boolean;
  /** Bomba kurulabilir mi (round live). */
  canPlant: boolean;
  /** Ateş edilebilir mi (freeze time'da hayır). */
  canAttack: boolean;
}

const SILENCER_TIME = 3.0;
const PLANT_TIME = 3.2;
const GRENADE_THROW_DELAY = 0.1;

/**
 * Bir kullanıcı komutunu oyuncuya uygular. Deterministik: aynı durum + aynı komut =
 * aynı sonuç. Olaylar (atış, bomba atma, kurma) çağırana döner.
 */
export function simulateCmd(p: PlayerSim, cmd: UserCmd, env: SimEnv): SimEvent[] {
  const events: SimEvent[] = [];
  if (!p.alive) {
    p.move.oldButtons = cmd.buttons;
    return events;
  }
  const dt = TICK_DT;
  const now = p.time;
  const w = p.wpn;
  const pressed = cmd.buttons & ~p.move.oldButtons;

  // silah değiştirme
  if (cmd.weapon !== ITEM_NONE && cmd.weapon !== p.active && hasItem(p, cmd.weapon)) {
    switchTo(p, cmd.weapon, now);
    events.push({ kind: 'deploy', value: cmd.weapon });
  }
  // aktif silah kalmadıysa (bomba atıldı)
  if (!hasItem(p, p.active)) switchTo(p, bestItem(p), now);

  const planting = p.active === ITEM_C4 && w.plantProgress > 0;
  const frozen = env.frozen || planting || p.defusing;

  const ev = playerMove(p.move, cmd, {
    world: env.world,
    entities: env.entities,
    selfId: p.id,
    maxSpeed: currentMaxSpeed(p),
    frozen,
    dt,
  });

  const def = activeDef(p);
  const item = activeItem(p);
  const mode = weaponMode(p, def, item);

  if (ev.jumped) {
    w.accuracyPenalty += def.inaccuracyJumpInitial;
    events.push({ kind: 'jump' });
  }
  if (ev.landed > 0) {
    w.accuracyPenalty += def.inaccuracyLand[mode] * ev.landed;
    events.push({ kind: 'land', value: ev.landed });
  }

  // punch sönümü
  decayPunch(w.aimPunch, w.aimPunchVel, w.viewPunch, dt);

  // isabet cezası toparlanma
  const reloading = w.reloadEnd > 0 || w.shellReloading;
  w.accuracyPenalty = updateAccuracyPenalty(def, mode, w.accuracyPenalty, p.move.ducked, reloading, w.recoilIndex, dt);

  // recoil indeksi sönümü (tam otomatik ateşte sönmez)
  if (now > w.lastShotTime + def.cycleTime[mode] * 1.1 && w.recoilIndex > 0) {
    const decay = Math.log(10) / Math.max(0.05, def.recoveryTimeStand);
    w.recoilIndex = w.recoilIndex * Math.exp(-dt * decay);
    if (w.recoilIndex < 0.01) w.recoilIndex = 0;
  }

  // silah fazlarını yürüt
  if (def.category === 'knife') knifeFrame(p, cmd, env, now, pressed, events);
  else if (def.category === 'grenade') grenadeFrame(p, cmd, env, now, events);
  else if (def.category === 'c4') c4Frame(p, cmd, env, now, events);
  else gunFrame(p, cmd, env, now, pressed, def, item!, events);

  if (pressed & IN_INSPECT && now >= w.deployEnd && w.reloadEnd === 0) {
    w.inspectEnd = now + 3.5;
    events.push({ kind: 'inspect' });
  }
  if (cmd.buttons & (IN_ATTACK | IN_ATTACK2 | IN_RELOAD)) w.inspectEnd = 0;

  p.time = now + dt;
  void IN_SPEED;
  void IN_USE;
  return events;
}

function switchTo(p: PlayerSim, item: number, now: number) {
  const w = p.wpn;
  if (p.active !== item) p.lastActive = p.active;
  p.active = item;
  const def = itemDef(p, item) ?? KNIFE;
  w.deployEnd = now + (def.category === 'grenade' ? 0.6 : def.category === 'knife' ? 0.6 : def.deployTime);
  w.nextAttack = Math.max(w.nextAttack, w.deployEnd);
  w.reloadEnd = 0;
  w.shellReloading = false;
  w.zoom = 0;
  w.resumeZoom = 0;
  w.burstLeft = 0;
  w.silencerEnd = 0;
  w.pinPulled = false;
  w.plantProgress = 0;
  w.inspectEnd = 0;
  w.recoilIndex = 0;
}

function gunFrame(
  p: PlayerSim,
  cmd: UserCmd,
  env: SimEnv,
  now: number,
  pressed: number,
  def: WeaponDef,
  item: WeaponItem,
  events: SimEvent[],
) {
  const w = p.wpn;

  // susturucu takma/çıkarma bitti mi
  if (w.silencerEnd > 0 && now >= w.silencerEnd) {
    item.silencer = !item.silencer;
    w.silencerEnd = 0;
  }

  // normal şarjör doldurma
  if (w.reloadEnd > 0 && now >= w.reloadEnd) {
    const need = def.clip - item.clip;
    const take = p.infiniteAmmo ? need : Math.min(need, item.reserve);
    item.clip += take;
    if (!p.infiniteAmmo) item.reserve -= take;
    w.reloadEnd = 0;
  }
  // pompalı fişek doldurma
  if (w.shellReloading) {
    if ((cmd.buttons & IN_ATTACK && item.clip > 0) || item.clip >= def.clip || (item.reserve <= 0 && !p.infiniteAmmo)) {
      w.shellReloading = false;
    } else if (now >= w.nextAttack) {
      item.clip += 1;
      if (!p.infiniteAmmo) item.reserve -= 1;
      w.nextAttack = now + def.reloadTime;
      events.push({ kind: 'reload', value: 1 });
    }
  }

  // AWP: atış sonrası otomatik tekrar zoom
  if (w.resumeZoom > 0 && now >= w.nextAttack) {
    w.zoom = w.resumeZoom;
    w.resumeZoom = 0;
  }

  if (now < w.deployEnd) return;

  // burst devam ediyor mu
  if (w.burstLeft > 0 && now >= w.nextBurst) {
    if (item.clip > 0) {
      fireGun(p, cmd, now, def, item, 1, events);
      w.burstLeft--;
      w.nextBurst = now + def.timeBetweenBurstShots;
    } else {
      w.burstLeft = 0;
    }
  }

  // ikincil
  if (pressed & IN_ATTACK2 && now >= w.nextAttack2 && w.silencerEnd === 0) {
    if (def.zoomLevels > 0 && w.reloadEnd === 0) {
      w.zoom = (w.zoom + 1) % (def.zoomLevels + 1);
      w.resumeZoom = 0;
      w.nextAttack2 = now + 0.3;
      events.push({ kind: 'zoom', value: w.zoom });
    } else if (def.silencer === 'detachable' && w.reloadEnd === 0) {
      w.silencerEnd = now + SILENCER_TIME;
      w.nextAttack = Math.max(w.nextAttack, w.silencerEnd);
      w.nextAttack2 = w.silencerEnd;
      events.push({ kind: 'silencer', value: item.silencer ? 0 : 1 });
    } else if (def.burst) {
      item.burst = !item.burst;
      w.nextAttack2 = now + 0.3;
      events.push({ kind: 'burstmode', value: item.burst ? 1 : 0 });
    }
  }

  // ateş
  const reloadingNow = w.reloadEnd > 0;
  if (cmd.buttons & IN_ATTACK && env.canAttack && !reloadingNow && w.silencerEnd === 0 && now >= w.nextAttack) {
    const newPress = (pressed & IN_ATTACK) !== 0;
    if (item.clip <= 0) {
      if (newPress) {
        events.push({ kind: 'dryfire' });
        w.nextAttack = now + 0.2;
        if (item.reserve > 0 || p.infiniteAmmo) startReload(p, def, item, now, events);
      }
    } else if (def.fullAuto || newPress) {
      const mode = weaponMode(p, def, item);
      if (def.burst && item.burst) {
        fireGun(p, cmd, now, def, item, 1, events);
        w.burstLeft = 2;
        w.nextBurst = now + def.timeBetweenBurstShots;
        w.nextAttack = now + def.cycleTimeBurst;
      } else {
        fireGun(p, cmd, now, def, item, mode, events);
        w.nextAttack = now + def.cycleTime[mode];
      }
      if (w.shellReloading) w.shellReloading = false;
    }
  }

  // şarjör
  if (pressed & IN_RELOAD && w.reloadEnd === 0 && !w.shellReloading && w.burstLeft === 0) {
    if (item.clip < def.clip && (item.reserve > 0 || p.infiniteAmmo)) startReload(p, def, item, now, events);
  }
  // otomatik doldurma: şarjör boşalınca
  if (item.clip === 0 && w.reloadEnd === 0 && !w.shellReloading && w.burstLeft === 0 && (item.reserve > 0 || p.infiniteAmmo) && now >= w.nextAttack) {
    if (!(cmd.buttons & IN_ATTACK)) startReload(p, def, item, now, events);
  }
}

function startReload(p: PlayerSim, def: WeaponDef, item: WeaponItem, now: number, events: SimEvent[]) {
  const w = p.wpn;
  if (w.zoom > 0) {
    w.zoom = 0;
    w.resumeZoom = 0;
  }
  if (def.shellReload) {
    w.shellReloading = true;
    // başlangıç animasyonu
    w.nextAttack = now + 0.45;
  } else {
    w.reloadEnd = now + def.reloadTime;
    w.nextAttack = w.reloadEnd;
  }
  w.recoilIndex = 0;
  events.push({ kind: 'reload', value: 0 });
  void item;
}

function fireGun(p: PlayerSim, cmd: UserCmd, now: number, def: WeaponDef, item: WeaponItem, mode: WeaponMode, events: SimEvent[]) {
  const w = p.wpn;
  const m = p.move;
  const inaccuracy = getInaccuracy(def, mode, w.accuracyPenalty, {
    speed2d: Math.hypot(m.velocity.x, m.velocity.y),
    vz: m.velocity.z,
    onGround: m.onGround,
    ducked: m.ducked,
    walking: (cmd.buttons & IN_SPEED) !== 0,
  });
  // Zoomsuz keskin nişancı tüfeği çok isabetsizdir (vdata mode 0 değerleri bunu içerir).
  const scale = recoilCvars.weapon_recoil_scale;
  const pitch = cmd.pitch + w.aimPunch.p * scale;
  const yaw = cmd.yaw + w.aimPunch.y * scale;
  const seed = hashSeed(p.id, cmd.seq, w.shotCounter++);
  const dirs = spreadDirections(seed, pitch, yaw, inaccuracy, def.spread[mode], def.numBullets);
  events.push({
    kind: 'shot',
    weapon: def.num,
    mode,
    origin: eyePosition(p),
    dirs,
    seed,
    fireFrac: cmd.fireFrac === 255 ? -1 : cmd.fireFrac / 254,
    silenced: (def.silencer === 'detachable' && item.silencer) || def.silencer === 'integrated',
  });

  item.clip -= 1;
  w.lastShotTime = now;
  w.accuracyPenalty += def.inaccuracyFire[mode];
  applyRecoil(def, mode, w.recoilIndex, w.aimPunchVel, w.viewPunch);
  w.recoilIndex += 1;
  w.inspectEnd = 0;
  if (def.unzoomsAfterShot && w.zoom > 0) {
    w.resumeZoom = w.zoom;
    w.zoom = 0;
  }
}

function knifeFrame(p: PlayerSim, cmd: UserCmd, env: SimEnv, now: number, pressed: number, events: SimEvent[]) {
  const w = p.wpn;
  if (now < w.deployEnd || !env.canAttack) return;
  const { forward } = angleVectors(cmd.pitch, cmd.yaw);
  const origin = eyePosition(p);
  if (cmd.buttons & IN_ATTACK && now >= w.nextAttack) {
    const first = now - w.lastShotTime > 0.6;
    w.knifeChain = first ? 0 : w.knifeChain + 1;
    events.push({ kind: 'melee', heavy: false, first, origin, dir: forward });
    w.nextAttack = now + 0.5;
    w.nextAttack2 = now + 0.5;
    w.lastShotTime = now;
  } else if (cmd.buttons & IN_ATTACK2 && now >= w.nextAttack2) {
    events.push({ kind: 'melee', heavy: true, first: true, origin, dir: forward });
    w.nextAttack = now + 1.1;
    w.nextAttack2 = now + 1.1;
    w.lastShotTime = now;
  }
  void pressed;
}

function grenadeFrame(p: PlayerSim, cmd: UserCmd, env: SimEnv, now: number, events: SimEvent[]) {
  const w = p.wpn;
  if (now < w.deployEnd) return;
  const held = cmd.buttons & (IN_ATTACK | IN_ATTACK2);
  if (!w.pinPulled) {
    if (held && env.canAttack && now >= w.nextAttack) {
      w.pinPulled = true;
      events.push({ kind: 'pin' });
    }
    return;
  }
  // pim çekili: güç ayarı
  const a1 = (cmd.buttons & IN_ATTACK) !== 0;
  const a2 = (cmd.buttons & IN_ATTACK2) !== 0;
  if (a1 && a2) w.throwStrength = 0.5;
  else if (a1) w.throwStrength = 1;
  else if (a2) w.throwStrength = 0;
  if (held) return;

  // bırakıldı → at
  const gi = p.active - ITEM_GRENADE0;
  const pitch = cmd.pitch + w.aimPunch.p * recoilCvars.weapon_recoil_scale;
  const thr = computeThrow(p, pitch, cmd.yaw, w.throwStrength, env.world);
  events.push({ kind: 'throw', grenade: gi, origin: thr.origin, velocity: thr.velocity });
  p.inv.grenades[gi] = Math.max(0, p.inv.grenades[gi]! - 1);
  w.pinPulled = false;
  w.throwStrength = 1;
  w.nextAttack = now + GRENADE_THROW_DELAY + 0.4;
  if (p.inv.grenades[gi]! > 0) {
    // aynı türden bir tane daha var: yeniden çek
    w.deployEnd = now + 0.6;
  } else {
    switchTo(p, p.lastActive !== p.active && hasItem(p, p.lastActive) ? p.lastActive : bestItem(p), now);
  }
}

/**
 * CS atış hesabı (CBaseCSGrenade::EmitGrenade): bakış açısı ufukta 10° yukarı eğilir,
 * hız 750*0.9 × lerp(0.3, 1, güç), oyuncu hızının 1.25 katı eklenir.
 */
export function computeThrow(p: PlayerSim, pitchIn: number, yaw: number, strength: number, world: World): { origin: Vec3; velocity: Vec3 } {
  let pitch = pitchIn;
  if (pitch < 90) pitch = -10 + pitch * ((90 + 10) / 90);
  const sp = Math.sin(pitch * DEG2RAD);
  const cp = Math.cos(pitch * DEG2RAD);
  const fwd = { x: cp * Math.cos(yaw * DEG2RAD), y: cp * Math.sin(yaw * DEG2RAD), z: -sp };
  let vel = 750 * 0.9;
  vel *= 0.3 + (1 - 0.3) * strength;
  const eye = eyePosition(p);
  const src = { x: eye.x, y: eye.y, z: eye.z + strength * 12 - 12 };
  const end = { x: src.x + fwd.x * 22, y: src.y + fwd.y * 22, z: src.z + fwd.z * 22 };
  const tr = world.traceHull(src, end, { x: -2, y: -2, z: -2 }, { x: 2, y: 2, z: 2 }, 1);
  const origin =
    tr.fraction < 1
      ? { x: src.x + (end.x - src.x) * tr.fraction * 0.9, y: src.y + (end.y - src.y) * tr.fraction * 0.9, z: src.z + (end.z - src.z) * tr.fraction * 0.9 }
      : end;
  const mv = p.move.velocity;
  return { origin, velocity: { x: fwd.x * vel + mv.x * 1.25, y: fwd.y * vel + mv.y * 1.25, z: fwd.z * vel + mv.z * 1.25 } };
}

function c4Frame(p: PlayerSim, cmd: UserCmd, env: SimEnv, now: number, events: SimEvent[]) {
  const w = p.wpn;
  if (now < w.deployEnd) return;
  const inSite = env.world.inTrigger(p.move.origin, 'bombsite') !== null;
  if (cmd.buttons & IN_ATTACK && env.canPlant && p.move.onGround && inSite) {
    if (w.plantProgress === 0) events.push({ kind: 'plantstart' });
    w.plantProgress += TICK_DT;
    if (w.plantProgress >= PLANT_TIME) {
      events.push({ kind: 'plant', origin: { ...p.move.origin } });
      p.inv.c4 = false;
      w.plantProgress = 0;
      switchTo(p, bestItem(p), now);
    }
  } else {
    w.plantProgress = 0;
  }
}

export const PLANT_DURATION = PLANT_TIME;

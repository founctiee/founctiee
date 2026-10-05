import raw from './weapons.generated.json';

export type Category = 'pistol' | 'smg' | 'heavy' | 'rifle' | 'sniper' | 'knife' | 'grenade' | 'c4';
export type Slot = 'primary' | 'secondary' | 'knife' | 'grenade' | 'c4';
export type TeamRestrict = 'T' | 'CT' | 'any';
export type Pair = [number, number];

export interface WeaponDef {
  /** Valve sınıf adı, ör. weapon_ak47 */
  className: string;
  /** Ağ için sayısal kimlik. */
  num: number;
  key: string;
  name: string;
  category: Category;
  slot: Slot;
  team: TeamRestrict;
  price: number;
  killAward: number;
  damage: number;
  armorRatio: number;
  penetration: number;
  range: number;
  rangeModifier: number;
  headshotMultiplier: number;
  cycleTime: Pair;
  fullAuto: boolean;
  numBullets: number;
  clip: number;
  /** Yedek mermi (fişek). */
  reserve: number;
  maxSpeed: Pair;
  spread: Pair;
  inaccuracyCrouch: Pair;
  inaccuracyStand: Pair;
  inaccuracyJump: Pair;
  inaccuracyLand: Pair;
  inaccuracyLadder: Pair;
  inaccuracyFire: Pair;
  inaccuracyMove: Pair;
  inaccuracyJumpInitial: number;
  inaccuracyReload: number;
  recoveryTimeCrouch: number;
  recoveryTimeStand: number;
  recoveryTimeCrouchFinal: number;
  recoveryTimeStandFinal: number;
  recoveryTransitionStart: number;
  recoveryTransitionEnd: number;
  recoilAngle: Pair;
  recoilAngleVariance: Pair;
  recoilMagnitude: Pair;
  recoilMagnitudeVariance: Pair;
  recoilSeed: number;
  deployTime: number;
  reloadTime: number;
  /** Pompalılar fişek fişek doldurur. */
  shellReload: boolean;
  silencer: 'none' | 'detachable' | 'integrated';
  burst: boolean;
  cycleTimeBurst: number;
  timeBetweenBurstShots: number;
  zoomLevels: number;
  zoomFov: [number, number];
  zoomTime: number;
  unzoomsAfterShot: boolean;
  flinchLarge: number;
  flinchSmall: number;
  tracerFrequency: number;
}

interface RawWeapon {
  [k: string]: number | boolean | string | number[] | undefined;
}

const RAW = (raw as unknown as { weapons: Record<string, RawWeapon> }).weapons;

function pair(v: unknown, fallback = 0): Pair {
  if (Array.isArray(v)) return [Number(v[0] ?? fallback), Number(v[1] ?? v[0] ?? fallback)];
  if (typeof v === 'number') return [v, v];
  return [fallback, fallback];
}
function num(v: unknown, fallback = 0): number {
  return typeof v === 'number' ? v : Array.isArray(v) ? Number(v[0]) : fallback;
}

interface CatalogEntry {
  className: string;
  key: string;
  name: string;
  category: Category;
  team: TeamRestrict;
}

/** Oyunda kullanılan silahlar (sıra = ağ kimliği). */
const CATALOG: CatalogEntry[] = [
  { className: 'weapon_knife', key: 'knife', name: 'Bıçak', category: 'knife', team: 'any' },
  { className: 'weapon_c4', key: 'c4', name: 'C4', category: 'c4', team: 'T' },
  // tabancalar
  { className: 'weapon_glock', key: 'glock', name: 'Glock-18', category: 'pistol', team: 'T' },
  { className: 'weapon_usp_silencer', key: 'usp_silencer', name: 'USP-S', category: 'pistol', team: 'CT' },
  { className: 'weapon_hkp2000', key: 'hkp2000', name: 'P2000', category: 'pistol', team: 'CT' },
  { className: 'weapon_p250', key: 'p250', name: 'P250', category: 'pistol', team: 'any' },
  { className: 'weapon_tec9', key: 'tec9', name: 'Tec-9', category: 'pistol', team: 'T' },
  { className: 'weapon_fiveseven', key: 'fiveseven', name: 'Five-SeveN', category: 'pistol', team: 'CT' },
  { className: 'weapon_cz75a', key: 'cz75a', name: 'CZ75-Auto', category: 'pistol', team: 'any' },
  { className: 'weapon_deagle', key: 'deagle', name: 'Desert Eagle', category: 'pistol', team: 'any' },
  // SMG
  { className: 'weapon_mac10', key: 'mac10', name: 'MAC-10', category: 'smg', team: 'T' },
  { className: 'weapon_mp9', key: 'mp9', name: 'MP9', category: 'smg', team: 'CT' },
  { className: 'weapon_mp7', key: 'mp7', name: 'MP7', category: 'smg', team: 'any' },
  { className: 'weapon_mp5sd', key: 'mp5sd', name: 'MP5-SD', category: 'smg', team: 'any' },
  { className: 'weapon_ump45', key: 'ump45', name: 'UMP-45', category: 'smg', team: 'any' },
  { className: 'weapon_p90', key: 'p90', name: 'P90', category: 'smg', team: 'any' },
  { className: 'weapon_bizon', key: 'bizon', name: 'PP-Bizon', category: 'smg', team: 'any' },
  // ağır
  { className: 'weapon_nova', key: 'nova', name: 'Nova', category: 'heavy', team: 'any' },
  { className: 'weapon_xm1014', key: 'xm1014', name: 'XM1014', category: 'heavy', team: 'any' },
  { className: 'weapon_sawedoff', key: 'sawedoff', name: 'Sawed-Off', category: 'heavy', team: 'T' },
  { className: 'weapon_mag7', key: 'mag7', name: 'MAG-7', category: 'heavy', team: 'CT' },
  { className: 'weapon_m249', key: 'm249', name: 'M249', category: 'heavy', team: 'any' },
  { className: 'weapon_negev', key: 'negev', name: 'Negev', category: 'heavy', team: 'any' },
  // tüfekler
  { className: 'weapon_galilar', key: 'galilar', name: 'Galil AR', category: 'rifle', team: 'T' },
  { className: 'weapon_famas', key: 'famas', name: 'FAMAS', category: 'rifle', team: 'CT' },
  { className: 'weapon_ak47', key: 'ak47', name: 'AK-47', category: 'rifle', team: 'T' },
  { className: 'weapon_m4a1', key: 'm4a1', name: 'M4A4', category: 'rifle', team: 'CT' },
  { className: 'weapon_m4a1_silencer', key: 'm4a1_silencer', name: 'M4A1-S', category: 'rifle', team: 'CT' },
  { className: 'weapon_sg556', key: 'sg556', name: 'SG 553', category: 'rifle', team: 'T' },
  { className: 'weapon_aug', key: 'aug', name: 'AUG', category: 'rifle', team: 'CT' },
  { className: 'weapon_ssg08', key: 'ssg08', name: 'SSG 08', category: 'sniper', team: 'any' },
  { className: 'weapon_awp', key: 'awp', name: 'AWP', category: 'sniper', team: 'any' },
  { className: 'weapon_g3sg1', key: 'g3sg1', name: 'G3SG1', category: 'sniper', team: 'T' },
  { className: 'weapon_scar20', key: 'scar20', name: 'SCAR-20', category: 'sniper', team: 'CT' },
  // bombalar
  { className: 'weapon_hegrenade', key: 'hegrenade', name: 'El Bombası', category: 'grenade', team: 'any' },
  { className: 'weapon_flashbang', key: 'flashbang', name: 'Flaş Bombası', category: 'grenade', team: 'any' },
  { className: 'weapon_smokegrenade', key: 'smokegrenade', name: 'Sis Bombası', category: 'grenade', team: 'any' },
  { className: 'weapon_molotov', key: 'molotov', name: 'Molotof', category: 'grenade', team: 'T' },
  { className: 'weapon_incgrenade', key: 'incgrenade', name: 'Yangın Bombası', category: 'grenade', team: 'CT' },
  { className: 'weapon_decoy', key: 'decoy', name: 'Tuzak Bombası', category: 'grenade', team: 'any' },
];

function slotFor(c: Category): Slot {
  switch (c) {
    case 'pistol':
      return 'secondary';
    case 'knife':
      return 'knife';
    case 'grenade':
      return 'grenade';
    case 'c4':
      return 'c4';
    default:
      return 'primary';
  }
}

function build(entry: CatalogEntry, index: number): WeaponDef {
  const w = RAW[entry.className];
  if (!w) throw new Error(`weapons.vdata içinde yok: ${entry.className}`);
  const clip = num(w.iMaxClip1);
  const reserveRaw = num(w.nPrimaryReserveAmmoMax);
  const reserve = w.bReserveAmmoAsClips ? reserveRaw * clip : reserveRaw;
  const sil = String(w.eSilencerType ?? 'WEAPONSILENCER_NONE');
  const shellReload = entry.key === 'nova' || entry.key === 'xm1014' || entry.key === 'sawedoff';
  return {
    className: entry.className,
    num: index,
    key: entry.key,
    name: entry.name,
    category: entry.category,
    slot: slotFor(entry.category),
    team: entry.team,
    price: num(w.nPrice),
    killAward: num(w.nKillAward, 300),
    damage: num(w.nDamage),
    armorRatio: num(w.flArmorRatio, 1),
    penetration: num(w.flPenetration, 1),
    range: num(w.flRange, 8192),
    rangeModifier: num(w.flRangeModifier, 0.98),
    headshotMultiplier: num(w.flHeadshotMultiplier, 4),
    cycleTime: pair(w.flCycleTime, 0.15),
    fullAuto: Boolean(w.bIsFullAuto),
    numBullets: num(w.nNumBullets, 1),
    clip,
    reserve,
    maxSpeed: pair(w.flMaxSpeed, 250),
    spread: pair(w.flSpread),
    inaccuracyCrouch: pair(w.flInaccuracyCrouch),
    inaccuracyStand: pair(w.flInaccuracyStand),
    inaccuracyJump: pair(w.flInaccuracyJump),
    inaccuracyLand: pair(w.flInaccuracyLand),
    inaccuracyLadder: pair(w.flInaccuracyLadder),
    inaccuracyFire: pair(w.flInaccuracyFire),
    inaccuracyMove: pair(w.flInaccuracyMove),
    inaccuracyJumpInitial: num(w.flInaccuracyJumpInitial),
    inaccuracyReload: num(w.flInaccuracyReload),
    recoveryTimeCrouch: num(w.flRecoveryTimeCrouch, 1),
    recoveryTimeStand: num(w.flRecoveryTimeStand, 1),
    recoveryTimeCrouchFinal: num(w.flRecoveryTimeCrouchFinal, -1),
    recoveryTimeStandFinal: num(w.flRecoveryTimeStandFinal, -1),
    recoveryTransitionStart: num(w.nRecoveryTransitionStartBullet, 0),
    recoveryTransitionEnd: num(w.nRecoveryTransitionEndBullet, 0),
    recoilAngle: pair(w.flRecoilAngle),
    recoilAngleVariance: pair(w.flRecoilAngleVariance),
    recoilMagnitude: pair(w.flRecoilMagnitude),
    recoilMagnitudeVariance: pair(w.flRecoilMagnitudeVariance),
    recoilSeed: num(w.nRecoilSeed, 0),
    deployTime: num(w.flDeployDuration, 1),
    reloadTime: num(w.flDisallowAttackAfterReloadStartDuration, 2.5),
    shellReload,
    silencer: sil.includes('DETACHABLE') ? 'detachable' : sil.includes('INTEGRATED') ? 'integrated' : 'none',
    burst: Boolean(w.bHasBurstMode),
    cycleTimeBurst: num(w.flCycleTimeWhenInBurstMode),
    timeBetweenBurstShots: num(w.flTimeBetweenBurstShots),
    zoomLevels: num(w.nZoomLevels),
    zoomFov: [num(w.nZoomFOV1, 90), num(w.nZoomFOV2, 90)],
    zoomTime: num(w.flZoomTime0, 0.05),
    unzoomsAfterShot: Boolean(w.bUnzoomsAfterShot),
    flinchLarge: num(w.flFlinchVelocityModifierLarge, 0.4),
    flinchSmall: num(w.flFlinchVelocityModifierSmall, 0.55),
    tracerFrequency: num(w.nTracerFrequency, 1),
  };
}

export const WEAPONS: WeaponDef[] = CATALOG.map(build);
export const WEAPON_BY_KEY: Record<string, WeaponDef> = Object.fromEntries(WEAPONS.map((w) => [w.key, w]));

export function weaponByNum(n: number): WeaponDef | undefined {
  return WEAPONS[n];
}
export function weapon(key: string): WeaponDef {
  const w = WEAPON_BY_KEY[key];
  if (!w) throw new Error(`bilinmeyen silah ${key}`);
  return w;
}

export const KNIFE = weapon('knife');
export const C4 = weapon('c4');

/** Bombalar: envanterde sayı olarak tutulur. Sıra ağda kullanılır. */
export const GRENADE_KEYS = ['hegrenade', 'flashbang', 'smokegrenade', 'molotov', 'incgrenade', 'decoy'] as const;
export type GrenadeKey = (typeof GRENADE_KEYS)[number];
export const GRENADE_LIMITS: Record<GrenadeKey, number> = {
  hegrenade: 1,
  flashbang: 2,
  smokegrenade: 1,
  molotov: 1,
  incgrenade: 1,
  decoy: 1,
};
export const MAX_GRENADES = 4;

/** Silah değiştirme/silah yuvası kodları (UserCmd.weapon). */
export const ITEM_PRIMARY = 0;
export const ITEM_SECONDARY = 1;
export const ITEM_KNIFE = 2;
/** 3..8: GRENADE_KEYS sırası */
export const ITEM_GRENADE0 = 3;
export const ITEM_C4 = 9;
export const ITEM_NONE = 255;

/** Silah hangi modda: 0 normal, 1 alternatif (susturucu takılı / scope / burst). */
export type WeaponMode = 0 | 1;

/** Ekipman fiyatları (CS2). */
export const EQUIPMENT_PRICES = {
  vest: 650,
  vesthelm: 1000,
  helmetOnly: 350,
  defuser: 400,
};

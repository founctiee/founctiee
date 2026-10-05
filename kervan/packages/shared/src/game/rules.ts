/** Wingman maç kuralları ve CS2 ekonomi değerleri. */

export interface MatchSettings {
  /** Normal süredeki toplam round (MR8 → 16). */
  maxRounds: number;
  roundTime: number;
  freezeTime: number;
  buyTime: number;
  c4Timer: number;
  defuseTime: number;
  defuseTimeKit: number;
  startMoney: number;
  maxMoney: number;
  overtime: boolean;
  /** Overtime'daki toplam round (MR2 → 4). */
  otMaxRounds: number;
  otStartMoney: number;
  friendlyFire: boolean;
  ffBulletScale: number;
  ffGrenadeScale: number;
  warmupMoney: number;
  warmupRespawn: number;
  roundEndDelay: number;
  halftimeDuration: number;
  /** Antrenman: sınırsız para/mermi, round yok. */
  practice: boolean;
  /** Antrenman: mermi izlerini göster. */
  showImpacts: boolean;
}

export const DEFAULT_SETTINGS: MatchSettings = {
  maxRounds: 16,
  roundTime: 115,
  freezeTime: 15,
  buyTime: 20,
  c4Timer: 40,
  defuseTime: 10,
  defuseTimeKit: 5,
  startMoney: 800,
  maxMoney: 16000,
  overtime: true,
  otMaxRounds: 4,
  otStartMoney: 8000,
  friendlyFire: true,
  ffBulletScale: 0.33,
  ffGrenadeScale: 0.85,
  warmupMoney: 16000,
  warmupRespawn: 2,
  roundEndDelay: 6,
  halftimeDuration: 10,
  practice: false,
  showImpacts: false,
};

export const ECONOMY = {
  winElimination: 3250,
  winBombExploded: 3500,
  winBombDefused: 3500,
  winTime: 3250,
  /** Ardışık kayıp bonusu (CS2). */
  lossBonus: [1400, 1900, 2400, 2900, 3400],
  /** Bomba kuruldu ama round kaybedildi: T takımına ek. */
  plantedLossBonus: 800,
  plantReward: 300,
  defuseReward: 300,
  teamKillPenalty: -300,
};

export enum Phase {
  Warmup = 0,
  Freeze = 1,
  Live = 2,
  RoundEnd = 3,
  Halftime = 4,
  MatchEnd = 5,
}

export enum RoundEndReason {
  None = 0,
  TerroristsEliminated = 1,
  CTsEliminated = 2,
  BombExploded = 3,
  BombDefused = 4,
  TimeRanOut = 5,
  Draw = 6,
}

export enum BombState {
  Carried = 0,
  Dropped = 1,
  Planted = 2,
  Defused = 3,
  Exploded = 4,
}

export const BOMB_RADIUS = 1750;
export const BOMB_DAMAGE = 500;

/** C4 patlama hasarı (CS: gaussian düşüş, sigma = yarıçap/3). */
export function bombDamageAt(distance: number): number {
  const sigma = BOMB_RADIUS / 3;
  return BOMB_DAMAGE * Math.exp(-(distance * distance) / (2 * sigma * sigma));
}

/** Kayıp sayacına göre kayıp bonusu. */
export function lossBonus(lossStreak: number): number {
  const i = Math.max(0, Math.min(ECONOMY.lossBonus.length - 1, lossStreak - 1));
  return ECONOMY.lossBonus[i]!;
}

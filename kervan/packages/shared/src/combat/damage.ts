/** CS hasar formülleri: mesafe düşüşü, bölge çarpanı, zırh. */
import { HitGroup } from './hitboxes';
import type { WeaponDef } from '../weapons/data';

export function hitgroupMultiplier(group: HitGroup, headshotMultiplier: number): number {
  switch (group) {
    case HitGroup.Head:
      return headshotMultiplier;
    case HitGroup.Stomach:
      return 1.25;
    case HitGroup.LeftLeg:
    case HitGroup.RightLeg:
      return 0.75;
    default:
      return 1;
  }
}

export function rangeAttenuation(rangeModifier: number, distance: number): number {
  return Math.pow(rangeModifier, distance / 500);
}

export interface ArmorResult {
  /** Cana giden hasar (tam sayı). */
  health: number;
  /** Zırhtan düşen puan. */
  armor: number;
}

/** Zırh hesabı (CS:GO/CS2 OnTakeDamage). */
export function applyArmor(damage: number, armorRatio: number, group: HitGroup, armor: number, helmet: boolean): ArmorResult {
  let dmg = damage;
  let armorLost = 0;
  const protectedGroup = group !== HitGroup.LeftLeg && group !== HitGroup.RightLeg && (group !== HitGroup.Head || helmet);
  if (armor > 0 && protectedGroup) {
    const bonus = 0.5;
    const ratio = armorRatio * 0.5;
    let newDmg = dmg * ratio;
    armorLost = (dmg - newDmg) * bonus;
    if (armorLost > armor) {
      armorLost = armor;
      newDmg = dmg - armorLost / bonus;
    }
    dmg = newDmg;
  }
  return { health: Math.floor(dmg), armor: Math.floor(armorLost) };
}

/** Bir mermi vuruşunun nihai hasarı (zırhtan önceki). */
export function bulletDamage(def: WeaponDef, currentDamage: number, distance: number, group: HitGroup): number {
  return currentDamage * rangeAttenuation(def.rangeModifier, distance) * hitgroupMultiplier(group, def.headshotMultiplier);
}

/** Düşme hasarı (CS: 580 u/s üstü). */
export function fallDamage(fallSpeed: number): number {
  const safe = 580;
  const fatal = 1024;
  if (fallSpeed <= safe) return 0;
  return Math.max(0, Math.round((fallSpeed - safe) * (100 / (fatal - safe))));
}

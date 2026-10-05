import { describe, it, expect } from 'vitest';
import {
  weapon,
  applyArmor,
  HitGroup,
  hitgroupMultiplier,
  generateRecoilTable,
  World,
  boxBrush,
  Mat,
  createPlayerSim,
  Team,
  makeWeaponItem,
  ITEM_PRIMARY,
  ITEM_SECONDARY,
  simulateCmd,
  emptyCmd,
  IN_ATTACK,
  IN_RELOAD,
  ShotEvent,
  traceBullet,
  makeHitTarget,
  PlayerSim,
  UserCmd,
  decayPunch,
  applyRecoil,
  TICK_DT,
} from '../src';

const floor = () => new World([boxBrush({ x: -4096, y: -4096, z: -64 }, { x: 4096, y: 4096, z: 0 }, Mat.Concrete)]);

function armed(key: string): PlayerSim {
  const p = createPlayerSim(1, Team.T, { x: 0, y: 0, z: 0 });
  p.alive = true;
  const def = weapon(key);
  if (def.slot === 'primary') {
    p.inv.primary = makeWeaponItem(def);
    p.active = ITEM_PRIMARY;
  } else {
    p.inv.secondary = makeWeaponItem(def);
    p.active = ITEM_SECONDARY;
  }
  return p;
}

function tick(p: PlayerSim, w: World, buttons: number, seq: number): ReturnType<typeof simulateCmd> {
  const cmd: UserCmd = { ...emptyCmd(seq), buttons };
  return simulateCmd(p, cmd, { world: w, frozen: false, canAttack: true, canPlant: false });
}

describe('CS2 hasar değerleri', () => {
  it('AK-47 kasklı kafa = 111, zırhsız kafa = 144', () => {
    const ak = weapon('ak47');
    const dmg = ak.damage * hitgroupMultiplier(HitGroup.Head, ak.headshotMultiplier);
    expect(applyArmor(dmg, ak.armorRatio, HitGroup.Head, 100, true).health).toBe(111);
    expect(applyArmor(dmg, ak.armorRatio, HitGroup.Head, 100, false).health).toBe(144);
  });
  it('M4A4 kasklı kafa = 92', () => {
    const m4 = weapon('m4a1');
    expect(m4.name).toBe('M4A4');
    const dmg = m4.damage * hitgroupMultiplier(HitGroup.Head, m4.headshotMultiplier);
    expect(applyArmor(dmg, m4.armorRatio, HitGroup.Head, 100, true).health).toBe(92);
  });
  it('AWP zırhsız kafa = 460, zırhlı göğüs 112', () => {
    const awp = weapon('awp');
    expect(awp.damage * hitgroupMultiplier(HitGroup.Head, awp.headshotMultiplier)).toBe(460);
    expect(applyArmor(awp.damage, awp.armorRatio, HitGroup.Chest, 100, true).health).toBe(112);
  });
  it('bacakta zırh etkisiz', () => {
    const ak = weapon('ak47');
    const d = ak.damage * hitgroupMultiplier(HitGroup.LeftLeg, 4);
    expect(applyArmor(d, ak.armorRatio, HitGroup.LeftLeg, 100, true).health).toBe(27);
  });
  it('fiyatlar ve şarjör', () => {
    expect(weapon('ak47').price).toBe(2700);
    expect(weapon('ak47').reserve).toBe(90);
    expect(weapon('awp').price).toBe(4750);
    expect(weapon('nova').reserve).toBe(32);
  });
});

describe('recoil', () => {
  it('tablo deterministik ve 64 elemanlı', () => {
    const a = generateRecoilTable(weapon('ak47'), 0);
    const b = generateRecoilTable(weapon('ak47'), 0);
    expect(a.length).toBe(64);
    expect(a).toEqual(b);
    // farklı seed farklı desen
    expect(generateRecoilTable(weapon('m4a1'), 0)).not.toEqual(a);
  });

  it('AK spreyi önce yukarı tırmanır, sonra yana gider', () => {
    const ak = weapon('ak47');
    const aim = { p: 0, y: 0 };
    const vel = { p: 0, y: 0 };
    const view = { p: 0, y: 0 };
    const samples: { p: number; y: number }[] = [];
    let idx = 0;
    for (let t = 0; t < 64 * 3; t++) {
      if (t % 6 === 0 && idx < 30) {
        samples.push({ p: aim.p * 2, y: aim.y * 2 });
        applyRecoil(ak, 0, idx++, vel, view);
      }
      decayPunch(aim, vel, view, TICK_DT);
    }
    // 10. mermide belirgin dikey sapma (yukarı = negatif pitch)
    expect(samples[9]!.p).toBeLessThan(-3);
    expect(samples[9]!.p).toBeGreaterThan(-20);
  });
});

describe('silah simülasyonu', () => {
  it('AK dakikada ~600 mermi atar', () => {
    const w = floor();
    const p = armed('ak47');
    let shots = 0;
    for (let i = 0; i < 64 * 2; i++) {
      const ev = tick(p, w, i > 70 ? IN_ATTACK : 0, i);
      shots += ev.filter((e) => e.kind === 'shot').length;
    }
    // deploy bitti, ~58 tick ateş → ~9-10 mermi
    expect(shots).toBeGreaterThanOrEqual(9);
    expect(shots).toBeLessThanOrEqual(10);
    expect(p.inv.primary!.clip).toBe(30 - shots);
  });

  it('yarı otomatik silah her tıkta bir mermi', () => {
    const w = floor();
    const p = armed('glock');
    let shots = 0;
    for (let i = 0; i < 64 * 3; i++) shots += tick(p, w, i > 70 ? IN_ATTACK : 0, i).filter((e) => e.kind === 'shot').length;
    expect(shots).toBe(1);
  });

  it('şarjör değiştirme süresi sonunda mermi dolar', () => {
    const w = floor();
    const p = armed('ak47');
    p.inv.primary!.clip = 5;
    for (let i = 0; i < 70; i++) tick(p, w, 0, i);
    tick(p, w, IN_RELOAD, 70);
    const reloadTicks = Math.ceil(weapon('ak47').reloadTime / TICK_DT) + 2;
    for (let i = 0; i < reloadTicks; i++) tick(p, w, 0, 71 + i);
    expect(p.inv.primary!.clip).toBe(30);
    expect(p.inv.primary!.reserve).toBe(65);
  });

  it('ilk mermi neredeyse tam isabet (duran AK)', () => {
    const w = floor();
    const p = armed('ak47');
    let shot: ShotEvent | undefined;
    for (let i = 0; i < 80 && !shot; i++) {
      const ev = tick(p, w, i >= 70 ? IN_ATTACK : 0, i);
      shot = ev.find((e): e is ShotEvent => e.kind === 'shot');
    }
    expect(shot).toBeDefined();
    const d = shot!.dirs[0]!;
    // yaw=0 pitch=0 → +x yönü; sapma < 0.01 rad
    expect(Math.hypot(d.y, d.z)).toBeLessThan(0.01);
  });
});

describe('mermi ve wallbang', () => {
  it('ahşap kasadan geçer ama hasar düşer; kalın betonda durur', () => {
    const w = new World([
      boxBrush({ x: 200, y: -50, z: 0 }, { x: 208, y: 50, z: 100 }, Mat.Wood),
      boxBrush({ x: 600, y: -50, z: 0 }, { x: 664, y: 50, z: 100 }, Mat.Concrete),
    ]);
    const ak = weapon('ak47');
    const target = makeHitTarget(2, 2, { origin: { x: 400, y: 0, z: 0 }, yaw: 180, duckAmount: 0 });
    const r = traceBullet(w, { x: 0, y: 0, z: 50 }, { x: 1, y: 0, z: 0 }, ak, [target], 1);
    expect(r.hits.length).toBe(1);
    expect(r.hits[0]!.penetrated).toBe(1);
    expect(r.hits[0]!.damage).toBeLessThan(36);
    expect(r.hits[0]!.damage).toBeGreaterThan(15);
    // betonu delemez
    const target2 = makeHitTarget(3, 2, { origin: { x: 800, y: 0, z: 0 }, yaw: 180, duckAmount: 0 });
    const r2 = traceBullet(w, { x: 500, y: 0, z: 50 }, { x: 1, y: 0, z: 0 }, ak, [target2], 1);
    expect(r2.hits.length).toBe(0);
  });

  it('kafaya nişan alınca kafa grubu', () => {
    const w = new World([]);
    const tg = makeHitTarget(2, 2, { origin: { x: 500, y: 0, z: 0 }, yaw: 180, duckAmount: 0 });
    const r = traceBullet(w, { x: 0, y: 0, z: 64 }, { x: 1, y: 0, z: 0 }, weapon('ak47'), [tg], 1);
    expect(r.hits[0]!.group).toBe(HitGroup.Head);
    const r2 = traceBullet(w, { x: 0, y: 4.5, z: 10 }, { x: 1, y: 0, z: 0 }, weapon('ak47'), [tg], 1);
    expect([HitGroup.LeftLeg, HitGroup.RightLeg]).toContain(r2.hits[0]!.group);
  });
});

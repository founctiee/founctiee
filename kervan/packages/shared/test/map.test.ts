import { describe, it, expect } from 'vitest';
import { buildKervan, World, createMoveState, playerMove, emptyCmd, TICK_DT, HULL_MINS, HULL_MAXS, MASK_PLAYERSOLID, fillSmoke, spawnInferno } from '../src';

describe('de_kervan', () => {
  const map = buildKervan();
  const world = new World(map.brushes, map.triggers);

  it('makul sayıda brush üretir', () => {
    expect(map.brushes.length).toBeGreaterThan(40);
    expect(map.brushes.length).toBeLessThan(400);
  });

  it('doğuş noktaları boş ve zeminde', () => {
    for (const sp of [...map.spawns.T, ...map.spawns.CT]) {
      const tr = world.traceHull(sp.pos, sp.pos, HULL_MINS, HULL_MAXS, MASK_PLAYERSOLID);
      expect(tr.startsolid).toBe(false);
      const s = createMoveState({ ...sp.pos, z: sp.pos.z + 2 });
      for (let i = 0; i < 10; i++) playerMove(s, emptyCmd(i), { world, selfId: 0, maxSpeed: 250, frozen: false, dt: TICK_DT });
      expect(s.onGround).toBe(true);
    }
  });

  it('bomba bölgesi ve satın alma alanları', () => {
    expect(world.inTrigger({ x: -600, y: 800, z: 10 }, 'bombsite')).not.toBeNull();
    expect(world.inTrigger(map.spawns.T[0]!.pos, 'buyzone_t')).not.toBeNull();
    expect(world.inTrigger(map.spawns.CT[0]!.pos, 'buyzone_ct')).not.toBeNull();
  });

  it('smoke açık alanda dolar, duvardan taşmaz', () => {
    const v = fillSmoke(world, 1, { x: -600, y: 800, z: 2 }, 0);
    expect(v.count).toBeGreaterThan(1500);
    const t0 = performance.now();
    fillSmoke(world, 2, { x: -1375, y: -500, z: 2 }, 0);
    expect(performance.now() - t0).toBeLessThan(400);
  });

  it('molotof alevleri yayılır', () => {
    const inf = spawnInferno(world, 3, 1, 1, { x: 400, y: 0, z: 10 }, 0);
    expect(inf.flames.length).toBeGreaterThan(8);
  });
});

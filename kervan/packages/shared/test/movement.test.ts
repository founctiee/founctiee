import { describe, it, expect } from 'vitest';
import {
  World,
  boxBrush,
  Mat,
  createMoveState,
  playerMove,
  emptyCmd,
  IN_FORWARD,
  IN_JUMP,
  IN_DUCK,
  TICK_DT,
  UserCmd,
  MoveState,
} from '../src';

function flatWorld(extra: ReturnType<typeof boxBrush>[] = []) {
  return new World([boxBrush({ x: -4096, y: -4096, z: -64 }, { x: 4096, y: 4096, z: 0 }, Mat.Concrete), ...extra]);
}

function run(
  world: World,
  s: MoveState,
  ticks: number,
  buttons: number | ((t: number, s: MoveState) => number),
  maxSpeed = 250,
  yaw = 0,
) {
  const trace: MoveState[] = [];
  for (let t = 0; t < ticks; t++) {
    const cmd: UserCmd = { ...emptyCmd(t), buttons: typeof buttons === 'function' ? buttons(t, s) : buttons, yaw };
    playerMove(s, cmd, { world, selfId: 0, maxSpeed, frozen: false, dt: TICK_DT });
    trace.push({ ...s, origin: { ...s.origin }, velocity: { ...s.velocity } });
  }
  return trace;
}

describe('CS2 hareket fiziği', () => {
  it('yere oturur ve bıçakla 250 u/s hıza ulaşır', () => {
    const w = flatWorld();
    const s = createMoveState({ x: 0, y: 0, z: 1 });
    run(w, s, 4, 0);
    expect(s.onGround).toBe(true);
    expect(s.origin.z).toBeCloseTo(0, 1);
    const tr = run(w, s, 128, IN_FORWARD);
    const speed = Math.hypot(s.velocity.x, s.velocity.y);
    expect(speed).toBeCloseTo(250, 0);
    // tam hıza ~0.5 sn içinde ulaşılır
    const t90 = tr.findIndex((st) => Math.hypot(st.velocity.x, st.velocity.y) > 225);
    expect(t90).toBeGreaterThan(5);
    expect(t90).toBeLessThan(40);
  });

  it('AK-47 ile 215 u/s', () => {
    const w = flatWorld();
    const s = createMoveState({ x: 0, y: 0, z: 0 });
    run(w, s, 200, IN_FORWARD, 215);
    expect(Math.hypot(s.velocity.x, s.velocity.y)).toBeCloseTo(215, 0);
  });

  it('zıplama tepesi ~57 birim', () => {
    const w = flatWorld();
    const s = createMoveState({ x: 0, y: 0, z: 0 });
    run(w, s, 4, 0);
    let maxZ = 0;
    const tr = run(w, s, 80, (t) => (t === 0 ? IN_JUMP : 0));
    for (const st of tr) maxZ = Math.max(maxZ, st.origin.z);
    expect(maxZ).toBeGreaterThan(54);
    expect(maxZ).toBeLessThan(58.5);
    expect(s.onGround).toBe(true);
  });

  it('basılı tutulan zıplama tuşu tekrar zıplatmaz', () => {
    const w = flatWorld();
    const s = createMoveState({ x: 0, y: 0, z: 0 });
    run(w, s, 4, 0);
    const tr = run(w, s, 160, IN_JUMP);
    const landedAgainAndJumped = tr.slice(70).some((st) => st.origin.z > 10);
    expect(landedAgainAndJumped).toBe(false);
  });

  it('18 birimlik basamağa çıkar, 19 birimliğe çıkamaz', () => {
    const step18 = flatWorld([boxBrush({ x: 100, y: -200, z: 0 }, { x: 1400, y: 200, z: 18 }, Mat.Concrete)]);
    const s = createMoveState({ x: 0, y: 0, z: 0 });
    run(step18, s, 120, IN_FORWARD);
    expect(s.origin.x).toBeGreaterThan(150);
    expect(s.origin.z).toBeCloseTo(18, 0);

    const step19 = flatWorld([boxBrush({ x: 100, y: -200, z: 0 }, { x: 1400, y: 200, z: 19 }, Mat.Concrete)]);
    const s2 = createMoveState({ x: 0, y: 0, z: 0 });
    run(step19, s2, 120, IN_FORWARD);
    expect(s2.origin.x).toBeLessThan(100);
    expect(s2.origin.z).toBeCloseTo(0, 0);
  });

  it('duvara çarpınca durur ve içinden geçmez', () => {
    const w = flatWorld([boxBrush({ x: 200, y: -500, z: 0 }, { x: 232, y: 500, z: 200 }, Mat.Concrete)]);
    const s = createMoveState({ x: 0, y: 0, z: 0 });
    run(w, s, 200, IN_FORWARD);
    expect(s.origin.x).toBeLessThanOrEqual(200 - 16);
    expect(s.origin.x).toBeGreaterThan(200 - 17);
  });

  it('duvara açılı koşunca duvar boyunca kayar', () => {
    const w = flatWorld([boxBrush({ x: 200, y: -2000, z: 0 }, { x: 232, y: 2000, z: 200 }, Mat.Concrete)]);
    const s = createMoveState({ x: 150, y: 0, z: 0 });
    run(w, s, 64, IN_FORWARD, 250, 45);
    expect(s.origin.y).toBeGreaterThan(80);
    expect(s.origin.x).toBeLessThanOrEqual(184);
  });

  it('çömelince 54 birimlik boşluktan geçer, ayakta geçemez', () => {
    // 60u yüksekliğinde tavan
    const w = flatWorld([boxBrush({ x: 100, y: -200, z: 60 }, { x: 300, y: 200, z: 120 }, Mat.Concrete)]);
    const s = createMoveState({ x: 0, y: 0, z: 0 });
    run(w, s, 120, IN_FORWARD);
    expect(s.origin.x).toBeLessThan(100);
    const s2 = createMoveState({ x: 0, y: 0, z: 0 });
    run(w, s2, 300, IN_FORWARD | IN_DUCK);
    expect(s2.origin.x).toBeGreaterThan(300);
  });

  it('çömelik hız 215*0.34 civarı', () => {
    const w = flatWorld();
    const s = createMoveState({ x: 0, y: 0, z: 0 });
    run(w, s, 200, IN_FORWARD | IN_DUCK, 215);
    expect(Math.hypot(s.velocity.x, s.velocity.y)).toBeCloseTo(215 * 0.34, 0);
  });

  it('havada çömelerek daha yükseğe çıkılır (crouch jump)', () => {
    // 62 birimlik kasa: normal zıplamayla çıkılmaz, crouch-jump ile çıkılır
    const crate = () => flatWorld([boxBrush({ x: 150, y: -100, z: 0 }, { x: 400, y: 100, z: 62 }, Mat.Wood)]);
    let jumpedAt = -1;
    const input = (duck: boolean) => (t: number, st: MoveState) => {
      let b = IN_FORWARD;
      if (jumpedAt < 0 && st.origin.x >= 50) jumpedAt = t;
      if (jumpedAt >= 0 && t - jumpedAt < 2) b |= IN_JUMP;
      if (duck && jumpedAt >= 0 && t - jumpedAt >= 1 && t - jumpedAt < 50) b |= IN_DUCK;
      return b;
    };
    const s = createMoveState({ x: -100, y: 0, z: 0 });
    run(crate(), s, 100, input(false));
    expect(s.origin.z).toBeLessThan(10);

    jumpedAt = -1;
    const s2 = createMoveState({ x: -100, y: 0, z: 0 });
    run(crate(), s2, 100, input(true));
    expect(s2.origin.z).toBeCloseTo(62, 0);
  });

  it('rampadan yukarı yürünür', async () => {
    const { rampBrush } = await import('../src');
    const w = flatWorld([
      rampBrush({ x: 100, y: -200, z: 0 }, { x: 400, y: 200, z: 100 }, '+x', Mat.Concrete),
      boxBrush({ x: 400, y: -200, z: 0 }, { x: 1200, y: 200, z: 100 }, Mat.Concrete),
    ]);
    const s = createMoveState({ x: 0, y: 0, z: 0 });
    run(w, s, 128, IN_FORWARD);
    expect(s.origin.x).toBeGreaterThan(400);
    expect(s.origin.z).toBeCloseTo(100, 0);
    expect(s.onGround).toBe(true);
  });
});

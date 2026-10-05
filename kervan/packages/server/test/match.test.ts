import { describe, it, expect } from 'vitest';
import {
  buildKervan,
  Team,
  Phase,
  BombState,
  emptyCmd,
  UserCmd,
  ITEM_C4,
  ITEM_NONE,
  ITEM_PRIMARY,
  IN_ATTACK,
  IN_USE,
  RoundEndReason,
  ServerMsg,
  TICK_RATE,
  weapon,
  makeWeaponItem,
  vectorAngles,
  eyePosition,
} from '@kervan/shared';
import { Match, Conn } from '../src/match';

class FakeConn implements Conn {
  json: ServerMsg[] = [];
  bins = 0;
  sendBinary() {
    this.bins++;
  }
  sendJSON(m: ServerMsg) {
    this.json.push(m);
  }
  bufferedAmount() {
    return 0;
  }
  events(kind: string) {
    return this.json.flatMap((m) => (m.t === 'ev' ? m.list.filter((e) => e.e === kind) : []));
  }
}

function setup() {
  const map = buildKervan();
  const m = new Match(map, { freezeTime: 1, roundEndDelay: 1 });
  const ct = new FakeConn();
  const tt = new FakeConn();
  const a = m.addPlayer('Ali', tt, 'a');
  const b = m.addPlayer('Berk', ct, 'b');
  expect(a.team).toBe(Team.T);
  expect(b.team).toBe(Team.CT);
  return { m, a, b, tt, ct };
}

let seq = 1;
/** Her tick bir komut besleyip simülasyonu ilerletir (gerçek istemci gibi). */
function feed(m: Match, id: number, n: number, mk: (i: number) => Partial<UserCmd>) {
  for (let i = 0; i < n; i++) {
    m.handleCmds(id, [{ ...emptyCmd(seq++), weapon: ITEM_NONE, renderTick: m.tick, ...mk(i) }]);
    m.step();
  }
}
function run(m: Match, ticks: number) {
  for (let i = 0; i < ticks; i++) m.step();
}

describe('Wingman maç akışı', () => {
  it('ısınmada iki oyuncu doğar, maç başlar ve freeze → live geçilir', () => {
    const { m, a, b } = setup();
    expect(a.alive && b.alive).toBe(true);
    m.startMatch();
    expect(m.phase).toBe(Phase.Freeze);
    expect(a.money).toBe(800);
    run(m, TICK_RATE + 2);
    expect(m.phase).toBe(Phase.Live);
  });

  it('satın alma: para yetmezse reddedilir, yeterse alınır', () => {
    const { m, a, tt } = setup();
    m.startMatch();
    m.handleMessage(a.id, { t: 'buy', item: 'ak47' });
    run(m, 1);
    expect(a.sim.inv.primary).toBeNull();
    expect(tt.events('notice').some((e) => 'text' in e && e.text.includes('Yetersiz'))).toBe(true);
    m.handleMessage(a.id, { t: 'buy', item: 'p250' });
    expect(a.sim.inv.secondary?.num).toBe(weapon('p250').num);
    expect(a.money).toBe(500);
  });

  it('C4 kurulur, CT imha eder, CT kazanır ve ekonomi işler', () => {
    const { m, a, b } = setup();
    m.startMatch();
    run(m, TICK_RATE + 2);
    expect(a.sim.inv.c4).toBe(true);
    // T'yi bölgeye ışınla
    a.sim.move.origin = { x: -600, y: 600, z: 1 };
    run(m, 4);
    feed(m, a.id, 2, () => ({ weapon: ITEM_C4 }));
    feed(m, a.id, TICK_RATE * 6, () => ({ buttons: IN_ATTACK, weapon: ITEM_C4 }));
    expect(m.bomb.state).toBe(BombState.Planted);
    expect(a.money).toBe(800 + 300);
    // CT bombanın yanına gelip E'ye basılı tutar
    const bp = m.bomb.pos;
    b.sim.move.origin = { x: bp.x + 30, y: bp.y, z: 1 };
    run(m, 4);
    const eye = eyePosition(b.sim);
    const ang = vectorAngles({ x: bp.x - eye.x, y: bp.y - eye.y, z: bp.z - eye.z });
    feed(m, b.id, TICK_RATE * 11, () => ({ buttons: IN_USE, yaw: ang.yaw, pitch: ang.pitch }));
    expect(m.bomb.state).toBe(BombState.Defused);
    expect(m.scoreCT).toBe(1);
    expect(m.lastReason).toBe(RoundEndReason.BombDefused);
    // CT: 800 + 3500 (imha galibiyeti) + 300 (imha)
    expect(b.money).toBe(800 + 3500 + 300);
    // T: kayıp bonusu 1400 + kurma bonusu 800 (+ 300 kurma ödülü önceden)
    expect(a.money).toBe(800 + 300 + 1400 + 800);
    run(m, Math.round(TICK_RATE * 0.5));
    expect(m.phase).toBe(Phase.Freeze);
    expect(m.round).toBe(2);
    expect(a.alive && b.alive).toBe(true);
  });

  it('AK ile kafaya ateş: kasksız CT tek mermide ölür, T kazanır', () => {
    const { m, a, b, ct } = setup();
    m.startMatch();
    run(m, TICK_RATE + 2);
    a.sim.inv.primary = makeWeaponItem(weapon('ak47'));
    // açık alanda karşılıklı yerleştir (Orta)
    a.sim.move.origin = { x: 450, y: -300, z: 1 };
    b.sim.move.origin = { x: 450, y: 200, z: 1 };
    feed(m, a.id, 80, () => ({ weapon: ITEM_PRIMARY }));
    const eye = eyePosition(a.sim);
    const yawB = (b.lastCmd.yaw * Math.PI) / 180;
    const head = { x: b.sim.move.origin.x + 1.5 * Math.cos(yawB), y: b.sim.move.origin.y + 1.5 * Math.sin(yawB), z: b.sim.move.origin.z + 64 };
    const ang = vectorAngles({ x: head.x - eye.x, y: head.y - eye.y, z: head.z - eye.z });
    feed(m, a.id, 3, (i) => ({ buttons: i === 1 ? IN_ATTACK : 0, yaw: ang.yaw, pitch: ang.pitch }));
    expect(b.alive).toBe(false);
    const kills = ct.events('kill');
    expect(kills.length).toBe(1);
    expect(kills[0]).toMatchObject({ k: a.id, v: b.id, hs: true });
    expect(m.lastReason).toBe(RoundEndReason.CTsEliminated);
    expect(m.scoreT).toBe(1);
    expect(a.money).toBe(800 + 300 + 3250);
  });
});

describe('bombalar ve maç sonu', () => {
  it('HE atılır, patlar ve yakındaki rakibe hasar verir; sis oluşur', () => {
    const { m, a, b, ct } = setup();
    m.startMatch();
    run(m, TICK_RATE + 2);
    a.sim.inv.grenades[0] = 1; // HE
    a.sim.inv.grenades[2] = 1; // sis
    a.sim.move.origin = { x: 450, y: -300, z: 1 };
    b.sim.move.origin = { x: 450, y: 0, z: 1 };
    // HE'yi seç, yere doğru (B'nin ayağına) bak, at
    feed(m, a.id, 50, () => ({ weapon: 3, yaw: 90, pitch: 10 }));
    feed(m, a.id, 4, () => ({ buttons: IN_ATTACK, yaw: 90, pitch: 10 }));
    feed(m, a.id, 2, () => ({ yaw: 90, pitch: 10 }));
    expect(m.grenades.length).toBe(1);
    run(m, TICK_RATE * 2);
    expect(m.grenades.length).toBe(0);
    expect(b.sim.health).toBeLessThan(100);
    expect(ct.events('nade_det').length).toBe(1);
    // sis
    feed(m, a.id, 50, () => ({ weapon: 5, yaw: 90, pitch: 0 }));
    feed(m, a.id, 4, () => ({ buttons: IN_ATTACK, yaw: 90, pitch: 0 }));
    feed(m, a.id, 2, () => ({ yaw: 90, pitch: 0 }));
    run(m, TICK_RATE * 4);
    expect(m.smokes.size).toBe(1);
    expect(ct.events('smoke').length).toBe(1);
  });

  it('8 round sonra taraf değişir, 9 alan maçı kazanır', () => {
    const { m, a, b } = setup();
    const mm = m as unknown as { endRound(w: Team, r: RoundEndReason): void; afterRound(): void };
    m.startMatch();
    for (let r = 0; r < 8; r++) {
      m.phase = Phase.Live;
      mm.endRound(Team.T, RoundEndReason.CTsEliminated);
      mm.afterRound();
    }
    expect(m.phase).toBe(Phase.Halftime);
    // A (T idi) artık CT; skor da onunla gider
    expect(a.team).toBe(Team.CT);
    expect(b.team).toBe(Team.T);
    expect(m.scoreCT).toBe(8);
    expect(a.money).toBe(800);
    run(m, TICK_RATE * 10 + 10);
    expect(m.phase).toBe(Phase.Freeze);
    m.phase = Phase.Live;
    mm.endRound(Team.CT, RoundEndReason.TerroristsEliminated);
    mm.afterRound();
    expect(m.phase).toBe(Phase.MatchEnd);
  });

  it('8-8 olursa uzatma başlar ($8000)', () => {
    const { m, a } = setup();
    const mm = m as unknown as { endRound(w: Team, r: RoundEndReason): void; afterRound(): void };
    m.startMatch();
    for (let r = 0; r < 16; r++) {
      m.phase = Phase.Live;
      mm.endRound(r % 2 ? Team.T : Team.CT, RoundEndReason.TimeRanOut);
      mm.afterRound();
      if ((m.phase as Phase) === Phase.Halftime) run(m, TICK_RATE * 11);
    }
    expect(m.scoreT + m.scoreCT).toBe(16);
    expect(m.overtimeCount).toBe(1);
    expect(a.money).toBe(8000);
  });
});

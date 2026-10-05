import { describe, it, expect, beforeEach } from 'vitest';
import {
  buildKervan,
  Team,
  emptyCmd,
  UserCmd,
  ITEM_NONE,
  ITEM_PRIMARY,
  IN_ATTACK,
  ServerMsg,
  TICK_RATE,
  weapon,
  makeWeaponItem,
  vectorAngles,
  eyePosition,
  Reader,
  decodeSnapshot,
  Snapshot,
  MASK_SHOT,
  fillSmoke,
  SMOKE_DURATION,
  simulateCmd,
  readPlayerSim,
  Vec3,
  ShotEvent,
  GameEvent,
} from '@kervan/shared';
import { Match, Conn, ServerPlayer } from '../src/match';
import { Room } from '../src/rooms';

class FakeConn implements Conn {
  json: ServerMsg[] = [];
  last: Uint8Array | null = null;
  closed = false;
  sendBinary(d: Uint8Array) {
    this.last = d.slice();
  }
  sendJSON(m: ServerMsg) {
    this.json.push(m);
  }
  close() {
    this.closed = true;
  }
  bufferedAmount() {
    return 0;
  }
  snap(): Snapshot {
    const r = new Reader(this.last!);
    r.u8();
    return decodeSnapshot(r);
  }
  ents(): number[] {
    return this.snap().entities.map((e) => e.id);
  }
  events(kind: string): GameEvent[] {
    return this.json.flatMap((m) => (m.t === 'ev' ? m.list.filter((e) => e.e === kind) : []));
  }
  state() {
    return [...this.json].reverse().find((m) => m.t === 'state') as Extract<ServerMsg, { t: 'state' }>;
  }
}

/** T doğuşu açık alanı; CT doğuşu çok uzakta, duvarların arkasında. */
const T_POS = { x: -150, y: -1300, z: 1 };
const OPEN_POS = { x: 150, y: -1100, z: 1 };
const FAR_POS = { x: 900, y: 1050, z: 1 };

/** Gerçek istemci gibi oyuncu başına tick'te bir artan seq. */
const seqs = new Map<number, number>();
const nextSeq = (id: number) => {
  const v = (seqs.get(id) ?? 0) + 1;
  seqs.set(id, v);
  return v;
};
let m: Match;
let room: Room;
let a: ServerPlayer;
let b: ServerPlayer;
let ca: FakeConn;
let cb: FakeConn;

function place(p: ServerPlayer, pos: Vec3) {
  p.sim.move.origin = { ...pos };
  p.sim.move.velocity = { x: 0, y: 0, z: 0 };
}

function cmdFor(p: ServerPlayer, extra: Partial<UserCmd>): UserCmd {
  return { ...emptyCmd(nextSeq(p.id)), weapon: ITEM_NONE, renderTick: m.tick, yaw: p.lastCmd.yaw, pitch: p.lastCmd.pitch, ...extra };
}

/** Bir tick: a'ya komut (verilirse), b boşta. */
function tick(acmd?: Partial<UserCmd>, bcmd?: Partial<UserCmd>) {
  if (m.players.has(a.id)) m.handleCmds(a.id, [cmdFor(a, acmd ?? {})]);
  if (m.players.has(b.id)) m.handleCmds(b.id, [cmdFor(b, bcmd ?? {})]);
  m.step();
  // ping'e anında yanıt (gerçek istemci gibi)
  for (const [p, c] of [
    [a, ca],
    [b, cb],
  ] as const) {
    const ping = c.json.slice(-4).find((j) => j.t === 'ping');
    if (ping?.t === 'ping' && p.lastPingSent === ping.s && m.players.has(p.id)) m.handleMessage(p.id, { t: 'pong', s: ping.s });
  }
}
function ticks(n: number, acmd?: (i: number) => Partial<UserCmd>) {
  for (let i = 0; i < n; i++) tick(acmd?.(i));
}

function anglesTo(from: ServerPlayer, p: Vec3) {
  const eye = eyePosition(from.sim);
  return vectorAngles({ x: p.x - eye.x, y: p.y - eye.y, z: p.z - eye.z });
}
function headOf(p: ServerPlayer): Vec3 {
  const o = p.sim.move.origin;
  return { x: o.x, y: o.y, z: o.z + 64 };
}

function giveAk(p: ServerPlayer) {
  p.sim.inv.primary = makeWeaponItem(weapon('ak47'));
  p.sim.inv.primary.reserve = 900;
}

beforeEach(() => {
  seqs.clear();
  room = new Room('TST-0001', false);
  m = room.match;
  ca = new FakeConn();
  cb = new FakeConn();
  a = m.addPlayer('Ali', ca, 'tok-a');
  b = m.addPlayer('Berk', cb, 'tok-b');
  expect(a.team).toBe(Team.T);
  expect(b.team).toBe(Team.CT);
  // ısınmada kalırlar (rakip öldürülse de yeniden doğar)
  place(a, T_POS);
  place(b, FAR_POS);
  b.god = true;
  ticks(4);
});

describe('görüş sisi ve bilgi süzgeci', () => {
  it('duvar arkasındaki rakip gönderilmez, görüş açılınca gelir', () => {
    ticks(4);
    expect(ca.ents()).not.toContain(b.id);
    expect(cb.ents()).not.toContain(a.id);
    // açık alana ışınla
    const tr = m.world.traceRay({ ...T_POS, z: 65 }, { ...OPEN_POS, z: 65 }, MASK_SHOT);
    expect(tr.fraction).toBe(1);
    place(b, OPEN_POS);
    ticks(4);
    expect(ca.ents()).toContain(b.id);
    // geri gidince histerezis (0.75 sn) sonunda kaybolur
    place(b, FAR_POS);
    ticks(Math.round(TICK_RATE * 0.9));
    expect(ca.ents()).not.toContain(b.id);
  });

  it('sis arkasındaki rakip gönderilmez', () => {
    const mid = { x: (T_POS.x + OPEN_POS.x) / 2, y: (T_POS.y + OPEN_POS.y) / 2, z: 1 };
    const vol = fillSmoke(m.world, 999, mid, m.tick - TICK_RATE * 4);
    m.smokes.set(999, { vol, endTick: m.tick + SMOKE_DURATION * TICK_RATE });
    place(b, OPEN_POS);
    ticks(6);
    expect(ca.ents()).not.toContain(b.id);
    m.smokes.delete(999);
    ticks(4);
    expect(ca.ents()).toContain(b.id);
  });

  it('rakibin can, zırh, para ve silah bilgisi gönderilmez', () => {
    giveAk(b);
    b.money = 4321;
    m.handleMessage(a.id, { t: 'chat', text: 'x', team: false }); // durum yenilensin diye herhangi bir şey
    ticks(40);
    const st = ca.state();
    const enemy = st.players.find((p) => p.id === b.id)!;
    expect(enemy.money).toBe(-1);
    expect(enemy.hp).toBe(-1);
    expect(enemy.armor).toBe(-1);
    expect(enemy.weapon).toBe(0);
    const self = st.players.find((p) => p.id === a.id)!;
    expect(self.hp).toBe(100);
    // CT, bombayı kimin taşıdığını bilmez
    expect(cb.state().bomb.carrier).toBe(-1);
  });
});

describe('gizli spread', () => {
  it('istemcinin tahmin ettiği saçma yönleri sunucunun yönleriyle aynı değil', () => {
    place(b, OPEN_POS);
    a.sim.inv.primary = makeWeaponItem(weapon('nova'));
    ticks(TICK_RATE, () => ({ weapon: ITEM_PRIMARY }));
    expect(ca.ents()).toContain(b.id);
    // istemcinin elindeki bilgiyle tahmin (snapshot'taki yerel durum + aynı komut)
    const local = readPlayerSimFrom(ca);
    const cmd = cmdFor(a, { buttons: IN_ATTACK });
    const evs = simulateCmd(local, { ...cmd }, { world: m.world, entities: [], frozen: false, canAttack: true, canPlant: false });
    const predicted = (evs.find((e) => e.kind === 'shot') as ShotEvent).dirs;
    seqs.set(a.id, cmd.seq - 1);
    tick({ buttons: IN_ATTACK });
    const shot = cb.events('shot').at(-1) as Extract<GameEvent, { e: 'shot' }>;
    expect(shot.d.length).toBe(predicted.length);
    const maxDiff = Math.max(...shot.d.map((d, i) => Math.hypot(d[0] - predicted[i]!.x, d[1] - predicted[i]!.y, d[2] - predicted[i]!.z)));
    expect(maxDiff).toBeGreaterThan(0.005);
  });
});

function readPlayerSimFrom(c: FakeConn) {
  const r = new Reader(c.last!);
  r.u8();
  r.u32();
  r.u32();
  r.u8();
  expect(r.bool()).toBe(true);
  return readPlayerSim(r);
}

describe('backtrack kilidi', () => {
  it('normal zaman damgası kabul edilir', () => {
    giveAk(a);
    place(b, OPEN_POS);
    ticks(TICK_RATE * 3, () => ({ weapon: ITEM_PRIMARY }));
    ticks(TICK_RATE, () => ({ buttons: IN_ATTACK, renderTick: m.tick - 3 }));
    expect(m.ac.get(a.id, m.tick).backtrackViolations).toBe(0);
    expect(m.players.has(a.id)).toBe(true);
  });

  it('pencere dışı renderTick kırpılır, 5 ihlalde atılır ve yasaklanır', () => {
    giveAk(a);
    place(b, OPEN_POS);
    ticks(TICK_RATE * 3, () => ({ weapon: ITEM_PRIMARY }));
    ticks(TICK_RATE * 2, () => ({ buttons: IN_ATTACK, renderTick: m.tick - 30 }));
    expect(m.players.has(a.id)).toBe(false);
    expect(ca.json.some((j) => j.t === 'kicked' && j.auto)).toBe(true);
    expect(ca.closed).toBe(true);
    expect(room.isBanned('tok-a', '', '')).toBeTruthy();
    expect(cb.events('notice').some((e) => 'text' in e && e.text.includes('hile tespiti'))).toBe(true);
  });

  it('NaN açı → anında atılır', () => {
    m.handleCmds(a.id, [cmdFor(a, { yaw: NaN })]);
    m.step();
    expect(m.players.has(a.id)).toBe(false);
  });
});

describe('nişan analizi', () => {
  /** b görünmez yerden görünür yere ışınlanır; aim fonksiyonu her tick a'nın açısını verir. */
  function engagements(n: number, aim: (k: number, i: number, target: { yaw: number; pitch: number }) => { yaw: number; pitch: number; fire: boolean }) {
    giveAk(a);
    ticks(TICK_RATE * 2, () => ({ weapon: ITEM_PRIMARY }));
    for (let k = 0; k < n && m.players.has(a.id); k++) {
      place(b, FAR_POS);
      const away = { yaw: 30 + k * 7, pitch: 0 };
      ticks(30, () => ({ yaw: away.yaw, pitch: away.pitch }));
      const spot = { x: OPEN_POS.x - 120 + k * 30, y: OPEN_POS.y - 100, z: 1 };
      place(b, spot);
      for (let i = 0; i < 40 && m.players.has(a.id); i++) {
        const t = anglesTo(a, headOf(b));
        const r = aim(k, i, t);
        tick({ yaw: r.yaw, pitch: r.pitch, buttons: r.fire ? IN_ATTACK : 0 });
      }
    }
  }

  it('sentetik aimbot (tek tick sıçrama + kilit + kafa, insanüstü tepki) atılır', () => {
    engagements(10, (_k, i, t) => {
      if (i < 3) return { yaw: 30 + _k * 7, pitch: 0, fire: false };
      return { yaw: t.yaw, pitch: t.pitch, fire: i === 3 };
    });
    expect(m.players.has(a.id)).toBe(false);
    const kicked = ca.json.find((j) => j.t === 'kicked');
    expect(kicked && kicked.t === 'kicked' && kicked.reason).toContain('nişan');
  });

  it('insan benzeri flick (geç tepki, aşma, düzeltme, titreme) atılmaz', () => {
    let rnd = 12345;
    const rand = () => ((rnd = (rnd * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
    engagements(10, (k, i, t) => {
      const start = { yaw: 30 + k * 7, pitch: 0 };
      const react = 13 + (k % 4) * 2; // ~200–300 ms
      if (i < react) return { yaw: start.yaw + rand() * 0.05, pitch: rand() * 0.05, fire: false };
      const u = Math.min(1, (i - react) / 6);
      const ease = 1 - Math.pow(1 - u, 3);
      const over = u < 1 ? 1.08 : 1; // hafif aşma
      const dy = ((t.yaw - start.yaw + 540) % 360) - 180;
      const yaw = start.yaw + dy * ease * over + rand() * 0.25;
      const pitch = t.pitch * ease + rand() * 0.2;
      return { yaw, pitch, fire: i === react + 8 };
    });
    expect(m.players.has(a.id)).toBe(true);
    expect(m.ac.get(a.id, m.tick).score).toBeLessThan(4);
  });

  it('triggerbot (nişan sabitken rakip girdiği anda ateş) işaretlenir', () => {
    giveAk(a);
    ticks(TICK_RATE * 2, () => ({ weapon: ITEM_PRIMARY }));
    for (let k = 0; k < 6; k++) {
      place(b, FAR_POS);
      const spot = { x: OPEN_POS.x - 100 + k * 25, y: OPEN_POS.y, z: 1 };
      // nişan, rakibin geleceği yere sabit
      const eye = eyePosition(a.sim);
      const aim = vectorAngles({ x: spot.x - eye.x, y: spot.y - eye.y, z: spot.z + 60 - eye.z });
      ticks(20, () => ({ yaw: aim.yaw, pitch: aim.pitch }));
      place(b, spot);
      tick({ yaw: aim.yaw, pitch: aim.pitch });
      tick({ yaw: aim.yaw, pitch: aim.pitch, buttons: IN_ATTACK });
      ticks(4, () => ({ yaw: aim.yaw, pitch: aim.pitch }));
    }
    const ac = m.ac.players.get(a.id);
    expect(ac ? ac.signals.has('trigger') : true).toBe(true);
  });

  it('kusursuz sekme telafisi (no-recoil) işaretlenir, normal sprey işaretlenmez', () => {
    giveAk(a);
    ticks(TICK_RATE * 2, () => ({ weapon: ITEM_PRIMARY }));
    const base = { yaw: 200, pitch: 5 };
    const spray = (comp: boolean) => {
      // ~14 mermi (AK 600 atış/dk ≈ 6.4 tick'te bir)
      for (let i = 0; i < 90; i++) {
        let yaw = base.yaw;
        let pitch = base.pitch;
        if (comp) {
          // gelecek atışın punch'ını önceden hesapla (mükemmel hile)
          const clone = structuredClone(a.sim);
          const trial = cmdFor(a, { yaw, pitch, buttons: IN_ATTACK, weapon: ITEM_NONE });
          seqs.set(a.id, trial.seq - 1);
          const ev = simulateCmd(clone, trial, { world: m.world, entities: [], frozen: false, canAttack: true, canPlant: false }).find((e) => e.kind === 'shot') as ShotEvent | undefined;
          if (ev) {
            pitch = base.pitch - ev.punchP * 2;
            yaw = base.yaw - ev.punchY * 2;
          }
        }
        tick({ yaw, pitch, buttons: IN_ATTACK });
      }
      ticks(40, () => ({ yaw: base.yaw, pitch: base.pitch }));
    };
    spray(false);
    expect(m.ac.get(a.id, m.tick).signals.has('norecoil')).toBe(false);
    spray(true);
    expect(m.ac.get(a.id, m.tick).signals.has('norecoil')).toBe(true);
  });
});

describe('bal tuzağı', () => {
  it('duvarın içindeki sahte rakip sadece izleyiciye gider; ona ateş → atılma ve yasak', () => {
    giveAk(a);
    ticks(TICK_RATE * 2, () => ({ weapon: ITEM_PRIMARY, yaw: 90, pitch: 0 }));
    const ac = m.ac.get(a.id, m.tick);
    let fake: Snapshot['entities'][number] | undefined;
    for (let attempt = 0; attempt < 20 && !fake; attempt++) {
      ac.honeypot = null;
      ac.nextHoneypot = m.tick;
      ticks(2, () => ({ yaw: 90, pitch: 0 }));
      fake = ca.snap().entities.find((e) => e.id === b.id);
    }
    expect(fake).toBeDefined();
    // gerçek konum değil ve hull'ın tamamı katı içinde (normal istemcide görünmez)
    expect(Math.hypot(fake!.pos.x - b.sim.move.origin.x, fake!.pos.y - b.sim.move.origin.y)).toBeGreaterThan(100);
    for (const dz of [0, 36, 72]) expect(m.world.pointInSolid({ x: fake!.pos.x, y: fake!.pos.y, z: fake!.pos.z + dz }, MASK_SHOT)).toBeTruthy();
    // CT tarafına gitmez
    expect(cb.ents()).not.toContain(a.id);
    // ESP/aimbot: sahte kafaya nişan al ve ateş et
    const t = anglesTo(a, { x: fake!.pos.x, y: fake!.pos.y, z: fake!.pos.z + 64 });
    tick({ yaw: t.yaw, pitch: t.pitch });
    tick({ yaw: t.yaw, pitch: t.pitch, buttons: IN_ATTACK });
    ticks(2);
    expect(m.players.has(a.id)).toBe(false);
    const k = ca.json.find((j) => j.t === 'kicked');
    expect(k && k.t === 'kicked' && k.reason).toContain('sahte');
    expect(room.isBanned('tok-a', '', '')).toBeTruthy();
    // kanıt demosu
    const demo = m.demo.file('de_kervan', 'TST');
    expect(demo.rounds.some((r) => r.evidenceFor === a.id)).toBe(true);
    expect(demo.rounds.some((r) => r.events.some((e) => e.k === 'honeypot'))).toBe(true);
  });

  it('otomatik atma kapalıyken atılmaz, host bilgilendirilir', () => {
    m.handleMessage(m.host, { t: 'ac_mode', auto: false });
    expect(m.acAuto).toBe(false);
    m.detect(b, 'honeypot', 'test');
    expect(m.players.has(b.id)).toBe(true);
    m.step();
    const host = m.host === a.id ? ca : cb;
    expect(host.events('notice').some((e) => 'text' in e && e.text.includes('Hile şüphesi'))).toBe(true);
  });
});

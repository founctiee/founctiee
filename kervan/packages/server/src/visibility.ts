/**
 * Sunucu tarafı görüş sisi (fog of war). Bir oyuncu, rakibi görüş hattında değilse onun
 * konumunu hiç almaz; böylece wallhack/ESP/radar hileleri gösterecek veri bulamaz.
 *
 * İki ayrı görünürlük tutulur:
 * - "gönderim": ping + hareket kadar ileri bakan, gecikmeli kapanan (geç belirmeyi önler)
 * - "kesin": sadece şu anki göz → şu anki hedef; tepki süresi ölçümü için
 */
import { World, Vec3, MASK_SHOT, SmokeVolume, smokeOpticalDepth, SMOKE_DURATION, SMOKE_FADE, TICK_RATE } from '@kervan/shared';

export interface VisActor {
  id: number;
  team: number;
  alive: boolean;
  origin: Vec3;
  velocity: Vec3;
  duck: number;
  /** Tek yönlü gecikme tahmini (sn). */
  latency: number;
}

export interface VisSmoke {
  vol: SmokeVolume;
  bornTick: number;
}

/** Görünür olduktan sonra bu kadar tick daha gönderilmeye devam eder. */
const HYSTERESIS = Math.round(TICK_RATE * 0.75);
const SMOKE_BLOCK = 40;

export class Visibility {
  /** viewer → (target → son "gönderim" görünür tick'i) */
  private lastSend = new Map<number, Map<number, number>>();
  /** viewer → (target → kesin görünürlüğün başladığı tick, ya da -1) */
  private strictSince = new Map<number, Map<number, number>>();
  rays = 0;

  constructor(private world: World) {}

  private map(m: Map<number, Map<number, number>>, id: number) {
    let x = m.get(id);
    if (!x) m.set(id, (x = new Map()));
    return x;
  }

  forget(id: number) {
    this.lastSend.delete(id);
    this.strictSince.delete(id);
    for (const m of this.lastSend.values()) m.delete(id);
    for (const m of this.strictSince.values()) m.delete(id);
  }

  /** Tüm çiftleri güncelle (iki tick'te bir çağrılır). */
  update(actors: VisActor[], smokes: VisSmoke[], tick: number) {
    for (const v of actors) {
      if (!v.alive) continue;
      const send = this.map(this.lastSend, v.id);
      const strict = this.map(this.strictSince, v.id);
      for (const t of actors) {
        if (t.id === v.id || t.team === v.team) continue;
        if (!t.alive) {
          strict.set(t.id, -1);
          continue;
        }
        const s = this.losStrict(v, t, smokes, tick);
        if (s) {
          if ((strict.get(t.id) ?? -1) < 0) strict.set(t.id, tick);
          send.set(t.id, tick);
        } else {
          strict.set(t.id, -1);
          if (this.losPredicted(v, t, smokes, tick)) send.set(t.id, tick);
        }
      }
    }
  }

  /** viewer, target'ın konumunu almalı mı? */
  canSend(viewer: number, target: number, tick: number): boolean {
    const last = this.lastSend.get(viewer)?.get(target);
    return last !== undefined && tick - last <= HYSTERESIS;
  }

  /** Kesin görünürlük başlangıcı (görünmüyorsa -1). */
  visibleSince(viewer: number, target: number): number {
    return this.strictSince.get(viewer)?.get(target) ?? -1;
  }

  isStrictVisible(viewer: number, target: number): boolean {
    return this.visibleSince(viewer, target) >= 0;
  }

  private eye(a: VisActor): Vec3 {
    return { x: a.origin.x, y: a.origin.y, z: a.origin.z + 64 - 18 * a.duck };
  }

  private targetPoints(t: VisActor, offset: Vec3): Vec3[] {
    const o = { x: t.origin.x + offset.x, y: t.origin.y + offset.y, z: t.origin.z + offset.z };
    const head = 64 - 18 * t.duck;
    const pts: Vec3[] = [
      { x: o.x, y: o.y, z: o.z + head },
      { x: o.x, y: o.y, z: o.z + head * 0.7 },
      { x: o.x, y: o.y, z: o.z + head * 0.45 },
      { x: o.x, y: o.y, z: o.z + 6 },
    ];
    for (const [dx, dy] of [
      [16, 16],
      [-16, 16],
      [16, -16],
      [-16, -16],
    ]) {
      pts.push({ x: o.x + dx!, y: o.y + dy!, z: o.z + head * 0.6 });
    }
    return pts;
  }

  private clear(a: Vec3, b: Vec3, smokes: VisSmoke[], tick: number): boolean {
    this.rays++;
    if (this.world.traceRay(a, b, MASK_SHOT).fraction < 1) return false;
    for (const s of smokes) {
      const age = (tick - s.bornTick) / TICK_RATE;
      if (smokeOpticalDepth(s.vol, a, b, age, SMOKE_DURATION, SMOKE_FADE) > SMOKE_BLOCK) return false;
    }
    return true;
  }

  private losStrict(v: VisActor, t: VisActor, smokes: VisSmoke[], tick: number): boolean {
    const eye = this.eye(v);
    for (const p of this.targetPoints(t, { x: 0, y: 0, z: 0 })) if (this.clear(eye, p, smokes, tick)) return true;
    return false;
  }

  /** İleri bakan test: gecikme + hareket kadar sonra görünür olabilir mi? */
  private losPredicted(v: VisActor, t: VisActor, smokes: VisSmoke[], tick: number): boolean {
    const la = Math.min(0.35, v.latency + t.latency + 0.14);
    const eye = this.eye(v);
    const eyeAhead = { x: eye.x + v.velocity.x * la, y: eye.y + v.velocity.y * la, z: eye.z };
    const dx = t.origin.x - v.origin.x;
    const dy = t.origin.y - v.origin.y;
    const l = Math.hypot(dx, dy) || 1;
    // yan kayma payı (köşeden çıkma)
    const side = { x: (-dy / l) * 24, y: (dx / l) * 24, z: 0 };
    const eyes = [eyeAhead, { x: eye.x + side.x, y: eye.y + side.y, z: eye.z }, { x: eye.x - side.x, y: eye.y - side.y, z: eye.z }];
    const offs = [
      { x: t.velocity.x * la, y: t.velocity.y * la, z: 0 },
      { x: 0, y: 0, z: 0 },
    ];
    for (const e of eyes) {
      // kendi duvarının içine girmeyelim
      if (this.world.pointInSolid(e, MASK_SHOT)) continue;
      for (const off of offs) for (const p of this.targetPoints(t, off)) if (this.clear(e, p, smokes, tick)) return true;
    }
    return false;
  }
}

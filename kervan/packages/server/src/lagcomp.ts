import { Vec3, lerpAngle, MAX_UNLAG_SECONDS, TICK_RATE } from '@kervan/shared';

export interface PoseRecord {
  origin: Vec3;
  yaw: number;
  duck: number;
  alive: boolean;
}

const HISTORY = 128;

/**
 * Lag compensation geçmişi: her tick'te oyuncuların hitbox pozları saklanır. Atış
 * işlenirken atıcının ekranında gördüğü ana (renderTick) geri sarılır.
 */
export class LagCompHistory {
  private ticks = new Int32Array(HISTORY).fill(-1);
  private frames: Map<number, PoseRecord>[] = Array.from({ length: HISTORY }, () => new Map());

  record(tick: number, poses: Map<number, PoseRecord>) {
    const i = tick % HISTORY;
    this.ticks[i] = tick;
    this.frames[i] = poses;
  }

  private frame(tick: number): Map<number, PoseRecord> | null {
    const i = ((tick % HISTORY) + HISTORY) % HISTORY;
    return this.ticks[i] === tick ? this.frames[i]! : null;
  }

  /** Verilen (ondalıklı) tick'teki poz; sınırlar sv_maxunlag ile kırpılır. */
  poseAt(id: number, renderTick: number, nowTick: number): PoseRecord | null {
    const maxBack = Math.ceil(MAX_UNLAG_SECONDS * TICK_RATE);
    let t = Math.min(nowTick, Math.max(nowTick - maxBack, renderTick));
    if (!Number.isFinite(t)) t = nowTick;
    const t0 = Math.floor(t);
    const t1 = Math.min(nowTick, t0 + 1);
    const f = t - t0;
    const a = this.frame(t0)?.get(id);
    const b = this.frame(t1)?.get(id);
    if (!a && !b) return null;
    if (!a) return b!;
    if (!b || f <= 0) return a;
    // ölü/diri geçişlerinde interpolasyon yapma
    if (a.alive !== b.alive) return f < 0.5 ? a : b;
    return {
      origin: {
        x: a.origin.x + (b.origin.x - a.origin.x) * f,
        y: a.origin.y + (b.origin.y - a.origin.y) * f,
        z: a.origin.z + (b.origin.z - a.origin.z) * f,
      },
      yaw: lerpAngle(a.yaw, b.yaw, f),
      duck: a.duck + (b.duck - a.duck) * f,
      alive: b.alive,
    };
  }
}

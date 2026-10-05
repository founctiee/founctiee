/**
 * Sunucu tarafı demo kaydı: son 5 round + atılan oyuncular için kanıt kayıtları.
 * Host "Demoyu indir" ile alır, istemcideki demo izleyicide açar.
 */
import { DemoEvent, DemoFile, DemoPlayerFrame, DemoRound, DEMO_VERSION, TICK_RATE, packFrame, bytesToBase64 } from '@kervan/shared';

const KEEP_ROUNDS = 5;
const KEEP_EVIDENCE = 3;
/** Isınma gibi uzun bölümler bu süreden sonra yeni parçaya bölünür. */
const MAX_SEGMENT = TICK_RATE * 180;

interface Segment {
  round: number;
  startTick: number;
  lastTick: number;
  data: number[];
  events: DemoEvent[];
}

function finalize(s: Segment, evidenceFor?: number): DemoRound {
  const arr = Int16Array.from(s.data);
  return {
    round: s.round,
    startTick: s.startTick,
    endTick: s.lastTick,
    frames: bytesToBase64(new Uint8Array(arr.buffer)),
    events: [...s.events],
    evidenceFor,
  };
}

export class DemoRecorder {
  private cur: Segment | null = null;
  private done: DemoRound[] = [];
  private evidence: DemoRound[] = [];
  readonly names = new Map<number, string>();

  startRound(round: number, tick: number) {
    this.close();
    this.cur = { round, startTick: tick, lastTick: tick, data: [], events: [] };
  }

  frame(tick: number, round: number, players: DemoPlayerFrame[]) {
    if (!this.cur || tick - this.cur.startTick > MAX_SEGMENT) this.startRound(round, tick);
    packFrame(this.cur!.data, tick, players);
    this.cur!.lastTick = tick;
  }

  event(e: DemoEvent) {
    this.cur?.events.push(e);
  }

  private close() {
    if (this.cur && this.cur.data.length) {
      this.done.push(finalize(this.cur));
      if (this.done.length > KEEP_ROUNDS) this.done.shift();
    }
    this.cur = null;
  }

  /** Atılan oyuncu için önceki ve şu anki round'u ayrıca sakla. */
  saveEvidence(id: number) {
    const prev = this.done[this.done.length - 1];
    if (prev) this.evidence.push({ ...prev, evidenceFor: id });
    if (this.cur && this.cur.data.length) this.evidence.push(finalize(this.cur, id));
    while (this.evidence.length > KEEP_EVIDENCE * 2) this.evidence.shift();
  }

  file(map: string, room: string): DemoFile {
    const rounds = [...this.evidence, ...this.done];
    if (this.cur && this.cur.data.length) rounds.push(finalize(this.cur));
    return {
      v: DEMO_VERSION,
      map,
      room,
      created: Date.now(),
      players: [...this.names].map(([id, name]) => ({ id, name })),
      rounds,
    };
  }
}

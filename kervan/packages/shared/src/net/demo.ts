/**
 * Demo (kanıt kaydı) biçimi. Her tick için oyuncuların konum/açı/durum bilgisi Int16 olarak
 * paketlenir: [tick düşük, tick yüksek, n, (id, team, flags, x, y, z, yaw, pitch, duck, weapon) × n].
 */
export const DEMO_VERSION = 1;
export const DEMO_STRIDE = 10;

export interface DemoPlayerFrame {
  id: number;
  team: number;
  flags: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  duck: number;
  weapon: number;
}

export type DemoEvent =
  | { tick: number; k: 'shot'; id: number; o: [number, number, number]; d: [number, number, number] }
  | { tick: number; k: 'hit'; a: number; v: number; dmg: number; hg: number }
  | { tick: number; k: 'kill'; a: number; v: number; hs: boolean }
  | { tick: number; k: 'ac'; id: number; text: string }
  | { tick: number; k: 'honeypot'; viewer: number; id: number; p: [number, number, number]; end: number }
  | { tick: number; k: 'kick'; id: number; text: string };

export interface DemoRound {
  round: number;
  startTick: number;
  endTick: number;
  /** base64 Int16Array */
  frames: string;
  events: DemoEvent[];
  /** Bu round'da atılan oyuncu (kanıt kaydı). */
  evidenceFor?: number;
}

export interface DemoFile {
  v: number;
  map: string;
  room: string;
  created: number;
  players: { id: number; name: string }[];
  rounds: DemoRound[];
}

const S_POS = 8;
const S_YAW = 65535 / 360;
const S_PITCH = 300;

export function packFrame(out: number[], tick: number, players: DemoPlayerFrame[]) {
  out.push(tick & 0x7fff, (tick >> 15) & 0x7fff, players.length);
  for (const p of players) {
    out.push(
      p.id,
      p.team,
      p.flags,
      Math.round(p.x * S_POS),
      Math.round(p.y * S_POS),
      Math.round(p.z * S_POS),
      Math.round((((p.yaw % 360) + 360) % 360) * S_YAW) - 32768,
      Math.round(p.pitch * S_PITCH),
      Math.round(p.duck * 255),
      p.weapon,
    );
  }
}

export interface DemoTick {
  tick: number;
  players: DemoPlayerFrame[];
}

export function unpackFrames(data: Int16Array): DemoTick[] {
  const out: DemoTick[] = [];
  let i = 0;
  while (i + 3 <= data.length) {
    const tick = data[i]! + (data[i + 1]! << 15);
    const n = data[i + 2]!;
    i += 3;
    const players: DemoPlayerFrame[] = [];
    for (let k = 0; k < n && i + DEMO_STRIDE <= data.length; k++, i += DEMO_STRIDE) {
      players.push({
        id: data[i]!,
        team: data[i + 1]!,
        flags: data[i + 2]!,
        x: data[i + 3]! / S_POS,
        y: data[i + 4]! / S_POS,
        z: data[i + 5]! / S_POS,
        yaw: (data[i + 6]! + 32768) / S_YAW,
        pitch: data[i + 7]! / S_PITCH,
        duck: data[i + 8]! / 255,
        weapon: data[i + 9]!,
      });
    }
    out.push({ tick, players });
  }
  return out;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function bytesToBase64(b: Uint8Array): string {
  let s = '';
  let i = 0;
  for (; i + 2 < b.length; i += 3) {
    const n = (b[i]! << 16) | (b[i + 1]! << 8) | b[i + 2]!;
    s += B64[n >> 18]! + B64[(n >> 12) & 63]! + B64[(n >> 6) & 63]! + B64[n & 63]!;
  }
  const rest = b.length - i;
  if (rest === 1) {
    const n = b[i]! << 16;
    s += B64[n >> 18]! + B64[(n >> 12) & 63]! + '==';
  } else if (rest === 2) {
    const n = (b[i]! << 16) | (b[i + 1]! << 8);
    s += B64[n >> 18]! + B64[(n >> 12) & 63]! + B64[(n >> 6) & 63]! + '=';
  }
  return s;
}

export function base64ToBytes(s: string): Uint8Array {
  const clean = s.replace(/=+$/, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  let acc = 0;
  let bits = 0;
  for (let i = 0; i < clean.length; i++) {
    const v = B64.indexOf(clean[i]!);
    if (v < 0) continue;
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (acc >> bits) & 255;
    }
  }
  return out.subarray(0, o);
}

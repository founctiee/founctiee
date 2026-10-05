import { randomBytes } from 'node:crypto';
import type { WebSocket } from 'ws';
import {
  buildKervan,
  MapDef,
  ClientMsg,
  ServerMsg,
  Reader,
  MSG_CMD,
  decodeCmds,
  PROTOCOL_VERSION,
  TICK_RATE,
  Phase,
} from '@kervan/shared';
import { Match, Conn, ServerPlayer } from './match';

const LETTERS = 'ABCDEFGHJKLMNPRSTUVYZ';
let sharedMap: MapDef | null = null;
function mapDef(): MapDef {
  return (sharedMap ??= buildKervan());
}

export class Room {
  readonly match: Match;
  emptySince = -1;
  constructor(
    readonly code: string,
    readonly practice: boolean,
  ) {
    this.match = new Match(mapDef(), practice ? { practice: true } : {}, code);
  }
}

class WsConn implements Conn {
  constructor(private ws: WebSocket) {}
  sendBinary(data: Uint8Array) {
    if (this.ws.readyState === 1) this.ws.send(data, { binary: true });
  }
  sendJSON(msg: ServerMsg) {
    if (this.ws.readyState === 1) this.ws.send(JSON.stringify(msg));
  }
  bufferedAmount() {
    return this.ws.bufferedAmount;
  }
}

export class RoomManager {
  rooms = new Map<string, Room>();

  private newCode(): string {
    for (;;) {
      const b = randomBytes(4);
      const code = `${LETTERS[b[0]! % LETTERS.length]}${LETTERS[b[1]! % LETTERS.length]}${LETTERS[b[2]! % LETTERS.length]}-${1000 + (b.readUInt16LE(2) % 9000)}`;
      if (!this.rooms.has(code)) return code;
    }
  }

  create(practice: boolean): Room {
    const r = new Room(this.newCode(), practice);
    this.rooms.set(r.code, r);
    return r;
  }

  list() {
    return [...this.rooms.values()]
      .filter((r) => r.match.connectedCount() > 0)
      .map((r) => ({ code: r.code, players: r.match.connectedCount(), phase: r.match.phase as Phase, practice: r.practice }));
  }

  /** Tüm odaları bir tick ilerlet. */
  step() {
    for (const [code, r] of this.rooms) {
      r.match.step();
      if (r.match.connectedCount() === 0) {
        if (r.emptySince < 0) r.emptySince = r.match.tick;
        else if (r.match.tick - r.emptySince > TICK_RATE * 90) this.rooms.delete(code);
      } else r.emptySince = -1;
    }
  }

  attach(ws: WebSocket) {
    const conn = new WsConn(ws);
    let room: Room | null = null;
    let player: ServerPlayer | null = null;

    ws.on('message', (data: Buffer, isBinary: boolean) => {
      try {
        if (isBinary) {
          if (!room || !player) return;
          const r = new Reader(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
          const type = r.u8();
          if (type === MSG_CMD) room.match.handleCmds(player.id, decodeCmds(r));
          return;
        }
        const msg = JSON.parse(data.toString()) as ClientMsg | { t: 'rooms' };
        if (msg.t === 'rooms') {
          conn.sendJSON({ t: 'rooms', list: this.list() });
          return;
        }
        if (msg.t === 'join') {
          if (player) return;
          if (msg.version !== PROTOCOL_VERSION) {
            conn.sendJSON({ t: 'error', msg: 'Sürüm uyuşmuyor, sayfayı yenile.' });
            return;
          }
          if (msg.create || !msg.room) room = this.create(!!msg.practice);
          else {
            room = this.rooms.get(msg.room.toUpperCase().trim()) ?? null;
            if (!room) {
              conn.sendJSON({ t: 'error', msg: 'Oda bulunamadı.' });
              return;
            }
          }
          const m = room.match;
          // yeniden bağlanma
          const existing = msg.token ? [...m.players.values()].find((p) => p.token === msg.token && !p.conn) : undefined;
          if (existing) {
            player = existing;
            m.reconnect(existing, conn);
          } else {
            if (m.players.size >= 10) {
              conn.sendJSON({ t: 'error', msg: 'Oda dolu.' });
              room = null;
              return;
            }
            player = m.addPlayer(String(msg.name ?? '').slice(0, 24), conn, randomBytes(12).toString('hex'));
          }
          conn.sendJSON({
            t: 'welcome',
            id: player.id,
            room: room.code,
            tick: m.tick,
            tickRate: TICK_RATE,
            map: m.map.name,
            version: PROTOCOL_VERSION,
            token: player.token,
          });
          conn.sendJSON({ t: 'state', ...m.buildState() });
          return;
        }
        if (room && player) room.match.handleMessage(player.id, msg);
      } catch (err) {
        console.warn('mesaj hatası', err);
      }
    });

    ws.on('close', () => {
      if (room && player) room.match.disconnect(player.id);
    });
  }
}

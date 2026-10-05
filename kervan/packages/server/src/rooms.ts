import { randomBytes, createHash } from 'node:crypto';
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
import { Match, Conn, ServerPlayer, KickInfo } from './match';
import { Integrity } from './integrity';

const LETTERS = 'ABCDEFGHJKLMNPRSTUVYZ';
let sharedMap: MapDef | null = null;
function mapDef(): MapDef {
  return (sharedMap ??= buildKervan());
}

/** Sunucu ömrü boyunca sabit tuz: IP'ler düz metin saklanmaz. */
const IP_SALT = randomBytes(16).toString('hex');
export function hashIp(ip: string): string {
  const clean = ip.replace(/^::ffff:/, '');
  // yerel bağlantılar (tünel/proxy arkasında herkes böyle görünür) yasaklanmaz
  if (!clean || clean === '127.0.0.1' || clean === '::1') return '';
  return createHash('sha256').update(IP_SALT + clean).digest('hex').slice(0, 16);
}

interface Ban {
  key: string;
  name: string;
  reason: string;
  token: string;
  did: string;
  ipHash: string;
}

export class Room {
  readonly match: Match;
  emptySince = -1;
  bans: Ban[] = [];
  constructor(
    readonly code: string,
    readonly practice: boolean,
  ) {
    this.match = new Match(mapDef(), practice ? { practice: true } : {}, code);
    this.match.onKick = (k) => this.onKick(k);
    this.match.bansForReport = () => this.bans.map((b) => ({ key: b.key, name: b.name, reason: b.reason }));
  }

  private onKick(k: KickInfo) {
    if (!k.ban) return;
    const p = k.player;
    this.bans.push({ key: randomBytes(4).toString('hex'), name: p.name, reason: k.reason, token: p.token, did: p.did, ipHash: p.ipHash });
  }

  isBanned(token: string | undefined, did: string, ipHash: string): Ban | undefined {
    return this.bans.find((b) => (token && b.token === token) || (did && b.did === did) || (ipHash && b.ipHash === ipHash));
  }

  unban(key: string) {
    const b = this.bans.find((x) => x.key === key);
    this.bans = this.bans.filter((x) => x.key !== key);
    if (b) this.match.notice(`${b.name} adlı oyuncunun yasağı kaldırıldı`);
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
  close() {
    // mesajların gitmesi için kısa bekle
    setTimeout(() => this.ws.close(4001, 'kicked'), 150);
  }
}

/** Jeton kovası: saniyede `rate`, en fazla `burst`. */
class Bucket {
  private tokens: number;
  private last = Date.now();
  dropped = 0;
  constructor(
    private rate: number,
    private burst: number,
  ) {
    this.tokens = burst;
  }
  take(): boolean {
    const now = Date.now();
    this.tokens = Math.min(this.burst, this.tokens + ((now - this.last) / 1000) * this.rate);
    this.last = now;
    if (this.tokens >= 1) {
      this.tokens -= 1;
      // iyi davranış eski düşüşleri yavaşça affeder
      if (this.dropped > 0) this.dropped -= 0.02;
      return true;
    }
    this.dropped++;
    return false;
  }
}

const JSON_FLOOD_KICK = 120;
const BIN_FLOOD_KICK = 400;

export class RoomManager {
  rooms = new Map<string, Room>();
  integrity = new Integrity();

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
      this.integrity.step(r.match);
      if (r.match.connectedCount() === 0) {
        if (r.emptySince < 0) r.emptySince = r.match.tick;
        else if (r.match.tick - r.emptySince > TICK_RATE * 90) this.rooms.delete(code);
      } else r.emptySince = -1;
    }
  }

  attach(ws: WebSocket, ip = '') {
    const conn = new WsConn(ws);
    let room: Room | null = null;
    let player: ServerPlayer | null = null;
    const jsonBucket = new Bucket(40, 80);
    const binBucket = new Bucket(110, 220);
    const ipHash = hashIp(ip);

    const kickFlood = () => {
      if (room && player) room.match.detect(player, 'flood', 'mesaj seli');
      else ws.close(4002, 'flood');
    };

    ws.on('message', (data: Buffer, isBinary: boolean) => {
      if (isBinary) {
        // karıştırma sayacı her pakette ilerler (düşürülse bile)
        const bytes = player ? player.rx.apply(new Uint8Array(data.buffer, data.byteOffset, data.byteLength)) : null;
        if (!binBucket.take()) {
          if (binBucket.dropped > BIN_FLOOD_KICK) kickFlood();
          return;
        }
        if (!room || !player || !bytes) return;
        try {
          const r = new Reader(bytes);
          const type = r.u8();
          if (type === MSG_CMD) room.match.handleCmds(player.id, decodeCmds(r));
          else room.match.detect(player, 'invalid', `bilinmeyen ikili mesaj ${type}`);
        } catch (err) {
          room.match.detect(player, 'invalid', `bozuk ikili mesaj: ${(err as Error).message}`);
        }
        return;
      }
      if (!jsonBucket.take()) {
        if (jsonBucket.dropped > JSON_FLOOD_KICK) kickFlood();
        return;
      }
      let msg: ClientMsg | { t: 'rooms' };
      try {
        msg = JSON.parse(data.toString()) as ClientMsg | { t: 'rooms' };
        if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') throw new Error('biçim');
      } catch {
        if (room && player) room.match.detect(player, 'invalid', 'bozuk JSON');
        return;
      }
      try {
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
          const did = typeof msg.did === 'string' ? msg.did.slice(0, 64) : '';
          if (msg.create || !msg.room) room = this.create(!!msg.practice);
          else {
            room = this.rooms.get(String(msg.room).toUpperCase().trim()) ?? null;
            if (!room) {
              conn.sendJSON({ t: 'error', msg: 'Oda bulunamadı.' });
              return;
            }
          }
          const ban = room.isBanned(msg.token, did, ipHash);
          if (ban) {
            conn.sendJSON({ t: 'error', msg: `Bu odadan yasaklandın (${ban.reason}).` });
            room = null;
            return;
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
          player.did = did;
          player.ipHash = ipHash;
          conn.sendJSON({
            t: 'welcome',
            id: player.id,
            room: room.code,
            tick: m.tick,
            tickRate: TICK_RATE,
            map: m.map.name,
            version: PROTOCOL_VERSION,
            token: player.token,
            key: m.newNetKey(player.id),
          });
          conn.sendJSON({ t: 'state', ...m.buildState(player.team) });
          this.integrity.begin(m, player);
          return;
        }
        if (!room || !player) return;
        if (msg.t === 'unban') {
          if (player.id === room.match.host && typeof msg.key === 'string') room.unban(msg.key);
          return;
        }
        if (msg.t === 'acn') {
          this.integrity.answer(room.match, player, msg);
          return;
        }
        room.match.handleMessage(player.id, msg);
      } catch (err) {
        console.warn('mesaj hatası', err);
      }
    });

    ws.on('close', () => {
      if (room && player) room.match.disconnect(player.id);
    });
  }
}

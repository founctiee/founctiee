import { ClientMsg, ServerMsg, Reader, MSG_SNAPSHOT, decodeSnapshot, Snapshot, encodeCmds, UserCmd, NetCipher } from '@kervan/shared';

export interface ConnectionHandlers {
  onMessage(msg: ServerMsg): void;
  onSnapshot(snap: Snapshot, size: number): void;
  onClose(code: number): void;
}

/** Sunucuya WebSocket bağlantısı. JSON = kontrol, ikili = komut/snapshot (oturum anahtarıyla karıştırılmış). */
export class Connection {
  #ws: WebSocket;
  #rx = new NetCipher(0);
  #tx = new NetCipher(0);
  #handlers: ConnectionHandlers;
  bytesIn = 0;
  bytesOut = 0;
  open = false;

  constructor(handlers: ConnectionHandlers) {
    this.#handlers = handlers;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.#ws = ws;
    ws.binaryType = 'arraybuffer';
    ws.onmessage = (ev) => {
      if (typeof ev.data === 'string') {
        this.bytesIn += ev.data.length;
        try {
          const msg = JSON.parse(ev.data) as ServerMsg;
          // anahtar, snapshot'lardan önce aynı sırada gelir
          if (msg.t === 'welcome') this.#setKey(msg.key ?? 0);
          this.#handlers.onMessage(msg);
        } catch (err) {
          console.error(err);
        }
      } else {
        const buf = ev.data as ArrayBuffer;
        this.bytesIn += buf.byteLength;
        const bytes = this.#rx.apply(new Uint8Array(buf));
        const r = new Reader(bytes);
        if (r.u8() === MSG_SNAPSHOT) this.#handlers.onSnapshot(decodeSnapshot(r), buf.byteLength);
      }
    };
    ws.onclose = (ev) => {
      this.open = false;
      this.#handlers.onClose(ev.code);
    };
  }

  #setKey(key: number) {
    this.#rx = new NetCipher(key);
    this.#tx = new NetCipher(key === 0 ? 0 : (key ^ 0x5bd1e995) >>> 0 || 1);
  }

  whenOpen(): Promise<void> {
    if (this.#ws.readyState === WebSocket.OPEN) {
      this.open = true;
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      this.#ws.addEventListener('open', () => {
        this.open = true;
        resolve();
      });
      this.#ws.addEventListener('error', () => reject(new Error('bağlantı hatası')));
    });
  }

  send(msg: ClientMsg | { t: 'rooms' }) {
    if (this.#ws.readyState !== WebSocket.OPEN) return;
    const s = JSON.stringify(msg);
    this.bytesOut += s.length;
    this.#ws.send(s);
  }

  sendCmds(cmds: UserCmd[]) {
    if (this.#ws.readyState !== WebSocket.OPEN) return;
    const data = this.#tx.apply(encodeCmds(cmds));
    this.bytesOut += data.byteLength;
    this.#ws.send(data);
  }

  close() {
    this.#ws.onclose = null;
    this.#ws.close();
  }
}

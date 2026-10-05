import { ClientMsg, ServerMsg, Reader, MSG_SNAPSHOT, decodeSnapshot, Snapshot, encodeCmds, UserCmd } from '@kervan/shared';

export interface ConnectionHandlers {
  onMessage(msg: ServerMsg): void;
  onSnapshot(snap: Snapshot, size: number): void;
  onClose(): void;
}

/** Sunucuya WebSocket bağlantısı. JSON = kontrol, ikili = komut/snapshot. */
export class Connection {
  private ws: WebSocket;
  bytesIn = 0;
  bytesOut = 0;
  open = false;

  constructor(private handlers: ConnectionHandlers) {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    this.ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws.binaryType = 'arraybuffer';
    this.ws.onmessage = (ev) => {
      if (typeof ev.data === 'string') {
        this.bytesIn += ev.data.length;
        try {
          this.handlers.onMessage(JSON.parse(ev.data) as ServerMsg);
        } catch (err) {
          console.error(err);
        }
      } else {
        const buf = ev.data as ArrayBuffer;
        this.bytesIn += buf.byteLength;
        const r = new Reader(buf);
        if (r.u8() === MSG_SNAPSHOT) this.handlers.onSnapshot(decodeSnapshot(r), buf.byteLength);
      }
    };
    this.ws.onclose = () => {
      this.open = false;
      this.handlers.onClose();
    };
  }

  whenOpen(): Promise<void> {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.open = true;
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      this.ws.addEventListener('open', () => {
        this.open = true;
        resolve();
      });
      this.ws.addEventListener('error', () => reject(new Error('bağlantı hatası')));
    });
  }

  send(msg: ClientMsg | { t: 'rooms' }) {
    if (this.ws.readyState !== WebSocket.OPEN) return;
    const s = JSON.stringify(msg);
    this.bytesOut += s.length;
    this.ws.send(s);
  }

  sendCmds(cmds: UserCmd[]) {
    if (this.ws.readyState !== WebSocket.OPEN) return;
    const data = encodeCmds(cmds);
    this.bytesOut += data.byteLength;
    this.ws.send(data);
  }

  close() {
    this.ws.onclose = null;
    this.ws.close();
  }
}

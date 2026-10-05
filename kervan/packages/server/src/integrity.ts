/**
 * İstemci bütünlük doğrulaması. Sunucu rastgele bir nonce ve derlenmiş istemci dosyalarının
 * listesini gönderir; istemci SHA-256(nonce + dosyalar) ile yanıt verir. Değiştirilmiş
 * (DevTools Overrides ile yamalanmış) bir oyun dosyası ya da yanıt vermeyen istemci atılır.
 * İstemci ayrıca kendi kontrollerinin sonucunu (kurcalanmış yerel fonksiyonlar) bildirir.
 */
import { createHash, randomBytes, randomInt } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TICK_RATE } from '@kervan/shared';
import type { Match, ServerPlayer } from './match';

declare const KERVAN_PROD: boolean | undefined;
const PROD = typeof KERVAN_PROD !== 'undefined' && KERVAN_PROD;

/** Yanıt süresi. */
const DEADLINE = TICK_RATE * 20;

/** İstemcinin bildirdiği kurcalama bitleri (packages/client/src/security/integrity.ts ile aynı). */
export const TAMPER_TEXT: Record<number, string> = {
  1: 'WebSocket değiştirilmiş',
  2: 'requestAnimationFrame değiştirilmiş',
  4: 'WebGL fonksiyonu değiştirilmiş',
  8: 'JSON/Function değiştirilmiş',
  16: 'oyun nesnesine dışarıdan erişim',
  32: 'sahte (script) girdi olayları',
};

interface Pending {
  nonce: string;
  sentTick: number;
  nextTick: number;
}

export class Integrity {
  readonly enabled: boolean;
  private files: string[] = [];
  private blob: Buffer = Buffer.alloc(0);
  private state = new WeakMap<ServerPlayer, Pending>();

  constructor(distDir?: string) {
    const here = dirname(fileURLToPath(import.meta.url));
    const dist = resolve(distDir ?? process.env.CLIENT_DIST ?? resolve(here, '../../client/dist'));
    let ok = PROD && process.env.KERVAN_INTEGRITY !== '0';
    if (ok) {
      try {
        const html = readFileSync(join(dist, 'index.html'), 'utf8');
        const refs = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+\.(?:js|css))"/g)].map((m) => m[1]!);
        this.files = [...new Set(refs)].filter((f) => existsSync(join(dist, f)));
        this.blob = Buffer.concat(this.files.map((f) => readFileSync(join(dist, f))));
        ok = this.files.length > 0;
      } catch {
        ok = false;
      }
    }
    this.enabled = ok;
    if (ok) console.log(`İstemci bütünlük kontrolü açık (${this.files.length} dosya)`);
  }

  /** Beklenen özet. */
  expected(nonce: string): string {
    return createHash('sha256').update(nonce).update(this.blob).digest('hex');
  }

  begin(_m: Match, p: ServerPlayer) {
    if (!this.enabled) return;
    // ilk meydan okuma birkaç saniye sonra (yükleme bitsin)
    this.state.set(p, { nonce: '', sentTick: -1, nextTick: _m.tick + TICK_RATE * (3 + randomInt(0, 4)) });
  }

  step(m: Match) {
    if (!this.enabled) return;
    for (const p of m.players.values()) {
      const st = this.state.get(p);
      if (!st || !p.conn) continue;
      if (st.nonce && m.tick - st.sentTick > DEADLINE) {
        st.nonce = '';
        m.detect(p, 'integrity', 'doğrulama yanıtı gelmedi');
        continue;
      }
      if (!st.nonce && m.tick >= st.nextTick) {
        st.nonce = randomBytes(16).toString('hex');
        st.sentTick = m.tick;
        p.conn.sendJSON({ t: 'acn', n: st.nonce, files: this.files });
      }
    }
  }

  answer(m: Match, p: ServerPlayer, msg: { n: string; h: string; f: number }) {
    if (!this.enabled) return;
    const st = this.state.get(p);
    if (!st || !st.nonce || msg.n !== st.nonce) return;
    st.nonce = '';
    st.nextTick = m.tick + TICK_RATE * (45 + randomInt(0, 60));
    const flags = typeof msg.f === 'number' ? msg.f | 0 : 0;
    if (flags) {
      const what = Object.entries(TAMPER_TEXT)
        .filter(([bit]) => flags & Number(bit))
        .map(([, t]) => t)
        .join(', ');
      m.detect(p, 'tamper', what || `bayrak ${flags}`);
      return;
    }
    if (msg.h !== this.expected(msg.n)) m.detect(p, 'integrity', 'oyun dosyası özeti uyuşmuyor');
  }
}

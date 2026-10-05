/**
 * İstemci tarafı kurcalama kontrolleri ve sunucunun bütünlük meydan okumasına yanıt.
 *
 * - Ağ/çizim için kullanılan yerel fonksiyonlar (WebSocket, rAF, WebGL, JSON) açılışta
 *   yakalanır; sonradan değiştirilirse ya da yerel kod gibi görünmüyorsa bildirilir.
 * - Script ile üretilen (isTrusted = false) fare/klavye olayları sayılır.
 * - Sunucu nonce + dosya listesi gönderir; dosyaların SHA-256 özeti nonce ile hesaplanır.
 *
 * Bayrak bitleri packages/server/src/integrity.ts TAMPER_TEXT ile aynıdır.
 */
import { sha256Hex } from './sha256';

const F_WS = 1;
const F_RAF = 2;
const F_GL = 4;
const F_CORE = 8;
const F_INPUT = 32;

const fnToString = Function.prototype.toString;
const NATIVE = /\{\s*\[native code\]\s*\}\s*$/;

function isNative(f: unknown): boolean {
  try {
    return typeof f === 'function' && NATIVE.test(fnToString.call(f));
  } catch {
    return false;
  }
}

function getter(proto: object | undefined, key: string): unknown {
  if (!proto) return undefined;
  return Object.getOwnPropertyDescriptor(proto, key)?.get;
}
function setter(proto: object | undefined, key: string): unknown {
  if (!proto) return undefined;
  return Object.getOwnPropertyDescriptor(proto, key)?.set;
}

interface Probe {
  flag: number;
  read: () => unknown;
}

const GL = typeof WebGL2RenderingContext !== 'undefined' ? WebGL2RenderingContext.prototype : undefined;

const PROBES: Probe[] = [
  { flag: F_WS, read: () => WebSocket },
  { flag: F_WS, read: () => WebSocket.prototype.send },
  { flag: F_WS, read: () => setter(WebSocket.prototype, 'onmessage') },
  { flag: F_WS, read: () => getter(MessageEvent.prototype, 'data') },
  { flag: F_RAF, read: () => window.requestAnimationFrame },
  { flag: F_GL, read: () => GL?.drawElements },
  { flag: F_GL, read: () => GL?.drawArrays },
  { flag: F_GL, read: () => GL?.uniformMatrix4fv },
  { flag: F_CORE, read: () => JSON.parse },
  { flag: F_CORE, read: () => Function.prototype.toString },
];

/** Açılıştaki referanslar. */
const initial = PROBES.map((p) => {
  try {
    return p.read();
  } catch {
    return undefined;
  }
});

let flags = 0;
let untrustedEvents = 0;

function scan() {
  PROBES.forEach((p, i) => {
    let cur: unknown;
    try {
      cur = p.read();
    } catch {
      return;
    }
    if (cur === undefined) return;
    if (cur !== initial[i] || !isNative(cur)) flags |= p.flag;
  });
  if (untrustedEvents > 12) flags |= F_INPUT;
}

scan();
setInterval(scan, 3000);

async function fileBytes(path: string): Promise<Uint8Array> {
  const r = await fetch(path, { cache: 'force-cache', credentials: 'same-origin' });
  if (!r.ok) throw new Error(String(r.status));
  return new Uint8Array(await r.arrayBuffer());
}

async function digest(nonce: string, files: string[]): Promise<string> {
  const parts: Uint8Array[] = [new TextEncoder().encode(nonce)];
  for (const f of files) parts.push(await fileBytes(f));
  let len = 0;
  for (const p of parts) len += p.length;
  const all = new Uint8Array(len);
  let o = 0;
  for (const p of parts) {
    all.set(p, o);
    o += p.length;
  }
  // crypto.subtle sadece güvenli bağlamda (https / localhost) var; değilse JS uygulaması
  if (globalThis.crypto?.subtle) {
    const h = new Uint8Array(await crypto.subtle.digest('SHA-256', all));
    return [...h].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  return sha256Hex(all);
}

export const security = {
  /** Sahte girdi olayı görüldü. */
  untrusted() {
    untrustedEvents++;
  },
  async answer(nonce: string, files: string[]): Promise<{ h: string; f: number }> {
    scan();
    if (import.meta.env.DEV) return { h: 'dev', f: flags };
    try {
      return { h: await digest(nonce, files), f: flags };
    } catch {
      return { h: 'hata', f: flags };
    }
  },
};

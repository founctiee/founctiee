import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { TICK_RATE } from '@kervan/shared';
import { RoomManager } from './rooms';

const PORT = Number(process.env.PORT ?? 3000);
const here = dirname(fileURLToPath(import.meta.url));
const CLIENT_DIST = resolve(process.env.CLIENT_DIST ?? resolve(here, '../../client/dist'));

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

const rooms = new RoomManager();

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  if (url.pathname === '/api/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, rooms: rooms.rooms.size }));
    return;
  }
  if (url.pathname === '/api/rooms') {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-cache' });
    res.end(JSON.stringify(rooms.list()));
    return;
  }
  let path = resolve(join(CLIENT_DIST, decodeURIComponent(url.pathname)));
  if (!path.startsWith(CLIENT_DIST)) {
    res.writeHead(403);
    res.end();
    return;
  }
  try {
    const st = await stat(path).catch(() => null);
    if (!st || st.isDirectory()) path = join(CLIENT_DIST, 'index.html');
    const data = await readFile(path);
    const ext = extname(path);
    res.writeHead(200, {
      'content-type': MIME[ext] ?? 'application/octet-stream',
      'cache-control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
    });
    res.end(data);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('İstemci derlenmemiş: önce `npm run build` çalıştır.');
  }
});

const wss = new WebSocketServer({ server, path: '/ws', perMessageDeflate: false, maxPayload: 64 * 1024 });
wss.on('connection', (ws, req) => {
  // Nagle kapalı: düşük gecikme
  (req.socket as { setNoDelay?: (v: boolean) => void }).setNoDelay?.(true);
  rooms.attach(ws);
});

// sürüklenmeyi düzelten 64 tick döngüsü
const TICK_MS = 1000 / TICK_RATE;
let next = performance.now();
function loop() {
  const now = performance.now();
  let n = 0;
  while (now >= next && n < 8) {
    rooms.step();
    next += TICK_MS;
    n++;
  }
  if (now - next > 250) next = now; // çok geride kaldıysak yakalamaya çalışma
  const wait = Math.max(0, next - performance.now());
  setTimeout(loop, wait > 2 ? wait - 1 : 0);
}
loop();

server.listen(PORT, () => {
  console.log(`Kervan sunucusu çalışıyor → http://localhost:${PORT}  (tick ${TICK_RATE})`);
});

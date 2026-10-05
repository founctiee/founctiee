/** Oyun içi HUD: can/zırh, mermi, para, süre/skor, killfeed, radar, bildirimler. */
import { useEffect, useRef } from 'preact/hooks';
import { Phase, Team, BombState, TICK_RATE, GRENADE_KEYS, weaponByNum } from '@kervan/shared';
import { ui, playerById } from './store';
import { tr } from '../i18n/tr';
import { weaponIcon } from '../render/icons';
import type { Game } from '../game/game';
import { settings } from '../settings';

function fmtTime(sec: number) {
  const s = Math.max(0, Math.ceil(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function TopBar() {
  const st = ui.state.value;
  const hud = ui.hud.value;
  if (!st) return null;
  const now = hud.serverTick;
  const left = (st.phaseEndTick - now) / TICK_RATE;
  const planted = st.bomb.state === BombState.Planted;
  const tPlayers = st.players.filter((p) => p.team === Team.T);
  const ctPlayers = st.players.filter((p) => p.team === Team.CT);
  let timer = '';
  if (st.phase === Phase.Warmup) timer = st.settings.practice ? tr.practiceBanner : tr.warmup;
  else if (st.phase === Phase.Halftime) timer = fmtTime(left);
  else if (st.phase === Phase.MatchEnd) timer = tr.matchEnd;
  else if (!planted) timer = fmtTime(left);
  const pips = (list: typeof tPlayers, team: Team) => (
    <div class={`pips ${team === Team.T ? 't' : 'ct'}`}>
      {list.map((p) => (
        <div key={p.id} class={`pip ${p.alive ? '' : 'dead'}`} title={p.name}>
          {p.name.slice(0, 1).toUpperCase()}
        </div>
      ))}
    </div>
  );
  return (
    <div class="topbar">
      {pips(ctPlayers, Team.CT)}
      <div class="score ct">{st.scoreCT}</div>
      <div class={`timer ${planted ? 'planted' : ''} ${st.phase === Phase.Freeze ? 'freeze' : ''}`}>
        {planted ? <span class="bomb-icon">💣</span> : timer}
        {st.phase === Phase.Freeze && <div class="sub">{tr.freeze}</div>}
        {st.phase !== Phase.Warmup && st.phase !== Phase.MatchEnd && <div class="round">{`${tr.round} ${st.round}`}</div>}
      </div>
      <div class="score t">{st.scoreT}</div>
      {pips(tPlayers, Team.T)}
    </div>
  );
}

export function WarmupBanner() {
  const st = ui.state.value;
  if (!st || st.phase !== Phase.Warmup) return null;
  const host = st.host === ui.myId.value;
  if (st.settings.practice) return <div class="warmup-banner">{tr.practiceBanner} · ESC → antrenman araçları</div>;
  return <div class="warmup-banner">{host ? 'Hazır olunca ESC → Maçı Başlat' : tr.warmupHost}</div>;
}

export function BottomHud() {
  const h = ui.hud.value;
  const st = ui.state.value;
  if (!h.alive) return null;
  const hpLow = h.hp <= 25;
  const nades = GRENADE_KEYS.map((k, i) => ({ k, n: h.grenades[i] ?? 0 })).filter((g) => g.n > 0);
  return (
    <>
      <div class="hud-left">
        <div class={`hud-box hp ${hpLow ? 'low' : ''}`}>
          <span class="icon">✚</span>
          <span class="val">{h.hp}</span>
        </div>
        <div class="hud-box armor">
          <span class="icon">{h.helmet ? '⛑' : '🛡'}</span>
          <span class="val">{h.armor}</span>
        </div>
        {h.hasDefuser && <div class="hud-chip">✂ {tr.defuser}</div>}
      </div>
      <div class="hud-money">
        <span class="dollar">$</span>
        {h.money}
        {h.inBuyZone && <span class={`buyzone ${h.canBuy ? '' : 'off'}`}>🛒</span>}
      </div>
      <div class="hud-right">
        <div class="weapon-line">
          {nades.map((g) => (
            <span key={g.k} class="nade" title={weaponByNum(0) ? g.k : ''}>
              <img src={weaponIcon(g.k, 'white')} />
              {g.n > 1 && <b>×{g.n}</b>}
            </span>
          ))}
          {h.hasC4 && <span class="c4tag">C4</span>}
        </div>
        <div class="hud-box ammo">
          <img class="wicon" src={weaponIcon(h.weaponKey, 'white')} />
          {h.clip >= 0 ? (
            <>
              <span class={`val ${h.clip <= Math.max(3, (weaponByNum(h.weaponNum)?.clip ?? 30) * 0.2) ? 'low' : ''}`}>{h.clip}</span>
              <span class="reserve">/ {h.reserve}</span>
            </>
          ) : (
            <span class="val small">{h.weaponName}</span>
          )}
        </div>
        <div class="weapon-name">
          {h.weaponName}
          {h.burst ? ' · seri' : ''}
          {st?.settings.practice ? ' · ∞' : ''}
        </div>
      </div>
      {(h.plantProgress > 0 || h.defuseProgress > 0) && (
        <div class="progress-wrap">
          <div class="progress-label">{h.plantProgress > 0 ? tr.planting : tr.defusing}</div>
          <div class="progress">
            <div class="bar" style={{ width: `${Math.round((h.plantProgress || h.defuseProgress) * 100)}%` }} />
          </div>
        </div>
      )}
    </>
  );
}

export function DefuseWatcher() {
  // başkası imha ederken (izleyici/takım) çubuk
  const st = ui.state.value;
  const h = ui.hud.value;
  if (!st || h.alive || st.bomb.defuser < 0 || h.defuseProgress <= 0) return null;
  return (
    <div class="progress-wrap">
      <div class="progress-label">{`${playerById(st.bomb.defuser)?.name ?? ''} — ${tr.defusing}`}</div>
      <div class="progress">
        <div class="bar" style={{ width: `${Math.round(h.defuseProgress * 100)}%` }} />
      </div>
    </div>
  );
}

export function Killfeed() {
  const list = ui.killfeed.value;
  const now = performance.now();
  return (
    <div class="killfeed">
      {list
        .filter((k) => now - k.t < 7000)
        .map((k) => (
          <div key={k.id} class={`kf ${k.mine ? 'mine' : ''}`}>
            {k.blind && <span class="kf-flag">◉</span>}
            {k.killer && <span class={`kf-name ${k.killerTeam === Team.T ? 't' : 'ct'}`}>{k.killer}</span>}
            {k.assister && <span class="kf-assist">+ {k.assister}</span>}
            <img class="kf-weapon" src={weaponIcon(k.weapon, 'white')} />
            {k.noscope && <span class="kf-flag">⊘</span>}
            {k.smoke && <span class="kf-flag">☁</span>}
            {k.wb && <span class="kf-flag">⇶</span>}
            {k.hs && <span class="kf-flag hs">✖</span>}
            <span class={`kf-name ${k.victimTeam === Team.T ? 't' : 'ct'}`}>{k.victim}</span>
          </div>
        ))}
    </div>
  );
}

export function Notices() {
  const list = ui.notices.value;
  const now = performance.now();
  return (
    <div class="notices">
      {list
        .filter((n) => now - n.t < 5000)
        .map((n) => (
          <div key={n.id} class={`notice ${n.kind}`}>
            {n.text}
          </div>
        ))}
    </div>
  );
}

export function CenterText() {
  const c = ui.centerText.value;
  if (!c || performance.now() - c.t > 5500) return null;
  return (
    <div class={`center-text ${c.kind ?? ''}`}>
      <div class="big">{c.text}</div>
      {c.sub && <div class="small">{c.sub}</div>}
    </div>
  );
}

export function DamageIndicators() {
  const list = ui.damageDirs.value;
  const now = performance.now();
  return (
    <div class="dmg-ind">
      {list
        .filter((d) => now - d.t < 1400)
        .map((d) => (
          <div key={d.id} class="dmg-arc" style={{ transform: `translate(-50%, -50%) rotate(${-d.angle}deg)`, opacity: 1 - (now - d.t) / 1400 }} />
        ))}
    </div>
  );
}

export function DeathPanel() {
  const d = ui.deathInfo.value;
  const h = ui.hud.value;
  if (h.alive) return null;
  return (
    <>
      {h.spectating && (
        <div class="spectate-bar">
          {tr.spectating}: <b>{h.spectating}</b> <span class="hp">✚ {h.spectatingHp}</span>
        </div>
      )}
      {d && d.killer && (
        <div class="death-panel">
          {tr.killedBy}: <b>{d.killer}</b> — {d.weapon}
          {d.hs ? ' (kafadan)' : ''} · <span class="hp">✚ {d.hp}</span>
        </div>
      )}
    </>
  );
}

export function DamageReport() {
  const r = ui.damageReport.value;
  if (!r || performance.now() - r.t > 8000) return null;
  return (
    <div class="damage-report">
      {r.given.map((g) => (
        <div key={`g${g.name}`} class="dr given">
          → {g.name}: <b>{g.dmg}</b> ({g.hits} {tr.hits})
        </div>
      ))}
      {r.taken.map((g) => (
        <div key={`t${g.name}`} class="dr taken">
          ← {g.name}: <b>{g.dmg}</b> ({g.hits} {tr.hits})
        </div>
      ))}
    </div>
  );
}

export function NetGraph() {
  const h = ui.hud.value;
  if (!settings.showFps && !settings.netGraph) return null;
  return (
    <div class="netgraph">
      {settings.showFps && <span>FPS {h.fps}</span>}
      {settings.netGraph && (
        <>
          <span>ping {h.ping} ms</span>
          <span>kayıp %{h.loss}</span>
          <span>
            ↓{h.inKbps} ↑{h.outKbps} kbps
          </span>
          <span>interp {h.interpMs} ms</span>
          <span>tick 64</span>
        </>
      )}
    </div>
  );
}

const RADAR_SIZE = 230;
const RADAR_RANGE = 1500;

export function Radar({ game }: { game: Game }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const bg = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    // harita arka planı (üstten)
    const map = game.map;
    const c = document.createElement('canvas');
    const W = map.bounds.maxs.x - map.bounds.mins.x;
    const H = map.bounds.maxs.y - map.bounds.mins.y;
    const scale = 0.25;
    c.width = W * scale;
    c.height = H * scale;
    const g = c.getContext('2d')!;
    g.fillStyle = 'rgba(25,28,30,0.0)';
    g.fillRect(0, 0, c.width, c.height);
    const toC = (x: number, y: number) => [(x - map.bounds.mins.x) * scale, (map.bounds.maxs.y - y) * scale] as const;
    g.fillStyle = 'rgba(205,190,160,0.55)';
    for (const a of map.areas) {
      const [x0, y0] = toC(a.x0, a.y1);
      g.fillRect(x0, y0, (a.x1 - a.x0) * scale, (a.y1 - a.y0) * scale);
    }
    // engeller (alçak brush'lar)
    g.fillStyle = 'rgba(60,55,48,0.75)';
    for (const b of map.brushes) {
      if (b.nodraw || b.mins.z < -1 || b.maxs.z > 260 || b.maxs.z < 20) continue;
      const [x0, y0] = toC(b.mins.x, b.maxs.y);
      g.fillRect(x0, y0, (b.maxs.x - b.mins.x) * scale, (b.maxs.y - b.mins.y) * scale);
    }
    // bomba bölgesi
    for (const t of map.triggers) {
      if (t.kind !== 'bombsite') continue;
      const [x0, y0] = toC(t.mins.x, t.maxs.y);
      g.fillStyle = 'rgba(200,60,40,0.18)';
      g.fillRect(x0, y0, (t.maxs.x - t.mins.x) * scale, (t.maxs.y - t.mins.y) * scale);
      g.fillStyle = 'rgba(230,80,60,0.95)';
      g.font = 'bold 34px sans-serif';
      g.fillText('A', x0 + ((t.maxs.x - t.mins.x) * scale) / 2 - 11, y0 + ((t.maxs.y - t.mins.y) * scale) / 2 + 12);
    }
    bg.current = c;
    let raf = 0;
    let lastSpot = 0;
    const spotted = new Set<number>();
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      const cv = ref.current;
      if (!cv || !bg.current) return;
      const ctx = cv.getContext('2d')!;
      const { players, bomb } = game.radarData();
      const me = players.find((p) => p.me);
      const st = ui.state.value;
      const myTeam = me?.team ?? Team.None;
      // görülen düşmanlar (CS'teki "spotted")
      if (now - lastSpot > 120) {
        lastSpot = now;
        spotted.clear();
        const mates = players.filter((p) => p.alive && p.team === myTeam);
        for (const e of players) {
          if (!e.alive || e.team === myTeam) continue;
          for (const m of mates) {
            const tr2 = game.world.traceRay({ x: m.x, y: m.y, z: 60 + (game.sim?.move.origin.z ?? 0) }, { x: e.x, y: e.y, z: 50 }, 1);
            if (tr2.fraction >= 0.999) {
              spotted.add(e.id);
              break;
            }
          }
        }
      }
      const S = RADAR_SIZE;
      ctx.clearRect(0, 0, S, S);
      ctx.save();
      ctx.beginPath();
      ctx.arc(S / 2, S / 2, S / 2 - 2, 0, Math.PI * 2);
      ctx.clip();
      ctx.fillStyle = 'rgba(12,14,16,0.72)';
      ctx.fillRect(0, 0, S, S);
      const cx = me ? me.x : 0;
      const cy = me ? me.y : 0;
      const k = S / 2 / RADAR_RANGE;
      const rot = me ? ((me.yaw - 90) * Math.PI) / 180 : 0;
      ctx.translate(S / 2, S / 2);
      ctx.rotate(rot);
      const map = game.map;
      ctx.drawImage(bg.current, (map.bounds.mins.x - cx) * k, -(map.bounds.maxs.y - cy) * k, (map.bounds.maxs.x - map.bounds.mins.x) * k, (map.bounds.maxs.y - map.bounds.mins.y) * k);
      const dot = (x: number, y: number) => [(x - cx) * k, -(y - cy) * k] as const;
      if (bomb && (myTeam === Team.T || bomb.state === BombState.Planted)) {
        const [bx, by] = dot(bomb.pos.x, bomb.pos.y);
        ctx.fillStyle = bomb.state === BombState.Planted ? (Math.floor(now / 300) % 2 ? '#ff4433' : '#aa2211') : '#e0c040';
        ctx.fillRect(bx - 5, by - 4, 10, 8);
      }
      for (const p of players) {
        if (p.me) continue;
        const enemy = p.team !== myTeam;
        if (enemy && !spotted.has(p.id) && !st?.settings.practice) continue;
        const [px, py] = dot(p.x, p.y);
        if (!p.alive) {
          ctx.strokeStyle = enemy ? '#c44' : '#888';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(px - 4, py - 4);
          ctx.lineTo(px + 4, py + 4);
          ctx.moveTo(px + 4, py - 4);
          ctx.lineTo(px - 4, py + 4);
          ctx.stroke();
          continue;
        }
        ctx.fillStyle = enemy ? '#e04535' : p.team === Team.T ? '#e8b64c' : '#5fa3e8';
        ctx.beginPath();
        ctx.arc(px, py, 5, 0, Math.PI * 2);
        ctx.fill();
        const a = (-p.yaw * Math.PI) / 180;
        ctx.strokeStyle = ctx.fillStyle;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px + Math.cos(a) * 11, py + Math.sin(a) * 11);
        ctx.stroke();
      }
      ctx.restore();
      // ben (merkez, yukarı bakan)
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(S / 2, S / 2 - 8);
      ctx.lineTo(S / 2 - 5, S / 2 + 5);
      ctx.lineTo(S / 2 + 5, S / 2 + 5);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(S / 2, S / 2, S / 2 - 2, 0, Math.PI * 2);
      ctx.stroke();
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [game]);
  const loc = ui.hud.value.location;
  return (
    <div class="radar">
      <canvas ref={ref} width={RADAR_SIZE} height={RADAR_SIZE} />
      <div class="location">{loc}</div>
    </div>
  );
}

export function ChatFeed() {
  const list = ui.chat.value;
  const now = performance.now();
  const open = ui.chatOpen.value !== null;
  return (
    <div class="chat-feed">
      {list
        .filter((c) => open || now - c.t < 9000)
        .slice(-8)
        .map((c) => (
          <div key={c.id} class="chat-line">
            {c.dead && <span class="dead">*ÖLÜ* </span>}
            {c.team && <span class="teamtag">(Takım) </span>}
            <span class={c.teamId === Team.T ? 't' : c.teamId === Team.CT ? 'ct' : ''}>{c.name}</span>: {c.text}
          </div>
        ))}
    </div>
  );
}

export function ScopeHint() {
  return null;
}

export { weaponByNum };

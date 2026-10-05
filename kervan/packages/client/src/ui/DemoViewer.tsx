/** Demo izleyici: zaman çizelgesi, ağır çekim, oyuncu gözünden izleme, hile olayları. */
import { useEffect, useState } from 'preact/hooks';
import { TICK_RATE, DemoFile } from '@kervan/shared';
import type { Game } from '../game/game';
import { ui } from './store';
import { getGame } from './gameRef';

const SPEEDS = [0.25, 0.5, 1, 2];

function fmt(ticks: number): string {
  const s = Math.max(0, ticks / TICK_RATE);
  return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
}

export function openDemoFile(game: Game) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.onchange = () => {
    const f = input.files?.[0];
    if (!f) return;
    void f.text().then((txt) => {
      try {
        game.playDemo(JSON.parse(txt) as DemoFile);
      } catch (err) {
        ui.error.value = `Demo açılamadı: ${(err as Error).message}`;
        ui.screen.value = 'error';
      }
    });
  };
  input.click();
}

export function DemoViewer() {
  const game = getGame();
  const [, force] = useState(0);
  useEffect(() => {
    const t = setInterval(() => force((x) => x + 1), 100);
    const key = (e: KeyboardEvent) => {
      const i = game.demoInfo();
      if (!i) return;
      if (e.code === 'Space') game.demoControl({ paused: !i.paused });
      else if (e.code === 'ArrowLeft') game.demoControl({ seek: Math.max(i.start, i.tick - TICK_RATE * 2) });
      else if (e.code === 'ArrowRight') game.demoControl({ seek: Math.min(i.end, i.tick + TICK_RATE * 2) });
      else if (e.code === 'Comma') game.demoControl({ paused: true, seek: Math.max(i.start, Math.floor(i.tick) - 1) });
      else if (e.code === 'Period') game.demoControl({ paused: true, seek: Math.min(i.end, Math.floor(i.tick) + 1) });
      else if (e.code === 'Escape') game.stopDemo();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', key);
    return () => {
      clearInterval(t);
      window.removeEventListener('keydown', key);
    };
  }, []);
  const i = game.demoInfo();
  if (!i) return null;
  const name = (id: number) => i.names.get(id) ?? `#${id}`;
  const marks = i.events.filter((e) => e.k === 'ac' || e.k === 'kick' || e.k === 'honeypot' || e.k === 'kill');
  const span = Math.max(1, i.end - i.start);
  return (
    <div class="demo-ui">
      <div class="demo-top">
        <b>DEMO</b> · {i.file.room} · round
        <select value={i.round} onChange={(e) => game.demoRound(Number((e.target as HTMLSelectElement).value))}>
          {i.file.rounds.map((r, k) => (
            <option key={k} value={k}>
              {r.round === 0 ? 'ısınma' : r.round}
              {r.evidenceFor !== undefined ? ` (kanıt: ${name(r.evidenceFor)})` : ''}
            </option>
          ))}
        </select>
        <span class="demo-pov">
          Göz:
          {i.present.map((id) => (
            <button key={id} class={`btn small ${id === i.pov ? 'primary' : ''}`} onClick={() => game.demoControl({ pov: id })}>
              {name(id)}
            </button>
          ))}
        </span>
        <button class="btn small danger" onClick={() => game.stopDemo()}>
          Kapat
        </button>
      </div>
      <div class="demo-events">
        {marks.map((e, k) => (
          <button key={k} class={`demo-ev ${e.k}`} onClick={() => game.demoControl({ seek: Math.max(i.start, e.tick - TICK_RATE), pov: e.k === 'honeypot' ? e.viewer : e.k === 'kill' ? e.a : e.id, paused: false, speed: 0.25 })}>
            <span class="t">{fmt(e.tick - i.start)}</span>
            {e.k === 'kill' && `${e.a >= 0 ? name(e.a) : 'dünya'} → ${name(e.v)}${e.hs ? ' (kafa)' : ''}`}
            {e.k === 'ac' && `${name(e.id)}: ${e.text}`}
            {e.k === 'kick' && `${name(e.id)} ATILDI: ${e.text}`}
            {e.k === 'honeypot' && `bal tuzağı → ${name(e.viewer)}`}
          </button>
        ))}
        {marks.length === 0 && <div class="demo-empty">Bu round'da olay yok</div>}
      </div>
      <div class="demo-bar">
        <button class="btn small" onClick={() => game.demoControl({ paused: !i.paused })}>
          {i.paused ? '▶' : '❚❚'}
        </button>
        <span class="demo-time">
          {fmt(i.tick - i.start)} / {fmt(span)}
        </span>
        <div class="demo-track">
          {marks.map((e, k) => (
            <span key={k} class={`demo-mark ${e.k}`} style={{ left: `${((e.tick - i.start) / span) * 100}%` }} />
          ))}
          <input type="range" min={i.start} max={i.end} step={1} value={i.tick} onInput={(e) => game.demoControl({ seek: Number((e.target as HTMLInputElement).value) })} />
        </div>
        {SPEEDS.map((s) => (
          <button key={s} class={`btn small ${s === i.speed ? 'primary' : ''}`} onClick={() => game.demoControl({ speed: s })}>
            {s}×
          </button>
        ))}
      </div>
      <div class="demo-help">Boşluk: oynat/durdur · ←/→: 2 sn · ,/.: tek tick · kırmızı kutu: bal tuzağı (sahte oyuncu)</div>
    </div>
  );
}

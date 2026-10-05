/** Uygulama kabuğu: ana menü, bağlantı ekranı, oyun içi arayüz. */
import { useEffect, useState } from 'preact/hooks';
import { ui } from './store';
import { tr } from '../i18n/tr';
import { settings, saveSettings } from '../settings';
import type { Game } from '../game/game';
import { TopBar, WarmupBanner, BottomHud, Killfeed, Notices, CenterText, DamageIndicators, DeathPanel, DamageReport, NetGraph, Radar, ChatFeed, DefuseWatcher } from './Hud';
import { BuyMenu } from './BuyMenu';
import { Scoreboard, EscMenu, TeamMenu, MatchSettingsPanel, ChatInput, AcPanel } from './Menus';
import { SettingsPanel, closeSettings } from './Settings';
import { Console } from './Console';
import { DemoViewer, openDemoFile } from './DemoViewer';

function MainMenu({ game }: { game: Game }) {
  const params = new URLSearchParams(location.search);
  const [name, setName] = useState(settings.name);
  const [code, setCode] = useState(params.get('oda') ?? '');
  const [rooms, setRooms] = useState<{ code: string; players: number; practice: boolean }[]>([]);
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch('/api/rooms')
        .then((r) => r.json())
        .then((l) => alive && setRooms(l))
        .catch(() => {});
    load();
    const t = setInterval(load, 4000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  const ok = name.trim().length > 0;
  const go = (opts: { room?: string; create?: boolean; practice?: boolean }) => {
    if (!ok) return;
    settings.name = name.trim().slice(0, 24);
    saveSettings();
    void game.connect({ name: settings.name, ...opts });
  };
  return (
    <div class="main-menu">
      <div class="menu-card">
        <div class="logo">
          <span class="k">K</span>ERVAN
        </div>
        <div class="tagline">{tr.subtitle}</div>
        <label class="field">
          <span>{tr.nickname}</span>
          <input value={name} maxLength={24} placeholder={tr.nicknamePh} onInput={(e) => setName((e.target as HTMLInputElement).value)} />
        </label>
        <div class="menu-actions">
          <button class="btn primary big" disabled={!ok} onClick={() => go({ create: true })}>
            {tr.createRoom}
          </button>
          <div class="join-row">
            <input
              class="code-input"
              value={code}
              placeholder="ABC-1234"
              onInput={(e) => setCode((e.target as HTMLInputElement).value.toUpperCase())}
              onKeyDown={(e) => e.key === 'Enter' && code && go({ room: code })}
            />
            <button class="btn big" disabled={!ok || !code} onClick={() => go({ room: code })}>
              {tr.joinRoom}
            </button>
          </div>
          <button class="btn big" disabled={!ok} onClick={() => go({ create: true, practice: true })}>
            {tr.practice}
          </button>
          <div class="btn-row">
            <button class="btn" onClick={() => (ui.settingsOpen.value = true)}>
              {tr.settings}
            </button>
            <button class="btn" onClick={() => openDemoFile(game)}>
              Demo izle
            </button>
          </div>
        </div>
        <div class="room-list">
          <div class="rl-title">{tr.rooms}</div>
          {rooms.filter((r) => !r.practice).length === 0 && <div class="rl-empty">{tr.noRooms}</div>}
          {rooms
            .filter((r) => !r.practice)
            .map((r) => (
              <button key={r.code} class="rl-item" disabled={!ok} onClick={() => go({ room: r.code })}>
                <span>{r.code}</span>
                <span>{r.players} oyuncu</span>
              </button>
            ))}
        </div>
        <div class="menu-foot">Wingman 2v2 · de_kervan · 64 tick · CS2 fizik ve silah değerleri</div>
      </div>
      {ui.settingsOpen.value && <SettingsPanel onClose={() => (ui.settingsOpen.value = false)} />}
    </div>
  );
}

function GameUI({ game }: { game: Game }) {
  // HUD sinyaline abone ol → zaman tabanlı öğeler düzenli yenilenir
  void ui.hud.value;
  const locked = ui.pointerLocked.value;
  return (
    <div class="game-ui">
      <Radar game={game} />
      <TopBar />
      <WarmupBanner />
      <Killfeed />
      <Notices />
      <CenterText />
      <DamageIndicators />
      <BottomHud />
      <DefuseWatcher />
      <DeathPanel />
      <DamageReport />
      <ChatFeed />
      <NetGraph />
      <ChatInput game={game} />
      <BuyMenu game={game} />
      <Scoreboard />
      <TeamMenu game={game} />
      <MatchSettingsPanel game={game} />
      <AcPanel game={game} />
      <EscMenu game={game} />
      <Console game={game} />
      {ui.settingsOpen.value && <SettingsPanel onClose={() => closeSettings(game)} />}
      {!locked && !game.anyMenuOpen() && <div class="click-to-play">Oynamak için tıkla</div>}
    </div>
  );
}

export function App({ game }: { game: Game }) {
  const s = ui.screen.value;
  return (
    <>
      {s === 'menu' && <MainMenu game={game} />}
      {s === 'connecting' && (
        <div class="center-screen">
          <div class="spinner" />
          {ui.connectingText.value}
        </div>
      )}
      {s === 'error' && (
        <div class="center-screen">
          <div class="err-text">{ui.error.value}</div>
          <button
            class="btn primary"
            onClick={() => {
              ui.screen.value = 'menu';
              game.disconnect();
            }}
          >
            {tr.back}
          </button>
        </div>
      )}
      {s === 'game' && <GameUI game={game} />}
      {s === 'demo' && <DemoViewer game={game} />}
      {s !== 'game' && ui.consoleOpen.value && <Console game={game} />}
    </>
  );
}

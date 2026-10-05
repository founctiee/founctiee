/** Skor tablosu, ESC menüsü, takım seçimi, maç ayarları, sohbet girişi. */
import { useEffect, useRef, useState } from 'preact/hooks';
import { Team, Phase, PlayerInfo, MatchSettings } from '@kervan/shared';
import { ui } from './store';
import { tr } from '../i18n/tr';
import type { Game } from '../game/game';

export function Scoreboard() {
  const st = ui.state.value;
  if (!ui.scoreOpen.value || !st) return null;
  const myTeam = st.players.find((p) => p.id === ui.myId.value)?.team ?? Team.None;
  const table = (team: Team, title: string, score: number) => {
    const list = st.players.filter((p) => p.team === team).sort((a, b) => b.k - a.k || a.d - b.d);
    return (
      <div class={`sb-team ${team === Team.T ? 't' : 'ct'}`}>
        <div class="sb-head">
          <span class="sb-score">{score}</span>
          <span class="sb-title">{title}</span>
        </div>
        <table>
          <thead>
            <tr>
              <th class="name">{tr.name}</th>
              <th>{tr.money}</th>
              <th title="Öldürme">Leş</th>
              <th title="Asist">Asist</th>
              <th title="Ölüm">Ölüm</th>
              <th>{tr.adr}</th>
              <th>{tr.hsp}</th>
              <th>MVP</th>
              <th>{tr.ping}</th>
            </tr>
          </thead>
          <tbody>
            {list.map((p: PlayerInfo) => (
              <tr key={p.id} class={`${p.alive ? '' : 'dead'} ${p.id === ui.myId.value ? 'me' : ''}`}>
                <td class="name">
                  {p.host && <span class="tag">★</span>}
                  {p.name}
                  {!p.connected && <span class="tag off"> (koptu)</span>}
                  {p.bomb && team === myTeam && <span class="tag bomb"> 💣</span>}
                  {p.defuser && team === myTeam && <span class="tag"> ✂</span>}
                </td>
                <td>{team === myTeam || st.phase === Phase.MatchEnd ? `$${p.money}` : ''}</td>
                <td>{p.k}</td>
                <td>{p.a}</td>
                <td>{p.d}</td>
                <td>{p.rounds > 0 ? Math.round(p.dmg / p.rounds) : 0}</td>
                <td>{p.k > 0 ? `${Math.round((p.hs / p.k) * 100)}%` : '0%'}</td>
                <td>{p.mvp > 0 ? `★${p.mvp}` : ''}</td>
                <td>{p.ping}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };
  const spectators = st.players.filter((p) => p.team !== Team.T && p.team !== Team.CT);
  return (
    <div class="overlay pass">
      <div class="scoreboard">
        <div class="sb-top">
          <span>{st.map}</span>
          <span>
            {tr.round} {st.round}
            {st.overtime ? ` · Uzatma ${st.overtime}` : ''}
          </span>
          <span>Oda: {st.room}</span>
        </div>
        {table(Team.CT, tr.cts, st.scoreCT)}
        <div class="sb-history">
          {Array.from({ length: st.settings.maxRounds }, (_, i) => {
            const w = st.history[i];
            return <span key={i} class={`r ${w === Team.T ? 't' : w === Team.CT ? 'ct' : ''} ${i === st.settings.maxRounds / 2 - 1 ? 'half' : ''}`} />;
          })}
        </div>
        {table(Team.T, tr.terrorists, st.scoreT)}
        {spectators.length > 0 && <div class="sb-spec">{`${tr.spectators}: ${spectators.map((s) => s.name).join(', ')}`}</div>}
      </div>
    </div>
  );
}

export function EscMenu({ game }: { game: Game }) {
  const [copied, setCopied] = useState(false);
  if (!ui.escOpen.value) return null;
  const st = ui.state.value;
  const host = st?.host === ui.myId.value;
  const close = () => {
    ui.escOpen.value = false;
    game.syncInputState();
    void game.input.lock();
  };
  const link = `${location.origin}${location.pathname}?oda=${ui.room.value}`;
  return (
    <div class="overlay">
      <div class="panel esc-menu">
        <div class="panel-title">{tr.title}</div>
        <div class="room-code">
          Oda kodu: <b>{ui.room.value}</b>
        </div>
        <button class="btn primary" onClick={close}>
          {tr.resume}
        </button>
        <button
          class="btn"
          onClick={() => {
            void navigator.clipboard?.writeText(link).then(() => setCopied(true));
          }}
        >
          {copied ? tr.copied : tr.copyInvite}
        </button>
        <button
          class="btn"
          onClick={() => {
            ui.escOpen.value = false;
            ui.teamMenuOpen.value = true;
          }}
        >
          {tr.changeTeam}
        </button>
        {host && st && !st.settings.practice && (st.phase === Phase.Warmup || st.phase === Phase.MatchEnd) && (
          <>
            <button
              class="btn good"
              onClick={() => {
                game.conn?.send({ t: 'start' });
                close();
              }}
            >
              {tr.startMatch}
            </button>
            <button
              class="btn"
              onClick={() => {
                ui.escOpen.value = false;
                ui.matchSettingsOpen.value = true;
              }}
            >
              {tr.matchSettings}
            </button>
          </>
        )}
        {st?.settings.practice && (
          <div class="practice-tools">
            <button class="btn small" onClick={() => game.conn?.send({ t: 'cheat', name: 'noclip' })}>
              noclip
            </button>
            <button class="btn small" onClick={() => game.conn?.send({ t: 'cheat', name: 'god' })}>
              ölümsüzlük
            </button>
            <button class="btn small" onClick={() => game.conn?.send({ t: 'cheat', name: 'restart' })}>
              yeniden doğ
            </button>
          </div>
        )}
        <button
          class="btn"
          onClick={() => {
            ui.escOpen.value = false;
            ui.settingsOpen.value = true;
          }}
        >
          {tr.settings}
        </button>
        <button class="btn danger" onClick={() => game.disconnect()}>
          {tr.leave}
        </button>
      </div>
    </div>
  );
}

export function TeamMenu({ game }: { game: Game }) {
  if (!ui.teamMenuOpen.value) return null;
  const st = ui.state.value;
  const count = (t: Team) => st?.players.filter((p) => p.team === t).length ?? 0;
  const pick = (t: Team) => {
    game.conn?.send({ t: 'team', team: t });
    ui.teamMenuOpen.value = false;
    game.syncInputState();
    void game.input.lock();
  };
  return (
    <div class="overlay">
      <div class="panel team-menu">
        <div class="panel-title">{tr.changeTeam}</div>
        <div class="team-cards">
          <button class="team-card t" onClick={() => pick(Team.T)}>
            <div class="tn">{tr.terrorists}</div>
            <div class="tc">{count(Team.T)} oyuncu</div>
          </button>
          <button class="team-card ct" onClick={() => pick(Team.CT)}>
            <div class="tn">{tr.cts}</div>
            <div class="tc">{count(Team.CT)} oyuncu</div>
          </button>
        </div>
        <button class="btn" onClick={() => pick(Team.Spectator)}>
          {tr.spectators}
        </button>
        <button
          class="btn"
          onClick={() => {
            ui.teamMenuOpen.value = false;
            game.syncInputState();
          }}
        >
          {tr.close}
        </button>
      </div>
    </div>
  );
}

export function MatchSettingsPanel({ game }: { game: Game }) {
  const st = ui.state.value;
  const [s, setS] = useState<MatchSettings | null>(null);
  useEffect(() => {
    if (ui.matchSettingsOpen.value && st) setS({ ...st.settings });
  }, [ui.matchSettingsOpen.value]);
  if (!ui.matchSettingsOpen.value || !s) return null;
  const num = (key: keyof MatchSettings, label: string, step = 1) => (
    <label class="row">
      <span>{label}</span>
      <input type="number" step={step} value={s[key] as number} onInput={(e) => setS({ ...s, [key]: Number((e.target as HTMLInputElement).value) })} />
    </label>
  );
  const bool = (key: keyof MatchSettings, label: string) => (
    <label class="row">
      <span>{label}</span>
      <input type="checkbox" checked={s[key] as boolean} onChange={(e) => setS({ ...s, [key]: (e.target as HTMLInputElement).checked })} />
    </label>
  );
  const close = () => {
    ui.matchSettingsOpen.value = false;
    game.syncInputState();
  };
  return (
    <div class="overlay">
      <div class="panel settings-panel">
        <div class="panel-title">{tr.matchSettings}</div>
        {num('maxRounds', tr.msMaxRounds, 2)}
        {num('roundTime', tr.msRoundTime, 5)}
        {num('freezeTime', tr.msFreezeTime)}
        {num('buyTime', tr.msBuyTime)}
        {num('c4Timer', tr.msC4)}
        {num('startMoney', tr.msStartMoney, 100)}
        {num('maxMoney', tr.msMaxMoney, 1000)}
        {bool('friendlyFire', tr.msFF)}
        {bool('overtime', tr.msOvertime)}
        {bool('showImpacts', tr.msImpacts)}
        <div class="btn-row">
          <button
            class="btn primary"
            onClick={() => {
              game.conn?.send({ t: 'settings', settings: s });
              close();
            }}
          >
            {tr.apply}
          </button>
          <button class="btn" onClick={close}>
            {tr.close}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ChatInput({ game }: { game: Game }) {
  const mode = ui.chatOpen.value;
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (mode) setTimeout(() => ref.current?.focus(), 0);
  }, [mode]);
  if (!mode) return null;
  const close = () => {
    ui.chatOpen.value = null;
    game.syncInputState();
    void game.input.lock();
  };
  return (
    <div class="chat-input">
      <span class="mode">{mode === 'team' ? tr.chatTeam : tr.chatAll}:</span>
      <input
        ref={ref}
        maxLength={160}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            const v = (e.target as HTMLInputElement).value.trim();
            if (v) game.conn?.send({ t: 'chat', text: v, team: mode === 'team' });
            close();
          } else if (e.key === 'Escape') close();
          e.stopPropagation();
        }}
      />
    </div>
  );
}

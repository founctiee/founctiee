/** Arayüz durumu (Preact signals). Oyun döngüsü bunları günceller, bileşenler okur. */
import { signal } from '@preact/signals';
import type { GameState, PlayerInfo, AcReportPlayer } from '@kervan/shared';

export type Screen = 'menu' | 'connecting' | 'game' | 'error' | 'demo';

export interface KillEntry {
  id: number;
  killer: string;
  killerTeam: number;
  victim: string;
  victimTeam: number;
  weapon: string;
  hs: boolean;
  wb: boolean;
  smoke: boolean;
  blind: boolean;
  noscope: boolean;
  assister: string;
  mine: boolean;
  t: number;
}

export interface Notice {
  id: number;
  text: string;
  kind: 'info' | 'warn' | 'good';
  t: number;
}

export interface ChatEntry {
  id: number;
  name: string;
  text: string;
  team: boolean;
  teamId: number;
  dead: boolean;
  t: number;
}

export interface HudState {
  hp: number;
  armor: number;
  helmet: boolean;
  money: number;
  clip: number;
  reserve: number;
  weaponKey: string;
  weaponName: string;
  weaponNum: number;
  grenades: number[];
  hasC4: boolean;
  hasDefuser: boolean;
  alive: boolean;
  inBuyZone: boolean;
  canBuy: boolean;
  plantProgress: number;
  defuseProgress: number;
  scoped: boolean;
  location: string;
  spectating: string;
  spectatingHp: number;
  reloading: boolean;
  silencer: boolean;
  burst: boolean;
  serverTick: number;
  fps: number;
  ping: number;
  loss: number;
  inKbps: number;
  outKbps: number;
  interpMs: number;
}

export const ui = {
  screen: signal<Screen>('menu'),
  error: signal(''),
  connectingText: signal(''),
  state: signal<GameState | null>(null),
  myId: signal(-1),
  room: signal(''),
  hud: signal<HudState>({
    hp: 100,
    armor: 0,
    helmet: false,
    money: 0,
    clip: 0,
    reserve: 0,
    weaponKey: 'knife',
    weaponName: 'Bıçak',
    weaponNum: 0,
    grenades: [0, 0, 0, 0, 0, 0],
    hasC4: false,
    hasDefuser: false,
    alive: false,
    inBuyZone: false,
    canBuy: false,
    plantProgress: 0,
    defuseProgress: 0,
    scoped: false,
    location: '',
    spectating: '',
    spectatingHp: 0,
    reloading: false,
    silencer: false,
    burst: false,
    serverTick: 0,
    fps: 0,
    ping: 0,
    loss: 0,
    inKbps: 0,
    outKbps: 0,
    interpMs: 0,
  }),
  buyOpen: signal(false),
  scoreOpen: signal(false),
  escOpen: signal(false),
  settingsOpen: signal(false),
  consoleOpen: signal(false),
  teamMenuOpen: signal(false),
  matchSettingsOpen: signal(false),
  chatOpen: signal<null | 'all' | 'team'>(null),
  killfeed: signal<KillEntry[]>([]),
  notices: signal<Notice[]>([]),
  chat: signal<ChatEntry[]>([]),
  centerText: signal<{ text: string; sub?: string; t: number; kind?: 'tw' | 'ctw' | 'info' } | null>(null),
  damageDirs: signal<{ id: number; angle: number; t: number }[]>([]),
  deathInfo: signal<{ killer: string; weapon: string; hs: boolean; hp: number } | null>(null),
  damageReport: signal<{ given: { name: string; dmg: number; hits: number }[]; taken: { name: string; dmg: number; hits: number }[]; t: number } | null>(null),
  consoleLines: signal<string[]>([]),
  pointerLocked: signal(false),
  acOpen: signal(false),
  acReport: signal<{ auto: boolean; players: AcReportPlayer[]; bans: { key: string; name: string; reason: string }[] } | null>(null),
};

export function playerById(id: number): PlayerInfo | undefined {
  return ui.state.value?.players.find((p) => p.id === id);
}

let noticeId = 1;
export function pushNotice(text: string, kind: Notice['kind'] = 'info') {
  if (!text) return;
  const now = performance.now();
  ui.notices.value = [...ui.notices.value.filter((n) => now - n.t < 5000).slice(-4), { id: noticeId++, text, kind, t: now }];
}

export function log(line: string) {
  ui.consoleLines.value = [...ui.consoleLines.value.slice(-300), line];
}

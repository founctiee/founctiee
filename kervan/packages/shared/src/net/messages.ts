/** JSON mesaj tipleri (düşük frekanslı, güvenilir). */
import type { MatchSettings, Phase, RoundEndReason, BombState } from '../game/rules';
import type { Team } from '../game/player';

export type V3 = [number, number, number];

// ───────────── istemci → sunucu ─────────────
export type ClientMsg =
  | { t: 'join'; name: string; room?: string; create?: boolean; practice?: boolean; version: number; token?: string }
  | { t: 'team'; team: Team }
  | { t: 'buy'; item: string }
  | { t: 'drop' }
  | { t: 'chat'; text: string; team: boolean }
  | { t: 'start' }
  | { t: 'settings'; settings: Partial<MatchSettings> }
  | { t: 'pong'; s: number }
  | { t: 'cheat'; name: 'noclip' | 'god' | 'money' | 'restart' | 'setpos'; args?: number[] }
  | { t: 'leave' };

// ───────────── sunucu → istemci ─────────────
export interface PlayerInfo {
  id: number;
  name: string;
  team: Team;
  alive: boolean;
  money: number;
  k: number;
  d: number;
  a: number;
  dmg: number;
  mvp: number;
  hs: number;
  ping: number;
  hp: number;
  armor: number;
  helmet: boolean;
  defuser: boolean;
  bomb: boolean;
  weapon: number;
  host: boolean;
  connected: boolean;
  /** Bu round verilen hasar (ADR için). */
  rounds: number;
}

export interface BombInfo {
  state: BombState;
  pos: V3 | null;
  carrier: number;
  explodeTick: number;
  defuser: number;
  defuseEndTick: number;
  defuseStartTick: number;
}

export interface GameState {
  phase: Phase;
  phaseEndTick: number;
  round: number;
  scoreT: number;
  scoreCT: number;
  history: number[];
  bomb: BombInfo;
  players: PlayerInfo[];
  buyEndTick: number;
  settings: MatchSettings;
  room: string;
  host: number;
  map: string;
  lastWinner: Team;
  lastReason: RoundEndReason;
  mvp: number;
  /** Takımlar devre arasında yer değiştirdi mi (skor tablosunda takım isimleri için). */
  swapped: boolean;
  overtime: number;
}

export type GameEvent =
  | { e: 'shot'; id: number; w: number; m: number; o: V3; d: V3[]; sil: boolean }
  | { e: 'hit'; a: number; v: number; dmg: number; hg: number; p: V3; hp: number; armor: number; from?: V3; hel?: boolean }
  /** Görünmeyen kaynaktan gelen konumlu ses (konum bulanıklaştırılmış). */
  | { e: 'sound'; s: string; p: V3; g?: number; r?: number }
  /** Sadece ölen oyuncuya: öldürenin kalan canı. */
  | { e: 'deathinfo'; k: number; hp: number }
  | {
      e: 'kill';
      k: number;
      v: number;
      w: number;
      hs: boolean;
      wb: boolean;
      smoke: boolean;
      blind: boolean;
      noscope: boolean;
      as: number;
      ff: boolean;
    }
  | { e: 'melee'; id: number; hit: boolean; heavy: boolean; p?: V3 }
  | { e: 'nade_throw'; id: number; type: number; owner: number }
  | { e: 'nade_bounce'; id: number; type: number; p: V3 }
  | { e: 'nade_det'; id: number; type: number; p: V3 }
  | { e: 'smoke'; id: number; p: V3; tick: number }
  | { e: 'smoke_end'; id: number }
  | { e: 'smoke_carve'; id: number; p: V3; r: number }
  | { e: 'inferno'; id: number; p: V3; owner: number; team: number; tick: number }
  | { e: 'inferno_end'; id: number }
  | { e: 'flashed'; dur: number; p: V3 }
  | { e: 'decoy'; id: number; p: V3; w: number }
  | { e: 'plant'; by: number; p: V3 }
  | { e: 'defuse_start'; by: number; kit: boolean }
  | { e: 'defuse_abort'; by: number }
  | { e: 'defused'; by: number }
  | { e: 'explode'; p: V3 }
  | { e: 'round_start'; round: number }
  | { e: 'round_end'; winner: Team; reason: RoundEndReason; mvp: number }
  | { e: 'notice'; text: string; kind?: 'info' | 'warn' | 'good' }
  | { e: 'spawn'; id: number }
  | { e: 'pickup'; id: number; w: number }
  | { e: 'buy'; id: number; item: string }
  | { e: 'reload'; id: number; w: number }
  | { e: 'jump'; id: number }
  | { e: 'land'; id: number; v: number }
  | { e: 'damage_report'; given: { id: number; dmg: number; hits: number }[]; taken: { id: number; dmg: number; hits: number }[] };

export type ServerMsg =
  | { t: 'welcome'; id: number; room: string; tick: number; tickRate: number; map: string; version: number; token: string }
  | { t: 'error'; msg: string }
  | ({ t: 'state' } & GameState)
  | { t: 'ev'; tick: number; list: GameEvent[] }
  | { t: 'ping'; s: number; ping: number }
  | { t: 'chat'; from: number; name: string; text: string; team: boolean; teamId: Team; dead: boolean }
  | { t: 'rooms'; list: { code: string; players: number; phase: Phase; practice: boolean }[] };

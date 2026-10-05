/**
 * Yetkili maç simülasyonu: 64 tick. Oyuncu komutlarını işler, lag compensation ile
 * vuruşları çözer, Wingman round/ekonomi/C4 akışını yönetir.
 */
import {
  World,
  MapDef,
  PlayerSim,
  createPlayerSim,
  Team,
  UserCmd,
  emptyCmd,
  simulateCmd,
  SimEvent,
  ShotEvent,
  MeleeEvent,
  ThrowEvent,
  PlantEvent,
  playerBox,
  EntityBox,
  TICK_RATE,
  TICK_DT,
  MatchSettings,
  DEFAULT_SETTINGS,
  Phase,
  RoundEndReason,
  BombState,
  ECONOMY,
  lossBonus,
  bombDamageAt,
  weapon,
  weaponByNum,
  WeaponDef,
  WEAPON_BY_KEY,
  GRENADE_KEYS,
  GRENADE_LIMITS,
  MAX_GRENADES,
  EQUIPMENT_PRICES,
  makeWeaponItem,
  WeaponItem,
  ITEM_PRIMARY,
  ITEM_SECONDARY,
  ITEM_KNIFE,
  ITEM_C4,
  activeDef,
  bestItem,
  eyePosition,
  makeHitTarget,
  HitTarget,
  traceBullet,
  applyArmor,
  HitGroup,
  fallDamage,
  Grenade,
  GrenadeType,
  stepGrenade,
  heDamageAt,
  HE_RADIUS,
  HE_ARMOR_RATIO,
  flashDuration,
  SMOKE_DURATION,
  SMOKE_FADE,
  INFERNO_DURATION,
  INFERNO_DPS,
  DECOY_DURATION,
  SmokeVolume,
  fillSmoke,
  carveSmokeSphere,
  carveSmokeLine,
  healSmoke,
  smokeOpticalDepth,
  pointInSmoke,
  Inferno,
  spawnInferno,
  inFire,
  MASK_SHOT,
  MASK_GRENADE,
  IN_USE,
  angleVectors,
  forwardFromAngles,
  vdist,
  vnormalize,
  vsub,
  vdot,
  GameEvent,
  GameState,
  PlayerInfo,
  ServerMsg,
  ClientMsg,
  encodeSnapshot,
  EntityState,
  EF_ALIVE,
  EF_DUCKED,
  EF_ONGROUND,
  EF_SCOPED,
  EF_DEFUSING,
  EF_PLANTING,
  EF_RELOADING,
  EF_WALKING,
  IN_SPEED,
  V3,
  Vec3,
  hashSeed,
  KNIFE,
  rayCapsule,
  ITEM_NONE,
  cvars,
} from '@kervan/shared';
import { LagCompHistory, PoseRecord } from './lagcomp';

export interface Conn {
  sendBinary(data: Uint8Array): void;
  sendJSON(msg: ServerMsg): void;
  bufferedAmount(): number;
}

interface RoundStats {
  dmg: number;
  hits: number;
}

export class ServerPlayer {
  sim: PlayerSim;
  money = 800;
  k = 0;
  d = 0;
  a = 0;
  dmg = 0;
  mvp = 0;
  hs = 0;
  roundsPlayed = 0;
  cmdQueue: UserCmd[] = [];
  lastSeq = -1;
  budget = 0;
  lastCmd: UserCmd = emptyCmd();
  idleTicks = 0;
  ping = 0;
  disconnectTick = -1;
  respawnTick = -1;
  flashedUntil = 0;
  flashedBy = -1;
  given = new Map<number, RoundStats>();
  taken = new Map<number, RoundStats>();
  roundKills = 0;
  infernoAcc = 0;
  shots = 0;
  god = false;
  lastUse = false;

  constructor(
    readonly id: number,
    public name: string,
    readonly token: string,
    public conn: Conn | null,
    team: Team,
  ) {
    this.sim = createPlayerSim(id, team);
  }

  get team(): Team {
    return this.sim.team;
  }
  get alive(): boolean {
    return this.sim.alive;
  }
}

interface Dropped {
  id: number;
  item: WeaponItem | 'c4';
  pos: Vec3;
  vel: Vec3;
  yaw: number;
  resting: boolean;
  /** Bu tick'ten önce aynı kişi tekrar alamaz. */
  noPickupBy: number;
  noPickupUntil: number;
}

interface ActiveSmoke {
  vol: SmokeVolume;
  endTick: number;
}

interface ActiveInferno {
  inf: Inferno;
  endTick: number;
  bornTick: number;
}

interface ActiveDecoy {
  id: number;
  owner: number;
  pos: Vec3;
  endTick: number;
  nextTick: number;
  weapon: number;
}

interface Bomb {
  state: BombState;
  pos: Vec3;
  carrier: number;
  explodeTick: number;
  plantTick: number;
  planter: number;
  defuser: number;
  defuseStartTick: number;
  defuseEndTick: number;
}

const MAX_CMDS_PER_TICK = 8;
const TEAM_LIMIT = 5;

const ts = (sec: number) => Math.round(sec * TICK_RATE);
const v3 = (v: Vec3): V3 => [round2(v.x), round2(v.y), round2(v.z)];
const round2 = (n: number) => Math.round(n * 100) / 100;

export class Match {
  readonly world: World;
  settings: MatchSettings;
  tick = 0;
  players = new Map<number, ServerPlayer>();
  phase = Phase.Warmup;
  phaseEndTick = 0;
  buyEndTick = 0;
  round = 0;
  scoreT = 0;
  scoreCT = 0;
  history: number[] = [];
  lossStreak = { [Team.T]: 0, [Team.CT]: 0 } as Record<number, number>;
  overtimeCount = 0;
  swapped = false;
  lastWinner = Team.None;
  lastReason = RoundEndReason.None;
  mvp = -1;
  bomb: Bomb = this.freshBomb();
  grenades: Grenade[] = [];
  smokes = new Map<number, ActiveSmoke>();
  infernos = new Map<number, ActiveInferno>();
  decoys = new Map<number, ActiveDecoy>();
  dropped: Dropped[] = [];
  private nextEntityId = 1;
  private lag = new LagCompHistory();
  private events: GameEvent[] = [];
  private personal = new Map<number, GameEvent[]>();
  private stateDirty = true;
  private lastStateTick = -1000;
  private nextPlayerId = 1;
  host = -1;

  constructor(
    readonly map: MapDef,
    settings: Partial<MatchSettings> = {},
    readonly roomCode = '',
  ) {
    this.world = new World(map.brushes, map.triggers);
    this.settings = { ...DEFAULT_SETTINGS, ...settings };
    if (this.settings.practice) this.settings.showImpacts = true;
  }

  // ───────────────────────── oyuncu yönetimi ─────────────────────────

  addPlayer(name: string, conn: Conn, token: string): ServerPlayer {
    let id = this.nextPlayerId;
    while (this.players.has(id)) id = (id % 250) + 1;
    this.nextPlayerId = (id % 250) + 1;
    const team = this.autoTeam();
    const p = new ServerPlayer(id, name.slice(0, 24) || `Oyuncu${id}`, token, conn, team);
    p.money = this.phase === Phase.Warmup ? this.settings.warmupMoney : this.settings.startMoney;
    this.players.set(id, p);
    if (this.host < 0 || !this.players.get(this.host)?.conn) this.host = id;
    if (this.phase === Phase.Warmup || this.phase === Phase.Freeze) {
      this.spawn(p, true);
    }
    this.notice(`${p.name} oyuna katıldı`);
    this.stateDirty = true;
    return p;
  }

  reconnect(p: ServerPlayer, conn: Conn) {
    p.conn = conn;
    p.disconnectTick = -1;
    p.cmdQueue = [];
    this.notice(`${p.name} yeniden bağlandı`);
    this.stateDirty = true;
  }

  disconnect(id: number) {
    const p = this.players.get(id);
    if (!p) return;
    p.conn = null;
    p.disconnectTick = this.tick;
    this.notice(`${p.name} bağlantısı koptu`, 'warn');
    if (this.host === id) this.pickHost();
    this.stateDirty = true;
  }

  removePlayer(id: number) {
    const p = this.players.get(id);
    if (!p) return;
    if (p.alive) this.dropOnDeath(p);
    this.players.delete(id);
    if (this.host === id) this.pickHost();
    this.stateDirty = true;
  }

  private pickHost() {
    this.host = -1;
    for (const p of this.players.values()) {
      if (p.conn) {
        this.host = p.id;
        break;
      }
    }
  }

  connectedCount(): number {
    let n = 0;
    for (const p of this.players.values()) if (p.conn) n++;
    return n;
  }

  private teamPlayers(team: Team): ServerPlayer[] {
    return [...this.players.values()].filter((p) => p.team === team);
  }

  private autoTeam(): Team {
    const t = this.teamPlayers(Team.T).length;
    const ct = this.teamPlayers(Team.CT).length;
    return t <= ct ? Team.T : Team.CT;
  }

  // ───────────────────────── mesajlar ─────────────────────────

  handleCmds(id: number, cmds: UserCmd[]) {
    const p = this.players.get(id);
    if (!p) return;
    for (const c of cmds) {
      if (c.seq <= p.lastSeq) continue;
      if (p.cmdQueue.length && c.seq <= p.cmdQueue[p.cmdQueue.length - 1]!.seq) continue;
      if (!Number.isFinite(c.yaw) || !Number.isFinite(c.pitch)) continue;
      c.pitch = Math.max(-89, Math.min(89, c.pitch));
      p.cmdQueue.push(c);
    }
    // aşırı birikmeyi önle (lag spike sonrası)
    if (p.cmdQueue.length > 32) p.cmdQueue.splice(0, p.cmdQueue.length - 32);
  }

  handleMessage(id: number, msg: ClientMsg) {
    const p = this.players.get(id);
    if (!p) return;
    switch (msg.t) {
      case 'team':
        this.changeTeam(p, msg.team);
        break;
      case 'buy':
        this.buy(p, msg.item);
        break;
      case 'drop':
        this.dropActive(p);
        break;
      case 'chat':
        this.chat(p, msg.text, msg.team);
        break;
      case 'start':
        if (id === this.host) this.startMatch();
        break;
      case 'settings':
        if (id === this.host && (this.phase === Phase.Warmup || this.phase === Phase.MatchEnd)) {
          const s = msg.settings;
          const num = (v: unknown, lo: number, hi: number, d: number) =>
            typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d;
          this.settings = {
            ...this.settings,
            maxRounds: Math.round(num(s.maxRounds, 2, 30, this.settings.maxRounds) / 2) * 2,
            roundTime: num(s.roundTime, 30, 600, this.settings.roundTime),
            freezeTime: num(s.freezeTime, 0, 60, this.settings.freezeTime),
            buyTime: num(s.buyTime, 5, 120, this.settings.buyTime),
            c4Timer: num(s.c4Timer, 10, 90, this.settings.c4Timer),
            startMoney: num(s.startMoney, 0, 16000, this.settings.startMoney),
            maxMoney: num(s.maxMoney, 1000, 65535, this.settings.maxMoney),
            friendlyFire: typeof s.friendlyFire === 'boolean' ? s.friendlyFire : this.settings.friendlyFire,
            overtime: typeof s.overtime === 'boolean' ? s.overtime : this.settings.overtime,
            showImpacts: typeof s.showImpacts === 'boolean' ? s.showImpacts : this.settings.showImpacts,
          };
          this.stateDirty = true;
        }
        break;
      case 'pong':
        p.ping = Math.max(0, Math.min(999, Date.now() - msg.s));
        break;
      case 'cheat':
        this.cheat(p, msg.name);
        break;
    }
  }

  private cheat(p: ServerPlayer, name: string) {
    if (!this.settings.practice) {
      this.toPlayer(p.id, { e: 'notice', text: 'Hileler sadece antrenman modunda açık', kind: 'warn' });
      return;
    }
    if (name === 'noclip') {
      p.sim.move.noclip = !p.sim.move.noclip;
      this.toPlayer(p.id, { e: 'notice', text: p.sim.move.noclip ? 'noclip AÇIK' : 'noclip KAPALI' });
    } else if (name === 'god') {
      p.god = !p.god;
      this.toPlayer(p.id, { e: 'notice', text: p.god ? 'Ölümsüzlük AÇIK' : 'Ölümsüzlük KAPALI' });
    } else if (name === 'money') {
      p.money = this.settings.maxMoney;
    } else if (name === 'restart') {
      this.spawn(p, true);
    }
    this.stateDirty = true;
  }

  private chat(p: ServerPlayer, text: string, team: boolean) {
    const clean = text.replace(/[\u0000-\u001f]/g, '').slice(0, 160).trim();
    if (!clean) return;
    const msg: ServerMsg = { t: 'chat', from: p.id, name: p.name, text: clean, team, teamId: p.team, dead: !p.alive };
    for (const o of this.players.values()) {
      if (!o.conn) continue;
      if (team && o.team !== p.team) continue;
      o.conn.sendJSON(msg);
    }
  }

  private changeTeam(p: ServerPlayer, team: Team) {
    if (team !== Team.T && team !== Team.CT && team !== Team.Spectator) return;
    if (team === p.team) return;
    if (team !== Team.Spectator && this.teamPlayers(team).length >= TEAM_LIMIT) {
      this.toPlayer(p.id, { e: 'notice', text: 'Takım dolu', kind: 'warn' });
      return;
    }
    if (p.alive) {
      this.dropOnDeath(p);
      p.sim.alive = false;
    }
    p.sim.team = team;
    p.sim.inv = { primary: null, secondary: null, grenades: GRENADE_KEYS.map(() => 0), c4: false, defuser: false };
    if (this.phase === Phase.Warmup || this.settings.practice) {
      if (team !== Team.Spectator) this.spawn(p, true);
    } else if (this.phase === Phase.Freeze && team !== Team.Spectator) {
      this.spawn(p, true);
    }
    this.stateDirty = true;
  }

  // ───────────────────────── maç akışı ─────────────────────────

  startMatch() {
    if (this.settings.practice) return;
    if (this.teamPlayers(Team.T).length === 0 || this.teamPlayers(Team.CT).length === 0) {
      this.notice('Maçı başlatmak için iki takımda da en az bir oyuncu olmalı', 'warn');
      return;
    }
    this.scoreT = 0;
    this.scoreCT = 0;
    this.history = [];
    this.round = 0;
    this.overtimeCount = 0;
    this.swapped = false;
    this.lossStreak = { [Team.T]: 0, [Team.CT]: 0 };
    for (const p of this.players.values()) {
      p.k = p.d = p.a = p.dmg = p.mvp = p.hs = p.roundsPlayed = 0;
      p.money = this.settings.startMoney;
      this.resetLoadout(p);
    }
    this.notice('Maç başlıyor! İyi şanslar.', 'good');
    this.startRound();
  }

  private resetLoadout(p: ServerPlayer) {
    p.sim.alive = false;
    p.sim.inv = { primary: null, secondary: null, grenades: GRENADE_KEYS.map(() => 0), c4: false, defuser: false };
    p.sim.armor = 0;
    p.sim.helmet = false;
  }

  private startRound() {
    this.round++;
    this.phase = Phase.Freeze;
    this.phaseEndTick = this.tick + ts(this.settings.freezeTime);
    this.buyEndTick = this.phaseEndTick + ts(this.settings.buyTime);
    this.bomb = this.freshBomb();
    this.grenades = [];
    for (const id of this.smokes.keys()) this.broadcast({ e: 'smoke_end', id });
    for (const id of this.infernos.keys()) this.broadcast({ e: 'inferno_end', id });
    this.smokes.clear();
    this.infernos.clear();
    this.decoys.clear();
    this.dropped = [];
    this.mvp = -1;
    for (const p of this.players.values()) {
      p.given.clear();
      p.taken.clear();
      p.roundKills = 0;
      p.flashedUntil = 0;
      if (p.team === Team.T || p.team === Team.CT) {
        this.spawn(p, !p.alive);
        p.roundsPlayed++;
      }
    }
    // C4'ü rastgele bir T'ye ver
    const ts_ = this.teamPlayers(Team.T).filter((p) => p.alive);
    if (ts_.length) {
      const pick = ts_[hashSeed(this.round, this.tick) % ts_.length]!;
      pick.sim.inv.c4 = true;
      this.bomb.state = BombState.Carried;
      this.bomb.carrier = pick.id;
    }
    this.broadcast({ e: 'round_start', round: this.round });
    this.stateDirty = true;
  }

  private freshBomb(): Bomb {
    return {
      state: BombState.Carried,
      pos: { x: 0, y: 0, z: 0 },
      carrier: -1,
      explodeTick: 0,
      plantTick: 0,
      planter: -1,
      defuser: -1,
      defuseStartTick: 0,
      defuseEndTick: 0,
    };
  }

  /** Oyuncuyu doğur. resetGear: ölüydü/yeni → varsayılan ekipman. */
  private spawn(p: ServerPlayer, resetGear: boolean) {
    if (p.team !== Team.T && p.team !== Team.CT) return;
    const list = p.team === Team.T ? this.map.spawns.T : this.map.spawns.CT;
    const mates = [...this.players.values()].filter((o) => o !== p && o.alive);
    let sp = list[0]!;
    const start = this.phase === Phase.Warmup ? hashSeed(p.id, this.tick) % list.length : this.teamPlayers(p.team).indexOf(p);
    for (let i = 0; i < list.length; i++) {
      const cand = list[(Math.max(0, start) + i) % list.length]!;
      if (mates.every((o) => vdist(o.sim.move.origin, cand.pos) > 48)) {
        sp = cand;
        break;
      }
    }
    const s = p.sim;
    const keepInv = !resetGear && s.alive;
    s.alive = true;
    s.health = 100;
    s.move.origin = { ...sp.pos };
    s.move.velocity = { x: 0, y: 0, z: 0 };
    s.move.ducked = false;
    s.move.duckAmount = 0;
    s.move.stamina = 0;
    s.move.velocityModifier = 1;
    s.move.onGround = false;
    s.move.noclip = false;
    s.defusing = false;
    s.infiniteAmmo = this.settings.practice || this.phase === Phase.Warmup;
    p.lastCmd = { ...p.lastCmd, yaw: sp.yaw, pitch: 0 };
    if (!keepInv) {
      s.inv = { primary: null, secondary: null, grenades: GRENADE_KEYS.map(() => 0), c4: false, defuser: false };
      s.inv.secondary = makeWeaponItem(weapon(p.team === Team.T ? 'glock' : 'usp_silencer'));
    } else {
      // hayatta kalan: şarjörleri koru, yedek mermiyi tamamla (CS2 davranışı)
      for (const it of [s.inv.primary, s.inv.secondary]) {
        if (it) it.reserve = weaponByNum(it.num)!.reserve;
      }
    }
    s.active = bestItem(s);
    s.lastActive = ITEM_KNIFE;
    const w = s.wpn;
    w.deployEnd = s.time + 0.5;
    w.nextAttack = w.deployEnd;
    w.reloadEnd = 0;
    w.shellReloading = false;
    w.zoom = 0;
    w.resumeZoom = 0;
    w.recoilIndex = 0;
    w.accuracyPenalty = 0;
    w.aimPunch = { p: 0, y: 0 };
    w.aimPunchVel = { p: 0, y: 0 };
    w.viewPunch = { p: 0, y: 0 };
    w.plantProgress = 0;
    w.pinPulled = false;
    w.burstLeft = 0;
    w.silencerEnd = 0;
    p.respawnTick = -1;
    p.flashedUntil = 0;
    if (this.phase === Phase.Warmup || this.settings.practice) p.money = this.settings.practice ? this.settings.maxMoney : this.settings.warmupMoney;
    this.broadcast({ e: 'spawn', id: p.id });
    this.stateDirty = true;
  }

  private endRound(winner: Team, reason: RoundEndReason) {
    if (this.phase !== Phase.Live && this.phase !== Phase.Freeze) return;
    this.phase = Phase.RoundEnd;
    this.phaseEndTick = this.tick + ts(this.settings.roundEndDelay);
    this.lastWinner = winner;
    this.lastReason = reason;
    if (this.bomb.defuser >= 0) {
      const d = this.players.get(this.bomb.defuser);
      if (d) d.sim.defusing = false;
    }

    if (winner === Team.T) this.scoreT++;
    else if (winner === Team.CT) this.scoreCT++;
    this.history.push(winner);

    // ekonomi
    const loser = winner === Team.T ? Team.CT : Team.T;
    const winReward =
      reason === RoundEndReason.BombExploded
        ? ECONOMY.winBombExploded
        : reason === RoundEndReason.BombDefused
          ? ECONOMY.winBombDefused
          : reason === RoundEndReason.TimeRanOut
            ? ECONOMY.winTime
            : ECONOMY.winElimination;
    this.lossStreak[loser] = Math.min(5, (this.lossStreak[loser] ?? 0) + 1);
    this.lossStreak[winner] = Math.max(0, (this.lossStreak[winner] ?? 0) - 1);
    const planted = this.bomb.plantTick > 0;
    for (const p of this.players.values()) {
      if (p.team === winner) this.addMoney(p, winReward);
      else if (p.team === loser) {
        // süre bittiğinde hayatta kalan T'ler kayıp bonusu alamaz
        if (reason === RoundEndReason.TimeRanOut && p.team === Team.T && p.alive) continue;
        let m = lossBonus(this.lossStreak[loser]!);
        if (p.team === Team.T && planted) m += ECONOMY.plantedLossBonus;
        this.addMoney(p, m);
      }
    }

    // MVP
    let mvp: ServerPlayer | null = null;
    if (reason === RoundEndReason.BombDefused) mvp = this.players.get(this.bomb.defuser) ?? null;
    else if (reason === RoundEndReason.BombExploded) mvp = this.players.get(this.bomb.planter) ?? null;
    if (!mvp) {
      for (const p of this.players.values()) {
        if (p.team !== winner) continue;
        const dmg = [...p.given.values()].reduce((a, b) => a + b.dmg, 0);
        const best = mvp ? [...mvp.given.values()].reduce((a, b) => a + b.dmg, 0) : -1;
        if (!mvp || p.roundKills > mvp.roundKills || (p.roundKills === mvp.roundKills && dmg > best)) mvp = p;
      }
    }
    if (mvp) {
      mvp.mvp++;
      this.mvp = mvp.id;
    }
    this.broadcast({ e: 'round_end', winner, reason, mvp: this.mvp });

    // hasar raporu
    for (const p of this.players.values()) {
      const given = [...p.given.entries()].map(([id, s]) => ({ id, dmg: s.dmg, hits: s.hits }));
      const taken = [...p.taken.entries()].map(([id, s]) => ({ id, dmg: s.dmg, hits: s.hits }));
      this.toPlayer(p.id, { e: 'damage_report', given, taken });
    }
    this.stateDirty = true;
  }

  private addMoney(p: ServerPlayer, amount: number) {
    p.money = Math.max(0, Math.min(this.settings.maxMoney, p.money + amount));
  }

  /** RoundEnd bittiğinde: devre arası, maç sonu, overtime kararı. */
  private afterRound() {
    const s = this.settings;
    const played = this.scoreT + this.scoreCT;
    const regHalf = s.maxRounds / 2;
    const otHalf = s.otMaxRounds / 2;
    const winAt = regHalf + 1 + this.overtimeCount * otHalf;
    const limit = s.maxRounds + this.overtimeCount * s.otMaxRounds;

    if (this.scoreT >= winAt || this.scoreCT >= winAt) {
      this.endMatch();
      return;
    }
    if (played >= limit) {
      if (s.overtime) {
        this.overtimeCount++;
        this.notice(`Uzatma ${this.overtimeCount} başlıyor!`, 'warn');
        for (const p of this.players.values()) {
          this.resetLoadout(p);
          p.money = s.otStartMoney;
        }
        this.lossStreak = { [Team.T]: 0, [Team.CT]: 0 };
        this.startHalftime(false);
        return;
      }
      this.endMatch();
      return;
    }
    const half = this.overtimeCount === 0 ? regHalf : s.maxRounds + (this.overtimeCount - 1) * s.otMaxRounds + otHalf;
    if (played === half) {
      this.startHalftime(true);
      return;
    }
    this.startRound();
  }

  private startHalftime(swap: boolean) {
    this.phase = Phase.Halftime;
    this.phaseEndTick = this.tick + ts(this.settings.halftimeDuration);
    if (swap) {
      for (const p of this.players.values()) {
        if (p.team === Team.T) p.sim.team = Team.CT;
        else if (p.team === Team.CT) p.sim.team = Team.T;
        this.resetLoadout(p);
        p.money = this.overtimeCount > 0 ? this.settings.otStartMoney : this.settings.startMoney;
      }
      [this.scoreT, this.scoreCT] = [this.scoreCT, this.scoreT];
      this.history = this.history.map((t) => (t === Team.T ? Team.CT : t === Team.CT ? Team.T : t));
      this.lossStreak = { [Team.T]: 0, [Team.CT]: 0 };
      this.swapped = !this.swapped;
      this.notice('Devre arası — takımlar taraf değiştiriyor', 'info');
    }
    this.stateDirty = true;
  }

  private endMatch() {
    this.phase = Phase.MatchEnd;
    this.phaseEndTick = this.tick + ts(20);
    const w = this.scoreT > this.scoreCT ? 'Teröristler' : this.scoreCT > this.scoreT ? 'Anti-Teröristler' : null;
    this.notice(w ? `Maç bitti! ${w} kazandı (${this.scoreT}-${this.scoreCT})` : `Maç berabere bitti (${this.scoreT}-${this.scoreCT})`, 'good');
    this.stateDirty = true;
  }

  private backToWarmup() {
    this.phase = Phase.Warmup;
    this.round = 0;
    for (const p of this.players.values()) {
      this.resetLoadout(p);
      p.money = this.settings.warmupMoney;
      this.spawn(p, true);
    }
    this.stateDirty = true;
  }

  // ───────────────────────── tick ─────────────────────────

  step() {
    this.tick++;
    const tick = this.tick;

    // 1) komutlar
    const entityBoxes = (): EntityBox[] => {
      const out: EntityBox[] = [];
      for (const o of this.players.values()) if (o.alive) out.push(playerBox(o.id, o.sim.move));
      return out;
    };
    let boxes = entityBoxes();
    for (const p of this.players.values()) {
      p.budget = Math.min(MAX_CMDS_PER_TICK, p.budget + 1);
      let ran = 0;
      while (p.cmdQueue.length > 0 && p.budget > 0) {
        const cmd = p.cmdQueue.shift()!;
        this.runCmd(p, cmd, boxes);
        p.lastSeq = cmd.seq;
        p.budget--;
        ran++;
      }
      if (ran > 0) {
        p.idleTicks = 0;
        boxes = entityBoxes();
      } else if (p.alive) {
        p.idleTicks++;
        // komut gelmiyorsa (sekme arka planda) yerçekimi yine işlesin
        if (p.idleTicks > 8) {
          const idle: UserCmd = { ...p.lastCmd, buttons: 0, weapon: ITEM_NONE, fireFrac: 255, seq: p.lastSeq };
          const saved = p.sim.move.oldButtons;
          simulateCmd(p.sim, idle, this.simEnv(p, boxes));
          p.sim.move.oldButtons = saved;
        }
      }
    }

    // 2) dünya
    this.stepGrenades();
    this.stepSmokes();
    this.stepInfernos();
    this.stepDecoys();
    this.stepDropped();
    this.stepBomb();
    this.stepDefuse();

    // 3) faz ve kazanma koşulları
    this.stepPhase();

    // 4) bağlantısı kopanları temizle
    for (const p of [...this.players.values()]) {
      if (!p.conn && p.disconnectTick >= 0 && tick - p.disconnectTick > ts(120)) this.removePlayer(p.id);
    }

    // 5) lag comp geçmişi
    const poses = new Map<number, PoseRecord>();
    for (const p of this.players.values()) {
      poses.set(p.id, { origin: { ...p.sim.move.origin }, yaw: p.lastCmd.yaw, duck: p.sim.move.duckAmount, alive: p.alive });
    }
    this.lag.record(tick, poses);

    // 6) ağ
    this.sendAll();
  }

  private simEnv(p: ServerPlayer, boxes: EntityBox[]) {
    const live = this.phase === Phase.Live;
    return {
      world: this.world,
      entities: boxes,
      frozen: this.phase === Phase.Freeze || this.phase === Phase.Halftime,
      canAttack: this.phase !== Phase.Freeze && this.phase !== Phase.Halftime,
      canPlant: live && this.bomb.state !== BombState.Planted && p.team === Team.T,
    };
  }

  private runCmd(p: ServerPlayer, cmd: UserCmd, boxes: EntityBox[]) {
    if (!p.alive) {
      p.lastCmd = cmd;
      p.sim.move.oldButtons = cmd.buttons;
      return;
    }
    const events = simulateCmd(p.sim, cmd, this.simEnv(p, boxes));
    p.lastCmd = cmd;
    for (const ev of events) this.handleSimEvent(p, ev, cmd);
    this.handleUse(p, cmd);
    this.autoPickup(p);
  }

  private handleSimEvent(p: ServerPlayer, ev: SimEvent, cmd: UserCmd) {
    switch (ev.kind) {
      case 'shot':
        p.shots++;
        this.shoot(p, ev, cmd);
        break;
      case 'melee':
        this.melee(p, ev, cmd);
        break;
      case 'throw':
        this.throwGrenade(p, ev);
        break;
      case 'plant':
        this.plantBomb(p, ev);
        break;
      case 'land': {
        const dmg = fallDamage(ev.value ?? 0);
        if (dmg > 0) this.damage(p, null, dmg, 0, HitGroup.Generic, KNIFE, false, p.sim.move.origin, true);
        this.broadcastExcept(p.id, { e: 'land', id: p.id, v: Math.round(ev.value ?? 0) });
        break;
      }
      case 'jump':
        this.broadcastExcept(p.id, { e: 'jump', id: p.id });
        break;
      case 'reload':
        if (ev.value === 0) this.broadcastExcept(p.id, { e: 'reload', id: p.id, w: activeDef(p.sim).num });
        break;
    }
  }

  // ───────────────────────── savaş ─────────────────────────

  private targetsFor(p: ServerPlayer, renderTick: number): HitTarget[] {
    const out: HitTarget[] = [];
    for (const o of this.players.values()) {
      if (o.id === p.id || !o.alive) continue;
      if (!this.settings.friendlyFire && o.team === p.team && !this.settings.practice) continue;
      const pose = this.lag.poseAt(o.id, renderTick, this.tick - 1);
      const origin = pose && pose.alive ? pose.origin : o.sim.move.origin;
      const yaw = pose ? pose.yaw : o.lastCmd.yaw;
      const duck = pose ? pose.duck : o.sim.move.duckAmount;
      out.push(makeHitTarget(o.id, o.team, { origin, yaw, duckAmount: duck }));
    }
    return out;
  }

  private shoot(p: ServerPlayer, ev: ShotEvent, cmd: UserCmd) {
    const def = weaponByNum(ev.weapon)!;
    this.broadcastExcept(p.id, {
      e: 'shot',
      id: p.id,
      w: ev.weapon,
      m: ev.mode,
      o: v3(ev.origin),
      d: ev.dirs.map((d) => [Math.round(d.x * 1e5) / 1e5, Math.round(d.y * 1e5) / 1e5, Math.round(d.z * 1e5) / 1e5] as V3),
      sil: ev.silenced,
    });
    const targets = this.targetsFor(p, cmd.renderTick);
    // aynı atışta bir oyuncuya giden saçmalar toplanır (pompalı)
    const agg = new Map<number, { dmg: number; group: HitGroup; point: Vec3; wb: boolean; smoke: boolean }>();
    for (const dir of ev.dirs) {
      const res = traceBullet(this.world, ev.origin, dir, def, targets, p.id);
      for (const sm of this.smokes.values()) carveSmokeLine(sm.vol, ev.origin, res.end);
      for (const h of res.hits) {
        const victim = this.players.get(h.id);
        if (!victim || !victim.alive) continue;
        const throughSmoke = this.smokeBetween(ev.origin, h.point);
        const cur = agg.get(h.id);
        if (!cur) agg.set(h.id, { dmg: h.damage, group: h.group, point: h.point, wb: h.penetrated > 0, smoke: throughSmoke });
        else {
          cur.dmg += h.damage;
          if (h.group === HitGroup.Head) cur.group = HitGroup.Head;
        }
        // her saçma ayrı zırh hesabı yapılır; basitlik için toplamı uygula
      }
    }
    for (const [vid, h] of agg) {
      const victim = this.players.get(vid)!;
      const scoped = def.zoomLevels > 0 && p.sim.wpn.zoom === 0 && def.category === 'sniper';
      this.damage(victim, p, h.dmg, def.armorRatio, h.group, def, h.wb, h.point, false, h.smoke, scoped);
    }
  }

  private smokeBetween(a: Vec3, b: Vec3): boolean {
    for (const sm of this.smokes.values()) {
      const age = (this.tick - sm.vol.bornAt) / TICK_RATE;
      if (smokeOpticalDepth(sm.vol, a, b, age, SMOKE_DURATION, SMOKE_FADE) > 40) return true;
    }
    return false;
  }

  private melee(p: ServerPlayer, ev: MeleeEvent, cmd: UserCmd) {
    const range = ev.heavy ? 32 : 48;
    const targets = this.targetsFor(p, cmd.renderTick);
    let best: { id: number; t: number } | null = null;
    for (const tg of targets) {
      for (const cap of tg.hitboxes) {
        // kalın ışın: kapsül yarıçapını büyüt
        const t = rayCapsule(ev.origin, ev.dir, { ...cap, r: cap.r + 7 });
        if (t >= 0 && t <= range + 8 && (!best || t < best.t)) best = { id: tg.id, t };
      }
    }
    let hit = false;
    if (best) {
      const victim = this.players.get(best.id)!;
      const end = { x: ev.origin.x + ev.dir.x * best.t, y: ev.origin.y + ev.dir.y * best.t, z: ev.origin.z + ev.dir.z * best.t };
      const wall = this.world.traceRay(ev.origin, end, MASK_SHOT);
      if (wall.fraction >= 0.99) {
        hit = true;
        // sırttan bıçaklama
        const los = vnormalize({ x: victim.sim.move.origin.x - p.sim.move.origin.x, y: victim.sim.move.origin.y - p.sim.move.origin.y, z: 0 });
        const vf = forwardFromAngles(0, victim.lastCmd.yaw);
        const back = los.x * vf.x + los.y * vf.y > 0.475;
        const dmg = ev.heavy ? (back ? 180 : 65) : back ? 90 : ev.first ? 40 : 25;
        this.damage(victim, p, dmg, KNIFE.armorRatio, HitGroup.Chest, KNIFE, false, end);
      }
    }
    this.broadcastExcept(p.id, { e: 'melee', id: p.id, hit, heavy: ev.heavy });
  }

  /**
   * Hasar uygula. damage: zırhtan önceki hasar (bölge çarpanı dahil).
   * armorRatio 0 ise zırh yok sayılır (düşme).
   */
  private damage(
    victim: ServerPlayer,
    attacker: ServerPlayer | null,
    damage: number,
    armorRatio: number,
    group: HitGroup,
    def: WeaponDef,
    wallbang: boolean,
    point: Vec3,
    world = false,
    throughSmoke = false,
    noscope = false,
    grenade = false,
  ) {
    if (!victim.alive || victim.god) return;
    if (this.phase === Phase.RoundEnd && attacker && !world) {
      // round bittikten sonra da hasar devam eder (CS'teki gibi)
    }
    const ff = attacker !== null && attacker !== victim && attacker.team === victim.team;
    if (ff && !this.settings.friendlyFire && !this.settings.practice) return;
    let dmg = damage;
    if (ff) dmg *= grenade ? this.settings.ffGrenadeScale : this.settings.ffBulletScale;
    const res = armorRatio > 0 ? applyArmor(dmg, armorRatio, group, victim.sim.armor, victim.sim.helmet) : { health: Math.floor(dmg), armor: 0 };
    if (res.health <= 0 && res.armor <= 0) return;
    const before = victim.sim.health;
    victim.sim.health = Math.max(0, victim.sim.health - res.health);
    victim.sim.armor = Math.max(0, victim.sim.armor - res.armor);
    const dealt = before - victim.sim.health;

    // tagging (vurulunca yavaşlama)
    if (!world && !grenade && victim.sim.move.onGround) {
      const f = res.health >= 40 || group === HitGroup.Head ? def.flinchLarge : def.flinchSmall;
      victim.sim.move.velocityModifier = Math.min(victim.sim.move.velocityModifier, f);
    }

    if (attacker && attacker !== victim) {
      const g = attacker.given.get(victim.id) ?? { dmg: 0, hits: 0 };
      g.dmg += dealt;
      g.hits++;
      attacker.given.set(victim.id, g);
      const t = victim.taken.get(attacker.id) ?? { dmg: 0, hits: 0 };
      t.dmg += dealt;
      t.hits++;
      victim.taken.set(attacker.id, t);
      if (!ff) attacker.dmg += dealt;
    }

    const from = attacker ? eyePosition(attacker.sim) : point;
    this.broadcast({
      e: 'hit',
      a: attacker?.id ?? -1,
      v: victim.id,
      dmg: dealt,
      hg: group,
      p: v3(point),
      hp: victim.sim.health,
      armor: victim.sim.armor,
      from: v3(from),
    });

    if (victim.sim.health <= 0) {
      this.kill(victim, attacker, def, group === HitGroup.Head, wallbang, throughSmoke, noscope);
    }
    this.stateDirty = true;
  }

  private kill(victim: ServerPlayer, attacker: ServerPlayer | null, def: WeaponDef, hs: boolean, wb: boolean, smoke: boolean, noscope: boolean) {
    victim.sim.alive = false;
    victim.sim.defusing = false;
    victim.d++;
    victim.respawnTick = this.phase === Phase.Warmup || this.settings.practice ? this.tick + ts(this.settings.warmupRespawn) : -1;
    this.dropOnDeath(victim);
    let assister = -1;
    const ff = attacker !== null && attacker !== victim && attacker.team === victim.team;
    if (attacker && attacker !== victim) {
      if (ff) {
        attacker.k = Math.max(0, attacker.k - 1);
        this.addMoney(attacker, ECONOMY.teamKillPenalty);
      } else {
        attacker.k++;
        attacker.roundKills++;
        if (hs) attacker.hs++;
        this.addMoney(attacker, def.killAward);
      }
      // asist: bu round ≥41 hasar ya da flaş
      for (const o of this.players.values()) {
        if (o === attacker || o === victim || o.team === victim.team) continue;
        const g = o.given.get(victim.id);
        if (g && g.dmg >= 41) {
          assister = o.id;
          break;
        }
      }
      if (assister < 0 && victim.flashedBy >= 0 && victim.flashedUntil > this.tick && victim.flashedBy !== attacker.id) {
        const fb = this.players.get(victim.flashedBy);
        if (fb && fb.team !== victim.team) assister = fb.id;
      }
      if (assister >= 0) this.players.get(assister)!.a++;
    }
    this.broadcast({
      e: 'kill',
      k: attacker?.id ?? -1,
      v: victim.id,
      w: def.num,
      hs,
      wb,
      smoke,
      blind: attacker ? attacker.flashedUntil > this.tick : false,
      noscope,
      as: assister,
      ff,
    });
    if (this.bomb.defuser === victim.id) this.abortDefuse();
    this.stateDirty = true;
  }

  // ───────────────────────── eşyalar ─────────────────────────

  private canBuy(p: ServerPlayer): boolean {
    if (!p.alive) return false;
    if (this.settings.practice) return true;
    if (this.phase === Phase.Warmup) return this.inBuyZone(p);
    if (this.phase !== Phase.Freeze && this.phase !== Phase.Live) return false;
    if (this.tick > this.buyEndTick) return false;
    return this.inBuyZone(p);
  }

  private inBuyZone(p: ServerPlayer): boolean {
    return this.world.inTrigger(p.sim.move.origin, p.team === Team.T ? 'buyzone_t' : 'buyzone_ct') !== null;
  }

  private buy(p: ServerPlayer, item: string) {
    if (!this.canBuy(p)) {
      this.toPlayer(p.id, { e: 'notice', text: 'Şu an satın alamazsın', kind: 'warn' });
      return;
    }
    const s = p.sim;
    const pay = (price: number) => {
      if (this.settings.practice) return true;
      if (p.money < price) {
        this.toPlayer(p.id, { e: 'notice', text: 'Yetersiz para', kind: 'warn' });
        return false;
      }
      p.money -= price;
      return true;
    };
    if (item === 'vest' || item === 'vesthelm') {
      const wantHelm = item === 'vesthelm';
      if (s.armor >= 100 && (!wantHelm || s.helmet)) return;
      let price = wantHelm ? EQUIPMENT_PRICES.vesthelm : EQUIPMENT_PRICES.vest;
      if (wantHelm && s.armor >= 100) price = EQUIPMENT_PRICES.helmetOnly;
      if (!pay(price)) return;
      s.armor = 100;
      if (wantHelm) s.helmet = true;
    } else if (item === 'defuser') {
      if (p.team !== Team.CT || s.inv.defuser) return;
      if (!pay(EQUIPMENT_PRICES.defuser)) return;
      s.inv.defuser = true;
    } else {
      const def = WEAPON_BY_KEY[item];
      if (!def || def.category === 'knife' || def.category === 'c4') return;
      if (def.team !== 'any' && def.team !== (p.team === Team.T ? 'T' : 'CT')) return;
      if (def.category === 'grenade') {
        const gi = GRENADE_KEYS.indexOf(def.key as (typeof GRENADE_KEYS)[number]);
        const total = s.inv.grenades.reduce((a, b) => a + b, 0);
        if (s.inv.grenades[gi]! >= GRENADE_LIMITS[GRENADE_KEYS[gi]!] || total >= MAX_GRENADES) {
          this.toPlayer(p.id, { e: 'notice', text: 'Daha fazla taşıyamazsın', kind: 'warn' });
          return;
        }
        if (!pay(def.price)) return;
        s.inv.grenades[gi]!++;
      } else {
        const slot = def.slot === 'primary' ? 'primary' : 'secondary';
        const cur = s.inv[slot];
        if (cur && cur.num === def.num) return;
        if (!pay(def.price)) return;
        if (cur) this.spawnDropped(p, cur, true);
        s.inv[slot] = makeWeaponItem(def);
        s.active = slot === 'primary' ? ITEM_PRIMARY : ITEM_SECONDARY;
        s.wpn.deployEnd = s.time + def.deployTime;
        s.wpn.nextAttack = s.wpn.deployEnd;
        s.wpn.zoom = 0;
        s.wpn.reloadEnd = 0;
      }
    }
    this.broadcast({ e: 'buy', id: p.id, item });
    this.stateDirty = true;
  }

  private dropActive(p: ServerPlayer) {
    if (!p.alive) return;
    const s = p.sim;
    if (s.active === ITEM_PRIMARY && s.inv.primary) {
      this.spawnDropped(p, s.inv.primary, true);
      s.inv.primary = null;
    } else if (s.active === ITEM_SECONDARY && s.inv.secondary) {
      this.spawnDropped(p, s.inv.secondary, true);
      s.inv.secondary = null;
    } else if (s.active === ITEM_C4 && s.inv.c4) {
      this.spawnDropped(p, 'c4', true);
      s.inv.c4 = false;
      this.bomb.state = BombState.Dropped;
      this.bomb.carrier = -1;
    } else return;
    s.active = bestItem(s);
    s.wpn.deployEnd = s.time + 0.5;
    s.wpn.zoom = 0;
    this.stateDirty = true;
  }

  private dropOnDeath(p: ServerPlayer) {
    const s = p.sim;
    if (s.inv.primary) this.spawnDropped(p, s.inv.primary, false);
    else if (s.inv.secondary) this.spawnDropped(p, s.inv.secondary, false);
    if (s.inv.c4) {
      this.spawnDropped(p, 'c4', false);
      this.bomb.state = BombState.Dropped;
      this.bomb.carrier = -1;
    }
    s.inv = { primary: null, secondary: null, grenades: GRENADE_KEYS.map(() => 0), c4: false, defuser: false };
    s.armor = 0;
    s.helmet = false;
    s.wpn.zoom = 0;
  }

  private spawnDropped(p: ServerPlayer, item: WeaponItem | 'c4', thrown: boolean) {
    const eye = eyePosition(p.sim);
    const { forward } = angleVectors(p.lastCmd.pitch, p.lastCmd.yaw);
    const speed = thrown ? 280 : 60;
    const d: Dropped = {
      id: this.nextEntityId++,
      item: item === 'c4' ? 'c4' : { ...item },
      pos: thrown ? { x: eye.x, y: eye.y, z: eye.z - 10 } : { x: p.sim.move.origin.x, y: p.sim.move.origin.y, z: p.sim.move.origin.z + 32 },
      vel: { x: forward.x * speed + p.sim.move.velocity.x * 0.5, y: forward.y * speed + p.sim.move.velocity.y * 0.5, z: (thrown ? 120 : 40) + forward.z * speed },
      yaw: p.lastCmd.yaw,
      resting: false,
      noPickupBy: p.id,
      noPickupUntil: this.tick + ts(1.2),
    };
    this.dropped.push(d);
    if (this.dropped.length > 40) this.dropped.shift();
  }

  private stepDropped() {
    for (const d of this.dropped) {
      if (d.resting) continue;
      d.vel.z -= cvars.sv_gravity * TICK_DT;
      const end = { x: d.pos.x + d.vel.x * TICK_DT, y: d.pos.y + d.vel.y * TICK_DT, z: d.pos.z + d.vel.z * TICK_DT };
      const tr = this.world.traceHull(d.pos, end, { x: -4, y: -4, z: 0 }, { x: 4, y: 4, z: 4 }, MASK_GRENADE);
      d.pos = tr.endpos;
      if (tr.fraction < 1) {
        if (tr.normal.z > 0.7) {
          d.vel.x *= 0.5;
          d.vel.y *= 0.5;
          d.vel.z = 0;
          if (Math.hypot(d.vel.x, d.vel.y) < 30) d.resting = true;
        } else {
          const b = vdot(d.vel, tr.normal);
          d.vel = { x: (d.vel.x - tr.normal.x * b * 1.3) * 0.5, y: (d.vel.y - tr.normal.y * b * 1.3) * 0.5, z: d.vel.z * 0.5 };
        }
      }
      if (d.item === 'c4') this.bomb.pos = { ...d.pos };
    }
  }

  private autoPickup(p: ServerPlayer) {
    if (!p.alive) return;
    const s = p.sim;
    for (let i = 0; i < this.dropped.length; i++) {
      const d = this.dropped[i]!;
      if (d.noPickupBy === p.id && this.tick < d.noPickupUntil) continue;
      const dx = d.pos.x - s.move.origin.x;
      const dy = d.pos.y - s.move.origin.y;
      const dz = d.pos.z - s.move.origin.z;
      if (dx * dx + dy * dy > 40 * 40 || dz < -20 || dz > 80) continue;
      if (d.item === 'c4') {
        if (p.team !== Team.T || s.inv.c4) continue;
        s.inv.c4 = true;
        this.bomb.state = BombState.Carried;
        this.bomb.carrier = p.id;
        this.toPlayer(p.id, { e: 'notice', text: 'Bombayı aldın', kind: 'good' });
      } else {
        const def = weaponByNum(d.item.num)!;
        const slot = def.slot === 'primary' ? 'primary' : 'secondary';
        if (s.inv[slot]) continue;
        s.inv[slot] = d.item;
        if (s.active === ITEM_KNIFE) {
          s.active = slot === 'primary' ? ITEM_PRIMARY : ITEM_SECONDARY;
          s.wpn.deployEnd = s.time + def.deployTime;
        }
      }
      this.broadcast({ e: 'pickup', id: p.id, w: d.item === 'c4' ? 1 : d.item.num });
      this.dropped.splice(i, 1);
      i--;
      this.stateDirty = true;
    }
  }

  /** E tuşu: imha ya da yerdeki silahı değiştir. */
  private handleUse(p: ServerPlayer, cmd: UserCmd) {
    const use = (cmd.buttons & IN_USE) !== 0;
    const pressed = use && !p.lastUse;
    p.lastUse = use;
    if (!use) {
      if (this.bomb.defuser === p.id) this.abortDefuse();
      return;
    }
    const eye = eyePosition(p.sim);
    const { forward } = angleVectors(cmd.pitch, cmd.yaw);
    // imha
    if (p.team === Team.CT && this.bomb.state === BombState.Planted && this.bomb.defuser < 0 && p.sim.move.onGround) {
      const b = this.bomb.pos;
      const to = vsub({ x: b.x, y: b.y, z: b.z + 4 }, eye);
      const dist = Math.hypot(to.x, to.y, to.z);
      const dot = vdot(vnormalize(to), forward);
      if (dist < 90 && (dot > 0.6 || dist < 40)) {
        this.startDefuse(p);
        return;
      }
    }
    if (!pressed) return;
    // yerdeki silahla değiş
    let best: Dropped | null = null;
    let bestDot = 0.9;
    for (const d of this.dropped) {
      if (d.item === 'c4') continue;
      const to = vsub(d.pos, eye);
      const dist = Math.hypot(to.x, to.y, to.z);
      if (dist > 110) continue;
      const dot = vdot(vnormalize(to), forward);
      if (dot > bestDot) {
        bestDot = dot;
        best = d;
      }
    }
    if (best && best.item !== 'c4') {
      const def = weaponByNum(best.item.num)!;
      const slot = def.slot === 'primary' ? 'primary' : 'secondary';
      const cur = p.sim.inv[slot];
      const tr = this.world.traceRay(eye, best.pos, MASK_SHOT);
      if (tr.fraction < 0.95) return;
      this.dropped.splice(this.dropped.indexOf(best), 1);
      if (cur) this.spawnDropped(p, cur, true);
      p.sim.inv[slot] = best.item;
      p.sim.active = slot === 'primary' ? ITEM_PRIMARY : ITEM_SECONDARY;
      p.sim.wpn.deployEnd = p.sim.time + def.deployTime;
      p.sim.wpn.zoom = 0;
      p.sim.wpn.reloadEnd = 0;
      this.broadcast({ e: 'pickup', id: p.id, w: def.num });
      this.stateDirty = true;
    }
  }

  // ───────────────────────── C4 ─────────────────────────

  private plantBomb(p: ServerPlayer, ev: PlantEvent) {
    if (this.phase !== Phase.Live || this.bomb.state === BombState.Planted) {
      // tahmin sunucuyla uyuşmadı — C4'ü geri ver
      p.sim.inv.c4 = true;
      return;
    }
    p.sim.inv.c4 = false;
    this.bomb.state = BombState.Planted;
    this.bomb.pos = { ...ev.origin, z: ev.origin.z + 1 };
    this.bomb.carrier = -1;
    this.bomb.planter = p.id;
    this.bomb.plantTick = this.tick;
    this.bomb.explodeTick = this.tick + ts(this.settings.c4Timer);
    this.addMoney(p, ECONOMY.plantReward);
    this.broadcast({ e: 'plant', by: p.id, p: v3(this.bomb.pos) });
    this.stateDirty = true;
  }

  private startDefuse(p: ServerPlayer) {
    const kit = p.sim.inv.defuser;
    this.bomb.defuser = p.id;
    this.bomb.defuseStartTick = this.tick;
    this.bomb.defuseEndTick = this.tick + ts(kit ? this.settings.defuseTimeKit : this.settings.defuseTime);
    p.sim.defusing = true;
    p.sim.move.velocity = { x: 0, y: 0, z: 0 };
    this.broadcast({ e: 'defuse_start', by: p.id, kit });
    this.stateDirty = true;
  }

  private abortDefuse() {
    const d = this.players.get(this.bomb.defuser);
    if (d) d.sim.defusing = false;
    this.broadcast({ e: 'defuse_abort', by: this.bomb.defuser });
    this.bomb.defuser = -1;
    this.stateDirty = true;
  }

  private stepDefuse() {
    if (this.bomb.state !== BombState.Planted || this.bomb.defuser < 0) return;
    const d = this.players.get(this.bomb.defuser);
    if (!d || !d.alive || !(d.lastCmd.buttons & IN_USE)) {
      this.abortDefuse();
      return;
    }
    if (this.tick >= this.bomb.defuseEndTick) {
      this.bomb.state = BombState.Defused;
      d.sim.defusing = false;
      this.addMoney(d, ECONOMY.defuseReward);
      this.broadcast({ e: 'defused', by: d.id });
      this.endRound(Team.CT, RoundEndReason.BombDefused);
    }
  }

  private stepBomb() {
    if (this.bomb.state !== BombState.Planted) return;
    if (this.tick < this.bomb.explodeTick) return;
    this.bomb.state = BombState.Exploded;
    const pos = this.bomb.pos;
    this.broadcast({ e: 'explode', p: v3(pos) });
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      const c = { x: p.sim.move.origin.x, y: p.sim.move.origin.y, z: p.sim.move.origin.z + 36 };
      const dmg = bombDamageAt(vdist(c, pos));
      if (dmg >= 1) this.damage(p, null, dmg, 1.0, HitGroup.Chest, weapon('c4'), false, c, true);
    }
    if (this.phase === Phase.Live) this.endRound(Team.T, RoundEndReason.BombExploded);
  }

  // ───────────────────────── bombalar ─────────────────────────

  private throwGrenade(p: ServerPlayer, ev: ThrowEvent) {
    const g: Grenade = {
      id: this.nextEntityId++,
      type: ev.grenade as GrenadeType,
      owner: p.id,
      ownerTeam: p.team,
      pos: { ...ev.origin },
      vel: { ...ev.velocity },
      age: 0,
      restTime: 0,
      resting: false,
      detonated: false,
      bounces: 0,
      hitFloor: false,
    };
    this.grenades.push(g);
    this.broadcast({ e: 'nade_throw', id: g.id, type: g.type, owner: p.id });
    this.stateDirty = true;
  }

  private stepGrenades() {
    if (!this.grenades.length) return;
    const boxes: EntityBox[] = [];
    for (const o of this.players.values()) if (o.alive) boxes.push(playerBox(o.id, o.sim.move));
    for (const g of this.grenades) {
      const r = stepGrenade(g, this.world, TICK_DT, boxes);
      if (r.bounced && !r.detonate) this.broadcast({ e: 'nade_bounce', id: g.id, type: g.type, p: v3(g.pos) });
      if (r.detonate) this.detonate(g);
    }
    this.grenades = this.grenades.filter((g) => !g.detonated);
  }

  private detonate(g: Grenade) {
    const owner = this.players.get(g.owner) ?? null;
    this.broadcast({ e: 'nade_det', id: g.id, type: g.type, p: v3(g.pos) });
    switch (g.type) {
      case GrenadeType.HE: {
        const he = weapon('hegrenade');
        for (const p of this.players.values()) {
          if (!p.alive) continue;
          const c = { x: p.sim.move.origin.x, y: p.sim.move.origin.y, z: p.sim.move.origin.z + 36 };
          const dist = vdist(c, g.pos);
          if (dist > HE_RADIUS) continue;
          const pts = [c, eyePosition(p.sim), { ...p.sim.move.origin, z: p.sim.move.origin.z + 8 }];
          if (!pts.some((pt) => this.world.traceRay(g.pos, pt, MASK_SHOT).fraction >= 1)) continue;
          this.damage(p, owner, heDamageAt(dist), HE_ARMOR_RATIO, HitGroup.Chest, he, false, c, false, false, false, true);
        }
        for (const sm of this.smokes.values()) {
          if (vdist(sm.vol.center, g.pos) < 500) {
            carveSmokeSphere(sm.vol, g.pos, 170);
            this.broadcast({ e: 'smoke_carve', id: sm.vol.id, p: v3(g.pos), r: 170 });
          }
        }
        break;
      }
      case GrenadeType.Flash: {
        for (const p of this.players.values()) {
          if (!p.alive) continue;
          const eye = eyePosition(p.sim);
          const tr = this.world.traceRay(g.pos, eye, MASK_SHOT);
          if (tr.fraction < 1) continue;
          if (this.smokeBetween(g.pos, eye)) continue;
          const to = vsub(g.pos, eye);
          const dist = Math.hypot(to.x, to.y, to.z);
          const fwd = forwardFromAngles(p.lastCmd.pitch, p.lastCmd.yaw);
          const dot = vdot(vnormalize(to), fwd);
          const dur = flashDuration(dist, dot);
          if (dur <= 0) continue;
          const until = this.tick + ts(dur);
          if (until > p.flashedUntil) {
            p.flashedUntil = until;
            p.flashedBy = g.owner;
          }
          this.toPlayer(p.id, { e: 'flashed', dur: Math.round(dur * 100) / 100, p: v3(g.pos) });
        }
        break;
      }
      case GrenadeType.Smoke: {
        const vol = fillSmoke(this.world, g.id, g.pos, this.tick);
        this.smokes.set(g.id, { vol, endTick: this.tick + ts(SMOKE_DURATION) });
        this.broadcast({ e: 'smoke', id: g.id, p: v3(g.pos), tick: this.tick });
        // sisin içindeki alevler söner
        for (const inf of this.infernos.values()) {
          if (vdist(inf.inf.center, g.pos) < 260) {
            inf.inf.extinguished = true;
            inf.endTick = this.tick;
          }
        }
        break;
      }
      case GrenadeType.Molotov:
      case GrenadeType.Incendiary: {
        // sisin içine düştüyse söner
        for (const sm of this.smokes.values()) {
          const age = (this.tick - sm.vol.bornAt) / TICK_RATE;
          if (pointInSmoke(sm.vol, { ...g.pos, z: g.pos.z + 20 }, age, SMOKE_DURATION, SMOKE_FADE) > 0.3) return;
        }
        const inf = spawnInferno(this.world, g.id, g.owner, g.ownerTeam, g.pos, this.tick);
        this.infernos.set(g.id, { inf, endTick: this.tick + ts(INFERNO_DURATION), bornTick: this.tick });
        this.broadcast({ e: 'inferno', id: g.id, p: v3(g.pos), owner: g.owner, team: g.ownerTeam, tick: this.tick });
        break;
      }
      case GrenadeType.Decoy: {
        const op = owner?.sim.inv.primary ?? owner?.sim.inv.secondary;
        this.decoys.set(g.id, { id: g.id, owner: g.owner, pos: { ...g.pos }, endTick: this.tick + ts(DECOY_DURATION), nextTick: this.tick + 10, weapon: op ? op.num : weapon('glock').num });
        break;
      }
    }
  }

  private stepSmokes() {
    for (const [id, sm] of this.smokes) {
      healSmoke(sm.vol, TICK_DT);
      if (this.tick >= sm.endTick) {
        this.smokes.delete(id);
        this.broadcast({ e: 'smoke_end', id });
      }
    }
  }

  private stepInfernos() {
    for (const [id, inf] of this.infernos) {
      if (this.tick >= inf.endTick) {
        this.infernos.delete(id);
        this.broadcast({ e: 'inferno_end', id });
        continue;
      }
      const age = (this.tick - inf.bornTick) / TICK_RATE;
      const owner = this.players.get(inf.inf.owner) ?? null;
      const def = weapon(inf.inf.ownerTeam === Team.CT ? 'incgrenade' : 'molotov');
      for (const p of this.players.values()) {
        if (!p.alive) continue;
        if (!inFire(inf.inf, p.sim.move.origin, age)) continue;
        p.infernoAcc += INFERNO_DPS * TICK_DT;
        if (p.infernoAcc >= 8) {
          const d = Math.floor(p.infernoAcc);
          p.infernoAcc -= d;
          this.damage(p, owner, d, 0, HitGroup.Generic, def, false, p.sim.move.origin, false, false, false, true);
        }
      }
    }
  }

  private stepDecoys() {
    for (const [id, d] of this.decoys) {
      if (this.tick >= d.endTick) {
        this.decoys.delete(id);
        this.broadcast({ e: 'nade_det', id, type: GrenadeType.HE, p: v3(d.pos) });
        continue;
      }
      if (this.tick >= d.nextTick) {
        this.broadcast({ e: 'decoy', id, p: v3(d.pos), w: d.weapon });
        d.nextTick = this.tick + 20 + (hashSeed(id, this.tick) % 90);
      }
    }
  }

  // ───────────────────────── faz ─────────────────────────

  private stepPhase() {
    const tick = this.tick;
    switch (this.phase) {
      case Phase.Warmup:
        for (const p of this.players.values()) {
          if (!p.alive && p.respawnTick >= 0 && tick >= p.respawnTick && (p.team === Team.T || p.team === Team.CT)) this.spawn(p, true);
          if (this.settings.practice) p.money = this.settings.maxMoney;
        }
        break;
      case Phase.Freeze:
        if (tick >= this.phaseEndTick) {
          this.phase = Phase.Live;
          this.phaseEndTick = tick + ts(this.settings.roundTime);
          this.stateDirty = true;
        }
        break;
      case Phase.Live: {
        const tAlive = this.teamPlayers(Team.T).filter((p) => p.alive).length;
        const ctAlive = this.teamPlayers(Team.CT).filter((p) => p.alive).length;
        const planted = this.bomb.state === BombState.Planted;
        if (ctAlive === 0) this.endRound(Team.T, RoundEndReason.CTsEliminated);
        else if (tAlive === 0 && !planted) this.endRound(Team.CT, RoundEndReason.TerroristsEliminated);
        else if (!planted && tick >= this.phaseEndTick) this.endRound(Team.CT, RoundEndReason.TimeRanOut);
        break;
      }
      case Phase.RoundEnd:
        if (tick >= this.phaseEndTick) this.afterRound();
        break;
      case Phase.Halftime:
        if (tick >= this.phaseEndTick) this.startRound();
        break;
      case Phase.MatchEnd:
        if (tick >= this.phaseEndTick) this.backToWarmup();
        break;
    }
  }

  // ───────────────────────── ağ ─────────────────────────

  private broadcast(e: GameEvent) {
    this.events.push(e);
  }
  private broadcastExcept(id: number, e: GameEvent) {
    for (const p of this.players.values()) if (p.id !== id) this.toPlayer(p.id, e);
  }
  private toPlayer(id: number, e: GameEvent) {
    let l = this.personal.get(id);
    if (!l) this.personal.set(id, (l = []));
    l.push(e);
  }
  notice(text: string, kind: 'info' | 'warn' | 'good' = 'info') {
    this.broadcast({ e: 'notice', text, kind });
  }

  private entityFlags(p: ServerPlayer): number {
    const s = p.sim;
    let f = 0;
    if (s.alive) f |= EF_ALIVE;
    if (s.move.ducked || s.move.duckAmount > 0.5) f |= EF_DUCKED;
    if (s.move.onGround) f |= EF_ONGROUND;
    if (s.wpn.zoom > 0) f |= EF_SCOPED;
    if (s.defusing) f |= EF_DEFUSING;
    if (s.wpn.plantProgress > 0) f |= EF_PLANTING;
    if (s.wpn.reloadEnd > 0 || s.wpn.shellReloading) f |= EF_RELOADING;
    if (p.lastCmd.buttons & IN_SPEED) f |= EF_WALKING;
    return f;
  }

  private sendAll() {
    const ents: EntityState[] = [];
    for (const p of this.players.values()) {
      if (p.team !== Team.T && p.team !== Team.CT) continue;
      ents.push({
        id: p.id,
        team: p.team,
        flags: this.entityFlags(p),
        pos: p.sim.move.origin,
        vel: p.sim.move.velocity,
        yaw: p.lastCmd.yaw,
        pitch: p.lastCmd.pitch,
        duck: p.sim.move.duckAmount,
        weapon: p.alive ? activeDef(p.sim).num : 0,
        shots: p.shots,
      });
    }
    const grenades = this.grenades.map((g) => ({ id: g.id, type: g.type, pos: g.pos }));
    const dropped = this.dropped.map((d) => ({ id: d.id, weapon: d.item === 'c4' ? 1 : d.item.num, pos: d.pos, yaw: d.yaw }));
    const evs = this.events;
    this.events = [];
    const sendState = this.stateDirty || this.tick - this.lastStateTick >= 32;
    const state = sendState ? this.buildState() : null;
    if (sendState) {
      this.stateDirty = false;
      this.lastStateTick = this.tick;
    }
    for (const p of this.players.values()) {
      if (!p.conn) continue;
      const conn = p.conn;
      if (conn.bufferedAmount() > 512 * 1024) continue;
      const personal = this.personal.get(p.id);
      if (state) conn.sendJSON({ t: 'state', ...state });
      if (evs.length || personal?.length) conn.sendJSON({ t: 'ev', tick: this.tick, list: personal ? [...evs, ...personal] : evs });
      const bomb =
        this.bomb.state === BombState.Planted || this.bomb.state === BombState.Dropped || (this.bomb.state === BombState.Carried && p.team === Team.T && this.bomb.carrier >= 0)
          ? { state: this.bomb.state, pos: this.bomb.state === BombState.Carried ? this.players.get(this.bomb.carrier)?.sim.move.origin ?? this.bomb.pos : this.bomb.pos }
          : null;
      // izleme: ölüyse hayatta olan takım arkadaşı
      let spectating = 0;
      if (!p.alive) {
        const mate = [...this.players.values()].find((o) => o.alive && o.team === p.team) ?? [...this.players.values()].find((o) => o.alive);
        if (mate) spectating = mate.id;
      }
      const snap = encodeSnapshot({
        tick: this.tick,
        ackSeq: p.lastSeq < 0 ? 0 : p.lastSeq,
        local: p.sim,
        spectating,
        entities: ents.filter((e) => e.id !== p.id),
        grenades,
        dropped,
        bomb,
      });
      conn.sendBinary(snap);
    }
    this.personal.clear();
    if (this.tick % TICK_RATE === 0) {
      for (const p of this.players.values()) p.conn?.sendJSON({ t: 'ping', s: Date.now(), ping: p.ping });
    }
  }

  buildState(): GameState {
    const players: PlayerInfo[] = [...this.players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      team: p.team,
      alive: p.alive,
      money: p.money,
      k: p.k,
      d: p.d,
      a: p.a,
      dmg: p.dmg,
      mvp: p.mvp,
      hs: p.hs,
      ping: p.ping,
      hp: p.sim.health,
      armor: p.sim.armor,
      helmet: p.sim.helmet,
      defuser: p.sim.inv.defuser,
      bomb: p.sim.inv.c4,
      weapon: p.alive ? activeDef(p.sim).num : 0,
      host: p.id === this.host,
      connected: p.conn !== null,
      rounds: p.roundsPlayed,
    }));
    return {
      phase: this.phase,
      phaseEndTick: this.phaseEndTick,
      round: this.round,
      scoreT: this.scoreT,
      scoreCT: this.scoreCT,
      history: this.history,
      bomb: {
        state: this.bomb.state,
        pos: this.bomb.state === BombState.Planted || this.bomb.state === BombState.Dropped ? v3(this.bomb.pos) : null,
        carrier: this.bomb.carrier,
        explodeTick: this.bomb.explodeTick,
        defuser: this.bomb.defuser,
        defuseEndTick: this.bomb.defuseEndTick,
        defuseStartTick: this.bomb.defuseStartTick,
      },
      players,
      buyEndTick: this.buyEndTick,
      settings: this.settings,
      room: this.roomCode,
      host: this.host,
      map: this.map.name,
      lastWinner: this.lastWinner,
      lastReason: this.lastReason,
      mvp: this.mvp,
      swapped: this.swapped,
      overtime: this.overtimeCount,
    };
  }
}

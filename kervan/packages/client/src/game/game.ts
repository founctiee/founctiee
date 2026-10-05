/**
 * Oyun istemcisi: 64 Hz komut üretimi, yerel tahmin + sunucu uzlaştırması, diğer
 * oyuncular için interpolasyon, olay işleme, kamera, ses ve HUD güncellemeleri.
 */
import * as THREE from 'three';
import {
  buildKervan,
  World,
  MapDef,
  PlayerSim,
  UserCmd,
  simulateCmd,
  SimEvent,
  SimEnv,
  TICK_DT,
  TICK_RATE,
  Snapshot,
  EntityState,
  GameState,
  GameEvent,
  ServerMsg,
  ClientMsg,
  DemoFile,
  DemoTick,
  DemoEvent,
  unpackFrames,
  base64ToBytes,
  Phase,
  BombState,
  Team,
  PROTOCOL_VERSION,
  ITEM_PRIMARY,
  ITEM_SECONDARY,
  ITEM_KNIFE,
  ITEM_GRENADE0,
  ITEM_C4,
  ITEM_NONE,
  GRENADE_KEYS,
  activeDef,
  activeItem,
  eyeHeight,
  hasItem,
  weaponByNum,
  WeaponDef,
  EntityBox,
  EF_ALIVE,
  EF_DUCKED,
  EF_ONGROUND,
  EF_DEFUSING,
  EF_PLANTING,
  EF_RELOADING,
  EF_WALKING,
  EF_SCOPED,
  traceBullet,
  angleVectors,
  vectorAngles,
  lerpAngle,
  DEG2RAD,
  MASK_SHOT,
  MATERIALS,
  Mat,
  fillSmoke,
  carveSmokeLine,
  carveSmokeSphere,
  spawnInferno,
  Inferno,
  areaName,
  recoilCvars,
  computeThrow,
  stepGrenade,
  Grenade,
  GrenadeType,
  getInaccuracy,
  weaponMode,
  IN_SPEED,
  PLANT_DURATION,
  Vec3,
  TICK_DT as DT,
} from '@kervan/shared';
import { Connection } from '../net/connection';
import { Renderer } from '../render/renderer';
import { createSurfaceMaterials } from '../render/textures';
import { buildMapMeshes } from '../render/mapmesh';
import { buildProps } from '../render/props';
import { Viewmodel } from '../render/viewmodel';
import { Effects } from '../render/effects';
import { WorldFx } from '../render/worldfx';
import { SmokeEffect } from '../render/smoke';
import { PlayerModel, PlayerPose } from '../render/players';
import { Input } from './input';
import { audio, Handle } from '../audio/audio';
import { settings, saveSettings } from '../settings';
import { ui, pushNotice, log, playerById, KillEntry } from '../ui/store';
import { tr } from '../i18n/tr';
import { drawCrosshair } from '../ui/crosshair';
import { security } from '../security/integrity';

interface DemoState {
  file: DemoFile;
  round: number;
  ticks: DemoTick[];
  tick: number;
  speed: number;
  paused: boolean;
  pov: number;
  markers: THREE.Sprite[];
}

function markerTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 32;
  c.height = 96;
  const g = c.getContext('2d')!;
  g.strokeStyle = '#ff2a2a';
  g.lineWidth = 4;
  g.strokeRect(3, 3, 26, 90);
  g.fillStyle = 'rgba(255,40,40,0.25)';
  g.fillRect(3, 3, 26, 90);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Tarayıcıya özel kalıcı kimlik (oda yasağı için). */
function deviceId(): string {
  try {
    let id = localStorage.getItem('kervan.did');
    if (!id) {
      id = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('');
      localStorage.setItem('kervan.did', id);
    }
    return id;
  } catch {
    return '';
  }
}

interface SnapRec {
  tick: number;
  ents: Map<number, EntityState>;
  grenades: Snapshot['grenades'];
  dropped: Snapshot['dropped'];
  bomb: Snapshot['bomb'];
}

interface RemoteVis {
  model: PlayerModel;
  team: Team;
  shots: number;
  stepAcc: number;
  lastPos: Vec3 | null;
  wasAlive: boolean;
  wasOnGround: boolean;
  wasReloading: boolean;
  defuseSound: number;
}

const MAX_HISTORY = 128;

export class Game {
  readonly map: MapDef = buildKervan();
  readonly world = new World(this.map.brushes, this.map.triggers);
  readonly renderer: Renderer;
  readonly input: Input;
  readonly viewmodel: Viewmodel;
  readonly effects: Effects;
  readonly fx: WorldFx;
  readonly smoke: SmokeEffect;
  #conn: Connection | null = null;
  myId = -1;
  state: GameState | null = null;
  sim: PlayerSim | null = null;
  #history: UserCmd[] = [];
  private seq = 0;
  private renderPrev = { x: 0, y: 0, z: 0, eye: 64 };
  private renderCur = { x: 0, y: 0, z: 0, eye: 64 };
  private smoothing = new THREE.Vector3();
  #snaps: SnapRec[] = [];
  #tickOffset = NaN;
  private jitter = 0;
  interpTicks = 3;
  spectating = 0;
  #remotes = new Map<number, RemoteVis>();
  private infernoSounds = new Map<number, Handle | null>();
  private smokeSounds = new Map<number, Handle | null>();
  pendingWeapon = ITEM_NONE;
  private acc = 0;
  private lastFrame = 0;
  private lastTickTime = 0;
  private running = false;
  private raf = 0;
  private lastHud = 0;
  private frames = 0;
  private fpsT = 0;
  private fps = 0;
  private flashStart = 0;
  private flashDur = 0;
  private flashCanvas: HTMLCanvasElement | null = null;
  private captureFlash = false;
  private shake = 0;
  private stepAcc = 0;
  private lastReloadEnd = 0;
  private reloadSounds: number[] = [];
  private nextBeep = 0;
  private bombBlink = false;
  private lastBytesIn = 0;
  private lastBytesOut = 0;
  private lastNetT = 0;
  private snapCount = 0;
  private lastSnapTick = 0;
  private lostSnaps = 0;
  private windHandle: Handle | null = null;
  private crosshairCtx: CanvasRenderingContext2D | null = null;
  private flashEl: HTMLDivElement | null = null;
  ping = 0;
  roomToken = '';
  private kickReason = '';
  #demo: DemoState | null = null;
  #markerTex: THREE.Texture | null = null;

  constructor(container: HTMLElement) {
    this.renderer = new Renderer(container, this.map);
    const anis = this.renderer.renderer.capabilities.getMaxAnisotropy();
    const mats = createSurfaceMaterials(settings.quality, Math.min(8, anis));
    const plank = { material: mats[Mat.Cardboard]!.material, scale: 96 };
    this.renderer.scene.add(buildMapMeshes(this.map, mats, plank));
    buildProps(this.map, this.renderer.scene, settings.quality);
    this.viewmodel = new Viewmodel(this.renderer.vmScene);
    this.effects = new Effects(this.renderer.scene);
    this.fx = new WorldFx(this.renderer.scene);
    this.smoke = new SmokeEffect(this.renderer.camera, settings.quality === 'high' ? 40 : settings.quality === 'medium' ? 28 : 16);
    this.renderer.addEffect(this.smoke);
    this.input = new Input(this.renderer.canvas);
    this.input.onAction = (a, down) => this.onAction(a, down);
    this.input.onPointerLockChange = (l) => {
      ui.pointerLocked.value = l;
      if (!l && ui.screen.value === 'game' && !this.anyMenuOpen()) {
        ui.escOpen.value = true;
        this.syncInputState();
      }
    };
    this.renderer.canvas.addEventListener('click', () => {
      audio.resume();
      if (!this.anyMenuOpen()) void this.input.lock();
    });
    audio.occluded = (a, b) => this.world.traceRay(a, b, MASK_SHOT).fraction < 0.98;

    // kaplamalar
    const ch = document.createElement('canvas');
    ch.className = 'crosshair-canvas';
    container.appendChild(ch);
    this.crosshairCtx = ch.getContext('2d');
    const flash = document.createElement('div');
    flash.className = 'flash-overlay';
    container.appendChild(flash);
    this.flashEl = flash;
    this.flashCanvas = document.createElement('canvas');
    this.flashCanvas.className = 'flash-afterimage';
    flash.appendChild(this.flashCanvas);
  }

  anyMenuOpen(): boolean {
    return ui.buyOpen.value || ui.escOpen.value || ui.settingsOpen.value || ui.consoleOpen.value || ui.chatOpen.value !== null || ui.teamMenuOpen.value || ui.matchSettingsOpen.value || ui.acOpen.value;
  }

  /** Menü durumuna göre girdi ve fare kilidini ayarla. */
  /** Host: sunucudaki demo kaydını indir. */
  downloadDemo() {
    this.#conn?.send({ t: 'demo' });
  }

  syncInputState() {
    const menu = this.anyMenuOpen();
    this.input.enabled = !menu;
    if (menu) this.input.unlock();
  }

  // ───────────────────────── bağlantı ─────────────────────────

  async connect(opts: { name: string; room?: string; create?: boolean; practice?: boolean }) {
    ui.screen.value = 'connecting';
    ui.connectingText.value = tr.connecting;
    await audio.init().catch(() => {});
    audio.resume();
    const conn = new Connection({
      onMessage: (m) => this.onMessage(m),
      onSnapshot: (s) => this.onSnapshot(s),
      onClose: () => {
        if (ui.screen.value === 'game' || ui.screen.value === 'connecting') {
          ui.error.value = this.kickReason || tr.disconnected;
          ui.screen.value = 'error';
        }
        this.stop();
      },
    });
    this.#conn = conn;
    try {
      await conn.whenOpen();
    } catch {
      ui.error.value = tr.disconnected;
      ui.screen.value = 'error';
      return;
    }
    const tokenKey = opts.room ? `kervan.token.${opts.room.toUpperCase()}` : '';
    const token = tokenKey ? sessionStorage.getItem(tokenKey) ?? undefined : undefined;
    this.kickReason = '';
    conn.send({ t: 'join', name: opts.name, room: opts.room, create: opts.create, practice: opts.practice, version: PROTOCOL_VERSION, token, did: deviceId() });
  }

  /** UI'den sunucuya kontrol mesajı. */
  send(msg: ClientMsg) {
    this.#conn?.send(msg);
  }

  disconnect() {
    this.#conn?.close();
    this.#conn = null;
    this.stop();
    this.sim = null;
    this.state = null;
    this.#snaps = [];
    for (const r of this.#remotes.values()) r.model.dispose();
    this.#remotes.clear();
    this.smoke.clear();
    this.fx.clear();
    ui.state.value = null;
    ui.screen.value = 'menu';
    this.input.unlock();
    history.replaceState(null, '', location.pathname);
  }

  private onMessage(m: ServerMsg) {
    switch (m.t) {
      case 'welcome':
        this.myId = m.id;
        ui.myId.value = m.id;
        ui.room.value = m.room;
        sessionStorage.setItem(`kervan.token.${m.room}`, m.token);
        history.replaceState(null, '', `?oda=${encodeURIComponent(m.room)}`);
        ui.screen.value = 'game';
        this.#tickOffset = NaN;
        this.#history = [];
        this.sim = null;
        this.#snaps = [];
        this.start();
        if (!this.windHandle && audio.ready) this.windHandle = audio.play2D('wind', 0.06);
        log(`Odaya bağlanıldı: ${m.room} (tick ${m.tickRate})`);
        break;
      case 'error':
        ui.error.value = m.msg;
        ui.screen.value = 'error';
        this.#conn?.close();
        break;
      case 'state': {
        const { t: _t, ...st } = m;
        void _t;
        const prev = this.state;
        this.state = st;
        ui.state.value = st;
        if (prev && prev.phase !== st.phase) this.onPhaseChange(prev.phase, st.phase);
        break;
      }
      case 'ev':
        for (const e of m.list) this.onEvent(e);
        break;
      case 'ping':
        this.ping = m.ping;
        this.#conn?.send({ t: 'pong', s: m.s });
        break;
      case 'kicked':
        this.kickReason = m.auto ? `Hile koruması seni attı: ${m.reason}` : `Odadan çıkarıldın: ${m.reason}`;
        ui.error.value = this.kickReason;
        ui.screen.value = 'error';
        break;
      case 'acreport':
        ui.acReport.value = { auto: m.auto, players: m.players, bans: m.bans };
        break;
      case 'demo': {
        const blob = new Blob([JSON.stringify(m.demo)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `kervan-demo-${m.demo.room}-${new Date(m.demo.created).toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
        pushNotice('Demo indirildi', 'good');
        break;
      }
      case 'acn': {
        const n = m.n;
        void security.answer(n, m.files).then((r) => this.#conn?.send({ t: 'acn', n, h: r.h, f: r.f }));
        break;
      }
      case 'chat': {
        const list = ui.chat.value.slice(-30);
        list.push({ id: performance.now(), name: m.name, text: m.text, team: m.team, teamId: m.teamId, dead: m.dead, t: performance.now() });
        ui.chat.value = list;
        audio.play2D('ui_click', 0.4);
        break;
      }
      default:
        break;
    }
  }

  private onPhaseChange(_from: Phase, to: Phase) {
    if (to === Phase.Freeze) {
      ui.buyOpen.value = false;
      ui.deathInfo.value = null;
    }
    if (to === Phase.Halftime) ui.centerText.value = { text: tr.halftime, sub: '', t: performance.now(), kind: 'info' };
    if (to === Phase.MatchEnd) ui.scoreOpen.value = true;
    if (to === Phase.Warmup) ui.scoreOpen.value = false;
  }

  // ───────────────────────── zaman ─────────────────────────

  serverTickNow(): number {
    if (this.#demo) return this.#demo.tick;
    if (Number.isNaN(this.#tickOffset)) return 0;
    return performance.now() * (TICK_RATE / 1000) + this.#tickOffset;
  }

  renderTick(at = performance.now()): number {
    if (this.#demo) return this.#demo.tick;
    if (Number.isNaN(this.#tickOffset)) return 0;
    return at * (TICK_RATE / 1000) + this.#tickOffset - this.interpTicks;
  }

  private onSnapshot(s: Snapshot) {
    const now = performance.now();
    const sample = s.tick - now * (TICK_RATE / 1000);
    if (Number.isNaN(this.#tickOffset)) this.#tickOffset = sample;
    else {
      const dev = sample - this.#tickOffset;
      this.jitter = this.jitter * 0.95 + Math.abs(dev) * 0.05;
      if (dev > 0) this.#tickOffset += dev * 0.5;
      else this.#tickOffset += dev * 0.02;
    }
    // sunucu en fazla 5 tick interpolasyona izin verir (backtrack koruması)
    this.interpTicks = Math.max(2.2, Math.min(5, 1.6 + this.jitter * 2.5));
    if (this.lastSnapTick && s.tick > this.lastSnapTick + 1) this.lostSnaps += s.tick - this.lastSnapTick - 1;
    this.lastSnapTick = Math.max(this.lastSnapTick, s.tick);
    this.snapCount++;

    const ents = new Map<number, EntityState>();
    for (const e of s.entities) ents.set(e.id, e);
    this.#snaps.push({ tick: s.tick, ents, grenades: s.grenades, dropped: s.dropped, bomb: s.bomb });
    if (this.#snaps.length > 96) this.#snaps.shift();
    this.spectating = s.spectating;

    if (s.local) this.reconcile(s.local, s.ackSeq);
  }

  private reconcile(server: PlayerSim, ack: number) {
    const prev = this.sim;
    // onaylanan komutları at
    while (this.#history.length && this.#history[0]!.seq <= ack) this.#history.shift();
    if (!prev || prev.alive !== server.alive || prev.team !== server.team) {
      this.sim = server;
      for (const c of this.#history) simulateCmd(this.sim, c, this.simEnv());
      this.snapRender();
      if (server.alive && !prev?.alive) this.viewmodel.redeploy();
      this.viewmodel.setTeam(server.team);
      return;
    }
    const old = { ...prev.move.origin };
    const sim = server;
    for (const c of this.#history) simulateCmd(sim, c, this.simEnv());
    this.sim = sim;
    const ex = old.x - sim.move.origin.x;
    const ey = old.y - sim.move.origin.y;
    const ez = old.z - sim.move.origin.z;
    const err = Math.hypot(ex, ey, ez);
    if (err > 64) {
      this.smoothing.set(0, 0, 0);
      this.snapRender();
    } else if (err > 0.01) {
      this.smoothing.x += ex;
      this.smoothing.y += ey;
      this.smoothing.z += ez;
    }
    // render tamponlarını yeni duruma kaydır
    this.renderCur = { x: sim.move.origin.x, y: sim.move.origin.y, z: sim.move.origin.z, eye: eyeHeight(sim.move) };
  }

  private snapRender() {
    if (!this.sim) return;
    const m = this.sim.move;
    this.renderPrev = { x: m.origin.x, y: m.origin.y, z: m.origin.z, eye: eyeHeight(m) };
    this.renderCur = { ...this.renderPrev };
    this.smoothing.set(0, 0, 0);
  }

  // ───────────────────────── tahmin ─────────────────────────

  private remoteBoxes(): EntityBox[] {
    const out: EntityBox[] = [];
    const rt = this.renderTick();
    for (const [id] of this.#remotes) {
      const e = this.interpEntity(id, rt);
      if (!e || !(e.flags & EF_ALIVE)) continue;
      const h = e.flags & EF_DUCKED ? 54 : 72;
      out.push({ id, mins: { x: e.pos.x - 16, y: e.pos.y - 16, z: e.pos.z }, maxs: { x: e.pos.x + 16, y: e.pos.y + 16, z: e.pos.z + h } });
    }
    return out;
  }

  private simEnv(): SimEnv {
    const st = this.state;
    const phase = st?.phase ?? Phase.Warmup;
    return {
      world: this.world,
      entities: this.remoteBoxes(),
      frozen: phase === Phase.Freeze || phase === Phase.Halftime,
      canAttack: phase !== Phase.Freeze && phase !== Phase.Halftime,
      canPlant: phase === Phase.Live && st?.bomb.state !== BombState.Planted && this.sim?.team === Team.T,
    };
  }

  private clientTick(tickTime: number) {
    const conn = this.#conn;
    if (!conn) return;
    const buttons = this.input.buttons();
    let yaw = this.input.yaw;
    let pitch = this.input.pitch;
    let fireFrac = 255;
    // zaman damgası tick zamanına göre: (renderTick − seq) sabit kalır, sunucu bunu doğrular
    let rt = this.renderTick(tickTime);
    const press = this.input.takeFirePress();
    if (press) {
      // subtick: tıklama anının tick içindeki yeri ve o andaki açı
      const at = Math.max(press.t, tickTime - DT * 1000);
      const frac = (at - (tickTime - DT * 1000)) / (DT * 1000);
      fireFrac = Math.max(0, Math.min(254, Math.round(frac * 254)));
      yaw = press.yaw;
      pitch = press.pitch;
      rt = this.renderTick(at);
    }
    const cmd: UserCmd = { seq: ++this.seq, buttons, yaw, pitch, weapon: this.pendingWeapon, renderTick: rt, fireFrac };
    this.pendingWeapon = ITEM_NONE;
    this.#history.push(cmd);
    if (this.#history.length > MAX_HISTORY) this.#history.shift();

    if (this.sim && this.sim.alive) {
      const m = this.sim.move;
      this.renderPrev = { x: m.origin.x, y: m.origin.y, z: m.origin.z, eye: eyeHeight(m) };
      const events = simulateCmd(this.sim, cmd, this.simEnv());
      this.renderCur = { x: m.origin.x, y: m.origin.y, z: m.origin.z, eye: eyeHeight(m) };
      for (const ev of events) this.onPredicted(ev, cmd);
      this.localSounds();
    }
    const n = this.#history.length;
    conn.sendCmds(this.#history.slice(Math.max(0, n - 3)));
  }

  /** Tahmin edilen olayların (ilk simülasyonda) efektleri. */
  private onPredicted(ev: SimEvent, _cmd: UserCmd) {
    const sim = this.sim!;
    switch (ev.kind) {
      case 'shot': {
        const def = weaponByNum(ev.weapon)!;
        this.viewmodel.onFire(def);
        const name = ev.silenced ? `shot_${def.key}_sil` : `shot_${def.key}`;
        audio.play2D(audio.has(name) ? name : `shot_${def.key}`, ev.silenced ? 0.55 : 0.9);
        const eye = new THREE.Vector3(ev.origin.x, ev.origin.z, -ev.origin.y);
        const { forward, right, up } = angleVectors(_cmd.pitch, _cmd.yaw);
        const mz = eye
          .clone()
          .add(new THREE.Vector3(forward.x, forward.z, -forward.y).multiplyScalar(18))
          .add(new THREE.Vector3(right.x, right.z, -right.y).multiplyScalar(4))
          .add(new THREE.Vector3(up.x, up.z, -up.y).multiplyScalar(-4));
        for (let i = 0; i < ev.dirs.length; i++) {
          const res = traceBullet(this.world, ev.origin, ev.dirs[i]!, def, [], this.myId);
          for (const imp of res.impacts) this.effects.impact(imp.point, imp.normal, imp.mat, imp.exit);
          for (const sv of this.smoke.volumes) if (carveSmokeLine(sv, ev.origin, res.end)) this.smoke.markHoles(sv.id);
          if (i === 0 && (sim.wpn.shotCounter % Math.max(1, def.tracerFrequency) === 0 || def.numBullets > 1)) {
            this.effects.tracer(mz, new THREE.Vector3(res.end.x, res.end.z, -res.end.y));
          }
          if (this.state?.settings.showImpacts) {
            for (const imp of res.impacts) this.effects.debugBox(imp.point);
          }
        }
        this.shake = Math.max(this.shake, def.category === 'sniper' ? 0.6 : 0.15);
        break;
      }
      case 'melee':
        this.viewmodel.onMelee(ev.heavy);
        audio.play2D('knife_swing', 0.6);
        break;
      case 'throw':
        this.viewmodel.onThrow();
        audio.play2D('throw', 0.6);
        break;
      case 'pin':
        audio.play2D('pin', 0.6);
        break;
      case 'dryfire':
        audio.play2D('dryfire', 0.6);
        break;
      case 'deploy':
        audio.play2D('deploy', 0.35);
        break;
      case 'zoom':
        audio.play2D('zoom', 0.5);
        break;
      case 'silencer':
        audio.play2D('silencer', 0.5);
        break;
      case 'burstmode':
        pushNotice(ev.value ? 'Seri atış modu' : 'Yarı otomatik mod');
        audio.play2D('ui_click', 0.5);
        break;
      case 'jump':
        break;
      case 'land': {
        this.viewmodel.onLand(ev.value ?? 0);
        const mat = MATERIALS[sim.move.groundMat]?.step ?? 'concrete';
        if ((ev.value ?? 0) > 200) audio.play2D(`land_${mat}`, 0.5);
        break;
      }
      case 'plantstart':
        audio.play2D('c4_key', 0.6);
        break;
      case 'reload':
        if (ev.value === 1) audio.play2D('shell_in', 0.5);
        break;
      default:
        break;
    }
  }

  private localSounds() {
    const sim = this.sim;
    if (!sim || !sim.alive) return;
    const m = sim.move;
    const speed = Math.hypot(m.velocity.x, m.velocity.y);
    const walking = (m.oldButtons & IN_SPEED) !== 0;
    if (m.onGround && speed > 150 && !walking && !m.ducked) {
      this.stepAcc += speed * TICK_DT;
      if (this.stepAcc > 82) {
        this.stepAcc = 0;
        const mat = MATERIALS[m.groundMat]?.step ?? 'concrete';
        audio.play2D(`step_${mat}`, 0.33);
      }
    } else if (!m.onGround) this.stepAcc = 60;
    // şarjör sesleri
    const w = sim.wpn;
    if (w.reloadEnd > 0 && w.reloadEnd !== this.lastReloadEnd) {
      this.lastReloadEnd = w.reloadEnd;
      const def = activeDef(sim);
      const start = performance.now();
      const ms = def.reloadTime * 1000;
      this.reloadSounds.forEach((t) => clearTimeout(t));
      this.reloadSounds = [
        window.setTimeout(() => audio.play2D('mag_out', 0.5), ms * 0.22),
        window.setTimeout(() => audio.play2D('mag_in', 0.55), ms * 0.58),
        window.setTimeout(() => audio.play2D(def.category === 'pistol' ? 'mag_in' : 'bolt', 0.5), ms * 0.82),
      ];
      void start;
    }
    if (w.reloadEnd === 0 && this.lastReloadEnd !== 0) {
      this.lastReloadEnd = 0;
    }
  }

  // ───────────────────────── olaylar ─────────────────────────

  private nameOf(id: number): string {
    return playerById(id)?.name ?? (id < 0 ? 'Dünya' : `#${id}`);
  }
  private teamOf(id: number): number {
    return playerById(id)?.team ?? 0;
  }

  private entityPos(id: number): Vec3 | null {
    if (id === this.myId && this.sim) return this.sim.move.origin;
    const e = this.interpEntity(id, this.renderTick());
    return e ? e.pos : null;
  }

  private onEvent(e: GameEvent) {
    switch (e.e) {
      case 'shot': {
        const def = weaponByNum(e.w);
        if (!def) return;
        const o = { x: e.o[0], y: e.o[1], z: e.o[2] };
        const name = e.sil ? `shot_${def.key}_sil` : `shot_${def.key}`;
        audio.play3D(audio.has(name) ? name : `shot_${def.key}`, o, { gain: e.sil ? 0.5 : 1, ref: e.sil ? 150 : 400, max: e.sil ? 1500 : 7000 });
        const vis = this.#remotes.get(e.id);
        const from = vis ? vis.model.muzzle.clone() : new THREE.Vector3(o.x, o.z, -o.y);
        if (vis) vis.model.fireKick = 1;
        if (!e.sil) this.effects.muzzleFlash(from, def.category === 'sniper' || def.category === 'heavy');
        e.d.forEach((d, i) => {
          const dir = { x: d[0], y: d[1], z: d[2] };
          const res = traceBullet(this.world, o, dir, def, [], e.id);
          for (const imp of res.impacts) this.effects.impact(imp.point, imp.normal, imp.mat, imp.exit);
          for (const sv of this.smoke.volumes) if (carveSmokeLine(sv, o, res.end)) this.smoke.markHoles(sv.id);
          if (i === 0 && Math.random() < 0.55) this.effects.tracer(from, new THREE.Vector3(res.end.x, res.end.z, -res.end.y));
        });
        break;
      }
      case 'hit': {
        const p = { x: e.p[0], y: e.p[1], z: e.p[2] };
        // saldırganın yeri bilinmiyorsa (görüş sisi) yön olarak kendi konumumuzu ya da yukarıyı kullan
        const att = e.a === this.myId ? this.sim?.move.origin : e.a >= 0 ? this.entityPos(e.a) : null;
        const from = e.from ? { x: e.from[0], y: e.from[1], z: e.from[2] } : att ? { x: att.x, y: att.y, z: att.z + 60 } : { x: p.x, y: p.y, z: p.z - 1 };
        const dir = { x: p.x - from.x, y: p.y - from.y, z: p.z - from.z };
        const victim = playerById(e.v);
        const helmet = e.hel ?? victim?.helmet ?? false;
        const head = e.hg === 1;
        if (e.a >= 0) this.effects.blood(p, dir, head);
        if (e.a === this.myId && e.v !== this.myId) {
          audio.play2D(head ? (helmet ? 'hit_head' : 'hit_headnohelm') : 'hit_body', head ? 0.7 : 0.45);
        } else if (head) audio.play3D(helmet ? 'hit_head' : 'hit_headnohelm', p, { gain: 0.6, ref: 200, max: 2000 });
        if (e.v === this.myId) {
          if (this.sim) {
            this.sim.health = e.hp;
            this.sim.armor = e.armor;
          }
          if (e.a !== this.myId && e.a >= 0) {
            const ang = vectorAngles(dir).yaw;
            const rel = ((ang + 180 - this.input.yaw + 540) % 360) - 180;
            ui.damageDirs.value = [...ui.damageDirs.value.filter((d) => performance.now() - d.t < 1500), { id: performance.now(), angle: rel, t: performance.now() }];
          }
          this.shake = Math.max(this.shake, 0.4);
          audio.play2D('hit_body', 0.5, 0.8);
        }
        break;
      }
      case 'kill': {
        const entry: KillEntry = {
          id: performance.now() + Math.random(),
          killer: e.k >= 0 ? this.nameOf(e.k) : '',
          killerTeam: this.teamOf(e.k),
          victim: this.nameOf(e.v),
          victimTeam: this.teamOf(e.v),
          weapon: weaponByNum(e.w)?.key ?? 'knife',
          hs: e.hs,
          wb: e.wb,
          smoke: e.smoke,
          blind: e.blind,
          noscope: e.noscope,
          assister: e.as >= 0 ? this.nameOf(e.as) : '',
          mine: e.k === this.myId || e.v === this.myId || e.as === this.myId,
          t: performance.now(),
        };
        ui.killfeed.value = [...ui.killfeed.value.filter((k) => performance.now() - k.t < 7000).slice(-5), entry];
        if (e.v === this.myId) {
          ui.deathInfo.value = { killer: e.k >= 0 && e.k !== this.myId ? this.nameOf(e.k) : '', weapon: weaponByNum(e.w)?.name ?? '', hs: e.hs, hp: Math.max(0, playerById(e.k)?.hp ?? 0) };
          ui.buyOpen.value = false;
          this.syncInputState();
        }
        const r = this.#remotes.get(e.v);
        if (r) r.model.fireKick = 0;
        break;
      }
      case 'deathinfo': {
        const d = ui.deathInfo.value;
        if (d) ui.deathInfo.value = { ...d, hp: e.hp };
        break;
      }
      case 'sound': {
        const r = e.r ?? 1500;
        audio.play3D(e.s, { x: e.p[0], y: e.p[1], z: e.p[2] }, { gain: e.g ?? 0.8, ref: Math.min(140, r / 10), max: Math.min(r * 1.1, 8000) });
        break;
      }
      case 'melee': {
        const pos = this.entityPos(e.id);
        if (pos) {
          audio.play3D('knife_swing', pos, { gain: 0.6, ref: 100, max: 1200 });
          if (e.hit) audio.play3D('knife_hit', pos, { gain: 0.8, ref: 100, max: 1500 });
        }
        break;
      }
      case 'nade_throw': {
        const pos = this.entityPos(e.owner);
        if (pos && e.owner !== this.myId) audio.play3D('throw', pos, { gain: 0.6, ref: 100, max: 1500 });
        break;
      }
      case 'nade_bounce':
        audio.play3D('bounce', { x: e.p[0], y: e.p[1], z: e.p[2] }, { gain: 0.5, ref: 100, max: 1800 });
        break;
      case 'nade_det': {
        const p = { x: e.p[0], y: e.p[1], z: e.p[2] };
        if (e.type === 0) {
          this.effects.explosion(p, 1);
          audio.play3D('he', p, { gain: 1, ref: 500, max: 8000 });
          this.cameraShakeNear(p, 1);
        } else if (e.type === 1) {
          audio.play3D('flash', p, { gain: 0.9, ref: 500, max: 6000 });
          this.effects.explosion(p, 0.25);
        } else if (e.type === 2) {
          audio.play3D('smoke_pop', p, { gain: 0.7, ref: 200, max: 2500 });
        } else if (e.type === 3 || e.type === 4) {
          audio.play3D('glass', p, { gain: 0.8, ref: 200, max: 3000 });
        }
        break;
      }
      case 'smoke': {
        const p = { x: e.p[0], y: e.p[1], z: e.p[2] };
        const vol = fillSmoke(this.world, e.id, p, e.tick);
        this.smoke.add(vol, e.tick / TICK_RATE);
        this.effects.puff(p, [0.8, 0.8, 0.78], 18, 20);
        this.smokeSounds.set(e.id, audio.play3D('smoke_hiss', p, { gain: 0.35, ref: 200, max: 1800, loop: true }));
        setTimeout(() => {
          this.smokeSounds.get(e.id)?.stop();
          this.smokeSounds.delete(e.id);
        }, 3500);
        break;
      }
      case 'smoke_end':
        this.smoke.remove(e.id);
        break;
      case 'smoke_carve': {
        const v = this.smoke.volumes.find((s) => s.id === e.id);
        if (v) {
          carveSmokeSphere(v, { x: e.p[0], y: e.p[1], z: e.p[2] }, e.r);
          this.smoke.markHoles(e.id);
        }
        break;
      }
      case 'inferno': {
        const p = { x: e.p[0], y: e.p[1], z: e.p[2] };
        const inf: Inferno = spawnInferno(this.world, e.id, e.owner, e.team, p, e.tick);
        this.fx.addFire(inf, e.tick / TICK_RATE);
        this.infernoSounds.set(e.id, audio.play3D('fire_loop', inf.center, { gain: 0.7, ref: 200, max: 2500, loop: true }));
        break;
      }
      case 'inferno_end':
        this.fx.removeFire(e.id);
        this.infernoSounds.get(e.id)?.stop();
        this.infernoSounds.delete(e.id);
        break;
      case 'flashed': {
        this.flashStart = performance.now();
        this.flashDur = e.dur;
        this.captureFlash = true;
        audio.flashDeafen(e.dur);
        break;
      }
      case 'decoy': {
        const def = weaponByNum(e.w);
        if (def) audio.play3D(`shot_${def.key}`, { x: e.p[0], y: e.p[1], z: e.p[2] }, { gain: 0.9, ref: 400, max: 6000 });
        break;
      }
      case 'plant': {
        const p = { x: e.p[0], y: e.p[1], z: e.p[2] };
        audio.play3D('c4_plant', p, { gain: 0.9, ref: 300, max: 5000, occlude: false });
        ui.centerText.value = { text: tr.bombPlanted, t: performance.now(), kind: 'info' };
        this.nextBeep = performance.now() + 500;
        break;
      }
      case 'defuse_start': {
        const pos = this.entityPos(e.by);
        if (pos) audio.play3D('defuse_tick', pos, { gain: 0.8, ref: 200, max: 1800 });
        break;
      }
      case 'defused':
        audio.play2D('defused', 0.7);
        ui.centerText.value = { text: tr.bombDefused, t: performance.now(), kind: 'ctw' };
        break;
      case 'explode': {
        const p = { x: e.p[0], y: e.p[1], z: e.p[2] };
        this.effects.explosion(p, 3);
        audio.play3D('c4_explode', p, { gain: 1.2, ref: 1500, max: 20000, occlude: false });
        this.cameraShakeNear(p, 3);
        break;
      }
      case 'round_start':
        audio.play2D('round_start', 0.35);
        ui.deathInfo.value = null;
        ui.damageReport.value = null;
        this.smoke.clear();
        this.fx.clear();
        for (const h of this.infernoSounds.values()) h?.stop();
        this.infernoSounds.clear();
        break;
      case 'round_end': {
        const me = playerById(this.myId);
        const won = me && me.team === e.winner;
        audio.play2D(won ? 'round_win' : 'round_lose', 0.45);
        ui.centerText.value = {
          text: e.winner === Team.T ? tr.tWin : e.winner === Team.CT ? tr.ctWin : tr.draw,
          sub: (tr.reasons[e.reason] ?? '') + (e.mvp >= 0 ? `  •  MVP: ${this.nameOf(e.mvp)}` : ''),
          t: performance.now(),
          kind: e.winner === Team.T ? 'tw' : 'ctw',
        };
        break;
      }
      case 'notice':
        pushNotice(e.text, e.kind);
        log(e.text);
        break;
      case 'spawn':
        if (e.id === this.myId) {
          this.viewmodel.redeploy();
          ui.deathInfo.value = null;
        }
        break;
      case 'pickup': {
        const pos = this.entityPos(e.id);
        if (e.id === this.myId) audio.play2D('pickup', 0.5);
        else if (pos) audio.play3D('pickup', pos, { gain: 0.5, ref: 100, max: 1000 });
        break;
      }
      case 'buy':
        if (e.id === this.myId) audio.play2D('ui_buy', 0.4);
        break;
      case 'reload': {
        const pos = this.entityPos(e.id);
        if (pos) audio.play3D('mag_out', pos, { gain: 0.6, ref: 100, max: 1100 });
        break;
      }
      case 'land': {
        const pos = this.entityPos(e.id);
        if (pos && e.v > 250) audio.play3D('land_concrete', pos, { gain: 0.8, ref: 120, max: 1600 });
        break;
      }
      case 'damage_report': {
        const given = e.given.map((g) => ({ name: this.nameOf(g.id), dmg: g.dmg, hits: g.hits }));
        const taken = e.taken.map((g) => ({ name: this.nameOf(g.id), dmg: g.dmg, hits: g.hits }));
        if (given.length || taken.length) ui.damageReport.value = { given, taken, t: performance.now() };
        log('──── Hasar raporu ────');
        for (const g of given) log(`${tr.damageGiven} → ${g.name}: ${g.dmg} (${g.hits} ${tr.hits})`);
        for (const g of taken) log(`${tr.damageTaken} ← ${g.name}: ${g.dmg} (${g.hits} ${tr.hits})`);
        break;
      }
      default:
        break;
    }
  }

  private cameraShakeNear(p: Vec3, scale: number) {
    const me = this.sim?.move.origin;
    if (!me) return;
    const d = Math.hypot(p.x - me.x, p.y - me.y, p.z - me.z);
    const k = Math.max(0, 1 - d / (900 * scale));
    this.shake = Math.max(this.shake, k * 2.5);
  }

  // ───────────────────────── girdi eylemleri ─────────────────────────

  private onAction(a: string, down: boolean) {
    if (a === 'score') {
      if (this.state?.phase !== Phase.MatchEnd) ui.scoreOpen.value = down;
      return;
    }
    if (!down) return;
    const sim = this.sim;
    switch (a) {
      case 'escape':
        if (ui.consoleOpen.value) ui.consoleOpen.value = false;
        else if (ui.buyOpen.value) ui.buyOpen.value = false;
        else if (ui.settingsOpen.value) ui.settingsOpen.value = false;
        else if (ui.teamMenuOpen.value) ui.teamMenuOpen.value = false;
        else if (ui.matchSettingsOpen.value) ui.matchSettingsOpen.value = false;
        else if (ui.acOpen.value) ui.acOpen.value = false;
        else if (ui.chatOpen.value) ui.chatOpen.value = null;
        else ui.escOpen.value = !ui.escOpen.value;
        this.syncInputState();
        if (!this.anyMenuOpen()) void this.input.lock();
        return;
      case 'console':
        ui.consoleOpen.value = !ui.consoleOpen.value;
        this.syncInputState();
        if (!ui.consoleOpen.value) void this.input.lock();
        return;
      case 'buy':
        if (ui.buyOpen.value) {
          ui.buyOpen.value = false;
          this.syncInputState();
          void this.input.lock();
        } else if (sim?.alive && this.input.enabled) {
          ui.buyOpen.value = true;
          this.syncInputState();
        }
        return;
      case 'teammenu':
        ui.teamMenuOpen.value = true;
        this.syncInputState();
        return;
      case 'chat':
      case 'teamchat':
        ui.chatOpen.value = a === 'chat' ? 'all' : 'team';
        this.syncInputState();
        return;
      case 'drop':
        this.#conn?.send({ t: 'drop' });
        return;
    }
    if (!sim || !sim.alive) return;
    const order = [ITEM_PRIMARY, ITEM_SECONDARY, ITEM_KNIFE, ...GRENADE_KEYS.map((_, i) => ITEM_GRENADE0 + i), ITEM_C4];
    const avail = order.filter((it) => hasItem(sim, it));
    const select = (it: number) => {
      if (hasItem(sim, it) && it !== sim.active) this.pendingWeapon = it;
    };
    switch (a) {
      case 'slot1':
        select(ITEM_PRIMARY);
        break;
      case 'slot2':
        select(ITEM_SECONDARY);
        break;
      case 'slot3':
        select(ITEM_KNIFE);
        break;
      case 'slot4': {
        const nades = avail.filter((it) => it >= ITEM_GRENADE0 && it < ITEM_C4);
        if (!nades.length) break;
        const cur = nades.indexOf(sim.active);
        select(nades[(cur + 1) % nades.length]!);
        break;
      }
      case 'slot5':
        select(ITEM_C4);
        break;
      case 'lastweapon':
        select(sim.lastActive);
        break;
      case 'invnext':
      case 'invprev': {
        const cur = avail.indexOf(sim.active);
        const d = a === 'invnext' ? 1 : -1;
        select(avail[(cur + d + avail.length) % avail.length]!);
        break;
      }
    }
  }

  buy(item: string) {
    this.#conn?.send({ t: 'buy', item });
  }

  // ───────────────────────── döngü ─────────────────────────

  start() {
    if (this.running) return;
    this.running = true;
    this.lastFrame = performance.now();
    this.lastTickTime = this.lastFrame;
    if (!this.windHandle && audio.ready) this.windHandle = audio.play2D('wind', 0.06);
    const loop = (t: number) => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(loop);
      this.frame(t);
    };
    this.raf = requestAnimationFrame(loop);
    // arka plan sekmesinde rAF durur; komutları yine gönder
    const bg = () => {
      if (!this.running) return;
      if (document.hidden) this.pumpTicks(performance.now());
      setTimeout(bg, 50);
    };
    bg();
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.windHandle?.stop();
    this.windHandle = null;
  }

  private pumpTicks(now: number) {
    this.acc += (now - this.lastTickTime) / 1000;
    this.lastTickTime = now;
    if (this.acc > TICK_DT * 10) this.acc = TICK_DT * 10;
    let n = 0;
    while (this.acc >= TICK_DT && n < 10) {
      this.acc -= TICK_DT;
      this.clientTick(now - this.acc * 1000);
      n++;
    }
  }

  private frame(now: number) {
    const dt = Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    if (this.#demo) this.demoFrame(dt);
    else this.pumpTicks(now);
    const alpha = Math.max(0, Math.min(1, this.acc / TICK_DT));
    this.frames++;
    if (now - this.fpsT > 500) {
      this.fps = Math.round((this.frames * 1000) / (now - this.fpsT));
      this.frames = 0;
      this.fpsT = now;
    }
    this.render(dt, alpha, now);
    if (now - this.lastHud > 66) {
      this.lastHud = now;
      this.updateHud(now);
    }
  }

  // ───────────────────────── demo ─────────────────────────

  /** Demo dosyasını aç (bağlantı kapatılır). */
  playDemo(file: DemoFile) {
    if (this.#conn) this.disconnect();
    if (!file.rounds?.length) throw new Error('boş demo');
    this.#demo = { file, round: 0, ticks: [], tick: 0, speed: 1, paused: false, pov: -1, markers: [] };
    this.myId = -1;
    this.sim = null;
    this.state = null;
    ui.state.value = null;
    this.demoRound(0);
    ui.screen.value = 'demo';
    this.start();
  }

  stopDemo() {
    const d = this.#demo;
    if (!d) return;
    for (const m of d.markers) m.removeFromParent();
    this.#demo = null;
    this.#snaps = [];
    for (const r of this.#remotes.values()) r.model.dispose();
    this.#remotes.clear();
    this.fx.clear();
    ui.screen.value = 'menu';
  }

  demoRound(i: number) {
    const d = this.#demo;
    if (!d) return;
    const r = d.file.rounds[Math.max(0, Math.min(d.file.rounds.length - 1, i))]!;
    d.round = d.file.rounds.indexOf(r);
    const bytes = base64ToBytes(r.frames);
    d.ticks = unpackFrames(new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2)));
    d.tick = d.ticks[0]?.tick ?? r.startTick;
    if (r.evidenceFor !== undefined) d.pov = r.evidenceFor;
    else if (!d.ticks[0]?.players.some((p) => p.id === d.pov)) d.pov = d.ticks[0]?.players[0]?.id ?? -1;
    this.demoFill();
  }

  demoInfo() {
    const d = this.#demo;
    if (!d) return null;
    const r = d.file.rounds[d.round]!;
    const first = d.ticks[0]?.tick ?? r.startTick;
    const last = d.ticks[d.ticks.length - 1]?.tick ?? r.endTick;
    return {
      file: d.file,
      round: d.round,
      start: first,
      end: last,
      tick: d.tick,
      speed: d.speed,
      paused: d.paused,
      pov: d.pov,
      events: r.events,
      evidenceFor: r.evidenceFor,
      names: new Map(d.file.players.map((p) => [p.id, p.name])),
      present: [...new Set(d.ticks.flatMap((t) => t.players.map((p) => p.id)))],
    };
  }

  demoControl(c: { seek?: number; speed?: number; paused?: boolean; pov?: number }) {
    const d = this.#demo;
    if (!d) return;
    if (c.seek !== undefined) {
      d.tick = c.seek;
      this.demoFill();
    }
    if (c.speed !== undefined) d.speed = c.speed;
    if (c.paused !== undefined) d.paused = c.paused;
    if (c.pov !== undefined) d.pov = c.pov;
  }

  private demoIndex(tick: number): number {
    const t = this.#demo!.ticks;
    let lo = 0;
    let hi = t.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (t[mid]!.tick <= tick) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  private demoFrame(dt: number) {
    const d = this.#demo!;
    this.sim = null;
    if (!d.ticks.length) return;
    const prev = d.tick;
    const end = d.ticks[d.ticks.length - 1]!.tick;
    if (!d.paused) d.tick = Math.min(end, d.tick + dt * TICK_RATE * d.speed);
    if (d.tick >= end) d.paused = true;
    // aradaki atışlar: iz ve ses
    if (d.tick > prev && d.tick - prev < 16) {
      const r = d.file.rounds[d.round]!;
      for (const e of r.events) {
        if (e.k !== 'shot' || e.tick <= prev || e.tick > d.tick) continue;
        const fr = d.ticks[this.demoIndex(e.tick)]?.players.find((p) => p.id === e.id);
        if (fr?.weapon) this.onEvent({ e: 'shot', id: e.id, w: fr.weapon, m: 0, o: e.o, d: [e.d], sil: false });
      }
    }
    this.demoFill();
  }

  /** Geçerli tick çevresindeki kayıtları snapshot olarak hazırla; bal tuzağı işaretlerini yerleştir. */
  private demoFill() {
    const d = this.#demo!;
    const i = this.demoIndex(d.tick);
    const snaps: SnapRec[] = [];
    for (let k = Math.max(0, i - 2); k <= Math.min(d.ticks.length - 1, i + 3); k++) {
      const t = d.ticks[k]!;
      const next = d.ticks[k + 1];
      const ents = new Map<number, EntityState>();
      for (const p of t.players) {
        const n = next?.players.find((q) => q.id === p.id);
        const vel = n ? { x: (n.x - p.x) * TICK_RATE, y: (n.y - p.y) * TICK_RATE, z: (n.z - p.z) * TICK_RATE } : { x: 0, y: 0, z: 0 };
        ents.set(p.id, { id: p.id, team: p.team, flags: p.flags, pos: { x: p.x, y: p.y, z: p.z }, vel, yaw: p.yaw, pitch: p.pitch, duck: p.duck, weapon: p.weapon, shots: 0 });
      }
      snaps.push({ tick: t.tick, ents, grenades: [], dropped: [], bomb: null });
    }
    this.#snaps = snaps;
    this.spectating = d.pov;
    // bal tuzakları (kırmızı kutu, duvarların arkasından da görünür)
    const r = d.file.rounds[d.round]!;
    const active = r.events.filter((e): e is Extract<DemoEvent, { k: 'honeypot' }> => e.k === 'honeypot' && e.tick <= d.tick && d.tick <= e.end);
    this.#markerTex ??= markerTexture();
    while (d.markers.length < active.length) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.#markerTex, depthTest: false, transparent: true, toneMapped: false }));
      sp.center.set(0.5, 0);
      sp.scale.set(32, 72, 1);
      sp.renderOrder = 999;
      this.renderer.scene.add(sp);
      d.markers.push(sp);
    }
    d.markers.forEach((m, k) => {
      const e = active[k];
      m.visible = !!e;
      if (e) m.position.set(e.p[0], e.p[2], -e.p[1]);
    });
  }

  // ───────────────────────── interpolasyon ─────────────────────────

  private interpEntity(id: number, rt: number): EntityState | null {
    const s = this.#snaps;
    if (!s.length) return null;
    let i = s.length - 1;
    while (i > 0 && s[i]!.tick > rt) i--;
    const a = s[i]!;
    const b = s[Math.min(s.length - 1, i + 1)]!;
    const ea = a.ents.get(id);
    const eb = b.ents.get(id);
    if (!ea && !eb) return null;
    if (!ea) return eb!;
    if (!eb || a === b) {
      // ileri tahmin (en fazla 4 tick)
      const ex = Math.max(0, Math.min(4, rt - a.tick)) * TICK_DT;
      if (!(ea.flags & EF_ALIVE) || ex === 0) return ea;
      return { ...ea, pos: { x: ea.pos.x + ea.vel.x * ex, y: ea.pos.y + ea.vel.y * ex, z: ea.pos.z + (ea.flags & EF_ONGROUND ? 0 : ea.vel.z * ex) } };
    }
    const t = b.tick === a.tick ? 1 : Math.max(0, Math.min(1, (rt - a.tick) / (b.tick - a.tick)));
    // ölüm/doğuş anlarında atlama (ışınlanma)
    const jump = Math.hypot(eb.pos.x - ea.pos.x, eb.pos.y - ea.pos.y) > 96;
    if (jump) return t < 0.5 ? ea : eb;
    return {
      ...eb,
      flags: t < 0.5 ? ea.flags : eb.flags,
      pos: { x: ea.pos.x + (eb.pos.x - ea.pos.x) * t, y: ea.pos.y + (eb.pos.y - ea.pos.y) * t, z: ea.pos.z + (eb.pos.z - ea.pos.z) * t },
      yaw: lerpAngle(ea.yaw, eb.yaw, t),
      pitch: ea.pitch + (eb.pitch - ea.pitch) * t,
      duck: ea.duck + (eb.duck - ea.duck) * t,
    };
  }

  private interpGrenades(rt: number) {
    const s = this.#snaps;
    if (!s.length) return [];
    let i = s.length - 1;
    while (i > 0 && s[i]!.tick > rt) i--;
    const a = s[i]!;
    const b = s[Math.min(s.length - 1, i + 1)]!;
    const t = b.tick === a.tick ? 1 : Math.max(0, Math.min(1, (rt - a.tick) / (b.tick - a.tick)));
    return a.grenades.map((g) => {
      const gb = b.grenades.find((x) => x.id === g.id);
      if (!gb) return g;
      return { ...g, pos: { x: g.pos.x + (gb.pos.x - g.pos.x) * t, y: g.pos.y + (gb.pos.y - g.pos.y) * t, z: g.pos.z + (gb.pos.z - g.pos.z) * t } };
    });
  }

  // ───────────────────────── çizim ─────────────────────────

  private render(dt: number, alpha: number, now: number) {
    const R = this.renderer;
    const rt = this.renderTick();
    const st = this.state;
    const sim = this.sim;

    // uzak oyuncular
    const latest = this.#snaps[this.#snaps.length - 1];
    const seen = new Set<number>();
    if (latest) {
      for (const id of latest.ents.keys()) {
        const e = this.interpEntity(id, rt);
        if (!e) continue;
        seen.add(id);
        let vis = this.#remotes.get(id);
        if (!vis || vis.team !== e.team) {
          vis?.model.dispose();
          const model = new PlayerModel(e.team);
          R.scene.add(model.root);
          vis = { model, team: e.team, shots: e.shots, stepAcc: 0, lastPos: null, wasAlive: true, wasOnGround: true, wasReloading: false, defuseSound: 0 };
          this.#remotes.set(id, vis);
        }
        const alive = (e.flags & EF_ALIVE) !== 0;
        const pose: PlayerPose = {
          x: e.pos.x,
          y: e.pos.y,
          z: e.pos.z,
          yaw: e.yaw,
          pitch: e.pitch,
          duck: e.duck,
          vx: e.vel.x,
          vy: e.vel.y,
          onGround: (e.flags & EF_ONGROUND) !== 0,
          weapon: e.weapon,
          alive,
          defusing: (e.flags & EF_DEFUSING) !== 0,
          planting: (e.flags & EF_PLANTING) !== 0,
          reloading: (e.flags & EF_RELOADING) !== 0,
        };
        vis.model.update(pose, dt);
        // izlenen oyuncu birinci şahıs: modeli gizle
        const pov = this.#demo ? this.#demo.pov : sim && !sim.alive ? this.spectating : -1;
        vis.model.setVisible(pov !== id);
        // ayak sesleri
        if (vis.lastPos && alive) {
          let d = Math.hypot(e.pos.x - vis.lastPos.x, e.pos.y - vis.lastPos.y);
          if (d > 96) d = 0; // ışınlanma / yeniden belirme
          const speed = Math.hypot(e.vel.x, e.vel.y);
          if (pose.onGround && speed > 150 && !(e.flags & EF_WALKING) && !(e.flags & EF_DUCKED)) {
            vis.stepAcc += d;
            if (vis.stepAcc > 82) {
              vis.stepAcc = 0;
              const g = this.world.traceRay({ ...e.pos, z: e.pos.z + 4 }, { ...e.pos, z: e.pos.z - 24 }, MASK_SHOT);
              const mat = MATERIALS[g.fraction < 1 ? g.mat : Mat.Concrete]?.step ?? 'concrete';
              audio.play3D(`step_${mat}`, e.pos, { gain: 0.9, ref: 110, max: 1250 });
            }
          }
          if (pose.onGround && !vis.wasOnGround) audio.play3D('land_concrete', e.pos, { gain: 0.6, ref: 100, max: 1100 });
        }
        vis.wasOnGround = pose.onGround;
        vis.lastPos = { ...e.pos };
        vis.wasAlive = alive;
      }
    }
    for (const [id, vis] of this.#remotes) {
      if (!seen.has(id)) {
        vis.model.dispose();
        this.#remotes.delete(id);
      }
    }

    // bombalar, yerdeki silahlar, C4
    this.fx.setGrenades(this.interpGrenades(rt), now / 1000);
    if (latest) this.fx.setDropped(latest.dropped);
    const bomb = latest?.bomb ?? null;
    const planted = bomb?.state === BombState.Planted;
    if (planted && st && now >= this.nextBeep) {
      const left = Math.max(0, (st.bomb.explodeTick - this.serverTickNow()) / TICK_RATE);
      const interval = 0.12 + 0.88 * Math.min(1, Math.pow(left / st.settings.c4Timer, 1.25));
      this.nextBeep = now + interval * 1000;
      if (left > 0) {
        audio.play3D('c4_beep', bomb!.pos, { gain: 0.8, ref: 250, max: 4000, occlude: false });
        this.bombBlink = true;
        setTimeout(() => (this.bombBlink = false), 90);
      }
    }
    this.fx.setBomb(bomb?.pos ?? null, planted, this.bombBlink);
    this.fx.update(this.serverTickNow() / TICK_RATE);

    // kamera
    let camPos: THREE.Vector3;
    let yaw = this.input.yaw;
    let pitch = this.input.pitch;
    let fovH = 90;
    let drawVm = false;
    if (sim && sim.alive) {
      const ex = this.renderPrev.x + (this.renderCur.x - this.renderPrev.x) * alpha;
      const ey = this.renderPrev.y + (this.renderCur.y - this.renderPrev.y) * alpha;
      const ez = this.renderPrev.z + (this.renderCur.z - this.renderPrev.z) * alpha;
      const eye = this.renderPrev.eye + (this.renderCur.eye - this.renderPrev.eye) * alpha;
      this.smoothing.multiplyScalar(Math.exp(-dt * 14));
      camPos = new THREE.Vector3(ex + this.smoothing.x, ez + eye + this.smoothing.z, -(ey + this.smoothing.y));
      const w = sim.wpn;
      const k = recoilCvars.weapon_recoil_scale * recoilCvars.view_recoil_tracking;
      pitch += w.viewPunch.p + w.aimPunch.p * k;
      yaw += w.viewPunch.y + w.aimPunch.y * k;
      const def = activeDef(sim);
      if (def.zoomLevels > 0 && w.zoom > 0) fovH = def.zoomFov[w.zoom - 1] ?? 90;
      drawVm = true;
      this.input.sensScale = fovH < 90 ? (fovH / 90) * settings.zoomSensitivity : 1;
    } else {
      this.input.sensScale = 1;
      const target = this.spectating && this.spectating !== this.myId ? this.interpEntity(this.spectating, rt) : null;
      if (target && target.flags & EF_ALIVE) {
        const eye = 64 - 18 * target.duck;
        camPos = new THREE.Vector3(target.pos.x, target.pos.z + eye, -target.pos.y);
        yaw = target.yaw;
        pitch = target.pitch;
        if (target.flags & EF_SCOPED) fovH = 40;
      } else if (sim) {
        const o = sim.move.origin;
        camPos = new THREE.Vector3(o.x, o.z + 40, -o.y);
      } else {
        // menü arka planı: haritanın üzerinde yavaş tur
        const t = now / 1000;
        const a = t * 0.05;
        camPos = new THREE.Vector3(-300 + Math.cos(a) * 1200, 520, -(-150 + Math.sin(a) * 1200));
        yaw = (a * 180) / Math.PI + 180;
        pitch = 18;
      }
    }
    if (this.shake > 0) {
      pitch += (Math.random() - 0.5) * this.shake;
      yaw += (Math.random() - 0.5) * this.shake;
      this.shake = Math.max(0, this.shake - dt * 4);
    }
    R.camera.position.copy(camPos);
    R.camera.rotation.set(-pitch * DEG2RAD, (yaw - 90) * DEG2RAD, 0, 'YXZ');
    R.setFov(fovH);
    R.setViewmodelFov(settings.viewmodelFov);
    R.camera.updateMatrixWorld();

    // ses dinleyicisi
    const { forward, up } = angleVectors(pitch, yaw);
    audio.setListener({ x: camPos.x, y: -camPos.z, z: camPos.y }, forward, up);

    // viewmodel
    this.viewmodel.update(dt, drawVm ? sim : null, this.input.yaw, this.input.pitch, sim?.time ?? 0);
    if (drawVm && sim) {
      // gölgede miyiz? (güneşe doğru iz)
      const eyeSim = { x: camPos.x, y: -camPos.z, z: camPos.y };
      const s = this.map.sun;
      const tr2 = this.world.traceRay(eyeSim, { x: eyeSim.x + s.x * 3000, y: eyeSim.y + s.y * 3000, z: eyeSim.z + s.z * 3000 }, MASK_SHOT);
      const target = tr2.fraction >= 1 ? 1 : 0.25;
      R.vmLight += (target - R.vmLight) * Math.min(1, dt * 5);
    }

    // antrenman: bomba yörüngesi
    if (this.state?.settings.practice && sim && sim.alive && sim.wpn.pinPulled && activeDef(sim).category === 'grenade') {
      this.effects.setTrajectory(this.predictTrajectory(sim));
    } else this.effects.setTrajectory(null);

    // sis
    this.smoke.tick(this.serverTickNow() / TICK_RATE, dt);
    this.effects.setViewportHeight(R.size.h, R.camera.fov);
    this.effects.update(dt);

    R.render(drawVm && !this.viewmodel.hidden);

    if (this.captureFlash && this.flashCanvas) {
      this.captureFlash = false;
      const c = this.flashCanvas;
      c.width = Math.floor(R.size.w / 2);
      c.height = Math.floor(R.size.h / 2);
      c.getContext('2d')?.drawImage(R.canvas, 0, 0, c.width, c.height);
    }
    this.drawOverlays(now, sim);
  }

  private drawOverlays(now: number, sim: PlayerSim | null) {
    // flaş
    if (this.flashEl) {
      const t = (now - this.flashStart) / 1000;
      const hold = this.flashDur * 0.45;
      let a = 0;
      if (t < this.flashDur) a = t < hold ? 1 : 1 - (t - hold) / (this.flashDur - hold);
      this.flashEl.style.opacity = String(Math.max(0, Math.min(1, a)));
      this.flashEl.style.display = a > 0.002 ? 'block' : 'none';
    }
    // nişangah
    const ctx = this.crosshairCtx;
    if (!ctx) return;
    const cv = ctx.canvas;
    const W = window.innerWidth;
    const H = window.innerHeight;
    if (cv.width !== W || cv.height !== H) {
      cv.width = W;
      cv.height = H;
    }
    ctx.clearRect(0, 0, W, H);
    if (!sim || !sim.alive) return;
    const def = activeDef(sim);
    const w = sim.wpn;
    const scoped = def.zoomLevels > 0 && w.zoom > 0;
    if (scoped && def.category === 'sniper') {
      drawScope(ctx, W, H, def, sim);
      return;
    }
    if (def.category === 'sniper' && !scoped) return; // keskin nişancıda nişangah yok
    let gapPx = 0;
    if (settings.crosshair.style === 'dynamic') {
      const item = activeItem(sim);
      const mode = weaponMode(sim, def, item);
      const inacc = getInaccuracy(def, mode, w.accuracyPenalty, {
        speed2d: Math.hypot(sim.move.velocity.x, sim.move.velocity.y),
        vz: sim.move.velocity.z,
        onGround: sim.move.onGround,
        ducked: sim.move.ducked,
        walking: false,
      });
      const fov = (this.renderer.camera.fov * Math.PI) / 180;
      gapPx = ((inacc + def.spread[mode]) / Math.tan(fov / 2)) * (H / 2);
    }
    let cy = H / 2;
    let cx = W / 2;
    if (settings.crosshair.followRecoil) {
      const fov = (this.renderer.camera.fov * Math.PI) / 180;
      const k = recoilCvars.weapon_recoil_scale * (1 - recoilCvars.view_recoil_tracking);
      cy += (Math.tan(w.aimPunch.p * k * DEG2RAD) / Math.tan(fov / 2)) * (H / 2);
      cx -= (Math.tan(w.aimPunch.y * k * DEG2RAD) / Math.tan(fov / 2)) * (H / 2);
    }
    drawCrosshair(ctx, cx, cy, settings.crosshair, gapPx, H);
  }

  // ───────────────────────── HUD ─────────────────────────

  private updateHud(now: number) {
    const sim = this.sim;
    const st = this.state;
    const me = playerById(this.myId);
    const h = { ...ui.hud.value };
    h.serverTick = this.serverTickNow();
    h.fps = this.fps;
    h.ping = this.ping;
    h.interpMs = Math.round((this.interpTicks * 1000) / TICK_RATE);
    if (this.#conn && now - this.lastNetT > 1000) {
      const dtn = (now - this.lastNetT) / 1000;
      h.inKbps = Math.round(((this.#conn.bytesIn - this.lastBytesIn) * 8) / 1000 / dtn);
      h.outKbps = Math.round(((this.#conn.bytesOut - this.lastBytesOut) * 8) / 1000 / dtn);
      const expected = this.snapCount + this.lostSnaps;
      h.loss = expected > 0 ? Math.round((this.lostSnaps / expected) * 100) : 0;
      this.lastBytesIn = this.#conn.bytesIn;
      this.lastBytesOut = this.#conn.bytesOut;
      this.snapCount = 0;
      this.lostSnaps = 0;
      this.lastNetT = now;
    }
    if (sim) {
      const def: WeaponDef = activeDef(sim);
      const item = activeItem(sim);
      h.alive = sim.alive;
      h.hp = sim.health;
      h.armor = sim.armor;
      h.helmet = sim.helmet;
      h.clip = item?.clip ?? -1;
      h.reserve = item?.reserve ?? -1;
      h.weaponKey = def.key;
      h.weaponName = def.name;
      h.weaponNum = def.num;
      h.grenades = sim.inv.grenades.slice();
      h.hasC4 = sim.inv.c4;
      h.hasDefuser = sim.inv.defuser;
      h.reloading = sim.wpn.reloadEnd > 0 || sim.wpn.shellReloading;
      h.silencer = !!item?.silencer;
      h.burst = !!item?.burst;
      h.scoped = sim.wpn.zoom > 0;
      h.plantProgress = sim.wpn.plantProgress > 0 ? sim.wpn.plantProgress / PLANT_DURATION : 0;
      const bz = this.world.inTrigger(sim.move.origin, sim.team === Team.T ? 'buyzone_t' : 'buyzone_ct') !== null;
      h.inBuyZone = bz;
      const phase = st?.phase ?? Phase.Warmup;
      const buyTime = st ? h.serverTick <= st.buyEndTick : false;
      h.canBuy = sim.alive && (!!st?.settings.practice || (bz && (phase === Phase.Warmup || ((phase === Phase.Freeze || phase === Phase.Live) && buyTime))));
      h.location = areaName(this.map, sim.move.origin);
    }
    h.money = me?.money ?? 0;
    if (st && st.bomb.defuser >= 0 && st.bomb.state === BombState.Planted) {
      const tot = st.bomb.defuseEndTick - st.bomb.defuseStartTick;
      h.defuseProgress = tot > 0 ? Math.max(0, Math.min(1, (h.serverTick - st.bomb.defuseStartTick) / tot)) : 0;
    } else h.defuseProgress = 0;
    if (sim && !sim.alive && this.spectating) {
      const sp = playerById(this.spectating);
      h.spectating = sp?.name ?? '';
      h.spectatingHp = sp?.hp ?? 0;
    } else h.spectating = '';
    ui.hud.value = h;
    if (ui.buyOpen.value && !h.canBuy && !st?.settings.practice) {
      ui.buyOpen.value = false;
      this.syncInputState();
    }
  }

  private predictTrajectory(sim: PlayerSim): Vec3[] {
    const gi = sim.active - ITEM_GRENADE0;
    const thr = computeThrow(sim, this.input.pitch + sim.wpn.aimPunch.p * recoilCvars.weapon_recoil_scale, this.input.yaw, sim.wpn.throwStrength, this.world);
    const g: Grenade = {
      id: 0,
      type: gi as GrenadeType,
      owner: this.myId,
      ownerTeam: sim.team,
      pos: { ...thr.origin },
      vel: { ...thr.velocity },
      age: 0,
      restTime: 0,
      resting: false,
      detonated: false,
      bounces: 0,
      hitFloor: false,
    };
    const pts: Vec3[] = [{ ...g.pos }];
    for (let i = 0; i < 64 * 4 && !g.detonated && !g.resting; i++) {
      stepGrenade(g, this.world, TICK_DT);
      if (i % 2 === 0) pts.push({ ...g.pos });
    }
    pts.push({ ...g.pos });
    return pts;
  }

  /** Radar için: oyuncu konumları (sim). */
  radarData() {
    const rt = this.renderTick();
    const out: { id: number; x: number; y: number; yaw: number; team: Team; alive: boolean; me: boolean }[] = [];
    if (this.sim) out.push({ id: this.myId, x: this.sim.move.origin.x, y: this.sim.move.origin.y, yaw: this.input.yaw, team: this.sim.team, alive: this.sim.alive, me: true });
    for (const id of this.#remotes.keys()) {
      const e = this.interpEntity(id, rt);
      if (!e) continue;
      out.push({ id, x: e.pos.x, y: e.pos.y, yaw: e.yaw, team: e.team, alive: (e.flags & EF_ALIVE) !== 0, me: false });
    }
    const bomb = this.#snaps[this.#snaps.length - 1]?.bomb ?? null;
    return { players: out, bomb };
  }

  setSettings() {
    saveSettings();
    audio.setVolume(settings.volume);
  }
}

function drawScope(ctx: CanvasRenderingContext2D, W: number, H: number, def: WeaponDef, sim: PlayerSim) {
  const r = H * 0.48;
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.rect(0, 0, W, H);
  ctx.arc(W / 2, H / 2, r, 0, Math.PI * 2, true);
  ctx.fill();
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, H / 2);
  ctx.lineTo(W, H / 2);
  ctx.moveTo(W / 2, 0);
  ctx.lineTo(W / 2, H);
  ctx.stroke();
  // hareket ederken spread halkası (CS'teki bulanık kenar)
  const speed = Math.hypot(sim.move.velocity.x, sim.move.velocity.y);
  const blur = Math.min(1, speed / 120 + (sim.move.onGround ? 0 : 0.8) + sim.wpn.accuracyPenalty * 10);
  if (blur > 0.05) {
    ctx.strokeStyle = `rgba(0,0,0,${0.35 * blur})`;
    ctx.lineWidth = 8 * blur;
    ctx.beginPath();
    ctx.arc(W / 2, H / 2, 6 + 30 * blur, 0, Math.PI * 2);
    ctx.stroke();
  }
  void def;
}

export function vfwd(yaw: number, pitch: number) {
  return angleVectors(pitch, yaw).forward;
}
export { Phase };

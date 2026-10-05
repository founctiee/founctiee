/**
 * Sunucu tarafı hile tespiti. İstemciye güvenmez; yalnızca girdileri (açılar, tuşlar,
 * zaman damgaları) ve sunucunun kendi bildiklerini (görünürlük, isabetler) inceler.
 *
 * Kesin kanıt → anında at:
 *   - bal tuzağı (duvar içindeki sahte rakibe ateş / kilitlenme)
 *   - backtrack (renderTick manipülasyonu), geçersiz girdi, kurcalanmış istemci
 * İstatistiksel → puan eşiği + en az 2 farklı sinyal:
 *   - snap-lock (tek tick'te sıçrayıp kilitlenen nişan), insanüstü tepki süresi,
 *     triggerbot, kusursuz sekme telafisi (no-recoil), yüksek kafa oranı (destek)
 */
import {
  Vec3,
  World,
  MASK_SHOT,
  TICK_RATE,
  HitTarget,
  makeHitTarget,
  rayCapsule,
  angleVectors,
  vectorAngles,
  normalizeAngle,
  HitGroup,
  EntityState,
  EF_ALIVE,
  EF_ONGROUND,
} from '@kervan/shared';

export type Signal = 'snap' | 'reaction' | 'trigger' | 'norecoil' | 'headrate' | 'honeylock';
export type StrongReason = 'honeypot' | 'backtrack' | 'invalid' | 'tamper' | 'integrity' | 'flood';

/** Her olayın puanı ve bir sinyal türünün toplamda katkı sınırı (tek sinyal tek başına atamaz). */
const WEIGHTS: Record<Signal, number> = {
  snap: 1.5,
  reaction: 3,
  trigger: 1.5,
  norecoil: 2,
  headrate: 1,
  honeylock: 3,
};
const CAPS: Record<Signal, number> = {
  snap: 6,
  reaction: 3,
  trigger: 6,
  norecoil: 6,
  headrate: 1,
  honeylock: 9,
};

export const AC_KICK_SCORE = 8;
/** İstemcinin kullanabileceği en büyük interpolasyon (tick). */
export const MAX_INTERP = 5;
/** Maç boyunca bu kadar backtrack ihlali → at. */
export const BACKTRACK_KICK = 5;

export const STRONG_TEXT: Record<StrongReason, string> = {
  honeypot: 'duvar içindeki sahte oyuncuya nişan/ateş (ESP/aimbot)',
  backtrack: 'zaman manipülasyonu (backtrack)',
  invalid: 'geçersiz girdi',
  tamper: 'değiştirilmiş istemci',
  integrity: 'oyun dosyası doğrulanamadı',
  flood: 'mesaj seli',
};

export const SIGNAL_TEXT: Record<Signal, string> = {
  snap: 'kilitlenen nişan',
  reaction: 'insanüstü tepki süresi',
  trigger: 'otomatik tetik',
  norecoil: 'kusursuz sekme telafisi',
  headrate: 'yüksek kafa oranı',
  honeylock: 'görünmeyen hedefe kilitlenme',
};

interface AngleSample {
  tick: number;
  yaw: number;
  pitch: number;
}

interface Honeypot {
  /** Taklit edilen gerçek rakibin id'si. */
  target: number;
  team: number;
  pos: Vec3;
  yaw: number;
  weapon: number;
  endTick: number;
  startTick: number;
  /** Başlarken nişanın sahte kafaya açısı. */
  startErr: number;
  lockTicks: number;
  hits: number;
  locked: boolean;
}

export interface ShotInfo {
  tick: number;
  /** Atıştan önceki komutlar (eskiden yeniye) için açılar. */
  origin: Vec3;
  dirs: Vec3[];
  pitch: number;
  yaw: number;
  punchP: number;
  punchY: number;
  fullAuto: boolean;
  newPress: boolean;
  /** Bu atışta isabet alan rakipler. */
  hits: { id: number; group: HitGroup }[];
}

export class PlayerAC {
  score = 0;
  signals = new Map<Signal, number>();
  log: string[] = [];
  angles: AngleSample[] = [];
  backtrackViolations = 0;
  reactions: number[] = [];
  triggerEvents = 0;
  triggerChecks = 0;
  snapEvents = 0;
  headHits = 0;
  bodyHits = 0;
  spray: { aimP: number; aimY: number; punch: number }[] = [];
  lastShotTick = -100;
  /** Nişan çizgisi bir rakibe en son ne zaman girdi. */
  crosshairEnter = -1;
  crosshairOn = false;
  honeypot: Honeypot | null = null;
  nextHoneypot = 0;
  honeylocks = 0;
  /** Zaman: (varış − seq) en küçükleri (64 tick'lik kovalar). */
  lagBuckets: number[] = [];
  lagBucketTick = 0;
  rtBase = NaN;
  pingSamples = 0;
  /** Tetiklenmiş (kesin) sebep. */
  kicked: string | null = null;
  /** Bütünlük meydan okuması. */
  nonce = '';
  nonceTick = -1;
  integrityOk = false;
  /** Otomatik atma kapalıyken host'a bildirilen sebepler. */
  reported = new Set<string>();
  /** Günlük satırı eklenince (demo kaydı için). */
  onLog: ((text: string) => void) | null = null;

  constructor(firstHoneypotTick: number) {
    this.nextHoneypot = firstHoneypotTick;
  }

  addSignal(sig: Signal, detail: string) {
    this.signals.set(sig, (this.signals.get(sig) ?? 0) + 1);
    let total = 0;
    for (const [k, n] of this.signals) total += Math.min(CAPS[k], n * WEIGHTS[k]);
    this.score = total;
    this.note(`${SIGNAL_TEXT[sig]}: ${detail}`);
  }

  note(text: string) {
    this.log.push(text);
    if (this.log.length > 40) this.log.shift();
    this.onLog?.(text);
  }

  /** Yeniden bağlanmada zaman ölçümleri sıfırlanır (seq baştan başlar). */
  resetTiming() {
    this.lagBuckets = [];
    this.rtBase = NaN;
    this.angles = [];
    this.crosshairOn = false;
    this.crosshairEnter = -1;
  }

  distinctSignals(): number {
    return this.signals.size;
  }

  shouldKick(): boolean {
    return this.score >= AC_KICK_SCORE && this.distinctSignals() >= 2;
  }
}

function angDiff(a: AngleSample, b: AngleSample): number {
  return Math.hypot(normalizeAngle(b.yaw - a.yaw), b.pitch - a.pitch);
}

/** Bir yönün hedef noktaya açısal uzaklığı (derece). */
function angleTo(eye: Vec3, pitch: number, yaw: number, p: Vec3): number {
  const a = vectorAngles({ x: p.x - eye.x, y: p.y - eye.y, z: p.z - eye.z });
  return Math.hypot(normalizeAngle(a.yaw - yaw), a.pitch - pitch);
}

function rayHitsTarget(origin: Vec3, dir: Vec3, t: HitTarget, maxT = 8192): HitGroup | null {
  let best = -1;
  let group: HitGroup | null = null;
  for (const c of t.hitboxes) {
    const d = rayCapsule(origin, dir, c);
    if (d >= 0 && d <= maxT && (best < 0 || d < best)) {
      best = d;
      group = c.group;
    }
  }
  return group;
}

export class AntiCheat {
  readonly players = new Map<number, PlayerAC>();
  onLog: ((id: number, text: string) => void) | null = null;

  constructor(
    private world: World,
    private random: () => number = Math.random,
  ) {}

  get(id: number, tick: number): PlayerAC {
    let p = this.players.get(id);
    if (!p) {
      p = new PlayerAC(tick + Math.round(TICK_RATE * (20 + this.random() * 20)));
      p.onLog = (t) => this.onLog?.(id, t);
      this.players.set(id, p);
    }
    return p;
  }

  forget(id: number) {
    this.players.delete(id);
  }

  // ───────────────────────── zaman / backtrack ─────────────────────────

  /**
   * Komutun renderTick'ini doğrular ve izin verilen pencereye kırpar.
   * seq + (varış − seq)ₘᵢₙ, komutun en erken varış zamanını verir; lag spike'larından etkilenmez.
   * Döner: kırpılmış renderTick ve ihlal olup olmadığı.
   */
  checkRenderTick(
    ac: PlayerAC,
    seq: number,
    arrival: number,
    renderTick: number,
    rttTicks: number,
    isShot: boolean,
    tick: number,
  ): { renderTick: number; violation: boolean } {
    // kova güncelle
    const lag = arrival - seq;
    if (tick - ac.lagBucketTick >= TICK_RATE || ac.lagBuckets.length === 0) {
      ac.lagBuckets.push(lag);
      if (ac.lagBuckets.length > 6) ac.lagBuckets.shift();
      ac.lagBucketTick = tick;
    } else {
      const i = ac.lagBuckets.length - 1;
      ac.lagBuckets[i] = Math.min(ac.lagBuckets[i]!, lag);
    }
    const minLag = Math.min(...ac.lagBuckets);
    const earliest = seq + minLag;
    const minAllowed = earliest - rttTicks - MAX_INTERP - 4;
    let rt = renderTick;
    let violation = false;
    if (!Number.isFinite(rt)) return { renderTick: tick, violation: true };
    // tutarlılık: (renderTick − seq) atış dışı komutlarda sabit kalır
    const rel = rt - seq;
    if (!isShot) {
      // ileri sıçrama (sekme arka plandan döndü, interpolasyon azaldı) hemen kabul edilir
      ac.rtBase = Number.isNaN(ac.rtBase) || rel > ac.rtBase + 16 ? rel : ac.rtBase * 0.95 + rel * 0.05;
    } else if (!Number.isNaN(ac.rtBase) && rel < ac.rtBase - 6) {
      violation = true;
      rt = ac.rtBase + seq;
    }
    if (rt < minAllowed) {
      if (isShot) violation = true;
      rt = minAllowed;
    }
    if (rt > tick) rt = tick;
    // ping ölçülmeden ihlal sayma (yalnızca kırp)
    if (ac.pingSamples < 2) violation = false;
    return { renderTick: rt, violation };
  }

  // ───────────────────────── nişan ─────────────────────────

  onCmd(ac: PlayerAC, tick: number, eye: Vec3, yaw: number, pitch: number, enemies: HitTarget[]) {
    ac.angles.push({ tick, yaw, pitch });
    if (ac.angles.length > 128) ac.angles.shift();
    // nişan çizgisi rakibe girdi mi (triggerbot için)
    const { forward } = angleVectors(pitch, yaw);
    let on = false;
    for (const t of enemies) {
      if (rayHitsTarget(eye, forward, t) !== null) {
        const tr = this.world.traceRay(eye, t.hitboxes[0]!.a, MASK_SHOT);
        if (tr.fraction >= 0.98) {
          on = true;
          break;
        }
      }
    }
    if (on && !ac.crosshairOn) ac.crosshairEnter = tick;
    ac.crosshairOn = on;
    // bal tuzağına kilitlenme
    const hp = ac.honeypot;
    if (hp && tick <= hp.endTick) {
      const head = { x: hp.pos.x + 1.5 * Math.cos((hp.yaw * Math.PI) / 180), y: hp.pos.y + 1.5 * Math.sin((hp.yaw * Math.PI) / 180), z: hp.pos.z + 64 };
      const err = angleTo(eye, pitch, yaw, head);
      if (err < 2 && hp.startErr > 15) {
        hp.lockTicks++;
        if (hp.lockTicks >= 40 && !hp.locked) {
          hp.locked = true;
          ac.honeylocks++;
          ac.addSignal('honeylock', `${(hp.lockTicks / TICK_RATE).toFixed(2)} sn kilit`);
        }
      } else hp.lockTicks = 0;
    }
  }

  /**
   * Atış analizi. enemiesNow: atış anında (lag comp) rakip hedefleri.
   * visibleSince: rakip id → kesin görünürlük başlangıç tick'i.
   * Döner: kesin sebep (bal tuzağı) varsa.
   */
  onShot(ac: PlayerAC, shot: ShotInfo, visibleSince: (id: number) => number): StrongReason | null {
    let strong: StrongReason | null = null;
    // bal tuzağı: atış sahte hedefe gitti mi (duvar yok sayılarak)
    const hp = ac.honeypot;
    if (hp && shot.tick <= hp.endTick && hp.startErr > 15) {
      const ghost = makeHitTarget(hp.target, hp.team, { origin: hp.pos, yaw: hp.yaw, duckAmount: 0 });
      for (const d of shot.dirs) {
        const g = rayHitsTarget(shot.origin, d, ghost, 3000);
        if (g !== null) {
          hp.hits += g === HitGroup.Head ? 2 : 1;
          break;
        }
      }
      if (hp.hits >= 2) strong = 'honeypot';
    }

    // isabet istatistikleri
    for (const h of shot.hits) {
      if (h.group === HitGroup.Head) ac.headHits++;
      else ac.bodyHits++;
    }
    const total = ac.headHits + ac.bodyHits;
    if (total >= 20 && ac.headHits / total > 0.75 && !ac.signals.has('headrate')) ac.addSignal('headrate', `%${Math.round((ac.headHits / total) * 100)} kafa`);

    const firstShot = shot.tick - ac.lastShotTick > 12;
    ac.lastShotTick = shot.tick;

    // snap-lock: tek tick'te ≥4° sıçrama, öncesinde neredeyse durgun, sonrasında hiç kıpırdamadan kafa
    const headHit = shot.hits.some((h) => h.group === HitGroup.Head);
    if (headHit && firstShot && ac.angles.length >= 6) {
      const a = ac.angles;
      const n = a.length;
      for (let k = 0; k <= 2; k++) {
        const iSnap = n - 1 - k;
        if (iSnap < 2) break;
        const snap = angDiff(a[iSnap - 1]!, a[iSnap]!);
        const before = angDiff(a[iSnap - 2]!, a[iSnap - 1]!);
        let after = 0;
        for (let j = iSnap + 1; j < n; j++) after = Math.max(after, angDiff(a[j - 1]!, a[j]!));
        if (snap >= 4 && before < 0.4 && after < 0.05) {
          ac.snapEvents++;
          if (ac.snapEvents >= 2) ac.addSignal('snap', `${snap.toFixed(1)}° tek tick, sonra ${after.toFixed(2)}°`);
          break;
        }
      }
    }

    // tepki süresi: rakip görünür olduktan isabetli ilk atışa
    if (firstShot) {
      for (const h of shot.hits) {
        const since = visibleSince(h.id);
        if (since < 0) continue;
        const dt = shot.tick - since;
        if (dt >= 0 && dt < 64) {
          ac.reactions.push(dt);
          if (ac.reactions.length > 12) ac.reactions.shift();
          if (ac.reactions.length >= 6) {
            const sorted = [...ac.reactions].sort((x, y) => x - y);
            const med = sorted[Math.floor(sorted.length / 2)]!;
            if (med < 7 && !ac.signals.has('reaction')) ac.addSignal('reaction', `medyan ${Math.round((med * 1000) / TICK_RATE)} ms`);
          }
        }
        break;
      }
    }

    // triggerbot: tetik, nişanın rakibe girdiği tick'te (ya da bir sonrakinde)
    // yalnızca nişan sabit tutulurken (rakip nişana yürüdüğünde) sayılır; insan burada ≥150 ms tepki verir
    const still = ac.angles.length >= 5 && ac.angles.slice(-5).every((a, i, arr) => i === 0 || angDiff(arr[i - 1]!, a) < 0.15);
    if (shot.newPress && still && ac.crosshairOn && ac.crosshairEnter >= 0) {
      ac.triggerChecks++;
      const dt = shot.tick - ac.crosshairEnter;
      if (dt <= 1) {
        ac.triggerEvents++;
        if (ac.triggerEvents >= 3 && ac.triggerEvents / ac.triggerChecks > 0.6) ac.addSignal('trigger', `${ac.triggerEvents}/${ac.triggerChecks} anlık tetik`);
      }
    }

    // no-recoil: spreyde mermi yönünün (açı + 2·punch) kusursuz sabit kalması
    if (shot.fullAuto) {
      if (firstShot) ac.spray = [];
      ac.spray.push({ aimP: shot.pitch, aimY: shot.yaw, punch: Math.hypot(shot.punchP, shot.punchY) });
      if (ac.spray.length === 12) {
        const xs = ac.spray.slice(2);
        const mp = xs.reduce((s, v) => s + v.aimP, 0) / xs.length;
        const my = xs.reduce((s, v) => s + v.aimY, 0) / xs.length;
        const sd = Math.sqrt(xs.reduce((s, v) => s + (v.aimP - mp) ** 2 + normalizeAngle(v.aimY - my) ** 2, 0) / xs.length);
        const punchRange = Math.max(...xs.map((v) => v.punch)) - Math.min(...xs.map((v) => v.punch));
        if (sd < 0.08 && punchRange > 2) ac.addSignal('norecoil', `sapma ${sd.toFixed(3)}°`);
      }
    } else ac.spray = [];

    return strong;
  }

  // ───────────────────────── bal tuzağı ─────────────────────────

  /**
   * Gerekirse yeni bal tuzağı başlat. hidden: izleyicinin görmediği canlı rakipler.
   */
  maybeStartHoneypot(ac: PlayerAC, tick: number, eye: Vec3, yaw: number, pitch: number, hidden: { id: number; team: number; weapon: number }[]) {
    if (ac.honeypot && tick > ac.honeypot.endTick) ac.honeypot = null;
    if (ac.honeypot || tick < ac.nextHoneypot || hidden.length === 0) return;
    ac.nextHoneypot = tick + Math.round(TICK_RATE * (30 + this.random() * 30));
    const pick = hidden[Math.floor(this.random() * hidden.length)]!;
    const spot = this.findSolidSpot(eye, yaw);
    if (!spot) return;
    const faceYaw = vectorAngles({ x: eye.x - spot.x, y: eye.y - spot.y, z: 0 }).yaw;
    const head = { x: spot.x, y: spot.y, z: spot.z + 64 };
    ac.honeypot = {
      target: pick.id,
      team: pick.team,
      pos: spot,
      yaw: faceYaw,
      weapon: pick.weapon,
      startTick: tick,
      endTick: tick + TICK_RATE * 3,
      startErr: angleTo(eye, pitch, yaw, head),
      lockTicks: 0,
      hits: 0,
      locked: false,
    };
  }

  /** Bal tuzağı aktifken izleyiciye eklenecek sahte entity. */
  honeypotEntity(ac: PlayerAC, tick: number, realVisible: (id: number) => boolean): EntityState | null {
    const hp = ac.honeypot;
    if (!hp || tick > hp.endTick) return null;
    // gerçek oyuncu görünür olduysa tuzak kalkar
    if (realVisible(hp.target)) {
      ac.honeypot = null;
      return null;
    }
    return {
      id: hp.target,
      team: hp.team,
      flags: EF_ALIVE | EF_ONGROUND,
      pos: hp.pos,
      vel: { x: 0, y: 0, z: 0 },
      yaw: hp.yaw,
      pitch: 0,
      duck: 0,
      weapon: hp.weapon,
      shots: 0,
    };
  }

  /** Göze 250–800 birim uzaklıkta, oyuncu hull'ı tamamen katı içinde kalan bir nokta. */
  findSolidSpot(eye: Vec3, viewYaw = 0): Vec3 | null {
    for (let attempt = 0; attempt < 48; attempt++) {
      const ang = this.random() * Math.PI * 2;
      // baktığı yönün 35° yakınına koyma (tesadüfen nişan almasın)
      if (Math.abs(normalizeAngle((ang * 180) / Math.PI - viewYaw)) < 35) continue;
      const dist = 250 + this.random() * 550;
      const base = { x: eye.x + Math.cos(ang) * dist, y: eye.y + Math.sin(ang) * dist, z: Math.max(0, eye.z - 64) };
      if (this.fullyInside(base)) return base;
    }
    return null;
  }

  private fullyInside(o: Vec3): boolean {
    const m = 48;
    for (const dx of [-16 - m, 0, 16 + m])
      for (const dy of [-16 - m, 0, 16 + m])
        for (const dz of [-8, 36, 80]) {
          if (!this.world.pointInSolid({ x: o.x + dx, y: o.y + dy, z: o.z + dz }, MASK_SHOT)) return false;
        }
    return true;
  }
}

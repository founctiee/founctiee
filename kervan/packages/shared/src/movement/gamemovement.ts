/**
 * Source CGameMovement / CCSGameMovement'ın TypeScript portu.
 * Birimler: inç, saniye. Z-yukarı. CS2 convar değerleri ile çalışır.
 */
import { Vec3, vec3, vdot, vcross, clamp, DEG2RAD } from '../math';
import {
  cvars,
  DUCK_SPEED_MODIFIER,
  WALK_SPEED_MODIFIER,
  HULL_MINS,
  HULL_MAXS,
  DUCK_HULL_MAXS,
  MIN_WALK_NORMAL,
  NON_JUMP_VELOCITY,
  VIEW_HEIGHT,
  DUCK_VIEW_HEIGHT,
  DUCK_JUMP_LIFT,
  PLAYER_HEIGHT,
  PLAYER_DUCK_HEIGHT,
} from '../constants';
import { World, EntityBox, DIST_EPSILON, TraceResult } from '../world/world';
import { MASK_PLAYERSOLID } from '../world/brush';
import { Mat } from '../world/materials';
import { UserCmd, IN_DUCK, IN_JUMP, IN_SPEED, cmdMove } from './usercmd';

export interface MoveState {
  origin: Vec3;
  velocity: Vec3;
  onGround: boolean;
  groundMat: Mat;
  /** Hull çömelmiş durumda mı (54u). */
  ducked: boolean;
  /** 0..1 çömelme miktarı (göz yüksekliği ve animasyon). */
  duckAmount: number;
  /** Çömelme hızı (spam cezası ile düşer). */
  duckSpeed: number;
  stamina: number;
  /** Vurulunca yavaşlama (tagging), 1 = normal. */
  velocityModifier: number;
  oldButtons: number;
  /** Zıplama/iniş isabet hesabı için son iniş hızı. */
  lastLandSpeed: number;
  /** Merdiven vb. ileride. */
  noclip: boolean;
}

export function createMoveState(origin: Vec3 = vec3()): MoveState {
  return {
    origin: { ...origin },
    velocity: vec3(),
    onGround: false,
    groundMat: Mat.Concrete,
    ducked: false,
    duckAmount: 0,
    duckSpeed: DUCK_SPEED_IDEAL,
    stamina: 0,
    velocityModifier: 1,
    oldButtons: 0,
    lastLandSpeed: 0,
    noclip: false,
  };
}

export function cloneMoveState(s: MoveState): MoveState {
  return {
    ...s,
    origin: { ...s.origin },
    velocity: { ...s.velocity },
  };
}

export interface MoveContext {
  world: World;
  /** Diğer oyuncuların kutuları (oyuncu-oyuncu çarpışması). */
  entities?: readonly EntityBox[];
  selfId: number;
  /** Silahın ve scope'un belirlediği azami hız (u/s). */
  maxSpeed: number;
  /** Freeze time, kurma/imha sırasında hareket yok. */
  frozen: boolean;
  dt: number;
}

export interface MoveEvents {
  jumped: boolean;
  /** İnişte düşey hız (u/s), inmediyse 0. */
  landed: number;
}

const DUCK_SPEED_IDEAL = 8;
const MAX_CLIP_PLANES = 5;

export function hullMaxs(s: MoveState): Vec3 {
  return s.ducked ? DUCK_HULL_MAXS : HULL_MAXS;
}

export function eyeHeight(s: MoveState): number {
  const t = s.duckAmount;
  // smoothstep: CS'teki gibi yumuşak geçiş
  const e = t * t * (3 - 2 * t);
  return VIEW_HEIGHT + (DUCK_VIEW_HEIGHT - VIEW_HEIGHT) * e;
}

/** Bir tick'lik oyuncu hareketi. */
export function playerMove(s: MoveState, cmd: UserCmd, ctx: MoveContext): MoveEvents {
  const ev: MoveEvents = { jumped: false, landed: 0 };
  const dt = ctx.dt;
  const pm = new PM(s, cmd, ctx);

  if (s.noclip) {
    pm.noclipMove();
    s.oldButtons = cmd.buttons;
    return ev;
  }

  pm.reduceTimers();

  let { forward, side } = cmdMove(cmd.buttons);
  if (ctx.frozen) {
    forward = 0;
    side = 0;
  }

  // azami hız: silah, yürüme, tagging
  let maxspeed = Math.min(ctx.maxSpeed, cvars.sv_maxspeed) * s.velocityModifier;
  if (cmd.buttons & IN_SPEED) maxspeed *= WALK_SPEED_MODIFIER;
  pm.maxspeed = maxspeed;

  // CheckParameters: girişi azami hıza kırp
  const spd = Math.hypot(forward, side);
  if (spd > maxspeed && spd > 0) {
    const r = maxspeed / spd;
    forward *= r;
    side *= r;
  }

  pm.duck();

  // çömelikken yerde hız kırpma (HandleDuckingSpeedCrop)
  if (s.onGround && (s.ducked || (cmd.buttons & IN_DUCK && s.duckAmount > 0))) {
    forward *= DUCK_SPEED_MODIFIER;
    side *= DUCK_SPEED_MODIFIER;
  }
  pm.fmove = forward;
  pm.smove = side;

  const wasOnGround = s.onGround;
  const preFallVel = s.velocity.z;

  // FullWalkMove
  if (!s.onGround) pm.startGravity();

  if (cmd.buttons & IN_JUMP && !ctx.frozen) {
    if (pm.checkJumpButton()) ev.jumped = true;
  }

  if (s.onGround) {
    s.velocity.z = 0;
    pm.friction();
  }
  pm.checkVelocity();

  if (s.onGround) pm.walkMove();
  else pm.airMove();

  pm.categorizePosition();
  pm.checkVelocity();

  if (!s.onGround) pm.finishGravity();
  if (s.onGround) s.velocity.z = 0;

  if (!wasOnGround && s.onGround) {
    const fall = -Math.min(preFallVel, pm.lastAirZVel);
    ev.landed = Math.max(0, fall);
    s.lastLandSpeed = ev.landed;
    // iniş stamina cezası
    s.stamina = clamp(s.stamina + cvars.sv_staminalandcost * ev.landed * STAMINA_SCALE, 0, cvars.sv_staminamax);
  }

  s.oldButtons = cmd.buttons;
  void dt;
  return ev;
}

/** Stamina birimi ölçeği (zıplama/iniş cezasının ne kadar sert hissettirdiği). */
const STAMINA_SCALE = 0.25;

class PM {
  fmove = 0;
  smove = 0;
  maxspeed = 250;
  lastAirZVel = 0;
  private readonly mins = HULL_MINS;

  constructor(
    readonly s: MoveState,
    readonly cmd: UserCmd,
    readonly ctx: MoveContext,
  ) {}

  private trace(start: Vec3, end: Vec3, maxs: Vec3 = hullMaxs(this.s)): TraceResult {
    return this.ctx.world.traceHull(start, end, this.mins, maxs, MASK_PLAYERSOLID, this.ctx.entities, this.ctx.selfId);
  }

  reduceTimers() {
    const dt = this.ctx.dt;
    const s = this.s;
    if (s.stamina > 0) {
      s.stamina -= cvars.sv_staminarecoveryrate * dt;
      if (s.stamina < 0) s.stamina = 0;
    }
    s.duckSpeed = Math.min(DUCK_SPEED_IDEAL, s.duckSpeed + dt * 3);
    if (s.velocityModifier < 1) s.velocityModifier = Math.min(1, s.velocityModifier + dt * 0.4);
  }

  wishVectors(): { forward: Vec3; right: Vec3 } {
    const yaw = this.cmd.yaw * DEG2RAD;
    const forward = { x: Math.cos(yaw), y: Math.sin(yaw), z: 0 };
    const right = { x: Math.sin(yaw), y: -Math.cos(yaw), z: 0 };
    return { forward, right };
  }

  startGravity() {
    this.s.velocity.z -= cvars.sv_gravity * 0.5 * this.ctx.dt;
  }

  finishGravity() {
    this.s.velocity.z -= cvars.sv_gravity * 0.5 * this.ctx.dt;
    this.lastAirZVel = this.s.velocity.z;
  }

  checkVelocity() {
    const v = this.s.velocity;
    const m = cvars.sv_maxvelocity;
    v.x = clamp(v.x, -m, m);
    v.y = clamp(v.y, -m, m);
    v.z = clamp(v.z, -m, m);
  }

  checkJumpButton(): boolean {
    const s = this.s;
    if (!s.onGround) return false;
    // basılı tutmak tekrar zıplatmaz (autobhop kapalı)
    if (s.oldButtons & IN_JUMP) return false;
    // tavan kontrolü (çömelik zıplarken de geçerli)
    s.onGround = false;
    let jump = cvars.sv_jump_impulse;
    if (s.stamina > 0) {
      const ratio = (cvars.sv_staminamax - s.stamina) / cvars.sv_staminamax;
      jump *= ratio;
    }
    s.velocity.z = jump;
    s.stamina = clamp(s.stamina + cvars.sv_staminajumpcost * cvars.sv_jump_impulse * STAMINA_SCALE, 0, cvars.sv_staminamax);
    this.finishGravity();
    return true;
  }

  friction() {
    const v = this.s.velocity;
    const speed = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
    if (speed < 0.1) return;
    let drop = 0;
    if (this.s.onGround) {
      const friction = cvars.sv_friction;
      const control = speed < cvars.sv_stopspeed ? cvars.sv_stopspeed : speed;
      drop += control * friction * this.ctx.dt;
    }
    let newspeed = speed - drop;
    if (newspeed < 0) newspeed = 0;
    if (newspeed !== speed) {
      const k = newspeed / speed;
      v.x *= k;
      v.y *= k;
      v.z *= k;
    }
  }

  accelerate(wishdir: Vec3, wishspeed: number, accel: number) {
    const v = this.s.velocity;
    const currentspeed = vdot(v, wishdir);
    const addspeed = wishspeed - currentspeed;
    if (addspeed <= 0) return;
    // CS:GO: yürürken/çömelirken de koşar gibi hızlı ivmelen
    const accelScale = Math.max(250, wishspeed);
    let accelspeed = accel * this.ctx.dt * accelScale;
    if (accelspeed > addspeed) accelspeed = addspeed;
    v.x += accelspeed * wishdir.x;
    v.y += accelspeed * wishdir.y;
    v.z += accelspeed * wishdir.z;
  }

  airAccelerate(wishdir: Vec3, wishspeed: number, accel: number) {
    const v = this.s.velocity;
    let wishspd = wishspeed;
    if (wishspd > cvars.sv_air_max_wishspeed) wishspd = cvars.sv_air_max_wishspeed;
    const currentspeed = vdot(v, wishdir);
    const addspeed = wishspd - currentspeed;
    if (addspeed <= 0) return;
    let accelspeed = accel * wishspeed * this.ctx.dt;
    if (accelspeed > addspeed) accelspeed = addspeed;
    v.x += accelspeed * wishdir.x;
    v.y += accelspeed * wishdir.y;
    v.z += accelspeed * wishdir.z;
  }

  private wish(): { wishdir: Vec3; wishspeed: number } {
    const { forward, right } = this.wishVectors();
    const wx = forward.x * this.fmove + right.x * this.smove;
    const wy = forward.y * this.fmove + right.y * this.smove;
    let wishspeed = Math.hypot(wx, wy);
    const wishdir = wishspeed > 0 ? { x: wx / wishspeed, y: wy / wishspeed, z: 0 } : { x: 0, y: 0, z: 0 };
    if (wishspeed > this.maxspeed) wishspeed = this.maxspeed;
    return { wishdir, wishspeed };
  }

  walkMove() {
    const s = this.s;
    const { wishdir, wishspeed } = this.wish();
    s.velocity.z = 0;
    this.accelerate(wishdir, wishspeed, cvars.sv_accelerate);
    s.velocity.z = 0;

    // stamina yavaşlaması (zıplama/iniş sonrası)
    if (s.stamina > 0) {
      let ratio = (cvars.sv_staminamax - s.stamina) / cvars.sv_staminamax;
      ratio = Math.pow(ratio, this.ctx.dt / (1 / 70));
      s.velocity.x *= ratio;
      s.velocity.y *= ratio;
    }

    const spd = Math.hypot(s.velocity.x, s.velocity.y);
    if (spd < 1) {
      s.velocity.x = 0;
      s.velocity.y = 0;
      return;
    }

    const dest = {
      x: s.origin.x + s.velocity.x * this.ctx.dt,
      y: s.origin.y + s.velocity.y * this.ctx.dt,
      z: s.origin.z,
    };
    const tr = this.trace(s.origin, dest);
    if (tr.fraction === 1) {
      s.origin = tr.endpos;
      this.stayOnGround();
      return;
    }
    this.stepMove();
    this.stayOnGround();
  }

  airMove() {
    const { wishdir, wishspeed } = this.wish();
    this.airAccelerate(wishdir, wishspeed, cvars.sv_airaccelerate);
    this.tryPlayerMove();
  }

  stayOnGround() {
    const s = this.s;
    const start = { x: s.origin.x, y: s.origin.y, z: s.origin.z + 2 };
    const end = { x: s.origin.x, y: s.origin.y, z: s.origin.z - cvars.sv_stepsize };
    let tr = this.trace(s.origin, start);
    const st = tr.endpos;
    tr = this.trace(st, end);
    if (tr.fraction > 0 && tr.fraction < 1 && !tr.startsolid && tr.normal.z >= MIN_WALK_NORMAL) {
      const dz = tr.endpos.z - s.origin.z;
      if (Math.abs(dz) > 0.5 * DIST_EPSILON) s.origin = tr.endpos;
    }
  }

  stepMove() {
    const s = this.s;
    const pos = { ...s.origin };
    const vel = { ...s.velocity };

    // aşağıdan kaydır
    this.tryPlayerMove();
    const downPos = { ...s.origin };
    const downVel = { ...s.velocity };

    // basamak kadar yukarı
    s.origin = { ...pos };
    s.velocity = { ...vel };
    let tr = this.trace(s.origin, { x: s.origin.x, y: s.origin.y, z: s.origin.z + cvars.sv_stepsize + DIST_EPSILON });
    if (!tr.startsolid && !tr.allsolid) s.origin = tr.endpos;
    this.tryPlayerMove();

    // aşağı in
    tr = this.trace(s.origin, { x: s.origin.x, y: s.origin.y, z: s.origin.z - cvars.sv_stepsize - DIST_EPSILON });
    if (!tr.startsolid && !tr.allsolid) s.origin = tr.endpos;

    // dik yüzeye çıktıysa aşağı sonucu kullan
    if (tr.fraction !== 1 && tr.normal.z < MIN_WALK_NORMAL) {
      s.origin = downPos;
      s.velocity = downVel;
      return;
    }
    // basamakta zemin yoksa (fraction 1) da aşağı sonucu tercih et
    if (tr.fraction === 1) {
      s.origin = downPos;
      s.velocity = downVel;
      return;
    }

    const downDist = (downPos.x - pos.x) ** 2 + (downPos.y - pos.y) ** 2;
    const upDist = (s.origin.x - pos.x) ** 2 + (s.origin.y - pos.y) ** 2;
    if (downDist > upDist) {
      s.origin = downPos;
      s.velocity = downVel;
    } else {
      s.velocity.z = downVel.z;
    }
  }

  tryPlayerMove(): number {
    const s = this.s;
    const numbumps = 4;
    let blocked = 0;
    let numplanes = 0;
    const planes: Vec3[] = [];
    let originalVelocity = { ...s.velocity };
    const primalVelocity = { ...s.velocity };
    let allFraction = 0;
    let timeLeft = this.ctx.dt;
    let newVelocity = { x: 0, y: 0, z: 0 };

    for (let bump = 0; bump < numbumps; bump++) {
      const v = s.velocity;
      if (v.x === 0 && v.y === 0 && v.z === 0) break;
      const end = { x: s.origin.x + v.x * timeLeft, y: s.origin.y + v.y * timeLeft, z: s.origin.z + v.z * timeLeft };
      const tr = this.trace(s.origin, end);
      allFraction += tr.fraction;

      if (tr.allsolid) {
        s.velocity = { x: 0, y: 0, z: 0 };
        // takıldık — yukarı doğru küçük kaçış dene
        this.unstick();
        return 4;
      }
      if (tr.fraction > 0) {
        s.origin = tr.endpos;
        originalVelocity = { ...s.velocity };
        numplanes = 0;
        planes.length = 0;
      }
      if (tr.fraction === 1) break;

      if (tr.normal.z > MIN_WALK_NORMAL) blocked |= 1;
      if (tr.normal.z === 0) blocked |= 2;
      if (tr.entity < 0 && tr.brush) this.s.groundMat = tr.mat;

      timeLeft -= timeLeft * tr.fraction;

      if (numplanes >= MAX_CLIP_PLANES) {
        s.velocity = { x: 0, y: 0, z: 0 };
        break;
      }
      planes.push({ ...tr.normal });
      numplanes++;

      if (numplanes === 1 && !s.onGround) {
        for (let i = 0; i < numplanes; i++) {
          const p = planes[i]!;
          if (p.z > MIN_WALK_NORMAL) {
            newVelocity = clipVelocity(originalVelocity, p, 1);
            originalVelocity = newVelocity;
          } else {
            newVelocity = clipVelocity(originalVelocity, p, 1 + cvars.sv_bounce);
          }
        }
        s.velocity = newVelocity;
        originalVelocity = { ...newVelocity };
      } else {
        let i = 0;
        for (; i < numplanes; i++) {
          s.velocity = clipVelocity(originalVelocity, planes[i]!, 1);
          let j = 0;
          for (; j < numplanes; j++) {
            if (j !== i && vdot(s.velocity, planes[j]!) < 0) break;
          }
          if (j === numplanes) break;
        }
        if (i === numplanes) {
          if (numplanes !== 2) {
            s.velocity = { x: 0, y: 0, z: 0 };
            break;
          }
          const dir = vcross(planes[0]!, planes[1]!);
          const l = Math.hypot(dir.x, dir.y, dir.z);
          if (l > 0) {
            dir.x /= l;
            dir.y /= l;
            dir.z /= l;
          }
          const d = vdot(dir, s.velocity);
          s.velocity = { x: dir.x * d, y: dir.y * d, z: dir.z * d };
        }
        if (vdot(s.velocity, primalVelocity) <= 0) {
          s.velocity = { x: 0, y: 0, z: 0 };
          break;
        }
      }
    }
    if (allFraction === 0) s.velocity = { x: 0, y: 0, z: 0 };
    return blocked;
  }

  /** Hull bir şeyin içinde kaldıysa en yakın boş yeri ara (ör. oyuncu üstüne doğma). */
  unstick() {
    const s = this.s;
    const maxs = hullMaxs(s);
    for (let dz = 1; dz <= 36; dz += 1) {
      for (const [dx, dy] of [
        [0, 0],
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const p = { x: s.origin.x + dx * dz, y: s.origin.y + dy * dz, z: s.origin.z + (dx === 0 && dy === 0 ? dz : 0) };
        const tr = this.trace(p, p, maxs);
        if (!tr.startsolid) {
          s.origin = p;
          return;
        }
      }
    }
  }

  categorizePosition() {
    const s = this.s;
    const zvel = s.velocity.z;
    if (zvel > NON_JUMP_VELOCITY) {
      s.onGround = false;
      return;
    }
    const point = { x: s.origin.x, y: s.origin.y, z: s.origin.z - 2 };
    const tr = this.trace(s.origin, point);
    if (tr.fraction === 1 || tr.normal.z < MIN_WALK_NORMAL) {
      s.onGround = false;
    } else {
      s.onGround = true;
      if (tr.entity < 0) s.groundMat = tr.mat;
      if (!tr.startsolid && tr.fraction > 0 && tr.fraction < 1) s.origin = tr.endpos;
    }
  }

  duck() {
    const s = this.s;
    const dt = this.ctx.dt;
    const wantDuck = (this.cmd.buttons & IN_DUCK) !== 0;
    const pressed = wantDuck && !(s.oldButtons & IN_DUCK);
    if (pressed) s.duckSpeed = Math.max(1.5, s.duckSpeed - 2);

    if (wantDuck) {
      s.duckAmount = Math.min(1, s.duckAmount + dt * s.duckSpeed);
      if (!s.ducked) {
        if (!s.onGround) {
          // havada çömelme: ayaklar yukarı çekilir
          const up = { x: s.origin.x, y: s.origin.y, z: s.origin.z + DUCK_JUMP_LIFT };
          const tr = this.trace(s.origin, up, DUCK_HULL_MAXS);
          s.origin = tr.endpos;
          s.ducked = true;
          s.duckAmount = Math.max(s.duckAmount, 0.5);
        } else if (s.duckAmount >= 1) {
          s.ducked = true;
        }
      }
    } else if (s.duckAmount > 0 || s.ducked) {
      if (s.ducked) {
        if (this.canUnduck()) {
          s.ducked = false;
        } else {
          // tavan alçak: çömelik kal
          s.duckAmount = 1;
          return;
        }
      }
      s.duckAmount = Math.max(0, s.duckAmount - dt * s.duckSpeed);
    }
  }

  private canUnduck(): boolean {
    const s = this.s;
    if (!s.onGround) {
      // havada kalkarken ayaklar tekrar aşağı iner
      const down = { x: s.origin.x, y: s.origin.y, z: s.origin.z - DUCK_JUMP_LIFT };
      const trd = this.trace(s.origin, down, DUCK_HULL_MAXS);
      const newOrigin = trd.endpos;
      const tr = this.trace(newOrigin, newOrigin, HULL_MAXS);
      if (tr.startsolid) return false;
      s.origin = newOrigin;
      return true;
    }
    const tr = this.trace(s.origin, s.origin, HULL_MAXS);
    return !tr.startsolid;
  }

  noclipMove() {
    const s = this.s;
    const { forward, side } = cmdMove(this.cmd.buttons);
    const p = this.cmd.pitch * DEG2RAD;
    const y = this.cmd.yaw * DEG2RAD;
    const fwd = { x: Math.cos(p) * Math.cos(y), y: Math.cos(p) * Math.sin(y), z: -Math.sin(p) };
    const right = { x: Math.sin(y), y: -Math.cos(y), z: 0 };
    const speed = this.cmd.buttons & IN_SPEED ? 300 : 900;
    const k = speed / 450;
    s.velocity = {
      x: (fwd.x * forward + right.x * side) * k,
      y: (fwd.y * forward + right.y * side) * k,
      z: fwd.z * forward * k + (this.cmd.buttons & IN_JUMP ? speed : 0) - (this.cmd.buttons & IN_DUCK ? speed : 0),
    };
    s.origin.x += s.velocity.x * this.ctx.dt;
    s.origin.y += s.velocity.y * this.ctx.dt;
    s.origin.z += s.velocity.z * this.ctx.dt;
    s.onGround = false;
  }
}

export function clipVelocity(v: Vec3, n: Vec3, overbounce: number): Vec3 {
  const backoff = vdot(v, n) * overbounce;
  const out = { x: v.x - n.x * backoff, y: v.y - n.y * backoff, z: v.z - n.z * backoff };
  const adjust = vdot(out, n);
  if (adjust < 0) {
    out.x -= n.x * adjust;
    out.y -= n.y * adjust;
    out.z -= n.z * adjust;
  }
  return out;
}

/** Oyuncunun dünyadaki çarpışma kutusu (mutlak). */
export function playerBox(id: number, s: MoveState): EntityBox {
  const h = s.ducked ? PLAYER_DUCK_HEIGHT : PLAYER_HEIGHT;
  return {
    id,
    mins: { x: s.origin.x - 16, y: s.origin.y - 16, z: s.origin.z },
    maxs: { x: s.origin.x + 16, y: s.origin.y + 16, z: s.origin.z + h },
  };
}

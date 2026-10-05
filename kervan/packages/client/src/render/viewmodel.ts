/**
 * Birinci şahıs silah görünümü (viewmodel): ayrı sahne/kamera, IK ile tutan kollar,
 * prosedürel animasyonlar (çekme, ateş, şarjör, inceleme, bıçak, bomba, sallanma).
 */
import * as THREE from 'three';
import { Team, WeaponDef, weaponByNum, PlayerSim, activeDef, activeItem, ITEM_C4 } from '@kervan/shared';
import { weaponModel, setSilencerVisible } from './weaponmodels';
import { settings } from '../settings';

const UP = new THREE.Vector3(0, 1, 0);

function ease(t: number) {
  t = Math.max(0, Math.min(1, t));
  return t * t * (3 - 2 * t);
}
function bump(t: number, a: number, b: number) {
  // a..b arasında 0→1→0
  if (t <= a || t >= b) return 0;
  const x = (t - a) / (b - a);
  return Math.sin(x * Math.PI);
}

let flashTex: THREE.Texture | null = null;
export function muzzleFlashTexture(): THREE.Texture {
  if (flashTex) return flashTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,230,1)');
  grd.addColorStop(0.18, 'rgba(255,220,140,0.95)');
  grd.addColorStop(0.45, 'rgba(255,150,40,0.45)');
  grd.addColorStop(1, 'rgba(255,100,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + Math.random() * 0.3;
    g.save();
    g.translate(64, 64);
    g.rotate(a);
    const sg = g.createLinearGradient(0, 0, 60, 0);
    sg.addColorStop(0, 'rgba(255,240,200,0.9)');
    sg.addColorStop(1, 'rgba(255,140,40,0)');
    g.fillStyle = sg;
    g.beginPath();
    g.moveTo(0, -5);
    g.lineTo(62, 0);
    g.lineTo(0, 5);
    g.fill();
    g.restore();
  }
  flashTex = new THREE.CanvasTexture(c);
  flashTex.colorSpace = THREE.SRGBColorSpace;
  return flashTex;
}

interface Shell {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  life: number;
}

const shellGeo = new THREE.CylinderGeometry(0.22, 0.22, 1.1, 8);
const shellMat = new THREE.MeshStandardMaterial({ color: 0xc9a14a, metalness: 0.95, roughness: 0.3 });

export class Viewmodel {
  readonly group = new THREE.Group();
  private sway = new THREE.Group();
  private pivot = new THREE.Group();
  private model: THREE.Group | null = null;
  private key = '';
  private def: WeaponDef | null = null;
  private arms: THREE.Mesh[] = [];
  private hands: THREE.Mesh[] = [];
  private flash: THREE.Sprite;
  private flashLight: THREE.PointLight;
  private flashTime = 0;
  private shells: Shell[] = [];
  private team: Team = Team.T;
  // animasyon durumları
  private deployT = 1;
  private deployDur = 0.5;
  private kick = 0;
  private kickRot = 0;
  private kickRoll = 0;
  private bobPhase = 0;
  private swayX = 0;
  private swayY = 0;
  private lastYaw = 0;
  private lastPitch = 0;
  private landDip = 0;
  private slashT = 1;
  private slashSide = 1;
  private slashHeavy = false;
  private throwT = 1;
  private shellDelay = -1;
  private magBase: THREE.Vector3 | null = null;
  private slideBase: THREE.Vector3 | null = null;
  private boltBase: THREE.Vector3 | null = null;
  private time = 0;
  hidden = false;

  constructor(scene: THREE.Scene) {
    scene.add(this.group);
    this.group.add(this.sway);
    this.sway.add(this.pivot);
    this.flash = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: muzzleFlashTexture(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false }),
    );
    this.flash.visible = false;
    this.flash.renderOrder = 10;
    this.group.add(this.flash);
    this.flashLight = new THREE.PointLight(0xffb060, 0, 60, 2);
    this.group.add(this.flashLight);
    this.buildArms(Team.T);
  }

  private buildArms(team: Team) {
    for (const m of [...this.arms, ...this.hands]) m.removeFromParent();
    this.arms = [];
    this.hands = [];
    this.team = team;
    const sleeve = new THREE.MeshStandardMaterial({ color: team === Team.CT ? 0x2f3b4b : 0x8f7651, roughness: 0.85 });
    const glove = new THREE.MeshStandardMaterial({ color: team === Team.CT ? 0x1b1c1f : 0x2f2a24, roughness: 0.7 });
    const cuff = new THREE.MeshStandardMaterial({ color: team === Team.CT ? 0x222a33 : 0x5f4f36, roughness: 0.9 });
    for (let side = 0; side < 2; side++) {
      const upper = new THREE.Mesh(new THREE.CapsuleGeometry(2.0, 17, 4, 12), sleeve);
      const lower = new THREE.Mesh(new THREE.CapsuleGeometry(1.55, 13.5, 4, 12), sleeve);
      const hand = new THREE.Mesh(new THREE.SphereGeometry(1.35, 14, 10), glove);
      hand.scale.set(1, 0.8, 1.35);
      const wrist = new THREE.Mesh(new THREE.CylinderGeometry(1.65, 1.65, 1.3, 12), cuff);
      this.group.add(upper, lower, hand, wrist);
      this.arms.push(upper, lower, wrist);
      this.hands.push(hand);
    }
  }

  setTeam(team: Team) {
    if (team !== this.team) this.buildArms(team);
  }

  private setWeapon(def: WeaponDef) {
    if (this.key === def.key) return;
    if (this.model) this.pivot.remove(this.model);
    this.key = def.key;
    this.def = def;
    this.model = weaponModel(def.key);
    this.pivot.add(this.model);
    this.model.traverse((o) => {
      o.castShadow = false;
      o.receiveShadow = false;
    });
    this.magBase = this.model.getObjectByName('mag')?.position.clone() ?? null;
    this.slideBase = this.model.getObjectByName('slide')?.position.clone() ?? null;
    this.boltBase = this.model.getObjectByName('bolt')?.position.clone() ?? null;
    this.deployT = 0;
    this.deployDur = Math.min(0.6, def.deployTime * 0.55);
  }

  onFire(def: WeaponDef) {
    const heavy = def.category === 'sniper' ? 2.4 : def.category === 'heavy' ? 1.8 : def.category === 'pistol' ? (def.key === 'deagle' ? 2 : 1.1) : 0.9;
    this.kick = Math.min(3.5, this.kick + 0.75 * heavy);
    this.kickRot = Math.min(0.35, this.kickRot + 0.045 * heavy);
    this.kickRoll = (Math.random() - 0.5) * 0.04 * heavy;
    const silenced = def.silencer === 'integrated' || (def.silencer === 'detachable' && this.model?.getObjectByName('mag') !== undefined && this.silenced);
    this.flashTime = silenced ? 0.0 : 0.045;
    this.flash.material.rotation = Math.random() * Math.PI * 2;
    const s = (def.category === 'sniper' ? 9 : def.category === 'pistol' ? 5 : 7) * (0.8 + Math.random() * 0.4);
    this.flash.scale.set(s, s, s);
    this.shellDelay = def.category === 'sniper' && (def.key === 'awp' || def.key === 'ssg08') ? 0.55 : def.category === 'heavy' && def.shellReload ? 0.35 : 0;
  }

  silenced = false;

  onMelee(heavy: boolean) {
    this.slashT = 0;
    this.slashHeavy = heavy;
    this.slashSide = -this.slashSide;
  }

  onThrow() {
    this.throwT = 0;
  }

  onLand(speed: number) {
    this.landDip = Math.min(2.2, this.landDip + speed / 260);
  }

  redeploy() {
    this.deployT = 0;
  }

  private spawnShell() {
    if (!this.model || !this.def) return;
    const ej = this.model.getObjectByName('eject');
    if (!ej) return;
    const p = new THREE.Vector3();
    ej.getWorldPosition(p);
    const mesh = new THREE.Mesh(shellGeo, shellMat);
    mesh.position.copy(p);
    mesh.rotation.set(Math.random() * 3, Math.random() * 3, 0);
    this.group.add(mesh);
    this.shells.push({
      mesh,
      vel: new THREE.Vector3(9 + Math.random() * 6, 8 + Math.random() * 5, 2 + Math.random() * 3),
      spin: new THREE.Vector3(Math.random() * 20, Math.random() * 20, Math.random() * 20),
      life: 0.7,
    });
  }

  update(dt: number, p: PlayerSim | null, yaw: number, pitch: number, simTime: number) {
    this.time += dt;
    if (!p || !p.alive) {
      this.group.visible = false;
      return;
    }
    const def = activeDef(p);
    this.setWeapon(def);
    const item = activeItem(p);
    this.silenced = !!item?.silencer;
    if (this.model) setSilencerVisible(this.model, !!item?.silencer, def.key);
    const w = p.wpn;
    const scoped = def.zoomLevels > 0 && w.zoom > 0 && (def.category === 'sniper' || def.key === 'aug' || def.key === 'sg556');
    this.group.visible = !this.hidden && !(scoped && def.category === 'sniper');

    // temel konum
    const cat = def.category;
    const base = new THREE.Vector3();
    const rot = new THREE.Euler();
    if (cat === 'pistol') {
      base.set(4.6, -5.2, -13.5);
      rot.set(0.02, 0.05, 0);
    } else if (cat === 'knife') {
      base.set(5.4, -6.0, -11.5);
      rot.set(0.18, 0.28, -0.25);
    } else if (cat === 'grenade') base.set(5.2, -6.2, -11.5);
    else if (cat === 'c4') {
      base.set(3.4, -7.0, -12.5);
      rot.set(0.9, 0.2, 0);
    } else {
      base.set(6.4, -6.9, -14.5);
      rot.set(0, 0.035, 0);
    }
    base.x += (settings.viewmodelX - 2.5) * 0.6;
    base.z -= settings.viewmodelY * 0.6;
    base.y += (settings.viewmodelZ + 1.5) * 0.6;

    // çekme
    this.deployT = Math.min(1, this.deployT + dt / Math.max(0.15, this.deployDur));
    const dep = 1 - ease(this.deployT);
    base.y -= dep * 9;
    rot.x -= dep * 0.9;

    // yürüme sallanması
    const vel = p.move.velocity;
    const speed = Math.hypot(vel.x, vel.y);
    const k = settings.viewmodelBob && p.move.onGround ? Math.min(1, speed / 250) : 0;
    this.bobPhase += dt * (4 + 7 * Math.min(1, speed / 250));
    base.x += Math.sin(this.bobPhase) * 0.28 * k;
    base.y -= Math.abs(Math.cos(this.bobPhase)) * 0.35 * k;
    rot.z += Math.sin(this.bobPhase) * 0.012 * k;
    // nefes
    base.y += Math.sin(this.time * 1.6) * 0.05;
    // havada
    if (!p.move.onGround) {
      base.y += 0.4;
      rot.x += 0.03;
    }
    // çömelme
    base.y -= p.move.duckAmount * 0.35;
    // iniş
    base.y -= this.landDip;
    this.landDip = Math.max(0, this.landDip - dt * 6 * Math.max(0.3, this.landDip));

    // fare gecikmesi
    let dy = yaw - this.lastYaw;
    if (dy > 180) dy -= 360;
    if (dy < -180) dy += 360;
    const dp = pitch - this.lastPitch;
    this.lastYaw = yaw;
    this.lastPitch = pitch;
    this.swayX = Math.max(-1.5, Math.min(1.5, this.swayX + dy * 0.03));
    this.swayY = Math.max(-1.5, Math.min(1.5, this.swayY - dp * 0.03));
    const kSway = Math.exp(-dt * 9);
    this.swayX *= kSway;
    this.swayY *= kSway;
    this.sway.position.set(-this.swayX * 0.4, this.swayY * 0.3, 0);
    this.sway.rotation.set(this.swayY * 0.03, this.swayX * 0.04, this.swayX * 0.02);

    // ateş geri tepmesi
    base.z += this.kick;
    rot.x += this.kickRot;
    rot.z += this.kickRoll;
    const kk = Math.exp(-dt * 16);
    this.kick *= kk;
    this.kickRot *= Math.exp(-dt * 13);
    this.kickRoll *= kk;

    // şarjör değiştirme
    const mag = this.model?.getObjectByName('mag');
    const slide = this.model?.getObjectByName('slide');
    const bolt = this.model?.getObjectByName('bolt');
    if (mag && this.magBase) mag.position.copy(this.magBase);
    if (slide && this.slideBase) slide.position.copy(this.slideBase);
    if (bolt && this.boltBase) bolt.position.copy(this.boltBase);
    if (w.reloadEnd > 0 && !def.shellReload) {
      const tot = def.reloadTime;
      const t = 1 - Math.max(0, w.reloadEnd - simTime) / tot;
      const tilt = bump(t, 0, 1);
      rot.z += tilt * 0.55;
      rot.x += tilt * 0.22;
      base.y -= tilt * 1.2;
      if (mag && this.magBase) {
        const out = t > 0.2 && t < 0.62 ? Math.min(1, (t - 0.2) / 0.1) * (1 - Math.max(0, (t - 0.5) / 0.12)) : 0;
        mag.position.y = this.magBase.y - out * 9;
        mag.visible = !(t > 0.3 && t < 0.45);
      }
      if (t > 0.72 && t < 0.92) {
        const b = bump(t, 0.72, 0.92);
        if (bolt && this.boltBase) bolt.position.z = this.boltBase.z + b * 2.5;
        if (slide && this.slideBase && cat === 'pistol') slide.position.z = this.slideBase.z + b * 2.2;
        if (cat !== 'pistol') rot.y += b * 0.08;
      }
    } else if (mag) mag.visible = true;
    if (w.shellReloading) {
      const ph = (simTime * 2.2) % 1;
      rot.z += 0.35;
      base.y -= 0.8;
      rot.x += Math.sin(ph * Math.PI * 2) * 0.05;
    }
    // pompalı/bolt sonrası
    if (def.category === 'heavy' && def.shellReload && slide && this.slideBase) {
      const since = simTime - w.lastShotTime;
      if (since > 0.2 && since < 0.6) slide.position.z = this.slideBase.z + bump(since, 0.2, 0.6) * 3.5;
    }
    if (bolt && this.boltBase && (def.key === 'awp' || def.key === 'ssg08')) {
      const since = simTime - w.lastShotTime;
      if (since > 0.35 && since < 1.1) {
        const b = bump(since, 0.35, 1.1);
        bolt.position.z = this.boltBase.z + b * 3;
        bolt.rotation.z = -b * 0.9;
        rot.z += b * 0.15;
      }
    }
    // susturucu takma
    if (w.silencerEnd > 0) {
      const t = 1 - Math.max(0, w.silencerEnd - simTime) / 3;
      const b = bump(t, 0, 1);
      rot.y += b * 0.5;
      rot.z += b * 0.3;
      base.x -= b * 2;
    }
    // inceleme
    if (w.inspectEnd > simTime) {
      const t = 1 - (w.inspectEnd - simTime) / 3.5;
      const a = bump(t, 0, 0.5);
      const b2 = bump(t, 0.4, 1);
      rot.y += a * 0.9 - b2 * 0.5;
      rot.z += a * 0.6 + b2 * 0.8;
      rot.x += b2 * 0.4;
      base.x -= a * 2;
      base.y += a * 1 + b2 * 0.8;
    }
    // bıçak
    if (this.slashT < 1) {
      this.slashT = Math.min(1, this.slashT + dt / (this.slashHeavy ? 0.55 : 0.38));
      const b = bump(this.slashT, 0, 1);
      if (this.slashHeavy) {
        base.z -= b * 6;
        base.x -= b * 2;
        rot.x -= b * 0.5;
      } else {
        rot.y += b * 0.9 * this.slashSide;
        rot.z -= b * 0.6 * this.slashSide;
        base.x -= b * 3 * this.slashSide;
      }
    }
    // bomba
    if (cat === 'grenade') {
      if (w.pinPulled) {
        base.y += 0.9;
        base.z += 1.5;
        rot.x += 0.35;
      }
    }
    if (this.throwT < 1) {
      this.throwT = Math.min(1, this.throwT + dt / 0.35);
      base.z -= bump(this.throwT, 0, 0.6) * 8;
      base.y += bump(this.throwT, 0, 0.6) * 3;
      rot.x -= bump(this.throwT, 0, 0.6) * 0.8;
      if (this.throwT > 0.5) base.y -= 12 * (1 - Math.max(0, (this.throwT - 0.8) / 0.2));
    }
    // C4 kurma
    if (p.active === ITEM_C4 && w.plantProgress > 0) {
      base.y -= 1.5;
      base.z += 2;
      rot.x += 0.25 + Math.sin(this.time * 30) * 0.01;
    }

    this.pivot.position.copy(base);
    this.pivot.rotation.copy(rot);
    this.group.updateMatrixWorld(true);

    // kovanlar
    if (this.shellDelay >= 0) {
      this.shellDelay -= dt;
      if (this.shellDelay < 0) {
        this.spawnShell();
        this.shellDelay = -1;
      }
    }
    for (let i = this.shells.length - 1; i >= 0; i--) {
      const s = this.shells[i]!;
      s.life -= dt;
      s.vel.y -= 60 * dt;
      s.mesh.position.addScaledVector(s.vel, dt);
      s.mesh.rotation.x += s.spin.x * dt;
      s.mesh.rotation.y += s.spin.y * dt;
      if (s.life <= 0) {
        s.mesh.removeFromParent();
        this.shells.splice(i, 1);
      }
    }

    // namlu alevi
    const mz = this.model?.getObjectByName('muzzle');
    if (mz) mz.getWorldPosition(this.flash.position);
    this.flash.visible = this.flashTime > 0;
    this.flashLight.position.copy(this.flash.position);
    this.flashLight.intensity = this.flashTime > 0 ? 400 : 0;
    this.flashTime -= dt;

    this.updateArms(cat);
  }

  private updateArms(cat: string) {
    if (!this.model) return;
    const gripR = new THREE.Vector3(0, -1.4, 0.7).applyMatrix4(this.model.matrixWorld);
    const lhObj = this.model.getObjectByName('lefthand');
    const gripL = new THREE.Vector3();
    if (lhObj) lhObj.getWorldPosition(gripL);
    else gripL.copy(gripR).add(new THREE.Vector3(-3, 0, -3));
    const shoulders =
      cat === 'pistol'
        ? [new THREE.Vector3(9, -18, 7), new THREE.Vector3(-3, -19, 7)]
        : [new THREE.Vector3(12, -17, 9), new THREE.Vector3(-4, -21, 6)];
    const targets = [gripR, gripL];
    const poles = [new THREE.Vector3(1, -0.6, 0.4), new THREE.Vector3(-1, -0.7, 0.4)];
    const showLeft = cat !== 'knife' && cat !== 'grenade' && cat !== 'c4';
    for (let side = 0; side < 2; side++) {
      const upper = this.arms[side * 3]!;
      const lower = this.arms[side * 3 + 1]!;
      const wrist = this.arms[side * 3 + 2]!;
      const hand = this.hands[side]!;
      const vis = side === 0 || showLeft;
      upper.visible = lower.visible = wrist.visible = hand.visible = vis;
      if (!vis) continue;
      const a = shoulders[side]!;
      const t = targets[side]!.clone();
      const e = ik(a, t, 17, 13.5, poles[side]!);
      place(upper, a, e);
      // önkol bileğe kadar, el hedefte
      const dir = new THREE.Vector3().subVectors(t, e).normalize();
      const wristPos = t.clone().addScaledVector(dir, -1.8);
      place(lower, e, wristPos);
      wrist.position.copy(wristPos);
      wrist.quaternion.setFromUnitVectors(UP, dir);
      hand.position.copy(t);
      hand.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), dir);
    }
  }
}

function ik(a: THREE.Vector3, t: THREE.Vector3, l1: number, l2: number, pole: THREE.Vector3): THREE.Vector3 {
  const d = new THREE.Vector3().subVectors(t, a);
  let dist = d.length();
  const maxd = (l1 + l2) * 0.995;
  if (dist > maxd) dist = maxd;
  dist = Math.max(dist, Math.abs(l1 - l2) + 0.1);
  const dir = d.normalize();
  const cosA = Math.max(-1, Math.min(1, (l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist)));
  const sinA = Math.sqrt(1 - cosA * cosA);
  const perp = pole.clone().sub(dir.clone().multiplyScalar(pole.dot(dir))).normalize();
  return a.clone().addScaledVector(dir, l1 * cosA).addScaledVector(perp, l1 * sinA);
}

function place(m: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3) {
  const d = new THREE.Vector3().subVectors(b, a);
  const len = d.length();
  m.position.addVectors(a, b).multiplyScalar(0.5);
  if (len > 1e-4) m.quaternion.setFromUnitVectors(UP, d.multiplyScalar(1 / len));
}

export function weaponDefOf(num: number) {
  return weaponByNum(num);
}

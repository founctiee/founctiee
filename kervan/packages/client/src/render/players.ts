/**
 * Üçüncü şahıs oyuncu modelleri: parçalı (rigid) iskelet, 2 kemikli IK ile bacaklar ve
 * kollar. Pozlar paylaşılan hitbox düzeniyle uyumludur.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { Team, weaponByNum, DEG2RAD } from '@kervan/shared';
import { weaponModel } from './weaponmodels';

const capsuleGeo = new Map<string, THREE.CapsuleGeometry>();
/** Kapsül: silindir kısmı `len` uzunluğunda (eklemden ekleme). */
function capsule(r: number, len: number): THREE.CapsuleGeometry {
  const k = `${r.toFixed(2)}_${len.toFixed(2)}`;
  let g = capsuleGeo.get(k);
  if (!g) capsuleGeo.set(k, (g = new THREE.CapsuleGeometry(r, len, 4, 10)));
  return g;
}

interface Palette {
  shirt: number;
  pants: number;
  vest: number;
  head: number;
  skin: number;
  boots: number;
  gloves: number;
  accent: number;
}

const PALETTES: Record<number, Palette> = {
  [Team.T]: { shirt: 0x9c8257, pants: 0x5b573a, vest: 0x6e5d3b, head: 0x2b2824, skin: 0xa7795a, boots: 0x3a2e22, gloves: 0x2a2622, accent: 0x8a3b2a },
  [Team.CT]: { shirt: 0x34404f, pants: 0x3a4250, vest: 0x2b3a4d, head: 0x252d36, skin: 0xc49577, boots: 0x1d1f22, gloves: 0x1c1d20, accent: 0x5a8ab0 },
};

const matCache = new Map<number, THREE.MeshStandardMaterial>();
function mat(color: number, rough = 0.85, metal = 0): THREE.MeshStandardMaterial {
  const key = color * 10 + Math.round(rough * 9);
  let m = matCache.get(key);
  if (!m) matCache.set(key, (m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal })));
  return m;
}

/** İki kemikli IK: kök a, hedef t, uzunluklar, kutup yönü → dirsek/diz. */
function solveIK(a: THREE.Vector3, t: THREE.Vector3, l1: number, l2: number, pole: THREE.Vector3, out: THREE.Vector3) {
  const d = new THREE.Vector3().subVectors(t, a);
  let dist = d.length();
  const maxd = (l1 + l2) * 0.999;
  if (dist > maxd) {
    d.multiplyScalar(maxd / dist);
    t.copy(a).add(d);
    dist = maxd;
  }
  dist = Math.max(dist, Math.abs(l1 - l2) + 0.01);
  const dir = d.clone().normalize();
  const cosA = (l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist);
  const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  const perp = pole.clone().sub(dir.clone().multiplyScalar(pole.dot(dir)));
  if (perp.lengthSq() < 1e-6) perp.set(0, 0, 1);
  perp.normalize();
  out.copy(a).addScaledVector(dir, l1 * cosA).addScaledVector(perp, l1 * sinA);
}

export interface PlayerPose {
  /** Sim koordinatları (ayak). */
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  duck: number;
  vx: number;
  vy: number;
  onGround: boolean;
  weapon: number;
  alive: boolean;
  defusing: boolean;
  planting: boolean;
  reloading: boolean;
}

const UP = new THREE.Vector3(0, 1, 0);
/** Kapsülü a-b arasına yerleştir (uzunluk geometride sabit). */
function placeCapsule(m: THREE.Mesh, _r: number, a: THREE.Vector3, b: THREE.Vector3) {
  const d = new THREE.Vector3().subVectors(b, a);
  const len = d.length();
  m.position.addVectors(a, b).multiplyScalar(0.5);
  if (len > 1e-4) m.quaternion.setFromUnitVectors(UP, d.multiplyScalar(1 / len));
}

const LIMB_LEN = [11, 10.5, 11, 10.5, 16, 15, 16, 15];

export class PlayerModel {
  readonly root = new THREE.Group();
  /** Sim-yerel uzay (x ileri, y sol, z yukarı). */
  private local = new THREE.Group();
  private torso: THREE.Mesh;
  private belly: THREE.Mesh;
  private vest: THREE.Mesh;
  private head: THREE.Group;
  private limbs: THREE.Mesh[] = [];
  private feet: THREE.Mesh[] = [];
  private hands: THREE.Mesh[] = [];
  private weaponRoot = new THREE.Group();
  private weaponMesh: THREE.Group | null = null;
  private weaponNum = -1;
  private phase = 0;
  private deathT = 0;
  private deathDir = 1;
  team: Team;
  fireKick = 0;
  /** Namlu ağzının dünya konumu (three) — efektler için. */
  muzzle = new THREE.Vector3();

  constructor(team: Team) {
    this.team = team;
    const P = PALETTES[team] ?? PALETTES[Team.T]!;
    this.root.add(this.local);
    this.local.rotation.x = -Math.PI / 2;

    this.torso = new THREE.Mesh(new RoundedBoxGeometry(9, 15, 11, 2, 2.6), mat(P.shirt));
    this.belly = new THREE.Mesh(new RoundedBoxGeometry(8, 13, 9, 2, 2.4), mat(P.shirt));
    this.vest = new THREE.Mesh(new RoundedBoxGeometry(10, 15.5, 9.5, 2, 2.0), mat(P.vest, 0.75));
    for (const m of [this.torso, this.belly, this.vest]) {
      m.castShadow = true;
      this.local.add(m);
    }
    // kafa
    this.head = new THREE.Group();
    const skull = new THREE.Mesh(new THREE.SphereGeometry(4.4, 18, 14), mat(team === Team.T ? P.head : P.skin, 0.8));
    skull.scale.set(1.02, 0.95, 1.1);
    skull.castShadow = true;
    this.head.add(skull);
    if (team === Team.CT) {
      const helmet = new THREE.Mesh(new THREE.SphereGeometry(4.8, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), mat(P.head, 0.6));
      helmet.rotation.x = Math.PI / 2;
      helmet.position.z = 0.6;
      helmet.castShadow = true;
      this.head.add(helmet);
      const goggles = new THREE.Mesh(new RoundedBoxGeometry(1.6, 6.5, 1.8, 2, 0.6), mat(0x111111, 0.2, 0.4));
      goggles.position.set(3.9, 0, 0.7);
      this.head.add(goggles);
    } else {
      // balaklava + göz bandı
      const eyes = new THREE.Mesh(new RoundedBoxGeometry(1.2, 5.6, 1.4, 2, 0.5), mat(P.skin, 0.8));
      eyes.position.set(4.0, 0, 0.8);
      this.head.add(eyes);
      const band = new THREE.Mesh(new THREE.TorusGeometry(4.5, 0.6, 6, 18), mat(P.accent, 0.9));
      band.position.z = 1.8;
      this.head.add(band);
    }
    this.local.add(this.head);

    // uzuvlar: 0-1 sağ kol, 2-3 sol kol, 4-5 sol bacak, 6-7 sağ bacak
    const radii = [2.6, 2.2, 2.6, 2.2, 3.9, 3.3, 3.9, 3.3];
    for (let i = 0; i < 8; i++) {
      const isLeg = i >= 4;
      const m = new THREE.Mesh(capsule(radii[i]!, LIMB_LEN[i]!), mat(isLeg ? P.pants : P.shirt));
      m.castShadow = true;
      this.local.add(m);
      this.limbs.push(m);
    }
    for (let i = 0; i < 2; i++) {
      const f = new THREE.Mesh(new RoundedBoxGeometry(8, 4, 3.4, 2, 1.2), mat(P.boots, 0.7));
      f.castShadow = true;
      this.local.add(f);
      this.feet.push(f);
      const h = new THREE.Mesh(new THREE.SphereGeometry(1.7, 10, 8), mat(P.gloves, 0.7));
      h.castShadow = true;
      this.local.add(h);
      this.hands.push(h);
    }
    this.local.add(this.weaponRoot);
  }

  private setWeapon(num: number) {
    if (num === this.weaponNum) return;
    this.weaponNum = num;
    if (this.weaponMesh) this.weaponRoot.remove(this.weaponMesh);
    const def = weaponByNum(num);
    this.weaponMesh = def ? weaponModel(def.key) : null;
    if (this.weaponMesh) {
      // model eksenleri (-Z namlu, +Y yukarı) → sim-yerel (+x ileri, +z yukarı)
      const m = new THREE.Matrix4().makeBasis(new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(-1, 0, 0));
      this.weaponMesh.quaternion.setFromRotationMatrix(m);
      this.weaponMesh.traverse((o) => (o.castShadow = true));
      this.weaponRoot.add(this.weaponMesh);
    }
  }

  update(p: PlayerPose, dt: number) {
    this.root.position.set(p.x, p.z, -p.y);
    this.root.rotation.y = p.yaw * DEG2RAD;
    this.setWeapon(p.alive ? p.weapon : -1);

    const def = weaponByNum(p.weapon);
    const cat = def?.category ?? 'knife';
    const speed = Math.hypot(p.vx, p.vy);
    const e = smooth(p.duck);
    // yürüme fazı
    if (p.onGround && speed > 5) this.phase += dt * (speed / 250) * 8.8;
    const stride = Math.min(1, speed / 250) * (1 - e * 0.5);

    // ölüm animasyonu
    if (!p.alive) this.deathT = Math.min(1, this.deathT + dt * 2.2);
    else {
      this.deathT = 0;
      this.deathDir = Math.random() < 0.5 ? 1 : -1;
    }
    const dT = smooth(this.deathT);

    const hipZ = 34 - 16 * e;
    const pelvis = new THREE.Vector3(0, 0, hipZ);
    const fwdYaw = (sp: THREE.Vector3) => sp; // yerel uzay zaten yaw'a göre döndü
    void fwdYaw;
    const pitchR = p.pitch * DEG2RAD;

    // gövde
    const lean = e * 0.35 + pitchR * 0.25;
    const chestC = new THREE.Vector3(Math.sin(lean) * 8 + e * 3, 0, hipZ + 14 * Math.cos(lean * 0.5) + 1);
    const bellyC = new THREE.Vector3(e * 1.5, 0, hipZ + 4.5);
    this.torso.position.copy(chestC);
    this.torso.rotation.set(0, lean, 0);
    this.vest.position.copy(chestC).add(new THREE.Vector3(0.6, 0, -0.5));
    this.vest.rotation.copy(this.torso.rotation);
    this.belly.position.copy(bellyC);
    this.belly.rotation.set(0, lean * 0.5, 0);
    const neck = new THREE.Vector3(chestC.x + 1.5, 0, chestC.z + 8.5);
    this.head.position.copy(neck).add(new THREE.Vector3(0.5, 0, 3.6));
    this.head.rotation.set(0, Math.max(-0.6, Math.min(0.7, pitchR)) * 0.8, 0);

    // silah tutuş noktası
    const shoulderR = new THREE.Vector3(chestC.x, -7.5, chestC.z + 5);
    const shoulderL = new THREE.Vector3(chestC.x, 7.5, chestC.z + 5);
    const aimDir = new THREE.Vector3(Math.cos(pitchR), 0, -Math.sin(pitchR));
    let grip: THREE.Vector3;
    if (cat === 'pistol' || cat === 'grenade' || cat === 'c4' || cat === 'knife') {
      grip = new THREE.Vector3(chestC.x + 4, -3, chestC.z + 1).addScaledVector(aimDir, 12);
    } else {
      grip = new THREE.Vector3(chestC.x + 3, -4.5, chestC.z + 2.5).addScaledVector(aimDir, 6);
    }
    if (p.reloading) grip.z -= 4;
    if (p.planting || p.defusing) grip = new THREE.Vector3(14, -2, hipZ - 8);
    grip.addScaledVector(aimDir, -this.fireKick * 2);
    this.fireKick = Math.max(0, this.fireKick - dt * 10);

    this.weaponRoot.position.copy(grip);
    this.weaponRoot.rotation.set(0, pitchR, 0);
    this.weaponRoot.updateMatrix();
    const handL = new THREE.Vector3();
    const lh = this.weaponMesh?.getObjectByName('lefthand');
    const mz = this.weaponMesh?.getObjectByName('muzzle');
    this.local.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(this.local.matrixWorld).invert();
    if (lh) lh.getWorldPosition(handL).applyMatrix4(inv);
    else handL.copy(grip).add(new THREE.Vector3(4, 4, 0));
    if (mz) mz.getWorldPosition(this.muzzle);
    else this.root.getWorldPosition(this.muzzle);
    if (cat === 'knife' || cat === 'grenade' || cat === 'c4') handL.copy(new THREE.Vector3(chestC.x + 6, 7, chestC.z - 4));

    // kollar
    const elbow = new THREE.Vector3();
    const handR = grip.clone();
    solveIK(shoulderR, handR, 11, 10.5, new THREE.Vector3(-0.3, -1, -0.8), elbow);
    placeCapsule(this.limbs[0]!, 2.6, shoulderR, elbow);
    placeCapsule(this.limbs[1]!, 2.2, elbow, handR);
    this.hands[0]!.position.copy(handR);
    const elbowL = new THREE.Vector3();
    const hl = handL.clone();
    solveIK(shoulderL, hl, 11, 10.5, new THREE.Vector3(-0.3, 1, -0.8), elbowL);
    placeCapsule(this.limbs[2]!, 2.6, shoulderL, elbowL);
    placeCapsule(this.limbs[3]!, 2.2, elbowL, hl);
    this.hands[1]!.position.copy(hl);

    // bacaklar
    for (let side = 0; side < 2; side++) {
      const s = side === 0 ? 1 : -1; // sol, sağ
      const ph = this.phase + side * Math.PI;
      const hip = new THREE.Vector3(pelvis.x, s * 4.4, pelvis.z - 1);
      let fx = Math.sin(ph) * 11 * stride;
      let fz = Math.max(0, Math.cos(ph)) * 4.5 * stride;
      if (e > 0.5) fx += 4 * e;
      if (!p.onGround) {
        fx = 4;
        fz = 10;
      }
      const foot = new THREE.Vector3(fx, s * 5, 3 + fz);
      const knee = new THREE.Vector3();
      solveIK(hip, foot, 16, 15, new THREE.Vector3(1, 0, 0.2), knee);
      const li = side === 0 ? 4 : 6;
      placeCapsule(this.limbs[li]!, 3.9, hip, knee);
      placeCapsule(this.limbs[li + 1]!, 3.3, knee, foot);
      this.feet[side]!.position.set(foot.x + 2, foot.y, foot.z - 1.5);
    }

    // ölüm: geriye/yana devril
    this.local.rotation.set(-Math.PI / 2 + dT * 0.15 * this.deathDir, -dT * 1.45, 0);
    this.local.position.set(0, -dT * 4, 0);
    this.weaponRoot.visible = p.alive || dT < 0.3;
  }

  setVisible(v: boolean) {
    this.root.visible = v;
  }

  dispose() {
    this.root.removeFromParent();
  }
}

function smooth(t: number) {
  return t * t * (3 - 2 * t);
}

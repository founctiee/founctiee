/** Dünyadaki dinamik nesneler: uçan bombalar, yerdeki silahlar, kurulu C4, molotof alevleri. */
import * as THREE from 'three';
import { GrenadeState, DroppedState, weaponByNum, GRENADE_KEYS, Inferno, DEG2RAD } from '@kervan/shared';
import { weaponModel } from './weaponmodels';

function fireTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 128;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(32, 96, 2, 32, 80, 60);
  grd.addColorStop(0, 'rgba(255,250,210,1)');
  grd.addColorStop(0.25, 'rgba(255,190,80,0.95)');
  grd.addColorStop(0.55, 'rgba(240,90,20,0.6)');
  grd.addColorStop(1, 'rgba(120,20,0,0)');
  g.fillStyle = grd;
  g.beginPath();
  g.moveTo(32, 2);
  g.quadraticCurveTo(62, 70, 52, 110);
  g.quadraticCurveTo(32, 128, 12, 110);
  g.quadraticCurveTo(2, 70, 32, 2);
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

interface FireVis {
  inf: Inferno;
  bornSec: number;
  sprites: THREE.Sprite[];
  light: THREE.PointLight;
}

export class WorldFx {
  private grenades = new Map<number, THREE.Object3D>();
  private dropped = new Map<number, THREE.Object3D>();
  private bomb: THREE.Group | null = null;
  private bombLed: THREE.Mesh | null = null;
  private fires = new Map<number, FireVis>();
  private fireTex = fireTexture();
  private fireLight: THREE.PointLight[] = [];
  private fireLightBusy = new Set<THREE.PointLight>();

  constructor(private scene: THREE.Scene) {
    for (let i = 0; i < 1; i++) {
      const l = new THREE.PointLight(0xff7a2a, 0, 500, 1.6);
      scene.add(l);
      this.fireLight.push(l);
    }
  }

  setGrenades(list: GrenadeState[], spin: number) {
    const seen = new Set<number>();
    for (const g of list) {
      seen.add(g.id);
      let o = this.grenades.get(g.id);
      if (!o) {
        o = weaponModel(GRENADE_KEYS[g.type] ?? 'hegrenade');
        this.scene.add(o);
        this.grenades.set(g.id, o);
      }
      o.position.set(g.pos.x, g.pos.z, -g.pos.y);
      o.rotation.set(spin * 7 + g.id, spin * 5, 0);
    }
    for (const [id, o] of this.grenades) {
      if (!seen.has(id)) {
        o.removeFromParent();
        this.grenades.delete(id);
      }
    }
  }

  setDropped(list: DroppedState[]) {
    const seen = new Set<number>();
    for (const d of list) {
      seen.add(d.id);
      let o = this.dropped.get(d.id);
      if (!o) {
        const def = weaponByNum(d.weapon);
        const m = weaponModel(def?.key ?? 'knife');
        const holder = new THREE.Group();
        m.rotation.set(0, 0, Math.PI / 2);
        m.position.y = 1.5;
        holder.add(m);
        this.scene.add(holder);
        this.dropped.set(d.id, holder);
        o = holder;
      }
      o.position.set(d.pos.x, d.pos.z, -d.pos.y);
      o.rotation.y = (d.yaw - 90) * DEG2RAD;
    }
    for (const [id, o] of this.dropped) {
      if (!seen.has(id)) {
        o.removeFromParent();
        this.dropped.delete(id);
      }
    }
  }

  setBomb(pos: { x: number; y: number; z: number } | null, planted: boolean, blink: boolean) {
    if (!pos || !planted) {
      if (this.bomb) {
        this.bomb.removeFromParent();
        this.bomb = null;
      }
      return;
    }
    if (!this.bomb) {
      this.bomb = new THREE.Group();
      const m = weaponModel('c4');
      m.position.y = 1.1;
      this.bomb.add(m);
      this.bombLed = new THREE.Mesh(new THREE.SphereGeometry(0.45, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff2020, toneMapped: false }));
      this.bombLed.position.set(1.6, 2.6, -2.4);
      this.bomb.add(this.bombLed);
      this.scene.add(this.bomb);
    }
    this.bomb.position.set(pos.x, pos.z, -pos.y);
    if (this.bombLed) (this.bombLed.material as THREE.MeshBasicMaterial).color.setHex(blink ? 0xff3030 : 0x300000);
  }

  addFire(inf: Inferno, bornSec: number) {
    const sprites: THREE.Sprite[] = [];
    for (const f of inf.flames) {
      for (let k = 0; k < 2; k++) {
        const s = new THREE.Sprite(
          new THREE.SpriteMaterial({ map: this.fireTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false, color: 0xffffff }),
        );
        s.center.set(0.5, 0.05);
        s.position.set(f.pos.x + (Math.random() - 0.5) * 18, f.pos.z, -f.pos.y + (Math.random() - 0.5) * 18);
        s.userData['t'] = f.t;
        s.userData['phase'] = Math.random() * 10;
        s.visible = false;
        this.scene.add(s);
        sprites.push(s);
      }
    }
    // tek ışık paylaşılır: en son yanan ateş aydınlatır
    const light = this.fireLight[0]!;
    for (const f of this.fires.values()) if (f.light === light) this.fireLightBusy.delete(light);
    this.fireLightBusy.add(light);
    light.position.set(inf.center.x, inf.center.z + 30, -inf.center.y);
    this.fires.set(inf.id, { inf, bornSec, sprites, light });
  }

  removeFire(id: number) {
    const f = this.fires.get(id);
    if (!f) return;
    for (const s of f.sprites) {
      s.removeFromParent();
      s.material.dispose();
    }
    this.fires.delete(id);
    if (![...this.fires.values()].some((o) => o.light === f.light)) {
      f.light.intensity = 0;
      this.fireLightBusy.delete(f.light);
    }
  }

  clear() {
    for (const id of [...this.fires.keys()]) this.removeFire(id);
    this.setGrenades([], 0);
    this.setDropped([]);
    this.setBomb(null, false, false);
  }

  update(nowSec: number) {
    for (const f of this.fires.values()) {
      const age = nowSec - f.bornSec;
      let lit = 0;
      for (const s of f.sprites) {
        const t = s.userData['t'] as number;
        const on = age >= t && !f.inf.extinguished;
        s.visible = on;
        if (!on) continue;
        lit++;
        const ph = s.userData['phase'] as number;
        const k = 0.75 + 0.25 * Math.sin(nowSec * 13 + ph) * Math.sin(nowSec * 7.3 + ph * 2);
        const grow = Math.min(1, (age - t) * 3);
        const fade = age > 6.2 ? Math.max(0, (7 - age) / 0.8) : 1;
        s.scale.set(34 * k * grow * fade, 52 * k * grow * fade, 1);
        s.material.opacity = 0.9 * fade;
      }
      if (f === [...this.fires.values()].pop()) {
        f.light.position.set(f.inf.center.x, f.inf.center.z + 30, -f.inf.center.y);
        f.light.intensity = lit > 0 ? 14000 * (0.8 + 0.2 * Math.sin(nowSec * 17)) * Math.min(1, lit / 8) : 0;
      }
    }
  }
}

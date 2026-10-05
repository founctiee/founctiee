/**
 * Dünya efektleri: mermi izleri (tracer), darbe delikleri (decal), kıvılcım/toz/kan
 * parçacıkları, patlamalar, namlu alevleri.
 */
import * as THREE from 'three';
import { Vec3, Mat, MATERIALS } from '@kervan/shared';
import { muzzleFlashTexture } from './viewmodel';

const vs = /* glsl */ `
attribute float aSize;
attribute vec4 aColor;
varying vec4 vColor;
uniform float uScale;
void main() {
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uScale / max(1.0, -mv.z);
  gl_Position = projectionMatrix * mv;
}`;
const fs = /* glsl */ `
varying vec4 vColor;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float d = dot(c, c);
  if (d > 1.0) discard;
  float a = smoothstep(1.0, 0.0, d);
  gl_FragColor = vec4(vColor.rgb, vColor.a * a);
}`;

interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  max: number;
  size: number;
  grow: number;
  r: number;
  g: number;
  b: number;
  a: number;
  gravity: number;
  drag: number;
}

class ParticleSystem {
  readonly points: THREE.Points;
  private parts: Particle[] = [];
  private pos: Float32Array;
  private col: Float32Array;
  private siz: Float32Array;
  private geo: THREE.BufferGeometry;

  constructor(
    private capacity: number,
    additive: boolean,
  ) {
    this.geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(capacity * 3);
    this.col = new Float32Array(capacity * 4);
    this.siz = new Float32Array(capacity);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(this.siz, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      vertexShader: vs,
      fragmentShader: fs,
      uniforms: { uScale: { value: 600 } },
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 5 : 4;
  }

  setScale(s: number) {
    (this.points.material as THREE.ShaderMaterial).uniforms['uScale']!.value = s;
  }

  emit(p: Particle) {
    if (this.parts.length >= this.capacity) this.parts.shift();
    this.parts.push(p);
  }

  update(dt: number) {
    let n = 0;
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i]!;
      p.life -= dt;
      if (p.life <= 0) {
        this.parts.splice(i, 1);
        continue;
      }
      p.vy -= p.gravity * dt;
      const d = Math.exp(-p.drag * dt);
      p.vx *= d;
      p.vy *= d;
      p.vz *= d;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.size += p.grow * dt;
    }
    for (const p of this.parts) {
      const t = p.life / p.max;
      this.pos[n * 3] = p.x;
      this.pos[n * 3 + 1] = p.y;
      this.pos[n * 3 + 2] = p.z;
      this.col[n * 4] = p.r;
      this.col[n * 4 + 1] = p.g;
      this.col[n * 4 + 2] = p.b;
      this.col[n * 4 + 3] = p.a * Math.min(1, t * 2.5);
      this.siz[n] = p.size;
      n++;
    }
    this.geo.setDrawRange(0, n);
    (this.geo.attributes['position'] as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes['aColor'] as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes['aSize'] as THREE.BufferAttribute).needsUpdate = true;
  }
}

function holeTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(10,8,6,1)');
  grd.addColorStop(0.22, 'rgba(20,16,12,0.95)');
  grd.addColorStop(0.35, 'rgba(60,50,40,0.6)');
  grd.addColorStop(0.7, 'rgba(90,80,70,0.15)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  for (let i = 0; i < 8; i++) {
    const a = Math.random() * Math.PI * 2;
    g.strokeStyle = 'rgba(30,25,20,0.5)';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(32 + Math.cos(a) * 6, 32 + Math.sin(a) * 6);
    g.lineTo(32 + Math.cos(a) * (12 + Math.random() * 12), 32 + Math.sin(a) * (12 + Math.random() * 12));
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const DECALS = 200;

interface Tracer {
  mesh: THREE.Mesh;
  from: THREE.Vector3;
  dir: THREE.Vector3;
  dist: number;
  t: number;
}

interface Flash {
  sprite: THREE.Sprite;
  light: THREE.PointLight | null;
  life: number;
  max: number;
}

export class Effects {
  private add: ParticleSystem;
  private norm: ParticleSystem;
  private decals: THREE.InstancedMesh;
  private decalIndex = 0;
  private tracers: Tracer[] = [];
  private tracerGeo = new THREE.CylinderGeometry(0.18, 0.18, 1, 5, 1, true);
  private tracerMat = new THREE.MeshBasicMaterial({ color: 0xffd38a, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  private flashes: Flash[] = [];
  private lightPool: THREE.PointLight[] = [];
  private lightBusy = new Set<THREE.PointLight>();
  private takeLight(): THREE.PointLight | null {
    const l = this.lightPool.find((x) => !this.lightBusy.has(x)) ?? null;
    if (l) this.lightBusy.add(l);
    return l;
  }
  private tmp = new THREE.Object3D();

  constructor(private scene: THREE.Scene) {
    this.add = new ParticleSystem(1500, true);
    this.norm = new ParticleSystem(2500, false);
    scene.add(this.add.points, this.norm.points);
    const dm = new THREE.MeshStandardMaterial({
      map: holeTexture(),
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      roughness: 1,
    });
    this.decals = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), dm, DECALS);
    this.decals.count = 0;
    this.decals.frustumCulled = false;
    this.decals.renderOrder = 2;
    scene.add(this.decals);
    for (let i = 0; i < 4; i++) {
      const l = new THREE.PointLight(0xffa850, 0, 420, 1.6);
      scene.add(l);
      this.lightPool.push(l);
    }
  }

  setViewportHeight(h: number, fovDeg: number) {
    const s = h / (2 * Math.tan((fovDeg * Math.PI) / 360));
    this.add.setScale(s);
    this.norm.setScale(s);
  }

  /** Mermi izi + darbe deliği + parçacıklar (koordinatlar sim uzayında). */
  impact(p: Vec3, n: Vec3, mat: Mat, exit = false) {
    const pos = new THREE.Vector3(p.x, p.z, -p.y);
    const nor = new THREE.Vector3(n.x, n.z, -n.y);
    // delik
    const o = this.tmp;
    o.position.copy(pos).addScaledVector(nor, 0.08);
    o.lookAt(pos.clone().add(nor));
    const s = exit ? 3.2 : 2.6 + Math.random() * 0.8;
    o.scale.set(s, s, s);
    o.rotateZ(Math.random() * Math.PI * 2);
    o.updateMatrix();
    this.decals.setMatrixAt(this.decalIndex, o.matrix);
    this.decalIndex = (this.decalIndex + 1) % DECALS;
    this.decals.count = Math.min(DECALS, this.decals.count + 1);
    this.decals.instanceMatrix.needsUpdate = true;

    const kind = MATERIALS[mat]?.impact ?? 'concrete';
    const dustCol = kind === 'wood' ? [0.45, 0.32, 0.2] : kind === 'sand' ? [0.78, 0.66, 0.46] : kind === 'metal' ? [0.5, 0.5, 0.5] : [0.72, 0.68, 0.6];
    for (let i = 0; i < 6; i++) {
      const v = randDir(nor, 0.7);
      this.norm.emit({
        x: pos.x,
        y: pos.y,
        z: pos.z,
        vx: v.x * (40 + Math.random() * 60),
        vy: v.y * (40 + Math.random() * 60) + 10,
        vz: v.z * (40 + Math.random() * 60),
        life: 0.5 + Math.random() * 0.6,
        max: 1.1,
        size: 3 + Math.random() * 3,
        grow: 10,
        r: dustCol[0]!,
        g: dustCol[1]!,
        b: dustCol[2]!,
        a: 0.55,
        gravity: 40,
        drag: 3,
      });
    }
    // parçalar
    for (let i = 0; i < (kind === 'wood' ? 6 : 4); i++) {
      const v = randDir(nor, 0.9);
      this.norm.emit({
        x: pos.x,
        y: pos.y,
        z: pos.z,
        vx: v.x * 180,
        vy: v.y * 180 + 60,
        vz: v.z * 180,
        life: 0.6,
        max: 0.6,
        size: kind === 'wood' ? 1.2 : 0.8,
        grow: 0,
        r: dustCol[0]! * 0.6,
        g: dustCol[1]! * 0.6,
        b: dustCol[2]! * 0.6,
        a: 1,
        gravity: 600,
        drag: 0.5,
      });
    }
    if (kind === 'metal' || (kind === 'concrete' && Math.random() < 0.4)) {
      for (let i = 0; i < 8; i++) {
        const v = randDir(nor, 0.8);
        this.add.emit({
          x: pos.x,
          y: pos.y,
          z: pos.z,
          vx: v.x * 320,
          vy: v.y * 320 + 50,
          vz: v.z * 320,
          life: 0.15 + Math.random() * 0.2,
          max: 0.35,
          size: 0.9,
          grow: 0,
          r: 1,
          g: 0.75,
          b: 0.35,
          a: 1,
          gravity: 500,
          drag: 1,
        });
      }
    }
  }

  blood(p: Vec3, dir: Vec3, headshot: boolean) {
    const pos = new THREE.Vector3(p.x, p.z, -p.y);
    const d = new THREE.Vector3(dir.x, dir.z, -dir.y).normalize();
    const n = headshot ? 18 : 10;
    for (let i = 0; i < n; i++) {
      const v = randDir(d, 0.6);
      this.norm.emit({
        x: pos.x,
        y: pos.y,
        z: pos.z,
        vx: v.x * (60 + Math.random() * 120),
        vy: v.y * (60 + Math.random() * 120) + 20,
        vz: v.z * (60 + Math.random() * 120),
        life: 0.35 + Math.random() * 0.4,
        max: 0.75,
        size: 2 + Math.random() * 3,
        grow: 6,
        r: 0.45,
        g: 0.03,
        b: 0.02,
        a: 0.85,
        gravity: 300,
        drag: 2,
      });
    }
    if (headshot) {
      // kask kıvılcımı
      for (let i = 0; i < 6; i++) {
        const v = randDir(d.clone().negate(), 0.9);
        this.add.emit({ x: pos.x, y: pos.y, z: pos.z, vx: v.x * 200, vy: v.y * 200, vz: v.z * 200, life: 0.2, max: 0.2, size: 0.8, grow: 0, r: 1, g: 0.9, b: 0.6, a: 1, gravity: 300, drag: 1 });
      }
    }
  }

  /** Dünya uzayında (three) mermi izi. */
  tracer(from: THREE.Vector3, to: THREE.Vector3) {
    const dir = new THREE.Vector3().subVectors(to, from);
    const dist = dir.length();
    if (dist < 60) return;
    dir.normalize();
    const mesh = new THREE.Mesh(this.tracerGeo, this.tracerMat);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    mesh.scale.set(1, Math.min(90, dist * 0.3), 1);
    this.scene.add(mesh);
    this.tracers.push({ mesh, from: from.clone(), dir, dist, t: 0 });
  }

  /** Uzak oyuncu namlu alevi + ışık (three koordinatları). */
  muzzleFlash(pos: THREE.Vector3, big: boolean) {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: muzzleFlashTexture(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false }));
    sprite.position.copy(pos);
    const s = big ? 22 : 14;
    sprite.scale.set(s, s, s);
    sprite.material.rotation = Math.random() * 6.28;
    this.scene.add(sprite);
    const light = this.takeLight();
    if (light) {
      light.position.copy(pos);
      light.intensity = big ? 9000 : 5000;
      light.distance = 380;
    }
    this.flashes.push({ sprite, light, life: 0.05, max: 0.05 });
  }

  explosion(p: Vec3, scale = 1) {
    const pos = new THREE.Vector3(p.x, p.z + 8, -p.y);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: muzzleFlashTexture(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false }));
    sprite.position.copy(pos);
    sprite.scale.setScalar(160 * scale);
    this.scene.add(sprite);
    const light = this.takeLight();
    if (light) {
      light.position.copy(pos);
      light.intensity = 60000 * scale;
      light.distance = 900 * scale;
    }
    this.flashes.push({ sprite, light, life: 0.18, max: 0.18 });
    for (let i = 0; i < 60 * scale; i++) {
      const v = randDir(new THREE.Vector3(0, 1, 0), 1.6);
      this.add.emit({
        x: pos.x,
        y: pos.y,
        z: pos.z,
        vx: v.x * (200 + Math.random() * 300) * scale,
        vy: Math.abs(v.y) * (200 + Math.random() * 300) * scale,
        vz: v.z * (200 + Math.random() * 300) * scale,
        life: 0.3 + Math.random() * 0.4,
        max: 0.7,
        size: 10 + Math.random() * 18,
        grow: 30,
        r: 1,
        g: 0.55 + Math.random() * 0.3,
        b: 0.15,
        a: 0.9,
        gravity: -40,
        drag: 4,
      });
    }
    for (let i = 0; i < 40 * scale; i++) {
      const v = randDir(new THREE.Vector3(0, 1, 0), 1.4);
      this.norm.emit({
        x: pos.x,
        y: pos.y,
        z: pos.z,
        vx: v.x * 160 * scale,
        vy: Math.abs(v.y) * 140 * scale,
        vz: v.z * 160 * scale,
        life: 1.5 + Math.random() * 1.5,
        max: 3,
        size: 30 + Math.random() * 30,
        grow: 40,
        r: 0.25,
        g: 0.23,
        b: 0.21,
        a: 0.55,
        gravity: -15,
        drag: 2.2,
      });
    }
  }

  /** Bomba sekme/düşme tozu, smoke patlaması vb. küçük puf. */
  puff(p: Vec3, color: [number, number, number], count = 10, size = 12) {
    const pos = new THREE.Vector3(p.x, p.z, -p.y);
    for (let i = 0; i < count; i++) {
      const v = randDir(new THREE.Vector3(0, 1, 0), 1.5);
      this.norm.emit({ x: pos.x, y: pos.y, z: pos.z, vx: v.x * 120, vy: Math.abs(v.y) * 80, vz: v.z * 120, life: 0.8 + Math.random(), max: 1.8, size, grow: 25, r: color[0], g: color[1], b: color[2], a: 0.6, gravity: -10, drag: 3 });
    }
  }

  update(dt: number) {
    this.add.update(dt);
    this.norm.update(dt);
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i]!;
      t.t += dt * 9000;
      if (t.t >= t.dist) {
        t.mesh.removeFromParent();
        this.tracers.splice(i, 1);
        continue;
      }
      t.mesh.position.copy(t.from).addScaledVector(t.dir, t.t);
    }
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i]!;
      f.life -= dt;
      const k = Math.max(0, f.life / f.max);
      f.sprite.material.opacity = k;
      if (f.light) f.light.intensity *= 0.6;
      if (f.life <= 0) {
        f.sprite.removeFromParent();
        f.sprite.material.dispose();
        if (f.light) {
          f.light.intensity = 0;
          this.lightBusy.delete(f.light);
        }
        this.flashes.splice(i, 1);
      }
    }
  }
}

function randDir(n: THREE.Vector3, spread: number): THREE.Vector3 {
  const v = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(2 * spread);
  return v.add(n).normalize();
}

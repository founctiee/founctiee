/**
 * Hacimsel sis (CS2 tarzı): voksel doldurma verisi 3B dokuya yazılır, son işleme
 * efektinde sahne derinliğine kadar ray-march edilir. Mermi/HE delikleri anında görünür.
 */
import * as THREE from 'three';
import { Effect, EffectAttribute, BlendFunction } from 'postprocessing';
import {
  SmokeVolume,
  SMOKE_NX,
  SMOKE_NY,
  SMOKE_NZ,
  SMOKE_VOXEL,
  SMOKE_GROW_TIME,
  SMOKE_DURATION,
  SMOKE_FADE,
  healSmoke,
} from '@kervan/shared';

const MAX_VOL = 4;

const fragment = /* glsl */ `
uniform highp sampler3D tVol0;
uniform highp sampler3D tVol1;
uniform highp sampler3D tVol2;
uniform highp sampler3D tVol3;
uniform vec3 uOrigin[4];
uniform vec4 uParams[4]; // x: büyüme (0..), y: sönme çarpanı, z: aktif
uniform vec3 uSize;
uniform mat4 uInvProj;
uniform mat4 uCamWorld;
uniform vec3 uCamPos;
uniform float uTime;
uniform int uSteps;

float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
float vnoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash13(i), b = hash13(i + vec3(1,0,0)), c = hash13(i + vec3(0,1,0)), d = hash13(i + vec3(1,1,0));
  float e = hash13(i + vec3(0,0,1)), g = hash13(i + vec3(1,0,1)), h = hash13(i + vec3(0,1,1)), k = hash13(i + vec3(1,1,1));
  return mix(mix(mix(a,b,f.x), mix(c,d,f.x), f.y), mix(mix(e,g,f.x), mix(h,k,f.x), f.y), f.z);
}
float fbm(vec3 p) {
  return vnoise(p) * 0.55 + vnoise(p * 2.13 + 7.1) * 0.3 + vnoise(p * 4.37 + 3.3) * 0.15;
}

void marchVol(highp sampler3D vol, vec3 org, vec4 prm, vec3 ro, vec3 rd, float maxT, float jitter, inout float T, inout vec3 col) {
  if (prm.z < 0.5) return;
  vec3 inv = 1.0 / rd;
  vec3 t0 = (org - ro) * inv;
  vec3 t1 = (org + uSize - ro) * inv;
  vec3 tmin3 = min(t0, t1);
  vec3 tmax3 = max(t0, t1);
  float tn = max(max(tmin3.x, tmin3.y), max(tmin3.z, 0.0));
  float tf = min(min(tmax3.x, tmax3.y), min(tmax3.z, maxT));
  if (tn >= tf) return;
  float len = tf - tn;
  int steps = uSteps;
  float dt = len / float(steps);
  float t = tn + dt * jitter;
  for (int i = 0; i < 64; i++) {
    if (i >= steps || T < 0.02) break;
    vec3 p = ro + rd * t;
    vec3 uvw = (p - org) / uSize;
    vec4 s = texture(vol, uvw);
    float fill = smoothstep(0.2, 0.75, s.b);
    if (fill > 0.001) {
      float appear = clamp((prm.x - s.r) * 4.0, 0.0, 1.0);
      float d = fill * appear * (1.0 - s.g) * prm.y;
      float n = fbm(p * 0.018 + vec3(0.0, 0.0, -uTime * 0.12));
      d *= smoothstep(0.18, 0.62, n * 0.75 + fill * 0.45);
      if (d > 0.001) {
        float sigma = d * 0.055;
        float h = clamp(uvw.z * 2.2, 0.0, 1.0);
        vec3 lit = mix(vec3(0.42, 0.43, 0.45), vec3(0.88, 0.87, 0.84), h * 0.7 + n * 0.3);
        float a = 1.0 - exp(-sigma * dt);
        col += T * a * lit;
        T *= 1.0 - a;
      }
    }
    t += dt;
  }
}

void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
  vec4 ndc = vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  vec4 vp = uInvProj * ndc;
  vp /= vp.w;
  vec3 wp = (uCamWorld * vp).xyz;
  // three (x, y, z) → sim (x, -z, y)
  vec3 ro = vec3(uCamPos.x, -uCamPos.z, uCamPos.y);
  vec3 pw = vec3(wp.x, -wp.z, wp.y);
  vec3 dir = pw - ro;
  float maxT = length(dir);
  vec3 rd = dir / maxT;
  float jitter = hash13(vec3(gl_FragCoord.xy, uTime * 60.0));
  float T = 1.0;
  vec3 col = vec3(0.0);
  marchVol(tVol0, uOrigin[0], uParams[0], ro, rd, maxT, jitter, T, col);
  marchVol(tVol1, uOrigin[1], uParams[1], ro, rd, maxT, jitter, T, col);
  marchVol(tVol2, uOrigin[2], uParams[2], ro, rd, maxT, jitter, T, col);
  marchVol(tVol3, uOrigin[3], uParams[3], ro, rd, maxT, jitter, T, col);
  outputColor = vec4(inputColor.rgb * T + col, inputColor.a);
}
`;

interface Slot {
  vol: SmokeVolume | null;
  tex: THREE.Data3DTexture;
  data: Uint8Array;
  bornAt: number;
  holesDirty: boolean;
  lastUpload: number;
}

export class SmokeEffect extends Effect {
  private slots: Slot[] = [];
  private camera: THREE.PerspectiveCamera;

  constructor(camera: THREE.PerspectiveCamera, steps: number) {
    const uniforms = new Map<string, THREE.Uniform>();
    const empty = () => {
      const data = new Uint8Array(SMOKE_NX * SMOKE_NY * SMOKE_NZ * 4);
      const t = new THREE.Data3DTexture(data, SMOKE_NX, SMOKE_NY, SMOKE_NZ);
      t.format = THREE.RGBAFormat;
      t.type = THREE.UnsignedByteType;
      t.minFilter = THREE.LinearFilter;
      t.magFilter = THREE.LinearFilter;
      t.unpackAlignment = 1;
      t.needsUpdate = true;
      return { t, data };
    };
    const slots: Slot[] = [];
    for (let i = 0; i < MAX_VOL; i++) {
      const { t, data } = empty();
      slots.push({ vol: null, tex: t, data, bornAt: 0, holesDirty: false, lastUpload: 0 });
      uniforms.set(`tVol${i}`, new THREE.Uniform(t));
    }
    uniforms.set('uOrigin', new THREE.Uniform([0, 1, 2, 3].map(() => new THREE.Vector3())));
    uniforms.set('uParams', new THREE.Uniform([0, 1, 2, 3].map(() => new THREE.Vector4())));
    uniforms.set('uSize', new THREE.Uniform(new THREE.Vector3(SMOKE_NX * SMOKE_VOXEL, SMOKE_NY * SMOKE_VOXEL, SMOKE_NZ * SMOKE_VOXEL)));
    uniforms.set('uInvProj', new THREE.Uniform(new THREE.Matrix4()));
    uniforms.set('uCamWorld', new THREE.Uniform(new THREE.Matrix4()));
    uniforms.set('uCamPos', new THREE.Uniform(new THREE.Vector3()));
    uniforms.set('uTime', new THREE.Uniform(0));
    uniforms.set('uSteps', new THREE.Uniform(steps));
    super('SmokeEffect', fragment, { attributes: EffectAttribute.DEPTH, blendFunction: BlendFunction.NORMAL, uniforms });
    this.slots = slots;
    this.camera = camera;
  }

  add(vol: SmokeVolume, bornAtSec: number) {
    let slot = this.slots.find((s) => !s.vol);
    if (!slot) slot = this.slots.reduce((a, b) => (a.bornAt < b.bornAt ? a : b));
    slot.vol = vol;
    slot.bornAt = bornAtSec;
    const d = slot.data;
    for (let i = 0; i < vol.order.length; i++) {
      const o = vol.order[i]!;
      d[i * 4] = o ? Math.round((o / vol.count) * 250) : 255;
      d[i * 4 + 1] = 0;
      d[i * 4 + 2] = o ? 255 : 0;
      d[i * 4 + 3] = 255;
    }
    slot.tex.needsUpdate = true;
  }

  remove(id: number) {
    for (const s of this.slots) if (s.vol && s.vol.id === id) s.vol = null;
  }

  clear() {
    for (const s of this.slots) s.vol = null;
  }

  get volumes(): SmokeVolume[] {
    return this.slots.filter((s) => s.vol).map((s) => s.vol!);
  }

  markHoles(id: number) {
    for (const s of this.slots) if (s.vol && s.vol.id === id) s.holesDirty = true;
  }

  /** Her kare: uniform'lar ve delik dokuları. nowSec: sunucu zamanı (s). */
  tick(nowSec: number, dt: number) {
    const origins = this.uniforms.get('uOrigin')!.value as THREE.Vector3[];
    const params = this.uniforms.get('uParams')!.value as THREE.Vector4[];
    this.slots.forEach((s, i) => {
      if (!s.vol) {
        params[i]!.set(0, 0, 0, 0);
        return;
      }
      const age = nowSec - s.bornAt;
      if (age > SMOKE_DURATION + 0.5) {
        s.vol = null;
        params[i]!.set(0, 0, 0, 0);
        return;
      }
      healSmoke(s.vol, dt);
      const remain = SMOKE_DURATION - age;
      const fade = remain < SMOKE_FADE ? Math.max(0, remain / SMOKE_FADE) : 1;
      origins[i]!.set(s.vol.origin.x, s.vol.origin.y, s.vol.origin.z);
      params[i]!.set(age / SMOKE_GROW_TIME, fade, 1, 0);
      // delikler (≈20 Hz)
      const h = s.vol.hole;
      let any = s.holesDirty;
      if (!any) for (let k = 0; k < h.length; k += 7) if (h[k]! > 0) { any = true; break; }
      if (any && nowSec - s.lastUpload > 0.05) {
        for (let k = 0; k < h.length; k++) s.data[k * 4 + 1] = Math.round(Math.min(1, h[k]!) * 255);
        s.tex.needsUpdate = true;
        s.lastUpload = nowSec;
        s.holesDirty = false;
      }
    });
  }

  override update(_renderer: THREE.WebGLRenderer, _input: THREE.WebGLRenderTarget, delta?: number) {
    const cam = this.camera;
    (this.uniforms.get('uInvProj')!.value as THREE.Matrix4).copy(cam.projectionMatrixInverse);
    (this.uniforms.get('uCamWorld')!.value as THREE.Matrix4).copy(cam.matrixWorld);
    (this.uniforms.get('uCamPos')!.value as THREE.Vector3).setFromMatrixPosition(cam.matrixWorld);
    this.uniforms.get('uTime')!.value += delta ?? 0.016;
  }
}

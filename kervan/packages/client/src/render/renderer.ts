/**
 * Render altyapısı: WebGL2, güneş + gölge, gökyüzü, SSAO (N8AO), bloom, SMAA, ACES.
 * Dünya ve silah görünümü (viewmodel) ayrı sahne/kamerada çizilir (CS'teki gibi).
 */
import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import {
  EffectComposer,
  RenderPass,
  EffectPass,
  BloomEffect,
  ToneMappingEffect,
  ToneMappingMode,
  SMAAEffect,
  SMAAPreset,
  VignetteEffect,
  Effect,
  Pass,
} from 'postprocessing';
import { N8AOPostPass } from 'n8ao';
import { MapDef } from '@kervan/shared';
import { settings } from '../settings';

/** CS: yatay 90° @ 4:3 → dikey FOV sabit. */
export function verticalFov(horizontal43: number): number {
  return (2 * Math.atan(Math.tan((horizontal43 * Math.PI) / 360) * 0.75) * 180) / Math.PI;
}

export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly vmScene = new THREE.Scene();
  readonly vmCamera: THREE.PerspectiveCamera;
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly vmSun: THREE.DirectionalLight;
  readonly vmHemi: THREE.HemisphereLight;
  private composer: EffectComposer;
  private n8ao: N8AOPostPass | null = null;
  private effectPass: EffectPass;
  private extraEffects: Effect[] = [];
  readonly canvas: HTMLCanvasElement;
  private width = 1;
  private height = 1;
  sunDir = new THREE.Vector3(0, 1, 0);
  /** Sahnedeki aydınlık (viewmodel ışığı için 0..1). */
  vmLight = 1;
  fovH = 90;

  constructor(container: HTMLElement, map: MapDef) {
    const q = settings.quality;
    this.renderer = new THREE.WebGLRenderer({
      antialias: false,
      powerPreference: 'high-performance',
      stencil: false,
      depth: true,
    });
    this.canvas = this.renderer.domElement;
    this.canvas.className = 'game-canvas';
    container.appendChild(this.canvas);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.shadowMap.enabled = q !== 'low';
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.autoClear = false;

    this.camera = new THREE.PerspectiveCamera(verticalFov(90), 16 / 9, 2, 14000);
    this.vmCamera = new THREE.PerspectiveCamera(verticalFov(settings.viewmodelFov), 16 / 9, 0.5, 200);

    // gökyüzü
    const sky = new Sky();
    sky.scale.setScalar(12000);
    const su = sky.material.uniforms;
    su['turbidity']!.value = 2.2;
    su['rayleigh']!.value = 0.85;
    su['mieCoefficient']!.value = 0.004;
    su['mieDirectionalG']!.value = 0.86;
    this.sunDir.set(map.sun.x, map.sun.z, -map.sun.y).normalize();
    su['sunPosition']!.value.copy(this.sunDir);
    this.scene.add(sky);

    // çevre haritası (metal yansımaları)
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envScene = new THREE.Scene();
    const sky2 = new Sky();
    sky2.scale.setScalar(1000);
    sky2.material.uniforms['sunPosition']!.value.copy(this.sunDir);
    sky2.material.uniforms['turbidity']!.value = 4.5;
    sky2.material.uniforms['rayleigh']!.value = 1.1;
    envScene.add(sky2);
    const env = pmrem.fromScene(envScene, 0.04).texture;
    this.scene.environment = env;
    this.scene.environmentIntensity = 0.3;
    this.vmScene.environment = env;
    this.vmScene.environmentIntensity = 0.18;

    this.scene.fog = new THREE.Fog(0xcfc2a8, 4200, 16000);

    // ışıklar
    this.sun = new THREE.DirectionalLight(0xffeccc, 3.0);
    this.sun.position.copy(this.sunDir).multiplyScalar(4000);
    const c = map.bounds;
    const cx = (c.mins.x + c.maxs.x) / 2;
    const cy = (c.mins.y + c.maxs.y) / 2;
    this.sun.target.position.set(cx, 0, -cy);
    this.sun.position.add(this.sun.target.position);
    this.sun.castShadow = q !== 'low';
    const half = Math.max(c.maxs.x - c.mins.x, c.maxs.y - c.mins.y) * 0.62;
    const sc = this.sun.shadow.camera;
    sc.left = -half;
    sc.right = half;
    sc.top = half;
    sc.bottom = -half;
    sc.near = 100;
    sc.far = 9000;
    this.sun.shadow.mapSize.set(q === 'high' ? 4096 : 2048, q === 'high' ? 4096 : 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 1.2;
    this.scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xb4cbf0, 0xb89568, 1.1);
    this.scene.add(this.hemi);

    this.vmSun = new THREE.DirectionalLight(0xfff0dc, 2.2);
    this.vmSun.position.set(-0.4, 1, 0.6);
    this.vmHemi = new THREE.HemisphereLight(0xc8dcff, 0xb08a5a, 1.4);
    this.vmScene.add(this.vmSun, this.vmHemi);

    // son işleme
    this.composer = new EffectComposer(this.renderer, { frameBufferType: THREE.HalfFloatType, multisampling: 0 });
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    if (q !== 'low') {
      this.n8ao = new N8AOPostPass(this.scene, this.camera, 1, 1);
      const cfg = this.n8ao.configuration;
      cfg.aoRadius = 28;
      cfg.distanceFalloff = 0.6;
      cfg.intensity = 2.2;
      cfg.aoSamples = q === 'high' ? 16 : 8;
      cfg.denoiseSamples = q === 'high' ? 8 : 4;
      cfg.halfRes = q !== 'high';
      cfg.color = new THREE.Color(0x1a1208);
      this.composer.addPass(this.n8ao as unknown as Pass);
    }
    this.effectPass = this.makeEffectPass();
    this.composer.addPass(this.effectPass);

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  private makeEffectPass(): EffectPass {
    const q = settings.quality;
    const effects: Effect[] = [...this.extraEffects];
    if (q !== 'low') effects.push(new BloomEffect({ intensity: 0.32, luminanceThreshold: 0.96, luminanceSmoothing: 0.15, mipmapBlur: true }));
    effects.push(new VignetteEffect({ offset: 0.25, darkness: 0.45 }));
    effects.push(new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC }));
    effects.push(new SMAAEffect({ preset: q === 'high' ? SMAAPreset.HIGH : SMAAPreset.MEDIUM }));
    return new EffectPass(this.camera, ...effects);
  }

  /** Sis gibi özel efektleri tone mapping'den önce ekler. */
  addEffect(e: Effect) {
    this.extraEffects.push(e);
    this.composer.removePass(this.effectPass);
    this.effectPass.dispose();
    this.effectPass = this.makeEffectPass();
    this.composer.addPass(this.effectPass);
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2) * settings.renderScale;
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(this.width, this.height);
    this.composer.setSize(this.width, this.height);
    const aspect = this.width / this.height;
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    this.vmCamera.aspect = aspect;
    this.vmCamera.updateProjectionMatrix();
  }

  setFov(horizontal43: number) {
    if (this.fovH === horizontal43) return;
    this.fovH = horizontal43;
    this.camera.fov = verticalFov(horizontal43);
    this.camera.updateProjectionMatrix();
  }

  setViewmodelFov(fov: number) {
    const v = verticalFov(fov);
    if (Math.abs(this.vmCamera.fov - v) > 0.01) {
      this.vmCamera.fov = v;
      this.vmCamera.updateProjectionMatrix();
    }
  }

  render(drawViewmodel: boolean) {
    const r = this.renderer;
    r.toneMapping = THREE.NoToneMapping;
    r.toneMappingExposure = settings.brightness;
    this.composer.render();
    if (drawViewmodel) {
      r.toneMapping = THREE.ACESFilmicToneMapping;
      r.toneMappingExposure = settings.brightness;
      r.setRenderTarget(null);
      r.clearDepth();
      this.vmSun.intensity = 0.6 + 1.8 * this.vmLight;
      this.vmHemi.intensity = 0.7 + 0.8 * this.vmLight;
      r.render(this.vmScene, this.vmCamera);
      r.toneMapping = THREE.NoToneMapping;
    }
  }

  get size() {
    return { w: this.width, h: this.height };
  }
}

/** Silah simgeleri: prosedürel modeller yandan çizilip PNG'ye çevrilir (satın alma menüsü, killfeed). */
import * as THREE from 'three';
import { weaponModel } from './weaponmodels';

let renderer: THREE.WebGLRenderer | null = null;
const cache = new Map<string, string>();

function ensure(): THREE.WebGLRenderer {
  if (!renderer) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 96;
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.setSize(256, 96, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
  }
  return renderer;
}

/** mode: 'color' (satın alma) ya da 'white' (killfeed silueti). */
export function weaponIcon(key: string, mode: 'color' | 'white' = 'color'): string {
  const ck = `${key}:${mode}`;
  const hit = cache.get(ck);
  if (hit) return hit;
  try {
    const r = ensure();
    const scene = new THREE.Scene();
    const model = weaponModel(key);
    if (mode === 'white') {
      const white = new THREE.MeshBasicMaterial({ color: 0xffffff });
      model.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).material = white;
      });
    } else {
      scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 2.2));
      const d = new THREE.DirectionalLight(0xffffff, 2.5);
      d.position.set(4, 6, 8);
      scene.add(d);
    }
    // yandan görünüm: namlu sağa
    const holder = new THREE.Group();
    holder.add(model);
    holder.rotation.y = -Math.PI / 2;
    scene.add(holder);
    const box = new THREE.Box3().setFromObject(holder);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const aspect = 256 / 96;
    const halfW = Math.max(size.x / 2, (size.y / 2) * aspect) * 1.08;
    const cam = new THREE.OrthographicCamera(-halfW, halfW, halfW / aspect, -halfW / aspect, -100, 100);
    cam.position.set(center.x, center.y, center.z + 50);
    cam.lookAt(center);
    r.setClearColor(0x000000, 0);
    r.clear();
    r.render(scene, cam);
    const url = r.domElement.toDataURL('image/png');
    cache.set(ck, url);
    return url;
  } catch {
    return '';
  }
}

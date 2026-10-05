/**
 * Prosedürel silah modelleri. Birim inç; namlu -Z yönünde, +Y yukarı, orijin kabzanın
 * tepesi (sağ elin tuttuğu yer). Animasyon için parçalar adlandırılır: mag, slide, bolt,
 * muzzle (işaretçi), eject (kovan çıkışı), lefthand (sol el hedefi).
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

const mats = {
  steel: new THREE.MeshStandardMaterial({ color: 0x2c2c2d, metalness: 0.55, roughness: 0.48 }),
  black: new THREE.MeshStandardMaterial({ color: 0x18191b, metalness: 0.35, roughness: 0.6 }),
  polymer: new THREE.MeshStandardMaterial({ color: 0x232426, metalness: 0.05, roughness: 0.78 }),
  wood: new THREE.MeshStandardMaterial({ color: 0x8b4f2a, metalness: 0, roughness: 0.55 }),
  woodDark: new THREE.MeshStandardMaterial({ color: 0x5a3219, metalness: 0, roughness: 0.6 }),
  tan: new THREE.MeshStandardMaterial({ color: 0xb79a6d, metalness: 0.05, roughness: 0.7 }),
  green: new THREE.MeshStandardMaterial({ color: 0x4f5b3a, metalness: 0.1, roughness: 0.65 }),
  olive: new THREE.MeshStandardMaterial({ color: 0x5c5a3c, metalness: 0.1, roughness: 0.7 }),
  silver: new THREE.MeshStandardMaterial({ color: 0x8d8f92, metalness: 0.7, roughness: 0.35 }),
  gold: new THREE.MeshStandardMaterial({ color: 0xb08d57, metalness: 0.9, roughness: 0.35 }),
  lens: new THREE.MeshStandardMaterial({ color: 0x22405a, metalness: 0.2, roughness: 0.05, emissive: 0x0a1a28 }),
  blade: new THREE.MeshStandardMaterial({ color: 0xc8ccd1, metalness: 1, roughness: 0.22 }),
  red: new THREE.MeshStandardMaterial({ color: 0x8b2a1f, metalness: 0.2, roughness: 0.6 }),
  c4: new THREE.MeshStandardMaterial({ color: 0xa79a6c, metalness: 0, roughness: 0.85 }),
  screen: new THREE.MeshStandardMaterial({ color: 0x0f2a12, emissive: 0x2a8a2a, emissiveIntensity: 0.6, roughness: 0.4 }),
  glass: new THREE.MeshStandardMaterial({ color: 0x6b8a4a, metalness: 0.1, roughness: 0.1, transparent: true, opacity: 0.75 }),
  cloth: new THREE.MeshStandardMaterial({ color: 0xd8c8a8, roughness: 0.95 }),
  blue: new THREE.MeshStandardMaterial({ color: 0x3b4f63, metalness: 0.3, roughness: 0.5 }),
};
export type MatKey = keyof typeof mats;

const geoCache = new Map<string, THREE.BufferGeometry>();
function rbox(w: number, h: number, d: number, r: number): THREE.BufferGeometry {
  const key = `b${w.toFixed(2)}_${h.toFixed(2)}_${d.toFixed(2)}_${r.toFixed(2)}`;
  let g = geoCache.get(key);
  if (!g) {
    const rr = Math.min(r, w / 2 - 0.01, h / 2 - 0.01, d / 2 - 0.01);
    g = rr > 0.02 ? new RoundedBoxGeometry(w, h, d, 2, rr) : new THREE.BoxGeometry(w, h, d);
    geoCache.set(key, g);
  }
  return g;
}
function cyl(r1: number, r2: number, len: number, seg = 14): THREE.BufferGeometry {
  const key = `c${r1}_${r2}_${len}_${seg}`;
  let g = geoCache.get(key);
  if (!g) {
    g = new THREE.CylinderGeometry(r2, r1, len, seg);
    g.rotateX(Math.PI / 2); // Z boyunca; r1 = +Z (arka) ucu
    geoCache.set(key, g);
  }
  return g;
}

class Builder {
  root = new THREE.Group();
  box(w: number, h: number, d: number, m: MatKey, x: number, y: number, z: number, r = 0.15, parent: THREE.Object3D = this.root, rx = 0): THREE.Mesh {
    const mesh = new THREE.Mesh(rbox(w, h, d, r), mats[m]);
    mesh.position.set(x, y, z);
    mesh.rotation.x = rx;
    parent.add(mesh);
    return mesh;
  }
  /** Z ekseni boyunca silindir: z0 (arka) → z1 (ön). */
  tube(r: number, z0: number, z1: number, m: MatKey, x: number, y: number, parent: THREE.Object3D = this.root, r2 = r, seg = 14): THREE.Mesh {
    const len = Math.abs(z1 - z0);
    const mesh = new THREE.Mesh(cyl(r, r2, len, seg), mats[m]);
    mesh.position.set(x, y, (z0 + z1) / 2);
    parent.add(mesh);
    return mesh;
  }
  group(name: string, parent: THREE.Object3D = this.root): THREE.Group {
    const g = new THREE.Group();
    g.name = name;
    parent.add(g);
    return g;
  }
  marker(name: string, x: number, y: number, z: number, parent: THREE.Object3D = this.root) {
    const o = new THREE.Object3D();
    o.name = name;
    o.position.set(x, y, z);
    parent.add(o);
    return o;
  }
  grip(m: MatKey, x: number, y: number, z: number, angle = 0.28, h = 4, w = 1.1, d = 1.5) {
    const g = this.box(w, h, d, m, x, y - h / 2, z + Math.sin(angle) * h * 0.5, 0.3);
    g.rotation.x = -angle;
    return g;
  }
  /** Kavisli şarjör (AK tipi): segmentlerle. */
  curvedMag(m: MatKey, x: number, y: number, z: number, len: number, curve: number, w = 0.95, d = 2.2, parent?: THREE.Object3D) {
    const g = this.group('mag', parent);
    g.position.set(x, y, z);
    const segs = 5;
    for (let i = 0; i < segs; i++) {
      const t = i / segs;
      const a = t * curve;
      const seg = this.box(w, len / segs + 0.15, d, m, 0, -t * len - len / segs / 2, -Math.sin(a) * len * 0.45, 0.12, g);
      seg.rotation.x = a;
    }
    return g;
  }
  scope(z0: number, z1: number, y: number, r = 0.85, bell = 1.15) {
    this.tube(r, z0 + 1.2, z1 - 1.2, 'black', 0, y, this.root, r, 18);
    this.tube(bell, z0, z0 + 1.6, 'black', 0, y, this.root, r, 18);
    this.tube(r, z1 - 1.8, z1, 'black', 0, y, this.root, bell * 0.95, 18);
    this.box(0.5, 0.9, 0.7, 'black', 0, y + r, (z0 + z1) / 2, 0.1);
    this.box(0.9, 0.5, 0.7, 'black', r, y, (z0 + z1) / 2, 0.1);
    const lensF = new THREE.Mesh(new THREE.CircleGeometry(bell * 0.85, 18), mats.lens);
    lensF.position.set(0, y, z1 - 0.01);
    lensF.rotation.y = Math.PI;
    this.root.add(lensF);
    // bağlantı ayakları
    this.box(0.7, 1.1, 0.8, 'steel', 0, y - r - 0.3, z0 + 3, 0.1);
    this.box(0.7, 1.1, 0.8, 'steel', 0, y - r - 0.3, z1 - 3, 0.1);
  }
  done(): THREE.Group {
    this.root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    return this.root;
  }
}

/** AK-47 / Galil */
function ak(galil = false): THREE.Group {
  const b = new Builder();
  const wood = galil ? 'polymer' : 'wood';
  b.box(1.5, 2.4, 11.5, 'steel', 0, 0.7, -4.5, 0.2); // gövde
  b.box(1.3, 0.5, 9, 'steel', 0, 2.05, -4.6, 0.15); // kapak
  b.grip(wood, 0, -0.4, 1.2, 0.3, 4.2, 1.1, 1.7);
  b.box(0.3, 0.2, 2.6, 'steel', 0, -0.75, -0.6, 0.05); // tetik korkuluğu
  // dipçik
  const stock = b.box(1.35, 2.6, 9.5, wood, 0, 0.0, 6.8, 0.35);
  stock.rotation.x = 0.12;
  b.box(1.4, 3.2, 1.0, 'black', 0, -0.4, 11.4, 0.3);
  // el kundağı
  b.box(1.7, 1.9, 6.5, wood, 0, 0.7, -13.3, 0.4);
  b.box(1.2, 1.0, 6.5, wood, 0, 2.1, -13.0, 0.35); // gaz tüpü kapağı
  b.tube(0.33, -16.6, -28.5, 'steel', 0, 0.95);
  b.tube(0.28, -16.6, -24, 'steel', 0, 2.1);
  b.box(0.3, 1.6, 0.5, 'steel', 0, 1.9, -26.6, 0.05); // arpacık
  b.box(0.9, 0.7, 1.3, 'steel', 0, 2.5, -10, 0.1); // gez
  b.tube(0.5, -28.5, -30.3, 'steel', 0, 0.95, b.root, 0.45);
  b.curvedMag(galil ? 'black' : 'steel', 0, -0.3, -6.3, 9.5, 0.55, 1.0, 2.3);
  b.box(0.2, 0.45, 2.2, 'silver', 0.8, 1.6, -3.4, 0.05).name = 'bolt';
  b.marker('muzzle', 0, 0.95, -30.6);
  b.marker('eject', 0.9, 1.4, -4.4);
  b.marker('lefthand', 0, 0.3, -13.0);
  return b.done();
}

function m4(silenced: boolean): THREE.Group {
  const b = new Builder();
  b.box(1.35, 2.2, 8.5, 'polymer', 0, 0.8, -3.4, 0.18); // alt gövde
  b.box(1.25, 1.2, 8.8, 'black', 0, 2.3, -3.5, 0.12); // üst gövde
  for (let i = 0; i < 9; i++) b.box(0.95, 0.35, 0.45, 'black', 0, 3.05, -0.4 - i * 0.95, 0.05); // ray
  b.grip('polymer', 0, -0.3, 1.0, 0.33, 4.0, 1.15, 1.6);
  b.box(0.3, 0.25, 2.8, 'black', 0, -0.65, -0.4, 0.06);
  // teleskopik dipçik
  b.tube(0.55, 1.5, 7.5, 'black', 0, 1.5);
  const st = b.box(1.4, 2.6, 4.6, 'polymer', 0, 0.9, 7.8, 0.4);
  st.rotation.x = 0.05;
  b.box(1.45, 3.0, 0.8, 'black', 0, 0.5, 10.3, 0.25);
  // el kundağı
  b.box(1.8, 2.0, 9.5, 'polymer', 0, 1.6, -12.4, 0.5);
  for (let i = 0; i < 4; i++) b.box(0.25, 1.4, 8, 'black', i % 2 ? 0.95 : -0.95, 1.6, -12.4, 0.05);
  b.tube(0.3, -17, -25, 'steel', 0, 1.6);
  if (silenced) b.tube(0.7, -24, -32.5, 'black', 0, 1.6, b.root, 0.7, 18).userData['silencer'] = true;
  else {
    b.box(0.35, 2.0, 0.6, 'black', 0, 2.6, -21.5, 0.08); // ön nişangah
    b.tube(0.42, -25, -26.6, 'black', 0, 1.6);
  }
  b.box(0.7, 1.1, 1.2, 'black', 0, 3.6, -1.0, 0.1); // arka nişangah
  const mag = b.group('mag');
  mag.position.set(0, -0.2, -5.5);
  const mm = b.box(0.9, 7, 2.2, 'steel', 0, -3.3, -0.35, 0.15, mag);
  mm.rotation.x = 0.12;
  b.marker('muzzle', 0, 1.6, silenced ? -32.8 : -26.9);
  b.marker('eject', 0.8, 1.8, -3.4);
  b.marker('lefthand', 0, 0.6, -12.5);
  return b.done();
}

function famas(): THREE.Group {
  const b = new Builder();
  b.box(1.6, 3.2, 16, 'polymer', 0, 1.2, 1.5, 0.5);
  b.box(0.9, 1.4, 12, 'black', 0, 3.4, -0.5, 0.3); // taşıma kolu
  b.grip('polymer', 0, -0.4, -1.5, 0.25, 4.0, 1.1, 1.6);
  b.tube(0.35, -6.5, -16, 'steel', 0, 1.6);
  b.box(1.8, 1.6, 5, 'polymer', 0, 1.0, -8.5, 0.5);
  const mag = b.group('mag');
  mag.position.set(0, -0.3, 4.0);
  b.box(0.9, 6, 2.0, 'steel', 0, -2.9, 0, 0.12, mag);
  b.marker('muzzle', 0, 1.6, -16.3);
  b.marker('eject', 0.9, 1.6, 4.5);
  b.marker('lefthand', 0, 0.4, -8.5);
  return b.done();
}

function aug(scopeMat: MatKey = 'green'): THREE.Group {
  const b = new Builder();
  b.box(1.9, 3.0, 17, scopeMat, 0, 0.9, 2.0, 0.8);
  b.grip(scopeMat, 0, -0.5, -1.8, 0.2, 4.0, 1.2, 1.7);
  b.box(1.4, 3.6, 1.2, scopeMat, 0, -1.3, -6.5, 0.4); // ön tutamak
  b.tube(0.4, -6.5, -17.5, 'steel', 0, 1.3);
  b.scope(-4, 4.5, 4.2, 0.8, 1.0);
  const mag = b.group('mag');
  mag.position.set(0, -0.6, 3.5);
  b.box(0.95, 6, 2.1, 'glass', 0, -2.8, 0, 0.15, mag);
  b.marker('muzzle', 0, 1.3, -17.8);
  b.marker('eject', 0.9, 1.2, 6);
  b.marker('lefthand', 0, -1.3, -6.5);
  return b.done();
}

function sg553(): THREE.Group {
  const b = new Builder();
  b.box(1.5, 2.6, 11, 'tan', 0, 0.8, -4, 0.3);
  b.grip('black', 0, -0.4, 1.0, 0.3, 4.0, 1.1, 1.6);
  b.box(1.4, 2.4, 9, 'black', 0, 0.6, 6, 0.4);
  b.box(1.8, 2.0, 7, 'tan', 0, 1.0, -12.5, 0.5);
  b.tube(0.33, -16, -26, 'steel', 0, 1.2);
  b.scope(-7, 1.5, 3.8, 0.75, 1.0);
  b.curvedMag('glass', 0, -0.3, -5.5, 8.5, 0.35, 0.95, 2.2);
  b.marker('muzzle', 0, 1.2, -26.3);
  b.marker('eject', 0.8, 1.4, -3.5);
  b.marker('lefthand', 0, 0.4, -12.5);
  return b.done();
}

function sniper(kind: 'awp' | 'ssg08' | 'g3sg1' | 'scar20'): THREE.Group {
  const b = new Builder();
  const body: MatKey = kind === 'awp' ? 'green' : kind === 'ssg08' ? 'olive' : kind === 'scar20' ? 'black' : 'tan';
  const long = kind === 'awp' ? 1 : 0.85;
  b.box(1.7, 2.6, 13 * long, body, 0, 0.7, -3, 0.45);
  b.box(1.3, 1.1, 10, 'steel', 0, 2.2, -3, 0.2);
  b.grip(body, 0, -0.5, 1.6, 0.25, 4.0, 1.2, 1.8);
  // dipçik (thumbhole)
  b.box(1.5, 1.0, 8.5, body, 0, 1.9, 7.5, 0.4);
  b.box(1.5, 1.2, 8, body, 0, -1.4, 7.8, 0.4);
  b.box(1.5, 4.2, 1.6, body, 0, 0.3, 11.6, 0.5);
  b.box(1.6, 1.4, 12 * long, body, 0, 0.2, -14 * long, 0.5); // el kundağı
  b.tube(0.42, -10, -40 * long, 'steel', 0, 1.3, b.root, 0.36);
  if (kind === 'awp') b.tube(0.6, -40, -42.5, 'steel', 0, 1.3);
  b.scope(-9, 5, 4.6, 0.9, 1.25);
  if (kind === 'awp' || kind === 'ssg08') {
    const bolt = b.group('bolt');
    bolt.position.set(1, 2.1, 1.5);
    b.tube(0.15, 0, 1.6, 'steel', 0, 0, bolt);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.42, 10, 8), mats.steel);
    knob.position.set(1.2, -0.4, 0);
    bolt.add(knob);
    const arm = b.box(1.4, 0.25, 0.25, 'steel', 0.6, -0.2, 0, 0.05, bolt);
    arm.rotation.z = -0.35;
  }
  const mag = b.group('mag');
  mag.position.set(0, -0.5, -4);
  b.box(1.0, kind === 'awp' ? 3 : 4.5, 2.5, 'black', 0, -1.4, 0, 0.15, mag);
  const end = kind === 'awp' ? -42.8 : -40 * long - 0.3;
  b.marker('muzzle', 0, 1.3, end);
  b.marker('eject', 0.9, 1.9, -2);
  b.marker('lefthand', 0, -0.3, -13 * long);
  return b.done();
}

function smg(kind: string): THREE.Group {
  const b = new Builder();
  switch (kind) {
    case 'p90': {
      b.box(2.0, 3.4, 15, 'black', 0, 0.6, 0.5, 0.9);
      b.box(1.3, 1.0, 9, 'glass', 0, 2.6, -1, 0.35);
      b.tube(0.35, -7, -10.5, 'steel', 0, 1.2);
      b.box(1.2, 3, 2, 'black', 0, -1.5, -3.5, 0.6);
      b.marker('muzzle', 0, 1.2, -10.8);
      b.marker('lefthand', 0, -0.5, -4.5);
      b.group('mag');
      break;
    }
    case 'mac10': {
      b.box(1.5, 2.6, 7.5, 'black', 0, 0.9, -2.5, 0.2);
      b.box(1.2, 4.2, 1.4, 'black', 0, -1.6, -0.2, 0.25);
      b.tube(0.3, -6.2, -8.5, 'steel', 0, 1.3);
      b.tube(0.15, 0.8, 6, 'steel', 0.4, 0.5);
      b.tube(0.15, 0.8, 6, 'steel', -0.4, 0.5);
      const mag = b.group('mag');
      mag.position.set(0, -3.6, -0.2);
      b.box(0.9, 4, 1.1, 'steel', 0, -1.6, 0, 0.1, mag);
      b.marker('muzzle', 0, 1.3, -8.8);
      b.marker('lefthand', 0, 0.2, -5.5);
      break;
    }
    case 'mp9': {
      b.box(1.4, 2.6, 8, 'black', 0, 0.9, -3, 0.35);
      b.grip('black', 0, -0.4, 0.8, 0.1, 4, 1.1, 1.4);
      b.box(1.2, 2.6, 1.0, 'black', 0, -1.3, -4.5, 0.4); // ön tutamak
      b.tube(0.3, -7, -9.5, 'steel', 0, 1.2);
      b.box(0.8, 0.8, 6, 'black', 0, 1.2, 4.5, 0.2);
      const mag = b.group('mag');
      mag.position.set(0, -2.2, 0.8);
      b.box(0.9, 4.5, 1.2, 'steel', 0, -2, 0, 0.1, mag);
      b.marker('muzzle', 0, 1.2, -9.8);
      b.marker('lefthand', 0, -1.3, -4.5);
      break;
    }
    case 'bizon': {
      b.box(1.4, 2.4, 10, 'black', 0, 1.0, -3.5, 0.25);
      b.grip('woodDark', 0, -0.2, 1.2, 0.3, 3.8, 1.1, 1.5);
      b.tube(1.0, -2, -12, 'black', 0, -0.6, b.root, 1.0, 16); // helezon şarjör
      b.tube(0.3, -8.5, -14.5, 'steel', 0, 1.4);
      b.tube(0.25, 1.5, 9, 'steel', 0, 1.0);
      b.box(1.2, 2.5, 0.7, 'black', 0, 0.2, 9.2, 0.2);
      b.group('mag');
      b.marker('muzzle', 0, 1.4, -14.8);
      b.marker('lefthand', 0, -0.6, -8);
      break;
    }
    default: {
      // mp7, mp5sd, ump45
      const ump = kind === 'ump45';
      const sd = kind === 'mp5sd';
      b.box(1.6, 2.6, ump ? 11 : 9, ump ? 'polymer' : 'black', 0, 0.9, -3.5, 0.3);
      b.grip('polymer', 0, -0.4, 1.0, 0.3, 3.8, 1.1, 1.5);
      b.box(1.4, 2.4, ump ? 7 : 5.5, 'black', 0, 0.4, 5.5, 0.4);
      b.box(1.8, 1.8, 4.5, 'polymer', 0, 0.7, ump ? -10.5 : -9, 0.5);
      if (sd) b.tube(0.8, -9, -17, 'black', 0, 1.0, b.root, 0.8, 18);
      else b.tube(0.3, ump ? -12.5 : -10.5, ump ? -14.5 : -12.5, 'steel', 0, 1.0);
      const mag = b.group('mag');
      mag.position.set(0, -0.3, -5);
      const m = b.box(0.95, ump ? 6.5 : 7, 1.6, 'steel', 0, -3, -0.4, 0.12, mag);
      m.rotation.x = sd ? 0.2 : 0.05;
      b.marker('muzzle', 0, 1.0, sd ? -17.3 : ump ? -14.8 : -12.8);
      b.marker('lefthand', 0, 0, ump ? -10.5 : -9);
    }
  }
  b.marker('eject', 0.9, 1.4, -2);
  return b.done();
}

function shotgun(kind: string): THREE.Group {
  const b = new Builder();
  const short = kind === 'sawedoff';
  const mag7 = kind === 'mag7';
  b.box(1.5, 2.6, 8, mag7 ? 'black' : 'steel', 0, 0.8, -2.5, 0.25);
  b.grip(kind === 'nova' ? 'black' : 'woodDark', 0, -0.3, 1.2, 0.3, 3.9, 1.1, 1.6);
  if (!short) {
    const st = b.box(1.4, 2.6, 9.5, kind === 'xm1014' ? 'black' : 'polymer', 0, 0.1, 7.2, 0.4);
    st.rotation.x = 0.12;
  }
  const blen = short ? 8 : mag7 ? 10 : 18;
  b.tube(0.55, -6.5, -6.5 - blen, 'steel', 0, 1.4);
  if (!mag7) b.tube(0.45, -6.5, -6.5 - blen * 0.85, 'steel', 0, 0.35);
  const pump = b.group('slide');
  b.box(1.6, 1.7, 5.5, kind === 'nova' ? 'black' : 'woodDark', 0, 0.35, -11, 0.5, pump);
  if (mag7) {
    const mag = b.group('mag');
    mag.position.set(0, -0.5, -1);
    b.box(1.1, 4, 2.5, 'black', 0, -1.8, 0, 0.15, mag);
  } else b.group('mag');
  b.marker('muzzle', 0, 1.4, -6.8 - blen);
  b.marker('eject', 0.9, 1.4, -2.5);
  b.marker('lefthand', 0, 0, -11);
  return b.done();
}

function lmg(kind: string): THREE.Group {
  const b = new Builder();
  b.box(2.2, 3.4, 13, 'black', 0, 1.0, -3, 0.3);
  b.grip('polymer', 0, -0.6, 1.8, 0.25, 4.0, 1.2, 1.6);
  b.box(1.6, 2.8, 9, 'polymer', 0, 0.5, 8, 0.4);
  b.box(2.0, 1.9, 8, 'black', 0, 1.2, -13.5, 0.3);
  b.tube(0.45, -17, -32, 'steel', 0, 1.4);
  b.box(0.8, 1.4, 6, 'black', 0, 3.2, -4, 0.15); // taşıma kolu
  const mag = b.group('mag');
  mag.position.set(-0.2, -0.6, -4);
  b.box(kind === 'negev' ? 2.2 : 3.2, 4.2, 4.2, kind === 'negev' ? 'olive' : 'green', -0.6, -2, 0, 0.3, mag);
  b.marker('muzzle', 0, 1.4, -32.3);
  b.marker('eject', 1.2, 1.4, -3);
  b.marker('lefthand', 0, 0.2, -13.5);
  return b.done();
}

function pistol(kind: string): THREE.Group {
  const b = new Builder();
  const big = kind === 'deagle';
  const len = big ? 9.5 : kind === 'tec9' ? 7 : kind === 'fiveseven' ? 7.6 : 7.2;
  const slideMat: MatKey = kind === 'deagle' ? 'silver' : kind === 'p250' || kind === 'cz75a' ? 'steel' : 'black';
  const slide = b.group('slide');
  b.box(big ? 1.35 : 1.05, big ? 1.6 : 1.3, len, slideMat, 0, 1.1, -len / 2 + 1.6, 0.18, slide);
  if (kind === 'tec9') {
    b.box(1.1, 1.6, 6, 'black', 0, 0.3, -2.0, 0.2);
    b.tube(0.35, -5, -8, 'steel', 0, 1.0);
  } else b.box(big ? 1.2 : 0.95, 1.1, len * 0.8, 'polymer', 0, 0.15, -len / 2 + 2, 0.15);
  b.grip(kind === 'cz75a' ? 'woodDark' : 'polymer', 0, -0.2, 0.9, 0.25, big ? 4.1 : 3.6, big ? 1.25 : 1.1, big ? 2.0 : 1.75);
  b.box(0.25, 0.2, 1.8, 'black', 0, -0.6, -0.7, 0.05);
  if (kind === 'usp_silencer') b.tube(0.55, -len + 1.6, -len - 4.5, 'black', 0, 1.0, b.root, 0.55, 16).userData['silencer'] = true;
  const mag = b.group('mag');
  if (kind === 'tec9') {
    mag.position.set(0, -0.4, -2.6);
    b.box(0.8, 5, 1.0, 'steel', 0, -2.2, 0, 0.1, mag);
  } else mag.position.set(0, -3.2, 1.6);
  b.box(0.3, 1.2, 0.3, 'steel', 0, 1.95, -len + 2, 0.05);
  const mz = kind === 'usp_silencer' ? -len - 4.7 : kind === 'tec9' ? -8.2 : -len + 1.5;
  b.marker('muzzle', 0, 1.0, mz);
  b.marker('eject', 0.6, 1.4, -1.5);
  b.marker('lefthand', 0, -1.4, 0.8);
  return b.done();
}

function knife(): THREE.Group {
  const b = new Builder();
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(0, 1.25);
  shape.lineTo(-5.5, 1.1);
  shape.quadraticCurveTo(-7.4, 0.9, -8.2, -0.1);
  shape.quadraticCurveTo(-6, 0.1, 0, 0);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.12, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.05, bevelSegments: 1 });
  geo.translate(0, -0.6, -0.09);
  geo.rotateY(Math.PI / 2);
  const blade = new THREE.Mesh(geo, mats.blade);
  blade.position.set(0, 0.6, -1.2);
  b.root.add(blade);
  b.box(0.5, 1.9, 0.5, 'black', 0, 0.55, -1.0, 0.1); // koruma
  b.box(0.85, 1.25, 4.4, 'polymer', 0, 0.45, 1.3, 0.35); // kabza
  b.marker('muzzle', 0, 0.8, -8);
  b.marker('lefthand', 0, -2, 1);
  return b.done();
}

function grenade(kind: string): THREE.Group {
  const b = new Builder();
  const col: MatKey = kind === 'hegrenade' ? 'olive' : kind === 'flashbang' ? 'steel' : kind === 'smokegrenade' ? 'green' : kind === 'incgrenade' ? 'red' : kind === 'decoy' ? 'tan' : 'glass';
  if (kind === 'molotov') {
    b.tube(1.25, 1.5, -2.5, 'glass', 0, 0, b.root, 1.25, 16);
    b.tube(0.45, -2.5, -4.8, 'glass', 0, 0, b.root, 0.4, 12);
    b.box(0.9, 0.9, 1.6, 'cloth', 0, 0, -5.4, 0.3);
    b.root.rotation.x = -Math.PI / 2;
  } else if (kind === 'hegrenade') {
    const s = new THREE.Mesh(new THREE.SphereGeometry(1.3, 16, 12), mats.olive);
    s.scale.set(1, 1.15, 1);
    b.root.add(s);
    b.tube(0.45, 0, 0.9, 'steel', 0, 1.4);
    b.box(0.25, 2.2, 0.6, 'steel', 0.6, 0.6, 0.2, 0.05);
  } else {
    const g = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.05, 4.2, 16), mats[col]);
    b.root.add(g);
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.6, 0.8, 12), mats.steel);
    top.position.y = 2.4;
    b.root.add(top);
    b.box(0.25, 2.6, 0.5, 'steel', 0.75, 1.2, 0, 0.05);
    if (kind === 'decoy' || kind === 'flashbang') {
      for (const y of [-1.2, 0, 1.2]) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(1.07, 0.08, 6, 20), mats.black);
        ring.rotation.x = Math.PI / 2;
        ring.position.y = y;
        b.root.add(ring);
      }
    }
  }
  b.marker('muzzle', 0, 0, -2);
  b.marker('lefthand', 0, 1.5, 0.5);
  return b.done();
}

function c4(): THREE.Group {
  const b = new Builder();
  b.box(4.2, 2.2, 6.8, 'c4', 0, 0, 0, 0.25);
  b.box(2.6, 0.5, 2.8, 'black', 0, 1.25, 0.6, 0.1);
  b.box(2.0, 0.3, 1.0, 'screen', 0, 1.55, -0.3, 0.05);
  for (let i = 0; i < 9; i++) b.box(0.5, 0.2, 0.45, 'steel', -0.65 + (i % 3) * 0.65, 1.55, 0.6 + Math.floor(i / 3) * 0.55, 0.05);
  b.tube(0.12, -3.4, 3.4, 'red', 1.5, 1.1);
  b.tube(0.12, -3.4, 3.4, 'blue', -1.5, 1.1);
  b.box(4.4, 0.3, 0.6, 'black', 0, 0, 2.2, 0.05);
  b.box(4.4, 0.3, 0.6, 'black', 0, 0, -2.2, 0.05);
  b.marker('muzzle', 0, 1, -3);
  b.marker('lefthand', -1.5, 0, 0);
  return b.done();
}

const builders: Record<string, () => THREE.Group> = {
  ak47: () => ak(false),
  galilar: () => ak(true),
  m4a1: () => m4(false),
  m4a1_silencer: () => m4(true),
  famas: () => famas(),
  aug: () => aug(),
  sg556: () => sg553(),
  awp: () => sniper('awp'),
  ssg08: () => sniper('ssg08'),
  g3sg1: () => sniper('g3sg1'),
  scar20: () => sniper('scar20'),
  mac10: () => smg('mac10'),
  mp9: () => smg('mp9'),
  mp7: () => smg('mp7'),
  mp5sd: () => smg('mp5sd'),
  ump45: () => smg('ump45'),
  p90: () => smg('p90'),
  bizon: () => smg('bizon'),
  nova: () => shotgun('nova'),
  xm1014: () => shotgun('xm1014'),
  sawedoff: () => shotgun('sawedoff'),
  mag7: () => shotgun('mag7'),
  m249: () => lmg('m249'),
  negev: () => lmg('negev'),
  glock: () => pistol('glock'),
  usp_silencer: () => pistol('usp_silencer'),
  hkp2000: () => pistol('hkp2000'),
  p250: () => pistol('p250'),
  tec9: () => pistol('tec9'),
  fiveseven: () => pistol('fiveseven'),
  cz75a: () => pistol('cz75a'),
  deagle: () => pistol('deagle'),
  knife: () => knife(),
  c4: () => c4(),
  hegrenade: () => grenade('hegrenade'),
  flashbang: () => grenade('flashbang'),
  smokegrenade: () => grenade('smokegrenade'),
  molotov: () => grenade('molotov'),
  incgrenade: () => grenade('incgrenade'),
  decoy: () => grenade('decoy'),
};

const protoCache = new Map<string, THREE.Group>();

/** Silah modelinin bir kopyası (geometri/materyal paylaşılır). */
export function weaponModel(key: string): THREE.Group {
  let proto = protoCache.get(key);
  if (!proto) {
    proto = (builders[key] ?? builders['knife']!)();
    protoCache.set(key, proto);
  }
  const clone = proto.clone(true);
  return clone;
}

export function findPart(root: THREE.Object3D, name: string): THREE.Object3D | null {
  return root.getObjectByName(name) ?? null;
}

/** Susturucu parçası var mı ve görünürlüğünü ayarla (USP-S/M4A1-S). */
export function setSilencerVisible(root: THREE.Object3D, visible: boolean, key: string) {
  if (key !== 'usp_silencer' && key !== 'm4a1_silencer') return;
  // susturucu: en uzun ve en öndeki tüp
  root.traverse((o) => {
    if (o.userData['silencer']) o.visible = visible;
  });
}

export const weaponMats = mats;

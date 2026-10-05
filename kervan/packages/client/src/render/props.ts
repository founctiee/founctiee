/** Harita süslemeleri: lambalar, tenteler, bez afişler, palmiyeler, saksılar, pencereler, A işareti. */
import * as THREE from 'three';
import { MapDef, MapProp, DEG2RAD } from '@kervan/shared';

function letterTexture(text: string, color = '#9a2b1d'): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, 256, 256);
  g.fillStyle = color;
  g.font = 'bold 210px Impact, "Arial Black", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.globalAlpha = 0.88;
  g.fillText(text, 128, 140);
  // boya akıntıları
  g.globalAlpha = 0.5;
  for (let i = 0; i < 6; i++) g.fillRect(70 + Math.random() * 110, 200 + Math.random() * 10, 3, 20 + Math.random() * 30);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function arrowTexture(text: string): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#f1e3c4';
  g.fillRect(0, 0, 512, 256);
  g.strokeStyle = '#3b2f22';
  g.lineWidth = 10;
  g.strokeRect(8, 8, 496, 240);
  g.fillStyle = '#3b2f22';
  g.font = 'bold 96px "Arial Black", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 256, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Sim koordinatından three konumu. */
function pos3(p: { x: number; y: number; z: number }) {
  return new THREE.Vector3(p.x, p.z, -p.y);
}

export function buildProps(map: MapDef, scene: THREE.Scene, quality: string): THREE.Group {
  const g = new THREE.Group();
  g.name = 'props';
  const lampMat = new THREE.MeshStandardMaterial({ color: 0xffd9a0, emissive: 0xffb764, emissiveIntensity: 3 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x2f2a25, roughness: 0.6, metalness: 0.6 });
  let lights = 0;
  for (const p of map.props) {
    const at = pos3(p.pos);
    switch (p.kind) {
      case 'lamp': {
        const bulb = new THREE.Mesh(new THREE.SphereGeometry(3, 10, 8), lampMat);
        bulb.position.copy(at);
        const cage = new THREE.Mesh(new THREE.CylinderGeometry(4.5, 3, 5, 8, 1, true), metal);
        cage.position.copy(at).add(new THREE.Vector3(0, 3, 0));
        const wire = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 10), metal);
        wire.position.copy(at).add(new THREE.Vector3(0, 9, 0));
        g.add(bulb, cage, wire);
        if (quality !== 'low' && lights < 6) {
          const l = new THREE.PointLight(0xffc27a, 9000, 520, 1.8);
          l.position.copy(at).add(new THREE.Vector3(0, -4, 0));
          g.add(l);
          lights++;
        }
        break;
      }
      case 'awning': {
        const s = p.size ?? { x: 60, y: 160, z: 8 };
        const geo = new THREE.BoxGeometry(s.x, 2, s.y);
        const mat = new THREE.MeshStandardMaterial({ color: p.color ?? 0x9a3b2c, roughness: 0.95, side: THREE.DoubleSide });
        const m = new THREE.Mesh(geo, mat);
        m.position.copy(at);
        m.rotation.y = (p.yaw ?? 0) * DEG2RAD;
        m.rotateZ(-0.35);
        m.translateX(s.x / 2);
        m.castShadow = true;
        m.receiveShadow = true;
        // çizgili kenar
        const stripe = new THREE.Mesh(new THREE.BoxGeometry(2, 8, s.y), new THREE.MeshStandardMaterial({ color: 0xe8dcc0, roughness: 0.95 }));
        stripe.position.set(s.x / 2, -4, 0);
        m.add(stripe);
        g.add(m);
        break;
      }
      case 'cloth': {
        const len = p.size?.x ?? 250;
        const geo = new THREE.PlaneGeometry(len, 40, 16, 2);
        const pa = geo.attributes['position'] as THREE.BufferAttribute;
        for (let i = 0; i < pa.count; i++) {
          const x = pa.getX(i);
          const sag = -Math.cos((x / len) * Math.PI) * 0 + (1 - Math.pow((2 * x) / len, 2)) * -26;
          pa.setY(i, pa.getY(i) + sag);
        }
        geo.computeVertexNormals();
        const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: p.color ?? 0xb2452f, roughness: 0.95, side: THREE.DoubleSide }));
        m.position.copy(at);
        m.rotation.y = (p.yaw ?? 90) * DEG2RAD;
        m.castShadow = true;
        g.add(m);
        break;
      }
      case 'palm': {
        const trunkMat = new THREE.MeshStandardMaterial({ color: 0x7a5a3a, roughness: 0.95 });
        const leafMat = new THREE.MeshStandardMaterial({ color: 0x4c6b2c, roughness: 0.8, side: THREE.DoubleSide });
        const segs = 8;
        let prev = at.clone();
        for (let i = 0; i < segs; i++) {
          const next = at.clone().add(new THREE.Vector3(Math.sin(i * 0.25) * 10, (i + 1) * 30, 0));
          const seg = new THREE.Mesh(new THREE.CylinderGeometry(5 - i * 0.3, 6 - i * 0.3, 32, 8), trunkMat);
          seg.position.copy(prev).lerp(next, 0.5);
          seg.lookAt(next);
          seg.rotateX(Math.PI / 2);
          seg.castShadow = true;
          g.add(seg);
          prev = next;
        }
        for (let k = 0; k < 8; k++) {
          const leaf = new THREE.Mesh(new THREE.PlaneGeometry(90, 18, 6, 1), leafMat);
          const la = leaf.geometry.attributes['position'] as THREE.BufferAttribute;
          for (let i = 0; i < la.count; i++) {
            const x = la.getX(i) + 45;
            la.setY(i, la.getY(i) * (1 - x / 100) - (x * x) / 260);
            la.setX(i, x);
          }
          leaf.geometry.computeVertexNormals();
          leaf.position.copy(prev);
          leaf.rotation.y = (k / 8) * Math.PI * 2;
          leaf.rotateX(-Math.PI / 2 + 0.2);
          leaf.castShadow = true;
          g.add(leaf);
        }
        break;
      }
      case 'pot': {
        const pts: THREE.Vector2[] = [];
        for (let i = 0; i <= 12; i++) {
          const t = i / 12;
          pts.push(new THREE.Vector2(6 + Math.sin(t * Math.PI) * 9 - t * 3, t * 34));
        }
        const m = new THREE.Mesh(new THREE.LatheGeometry(pts, 16), new THREE.MeshStandardMaterial({ color: 0xb06a43, roughness: 0.85 }));
        m.position.copy(at);
        m.castShadow = true;
        m.receiveShadow = true;
        g.add(m);
        break;
      }
      case 'window': {
        const frame = new THREE.Mesh(new THREE.BoxGeometry(46, 64, 4), new THREE.MeshStandardMaterial({ color: 0x5a3a22, roughness: 0.8 }));
        const glass = new THREE.Mesh(new THREE.PlaneGeometry(38, 56), new THREE.MeshStandardMaterial({ color: 0x1d1a16, roughness: 0.3, metalness: 0.2 }));
        frame.position.copy(at);
        frame.rotation.y = ((p.yaw ?? 0) + 90) * DEG2RAD;
        glass.position.set(0, 0, 2.2);
        frame.add(glass);
        const bar = new THREE.Mesh(new THREE.BoxGeometry(2, 56, 1), frame.material);
        bar.position.set(0, 0, 2.6);
        frame.add(bar);
        g.add(frame);
        break;
      }
      case 'sign': {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(80, 40), new THREE.MeshStandardMaterial({ map: arrowTexture('A →'), roughness: 0.9 }));
        m.position.copy(at);
        m.rotation.y = ((p.yaw ?? 0) + 90) * DEG2RAD;
        g.add(m);
        break;
      }
      case 'bombsite_a': {
        const m = new THREE.Mesh(
          new THREE.PlaneGeometry(150, 150),
          new THREE.MeshStandardMaterial({ map: letterTexture('A'), transparent: true, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -2 }),
        );
        m.position.copy(at);
        m.rotation.y = ((p.yaw ?? 0) + 90) * DEG2RAD;
        g.add(m);
        break;
      }
    }
  }
  scene.add(g);
  return g;
}

export type { MapProp };

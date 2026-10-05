/** Yüzey materyalleri: penetrasyon, ayak sesi ve görsel için. */
export enum Mat {
  Concrete = 0,
  Plaster = 1,
  Stone = 2,
  Sand = 3,
  Wood = 4,
  Metal = 5,
  MetalThin = 6,
  Brick = 7,
  Tile = 8,
  Glass = 9,
  Cardboard = 10,
  Clip = 11,
  Fabric = 12,
  Dirt = 13,
}

export interface MaterialInfo {
  name: string;
  /** CS surfaceprop penetrationmodifier (büyük = kolay delinir). */
  penetration: number;
  /** Ayak sesi tipi. */
  step: 'concrete' | 'sand' | 'wood' | 'metal' | 'tile' | 'dirt' | 'glass' | 'fabric';
  /** Mermi izi tipi. */
  impact: 'concrete' | 'wood' | 'metal' | 'sand' | 'glass';
}

export const MATERIALS: Record<number, MaterialInfo> = {
  [Mat.Concrete]: { name: 'concrete', penetration: 0.5, step: 'concrete', impact: 'concrete' },
  [Mat.Plaster]: { name: 'plaster', penetration: 0.6, step: 'concrete', impact: 'concrete' },
  [Mat.Stone]: { name: 'stone', penetration: 0.5, step: 'concrete', impact: 'concrete' },
  [Mat.Sand]: { name: 'sand', penetration: 0.3, step: 'sand', impact: 'sand' },
  [Mat.Wood]: { name: 'wood', penetration: 1.0, step: 'wood', impact: 'wood' },
  [Mat.Metal]: { name: 'metal', penetration: 0.5, step: 'metal', impact: 'metal' },
  [Mat.MetalThin]: { name: 'metal_thin', penetration: 1.0, step: 'metal', impact: 'metal' },
  [Mat.Brick]: { name: 'brick', penetration: 0.5, step: 'concrete', impact: 'concrete' },
  [Mat.Tile]: { name: 'tile', penetration: 0.6, step: 'tile', impact: 'concrete' },
  [Mat.Glass]: { name: 'glass', penetration: 0.99, step: 'glass', impact: 'glass' },
  [Mat.Cardboard]: { name: 'cardboard', penetration: 2.0, step: 'wood', impact: 'wood' },
  [Mat.Clip]: { name: 'clip', penetration: 1.0, step: 'concrete', impact: 'concrete' },
  [Mat.Fabric]: { name: 'fabric', penetration: 1.0, step: 'fabric', impact: 'wood' },
  [Mat.Dirt]: { name: 'dirt', penetration: 0.6, step: 'dirt', impact: 'sand' },
};

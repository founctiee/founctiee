declare module 'n8ao' {
  import type { Scene, Camera, Color } from 'three';
  export class N8AOPostPass {
    constructor(scene: Scene, camera: Camera, width?: number, height?: number);
    configuration: {
      aoRadius: number;
      distanceFalloff: number;
      intensity: number;
      aoSamples: number;
      denoiseSamples: number;
      denoiseRadius: number;
      halfRes: boolean;
      color: Color;
      gammaCorrection: boolean;
      screenSpaceRadius: boolean;
      [k: string]: unknown;
    };
    setSize(w: number, h: number): void;
  }
  export class N8AOPass extends N8AOPostPass {}
}

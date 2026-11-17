import type { RGB, Surface } from '../sim/surface';

/** raw RGBA pixel arrays for a baked planet surface (equirectangular) */
export interface BakedArrays {
  map: Uint8ClampedArray;
  bump?: Uint8ClampedArray;
  emissive?: Uint8ClampedArray;
  rough?: Uint8ClampedArray;
}

/**
 * Bake a procedural equirectangular albedo (+ bump / emissive / roughness) image from a body's
 * Surface on the CPU. No DOM access, so it also runs in a Web Worker.
 */
export function bakeArrays(surface: Surface, w: number, h: number): BakedArrays {
  const n = w * h * 4;
  const gas = surface.type === 'gas' || surface.type === 'icegiant';
  const lava = surface.type === 'lava';
  const map = new Uint8ClampedArray(n);
  const bump = !gas && surface.rel > 0 ? new Uint8ClampedArray(n) : undefined;
  const emissive = lava ? new Uint8ClampedArray(n) : undefined;
  const rough = surface.hasLiquid && !lava ? new Uint8ClampedArray(n) : undefined;
  const mw = Math.PI / h;
  const col: RGB = [0, 0, 0];
  const hScale = surface.rel * surface.R * 2.4 || 1;
  for (let y = 0; y < h; y++) {
    const theta = (y + 0.5) / h * Math.PI;
    const st = Math.sin(theta), ct = Math.cos(theta);
    for (let x = 0; x < w; x++) {
      const phi = (x + 0.5) / w * 2 * Math.PI;
      const dx = -Math.cos(phi) * st, dy = ct, dz = Math.sin(phi) * st;
      const hh = gas ? 0 : surface.height(dx, dy, dz, mw);
      surface.color(dx, dy, dz, hh, mw, col);
      const i = (y * w + x) * 4;
      map[i] = col[0] * 255; map[i + 1] = col[1] * 255; map[i + 2] = col[2] * 255; map[i + 3] = 255;
      if (bump) { const v = 128 + hh / hScale * 255; bump[i] = bump[i + 1] = bump[i + 2] = v; bump[i + 3] = 255; }
      if (rough) { const v = surface.isLiquid(dx, dy, dz, hh) ? 70 : 245; rough[i] = rough[i + 1] = rough[i + 2] = v; rough[i + 3] = 255; }
      if (emissive) {
        const g = surface.glow(dx, dy, dz, hh, mw);
        emissive[i] = 255 * g; emissive[i + 1] = 110 * g; emissive[i + 2] = 30 * g; emissive[i + 3] = 255;
      }
    }
  }
  return { map, bump, emissive, rough };
}

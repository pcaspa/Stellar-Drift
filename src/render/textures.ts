import { CanvasTexture, LinearMipmapLinearFilter, RepeatWrapping, SRGBColorSpace, Texture, TextureLoader } from 'three';
import { LandMask, Surface } from '../sim/surface';
import { bakeArrays, type BakedArrays } from './bake';

const loader = new TextureLoader();
/** planet maps live in /textures at the site root; the game page itself is in /play/ */
const TEX_ROOT = import.meta.env.DEV ? '/textures/' : new URL('../textures/', import.meta.url).href;
const cache = new Map<string, Promise<Texture | null>>();

/** load from /textures; resolves null if the file is missing so callers can fall back to procedural */
export function loadTexture(name: string, srgb = true): Promise<Texture | null> {
  let p = cache.get(name);
  if (!p) {
    p = new Promise(resolve => {
      loader.load(TEX_ROOT + name, tex => {
        if (srgb) tex.colorSpace = SRGBColorSpace;
        tex.wrapS = RepeatWrapping;
        tex.anisotropy = 8;
        tex.minFilter = LinearMipmapLinearFilter;
        resolve(tex);
      }, undefined, () => resolve(null));
    });
    cache.set(name, p);
  }
  return p;
}

function canvasTexture(c: HTMLCanvasElement, srgb: boolean): CanvasTexture {
  const t = new CanvasTexture(c);
  if (srgb) t.colorSpace = SRGBColorSpace;
  t.wrapS = RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

export interface Baked { map: CanvasTexture; bump?: CanvasTexture; emissive?: CanvasTexture; rough?: CanvasTexture; }

/** turn baked pixel arrays into textures (albedo and emissive in sRGB) */
export function texturesFromArrays(a: BakedArrays, w: number, h: number): Baked {
  const tex = (data: Uint8ClampedArray, srgb: boolean) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    c.getContext('2d')!.putImageData(new ImageData(data as Uint8ClampedArray<ArrayBuffer>, w, h), 0, 0);
    return canvasTexture(c, srgb);
  };
  const out: Baked = { map: tex(a.map, true) };
  if (a.bump) out.bump = tex(a.bump, false);
  if (a.emissive) out.emissive = tex(a.emissive, true);
  if (a.rough) out.rough = tex(a.rough, false);
  return out;
}

/** bake a procedural equirectangular albedo (+ bump / emissive) texture on the CPU (main thread) */
export function bakeSurface(surface: Surface, w: number, h: number): Baked {
  return texturesFromArrays(bakeArrays(surface, w, h), w, h);
}

/** derive a land/water mask from Earth's day map so terrain follows real coastlines */
export function buildLandMask(tex: Texture, w = 1440, h = 720): LandMask {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(tex.image as CanvasImageSource, 0, 0, w, h);
  const px = ctx.getImageData(0, 0, w, h).data;
  const raw = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const r = px[i * 4], g = px[i * 4 + 1], b = px[i * 4 + 2];
    const water = b > r * 1.25 && b > g * 1.02 && r < 90;
    raw[i] = water ? 0 : 1;
  }
  // small box blur to soften coastlines
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const yy = Math.min(h - 1, Math.max(0, y + dy)), xx = (x + dx + w) % w;
      s += raw[yy * w + xx];
    }
    out[y * w + x] = s / 9;
  }
  return new LandMask(w, h, out);
}

/** soft radial glow sprite texture */
export function glowTexture(size = 256, power = 2.2): CanvasTexture {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = (x + 0.5) / size * 2 - 1, dy = (y + 0.5) / size * 2 - 1;
    const d = Math.sqrt(dx * dx + dy * dy);
    const v = Math.pow(Math.max(0, 1 - d), power);
    const core = Math.exp(-d * d * 60);
    const a = Math.min(1, v * 0.6 + core);
    const i = (y * size + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = 255; img.data[i + 3] = a * 255;
  }
  ctx.putImageData(img, 0, 0);
  return new CanvasTexture(c);
}

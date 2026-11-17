import {
  CanvasTexture, Color, DoubleSide, MeshPhysicalMaterial, MeshStandardMaterial, RepeatWrapping, SRGBColorSpace, Texture, Vector2,
} from 'three';

/**
 * Procedural PBR textures for spacecraft: panelled hull plating with weathering, crinkled
 * multi-layer insulation (gold foil), radiators, solar cells and lit windows. Everything is
 * generated on canvases once and shared.
 */

function rng(seed: number) {
  return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
}
function canvas(w: number, h: number) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  return { c, ctx: c.getContext('2d')! };
}
function tex(c: HTMLCanvasElement, srgb: boolean, repeat = 1): CanvasTexture {
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 8;
  if (srgb) t.colorSpace = SRGBColorSpace;
  return t;
}

/** convert a greyscale height canvas into a tangent-space normal map */
function heightToNormal(src: HTMLCanvasElement, strength: number): HTMLCanvasElement {
  const w = src.width, h = src.height;
  const s = src.getContext('2d')!.getImageData(0, 0, w, h).data;
  const { c, ctx } = canvas(w, h);
  const img = ctx.createImageData(w, h);
  const H = (x: number, y: number) => s[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = (H(x + 1, y) - H(x - 1, y)) * strength;
    const dy = (H(x, y + 1) - H(x, y - 1)) * strength;
    const l = Math.sqrt(dx * dx + dy * dy + 1);
    const i = (y * w + x) * 4;
    img.data[i] = (-dx / l * 0.5 + 0.5) * 255;
    img.data[i + 1] = (dy / l * 0.5 + 0.5) * 255;
    img.data[i + 2] = (1 / l * 0.5 + 0.5) * 255;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

interface HullSet { map: Texture; normal: Texture; rough: Texture; }
const hullCache = new Map<string, HullSet>();

/** panelled hull plating: base paint colour, panel seams, rivets, streaks and grime */
function hullTextures(base: string, seed: number, stripe?: string): HullSet {
  const key = base + seed + (stripe ?? '');
  const hit = hullCache.get(key);
  if (hit) return hit;
  const N = 1024;
  const r = rng(seed);
  const col = canvas(N, N), hgt = canvas(N, N), rough = canvas(N, N);
  const bc = new Color(base);
  const css = (c: Color, k = 1) => `rgb(${Math.round(Math.min(1, c.r * k) * 255)},${Math.round(Math.min(1, c.g * k) * 255)},${Math.round(Math.min(1, c.b * k) * 255)})`;
  col.ctx.fillStyle = css(bc); col.ctx.fillRect(0, 0, N, N);
  hgt.ctx.fillStyle = '#808080'; hgt.ctx.fillRect(0, 0, N, N);
  rough.ctx.fillStyle = 'rgb(110,110,110)'; rough.ctx.fillRect(0, 0, N, N);
  // panels: recursive subdivision gives a convincing irregular plate layout
  const panels: [number, number, number, number][] = [];
  const split = (x: number, y: number, w: number, h: number, d: number) => {
    if (d > 4 || (d > 1 && r() < 0.28) || w < 60 || h < 60) { panels.push([x, y, w, h]); return; }
    if (w > h ? r() < 0.8 : r() < 0.2) { const k = Math.round(w * (0.3 + 0.4 * r())); split(x, y, k, h, d + 1); split(x + k, y, w - k, h, d + 1); }
    else { const k = Math.round(h * (0.3 + 0.4 * r())); split(x, y, w, k, d + 1); split(x, y + k, w, h - k, d + 1); }
  };
  split(0, 0, N, N, 0);
  for (const [x, y, w, h] of panels) {
    const tint = 0.92 + r() * 0.12;
    col.ctx.fillStyle = css(bc, tint); col.ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
    const rr = 90 + r() * 60;
    rough.ctx.fillStyle = `rgb(${rr},${rr},${rr})`; rough.ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
    // seams
    col.ctx.strokeStyle = css(bc, 0.42); col.ctx.lineWidth = 3; col.ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    hgt.ctx.strokeStyle = '#202020'; hgt.ctx.lineWidth = 4; hgt.ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    // rivet rows on some panels
    if (r() < 0.45) {
      hgt.ctx.fillStyle = '#c0c0c0'; col.ctx.fillStyle = css(bc, 0.8);
      const step = 14;
      for (let k = x + 8; k < x + w - 6; k += step) {
        hgt.ctx.fillRect(k, y + 6, 3, 3); hgt.ctx.fillRect(k, y + h - 9, 3, 3);
        col.ctx.fillRect(k, y + 6, 2, 2); col.ctx.fillRect(k, y + h - 9, 2, 2);
      }
    }
    // access hatches
    if (r() < 0.12 && w > 90 && h > 90) {
      const hw = 30 + r() * 30, hh = 20 + r() * 30, hx = x + 10 + r() * (w - hw - 20), hy = y + 10 + r() * (h - hh - 20);
      hgt.ctx.strokeStyle = '#404040'; hgt.ctx.lineWidth = 2; hgt.ctx.strokeRect(hx, hy, hw, hh);
      col.ctx.strokeStyle = css(bc, 0.6); col.ctx.lineWidth = 1.5; col.ctx.strokeRect(hx, hy, hw, hh);
    }
  }
  if (stripe) {
    col.ctx.fillStyle = stripe;
    col.ctx.fillRect(0, N * 0.46, N, N * 0.035);
    col.ctx.fillRect(0, N * 0.505, N, N * 0.01);
  }
  // weathering: streaks and grime
  for (let i = 0; i < 260; i++) {
    const x = r() * N, y = r() * N, len = 20 + r() * 160;
    const g = col.ctx.createLinearGradient(x, y, x, y + len);
    const a = 0.03 + r() * 0.07;
    g.addColorStop(0, `rgba(40,35,30,${a})`); g.addColorStop(1, 'rgba(40,35,30,0)');
    col.ctx.fillStyle = g; col.ctx.fillRect(x, y, 2 + r() * 6, len);
  }
  for (let i = 0; i < 1800; i++) {
    const x = r() * N, y = r() * N, s = 1 + r() * 3;
    col.ctx.fillStyle = `rgba(${r() < 0.5 ? '255,255,255' : '0,0,0'},${0.02 + r() * 0.04})`;
    col.ctx.fillRect(x, y, s, s);
  }
  const out: HullSet = {
    map: tex(col.c, true), normal: tex(heightToNormal(hgt.c, 2.5), false), rough: tex(rough.c, false),
  };
  hullCache.set(key, out);
  return out;
}

let foilSet: { map: Texture; normal: Texture } | null = null;
/** crinkled multi-layer insulation (gold kapton) */
function foilTextures() {
  if (foilSet) return foilSet;
  const N = 512, r = rng(99);
  const col = canvas(N, N), hgt = canvas(N, N);
  col.ctx.fillStyle = '#c8962e'; col.ctx.fillRect(0, 0, N, N);
  hgt.ctx.fillStyle = '#808080'; hgt.ctx.fillRect(0, 0, N, N);
  for (let i = 0; i < 900; i++) {
    const x = r() * N, y = r() * N, a = r() * Math.PI, l = 20 + r() * 90;
    const v = Math.round(60 + r() * 140);
    hgt.ctx.strokeStyle = `rgba(${v},${v},${v},0.55)`; hgt.ctx.lineWidth = 1 + r() * 5;
    hgt.ctx.beginPath(); hgt.ctx.moveTo(x, y); hgt.ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); hgt.ctx.stroke();
    const c = r();
    col.ctx.strokeStyle = c < 0.5 ? `rgba(255,215,120,${0.1 + r() * 0.2})` : `rgba(120,70,10,${0.1 + r() * 0.2})`;
    col.ctx.lineWidth = 1 + r() * 4;
    col.ctx.beginPath(); col.ctx.moveTo(x, y); col.ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); col.ctx.stroke();
  }
  // taped seams
  col.ctx.fillStyle = 'rgba(230,190,90,0.6)';
  for (let k = 0; k < 4; k++) col.ctx.fillRect(0, k * N / 4, N, 6);
  foilSet = { map: tex(col.c, true), normal: tex(heightToNormal(hgt.c, 4), false) };
  return foilSet;
}

let radSet: Texture | null = null;
function radiatorTexture() {
  if (radSet) return radSet;
  const { c, ctx } = canvas(256, 256);
  ctx.fillStyle = '#e9ecef'; ctx.fillRect(0, 0, 256, 256);
  for (let x = 0; x < 256; x += 16) { ctx.fillStyle = '#b9c0c8'; ctx.fillRect(x, 0, 3, 256); }
  ctx.fillStyle = '#9aa3ad'; ctx.fillRect(0, 0, 256, 6); ctx.fillRect(0, 250, 256, 6);
  return radSet = tex(c, true);
}

let solarSet: Texture | null = null;
function solarTexture() {
  if (solarSet) return solarSet;
  const { c, ctx } = canvas(512, 512);
  ctx.fillStyle = '#0b1530'; ctx.fillRect(0, 0, 512, 512);
  const r = rng(7);
  for (let y = 0; y < 512; y += 32) for (let x = 0; x < 512; x += 32) {
    const v = 0.85 + r() * 0.3;
    ctx.fillStyle = `rgb(${Math.round(18 * v)},${Math.round(36 * v)},${Math.round(82 * v)})`;
    ctx.fillRect(x + 1.5, y + 1.5, 29, 29);
    ctx.fillStyle = 'rgba(160,180,220,0.25)';
    for (let k = 4; k < 30; k += 6) ctx.fillRect(x + k, y + 2, 0.8, 28);
  }
  ctx.fillStyle = '#c9ccd2'; ctx.fillRect(0, 0, 512, 3); ctx.fillRect(0, 509, 512, 3);
  return solarSet = tex(c, true);
}

let windowSet: { map: Texture; emissive: Texture } | null = null;
/** rows of habitat windows, some lit */
function windowTextures() {
  if (windowSet) return windowSet;
  const N = 512, r = rng(31);
  const col = canvas(N, N), em = canvas(N, N);
  col.ctx.fillStyle = '#d9dde3'; col.ctx.fillRect(0, 0, N, N);
  em.ctx.fillStyle = '#000'; em.ctx.fillRect(0, 0, N, N);
  for (let y = 40; y < N; y += 64) for (let x = 6; x < N; x += 22) {
    col.ctx.fillStyle = '#10161f'; col.ctx.fillRect(x, y, 12, 18);
    if (r() < 0.55) {
      const w = r() < 0.2 ? '#bfe0ff' : '#ffd9a0';
      em.ctx.fillStyle = w; em.ctx.fillRect(x + 1, y + 1, 10, 16);
    }
  }
  windowSet = { map: tex(col.c, true), emissive: tex(em.c, true) };
  return windowSet;
}

export interface ShipMaterials {
  hull: MeshStandardMaterial;
  hull2: MeshStandardMaterial;
  dark: MeshStandardMaterial;
  metal: MeshStandardMaterial;
  foil: MeshStandardMaterial;
  radiator: MeshStandardMaterial;
  solar: MeshPhysicalMaterial;
  glass: MeshPhysicalMaterial;
  windows: MeshStandardMaterial;
  nozzle: MeshStandardMaterial;
  accent: MeshStandardMaterial;
  container: MeshStandardMaterial[];
}

/** a material set with a livery; `scale` = texture tiles per metre-ish */
export function makeMaterials(paint: string, secondary: string, stripe: string, seed: number, texScale = 0.08): ShipMaterials {
  const h = hullTextures(paint, seed, stripe);
  const h2 = hullTextures(secondary, seed + 1);
  const rep = (t: Texture, k: number) => { const c = t.clone(); c.repeat.set(k, k); c.needsUpdate = true; return c; };
  const hull = new MeshStandardMaterial({
    map: h.map, normalMap: h.normal, roughnessMap: h.rough, roughness: 1, metalness: 0.15, normalScale: new Vector2(0.8, 0.8),
  });
  const hull2 = new MeshStandardMaterial({
    map: h2.map, normalMap: h2.normal, roughnessMap: h2.rough, roughness: 1, metalness: 0.25, normalScale: new Vector2(0.8, 0.8),
  });
  const dark = new MeshStandardMaterial({ color: '#2b2f36', roughness: 0.55, metalness: 0.7, normalMap: h2.normal, normalScale: new Vector2(0.5, 0.5) });
  const metal = new MeshStandardMaterial({ color: '#a9adb3', roughness: 0.35, metalness: 1.0 });
  const f = foilTextures();
  const foil = new MeshStandardMaterial({ map: f.map, normalMap: f.normal, roughness: 0.28, metalness: 1.0, normalScale: new Vector2(1.2, 1.2) });
  const radiator = new MeshStandardMaterial({ map: radiatorTexture(), roughness: 0.45, metalness: 0.2, side: DoubleSide });
  const solar = new MeshPhysicalMaterial({ map: solarTexture(), roughness: 0.25, metalness: 0.4, clearcoat: 1, clearcoatRoughness: 0.08, side: DoubleSide });
  const glass = new MeshPhysicalMaterial({ color: '#0a1220', roughness: 0.05, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.02, emissive: '#0d2a40', emissiveIntensity: 0.4 });
  const w = windowTextures();
  const windows = new MeshStandardMaterial({ map: w.map, emissiveMap: w.emissive, emissive: '#ffffff', emissiveIntensity: 2.2, roughness: 0.5, metalness: 0.2 });
  const nozzle = new MeshStandardMaterial({ color: '#4a4440', roughness: 0.4, metalness: 1.0, emissive: '#6aa8ff', emissiveIntensity: 0, side: DoubleSide });
  const accent = new MeshStandardMaterial({ color: stripe, roughness: 0.4, metalness: 0.3 });
  const containerColors = ['#b8452f', '#2f5fa8', '#d9a520', '#3f7a4a', '#8a8f96', '#c86a24'];
  const container = containerColors.map((c, i) => {
    const t = hullTextures(c, 500 + i);
    return new MeshStandardMaterial({ map: rep(t.map, 0.5), normalMap: rep(t.normal, 0.5), roughnessMap: t.rough, roughness: 1, metalness: 0.35 });
  });
  void texScale;
  return { hull, hull2, dark, metal, foil, radiator, solar, glass, windows, nozzle, accent, container };
}

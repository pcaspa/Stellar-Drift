import { BodyDef, SurfaceType } from '../data/types';
import { Noise, clamp, lerp, smoothstep } from './noise';

export type RGB = [number, number, number];

function hex(h: string): RGB {
  const n = parseInt(h.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
function mix(a: RGB, b: RGB, t: number, out: RGB): RGB {
  out[0] = a[0] + (b[0] - a[0]) * t; out[1] = a[1] + (b[1] - a[1]) * t; out[2] = a[2] + (b[2] - a[2]) * t;
  return out;
}
function strHash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) / 4294967296;
}

/** Equirectangular land mask sampled on the CPU (used so Earth's terrain follows its real coastlines). */
export class LandMask {
  constructor(public w: number, public h: number, public data: Float32Array) {}
  sample(x: number, y: number, z: number): number {
    let u = Math.atan2(z, -x) / (2 * Math.PI); if (u < 0) u += 1;
    const v = Math.acos(clamp(y, -1, 1)) / Math.PI;
    const fx = u * this.w - 0.5, fy = clamp(v * this.h - 0.5, 0, this.h - 1.001);
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = fx - x0, ty = fy - y0;
    const xa = ((x0 % this.w) + this.w) % this.w, xb = (xa + 1) % this.w;
    const d = this.data, w = this.w;
    const a = d[y0 * w + xa], b = d[y0 * w + xb], c = d[(y0 + 1) * w + xa], e = d[(y0 + 1) * w + xb];
    return lerp(lerp(a, b, tx), lerp(c, e, tx), ty);
  }
}

const TMP: RGB = [0, 0, 0];

export class Surface {
  readonly type: SurfaceType;
  readonly noise: Noise;
  readonly pal: RGB[];
  /** body radius, m */
  readonly R: number;
  /** relief amplitude as a fraction of radius */
  readonly rel: number;
  readonly oct: number;
  readonly craterScales: number;
  private ox: number; private oy: number; private oz: number;
  landMask?: LandMask;
  readonly hasLiquid: boolean;
  /** body has a real photographic map */
  readonly photo: boolean;

  constructor(public def: BodyDef) {
    this.type = def.surface;
    const seed = strHash(def.id);
    this.noise = new Noise(seed);
    this.pal = def.palette.map(hex);
    while (this.pal.length < 4) this.pal.push(this.pal[this.pal.length - 1]);
    this.R = def.radius * 1000;
    this.rel = (def.relief ?? 0) * 1000 / this.R;
    this.oct = clamp(Math.round(Math.log2(this.R / 3)), 6, 22);
    this.craterScales = clamp(Math.floor(Math.log(this.R / 120) / Math.log(2.3)), 2, 14);
    this.ox = seed * 91.7; this.oy = seed * 37.3 + 11; this.oz = seed * 53.9 - 7;
    this.photo = !!def.texture;
    this.hasLiquid = this.type === 'earth' || this.type === 'terra' || this.type === 'ocean' || this.type === 'titan' || this.type === 'lava';
  }

  private craterField(x: number, y: number, z: number, mw: number, density: number): number {
    let sum = 0, f = 3;
    for (let k = 0; k < this.craterScales; k++) {
      if (1 / f < mw * 1.5 && k > 0) break;
      // on photo-mapped worlds, leave craters the real map already shows (> ~3 km) to the map
      if (this.photo && this.R * 0.3 / f > 3000) { f *= 2.3; continue; }
      const depth = 0.3 * Math.min(1, Math.pow(f / 90, 0.7));
      sum += this.noise.craters(x * f + k * 3.1, y * f + k * 5.3, z * f - k * 2.7, k * 7, density) / f * depth;
      f *= 2.3;
    }
    return sum;
  }

  /** continent/land factor 0..1 */
  private land(x: number, y: number, z: number, mw: number): number {
    if (this.type === 'earth') return this.landMask ? smoothstep(0.35, 0.65, this.landMask.sample(x, y, z)) : 0;
    const n = this.noise;
    const X = x + this.ox, Y = y + this.oy, Z = z + this.oz;
    const c = n.fbm(X, Y, Z, 1.1, 9, mw) + (this.type === 'ocean' ? -0.42 : -0.06);
    return smoothstep(0, 0.07, c);
  }

  /** terrain height in metres relative to the reference radius. mw = smallest wavelength to include (unit-sphere units). */
  height(x: number, y: number, z: number, mw = 0): number {
    const n = this.noise, o = this.oct, rel = this.rel;
    const X = x + this.ox, Y = y + this.oy, Z = z + this.oz;
    let h = 0;
    switch (this.type) {
      case 'rock':
        h = rel * 0.9 * n.fbm(X, Y, Z, 1.3, o, mw) + this.craterField(x, y, z, mw, 0.75);
        break;
      case 'mars': {
        const m = smoothstep(-0.1, 0.5, n.fbm(X, Y, Z, 0.9, 4, mw));
        h = rel * (0.7 * n.fbm(X, Y, Z, 1.2, o, mw) + 0.9 * m * n.ridged(X, Y, Z, 3, o, mw)) + this.craterField(x, y, z, mw, 0.3);
        break;
      }
      case 'ice': {
        const r = 1 - Math.abs(n.n3(X * 5, Y * 5, Z * 5)); const r2 = 1 - Math.abs(n.n3(X * 13 + 5, Y * 13, Z * 13));
        h = rel * (0.8 * n.fbm(X, Y, Z, 2, o, mw, 0.45) + 0.25 * Math.pow(r, 12) + 0.12 * Math.pow(r2, 12)) + this.craterField(x, y, z, mw, 0.14);
        break;
      }
      case 'io':
        h = rel * (0.7 * n.fbm(X, Y, Z, 1.5, o, mw) + 0.5 * n.ridged(X, Y, Z, 4, o, mw) * smoothstep(0.2, 0.6, n.n3(X * 2, Y * 2, Z * 2))) + this.craterField(x, y, z, mw, 0.12) * 0.6;
        break;
      case 'venus': {
        const m = smoothstep(0.0, 0.5, n.fbm(X, Y, Z, 1.0, 4, mw));
        h = rel * (0.5 * n.fbm(X, Y, Z, 1.6, o, mw) + 1.0 * m * n.ridged(X, Y, Z, 2.5, o, mw));
        break;
      }
      case 'titan': {
        h = rel * (0.8 * n.fbm(X, Y, Z, 1.6, o, mw) + 0.4 * n.ridged(X, Y, Z, 6, o, mw));
        const polar = smoothstep(0.55, 0.85, Math.abs(y));
        const sea = -rel * lerp(0.6, 0.05, polar);
        if (h < sea) h = sea;
        break;
      }
      case 'lava': {
        h = rel * (0.7 * n.fbm(X, Y, Z, 1.4, o, mw) + 0.6 * n.ridged(X, Y, Z, 3.5, o, mw) - 0.2);
        const sea = -rel * 0.12;
        if (h < sea) h = sea;
        break;
      }
      case 'earth':
      case 'terra':
      case 'ocean': {
        const l = this.land(x, y, z, mw);
        if (l <= 0) return 0;
        const m = smoothstep(0.05, 0.55, n.fbm(X + 9, Y, Z, 1.7, 5, mw) + 0.15);
        h = l * rel * (0.02 + 0.12 * (0.5 + 0.5 * n.fbm(X, Y, Z, 6, o, mw)) + 1.1 * m * n.ridged(X, Y, Z, 5, o, mw));
        break;
      }
      default: h = 0;
    }
    return h * this.R;
  }

  isLiquid(x: number, y: number, z: number, h: number): boolean {
    switch (this.type) {
      case 'earth': case 'terra': case 'ocean': return h <= 0.01;
      case 'titan': return h <= -this.rel * this.R * lerp(0.6, 0.05, smoothstep(0.55, 0.85, Math.abs(y))) + 0.01;
      case 'lava': return h <= -this.rel * this.R * 0.12 + 0.01;
      default: return false;
    }
  }

  /** emissive glow 0..1 (lava worlds) */
  glow(x: number, y: number, z: number, h: number, mw = 0): number {
    if (this.type !== 'lava') return 0;
    if (this.isLiquid(x, y, z, h)) return 1;
    const X = x + this.ox, Y = y + this.oy, Z = z + this.oz;
    const c = 1 - Math.abs(this.noise.fbm(X, Y, Z, 9, 5, mw));
    return Math.pow(c, 18) * 0.9;
  }

  /** procedural sRGB albedo */
  color(x: number, y: number, z: number, h: number, mw: number, out: RGB): RGB {
    const n = this.noise, p = this.pal;
    const X = x + this.ox, Y = y + this.oy, Z = z + this.oz;
    const hn = this.rel > 0 ? h / (this.rel * this.R) : 0; // roughly -1..1.5
    const fine = n.fbm(X, Y, Z, 40, 6, mw);
    switch (this.type) {
      case 'rock': {
        const t = smoothstep(-0.5, 0.5, n.fbm(X + 3, Y, Z, 1.6, 5, mw));
        mix(p[1], p[0], t, out);
        mix(out, p[2], smoothstep(0.1, 0.9, hn) * 0.7 + 0.12 * fine, out);
        break;
      }
      case 'mars': {
        const t = smoothstep(-0.4, 0.4, n.fbm(X + 3, Y, Z, 1.4, 5, mw));
        mix(p[1], p[0], t, out);
        mix(out, p[2], smoothstep(0.2, 1.0, hn) * 0.6 + 0.1 * fine, out);
        const cap = smoothstep(0.9, 0.95, Math.abs(y) + 0.03 * fine);
        mix(out, [0.95, 0.95, 0.97], cap, out);
        break;
      }
      case 'ice': {
        const r = 1 - Math.abs(n.n3(X * 5, Y * 5, Z * 5)); const r2 = 1 - Math.abs(n.n3(X * 13 + 5, Y * 13, Z * 13));
        const crack = clamp(Math.pow(r, 10) + 0.7 * Math.pow(r2, 10), 0, 1);
        const t = smoothstep(-0.5, 0.5, n.fbm(X + 3, Y, Z, 1.3, 5, mw));
        mix(p[0], p[2], t, out);
        mix(out, p[1], crack * 0.8 + smoothstep(0.2, 0.7, n.fbm(X, Y + 4, Z, 0.9, 4, mw)) * 0.5, out);
        mix(out, p[2], 0.08 * fine + 0.08, out);
        break;
      }
      case 'io': {
        const t = smoothstep(-0.3, 0.3, n.fbm(X + 3, Y, Z, 1.8, 5, mw));
        mix(p[0], p[1], t, out);
        mix(out, p[2], smoothstep(0.1, 0.5, n.fbm(X, Y + 7, Z, 2.6, 5, mw)), out);
        mix(out, p[3], smoothstep(-0.25, -0.6, hn) * 0.9, out);
        mix(out, p[1], 0.1 * fine + 0.05, out);
        break;
      }
      case 'venus': {
        const t = smoothstep(-0.4, 0.4, n.fbm(X + 3, Y, Z, 1.5, 5, mw));
        mix(p[1], p[0], t, out);
        mix(out, p[2], smoothstep(0.3, 1.1, hn) * 0.5 + 0.1 * fine, out);
        break;
      }
      case 'titan': {
        if (this.isLiquid(x, y, z, h)) { out[0] = 0.07; out[1] = 0.055; out[2] = 0.04; break; }
        const t = smoothstep(-0.3, 0.3, n.fbm(X + 3, Y, Z, 1.2, 5, mw) - 0.3 * (1 - Math.abs(y)));
        mix(p[1], p[0], t, out);
        mix(out, p[2], smoothstep(0.3, 1.0, hn) * 0.5 + 0.08 * fine, out);
        break;
      }
      case 'lava': {
        const g = this.glow(x, y, z, h, mw);
        const t = smoothstep(-0.4, 0.4, n.fbm(X + 3, Y, Z, 2.1, 5, mw));
        mix(p[1], p[0], t, out);
        mix(out, [0.3, 0.26, 0.24], smoothstep(0.4, 1.2, hn) * 0.6 + 0.1 * fine, out);
        mix(out, p[2], g, out);
        break;
      }
      case 'earth': case 'terra': case 'ocean': {
        if (h <= 0.01) {
          const d = smoothstep(-0.3, 0.3, n.fbm(X, Y, Z, 2.2, 5, mw));
          mix(p[0], [p[0][0] * 0.55, p[0][1] * 0.6, p[0][2] * 0.7], d, out);
          const ice = smoothstep(0.86, 0.92, Math.abs(y) + 0.04 * fine);
          mix(out, p[3], ice, out);
          break;
        }
        const lat = Math.abs(y);
        const moist = smoothstep(-0.3, 0.3, n.fbm(X + 5, Y, Z, 2.4, 5, mw) + 0.25 - Math.abs(lat - 0.1) * 0.6);
        mix(p[2], p[1], moist, out);
        mix(out, [0.42, 0.38, 0.34], smoothstep(0.35, 0.8, hn), out);
        const snow = smoothstep(0.75, 1.0, hn + lat * 0.9 + 0.06 * fine);
        mix(out, p[3], snow, out);
        mix(out, [out[0] * 0.8, out[1] * 0.8, out[2] * 0.8], 0.5 + 0.5 * fine, out);
        break;
      }
      case 'gas': case 'icegiant': {
        const lat = Math.asin(clamp(y, -1, 1));
        const bands = this.type === 'gas' ? 9 : 4;
        const turb = n.fbm(X * 1.5, Y * 6, Z * 1.5, 2.0, 6, mw) * (this.type === 'gas' ? 0.35 : 0.2);
        const v = lat * bands + turb * 2.2 + n.n3(X * 0.7, Y * 0.7, Z * 0.7) * 0.3;
        const s = 0.5 + 0.5 * Math.sin(v * 2.0);
        const s2 = 0.5 + 0.5 * Math.sin(v * 5.3 + 1.7);
        mix(p[0], p[1], smoothstep(0.2, 0.8, s), out);
        mix(out, p[2], smoothstep(0.55, 0.95, s2) * 0.6, out);
        if (this.type === 'gas') {
          const st = smoothstep(0.62, 0.8, n.fbm(X * 2 + 1, Y * 5, Z * 2, 2.5, 4, mw) * 0.5 + 0.5);
          mix(out, p[3], st * 0.5, out);
        }
        mix(out, [out[0] * 0.85, out[1] * 0.85, out[2] * 0.85], 0.5 + 0.5 * fine, out);
        break;
      }
      default: out[0] = p[0][0]; out[1] = p[0][1]; out[2] = p[0][2];
    }
    if (this.type !== 'gas' && this.type !== 'icegiant' && !(this.hasLiquid && this.isLiquid(x, y, z, h))) {
      // multi-scale albedo variation so surfaces stay interesting from orbit down to the ground
      const d = 1 + 0.28 * n.fbm(X - 4, Y + 2, Z, 14, 14, mw, 0.6) + 0.12 * n.fbm(X, Y, Z - 3, 900, 8, mw);
      const hue = 0.06 * n.fbm(X + 7, Y, Z, 6, 6, mw);
      out[0] = clamp(out[0] * d * (1 + hue), 0, 1); out[1] = clamp(out[1] * d, 0, 1); out[2] = clamp(out[2] * d * (1 - hue), 0, 1);
    }
    return out;
  }

  /** brightness multiplier adding close-up variation on top of a photographic texture */
  detail(x: number, y: number, z: number, mw: number): number {
    const X = x + this.ox, Y = y + this.oy, Z = z + this.oz;
    return 1 + 0.16 * this.noise.fbm(X, Y, Z, 300, 8, mw) + 0.1 * this.noise.fbm(X, Y, Z, 6000, 8, mw);
  }

  meanColor(): RGB {
    return [...this.pal[0]] as RGB;
  }
}

export { hex as hexToRgb, TMP };

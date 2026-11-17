// Seeded 3D simplex noise + hashing helpers. Pure functions, double precision.

const F3 = 1 / 3, G3 = 1 / 6;
const GRAD = new Float64Array([
  1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0, 1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1,
  0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1,
]);

export class Noise {
  private perm = new Uint8Array(512);
  private perm12 = new Uint8Array(512);

  constructor(seed: number) {
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    let s = (seed * 2147483647) | 0 || 1234567;
    for (let i = 255; i > 0; i--) {
      s = (Math.imul(s, 1664525) + 1013904223) | 0;
      const j = (s >>> 8) % (i + 1);
      const t = p[i]; p[i] = p[j]; p[j] = t;
    }
    for (let i = 0; i < 512; i++) { this.perm[i] = p[i & 255]; this.perm12[i] = this.perm[i] % 12; }
  }

  /** simplex noise in [-1, 1] */
  n3(x: number, y: number, z: number): number {
    const perm = this.perm, perm12 = this.perm12;
    const s = (x + y + z) * F3;
    const i = Math.floor(x + s), j = Math.floor(y + s), k = Math.floor(z + s);
    const t = (i + j + k) * G3;
    const x0 = x - (i - t), y0 = y - (j - t), z0 = z - (k - t);
    let i1, j1, k1, i2, j2, k2;
    if (x0 >= y0) {
      if (y0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
      else if (x0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1; }
      else { i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1; }
    } else {
      if (y0 < z0) { i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1; }
      else if (x0 < z0) { i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1; }
      else { i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
    }
    const x1 = x0 - i1 + G3, y1 = y0 - j1 + G3, z1 = z0 - k1 + G3;
    const x2 = x0 - i2 + 2 * G3, y2 = y0 - j2 + 2 * G3, z2 = z0 - k2 + 2 * G3;
    const x3 = x0 - 1 + 3 * G3, y3 = y0 - 1 + 3 * G3, z3 = z0 - 1 + 3 * G3;
    const ii = i & 255, jj = j & 255, kk = k & 255;
    let n = 0;
    let tt = 0.6 - x0 * x0 - y0 * y0 - z0 * z0;
    if (tt > 0) {
      const g = perm12[ii + perm[jj + perm[kk]]] * 3; tt *= tt;
      n += tt * tt * (GRAD[g] * x0 + GRAD[g + 1] * y0 + GRAD[g + 2] * z0);
    }
    tt = 0.6 - x1 * x1 - y1 * y1 - z1 * z1;
    if (tt > 0) {
      const g = perm12[ii + i1 + perm[jj + j1 + perm[kk + k1]]] * 3; tt *= tt;
      n += tt * tt * (GRAD[g] * x1 + GRAD[g + 1] * y1 + GRAD[g + 2] * z1);
    }
    tt = 0.6 - x2 * x2 - y2 * y2 - z2 * z2;
    if (tt > 0) {
      const g = perm12[ii + i2 + perm[jj + j2 + perm[kk + k2]]] * 3; tt *= tt;
      n += tt * tt * (GRAD[g] * x2 + GRAD[g + 1] * y2 + GRAD[g + 2] * z2);
    }
    tt = 0.6 - x3 * x3 - y3 * y3 - z3 * z3;
    if (tt > 0) {
      const g = perm12[ii + 1 + perm[jj + 1 + perm[kk + 1]]] * 3; tt *= tt;
      n += tt * tt * (GRAD[g] * x3 + GRAD[g + 1] * y3 + GRAD[g + 2] * z3);
    }
    return 32 * n;
  }

  /** fractal noise; stops when wavelength (1/f) drops below minWave. Returns approx [-1,1]. */
  fbm(x: number, y: number, z: number, f: number, octaves: number, minWave: number, gain = 0.5): number {
    let amp = 1, sum = 0, norm = 0;
    for (let o = 0; o < octaves; o++) {
      if (1 / f < minWave && o > 0) break;
      sum += amp * this.n3(x * f + o * 17.1, y * f - o * 9.3, z * f + o * 5.7);
      norm += amp; amp *= gain; f *= 2.03;
    }
    // normalise by the full-series sum so amplitude doesn't change with LOD
    return sum / (1 / (1 - gain));
  }

  /** ridged multifractal in [0,1] */
  ridged(x: number, y: number, z: number, f: number, octaves: number, minWave: number): number {
    let amp = 0.5, sum = 0, prev = 1;
    for (let o = 0; o < octaves; o++) {
      if (1 / f < minWave && o > 0) break;
      let n = 1 - Math.abs(this.n3(x * f - o * 3.3, y * f + o * 7.9, z * f + o * 13.1));
      n *= n;
      sum += n * amp * prev;
      prev = n; amp *= 0.5; f *= 2.07;
    }
    return sum;
  }

  /** integer lattice hash -> [0,1) */
  hash3(i: number, j: number, k: number, salt: number): number {
    const p = this.perm;
    const a = p[(i & 255) + p[(j & 255) + p[(k & 255) + (salt & 255)]]];
    const b = p[((i >> 8) & 255) + p[((j >> 8) & 255) + p[((k >> 8) & 255) + a]]];
    const c = p[(a + 37 + (salt & 255)) & 511];
    return ((b << 8) | c) / 65536;
  }

  /**
   * Crater field at one scale. Returns height in units of crater-radius-scaled depth (roughly [-1, 0.3]).
   * p is in unit-sphere coordinates multiplied by freq. density in [0,1] thins the craters.
   */
  craters(x: number, y: number, z: number, salt: number, density: number): number {
    const fx = Math.floor(x - 0.5), fy = Math.floor(y - 0.5), fz = Math.floor(z - 0.5);
    let h = 0;
    for (let dz = 0; dz < 2; dz++) for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
      const ci = fx + dx, cj = fy + dy, ck = fz + dz;
      const r0 = this.hash3(ci, cj, ck, salt);
      if (r0 > density) continue;
      const cx = ci + 0.25 + 0.5 * this.hash3(ci, cj, ck, salt + 1);
      const cy = cj + 0.25 + 0.5 * this.hash3(ci, cj, ck, salt + 2);
      const cz = ck + 0.25 + 0.5 * this.hash3(ci, cj, ck, salt + 3);
      const rad = 0.12 + 0.3 * this.hash3(ci, cj, ck, salt + 4) ** 2;
      const ddx = x - cx, ddy = y - cy, ddz = z - cz;
      const d = Math.sqrt(ddx * ddx + ddy * ddy + ddz * ddz) / rad;
      if (d < 1.6) {
        if (d < 1) {
          const bowl = d * d - 1; // -1 at centre, 0 at rim
          h += rad * (bowl * 0.9 + 0.22 * d * d * d * d);
        } else {
          const t = (1.6 - d) / 0.6;
          h += rad * 0.22 * t * t;
        }
      }
    }
    return h;
  }
}

export function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
export function clamp(x: number, a: number, b: number): number { return x < a ? a : x > b ? b : x; }
export function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }

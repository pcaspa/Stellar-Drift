import { BufferAttribute, BufferGeometry, Material, Mesh, Quaternion, Scene, Sphere, Vector3 } from 'three';
import { Body } from '../sim/universe';
import { RGB } from '../sim/surface';
import { DETAIL_PERIOD } from './terrainShader';

const N = 32;            // quads per chunk side
const G = N + 3;         // grid points per side including the skirt ring
const SPLIT = 1.9;       // split when camera closer than SPLIT * chunk arc length

// face basis: normal, U, V with U x V = N
const FACES: [number[], number[], number[]][] = [
  [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
  [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
  [[0, 1, 0], [0, 0, 1], [1, 0, 0]],
  [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
  [[0, 0, 1], [1, 0, 0], [0, 1, 0]],
  [[0, 0, -1], [0, 1, 0], [1, 0, 0]],
];

let sharedIndex: BufferAttribute | null = null;
function indexBuffer(): BufferAttribute {
  if (sharedIndex) return sharedIndex;
  const idx = new Uint16Array((G - 1) * (G - 1) * 6);
  let k = 0;
  for (let j = 0; j < G - 1; j++) for (let i = 0; i < G - 1; i++) {
    const a = j * G + i, b = a + 1, c = a + G, d = c + 1;
    idx[k++] = a; idx[k++] = b; idx[k++] = c;
    idx[k++] = b; idx[k++] = d; idx[k++] = c;
  }
  return sharedIndex = new BufferAttribute(idx, 1);
}

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

class Node {
  children: Node[] | null = null;
  mesh: Mesh | null = null;
  /** chunk centre on the terrain, body-fixed metres */
  readonly center = new Vector3();
  readonly arc: number;
  constructor(public face: number, public level: number, public ix: number, public iy: number, body: Body) {
    this.arc = body.radius * (Math.PI / 2) / (1 << level);
    const size = 2 / (1 << level);
    dirAt(face, -1 + (ix + 0.5) * size, -1 + (iy + 0.5) * size, this.center);
    const h = body.surface.height(this.center.x, this.center.y, this.center.z, (Math.PI / 2) / (1 << level) / 4);
    this.center.multiplyScalar(body.radius + h);
  }
}

function dirAt(face: number, u: number, v: number, out: Vector3): Vector3 {
  const f = FACES[face];
  const a = Math.tan(u * Math.PI / 4), b = Math.tan(v * Math.PI / 4);
  out.set(f[0][0] + f[1][0] * a + f[2][0] * b, f[0][1] + f[1][1] * a + f[2][1] * b, f[0][2] + f[1][2] * a + f[2][2] * b);
  return out.normalize();
}

const _d = new Vector3(), _p = new Vector3();
const _col: RGB = [0, 0, 0];
const px = new Float64Array(G * G), py = new Float64Array(G * G), pz = new Float64Array(G * G);
const dxs = new Float64Array(G * G), dys = new Float64Array(G * G), dzs = new Float64Array(G * G);
const hs = new Float64Array(G * G);

export class Terrain {
  private roots: Node[] = [];
  private meshes = new Set<Mesh>();
  private queue: { n: Node; pri: number }[] = [];
  readonly maxLevel: number;
  private camLocal = new Vector3();
  private visible = false;

  constructor(public body: Body, private scene: Scene, private material: Material, private textured: boolean, private glow: boolean) {
    this.maxLevel = Math.min(19, Math.max(2, Math.ceil(Math.log2(body.radius * Math.PI / 2 / N / 1.6))));
    for (let f = 0; f < 6; f++) {
      const n = new Node(f, 0, 0, 0, body);
      this.build(n);
      this.roots.push(n);
    }
  }

  private build(n: Node) {
    const body = this.body, surf = body.surface, R = body.radius;
    const size = 2 / (1 << n.level);
    const u0 = -1 + n.ix * size, v0 = -1 + n.iy * size;
    const mw = (Math.PI / 2) / (1 << n.level) / N;
    const cx = n.center.x, cy = n.center.y, cz = n.center.z;
    // heights + positions on the full (N+3)^2 grid (true neighbours, used for normals)
    for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
      const k = j * G + i;
      dirAt(n.face, u0 + size * (i - 1) / N, v0 + size * (j - 1) / N, _d);
      const h = surf.height(_d.x, _d.y, _d.z, mw);
      hs[k] = h; dxs[k] = _d.x; dys[k] = _d.y; dzs[k] = _d.z;
      px[k] = _d.x * (R + h) - cx; py[k] = _d.y * (R + h) - cy; pz[k] = _d.z * (R + h) - cz;
    }
    const pos = new Float32Array(G * G * 3), nor = new Float32Array(G * G * 3), col = new Float32Array(G * G * 3);
    const uv = this.textured ? new Float32Array(G * G * 2) : null;
    const glow = new Float32Array(G * G);
    const water = new Float32Array(G * G);
    const dpos = new Float32Array(G * G * 3);
    const glossy = surf.type === 'earth' || surf.type === 'terra' || surf.type === 'ocean' || surf.type === 'titan';
    // chunk offset removed from the detail coordinates (multiple of the noise period)
    const ox = cx - Math.floor(cx / DETAIL_PERIOD) * DETAIL_PERIOD;
    const oy = cy - Math.floor(cy / DETAIL_PERIOD) * DETAIL_PERIOD;
    const oz = cz - Math.floor(cz / DETAIL_PERIOD) * DETAIL_PERIOD;
    const skirt = n.arc * 0.06;
    let uc = Math.atan2(n.center.z, -n.center.x) / (2 * Math.PI);
    for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
      const k = j * G + i;
      const ci = Math.min(G - 2, Math.max(1, i)), cj = Math.min(G - 2, Math.max(1, j));
      const s = cj * G + ci; // clamped (real) vertex
      const isSkirt = s !== k;
      // normal from neighbours of the clamped vertex
      const ax = px[s + 1] - px[s - 1], ay = py[s + 1] - py[s - 1], az = pz[s + 1] - pz[s - 1];
      const bx = px[s + G] - px[s - G], by = py[s + G] - py[s - G], bz = pz[s + G] - pz[s - G];
      let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
      const nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      nx /= nl; ny /= nl; nz /= nl;
      const X = dxs[s], Y = dys[s], Z = dzs[s];
      const drop = isSkirt ? skirt : 0;
      pos[k * 3] = px[s] - X * drop; pos[k * 3 + 1] = py[s] - Y * drop; pos[k * 3 + 2] = pz[s] - Z * drop;
      dpos[k * 3] = pos[k * 3] + ox; dpos[k * 3 + 1] = pos[k * 3 + 1] + oy; dpos[k * 3 + 2] = pos[k * 3 + 2] + oz;
      if (glossy && surf.isLiquid(X, Y, Z, hs[s])) water[k] = 1;
      nor[k * 3] = nx; nor[k * 3 + 1] = ny; nor[k * 3 + 2] = nz;
      if (this.textured) {
        const m = surf.detail(X, Y, Z, mw);
        // darken steep slopes a touch
        const slope = nx * X + ny * Y + nz * Z;
        const v = m * (0.82 + 0.18 * slope);
        col[k * 3] = v; col[k * 3 + 1] = v; col[k * 3 + 2] = v;
        let u = Math.atan2(Z, -X) / (2 * Math.PI);
        if (u - uc > 0.5) u -= 1; else if (u - uc < -0.5) u += 1;
        uv![k * 2] = u; uv![k * 2 + 1] = 1 - Math.acos(Math.max(-1, Math.min(1, Y))) / Math.PI;
      } else {
        surf.color(X, Y, Z, hs[s], mw, _col);
        const slope = nx * X + ny * Y + nz * Z;
        const sh = 0.8 + 0.2 * slope;
        col[k * 3] = srgbToLinear(_col[0]) * sh; col[k * 3 + 1] = srgbToLinear(_col[1]) * sh; col[k * 3 + 2] = srgbToLinear(_col[2]) * sh;
        if (this.glow) glow[k] = surf.glow(X, Y, Z, hs[s], mw);
      }
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(pos, 3));
    geo.setAttribute('normal', new BufferAttribute(nor, 3));
    geo.setAttribute('color', new BufferAttribute(col, 3));
    if (uv) geo.setAttribute('uv', new BufferAttribute(uv, 2));
    geo.setAttribute('glow', new BufferAttribute(glow, 1));
    geo.setAttribute('water', new BufferAttribute(water, 1));
    geo.setAttribute('dpos', new BufferAttribute(dpos, 3));
    geo.setIndex(indexBuffer());
    geo.boundingSphere = new Sphere(new Vector3(0, 0, 0), n.arc * 1.1 + body.radius * body.surface.rel * 2 + skirt);
    const mesh = new Mesh(geo, this.material);
    mesh.visible = false;
    mesh.matrixAutoUpdate = true;
    n.mesh = mesh;
    this.meshes.add(mesh);
    this.scene.add(mesh);
  }

  private disposeNode(n: Node) {
    if (n.children) { for (const c of n.children) this.disposeNode(c); n.children = null; }
    if (n.mesh) {
      this.scene.remove(n.mesh);
      n.mesh.geometry.dispose();
      this.meshes.delete(n.mesh);
      n.mesh = null;
    }
  }

  private show(n: Node, bodyRel: Vector3, q: Quaternion, order: number) {
    const m = n.mesh!;
    m.visible = true;
    m.renderOrder = order;
    _p.copy(n.center).applyQuaternion(q).add(bodyRel);
    m.position.copy(_p);
    m.quaternion.copy(q);
  }

  private visit(n: Node, bodyRel: Vector3, q: Quaternion, order: number) {
    const dist = Math.max(1, this.camLocal.distanceTo(n.center));
    const split = n.level < this.maxLevel && dist < n.arc * SPLIT;
    if (split) {
      if (!n.children) {
        n.children = [];
        for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++)
          n.children.push(new Node(n.face, n.level + 1, n.ix * 2 + i, n.iy * 2 + j, this.body));
      }
      let ready = true;
      for (const c of n.children) if (!c.mesh) { ready = false; this.queue.push({ n: c, pri: dist / n.arc }); }
      if (ready) { for (const c of n.children) this.visit(c, bodyRel, q, order); return; }
      this.show(n, bodyRel, q, order);
    } else {
      this.show(n, bodyRel, q, order);
      if (n.children) { for (const c of n.children) this.disposeNode(c); n.children = null; }
    }
  }

  /**
   * camLocal: camera in body-fixed frame (m). bodyRel: body centre minus camera (sim frame, m).
   * q: body orientation. Builds new chunks within the given time budget.
   */
  update(camLocal: Vector3, bodyRel: Vector3, q: Quaternion, order: number, budgetMs: number) {
    this.visible = true;
    this.camLocal.copy(camLocal);
    for (const m of this.meshes) m.visible = false;
    this.queue.length = 0;
    for (const r of this.roots) this.visit(r, bodyRel, q, order);
    if (this.queue.length) {
      this.queue.sort((a, b) => a.pri - b.pri);
      const t0 = performance.now();
      for (const item of this.queue) {
        if (!item.n.mesh) this.build(item.n);
        if (performance.now() - t0 > budgetMs) break;
      }
    }
  }

  hide() {
    if (!this.visible) return;
    this.visible = false;
    for (const m of this.meshes) m.visible = false;
  }

  dispose() {
    for (const r of this.roots) this.disposeNode(r);
    this.roots.length = 0;
  }
}

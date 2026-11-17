import {
  AdditiveBlending, BoxGeometry, BufferGeometry, CanvasTexture, CircleGeometry, Color, ConeGeometry, CylinderGeometry, DoubleSide, ExtrudeGeometry,
  Float32BufferAttribute, Group, LatheGeometry, Material, Mesh, MeshBasicMaterial, MeshStandardMaterial, Object3D, PointLight, Shape, SphereGeometry,
  SpotLight, Sprite, SpriteMaterial, TorusGeometry, Vector2, Vector3,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { glowTexture } from './textures';
import { makeMaterials, ShipMaterials } from './materials';

// ------------------------------------------------------------------ UV helpers (consistent texel density)
const M_PER_TILE = 4.5;

/** box-projected UVs in metres: good for boxes and rounded boxes */
function projUV(geo: BufferGeometry, m = M_PER_TILE): BufferGeometry {
  if (!geo.attributes.normal) geo.computeVertexNormals();
  const p = geo.attributes.position, n = geo.attributes.normal;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    let u: number, v: number;
    if (ax >= ay && ax >= az) { u = p.getZ(i); v = p.getY(i); }
    else if (ay >= az) { u = p.getX(i); v = p.getZ(i); }
    else { u = p.getX(i); v = p.getY(i); }
    uv[i * 2] = u / m; uv[i * 2 + 1] = v / m;
  }
  geo.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  return geo;
}
/** scale the built-in UVs of a lathe/cylinder so a tile is ~M_PER_TILE metres */
function cylUV(geo: BufferGeometry, circumference: number, length: number, m = M_PER_TILE): BufferGeometry {
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * Math.max(1, Math.round(circumference / m)), uv.getY(i) * length / m);
  return geo;
}

// ------------------------------------------------------------------ part builders
export interface Plume { mesh: Mesh; axis: 'x' | 'y' | 'z'; sign: number; len: number; cur: number; main: boolean; }

let plumeTex: CanvasTexture | null = null;
function plumeTexture(): CanvasTexture {
  if (plumeTex) return plumeTex;
  const c = document.createElement('canvas'); c.width = 8; c.height = 128;
  const ctx = c.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 0, 128);
  g.addColorStop(1, 'rgba(255,255,255,1)');
  g.addColorStop(0.88, 'rgba(190,225,255,0.9)');
  g.addColorStop(0.55, 'rgba(90,150,255,0.35)');
  g.addColorStop(0, 'rgba(40,70,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 8, 128);
  return plumeTex = new CanvasTexture(c);
}

class Builder {
  readonly root = new Group();
  readonly plumes: Plume[] = [];
  readonly nozzles: Mesh[] = [];
  readonly blinkers: { s: Sprite; phase: number; period: number }[] = [];
  readonly gear = new Group();
  constructor(readonly m: ShipMaterials) { this.root.add(this.gear); }

  add(geo: BufferGeometry, mat: Material, x = 0, y = 0, z = 0, parent: Object3D = this.root): Mesh {
    const mesh = new Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true; mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  box(w: number, h: number, d: number, mat: Material, x: number, y: number, z: number, radius = 0) {
    const g = radius > 0 ? new RoundedBoxGeometry(w, h, d, 2, radius) : new BoxGeometry(w, h, d);
    g.translate(x, y, z);
    return this.add(projUV(g), mat);
  }

  /** cylinder along Z */
  cylZ(r1: number, r2: number, len: number, mat: Material, x: number, y: number, z: number, seg = 32, open = false) {
    const g = new CylinderGeometry(r1, r2, len, seg, 1, open);
    cylUV(g, 2 * Math.PI * Math.max(r1, r2), len);
    g.rotateX(Math.PI / 2); g.translate(x, y, z);
    return this.add(g, mat);
  }

  /** lathe along Z: profile points (radius, z) with z increasing toward the stern */
  latheZ(profile: [number, number][], mat: Material, x = 0, y = 0, seg = 48, sx = 1, sy = 1) {
    const pts = profile.map(([r, z]) => new Vector2(Math.max(0.001, r), z));
    let len = 0, rmax = 0;
    for (let i = 1; i < pts.length; i++) len += pts[i].distanceTo(pts[i - 1]);
    for (const p of pts) rmax = Math.max(rmax, p.x);
    const g = new LatheGeometry(pts, seg);
    cylUV(g, 2 * Math.PI * rmax, len);
    g.rotateX(Math.PI / 2);
    g.scale(sx, sy, 1);
    g.translate(x, y, 0);
    return this.add(g, mat);
  }

  sphere(r: number, mat: Material, x: number, y: number, z: number) {
    const g = new SphereGeometry(r, 40, 24);
    cylUV(g, 2 * Math.PI * r, Math.PI * r);
    g.translate(x, y, z);
    return this.add(g, mat);
  }

  /** open truss between two points along Z with a square section */
  truss(x: number, y: number, z0: number, z1: number, s: number, rod = 0.12) {
    const len = z1 - z0, zc = (z0 + z1) / 2, h = s / 2;
    for (const [dx, dy] of [[h, h], [-h, h], [h, -h], [-h, -h]]) this.cylZ(rod, rod, len, this.m.metal, x + dx, y + dy, zc, 8);
    const bays = Math.max(1, Math.round(len / s));
    const bl = len / bays;
    for (let i = 0; i <= bays; i++) {
      const z = z0 + i * bl;
      for (const [w, hh, dx, dy] of [[s, rod * 1.5, 0, h], [s, rod * 1.5, 0, -h], [rod * 1.5, s, h, 0], [rod * 1.5, s, -h, 0]]) {
        this.box(w, hh, rod * 1.5, this.m.metal, x + dx, y + dy, z);
      }
      if (i < bays) {
        // diagonals on the four faces
        const diag = Math.hypot(s, bl), ang = Math.atan2(s, bl);
        for (const side of [0, 1, 2, 3]) {
          const g = new CylinderGeometry(rod * 0.7, rod * 0.7, diag, 6);
          g.rotateX(Math.PI / 2);
          const mesh = this.add(g, this.m.metal);
          mesh.position.set(x, y, z + bl / 2);
          if (side < 2) { mesh.rotation.y = (i % 2 ? 1 : -1) * ang; mesh.position.y += side === 0 ? h : -h; }
          else { mesh.rotation.x = (i % 2 ? 1 : -1) * ang; mesh.position.x += side === 2 ? h : -h; }
        }
      }
    }
  }

  /** standard 20 ft container (2.44 × 2.59 × 6.06 m) */
  container(x: number, y: number, z: number, i: number, length = 6.06) {
    const mat = this.m.container[i % this.m.container.length];
    this.box(2.44, 2.59, length, mat, x, y, z, 0.06);
    // corrugation ribs
    for (let k = -length / 2 + 0.35; k < length / 2 - 0.2; k += 0.62) {
      this.box(2.5, 2.4, 0.08, mat, x, y, z + k);
    }
    // end frames
    for (const e of [-1, 1]) this.box(2.52, 2.67, 0.16, this.m.dark, x, y, z + e * (length / 2 - 0.08));
  }

  /** bell nozzle firing towards +Z, exit at z */
  engine(x: number, y: number, z: number, r: number, plumeLen: number) {
    const L = r * 1.9;
    const prof: [number, number][] = [];
    for (let i = 0; i <= 14; i++) {
      const t = i / 14;
      prof.push([r * (0.38 + 0.62 * Math.pow(t, 0.65)), z - L + t * L]);
    }
    const bell = this.latheZ(prof, this.m.nozzle, x, y, 40);
    this.nozzles.push(bell);
    // throat + powerhead
    this.cylZ(r * 0.42, r * 0.5, r * 0.8, this.m.dark, x, y, z - L - r * 0.35, 20);
    this.cylZ(r * 0.62, r * 0.62, r * 0.6, this.m.metal, x, y, z - L - r * 0.9, 20);
    // cooling rings
    for (const t of [0.3, 0.6]) {
      const g = new TorusGeometry(r * (0.38 + 0.62 * Math.pow(t, 0.65)) + 0.03, r * 0.035, 8, 40);
      g.translate(x, y, z - L + t * L);
      this.add(g, this.m.metal);
    }
    this.plume(new Vector3(x, y, z + 0.05), new Vector3(0, 0, 1), r * 0.92, plumeLen, 'z', -1, true);
  }

  plume(pos: Vector3, dir: Vector3, radius: number, len: number, axis: 'x' | 'y' | 'z', sign: number, main = false) {
    const geo = new ConeGeometry(radius, 1, 24, 1, true);
    geo.translate(0, 0.5, 0); // wide end at the nozzle, tip at +1
    const mat = new MeshBasicMaterial({
      map: plumeTexture(), color: new Color(2.5, 3.2, 5.0), transparent: true, blending: AdditiveBlending,
      depthWrite: false, side: DoubleSide, opacity: 0,
    });
    const mesh = new Mesh(geo, mat);
    mesh.position.copy(pos);
    mesh.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), dir.clone().normalize());
    mesh.renderOrder = 9500; mesh.visible = false;
    this.root.add(mesh);
    this.plumes.push({ mesh, axis, sign, len, cur: 0, main });
  }

  /** RCS quad: four small thrusters, with plumes for the cardinal directions */
  rcs(x: number, y: number, z: number, size: number, side: 1 | -1) {
    this.box(size, size, size, this.m.hull2, x, y, z, size * 0.12);
    const n = size * 0.35;
    for (const [dx, dy, dz] of [[side, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
      const g = new CylinderGeometry(n * 0.35, n * 0.6, n, 10, 1, true);
      const m = this.add(g, this.m.nozzle, x + dx * size * 0.6, y + dy * size * 0.6, z + dz * size * 0.6);
      m.quaternion.setFromUnitVectors(new Vector3(0, -1, 0), new Vector3(dx, dy, dz));
    }
    const p = (dx: number, dy: number, dz: number, axis: 'x' | 'y' | 'z', sign: number) =>
      this.plume(new Vector3(x + dx * size * 0.8, y + dy * size * 0.8, z + dz * size * 0.8), new Vector3(dx, dy, dz), n * 0.5, size * 3, axis, sign);
    // a thruster pointing +dir pushes the ship towards -dir
    p(side, 0, 0, 'x', -side); p(0, 1, 0, 'y', -1); p(0, -1, 0, 'y', 1); p(0, 0, -1, 'z', 1);
  }

  radiator(x: number, y: number, z: number, w: number, l: number, vertical: boolean) {
    const g = new BoxGeometry(vertical ? 0.12 : w, vertical ? w : 0.12, l);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * Math.max(1, l / 6), uv.getY(i));
    g.translate(x, y, z);
    this.add(g, this.m.radiator);
    // header pipe
    this.cylZ(0.18, 0.18, l, this.m.metal, x + (vertical ? 0 : -Math.sign(x || 1) * w / 2), y - (vertical ? Math.sign(y || 1) * w / 2 : 0), z, 10);
  }

  solar(x: number, y: number, z: number, w: number, l: number) {
    const g = new BoxGeometry(w, 0.08, l);
    g.translate(x, y, z);
    this.add(g, this.m.solar);
  }

  dish(x: number, y: number, z: number, r: number) {
    const prof: Vector2[] = [];
    for (let i = 0; i <= 10; i++) { const t = i / 10; prof.push(new Vector2(r * t, -r * 0.35 * t * t)); }
    const g = new LatheGeometry(prof, 32);
    g.rotateX(-Math.PI / 2); g.translate(x, y, z);
    this.add(g, this.m.metal);
    this.cylZ(0.05, 0.05, r * 0.6, this.m.metal, x, y, z - r * 0.3, 6);
  }

  light(color: string, x: number, y: number, z: number, size: number, period = 0, phase = 0) {
    const s = new Sprite(new SpriteMaterial({ map: glowTexture(64, 3), color: new Color(color).multiplyScalar(4), blending: AdditiveBlending, depthWrite: false, transparent: true }));
    s.scale.setScalar(size); s.position.set(x, y, z); s.renderOrder = 9600;
    this.root.add(s);
    if (period) this.blinkers.push({ s, phase, period });
  }

  /**
   * Deployable drill: a fixed housing under the hull (centre at y = top) and a rig that lowers a
   * telescoping shaft and a spinning auger bit to the ground (y = ground) and then bores into it.
   */
  drillRig(x: number, z: number, top: number, ground: number, r: number): DrillRig {
    const m = this.m;
    const housing = new CylinderGeometry(r, r * 1.12, r * 1.3, 24); housing.translate(x, top, z);
    this.add(housing, m.dark);
    const collar = new TorusGeometry(r * 0.72, r * 0.13, 8, 28); collar.rotateX(Math.PI / 2); collar.translate(x, top - r * 0.66, z);
    this.add(collar, m.metal);
    const rig = new Group(); rig.position.set(x, top - r * 0.66, z); rig.visible = false;
    this.root.add(rig);
    // telescoping tubes: unit-length cylinders hanging down from the rig origin, stretched to length
    const sleeveG = new CylinderGeometry(r * 0.46, r * 0.46, 1, 16); sleeveG.translate(0, -0.5, 0);
    const sleeve = new Mesh(sleeveG, m.dark); rig.add(sleeve);
    const shaftG = new CylinderGeometry(r * 0.27, r * 0.27, 1, 14); shaftG.translate(0, -0.5, 0);
    const shaft = new Mesh(shaftG, m.metal); rig.add(shaft);
    // auger bit (tip at the group origin): cone point, fluted body with helical flights
    const bitLen = r * 2.6;
    const bit = new Group(); rig.add(bit);
    const tip = new ConeGeometry(r * 0.5, r * 0.9, 14); tip.rotateX(Math.PI); tip.translate(0, r * 0.45, 0);
    bit.add(new Mesh(tip, m.metal));
    const core = new CylinderGeometry(r * 0.24, r * 0.3, bitLen - r * 0.9, 12); core.translate(0, r * 0.9 + (bitLen - r * 0.9) / 2, 0);
    bit.add(new Mesh(core, m.dark));
    const turns = 10;
    for (let k = 0; k < turns; k++) {
      const fl = new BoxGeometry(r * 1.05, r * 0.07, r * 0.32);
      const f = new Mesh(fl, m.metal);
      f.position.y = r * 0.9 + (k + 0.5) * (bitLen - r * 0.9) / turns;
      f.rotation.y = k * 0.7; f.rotation.z = 0.25;
      bit.add(f);
    }
    // scar of disturbed regolith around the hole (flat on the ground)
    const scarG = new CircleGeometry(1, 32); scarG.rotateX(-Math.PI / 2);
    const scar = new Mesh(scarG, new MeshBasicMaterial({ color: '#191512', transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
    scar.position.set(x, ground + 0.06, z); scar.visible = false;
    this.root.add(scar);
    const reach = rig.position.y - ground;
    return { rig, sleeve, shaft, bit, scar, reach, bitLen, maxBore: Math.min(bitLen * 0.9, reach * 0.45), r, deploy: 0, bore: 0 };
  }

  /** landing legs reaching from the hull underside (y = -hullBottom) to the ground (y = -gearH) */
  legs(points: [number, number][], hullBottom: number, gearH: number) {
    const len = gearH - hullBottom;
    for (const [x, z] of points) {
      const strut = new CylinderGeometry(0.18 + len * 0.01, 0.22 + len * 0.012, len, 10);
      strut.translate(x, -hullBottom - len / 2, z);
      this.add(strut, this.m.metal, 0, 0, 0, this.gear);
      const pad = new CylinderGeometry(0.5 + len * 0.08, 0.6 + len * 0.09, 0.25, 16);
      pad.translate(x, -gearH + 0.12, z);
      this.add(pad, this.m.dark, 0, 0, 0, this.gear);
      const brace = new CylinderGeometry(0.1, 0.1, len * 0.8, 8);
      brace.rotateZ(Math.sign(x || 1) * 0.35);
      brace.translate(x * 0.85, -hullBottom - len * 0.45, z);
      this.add(brace, this.m.dark, 0, 0, 0, this.gear);
    }
  }
}

// ------------------------------------------------------------------ ship designs (nose towards -Z)
export interface ShipDesign {
  group: Group; plumes: Plume[]; nozzles: Mesh[]; gear: Group; blinkers: Builder['blinkers'];
  length: number; cockpit: Vector3; spot: SpotLight;
  /** deployable mining drills (lowered and spun while mining) */
  drills?: DrillRig[];
  /** colour of the spray thrown up while drilling */
  drillSpray?: string;
}

export interface DrillRig {
  rig: Group; sleeve: Mesh; shaft: Mesh; bit: Group; scar: Mesh;
  /** distance from the rig origin down to the ground, bit length, deepest bore below ground, housing radius */
  reach: number; bitLen: number; maxBore: number; r: number;
  /** animation state: 0..1 lowered, metres bored below the surface */
  deploy: number; bore: number;
}

function finish(b: Builder, length: number, cockpit: Vector3): ShipDesign {
  const spot = new SpotLight('#e6efff', 0, length * 120, 0.55, 0.6, 0);
  spot.position.set(0, -length * 0.08, -length * 0.2);
  spot.target.position.set(0, -length * 2, -length * 0.8);
  b.root.add(spot, spot.target);
  b.gear.visible = false;
  return { group: b.root, plumes: b.plumes, nozzles: b.nozzles, gear: b.gear, blinkers: b.blinkers, length, cockpit, spot };
}

function kestrel(): ShipDesign {
  const b = new Builder(makeMaterials('#e4e7ec', '#3a3f48', '#1f8fd0', 11));
  const m = b.m;
  // lifting-body fuselage
  const prof: [number, number][] = [];
  for (let i = 0; i <= 30; i++) {
    const t = i / 30;
    const r = 2.5 * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.6)), 0.7) * (1 - 0.22 * t) + 0.02;
    prof.push([r, (t - 0.5) * 26]);
  }
  b.latheZ(prof, m.hull, 0, 0, 48, 1.3, 0.62);
  // ventral heat shield
  const hs = b.latheZ(prof.map(([r, z]) => [r * 0.98, z]), m.dark, 0, -0.12, 48, 1.3, 0.6);
  hs.scale.y = 0.98;
  // canopy
  const cg = new SphereGeometry(1, 40, 24, 0, Math.PI * 2, 0, Math.PI / 2);
  cg.scale(1.3, 0.9, 3.8); cg.translate(0, 0.95, -5.6);
  b.add(cg, m.glass);
  const frame = new TorusGeometry(1.32, 0.07, 8, 40, Math.PI); frame.rotateY(Math.PI / 2); frame.scale(1, 0.75, 1); frame.translate(0, 0.95, -5.6);
  b.add(frame, m.dark);
  // delta wings with control surfaces
  const wing = new Shape();
  wing.moveTo(0, -3); wing.lineTo(10.3, 8.0); wing.lineTo(10.6, 10.3); wing.lineTo(3, 11.0); wing.lineTo(0, 10); wing.lineTo(0, -3);
  const wg = new ExtrudeGeometry(wing, { depth: 0.3, bevelEnabled: true, bevelSize: 0.12, bevelThickness: 0.12, bevelSegments: 2 });
  projUV(wg);
  for (const sx of [1, -1]) {
    const w = b.add(wg, m.hull);
    w.rotation.x = Math.PI / 2; w.scale.set(sx, 1, 1); w.position.set(sx * 1.6, -0.15, -1); w.rotation.z = sx * -0.05;
    // elevon
    b.box(5.5, 0.18, 0.9, m.hull2, sx * 6.2, -0.2, 9.9);
    // wingtip fin
    const fin = new ExtrudeGeometry(new Shape([new Vector2(0, 0), new Vector2(3.4, 0), new Vector2(3.0, 3.0), new Vector2(1.8, 3.2)]),
      { depth: 0.18, bevelEnabled: true, bevelSize: 0.05, bevelThickness: 0.05, bevelSegments: 1 });
    projUV(fin);
    const f = b.add(fin, m.hull2);
    f.rotation.y = -Math.PI / 2; f.position.set(sx * 11.9, -0.1, 6.6); f.rotation.z = sx * -0.2;
    // nacelle + engine
    b.latheZ([[0.9, 2.6], [1.25, 3.4], [1.25, 10], [1.05, 12.2]], m.hull2, sx * 4.2, 0.1, 32);
    const ring = new TorusGeometry(1.0, 0.14, 10, 32); ring.translate(sx * 4.2, 0.1, 2.7);
    b.add(ring, m.accent);
    b.engine(sx * 4.2, 0.1, 13.8, 1.0, 24);
    b.rcs(sx * 2.2, 0.2, -8.5, 0.6, sx as 1 | -1);
    b.rcs(sx * 7.5, 0.2, 9.0, 0.5, sx as 1 | -1);
    b.light(sx > 0 ? '#2aff5a' : '#ff2a2a', sx * 12.1, 0.1, 9.5, 1.5);
  }
  b.cylZ(0.45, 0.85, 12, m.dark, 0, 1.2, 4.5, 16);
  b.light('#ffffff', 0, 1.9, 6, 1.2, 1.4, 0);
  b.legs([[0, -7], [4.4, 6.5], [-4.4, 6.5]], 1.4, 28 * 0.16 + 1.5);
  // ice-coring drill in a belly pod ahead of the wing root (clear of the wings, visible from the side)
  const drill = b.drillRig(0, -3.6, -1.35, -(28 * 0.16 + 1.5), 0.85);
  const d = finish(b, 28, new Vector3(0, 1.4, -6.5));
  d.drills = [drill];
  d.drillSpray = '#e8f4ff';
  return d;
}

/** generic freighter: command module, cargo spine, engine section */
function freighter(o: {
  len: number; seed: number; paint: string; stripe: string; hullR: number;
  bays: number; rings: [number, number][]; engines: [number, number][]; engR: number;
  radW: number; tanks?: { r: number; z: number; xs: number[] }[]; twin?: boolean; dish?: boolean;
}): ShipDesign {
  const b = new Builder(makeMaterials(o.paint, '#3b4048', o.stripe, o.seed));
  const m = b.m, L = o.len, R = o.hullR;
  const zFront = -L / 2, zBack = L / 2;
  // command module (nose)
  const noseLen = Math.max(8, L * 0.16);
  const nz0 = zFront, nz1 = zFront + noseLen;
  b.latheZ([[0.3, nz0], [R * 0.55, nz0 + noseLen * 0.08], [R * 0.85, nz0 + noseLen * 0.3], [R, nz0 + noseLen * 0.55], [R, nz1]], m.hull, 0, 0, 48);
  // window band + bridge glazing
  b.cylZ(R * 1.005, R * 1.005, noseLen * 0.14, m.windows, 0, 0, nz0 + noseLen * 0.72, 48, true);
  const gl = new SphereGeometry(1, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2);
  gl.scale(R * 0.55, R * 0.35, noseLen * 0.28); gl.translate(0, R * 0.62, nz0 + noseLen * 0.32);
  b.add(gl, m.glass);
  // docking collar / bulkhead
  b.cylZ(R * 0.7, R * 0.7, 1.2, m.dark, 0, 0, nz1 + 0.6, 32);
  const tankEnd = o.tanks ? Math.max(...o.tanks.map(t => t.z + t.r)) : 0;
  // engine section
  const engLen = Math.max(6, L * 0.14);
  const ez1 = zBack - o.engR * 1.9, ez0 = ez1 - engLen;
  // cargo spine(s)
  const cz0 = nz1 + 1.2, cz1 = (o.tanks ? Math.min(...o.tanks.map(t => t.z - t.r)) : ez0) - 1;
  const spines = o.twin ? [-R * 0.95, R * 0.95] : [0];
  let ci = 0;
  const contL = 6.06, gap = 0.5;
  for (const sx of spines) {
    b.truss(sx, 0, cz0, cz1, 1.6, 0.11);
    const n = Math.max(1, Math.floor((cz1 - cz0) / (contL + gap)));
    const start = cz0 + ((cz1 - cz0) - n * (contL + gap)) / 2 + (contL + gap) / 2;
    for (let i = 0; i < Math.min(n, o.bays); i++) {
      const z = start + i * (contL + gap);
      for (const [rx, ry] of o.rings) b.container(sx + rx, ry, z, ci++ + Math.floor(o.seed * 7));
      // clamp frame
      b.box(o.rings.length > 2 ? 6 : 5.6, 0.25, 0.3, m.dark, sx, 0, z - contL / 2 - 0.1);
    }
  }
  if (o.twin) {
    // cross beams joining the spines
    for (const z of [cz0 + 1, (cz0 + cz1) / 2, cz1 - 1]) b.box(R * 2.2, 0.9, 0.9, m.hull2, 0, 0, z);
  }
  // propellant tanks
  for (const t of o.tanks ?? []) for (const x of t.xs) {
    b.sphere(t.r, m.foil, x, 0, t.z);
    const band = new TorusGeometry(t.r * 1.005, t.r * 0.03, 8, 48); band.translate(x, 0, t.z);
    b.add(band, m.metal);
  }
  if (o.tanks) b.truss(0, 0, cz1, Math.max(tankEnd, ez0), 1.6, 0.11);
  // engine block
  b.latheZ([[R * 0.7, ez0 - 1], [R * 1.05, ez0 + 1], [R * 1.05, ez1 - 1], [R * 0.85, ez1]], m.hull2, 0, 0, 40);
  b.cylZ(R * 1.07, R * 1.07, 0.6, m.accent, 0, 0, ez0 + 2, 40);
  for (const [x, y] of o.engines) b.engine(x, y, zBack, o.engR, o.engR * 18);
  // radiators along the engine section / spine
  const rl = Math.min(cz1 - cz0, L * 0.4);
  const rz = (cz0 + cz1) / 2 + (cz1 - cz0) * 0.15;
  if (o.radW > 0) {
    for (const s of [1, -1]) b.radiator(s * (R + o.radW / 2 + (o.twin ? R : 0.8)), 0, rz, o.radW, rl, false);
  }
  // RCS quads at both ends
  for (const s of [1, -1] as const) {
    b.rcs(s * (R + 0.3), 0, nz0 + noseLen * 0.55, Math.max(0.6, R * 0.22), s);
    b.rcs(s * (R + 0.3), 0, ez0 + 1.5, Math.max(0.6, R * 0.22), s);
  }
  if (o.dish) b.dish(0, R + 1.2, nz1 - 1, Math.max(1.5, R * 0.45));
  // lights
  const wide = (o.twin ? R * 2 : R) + (o.radW > 0 ? o.radW + 1 : 0);
  b.light('#2aff5a', wide, 0, rz, Math.max(1.5, L * 0.025));
  b.light('#ff2a2a', -wide, 0, rz, Math.max(1.5, L * 0.025));
  b.light('#ffffff', 0, R + 0.2, nz1, Math.max(1.5, L * 0.03), 1.3, 0);
  b.light('#ffffff', 0, -R - 0.2, ez0, Math.max(1.5, L * 0.03), 1.3, 0.5);
  // landing legs
  const gearH = L * 0.16 + 1.5;
  const hullBottom = Math.max(R, ...o.rings.map(([, y]) => -y + 1.3));
  const lx = o.twin ? R * 1.6 : R * 0.9;
  b.legs([[lx, nz1], [-lx, nz1], [lx, ez0], [-lx, ez0]], hullBottom, gearH);
  return finish(b, L, new Vector3(0, R * 0.62, nz0 + noseLen * 0.3));
}

/** mining ships: cab, ore hoppers, belly drill rigs that reach the ground when landed */
function miner(o: { len: number; seed: number; hoppers: [number, number][]; hopR: number; drills: [number, number][]; engines: [number, number][]; engR: number; radW: number }): ShipDesign {
  const b = new Builder(makeMaterials('#d6a91f', '#2c3036', '#1b1b1b', o.seed));
  const m = b.m, L = o.len;
  const zF = -L / 2, zB = L / 2;
  const gearH = L * 0.16 + 1.5;
  const R = Math.max(2.4, o.hopR * 1.3);
  // cab module
  const cabL = Math.max(6, L * 0.17);
  b.box(R * 1.8, R * 1.4, cabL, m.hull, 0, R * 0.2, zF + cabL / 2, R * 0.35);
  b.box(R * 1.82, R * 0.36, cabL * 0.55, m.windows, 0, R * 0.42, zF + cabL * 0.42, 0.1);
  const gl = new SphereGeometry(1, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2);
  gl.rotateX(-Math.PI / 2); gl.scale(R * 0.75, R * 0.5, cabL * 0.18); gl.translate(0, R * 0.35, zF + 0.05);
  b.add(gl, m.glass);
  // spine
  const sz0 = zF + cabL, sz1 = zB - o.engR * 1.9 - Math.max(4, L * 0.1);
  b.box(R * 0.9, R * 0.9, sz1 - sz0, m.hull2, 0, 0, (sz0 + sz1) / 2, 0.15);
  // hazard stripes along the spine
  for (let z = sz0 + 1; z < sz1 - 1; z += 3) b.box(R * 0.92, 0.25, 1.2, m.dark, 0, R * 0.45, z);
  // ore hoppers: ribbed cylinders with conical ends
  let hi = 0;
  const hopL = Math.min((sz1 - sz0) / Math.max(1, Math.ceil(o.hoppers.length / 2)) - 1.2, o.hopR * 5);
  const rows = Math.ceil(o.hoppers.length / 2);
  for (let r = 0; r < rows; r++) {
    const zc = sz0 + (r + 0.5) * (sz1 - sz0) / rows;
    for (const [hx, hy] of o.hoppers.slice(r * 2, r * 2 + 2)) {
      const h = o.hopR;
      b.latheZ([[0.2, zc - hopL / 2], [h * 0.8, zc - hopL / 2 + h * 0.5], [h, zc - hopL / 2 + h * 0.9], [h, zc + hopL / 2 - h * 0.9], [h * 0.8, zc + hopL / 2 - h * 0.5], [0.2, zc + hopL / 2]],
        hi++ % 2 ? m.hull : m.container[4], hx, hy, 36);
      for (let k = -2; k <= 2; k++) {
        const ring = new TorusGeometry(h * 1.01, h * 0.04, 6, 36); ring.translate(hx, hy, zc + k * (hopL - h * 2) / 5);
        b.add(ring, m.dark);
      }
      // hopper saddle
      b.box(Math.abs(hx) * 0.9, 0.5, 1.2, m.metal, hx / 2, hy, zc);
    }
  }
  // drill rigs under the belly: lowered on telescoping shafts and bored into the ground while mining
  const drills: DrillRig[] = [];
  for (const [dx, dz] of o.drills) {
    const top = -R * 0.45;
    drills.push(b.drillRig(dx, dz, top, -gearH, R * 0.38));
    // floodlight on the drill housing
    b.light('#fff2c8', dx, top - 0.3, dz - R * 0.4, Math.max(1.2, L * 0.02));
  }
  // engine block
  const ez1 = zB - o.engR * 1.9, ez0 = sz1;
  b.box(R * 2.1, R * 1.6, ez1 - ez0, m.hull2, 0, 0, (ez0 + ez1) / 2, R * 0.3);
  for (const [x, y] of o.engines) b.engine(x, y, zB, o.engR, o.engR * 16);
  if (o.radW > 0) for (const s of [1, -1]) b.radiator(s * (R + o.radW / 2 + 1), R * 0.3, (ez0 + sz0) / 2 + (ez0 - sz0) * 0.25, o.radW, (ez0 - sz0) * 0.4, false);
  for (const s of [1, -1] as const) {
    b.rcs(s * (R * 0.95), R * 0.2, zF + cabL * 0.6, Math.max(0.6, R * 0.2), s);
    b.rcs(s * (R * 1.1), 0, ez0 + 1, Math.max(0.6, R * 0.2), s);
  }
  b.light('#2aff5a', R * 1.2 + (o.radW > 0 ? o.radW + 1 : 0), R * 0.3, 0, Math.max(1.5, L * 0.025));
  b.light('#ff2a2a', -R * 1.2 - (o.radW > 0 ? o.radW + 1 : 0), R * 0.3, 0, Math.max(1.5, L * 0.025));
  b.light('#ffb347', 0, R * 0.95, zF + cabL, Math.max(1.5, L * 0.03), 0.9, 0);
  // wide-stance gear for uneven rock
  const lx = R * 1.5;
  b.legs([[lx, zF + cabL], [-lx, zF + cabL], [lx, ez0], [-lx, ez0]], R * 0.5, gearH);
  const d = finish(b, L, new Vector3(0, R * 0.45, zF + cabL * 0.3));
  d.drills = drills;
  return d;
}

/** Wraith: faceted black stealth carrier with swept blades, canards, canted fins and red edge glow */
function wraith(): ShipDesign {
  const b = new Builder(makeMaterials('#23262c', '#15171b', '#ff3b1f', 131));
  const m = b.m, L = 170, zF = -L / 2, zB = L / 2;
  const glow = new MeshStandardMaterial({ color: '#ff2a12', emissive: '#ff3010', emissiveIntensity: 3, roughness: 0.4, metalness: 0.2 });
  const R = 11, SX = 1.7, SY = 0.6;
  // faceted (hexagonal) blade fuselage: a needle nose swelling into a broad flat body
  const prof: [number, number][] = [[0.2, zF], [R * 0.25, zF + 14], [R * 0.6, zF + 34], [R * 0.92, zF + 58], [R, zF + 72], [R, zB - 26], [R * 0.9, zB - 12], [R * 0.78, zB - 4]];
  b.latheZ(prof, m.hull2, 0, 0, 6, SX, SY);
  // dorsal spine and ventral keel, also faceted
  b.latheZ([[0.2, zF + 20], [R * 0.3, zF + 46], [R * 0.42, zF + 80], [R * 0.42, zB - 30], [R * 0.3, zB - 14]], m.hull, 0, R * SY * 0.7, 4, 1.2, 0.9);
  b.latheZ([[0.2, zF + 40], [R * 0.32, zF + 70], [R * 0.32, zB - 24], [0.2, zB - 10]], m.hull2, 0, -R * SY * 0.75, 4, 1.4, 0.7);
  // slit canopy
  const cg = new SphereGeometry(1, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2);
  cg.scale(R * 0.32, R * 0.16, 15); cg.translate(0, R * SY * 0.82, zF + 40);
  b.add(cg, m.glass);
  const halfW = R * SX * 0.87;
  // main swept blades with glowing leading edges
  const wing = new Shape();
  wing.moveTo(0, -26); wing.lineTo(44, 36); wing.lineTo(48, 50); wing.lineTo(36, 52); wing.lineTo(0, 46); wing.lineTo(0, -26);
  const wg = new ExtrudeGeometry(wing, { depth: 1.6, bevelEnabled: true, bevelSize: 0.5, bevelThickness: 0.5, bevelSegments: 1 });
  projUV(wg);
  const edge = Math.hypot(44, 62), ang = Math.atan2(44, 62);
  for (const sx of [1, -1]) {
    const w = b.add(wg, m.hull2);
    w.rotation.x = Math.PI / 2; w.scale.set(sx, 1, 1); w.position.set(sx * (halfW - 4), 0.6, 4); w.rotation.z = sx * 0.06;
    const lead = b.add(new BoxGeometry(0.7, 0.7, edge), glow, sx * (halfW - 4 + 22), 0.1, 4 + 5);
    lead.rotation.y = sx * ang;
    // trailing-edge glow
    b.add(new BoxGeometry(36, 0.5, 0.6), glow, sx * (halfW - 4 + 18), 0.1, 4 + 49);
    // forward-swept canards
    const can = new ExtrudeGeometry(new Shape([new Vector2(0, 0), new Vector2(20, -14), new Vector2(23, -10), new Vector2(6, 8)]),
      { depth: 0.8, bevelEnabled: true, bevelSize: 0.25, bevelThickness: 0.25, bevelSegments: 1 });
    projUV(can);
    const c = b.add(can, m.hull2);
    c.rotation.x = Math.PI / 2; c.scale.set(sx, 1, 1); c.position.set(sx * R * 0.9, 0.8, zF + 46); c.rotation.z = sx * -0.12;
    b.add(new BoxGeometry(0.5, 0.5, 15), glow, sx * (R * 0.9 + 12), 0.4, zF + 46 - 6).rotation.y = sx * 0.95;
    // canted twin tail fins
    const fin = new ExtrudeGeometry(new Shape([new Vector2(0, 0), new Vector2(34, 0), new Vector2(26, 24), new Vector2(14, 26)]),
      { depth: 1.0, bevelEnabled: true, bevelSize: 0.3, bevelThickness: 0.3, bevelSegments: 1 });
    projUV(fin);
    const f = b.add(fin, m.hull);
    // (cant outward about the ship's long axis, after turning the fin edge-on)
    f.rotation.order = 'ZYX';
    f.rotation.y = -Math.PI / 2; f.position.set(sx * R * 0.9, R * SY * 0.6, zB - 50); f.rotation.z = sx * -0.42;
    // side glow strakes along the body
    b.add(new BoxGeometry(0.6, 0.6, 96), glow, sx * halfW * 0.92, -0.6, 6);
    b.rcs(sx * halfW * 0.8, 0, zF + 30, 1.6, sx as 1 | -1);
    b.rcs(sx * halfW * 0.95, 0, zB - 18, 1.8, sx as 1 | -1);
    b.light(sx > 0 ? '#2aff5a' : '#ff2a2a', sx * (halfW + 44), 0, 52, 4);
  }
  // recessed six-torch drive block
  b.box(R * 2.4, R * 1.15, 18, m.dark, 0, 0, zB - 11, 1.2);
  b.add(new BoxGeometry(R * 2.45, 0.6, 0.6), glow, 0, R * 0.58, zB - 2.5);
  for (const x of [-8.5, 0, 8.5]) for (const y of [-2.6, 2.6]) b.engine(x, y, zB + 2, 2.3, 40);
  // nose and dorsal strobes
  b.light('#ff3b1f', 0, 0, zF - 0.5, 3, 1.1, 0);
  b.light('#ffffff', 0, R * SY + 2, 0, 3, 1.4, 0.4);
  // four heavy drills under the belly
  const gearH = L * 0.16 + 1.5, top = -R * SY * 0.95;
  const drills: DrillRig[] = [];
  for (const [dx, dz] of [[6, -22], [-6, -22], [6, 22], [-6, 22]] as [number, number][]) drills.push(b.drillRig(dx, dz, top, -gearH, 2.6));
  b.legs([[halfW * 0.7, zF + 50], [-halfW * 0.7, zF + 50], [halfW * 0.8, zB - 30], [-halfW * 0.8, zB - 30]], R * SY, gearH);
  const d = finish(b, L, new Vector3(0, R * SY * 0.82, zF + 38));
  d.drills = drills;
  d.drillSpray = '#ffb08a';
  return d;
}

const SIDE2: [number, number][] = [[1.6, 0], [-1.6, 0]];
const SIDE4: [number, number][] = [[1.6, 1.4], [-1.6, 1.4], [1.6, -1.4], [-1.6, -1.4]];

export function buildShip(id: string): ShipDesign {
  switch (id) {
    case 'prospector': return miner({ len: 34, seed: 71, hoppers: [[3.0, 0.4], [-3.0, 0.4]], hopR: 1.6, drills: [[0, -2]],
      engines: [[1.0, 0], [-1.0, 0]], engR: 0.9, radW: 0 });
    case 'excavator': return miner({ len: 64, seed: 83, hoppers: [[4.6, 0.6], [-4.6, 0.6], [4.6, 0.6], [-4.6, 0.6], [4.6, 0.6], [-4.6, 0.6]], hopR: 2.3,
      drills: [[0, -8], [0, 8]], engines: [[1.5, 1.2], [-1.5, 1.2], [0, -1.4]], engR: 1.2, radW: 5 });
    case 'behemoth': return miner({ len: 120, seed: 97, hoppers: Array.from({ length: 10 }, (_, i) => [i % 2 ? -7.5 : 7.5, 1.2] as [number, number]), hopR: 3.6,
      drills: [[3.5, -18], [-3.5, -18], [3.5, 18], [-3.5, 18]], engines: [[2.6, 2.2], [-2.6, 2.2], [2.6, -2.2], [-2.6, -2.2], [0, 0]], engR: 1.7, radW: 10 });
    case 'heron': return freighter({ len: 46, seed: 21, paint: '#d8dce2', stripe: '#d9822b', hullR: 3.0, bays: 3, rings: SIDE2,
      engines: [[0, 1.4], [1.25, -0.8], [-1.25, -0.8]], engR: 1.0, radW: 3 });
    case 'albatross': return freighter({ len: 72, seed: 33, paint: '#e3e1da', stripe: '#2b6fd9', hullR: 4.2, bays: 3, rings: SIDE4,
      engines: [[1.7, 1.7], [-1.7, 1.7], [1.7, -1.7], [-1.7, -1.7]], engR: 1.3, radW: 6,
      tanks: [{ r: 3.4, z: 18, xs: [0] }], dish: true });
    case 'leviathan': return freighter({ len: 112, seed: 47, paint: '#c9ccd1', stripe: '#c23b3b', hullR: 6.0, bays: 6, rings: SIDE4, twin: true,
      engines: [[0, 0], [3.4, 0], [-3.4, 0], [1.7, 2.9], [-1.7, 2.9], [0, -3.2]], engR: 1.5, radW: 10,
      tanks: [{ r: 4.6, z: 34, xs: [-5.5, 5.5] }], dish: true });
    case 'atlas': return freighter({ len: 170, seed: 59, paint: '#e8e6df', stripe: '#1f9b6a', hullR: 8.0, bays: 10, rings: SIDE4, twin: true,
      engines: [[0, 4.5], [0, -4.5], [4.5, 0], [-4.5, 0], [3.2, 3.2], [-3.2, 3.2], [3.2, -3.2], [-3.2, -3.2]], engR: 1.8, radW: 16,
      tanks: [{ r: 6.5, z: 52, xs: [-7.5, 7.5] }], dish: true });
    case 'wraith': return wraith();
    default: return kestrel();
  }
}

// ------------------------------------------------------------------ animated wrapper used by the renderer
export class ShipModel {
  readonly group = new Group();
  design!: ShipDesign;
  private heatGlow: Sprite;
  private engineGlow: Sprite;
  private engineLight: PointLight;
  private time = 0;
  private gearT = 0;
  private dust: Sprite[] = [];
  private chips: Sprite[] = [];
  private mineT = 0;
  classId = '';

  /** npc: no per-ship lights (toggling lights on and off forces shader recompiles) */
  constructor(private npc = false) {
    this.engineGlow = new Sprite(new SpriteMaterial({ map: glowTexture(128, 2), color: new Color(1.2, 2.2, 5), blending: AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
    this.engineGlow.renderOrder = 9600;
    this.heatGlow = new Sprite(new SpriteMaterial({ map: glowTexture(128, 1.6), color: new Color(6, 2.2, 0.6), blending: AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
    this.heatGlow.renderOrder = 9700;
    this.engineLight = new PointLight('#7fb4ff', 0, 0, 2);
    this.group.add(this.engineGlow, this.heatGlow);
    if (!npc) this.group.add(this.engineLight);
  }

  setClass(id: string) {
    if (id === this.classId) return;
    if (this.design) {
      this.group.remove(this.design.group);
      this.design.group.traverse(o => { if ((o as Mesh).isMesh) (o as Mesh).geometry.dispose(); });
    }
    this.classId = id;
    this.design = buildShip(id);
    if (this.npc) { this.design.spot.parent?.remove(this.design.spot.target); this.design.spot.parent?.remove(this.design.spot); }
    this.group.add(this.design.group);
    // dust puffs and spray at the bore holes (only ships with drills)
    for (const s of [...this.dust, ...this.chips]) { this.group.remove(s); s.material.dispose(); }
    const sz = (rg: DrillRig) => rg.r * 2.2;
    const ground = (rg: DrillRig) => new Vector3(rg.rig.position.x, rg.rig.position.y - rg.reach, rg.rig.position.z);
    // three staggered puffs per drill form a rolling plume of dust at the hole
    this.dust = (this.design.drills ?? []).flatMap(rg => [0, 1, 2].map(k => {
      const s = new Sprite(new SpriteMaterial({ map: glowTexture(128, 1.2), color: new Color('#bfae97'), transparent: true, depthWrite: false, opacity: 0 }));
      s.userData.base = ground(rg).add(new Vector3((k - 1) * sz(rg) * 0.5, sz(rg) * 0.2, (k % 2 ? 1 : -1) * sz(rg) * 0.4));
      s.userData.size = sz(rg);
      s.renderOrder = 9550; s.visible = false;
      this.group.add(s);
      return s;
    }));
    // cuttings (ice crystals or rock chips) thrown out of the hole on short ballistic arcs
    const spray = new Color(this.design.drillSpray ?? '#d9c7ad');
    this.chips = (this.design.drills ?? []).flatMap(rg => Array.from({ length: 14 }, (_, k) => {
      const s = new Sprite(new SpriteMaterial({ map: glowTexture(64, 2.4), color: spray, transparent: true, depthWrite: false, opacity: 0 }));
      s.userData.base = ground(rg);
      s.userData.size = sz(rg);
      s.userData.ang = k * 2.39996 + Math.random() * 0.3;
      s.userData.ph = k / 14;
      s.userData.spd = 0.7 + Math.random() * 0.6;
      s.renderOrder = 9560; s.visible = false;
      this.group.add(s);
      return s;
    }));
    const L = this.design.length;
    this.engineGlow.position.set(0, 0, L * 0.55);
  }

  get length() { return this.design.length; }

  update(dt: number, thrustLocal: Vector3, gearDown: boolean, heat: number, airDirLocal: Vector3, landingLight: number, mining = false) {
    const d = this.design, L = d.length;
    this.time += dt;
    this.updateDrills(dt, mining && gearDown);
    const flick = 0.9 + 0.1 * Math.sin(this.time * 61) * Math.sin(this.time * 37);
    let main = 0;
    for (const p of d.plumes) {
      const v = Math.max(0, thrustLocal[p.axis] * p.sign);
      p.cur += (Math.min(1, v) - p.cur) * Math.min(1, dt * 10);
      const s = p.cur;
      p.mesh.visible = s > 0.01;
      if (!p.mesh.visible) continue;
      p.mesh.scale.set(0.6 + 0.4 * s, Math.max(0.01, p.len * s * flick), 0.6 + 0.4 * s);
      (p.mesh.material as MeshBasicMaterial).opacity = Math.min(1, s * 1.5);
      if (p.main) main = Math.max(main, s);
    }
    // all bells share one material per ship
    const nm = d.nozzles[0]?.material as unknown as { emissiveIntensity: number } | undefined;
    if (nm) nm.emissiveIntensity = main * 5;
    (this.engineGlow.material as SpriteMaterial).opacity = main * 0.8;
    this.engineGlow.scale.setScalar(L * (0.4 + 0.8 * main * flick));
    this.engineLight.position.set(0, 0, L * 0.6);
    this.engineLight.intensity = main * L * L * 0.6;
    this.engineLight.distance = L * 6;

    this.gearT += ((gearDown ? 1 : 0) - this.gearT) * Math.min(1, dt * 3);
    d.gear.visible = this.gearT > 0.02;
    d.gear.scale.y = Math.max(0.05, this.gearT);

    for (const bl of d.blinkers) bl.s.visible = ((this.time / bl.period + bl.phase) % 1) < 0.12;

    const hm = this.heatGlow.material as SpriteMaterial;
    hm.opacity = Math.min(1, heat) * (0.75 + 0.25 * flick);
    this.heatGlow.visible = heat > 0.01;
    if (this.heatGlow.visible) {
      this.heatGlow.position.copy(airDirLocal).multiplyScalar(L * 0.42);
      this.heatGlow.scale.setScalar(L * (0.9 + Math.min(1, heat)));
    }
    d.spot.intensity = landingLight * L * L * 0.4;
  }

  /**
   * Drill rigs: lower the shaft until the bit touches the ground, bore down while the drills run
   * (the ground hides the buried part), spin the auger, and throw out dust and cuttings.
   * Stopping pulls the bit out of the hole and retracts the rig into its housing.
   */
  private updateDrills(dt: number, mining: boolean) {
    const rigs = this.design.drills;
    if (!rigs?.length) return;
    let working = 0;
    for (const rg of rigs) {
      if (mining) {
        // lower to the surface, then feed into the ground with a slight pecking motion
        rg.deploy = Math.min(1, rg.deploy + dt * 0.45);
        if (rg.deploy >= 1) rg.bore = Math.min(rg.maxBore, rg.bore + dt * rg.maxBore * 0.12);
      } else if (rg.bore > 0) rg.bore = Math.max(0, rg.bore - dt * rg.maxBore * 0.6);
      else rg.deploy = Math.max(0, rg.deploy - dt * 0.6);
      const ease = rg.deploy * rg.deploy * (3 - 2 * rg.deploy);
      const contact = rg.deploy >= 1;
      const peck = contact && mining ? Math.sin(this.time * 5.3) * rg.r * 0.08 : 0;
      // distance from the rig origin to the bit tip: tucked under the housing → ground → bored depth
      const ext = rg.bitLen * 0.6 + ease * (rg.reach - rg.bitLen * 0.6) + rg.bore + peck;
      rg.rig.visible = rg.deploy > 0.001;
      rg.bit.position.y = -ext;
      rg.shaft.scale.y = Math.max(0.01, ext - rg.bitLen * 0.95);
      rg.sleeve.scale.y = Math.max(0.01, Math.min(ext * 0.45, rg.reach * 0.45));
      const spin = contact && mining ? 1 : ease * 0.3;
      rg.bit.rotation.y += dt * 16 * spin;
      rg.shaft.rotation.y = rg.bit.rotation.y;
      // disturbed ground around the hole grows as it deepens
      const sm = rg.scar.material as MeshBasicMaterial;
      const dug = rg.bore / rg.maxBore;
      rg.scar.visible = dug > 0.01;
      rg.scar.scale.setScalar(rg.r * (0.9 + 2.6 * Math.sqrt(dug)));
      sm.opacity = 0.55 * Math.min(1, dug * 3);
      if (contact && mining) working++;
    }
    // dust and cuttings only while a bit is actually cutting
    this.mineT += ((working ? 1 : 0) - this.mineT) * Math.min(1, dt * 2);
    const on = this.mineT > 0.02;
    this.dust.forEach((s, i) => {
      s.visible = on;
      if (!on) return;
      const ph = (this.time * 0.6 + i * 0.33) % 1, S = s.userData.size as number;
      // each puff billows up and out, then fades
      s.position.copy(s.userData.base as Vector3); s.position.y += ph * S * 1.6;
      s.scale.setScalar(S * (0.8 + 2.6 * ph) * (0.5 + 0.5 * this.mineT));
      (s.material as SpriteMaterial).opacity = 0.75 * Math.sin(Math.PI * Math.min(1, ph * 1.2)) * this.mineT;
    });
    this.chips.forEach(s => {
      s.visible = on;
      if (!on) return;
      const S = s.userData.size as number, spd = s.userData.spd as number;
      const ph = (this.time * 1.1 * spd + (s.userData.ph as number)) % 1;
      const a = (s.userData.ang as number) + Math.floor(this.time * 1.1 * spd + (s.userData.ph as number)) * 1.3;
      const rr = S * (0.3 + 2.2 * ph) * spd;
      s.position.copy(s.userData.base as Vector3);
      s.position.x += Math.cos(a) * rr; s.position.z += Math.sin(a) * rr;
      s.position.y += 4 * ph * (1 - ph) * S * 1.4 * spd + S * 0.1;
      s.scale.setScalar(S * 0.34 * (1 - 0.5 * ph));
      (s.material as SpriteMaterial).opacity = this.mineT * (1 - ph) * 0.95;
    });
  }
}

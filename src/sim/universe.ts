import { Quaternion, Vector3 } from 'three';
import { BodyDef, LY_M, SystemDef } from '../data/types';
import { SOL } from '../data/sol';
import { EXO_SYSTEMS } from '../data/exo';
import { UNCHARTED_SYSTEMS } from '../data/uncharted';
import { Surface } from './surface';
import { STATIONS, STATION_RADIUS_KM } from '../data/stations';
import { asteroidsFor, SOL_ORE } from '../data/asteroids';

const DEG = Math.PI / 180;
const OBLIQ = 23.4392911 * DEG;
export const J2000_MS = Date.UTC(2000, 0, 1, 12, 0, 0);

/** equatorial (RA/Dec, deg) unit vector -> sim frame (x = vernal equinox, y = ecliptic north) */
export function equatorialToSim(raDeg: number, decDeg: number, out = new Vector3()): Vector3 {
  const ra = raDeg * DEG, dec = decDeg * DEG;
  const xe = Math.cos(dec) * Math.cos(ra), ye = Math.cos(dec) * Math.sin(ra), ze = Math.sin(dec);
  const yc = Math.cos(OBLIQ) * ye + Math.sin(OBLIQ) * ze;
  const zc = -Math.sin(OBLIQ) * ye + Math.cos(OBLIQ) * ze;
  return out.set(xe, zc, -yc);
}

const Y_AXIS = new Vector3(0, 1, 0);
const _v = new Vector3();
const _q = new Quaternion();
const _w1 = new Vector3(), _w2 = new Vector3(), _w3 = new Vector3();
const _qp = new Quaternion();

export class Body {
  readonly id: string;
  readonly name: string;
  parent: Body | null = null;
  children: Body[] = [];
  /** GM, m^3/s^2 */
  readonly mu: number;
  /** radius, m */
  readonly radius: number;
  readonly surface: Surface;
  /** system-frame state (star-centred inertial), metres */
  readonly pos = new Vector3();
  readonly vel = new Vector3();
  private lastT = NaN;
  // orbit
  a = 0; e = 0; n = 0; period = 0; M0 = 0;
  readonly P = new Vector3(); readonly Q = new Vector3();
  readonly orbitNormal = new Vector3(0, 1, 0);
  // rotation
  readonly axis = new Vector3(0, 1, 0);
  rotRate = 0;
  private tilt = new Quaternion();
  soi = Infinity;
  /** top of sensible atmosphere above the reference radius, m */
  atmoTop = 0;
  scaleH = 1;
  rho0 = 0;
  surfaceG: number;
  depth = 0;
  /** ground spaceport: direction of the pad from the parent's centre (parent body-fixed frame) */
  portDir: Vector3 | null = null;
  /** rotates the pad's local frame (+Y up) into the parent's body-fixed frame */
  private portQ = new Quaternion();
  private portHCache = NaN;
  private portHMasked = false;

  constructor(public def: BodyDef, public system: StarSystem) {
    this.id = def.id; this.name = def.name;
    this.mu = def.gm * 1e9; this.radius = def.radius * 1000;
    this.surface = new Surface(def);
    this.surfaceG = this.mu / (this.radius * this.radius);
    if (def.atmosphere) {
      this.scaleH = def.atmosphere.scaleHeight * 1000;
      this.rho0 = def.atmosphere.density;
      this.atmoTop = this.scaleH * 12;
    }
  }

  /** height of a spaceport's pad above the parent's mean radius, m (never below sea level) */
  get portH(): number {
    if (!this.portDir || !this.parent) return 0;
    const sf = this.parent.surface;
    // the coastline mask arrives with the planet's texture: recompute until it has been used
    if (isNaN(this.portHCache) || !this.portHMasked) {
      const d = this.portDir;
      const h = sf.height(d.x, d.y, d.z, 0);
      // worlds with liquid seas: never below sea level; elsewhere sit on the real terrain (crater floors too)
      this.portHCache = sf.hasLiquid ? Math.max(0, h) : h;
      this.portHMasked = !!sf.landMask || sf.type !== 'earth';
    }
    return this.portHCache;
  }

  get isPort() { return !!this.portDir; }

  init() {
    const d = this.def, par = this.parent;
    const port = d.station?.port;
    if (port && par) {
      // geographic lat/lon -> parent body-fixed direction (longitude 0 along +X, east towards −Z)
      const la = port.lat * DEG, lo = port.lon * DEG;
      this.portDir = new Vector3(Math.cos(la) * Math.cos(lo), Math.sin(la), -Math.cos(la) * Math.sin(lo)).normalize();
      this.portQ.setFromUnitVectors(Y_AXIS, this.portDir);
      this.axis.copy(par.axis); this.rotRate = par.rotRate;
      this.a = par.radius; this.soi = 0;
      return;
    }
    if (d.orbit && par) {
      const o = d.orbit;
      const ex = new Vector3(), ey = new Vector3(), ez = new Vector3();
      if (o.plane === 'equator') {
        ez.copy(par.axis);
        ex.set(1, 0, 0).addScaledVector(ez, -ez.x).normalize();
        ey.crossVectors(ez, ex);
      } else { ex.set(1, 0, 0); ey.set(0, 0, -1); ez.set(0, 1, 0); }
      const O = o.node * DEG, w = o.argPeri * DEG, i = o.i * DEG;
      const cO = Math.cos(O), sO = Math.sin(O), cw = Math.cos(w), sw = Math.sin(w), ci = Math.cos(i), si = Math.sin(i);
      this.P.set(0, 0, 0).addScaledVector(ex, cO * cw - sO * sw * ci).addScaledVector(ey, sO * cw + cO * sw * ci).addScaledVector(ez, sw * si);
      this.Q.set(0, 0, 0).addScaledVector(ex, -cO * sw - sO * cw * ci).addScaledVector(ey, -sO * sw + cO * cw * ci).addScaledVector(ez, cw * si);
      this.orbitNormal.crossVectors(this.P, this.Q).normalize();
      this.a = o.a * 1000; this.e = o.e; this.M0 = o.M0 * DEG;
      this.n = Math.sqrt((par.mu + this.mu) / (this.a * this.a * this.a));
      this.period = 2 * Math.PI / this.n;
      this.soi = this.a * Math.pow(this.mu / par.mu, 0.4);
    }
    // spin axis
    if (d.pole) equatorialToSim(d.pole[0], d.pole[1], this.axis).normalize();
    else this.axis.copy(this.orbitNormal);
    if (d.rotationHours !== undefined) this.rotRate = 2 * Math.PI / (d.rotationHours * 3600);
    else this.rotRate = this.n; // tidally locked
    this.tilt.setFromUnitVectors(Y_AXIS, this.axis);
  }

  /** update pos/vel (system frame) for time t (seconds since J2000) */
  updateTo(t: number) {
    if (t === this.lastT) return;
    this.lastT = t;
    const par = this.parent;
    if (!par) { this.pos.set(0, 0, 0); this.vel.set(0, 0, 0); return; }
    par.updateTo(t);
    if (this.portDir) {
      // on the ground: rotate with the planet
      // (own quaternion: orientation() uses _q internally)
      par.orientation(t, _qp);
      _v.copy(this.portDir).applyQuaternion(_qp).multiplyScalar(par.radius + this.portH);
      this.pos.copy(par.pos).add(_v);
      this.vel.copy(par.axis).multiplyScalar(par.rotRate).cross(_v).add(par.vel);
      return;
    }
    const e = this.e, a = this.a;
    let M = (this.M0 + this.n * t) % (2 * Math.PI);
    if (M > Math.PI) M -= 2 * Math.PI; else if (M < -Math.PI) M += 2 * Math.PI;
    let E = e > 0.8 ? Math.PI * Math.sign(M || 1) : M;
    for (let k = 0; k < 12; k++) {
      const dE = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
      E -= dE;
      if (Math.abs(dE) < 1e-12) break;
    }
    const cE = Math.cos(E), sE = Math.sin(E), b = Math.sqrt(1 - e * e);
    const x = a * (cE - e), y = a * b * sE;
    const k = a * this.n / (1 - e * cE);
    const vx = -k * sE, vy = k * b * cE;
    this.pos.copy(par.pos).addScaledVector(this.P, x).addScaledVector(this.Q, y);
    this.vel.copy(par.vel).addScaledVector(this.P, vx).addScaledVector(this.Q, vy);
  }

  /** gravitational acceleration of this body itself (from its ancestor chain), system frame */
  accel(out: Vector3): Vector3 {
    if (this.portDir && this.parent) {
      // held by the ground: the planet's own acceleration plus the centripetal pull of its spin
      const par = this.parent;
      par.accel(out);
      const w = _w1.copy(par.axis).multiplyScalar(par.rotRate);
      const r = _w2.subVectors(this.pos, par.pos);
      return out.add(_w3.crossVectors(w, _w2.crossVectors(w, r)));
    }
    out.set(0, 0, 0);
    let b: Body = this;
    // each ancestor's own acceleration is the sum up the chain of two-body terms
    while (b.parent) {
      _v.subVectors(b.parent.pos, b.pos);
      const r2 = _v.lengthSq();
      out.addScaledVector(_v, (b.parent.mu + b.mu) / (r2 * Math.sqrt(r2)));
      b = b.parent;
    }
    return out;
  }

  rotationAngle(t: number): number { return (this.rotRate * t) % (2 * Math.PI); }

  /** body-fixed -> inertial orientation at time t */
  orientation(t: number, out: Quaternion): Quaternion {
    // a spaceport's local +Y is the planet's local vertical at the pad
    if (this.portDir && this.parent) return this.parent.orientation(t, out).multiply(this.portQ);
    _q.setFromAxisAngle(Y_AXIS, this.rotationAngle(t));
    return out.copy(this.tilt).multiply(_q);
  }

  density(alt: number): number {
    if (!this.rho0 || alt > this.atmoTop) return 0;
    return this.rho0 * Math.exp(-Math.max(alt, -2000) / this.scaleH);
  }

  /** default parking orbit radius, m */
  parkingRadius(): number {
    if (this.def.kind === 'star') return this.radius * 6;
    if (this.isStation) return 2000; // station-keeping distance
    const alt = Math.max(this.atmoTop * 1.5, this.radius * 0.06, Math.min(20000, this.radius * 1.5));
    return this.radius * (1 + this.surface.rel * 1.2) + alt;
  }

  get isStar() { return this.def.kind === 'star'; }
  get isStation() { return this.def.kind === 'station'; }
}

export class StarSystem {
  readonly id: string;
  readonly name: string;
  readonly bodies: Body[] = [];
  readonly byId = new Map<string, Body>();
  readonly star: Body;
  /** position relative to Sol in the sim frame, metres */
  readonly galPos = new Vector3();
  /** radius of the outermost planet orbit, m */
  extent = 0;

  constructor(public def: SystemDef) {
    this.id = def.id; this.name = def.name;
    const all = [...def.bodies];
    // asteroid belt: extra mineable bodies (+ a visual belt where the system had none)
    const ast = asteroidsFor(def);
    all.push(...ast.bodies);
    if (ast.belts.length) def.belts = [...(def.belts ?? []), ...ast.belts];
    for (const b of all) if (!b.ore && SOL_ORE[b.id] && def.id === 'sol') b.ore = SOL_ORE[b.id];
    for (const st of STATIONS.filter(s => s.system === def.id)) {
      const par = def.bodies.find(b => b.id === st.parent);
      if (!par) { console.warn('station parent missing', st.id); continue; }
      if (st.port) {
        // ground spaceport: fixed to the surface, carried round by the planet's spin
        all.push({
          id: st.id, name: st.name, parent: st.parent, kind: 'station', station: st,
          radius: STATION_RADIUS_KM, gm: 1e-12,
          surface: 'rock', palette: ['#cfd8e3'], landable: false, desc: st.desc,
        });
        continue;
      }
      const atmoTop = par.atmosphere ? par.atmosphere.scaleHeight * 12 : 0;
      const giant = par.surface === 'gas' || par.surface === 'icegiant';
      const alt = st.altKm ?? (giant ? par.radius * 0.6 : Math.max(400, atmoTop * 1.6, par.radius * 0.08));
      let h = 0; for (let i = 0; i < st.id.length; i++) h = (h * 31 + st.id.charCodeAt(i)) % 360;
      all.push({
        id: st.id, name: st.name, parent: st.parent, kind: 'station', station: st,
        radius: STATION_RADIUS_KM, gm: 1e-12,
        orbit: { a: par.radius + alt, e: 0, i: 0, node: 0, argPeri: 0, M0: h, plane: 'equator' },
        surface: 'rock', palette: ['#cfd8e3'], landable: false, desc: st.desc,
      });
    }
    for (const bd of all) {
      const b = new Body(bd, this);
      this.bodies.push(b); this.byId.set(b.id, b);
    }
    for (const b of this.bodies) {
      if (b.def.parent) { b.parent = this.byId.get(b.def.parent)!; b.parent.children.push(b); }
    }
    this.star = this.bodies.find(b => !b.parent)!;
    // init in hierarchy order (parents first)
    const visit = (b: Body, depth: number) => { b.depth = depth; b.init(); b.children.forEach(c => visit(c, depth + 1)); };
    visit(this.star, 0);
    for (const b of this.star.children) if (b.def.kind === 'planet') this.extent = Math.max(this.extent, b.a * (1 + b.e));
    equatorialToSim(def.ra, def.dec, this.galPos).multiplyScalar(def.distLy * LY_M);
  }

  update(t: number) { for (const b of this.bodies) b.updateTo(t); }

  /** deepest body whose sphere of influence contains the point */
  dominant(p: Vector3): Body {
    let cur = this.star, found = true;
    while (found) {
      found = false;
      for (const c of cur.children) {
        if (_v.subVectors(p, c.pos).lengthSq() < c.soi * c.soi) { cur = c; found = true; break; }
      }
    }
    return cur;
  }
}

export class Universe {
  readonly systems: StarSystem[];
  constructor() {
    this.systems = [SOL, ...EXO_SYSTEMS, ...UNCHARTED_SYSTEMS].map(d => new StarSystem(d));
  }
  get(id: string) { return this.systems.find(s => s.id === id)!; }
}

export function simTimeNow(): number { return (Date.now() - J2000_MS) / 1000; }
export function simTimeToDate(t: number): Date { return new Date(J2000_MS + t * 1000); }

import { Vector3 } from 'three';
import type { Sim } from './sim';
import type { Body } from './universe';
import { sitePos, siteUp, type Site } from './sites';

export interface Guidance {
  /** world-space unit vector to point the nose along and burn (main engine) */
  dir: Vector3;
  /** delta-v still needed to be on the ideal approach profile, m/s */
  dv: number;
  state: 'burn' | 'brake' | 'coast' | 'hold';
  /** how far the nose is from the cue, radians */
  error: number;
}

const _r = new Vector3(), _v = new Vector3(), _d = new Vector3(), _f = new Vector3();
const _u = new Vector3(), _p = new Vector3(), _w = new Vector3(), _q = new Vector3();
/** height above a landing site that the manual steering cue leads to, m */
export const HOVER = 150;

/**
 * Manual-flight steering cue: the burn that puts you on an accelerate-then-brake approach
 * to the target, ending at rest at the standoff distance (parking orbit / station hold point).
 */
export function guidance(sim: Sim, target: Body, out: Guidance, site: Site | null = null): Guidance | null {
  const s = sim.ship;
  if (target.system !== sim.system) return null;
  // a landing site close by: steer to a hover point above it, matching the surface's motion there
  const nearSite = !!site && site.body === target && s.pos.distanceTo(target.pos) < Math.max(target.parkingRadius() * 2.5, target.radius * 3);
  if (s.landed === target && (!nearSite || sim.landedSite === site)) return null;
  let dist: number, standoff: number;
  if (nearSite) {
    const up = siteUp(site!, sim.t, _u);
    sitePos(site!, sim.t, _p).addScaledVector(up, HOVER);
    _r.subVectors(_p, s.pos);
    dist = _r.length(); standoff = 0;
    // velocity of the ground at the site (body motion plus spin)
    _w.copy(target.axis).multiplyScalar(target.rotRate).cross(_q.subVectors(_p, target.pos)).add(target.vel);
    _v.subVectors(s.vel, _w);
  } else {
    _r.subVectors(target.pos, s.pos);
    dist = _r.length();
    standoff = target.isStation ? 300 : Math.max(target.parkingRadius(), target.radius * 1.05);
    _v.subVectors(s.vel, target.vel);
  }
  const d = Math.max(0, dist - standoff);
  _r.multiplyScalar(1 / Math.max(dist, 1e-6));
  // plan with a margin under the drive's capability so the braking burn always fits
  const a = Math.max(0.5, s.maxAccel * 0.6);
  const speed = Math.min(Math.sqrt(2 * a * d), d / 4 + 0.5);
  _d.copy(_r).multiplyScalar(speed).sub(_v); // velocity change wanted
  const dv = _d.length();
  const closing = _v.dot(_r);
  out.state = d < 50 && dv < 2 ? 'hold' : dv < Math.max(2, speed * 0.03) ? 'coast' : closing > speed * 1.02 ? 'brake' : 'burn';
  out.dv = dv;
  if (dv > 1e-6) out.dir.copy(_d).multiplyScalar(1 / dv); else out.dir.copy(_r);
  _f.set(0, 0, -1).applyQuaternion(s.quat);
  out.error = Math.acos(Math.max(-1, Math.min(1, _f.dot(out.dir))));
  return out;
}

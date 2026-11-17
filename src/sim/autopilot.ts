import { Matrix4, Quaternion, Vector3 } from 'three';
import type { Sim } from './sim';
import { Body } from './universe';
import { clamp } from './noise';
import { portSite, siteDistance, sitePos, siteUp, type Site } from './sites';
import { PAD_TOP_M } from '../data/stations';
import type { Npc } from './npc';
import { SHIPS } from '../data/ships';

export type ApMode = 'off' | 'orbit' | 'land' | 'dock' | 'align' | 'undock' | 'rendezvous';
type DockPhase = 'approach' | 'clear' | 'align' | 'final';

const _rel = new Vector3(), _vrel = new Vector3(), _rhat = new Vector3(), _that = new Vector3();
const _vdes = new Vector3(), _ff = new Vector3(), _fb = new Vector3(), _t1 = new Vector3(), _t2 = new Vector3();
const _atgt = new Vector3(), _dir = new Vector3(), _om = new Vector3(), _t3 = new Vector3();
const ORIGIN = new Vector3();
const _sp = new Vector3(), _sh = new Vector3(), _su = new Vector3();
const _rvP = new Vector3(), _rvV = new Vector3();
const _t4 = new Vector3(), _qa = new Quaternion();
const _cg1 = new Vector3(), _cg2 = new Vector3();
const _m = new Matrix4();
const _dq = new Quaternion(), _dAxis = new Vector3(), _dLat = new Vector3(), _dWp = new Vector3();
const fmtM = (m: number) => (m < 1000 ? `${m.toFixed(0)} m` : `${(m / 1000).toFixed(2)} km`);

export class Autopilot {
  mode: ApMode = 'off';
  target: Body | null = null;
  phase = '';
  status = '';
  autoWarp = true;
  /** orbit radius goal for 'orbit' mode */
  orbitR = 0;
  private tGo = 1e9;
  private readonly cmd = new Vector3();
  private readonly attitude = new Quaternion();
  private hasAttitude = false;
  private level = false;
  private settle = 0;
  private descending = false;
  dockPhase: DockPhase = 'approach';
  private readonly face = new Vector3();
  private hasFace = false;
  private readonly faceUp = new Vector3();

  constructor(private sim: Sim) {}

  get active() { return this.mode !== 'off'; }

  get accel(): number {
    const t = this.target;
    const g = t ? t.surfaceG : 0;
    const local = this.sim.dominant ? this.sim.dominant.mu / Math.pow(this.sim.altitude + this.sim.dominant.radius, 2) : 0;
    return Math.max(60 * this.sim.ship.perf, 3 * Math.min(g, 80), 2.5 * Math.min(local, 80));
  }

  private readonly alignDir = new Vector3();
  /** attitude-only mode: point the nose along a direction and hold it (used to line up a jump) */
  engageAlign(dir: Vector3, label: string) {
    this.mode = 'align'; this.target = null;
    this.alignDir.copy(dir).normalize();
    this.begin(`Autopilot: aligning for ${label}`);
    this.autoWarp = false;
    this.status = `Aligning for ${label}`;
    this.phase = 'Align';
  }
  setAlign(dir: Vector3) { this.alignDir.copy(dir).normalize(); }

  /** manoeuvre requested while docked: carried out once the departure has cleared the station */
  private afterUndock: (() => void) | null = null;

  /**
   * Departure: release the clamps, back straight out along the docking axis to a safe distance,
   * null the drift relative to the station, then hand over to the next manoeuvre (if any).
   */
  engageUndock(then: (() => void) | null = null) {
    const st = this.sim.ship.docked;
    if (!st) { this.sim.onEvent('Not docked', 'info'); return; }
    this.mode = 'undock'; this.target = st;
    this.afterUndock = then;
    this.autoWarp = true; this.settle = 0; this.tGo = 1; this.hasAttitude = false; this.level = false; this.hasFace = false;
    this.phase = 'Releasing clamps';
    this.status = `Undocking from ${st.name}`;
    this.sim.onEvent(st.isPort ? `Autopilot: lifting off from ${st.name}` : `Autopilot: undocking from ${st.name}`, 'info');
  }

  /** while docked, run the departure first and then the requested manoeuvre; returns true if deferred */
  private deferUntilClear(next: () => void): boolean {
    if (!this.sim.ship.docked) return false;
    this.engageUndock(next);
    return true;
  }

  engageDock(st: Body) {
    if (!st.isStation) { this.sim.onEvent(`${st.name} is not a station`, 'warn'); return; }
    if (this.sim.ship.landed === st) { this.sim.onEvent(`Already docked at ${st.name}`, 'info'); return; }
    // ground spaceport: a precision landing on its pad (docking happens on touchdown)
    if (st.isPort) { this.engageLand(st.parent!, portSite(st)); return; }
    if (this.deferUntilClear(() => this.engageDock(st))) return;
    this.mode = 'dock'; this.target = st;
    this.orbitR = st.parkingRadius();
    this.dockPhase = 'approach';
    this.begin(`Autopilot: dock at ${st.name}`);
  }

  engageOrbit(target: Body, radius?: number) {
    if (this.deferUntilClear(() => this.engageOrbit(target, radius))) return;
    this.mode = 'orbit'; this.target = target;
    this.orbitR = radius ?? target.parkingRadius();
    this.begin(`Autopilot: fly to ${target.name} and enter orbit`);
  }

  engageCircularize() {
    if (this.deferUntilClear(() => this.engageCircularize())) return;
    const b = this.sim.dominant;
    const r = this.sim.ship.pos.distanceTo(b.pos);
    this.mode = 'orbit'; this.target = b;
    this.orbitR = Math.max(r, b.radius * (1 + b.surface.rel * 1.2) + Math.max(b.atmoTop * 1.2, 2000));
    this.begin(`Autopilot: circularise around ${b.name}`);
  }

  /** ship being met (rendezvous mode) */
  rv: Npc | null = null;
  /** true once alongside and matched: the autopilot then keeps station */
  rvHolding = false;

  /** fly to another ship, match its velocity and keep station a few hundred metres off */
  engageRendezvous(npc: Npc) {
    if (this.deferUntilClear(() => this.engageRendezvous(npc))) return;
    this.mode = 'rendezvous'; this.target = null; this.rv = npc; this.rvHolding = false;
    this.begin(`Autopilot: rendezvous with ${npc.name}`);
  }

  /** where to hold relative to the other ship, m (bigger when it is docked, to stay clear of the station) */
  rvStandoff(npc: Npc): number {
    const theirs = SHIPS.find(x => x.id === npc.shipId)?.length ?? 40;
    return npc.state === 'docked' ? 900 : 150 + theirs + this.sim.econ.ship.length;
  }

  /** the other ship's position and velocity extrapolated to sim time t */
  rvState(npc: Npc, t: number, pos: Vector3, vel: Vector3) {
    const tau = Math.max(0, t - npc.t);
    vel.copy(npc.vel).addScaledVector(npc.aTot, tau);
    pos.copy(npc.pos).addScaledVector(npc.vel, tau).addScaledVector(npc.aTot, 0.5 * tau * tau);
  }

  /** surface deposit to set down on (land mode), or null for "straight down" */
  site: Site | null = null;

  engageLand(target: Body, site: Site | null = null) {
    if (!target.def.landable) { this.sim.onEvent(`${target.name} has no solid surface to land on`, 'warn'); return; }
    if (this.deferUntilClear(() => this.engageLand(target, site))) return;
    this.mode = 'land'; this.target = target;
    this.site = site && site.body === target ? site : null;
    this.orbitR = target.parkingRadius();
    this.descending = false;
    this.begin(this.site?.port ? `Autopilot: land at ${this.site.name}` : this.site ? `Autopilot: land at site ${this.site.label} on ${target.name}` : `Autopilot: land on ${target.name}`);
  }

  /** facing the direction of travel rather than the thrust (attitude hysteresis) */
  private coasting = false;
  /** velocity the guidance matches (the target's, or its parent's while far from a station) */
  private refVel = new Vector3();

  /** travel mode: economy cruises at a tenth of the fast top speed (about 1/10 the fuel, ~5x the time) */
  economy = false;
  /** top cruise speed for the current trip, m/s (Infinity = fast: accelerate to the halfway point) */
  cruiseCap = Infinity;

  /** economy cruise speed for a trip of d metres at acceleration a: a tenth of the fast peak, at least 3 km/s */
  static ecoSpeed(d: number, a: number): number { return Math.max(3000, Math.sqrt(0.62 * a * d) / 10); }

  /** trip estimate (time s, delta-v m/s) at acceleration a, fast or economy */
  static trip(d: number, a: number, economy: boolean): { t: number; dv: number } {
    const peak = Math.sqrt(d * a);
    const v = economy ? Math.min(Autopilot.ecoSpeed(d, a), peak) : peak;
    return { t: d / v + v / a, dv: 2 * v };
  }

  private begin(msg: string) {
    this.autoWarp = true; this.settle = 0; this.tGo = 1; this.hasAttitude = false; this.level = false; this.hasFace = false;
    if (this.sim.ship.docked) this.sim.undock();
    // economy: cap the cruise speed for this trip (short hops are unaffected)
    this.cruiseCap = Infinity;
    if (this.economy && this.target) {
      const er0 = Math.abs(this.sim.ship.pos.distanceTo(this.target.pos) - this.orbitR);
      const cap = Autopilot.ecoSpeed(er0, this.accel);
      if (cap < Math.sqrt(2 * 0.62 * this.accel * er0)) { this.cruiseCap = cap; msg += ' (economy cruise)'; }
    }
    this.sim.onEvent(msg, 'info');
  }

  disengage(msg?: string) {
    if (this.mode === 'off') return;
    this.mode = 'off'; this.phase = ''; this.status = '';
    this.refVel.set(0, 0, 0);
    this.afterUndock = null; this.hasFace = false; this.rv = null; this.rvHolding = false;
    this.sim.ship.thrustAccel.set(0, 0, 0);
    if (this.autoWarp) this.sim.warp = 1;
    if (msg) this.sim.onEvent(msg, 'good');
  }

  onLanded() {
    if (this.mode === 'land' && this.site?.port) {
      // touched down at a spaceport: on (or close enough to) the pad counts as docking
      const s = this.sim.ship, port = this.site.port;
      const miss = siteDistance(this.site, _t1.copy(s.landedLocal).normalize());
      this.disengage();
      if (miss < 800) this.sim.dock(port);
      else this.sim.onEvent(`Landed ${fmtM(miss)} from the pad at ${port.name}`, 'warn');
      return;
    }
    if (this.mode === 'land' && this.site) {
      const s = this.sim.ship, site = this.site;
      const miss = siteDistance(site, _t1.copy(s.landedLocal).normalize());
      this.disengage();
      this.sim.onEvent(this.sim.landedSite === site
        ? `On deposit ${site.label} (${site.name}), ${fmtM(miss)} from its centre`
        : `Landed ${fmtM(miss)} from deposit ${site.label}`, this.sim.landedSite === site ? 'good' : 'warn');
      return;
    }
    if (this.mode === 'land') this.disengage();
    else if (this.mode === 'orbit' && this.sim.ship.landed !== this.target) this.disengage();
  }

  desiredWarp(): number {
    const w = clamp(this.tGo / 4, 1, 1e7);
    return w < 1.5 ? 1 : w;
  }

  maxDt(): number {
    return Math.max(this.tGo / 150, 0.004);
  }

  desiredAttitude(): Quaternion | null { return this.hasAttitude ? this.attitude : null; }

  afterFrame() {
    if (!this.active) return;
    const s = this.sim.ship;
    if (s.landed) { this.hasAttitude = false; return; }
    if (this.mode === 'rendezvous' && this.rv) {
      // burn along the thrust while closing; alongside, keep the nose on the other ship
      const fwd = _t2;
      if (!this.rvHolding && this.cmd.lengthSq() > 0.25) fwd.copy(this.cmd).normalize();
      else { this.rvState(this.rv, this.sim.t, _rvP, _rvV); fwd.subVectors(_rvP, s.pos); if (fwd.lengthSq() < 1) { this.hasAttitude = false; return; } fwd.normalize(); }
      const up = _t1.set(0, 1, 0).applyQuaternion(s.quat);
      up.addScaledVector(fwd, -up.dot(fwd));
      if (up.lengthSq() < 1e-6) up.set(1, 0, 0).applyQuaternion(s.quat).addScaledVector(fwd, -fwd.x);
      up.normalize();
      _m.lookAt(ORIGIN, fwd, up);
      this.attitude.setFromRotationMatrix(_m);
      this.hasAttitude = true;
      return;
    }
    if (this.mode === 'align') {
      // keep the current roll as far as possible while swinging the nose onto the jump vector
      const up = _t1.set(0, 1, 0).applyQuaternion(s.quat);
      up.addScaledVector(this.alignDir, -up.dot(this.alignDir));
      if (up.lengthSq() < 1e-6) up.set(1, 0, 0).addScaledVector(this.alignDir, -this.alignDir.x);
      up.normalize();
      _m.lookAt(_t2.set(0, 0, 0), this.alignDir, up);
      this.attitude.setFromRotationMatrix(_m);
      this.hasAttitude = true;
      return;
    }
    // point the nose along thrust; when landing, stay level
    const tgt = this.target!;
    const up = _t1.subVectors(s.pos, tgt.pos).normalize();
    const fwd = _t2;
    if (this.hasFace) {
      // docking: nose points at the port, roll locked to the station
      fwd.copy(this.face); up.copy(this.faceUp);
    } else if (this.level) {
      // wings level, nose on the horizon: keep the current heading, or if the nose points straight
      // up/down, head along the ground track (else any horizontal direction)
      fwd.set(0, 0, -1).applyQuaternion(s.quat);
      fwd.addScaledVector(up, -fwd.dot(up));
      if (fwd.lengthSq() < 0.09) {
        fwd.subVectors(s.vel, tgt.vel);
        fwd.addScaledVector(up, -fwd.dot(up));
        if (fwd.lengthSq() < 1) fwd.set(1, 0, 0).addScaledVector(up, -up.x);
      }
      fwd.normalize();
    } else {
      // small trim corrections (holding the economy cruise speed, countering a planet's pull) don't
      // swing the nose around: below a few % of full thrust the ship faces its direction of travel.
      // Hysteresis stops it flicking between the two when the trim hovers near the limit.
      const lim = Math.max(0.5, 0.03 * this.accel) * (this.coasting ? 1.5 : 1);
      this.coasting = this.cmd.length() < lim;
      if (this.coasting) {
        // coasting: face prograde relative to target
        fwd.subVectors(s.vel, (this.mode === 'orbit' || this.mode === 'dock' || this.mode === 'land') && this.refVel.lengthSq() > 0 ? this.refVel : tgt.vel);
        if (fwd.lengthSq() < 1) { this.hasAttitude = false; return; }
        fwd.normalize();
      } else fwd.copy(this.cmd).normalize();
      // nose along the local vertical: there is no horizon to level the wings against, so keep
      // the ship's current roll instead of snapping to an arbitrary axis
      // (well short of exactly vertical: heading straight at a target, the leftover sideways part of
      // the radial is tiny and swings round with an orbiting station, spinning the roll)
      if (Math.abs(fwd.dot(up)) > 0.85) {
        up.set(0, 1, 0).applyQuaternion(s.quat);
        up.addScaledVector(fwd, -up.dot(fwd));
        if (up.lengthSq() < 1e-6) up.set(1, 0, 0).applyQuaternion(s.quat);
        up.normalize();
      }
    }
    // (the eye must be its own vector: `up` lives in _t1)
    _m.lookAt(ORIGIN, fwd, up);
    this.attitude.setFromRotationMatrix(_m);
    this.hasAttitude = true;
  }

  /** compute commanded thrust acceleration (world frame) for this substep */
  control(dt: number, gShip: Vector3, out: Vector3) {
    if (this.mode === 'align') { out.set(0, 0, 0); this.tGo = 1e9; return; }
    if (this.mode === 'rendezvous') { this.rendezvousControl(dt, gShip, out); return; }
    const sim = this.sim, s = sim.ship, tgt = this.target!;
    if (tgt.system !== sim.system) { this.disengage(); out.set(0, 0, 0); return; }
    const amax = this.accel;
    // Far from an orbital station, fly to the body it orbits rather than chasing the station itself:
    // at high time warp a station circles its planet in seconds, so aiming at (and matching the
    // velocity of) its current position swings the commanded thrust round and round — shaking the
    // ship — and every so often points the approach at the far side of the planet. Instead aim at the
    // point of the station's orbit facing us and match the planet's motion, blending over to the
    // station itself on the way in.
    tgt.accel(_atgt);
    this.refVel.copy(tgt.vel);
    _rel.subVectors(s.pos, tgt.pos);
    const par = tgt.isStation && !tgt.isPort ? tgt.parent : null;
    if (par) {
      const tr = tgt.pos.distanceTo(par.pos);
      _t2.subVectors(s.pos, par.pos);
      const dp = _t2.length();
      // (only far out, where the shaking happens; the final approach flies to the station itself)
      const w = tr > 0 ? clamp((dp / tr - 4) / 12, 0, 1) : 0;
      if (w > 0) {
        // aim point: on the station's orbit, on our side of the planet
        _t2.multiplyScalar(tr / dp).add(par.pos);
        _t2.lerp(tgt.pos, 1 - w);
        _rel.subVectors(s.pos, _t2);
        this.refVel.lerp(par.vel, w);
        par.accel(_t2);
        _atgt.lerp(_t2, w);
      }
    }
    const d = _rel.length();
    _rhat.copy(_rel).multiplyScalar(1 / d);
    _vrel.subVectors(s.vel, this.refVel);

    if (this.mode === 'undock') { this.undockControl(dt, gShip, out, amax); return; }
    if (this.mode === 'land') {
      const near = d < this.orbitR * 1.6;
      if (near || this.descending) { this.descending = true; this.descend(dt, gShip, out, amax, d); return; }
    }
    if (this.mode === 'dock' && this.dockPhase === 'approach' && d < 3500 && _vrel.length() < 25) this.dockPhase = 'clear';
    if (this.mode === 'dock' && this.dockPhase !== 'approach') { this.dockControl(dt, gShip, out, amax); return; }
    this.level = false;
    this.hasFace = false;

    // ---------- approach + orbit insertion (target-centred frame)
    const rO = this.orbitR;
    const er = d - rO;
    const gT = tgt.mu / (d * d);
    const ab = Math.max(0.25 * amax, 0.62 * amax - (er > 0 ? gT : 0));
    const vr = _vrel.dot(_rhat);
    const forLanding = this.mode === 'land';
    let f = forLanding ? 0 : clamp(1 - Math.abs(er) / (0.45 * rO), 0, 1);
    f = f * f * (3 - 2 * f);
    const vcirc = Math.sqrt(tgt.mu / d);
    // sqrt braking profile far away, linear (finite gain) close in to avoid chattering
    const vrDes = -Math.sign(er) * Math.min(2.5e7, Math.sqrt(2 * ab * Math.abs(er)), Math.abs(er) / 6, this.cruiseCap);

    // tangential direction: keep existing sense of motion if there is one, else prograde with body spin
    _t1.copy(_vrel).addScaledVector(_rhat, -vr);
    if (_t1.lengthSq() > (0.25 * vcirc) ** 2 && f > 0) _that.copy(_t1).normalize();
    else {
      _that.crossVectors(tgt.isStar ? _t2.set(0, 1, 0) : tgt.axis, _rhat);
      if (_that.lengthSq() < 1e-6) _that.set(1, 0, 0).addScaledVector(_rhat, -_rhat.x);
      _that.normalize();
    }

    // approach direction with obstacle avoidance
    _dir.copy(_rhat).multiplyScalar(Math.sign(vrDes) || -1);
    if (er > 0) this.avoid(_dir, d);
    _vdes.copy(_dir).multiplyScalar(Math.abs(vrDes)).addScaledVector(_that, vcirc * f);

    // feed-forward: desired centripetal accel minus net natural accel in the target frame
    const tau = Math.max(4 * dt, 1.5);
    _ff.copy(_atgt).sub(gShip).addScaledVector(_rhat, -vcirc * vcirc * f * f / d);
    _fb.subVectors(_vdes, _vrel).multiplyScalar(1 / tau);
    // holding the economy cruise speed: tolerate a band of ±1% before correcting, ramping up to full
    // correction by 3%. Servoing it exactly overshoots at high time warp and flips the thrust (and
    // the nose) back and forth every few frames.
    if (this.cruiseCap < Infinity && f === 0 && Math.abs(vrDes) >= this.cruiseCap * 0.999) {
      const err = _t1.subVectors(_vdes, _vrel).length() / this.cruiseCap;
      _fb.multiplyScalar(clamp((err - 0.01) / 0.02, 0, 1));
    }
    const ffl = _ff.length();
    _fb.clampLength(0, Math.max(amax - ffl, amax * 0.3));
    out.copy(_ff).add(_fb).clampLength(0, amax);
    // landing approaches take care of their own height; everything else must not sink into terrain
    if (!(this.mode === 'land' && this.descending)) this.climbGuard(out, amax, dt, gShip);
    if (out.lengthSq() < 1e-6) out.set(0, 0, 0);
    this.cmd.copy(out);

    // time-to-go estimate (drives time warp and step size)
    const dv = _t1.subVectors(_vdes, _vrel).length();
    const tPos = Math.min(Math.abs(er) / (Math.abs(vr) + 1e-3), 2 * Math.sqrt(Math.abs(er) / amax) + 1);
    this.tGo = Math.max(tPos, dv / amax, 0.5);

    if (f > 0.5) { this.phase = 'Orbit insertion'; }
    else this.phase = er > 0 ? (vr < -1 && Math.abs(vr) > Math.sqrt(2 * ab * Math.abs(er)) * 0.9 ? 'Braking' : this.cruiseCap < Infinity ? 'Economy cruise' : 'Cruise') : 'Ascent';
    this.status = `${this.phase} → ${tgt.name}`;

    if (this.mode === 'orbit' && Math.abs(er) < 0.015 * rO && dv < 0.004 * vcirc + 0.02) {
      this.settle += dt;
      if (this.settle > 2) this.disengage(`Orbit established around ${tgt.name}`);
    } else this.settle = 0;
  }

  /** close-range docking: swing round to the port axis, then creep in along it */
  private dockControl(dt: number, gShip: Vector3, out: Vector3, amax: number) {
    const sim = this.sim, s = sim.ship, st = this.target!;
    const q = st.orientation(sim.t, _dq);
    const axis = _dAxis.set(0, 1, 0).applyQuaternion(q);
    const portD = sim.dockOffset();
    const along = _rel.dot(axis);
    const lat = _dLat.copy(_rel).addScaledVector(axis, -along);
    const latLen = lat.length();
    if (latLen > 1e-3) lat.multiplyScalar(1 / latLen);
    else lat.set(1, 0, 0).addScaledVector(axis, -axis.x).normalize();
    const hold = portD + 350;

    // pick the current waypoint
    const wp = _dWp;
    let vmax = 140, finalLeg = false;
    if (this.dockPhase === 'clear') {
      // below or beside the station: move out sideways first so we never fly through it
      if (along < portD + 120 && latLen < 520) wp.copy(st.pos).addScaledVector(lat, 650).addScaledVector(axis, along);
      else { this.dockPhase = 'align'; }
    }
    if (this.dockPhase === 'align') {
      wp.copy(st.pos).addScaledVector(axis, hold);
      if (_t1.subVectors(s.pos, wp).length() < 20 && _vrel.length() < 3) this.dockPhase = 'final';
    }
    if (this.dockPhase === 'final') {
      wp.copy(st.pos).addScaledVector(axis, portD);
      vmax = 2 + Math.max(0, along - portD) / 12;
      finalLeg = true;
    }
    if (this.dockPhase === 'clear') {
      if (!(along < portD + 120 && latLen < 520)) wp.copy(st.pos).addScaledVector(axis, hold);
    }

    // velocity command towards the waypoint (relative to the station)
    const toWp = _t1.subVectors(wp, s.pos);
    const dist = toWp.length();
    const brake = 0.35 * amax;
    let speed = Math.min(Math.sqrt(2 * brake * dist), dist / 5 + 0.2, vmax);
    if (finalLeg) {
      // stay on the axis: lateral error is corrected separately and strongly
      const ax = Math.max(0, along - portD);
      speed = Math.min(ax / 10 + 0.4, vmax);
      _vdes.copy(axis).multiplyScalar(-speed).addScaledVector(lat, -latLen / 3);
    } else {
      _vdes.copy(toWp).multiplyScalar(dist > 1e-6 ? speed / dist : 0);
    }
    _ff.copy(_atgt).sub(gShip);
    _fb.subVectors(_vdes, _vrel).multiplyScalar(1 / Math.max(4 * dt, 1.0));
    _fb.clampLength(0, Math.max(amax - _ff.length(), amax * 0.3));
    out.copy(_ff).add(_fb).clampLength(0, amax);
    this.cmd.copy(out);

    // attitude: nose at the station's port, stable roll
    this.face.copy(axis).negate();
    this.faceUp.copy(lat);
    this.hasFace = this.dockPhase !== 'clear' || dist < 900;
    this.level = false;
    const vr = _vrel.length();
    this.tGo = Math.max(dist / Math.max(speed, 0.5), vr / amax, 0.5);
    this.phase = this.dockPhase === 'final' ? 'Final approach' : this.dockPhase === 'align' ? 'Aligning with port' : 'Manoeuvring';
    this.status = `${this.phase} → ${st.name}`;

    if (finalLeg && along - portD < 1.5 && latLen < 3 && vr < 1.2) {
      this.mode = 'off'; this.phase = ''; this.status = ''; this.hasFace = false;
      sim.ship.thrustAccel.set(0, 0, 0);
      // no thrust on the docking step, or the same substep would read it as an undock command
      out.set(0, 0, 0);
      sim.dock(st);
    }
  }

  /** departure: back straight out of the port (nose still towards the station), then stop */
  private undockControl(dt: number, gShip: Vector3, out: Vector3, amax: number) {
    const sim = this.sim, s = sim.ship, st = this.target!;
    const q = st.orientation(sim.t, _dq);
    const axis = _dAxis.set(0, 1, 0).applyQuaternion(q);
    const pad = st.isPort;
    const port = pad ? PAD_TOP_M + s.gear : sim.dockOffset();
    const clear = pad ? 1500 : port + 1300;
    const along = _rel.dot(axis);
    const lat = _dLat.copy(_rel).addScaledVector(axis, -along);
    if (pad) {
      // lifting off a ground pad: rise straight up, wings level
      this.face.set(0, 0, -1).applyQuaternion(q);
      this.faceUp.copy(axis);
    } else {
      // hold the docked attitude while reversing out, so the departure is a straight backwards slide
      this.face.copy(axis).negate();
      this.faceUp.set(0, 0, 1).applyQuaternion(q);
    }
    this.hasFace = true; this.level = false;

    const togo = clear - along;
    // creep away from the port, speed up once clear of the structure, brake to a stop at the hold point
    const speed = Math.sign(togo) * Math.min(Math.sqrt(2 * 0.25 * amax * Math.abs(togo)), Math.abs(togo) / 6 + 0.3,
      2 + Math.max(0, along - port) / 8, 60);
    _vdes.copy(axis).multiplyScalar(speed).addScaledVector(lat, -1 / 3);
    _ff.copy(_atgt).sub(gShip);
    _fb.subVectors(_vdes, _vrel).multiplyScalar(1 / Math.max(4 * dt, 1.0));
    _fb.clampLength(0, Math.max(amax - _ff.length(), amax * 0.3));
    out.copy(_ff).add(_fb).clampLength(0, amax);
    this.cmd.copy(out);

    const vr = _vrel.length();
    // keep time warp modest this close to a station
    this.tGo = Math.min(20, Math.max(Math.abs(togo) / Math.max(Math.abs(speed), 0.5), vr / amax, 0.5));
    this.phase = s.landed ? (pad ? 'Lift-off' : 'Releasing clamps') : togo > 8 ? (pad ? 'Climbing' : 'Backing out') : 'Holding';
    this.status = `${this.phase} · ${st.name} ${s.landed ? '' : `${fmtM(Math.max(0, along - port))}`}`.trim();

    if (!s.landed && Math.abs(togo) < 8 && vr < 0.6) {
      this.settle += dt;
      if (this.settle > 1) {
        const next = this.afterUndock;
        this.afterUndock = null;
        this.mode = 'off'; this.phase = ''; this.status = ''; this.hasFace = false;
        s.thrustAccel.set(0, 0, 0);
        out.set(0, 0, 0);
        if (this.autoWarp) sim.warp = 1;
        sim.onEvent(`Clear of ${st.name}`, 'good');
        // off a ground pad there is nowhere to hover: carry on up to a parking orbit unless told otherwise
        if (next) next(); else if (st.isPort) this.engageOrbit(st.parent!);
      }
    } else this.settle = 0;
  }

  /** close on another ship along an accelerate–brake profile, match its motion, then keep station */
  private rendezvousControl(dt: number, gShip: Vector3, out: Vector3) {
    const sim = this.sim, s = sim.ship, n = this.rv!;
    if (!sim.traffic.npcs.includes(n)) { this.disengage(); sim.onEvent(`${n.name} is no longer in this system — rendezvous cancelled`, 'warn'); out.set(0, 0, 0); return; }
    const amax = this.accel;
    this.rvState(n, sim.t, _rvP, _rvV);
    const standoff = this.rvStandoff(n);
    _rel.subVectors(s.pos, _rvP);
    const d = Math.max(_rel.length(), 1e-6);
    _rhat.copy(_rel).multiplyScalar(1 / d); // from them towards us
    const err = d - standoff;              // > 0: still too far
    const a = 0.35 * amax;
    const speed = Math.sign(err) * Math.min(Math.sqrt(2 * a * Math.abs(err)), Math.abs(err) / 5 + 0.1);
    // head for them, bending the path around any planet or moon in the way (a straight line to a
    // ship on the far side of a planet would go through it); this also climbs off a surface
    _dir.copy(_rhat).negate();
    if (err > 2e4) this.avoid(_dir, d);
    _vdes.copy(_rvV).addScaledVector(_dir, speed);
    // feed-forward their acceleration (less the gravity we feel anyway), feedback on the velocity error
    _ff.copy(n.aTot).sub(gShip);
    _fb.subVectors(_vdes, s.vel).multiplyScalar(1 / Math.max(4 * dt, 1.0));
    _fb.clampLength(0, Math.max(amax - _ff.length(), amax * 0.3));
    out.copy(_ff).add(_fb).clampLength(0, amax);
    this.climbGuard(out, amax, dt, gShip);
    if (out.lengthSq() < 1e-8) out.set(0, 0, 0);
    this.cmd.copy(_fb);
    this.level = false; this.hasFace = false;
    const vr = _vrel.subVectors(s.vel, _rvV).length();
    const holding = Math.abs(err) < 60 && vr < 2;
    if (holding && !this.rvHolding) {
      this.rvHolding = true;
      // alongside: back to real time; the pilot can warp freely while the autopilot keeps station
      if (this.autoWarp) sim.warp = 1;
      this.autoWarp = false;
      sim.onEvent(`Rendezvous with ${n.name} complete — holding station ${fmtM(d)} off. X to release.`, 'good');
    } else if (this.rvHolding && (Math.abs(err) > 2000 || vr > 50)) this.rvHolding = false;
    const dv = _t1.subVectors(_vdes, s.vel).length();
    this.tGo = Math.max(Math.abs(err) / Math.max(Math.abs(speed), 0.5), dv / amax, 0.5);
    if (this.rvHolding) this.tGo = Math.min(this.tGo, 30);
    const closing = -_t1.subVectors(s.vel, _rvV).dot(_rhat);
    this.phase = this.rvHolding ? 'Holding station' : err > 0 && closing > Math.abs(speed) * 1.05 ? 'Braking' : err > 0 ? 'Closing' : 'Opening range';
    this.status = `${this.phase} · ${n.name} ${fmtM(d)}`;
  }

  private descend(dt: number, gShip: Vector3, out: Vector3, amax: number, d: number) {
    const sim = this.sim, s = sim.ship, b = this.target!;
    _om.copy(b.axis).multiplyScalar(b.rotRate);
    // surface-relative velocity
    _t1.crossVectors(_om, _rel);
    const vs = _t2.subVectors(_vrel, _t1);
    let h = sim.dominant === b && sim.nearGround ? Math.max(sim.radarAlt, 0) : d - b.radius * (1 + b.surface.rel * 2.2 + 0.03);
    // look ahead along the ground track: terrain the ship will cross in the next ~12 s counts as
    // "below", so rising ground makes it climb (or slow) before it gets there, not when it's underneath
    if (sim.dominant === b && sim.nearGround) {
      const hz = _t3.copy(vs).addScaledVector(_rhat, -vs.dot(_rhat));
      const spd = hz.length();
      if (spd > 5) {
        hz.multiplyScalar(1 / spd);
        const L = Math.min(spd * 12, 40000);
        b.orientation(sim.t, _qa).invert();
        for (const k of [0.25, 0.5, 0.75, 1]) {
          _t4.copy(_rel).addScaledVector(hz, L * k).normalize().applyQuaternion(_qa);
          const ahead = d - b.radius - b.surface.height(_t4.x, _t4.y, _t4.z, 0) - s.gear;
          if (ahead < h) h = Math.max(0, ahead);
        }
      }
    }
    const g = b.mu / (d * d);
    const av = Math.max(0.3 * amax, amax - g) * 0.45;
    // braking curve far out, gentle linear profile (≈1.5 m/s touchdown) for the last stretch
    let vdown = Math.min(Math.sqrt(2 * av * Math.max(h - 1.5, 0)), Math.max(h - 1, 0) / 5, 4000) + 1.2;
    _vdes.copy(_rhat).multiplyScalar(-vdown);
    // landing site: fly across to it at a safe height (lower as it gets closer), then let down onto it
    let D = 0, vh = 0;
    const site = this.site;
    if (site) {
      sitePos(site, sim.t, _sp);
      _sh.subVectors(_sp, s.pos);
      _sh.addScaledVector(_rhat, -_sh.dot(_rhat)); // horizontal: along the great circle to the site
      const ang = Math.acos(clamp(_rhat.dot(siteUp(site, sim.t, _su)), -1, 1));
      D = ang > 0.02 ? ang * b.radius : _sh.length();
      if (_sh.lengthSq() > 1e-9) _sh.normalize(); else _sh.set(0, 0, 0);
      const vcirc = Math.sqrt(b.mu / d);
      vh = D < 0.3 ? 0 : Math.min(Math.sqrt(2 * 0.25 * amax * D), D / 4 + 0.2, 0.7 * vcirc, 3000);
      // clearance over the terrain while crossing; none for the last few tens of metres. With an
      // atmosphere, long crossings stay above it and only the last ~150 km is flown inside it
      const air = b.atmoTop > 0;
      const hMin = D > 25 ? (air && D > 150e3 ? b.atmoTop * 1.05 : Math.min(D * 0.35, 15000) + 40) : 0;
      let vv: number;
      if (h > hMin) {
        const hh = h - hMin;
        vv = -(Math.min(Math.sqrt(2 * av * Math.max(hh - 1.5, 0)), Math.max(hh - 1, 0) / 5, 4000) + (hMin > 0 ? 0 : 1.2));
      } else vv = Math.min((hMin - h) / 4 + 1, 60);
      // inside an atmosphere keep speeds reasonable: slower the thicker the air
      if (air && h < b.atmoTop) {
        const cap = 120 + 1800 * Math.pow(Math.max(0, h) / b.atmoTop, 1.5);
        vh = Math.min(vh, cap); vv = Math.max(vv, -cap);
      }
      vdown = Math.max(1.2, -vv);
      _vdes.copy(_rhat).multiplyScalar(vv).addScaledVector(_sh, vh);
    }
    const tau = Math.max(4 * dt, h < 2000 ? 0.6 : 1.5);
    // feed-forward: frame acceleration (body accel + centripetal) minus gravity
    _ff.copy(_atgt).sub(gShip).add(_t1.crossVectors(_om, _t1));
    _fb.subVectors(_vdes, vs).multiplyScalar(1 / tau);
    const horiz = _t1.copy(vs).addScaledVector(_rhat, -vs.dot(_rhat)).length();
    const ffl = _ff.length();
    _fb.clampLength(0, Math.max(amax - ffl, amax * 0.3));
    out.copy(_ff).add(_fb).clampLength(0, amax);
    this.cmd.copy(out);
    // the autopilot never lands gear-up: put the selector back to AUTO for the final approach
    if (h < 5000 && sim.gearCmd === 'up') { sim.gearCmd = 'auto'; sim.onEvent('Autopilot: landing gear set to AUTO', 'info'); }
    // wings are always level during the descent (roll locked to the local horizon). The nose follows
    // the thrust while braking mostly horizontally, and sits on the horizon for near-vertical
    // braking and the whole final approach, so touchdown needs no last-moment correction.
    const up = Math.abs(_t3.copy(out).normalize().dot(_rhat));
    if (h < 3000 || up > 0.75 || out.lengthSq() < 1e-6) this.level = true;
    else if (up < 0.6) this.level = false;
    const vv = Math.abs(vs.dot(_rhat));
    this.tGo = Math.max(horiz / amax, h / (Math.max(vv, vdown) + 0.5), site ? D / Math.max(vh, 0.5) : 0, 0.5);
    if (site) {
      const where = site.port ? site.name : `site ${site.label}`;
      this.phase = D > 60 ? `Transfer to ${where}` : h > 3000 ? 'Descent' : 'Final approach';
      this.status = site.port ? `${this.phase} → ${site.name} ${fmtM(D)}` : `${this.phase} → ${b.name} · site ${site.label} ${fmtM(D)}`;
      return;
    }
    this.phase = horiz > 50 ? 'Deorbit burn' : h > 3000 ? 'Descent' : 'Final approach';
    this.status = `${this.phase} → ${b.name}`;
  }

  /**
   * Terrain-clearance guard: low over a solid body (below its highest terrain plus a margin) the ship
   * must be climbing; if it isn't, the upward part of the thrust is raised to make it climb, and the
   * sideways part gets what's left. Stops velocity-matching manoeuvres (e.g. towards a station that
   * is moving fast relative to the ground) from dragging the ship into the surface.
   */
  private climbGuard(out: Vector3, amax: number, dt: number, gShip: Vector3) {
    const sim = this.sim, s = sim.ship, b = sim.dominant;
    if (b.isStar || b.isStation || !b.def.landable) return;
    const up = _cg1.subVectors(s.pos, b.pos);
    const alt = up.length() - b.radius;
    up.normalize();
    // highest terrain plus a margin (smaller on little bodies, so it stays below their parking orbit)
    const park = b.parkingRadius() - b.radius;
    const floor = Math.min(b.radius * b.surface.rel * 2.2 + Math.min(10e3, 0.5 * park), 0.85 * park);
    if (alt > floor) return;
    // wanted climb rate: brisk near the ground, easing off towards the floor
    const want = Math.min(400, (floor - alt) / 20 + 40);
    const vr = _cg2.subVectors(s.vel, b.vel).dot(up);
    if (vr >= want) return;
    const needUp = Math.min(amax, (want - vr) / Math.max(4 * dt, 2) - gShip.dot(up));
    const curUp = out.dot(up);
    if (curUp >= needUp) return;
    // raise the vertical component, keep as much of the sideways component as still fits
    const side = _cg2.copy(out).addScaledVector(up, -curUp);
    const room = Math.sqrt(Math.max(0, amax * amax - needUp * needUp));
    if (side.length() > room) side.setLength(room);
    out.copy(side).addScaledVector(up, needUp);
  }

  /** bend the approach direction around bodies that block the straight line */
  private avoid(dir: Vector3, distToTarget: number) {
    const sim = this.sim, s = sim.ship;
    const tgt = this.target;
    for (const b of sim.relevant) {
      if (b === tgt || b.isStation) continue;
      const c = _t1.subVectors(b.pos, s.pos);
      const cl = c.length();
      let safe = (b.isStar ? 4 : 1.25) * (b.radius + b.atmoTop) + 20e3;
      // a target close to this body (a station in low orbit, a ground base…) lies inside that generous
      // zone; then just keep well clear of the terrain on the way
      if (tgt) {
        const tr = tgt.pos.distanceTo(b.pos);
        if (tr < safe) {
          const skim = Math.max(b.radius * (1 + b.surface.rel * 2.2) + Math.min(15e3, Math.max(0, tr - b.radius) * 0.5), b.radius * 1.001);
          // keep the full clearance while still far from the target and only close in on the way:
          // swinging round a moon at speed towards a low-orbit station behind it skims the ground
          safe = Math.max(skim, Math.min(safe, b.radius + 0.3 * distToTarget));
        }
      }
      // does the straight path to the target (not just the body's centre) come within that distance?
      const proj = c.dot(dir);
      if (proj < 0 && cl > safe) continue;
      const tc = Math.max(0, Math.min(distToTarget, proj));
      const closest2 = cl * cl - 2 * tc * proj + tc * tc;
      if (closest2 > safe * safe && cl > safe) continue;
      const sinA = Math.min(1, safe / cl);
      const alpha = Math.asin(sinA) + (cl < safe ? 0.25 : 0.03);
      const chat = c.multiplyScalar(1 / cl);
      const cosNow = dir.dot(chat);
      if (cosNow <= Math.cos(alpha)) continue;
      // rotate dir away from the body centre to angle alpha
      const n = _t2.copy(dir).addScaledVector(chat, -cosNow);
      if (n.lengthSq() < 1e-10) n.set(0, 1, 0).addScaledVector(chat, -chat.y);
      n.normalize();
      dir.copy(chat).multiplyScalar(Math.cos(alpha)).addScaledVector(n, Math.sin(alpha)).normalize();
    }
  }
}

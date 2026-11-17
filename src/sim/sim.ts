import { Matrix4, Quaternion, Vector3 } from 'three';
import { Body, StarSystem, Universe, simTimeNow } from './universe';
import { Autopilot } from './autopilot';
import { Economy } from './economy';
import { COMMODITIES } from '../data/commodities';
import { NpcTraffic } from './npc';
import { Career } from './career';
import { Pirates } from './pirates';
import { PAD_TOP_M } from '../data/stations';
import { siteAt, sitesFor, type Site } from './sites';
import { clamp } from './noise';

export const WARP_LEVELS = [1, 2, 5, 10, 50, 100, 1000, 1e4, 1e5, 1e6, 1e7];
export const THRUST_LEVELS = [0.5, 2, 5, 10, 20, 50, 100, 300];
const DRAG_B = 4e-4; // Cd*A/m, m^2/kg

const _a = new Vector3(), _b = new Vector3(), _c = new Vector3(), _d = new Vector3();
const _q = new Quaternion(), _q2 = new Quaternion(), _q3 = new Quaternion();
const _zero = new Vector3();
const _m = new Matrix4();

export interface OrbitInfo {
  body: Body; a: number; e: number; rp: number; ra: number; period: number;
  h: Vector3; evec: Vector3; bound: boolean;
}

export class Ship {
  readonly pos = new Vector3();
  readonly vel = new Vector3();
  readonly quat = new Quaternion();
  /** body rates: pitch(x), yaw(y), roll(z) rad/s */
  readonly angVel = new Vector3();
  /** manual inputs, each -1..1. thrust: x right, y up, z back (so forward = -z) */
  readonly thrustInput = new Vector3();
  readonly rotInput = new Vector3();
  thrustLevel = 3;
  /** acceleration applied by engines during the last step, world frame */
  readonly thrustAccel = new Vector3();
  landed: Body | null = null;
  readonly landedLocal = new Vector3();
  readonly landedQuat = new Quaternion();
  /** engine performance multiplier (ship class, cargo load) */
  perf = 1;
  /** height of the ship's origin above the ground when resting on its gear, m */
  gear = 3.2;
  get maxAccel() { return THRUST_LEVELS[this.thrustLevel] * this.perf; }
  get docked(): Body | null { return this.landed && this.landed.isStation ? this.landed : null; }
}

export class Sim {
  readonly universe = new Universe();
  system: StarSystem;
  t = simTimeNow();
  warp = 1;
  effWarp = 1;
  warpLimited = false;
  readonly ship = new Ship();
  readonly ap: Autopilot;
  relevant: Body[] = [];
  // derived state, refreshed each frame
  dominant!: Body;
  /** altitude above reference radius of dominant body */
  altitude = 0;
  /** altitude above terrain (valid when nearGround) */
  radarAlt = Infinity;
  nearGround = false;
  readonly vSurf = new Vector3();
  vertSpeed = 0;
  dynPressure = 0;
  heat = 0;
  density = 0;
  gForce = 0;
  orbit: OrbitInfo | null = null;
  onEvent: (msg: string, kind?: 'info' | 'warn' | 'good') => void = () => {};
  onJump: (from: StarSystem, to: StarSystem) => void = () => {};
  private minDyn = Infinity;
  private readonly grav = new Vector3();

  readonly econ = new Economy();
  /** background NPC ships in the current system */
  readonly traffic: NpcTraffic = new NpcTraffic(this);
  /** contracts, running costs, ledger, fleet */
  readonly career: Career = new Career(this);
  /** raider encounters */
  readonly pirates: Pirates = new Pirates(this);

  constructor() {
    this.system = this.universe.get('sol');
    this.ap = new Autopilot(this);
    const loaded = this.econ.load();
    // resume where the last session docked; a new career starts docked at Gateway Station
    let start = 'st_gateway', sys = 'sol';
    if (loaded && this.econ.dockedAt && this.econ.systemId && this.universe.systems.some(s => s.id === this.econ.systemId)) {
      start = this.econ.dockedAt; sys = this.econ.systemId;
    }
    if (loaded && this.econ.savedT && isFinite(this.econ.savedT)) this.t = Math.max(this.t, this.econ.savedT);
    this.econ.career = this.career;
    this.career.load(this.econ.careerData, this.t);
    this.system = this.universe.get(sys);
    this.system.update(this.t);
    this.applyShipClass();
    // not docked last time: put the ship back where it was (landed, or flying near a body)
    if (loaded && !this.econ.dockedAt && this.econ.systemId && this.restorePlace(this.econ.systemId)) { this.refreshDerived(); return; }
    const st = this.system.byId.get(start) ?? this.universe.get('sol').byId.get('st_gateway')!;
    if (st.system !== this.system) { this.system = st.system; this.system.update(this.t); }
    this.dock(st, true);
    this.refreshDerived();
  }

  /** record where the ship is (for the save) when it is not docked */
  savePlace() {
    const s = this.ship, e = this.econ;
    if (s.docked) { e.place = undefined; return; }
    if (s.landed) {
      e.place = { body: s.landed.id, landed: true, pos: s.landedLocal.toArray(), vel: [0, 0, 0], quat: s.landedQuat.toArray() };
    } else {
      const b = this.dominant;
      e.place = { body: b.id, landed: false, pos: _a.subVectors(s.pos, b.pos).toArray(), vel: _b.subVectors(s.vel, b.vel).toArray(), quat: s.quat.toArray() };
    }
  }

  /** save the career including the ship's current whereabouts */
  saveGame() {
    this.savePlace();
    this.econ.save({ docked: this.ship.docked?.id, system: this.system.id, t: this.t });
  }

  private restorePlace(sysId: string): boolean {
    const pl = this.econ.place, sys = this.universe.systems.find(x => x.id === sysId);
    if (!pl || !sys) return false;
    const b = sys.byId.get(pl.body);
    if (!b) return false;
    this.system = sys;
    sys.update(this.t);
    const s = this.ship;
    s.angVel.set(0, 0, 0);
    if (pl.landed && !b.isStation) {
      s.landedLocal.fromArray(pl.pos);
      s.landedQuat.fromArray(pl.quat);
      s.landed = b;
      this.placeLanded();
    } else {
      s.landed = null;
      s.pos.fromArray(pl.pos).add(b.pos);
      s.vel.fromArray(pl.vel).add(b.vel);
      s.quat.fromArray(pl.quat);
    }
    this.dominant = sys.dominant(s.pos);
    this.selectRelevant();
    return true;
  }

  /** refresh ship performance after a class change or cargo change */
  applyShipClass() {
    const c = this.econ.ship;
    const load = this.econ.cargoUsed / Math.max(1, c.cargo);
    this.ship.perf = c.perf * (1 - 0.25 * load);
    this.ship.gear = c.length * 0.16 + 1.5;
  }

  /** distance from station centre to ship centre while docked */
  dockOffset(): number { return 150 + this.econ.ship.length * 0.5 + 4; }

  /** attach the ship to a station's docking port */
  dock(st: Body, silent = false) {
    const s = this.ship;
    st.updateTo(this.t);
    // port is on the station's +Y (spin) axis; the ship hangs nose-first above it
    this.dryWarned = false;
    if (st.isPort) {
      // ground spaceport: standing level on the landing deck
      s.landedLocal.set(0, PAD_TOP_M + s.gear, 0);
      s.landedQuat.identity();
    } else {
      s.landedLocal.set(0, this.dockOffset(), 0);
      _m.lookAt(new Vector3(), new Vector3(0, -1, 0), new Vector3(0, 0, 1));
      s.landedQuat.setFromRotationMatrix(_m);
    }
    s.landed = st;
    s.angVel.set(0, 0, 0);
    s.thrustInput.set(0, 0, 0);
    this.placeLanded();
    this.warp = 1;
    this.econ.save({ docked: st.id, system: this.system.id, t: this.t });
    if (!silent) this.onEvent(`Docked at ${st.name}`, 'good');
    if (!silent) this.career.onDocked(st);
    this.onDock(st, silent);
  }
  onDock: (st: Body, silent: boolean) => void = () => {};

  undock() {
    const s = this.ship, st = s.landed;
    if (!st) return;
    st.orientation(this.t, _q);
    const axis = _a.set(0, 1, 0).applyQuaternion(_q);
    s.landed = null;
    s.pos.addScaledVector(axis, 2);
    s.vel.addScaledVector(axis, 3);
    this.econ.save({ docked: undefined, system: this.system.id, t: this.t });
    if (st.isStation) this.onEvent(`Undocked from ${st.name}`, 'info');
  }

  /** put the ship on a circular prograde orbit */
  placeInOrbit(body: Body, r: number, phase?: number) {
    const s = this.ship;
    body.updateTo(this.t);
    const ez = body.isStar ? new Vector3(0, 1, 0) : body.axis;
    const ex = new Vector3(1, 0, 0).addScaledVector(ez, -ez.x).normalize();
    const ey = new Vector3().crossVectors(ez, ex);
    if (phase === undefined) {
      // default: on the day side, flying towards the sunset terminator
      const sun = new Vector3().copy(body.pos).negate();
      phase = body.isStar ? 0.6 : Math.atan2(sun.dot(ey), sun.dot(ex)) + 0.9;
    }
    const radial = new Vector3().addScaledVector(ex, Math.cos(phase)).addScaledVector(ey, Math.sin(phase));
    const tang = new Vector3().addScaledVector(ex, -Math.sin(phase)).addScaledVector(ey, Math.cos(phase));
    s.pos.copy(body.pos).addScaledVector(radial, r);
    s.vel.copy(body.vel).addScaledVector(tang, Math.sqrt(body.mu / r));
    s.landed = null;
    this.lookAlong(tang, radial);
  }

  lookAlong(forward: Vector3, up: Vector3) {
    _m.lookAt(new Vector3(), forward, up);
    this.ship.quat.setFromRotationMatrix(_m);
  }

  gravityAt(p: Vector3, out: Vector3): Vector3 {
    out.set(0, 0, 0);
    let minDyn = Infinity;
    for (const b of this.relevant) {
      _a.subVectors(b.pos, p);
      const r2 = _a.lengthSq(), r = Math.sqrt(r2);
      out.addScaledVector(_a, b.mu / (r2 * r));
      const dyn = Math.sqrt(r2 * r / b.mu);
      if (dyn < minDyn) minDyn = dyn;
    }
    this.minDyn = minDyn;
    return out;
  }

  private selectRelevant() {
    const s = this.ship, list: { b: Body; g: number }[] = [];
    let gmax = 0;
    for (const b of this.system.bodies) {
      const r2 = _a.subVectors(b.pos, s.pos).lengthSq();
      const g = b.mu / r2;
      list.push({ b, g }); if (g > gmax) gmax = g;
    }
    this.relevant = list.filter(x => x.g > gmax * 1e-7 || x.b === this.system.star).map(x => x.b);
    const tgt = this.ap.target;
    if (tgt && tgt.system === this.system) {
      for (let b: Body | null = tgt; b; b = b.parent) if (!this.relevant.includes(b)) this.relevant.push(b);
    }
    // parents must be updated before children: sort by depth
    this.relevant.sort((x, y) => x.depth - y.depth);
  }

  /** advance the simulation by a real-time frame */
  frame(realDt: number) {
    realDt = Math.min(realDt, 0.1);
    const s = this.ship;
    this.system.update(this.t);
    this.dominant = this.system.dominant(s.pos);
    this.selectRelevant();
    if (this.ap.active && this.ap.autoWarp) this.warp = this.ap.desiredWarp();
    // jump drive armed: real time only (the spool-up burn is timed in real seconds)
    if (this.jumpArmed) this.warp = 1;
    // a raider alongside: no skipping ahead
    if (this.pirates.active) this.warp = Math.min(this.warp, 10);
    this.updateAttitude(realDt);

    const simDt = realDt * this.warp;
    let remaining = simDt, steps = 0;
    this.thrustAccel0.set(0, 0, 0);
    this.gravityAt(s.pos, this.grav);
    const maxSteps = this.nearGround ? 40 : 300;
    while (remaining > 1e-9 && steps < maxSteps) {
      let dt = Math.min(remaining, this.maxDt());
      // resting on the ground the whole frame is one step — unless the autopilot may lift off this frame
      if (s.landed && !(this.ap.active && this.ap.mode !== 'align')) dt = remaining;
      this.substep(dt);
      remaining -= dt; steps++;
    }
    const advanced = simDt - remaining;
    this.effWarp = realDt > 0 ? advanced / realDt : this.warp;
    this.warpLimited = remaining > simDt * 0.02;
    this.system.update(this.t);
    // NPCs ride on body positions, so move them after the bodies are at the new time
    this.traffic.update(advanced);
    this.pirates.update(realDt);
    this.career.tick(realDt);
    if (s.landed) this.placeLanded();
    this.refreshDerived();
    this.ap.afterFrame();
    this.updateJump(realDt);
    this.checkGear();
  }

  // ------------------------------------------------------------------ landing gear
  /** landing gear selector: AUTO lowers it near the ground and raises it after take-off */
  gearCmd: 'auto' | 'down' | 'up' = 'auto';
  private gearWarned = false;

  /** whether the gear is (being) extended */
  get gearDown(): boolean {
    const s = this.ship;
    if (s.docked) return s.docked.isPort; // standing on a pad: legs down; at orbital stations: stowed
    if (s.landed) return true;
    if (this.gearCmd !== 'auto') return this.gearCmd === 'down';
    return this.nearGround && this.radarAlt < Math.max(1500, this.econ.ship.length * 40);
  }

  /** cycle the gear selector AUTO → DOWN → UP → AUTO */
  cycleGear() {
    this.gearCmd = this.gearCmd === 'auto' ? 'down' : this.gearCmd === 'down' ? 'up' : 'auto';
    this.onEvent(this.gearCmd === 'auto' ? 'Landing gear: AUTO (lowers near the ground)' : `Landing gear ${this.gearCmd.toUpperCase()}`, 'info');
  }

  /** warn once when descending towards the ground with the gear raised */
  private checkGear() {
    const s = this.ship;
    if (!this.nearGround || s.landed || this.gearDown || this.radarAlt > 2500) { this.gearWarned = false; return; }
    if (!this.gearWarned && this.radarAlt < 1000 && this.vertSpeed < -2) {
      this.gearWarned = true;
      this.onEvent('Landing gear is UP — press Y to lower it', 'warn');
    }
  }

  // ------------------------------------------------------------------ jump drive
  /** system the jump drive is armed for */
  jumpArmed: StarSystem | null = null;
  /** spool-up progress 0..1 (needs full power along the jump vector) */
  jumpCharge = 0;
  static readonly JUMP_ALIGN_DEG = 2;
  static readonly JUMP_SPOOL_S = 2;
  /** transit: after spool-up the jump is committed; stars streak past for this long (real s) before arrival */
  static readonly JUMP_TRANSIT_S = 1.8;
  /** seconds into the transit (0 = not in transit) */
  jumpTransit = 0;

  /** unit vector from here towards a star system (sim frame) */
  jumpDir(target: StarSystem, out = new Vector3()): Vector3 {
    return out.subVectors(target.galPos, this.system.galPos).normalize();
  }

  /** distance along the jump vector checked for planets in the way, m */
  static readonly JUMP_PATH_M = 5e5;

  /** a body whose surface or atmosphere the jump vector runs into within the first few hundred km, if any */
  jumpPathBlocker(target: StarSystem): Body | null {
    const s = this.ship, dir = this.jumpDir(target, _c);
    for (const b of this.relevant) {
      if (b.isStation || b.isStar) continue;
      const rel = _a.subVectors(b.pos, s.pos);
      const along = rel.dot(dir);
      const tc = Math.max(0, Math.min(Sim.JUMP_PATH_M, along));
      const miss = _d.copy(dir).multiplyScalar(tc).sub(rel).length();
      if (miss < b.radius + b.atmoTop + 2e4) return b;
    }
    return null;
  }

  /** what still stands between the ship and an armed jump */
  jumpReadiness(target: StarSystem) {
    const s = this.ship;
    const fwd = _b.set(0, 0, -1).applyQuaternion(s.quat);
    const angle = Math.acos(Math.max(-1, Math.min(1, fwd.dot(this.jumpDir(target, _c))))) * 180 / Math.PI;
    const maxLevel = s.thrustLevel === THRUST_LEVELS.length - 1;
    const burning = s.thrustInput.z <= -0.99 && s.thrustAccel.length() >= s.maxAccel * 0.95;
    const pathBody = this.jumpPathBlocker(target);
    const blocked = this.canJump(target) ?? (pathBody ? `${pathBody.name} is in the way of the jump vector` : null);
    return { angle, aligned: angle <= Sim.JUMP_ALIGN_DEG, maxLevel, burning, fullPower: maxLevel && burning, blocked };
  }

  /** arm the jump drive; the jump fires after a full-power spool-up along the jump vector */
  armJump(target: StarSystem): string | null {
    const why = this.canJump(target);
    if (why) return why;
    const inWay = this.jumpPathBlocker(target);
    if (inWay) return `${inWay.name} is in the way of the jump vector — let your orbit carry you round (time warp) or climb higher, then try again`;
    this.jumpArmed = target;
    // the spool-up burn happens in real time: at time warp it would be a long burn straight ahead
    this.warp = 1;
    this.jumpCharge = 0;
    // the drive needs full power: set it, so the pilot only has to hold W along the jump vector
    this.ship.thrustLevel = THRUST_LEVELS.length - 1;
    this.ap.engageAlign(this.jumpDir(target), `jump to ${target.name}`);
    return null;
  }

  disarmJump(msg?: string) {
    if (!this.jumpArmed || this.jumpTransit > 0) return; // too late once in transit
    this.jumpArmed = null;
    this.jumpCharge = 0;
    if (this.ap.mode === 'align') this.ap.disengage();
    if (msg) this.onEvent(msg, 'info');
  }

  private updateJump(realDt: number) {
    const t = this.jumpArmed;
    if (!t) return;
    if (this.jumpTransit > 0) {
      // committed: accelerate into the jump, arriving at the peak of the flash
      this.jumpTransit += realDt;
      if (this.jumpTransit >= Sim.JUMP_TRANSIT_S) {
        this.jumpTransit = 0;
        this.jumpArmed = null;
        this.jumpCharge = 0;
        this.ship.thrustLevel = 3;
        this.jumpTo(t);
      }
      return;
    }
    const r = this.jumpReadiness(t);
    if (r.blocked) { this.disarmJump(`Jump aborted: ${r.blocked}`); return; }
    if (this.ap.mode === 'align') this.ap.setAlign(this.jumpDir(t));
    if (r.aligned && r.fullPower) this.jumpCharge = Math.min(1, this.jumpCharge + realDt / Sim.JUMP_SPOOL_S);
    else this.jumpCharge = Math.max(0, this.jumpCharge - realDt * 1.5);
    if (this.jumpCharge >= 1) { this.jumpCharge = 1; this.jumpTransit = 1e-6; this.warp = 1; this.onJumpStart(t); }
  }
  /** the drive has fired: transit (star streaks) begins */
  onJumpStart: (to: StarSystem) => void = () => {};

  private thrustAccel0 = new Vector3();

  private maxDt(): number {
    const s = this.ship;
    let dt = 0.012 * this.minDyn;
    if (this.nearGround) {
      const closing = Math.max(1, -this.vertSpeedNow() + this.vSurf.length() * 0.05);
      dt = Math.min(dt, 0.2 * (Math.max(this.radarAlt, 0) + 4) / closing + 0.004);
    }
    if (this.density > 1e-6) dt = Math.min(dt, 0.5);
    if (this.ap.active && this.ap.mode !== 'align') dt = Math.min(dt, this.ap.maxDt());
    else if (s.thrustInput.lengthSq() > 0) dt = Math.min(dt, 20 * Math.max(1, this.warp / 1000));
    return Math.max(dt, 1e-3);
  }

  private vertSpeedNow(): number {
    const d = this.dominant;
    _a.subVectors(this.ship.pos, d.pos).normalize();
    return _b.subVectors(this.ship.vel, d.vel).dot(_a);
  }

  private substep(dt: number) {
    const s = this.ship;
    // --- commanded thrust
    const thrust = _d.set(0, 0, 0);
    // the jump-alignment autopilot only holds attitude: the pilot still flies the engines
    if (this.ap.active && this.ap.mode !== 'align') this.ap.control(dt, this.grav, thrust);
    else if (s.thrustInput.lengthSq() > 0) {
      thrust.copy(s.thrustInput).clampLength(0, 1).multiplyScalar(s.maxAccel).applyQuaternion(s.quat);
    }
    // fusion fuel: every m/s of delta-v costs fuel, more when heavily laden
    if (thrust.lengthSq() > 0) {
      const frac = this.econ.burn(thrust.length() * dt);
      if (frac < 1) {
        thrust.multiplyScalar(frac);
        if (!this.dryWarned) {
          this.dryWarned = true;
          this.ap.disengage();
          this.onEvent('Fuel exhausted! Engines offline — request a tow from the autopilot panel.', 'warn');
        }
      }
    }
    s.thrustAccel.copy(thrust);

    if (s.landed) {
      const b = s.landed;
      _a.subVectors(s.pos, b.pos).normalize();
      const up = thrust.dot(_a);
      if (up > b.surfaceG * 1.02 + 0.01 || (b.surfaceG < 0.05 && up > 0.01)) {
        if (this.mining) { this.mining = false; this.onEvent('Drills retracted', 'info'); }
        if (b.isStation) { this.undock(); }
        else {
          s.pos.addScaledVector(_a, 0.5);
          s.landed = null;
          this.onEvent('Lift-off', 'info');
        }
      } else {
        if (this.mining) {
          const stop = this.econ.mine(b, dt, this.landedSite);
          if (stop) { this.mining = false; this.warp = 1; this.onEvent(`Mining stopped: ${stop}`, stop === 'cargo hold full' ? 'good' : 'warn'); }
        }
        this.t += dt;
        for (const r of this.relevant) r.updateTo(this.t);
        this.placeLanded();
        s.thrustAccel.set(0, 0, 0);
        return;
      }
    }

    // --- leapfrog (kick-drift-kick) with thrust applied as a full kick
    s.vel.addScaledVector(this.grav, dt * 0.5).addScaledVector(thrust, dt);
    s.pos.addScaledVector(s.vel, dt);
    this.t += dt;
    for (const r of this.relevant) r.updateTo(this.t);
    this.gravityAt(s.pos, this.grav);
    s.vel.addScaledVector(this.grav, dt * 0.5);

    // --- atmosphere + ground for the dominant body
    const b = this.dominant;
    const rel = _a.subVectors(s.pos, b.pos);
    const r = rel.length();
    const alt = r - b.radius;
    this.density = 0;
    if (b.rho0 && alt < b.atmoTop) {
      const rho = b.density(alt);
      this.density = rho;
      // air moves with the rotating planet
      _b.copy(b.axis).multiplyScalar(b.rotRate).cross(rel).add(b.vel);
      const vr = _c.subVectors(s.vel, _b);
      const sp = vr.length();
      const k = rho * DRAG_B * sp * dt;
      vr.multiplyScalar(1 / (1 + k));
      s.vel.copy(_b).add(vr);
    }
    const reliefMax = b.radius * (b.surface.rel * 2.2 + 0.03) + 2000;
    this.nearGround = false;
    if (alt < reliefMax + 30000) {
      if (b.def.landable) {
        this.nearGround = true;
        const h = this.terrainHeightBelow(b, rel);
        this.radarAlt = alt - h - this.ship.gear;
        if (this.radarAlt <= 0) this.touchdown(b, rel, r, h);
      } else if (alt < (b.isStar ? 0 : -b.radius * 0.02)) {
        this.destroyed(b);
      }
    }
  }

  private terrainHeightBelow(b: Body, rel: Vector3): number {
    b.orientation(this.t, _q).invert();
    _b.copy(rel).normalize().applyQuaternion(_q);
    return b.surface.height(_b.x, _b.y, _b.z, 0);
  }

  private touchdown(b: Body, rel: Vector3, r: number, h: number) {
    const s = this.ship;
    const up = _b.copy(rel).normalize();
    const vs = _c.copy(b.axis).multiplyScalar(b.rotRate).cross(rel).add(b.vel);
    const impact = _c.subVectors(s.vel, vs).length();
    const bellyLanding = !this.gearDown;
    // settle on the surface
    s.pos.copy(b.pos).addScaledVector(up, b.radius + h + this.ship.gear);
    // align ship up with local vertical, keep heading
    const fwd = new Vector3(0, 0, -1).applyQuaternion(s.quat);
    fwd.addScaledVector(up, -fwd.dot(up));
    if (fwd.lengthSq() < 1e-6) fwd.set(1, 0, 0).addScaledVector(up, -up.x);
    fwd.normalize();
    this.lookAlong(fwd, up.clone());
    b.orientation(this.t, _q).invert();
    s.landedLocal.subVectors(s.pos, b.pos).applyQuaternion(_q);
    s.landedQuat.copy(_q).multiply(s.quat);
    s.landed = b;
    s.angVel.set(0, 0, 0);
    this.placeLanded();
    this.radarAlt = 0;
    if (this.warp > 1) this.warp = 1;
    // too fast (or too fast on the belly): a crash. The hull gets patched up, the crew does not come cheap
    if (impact > Sim.CRASH_SPEED || (bellyLanding && impact > Sim.BELLY_CRASH_SPEED)) {
      this.ap.disengage();
      this.mining = false;
      this.crash(`CRASH on ${b.name} at ${impact.toFixed(0)} m/s${bellyLanding ? ' with the gear up' : ''}!`);
      return;
    }
    // a gear-up landing scrapes down on the belly; the legs are then dropped to keep the ship upright
    if (bellyLanding) this.onEvent(`Belly landing on ${b.name} — the gear was up! Legs deployed after touchdown.`, 'warn');
    else if (impact > 8) this.onEvent(`Hard landing on ${b.name} — ${impact.toFixed(0)} m/s! Hull integrity restored.`, 'warn');
    else this.onEvent(`Touchdown on ${b.name} (${impact.toFixed(1)} m/s)`, 'good');
    // set down by hand on (or right next to) a spaceport's pad: that counts as docking there
    if (!(this.ap.active && this.ap.mode === 'land' && this.ap.site?.port)) {
      const pad = b.children.find(c => c.isPort && c.pos.distanceTo(s.pos) < 250);
      if (pad) { this.ap.disengage(); this.dock(pad); return; }
    }
    this.ap.onLanded();
  }

  private destroyed(b: Body) {
    this.ap.disengage();
    this.warp = 1;
    this.placeInOrbit(b, b.parkingRadius());
    this.crash(b.isStar ? `Too close to ${b.name}! Emergency jump to a safe orbit.` :
      `Crush depth exceeded in ${b.name}'s atmosphere. Emergency ascent to orbit.`);
  }

  /** touchdown faster than this is a crash, m/s */
  static readonly CRASH_SPEED = 20;
  /** ... or this fast with the landing gear up */
  static readonly BELLY_CRASH_SPEED = 8;
  /** share of your credits that a crash costs in medical expenses */
  static readonly CRASH_FEE = 0.1;
  /** a crash happened (for sound and visual effects) */
  onCrash: () => void = () => {};

  private crash(what: string) {
    const fee = Math.round(this.econ.credits * Sim.CRASH_FEE);
    this.econ.credits -= fee;
    this.career.spend('medical', fee); this.career.count('crashes'); this.career.note(what, 'warn');
    this.econ.save(); this.econ.onChange();
    this.onEvent(`${what} The crew survives — medical expenses: ${fee.toLocaleString('en-US')} cr.`, 'warn');
    this.onCrash();
  }

  private placeLanded() {
    const s = this.ship, b = s.landed!;
    b.orientation(this.t, _q);
    _a.copy(s.landedLocal).applyQuaternion(_q);
    s.pos.copy(b.pos).add(_a);
    s.vel.copy(b.axis).multiplyScalar(b.rotRate).cross(_a).add(b.vel);
    s.quat.copy(_q).multiply(s.landedQuat);
  }

  private updateAttitude(dt: number) {
    const s = this.ship;
    if (s.landed) return;
    const want = this.ap.active ? this.ap.desiredAttitude() : null;
    if (want) {
      const ang = s.quat.angleTo(want);
      if (ang > 1e-4) s.quat.rotateTowards(want, Math.min(ang, (0.5 + ang * 1.6) * dt));
      s.angVel.set(0, 0, 0);
      return;
    }
    // hands off the controls for a few seconds in free flight: swing the nose gently onto the
    // direction of travel (not while hovering low over a surface, where that would tip the ship over)
    const handsOff = s.rotInput.lengthSq() === 0 && s.thrustInput.lengthSq() === 0 && !this.ap.active;
    this.idleT = handsOff ? this.idleT + dt : 0;
    if (this.idleT > Sim.AUTO_PROGRADE_S && !(this.nearGround && this.radarAlt < 20000) && this.prograde(_q3)) {
      const ang = s.quat.angleTo(_q3);
      if (ang > 1e-4) s.quat.rotateTowards(_q3, Math.min(ang, (0.12 + ang * 0.5) * dt));
      s.angVel.multiplyScalar(Math.exp(-dt * 4));
      return;
    }
    const maxRate = 1.1;
    const k = 1 - Math.exp(-dt * 6);
    s.angVel.x += (s.rotInput.x * maxRate - s.angVel.x) * k;
    s.angVel.y += (s.rotInput.y * maxRate - s.angVel.y) * k;
    s.angVel.z += (s.rotInput.z * maxRate * 1.4 - s.angVel.z) * k;
    const w = s.angVel.length();
    if (w > 1e-5) {
      _q2.setFromAxisAngle(_a.copy(s.angVel).multiplyScalar(1 / w), w * dt);
      s.quat.multiply(_q2).normalize();
    }
  }

  /** seconds without any steering or thrust input */
  private idleT = 0;
  /** idle time before the ship turns to face its direction of travel */
  static readonly AUTO_PROGRADE_S = 3;

  /** attitude facing the direction of travel (relative to the air in an atmosphere), level with the local horizon */
  private prograde(out: Quaternion): boolean {
    const s = this.ship, b = this.dominant;
    const v = this.density > 1e-6 ? _c.copy(this.vSurf) : _c.subVectors(s.vel, b.vel);
    if (v.lengthSq() < 9) return false;
    v.normalize();
    const up = _a.subVectors(s.pos, b.pos).normalize();
    up.addScaledVector(v, -up.dot(v));
    if (up.lengthSq() < 1e-6) up.set(0, 1, 0).applyQuaternion(s.quat).addScaledVector(v, -_b.set(0, 1, 0).applyQuaternion(s.quat).dot(v));
    up.normalize();
    _m.lookAt(_zero, v, up);
    out.setFromRotationMatrix(_m);
    return true;
  }

  refreshDerived() {
    const s = this.ship;
    const b = this.dominant = this.system.dominant(s.pos);
    const rel = _a.subVectors(s.pos, b.pos);
    const r = rel.length();
    this.altitude = r - b.radius;
    const up = _b.copy(rel).multiplyScalar(1 / r);
    _c.copy(b.axis).multiplyScalar(b.rotRate).cross(rel).add(b.vel);
    this.vSurf.subVectors(s.vel, _c);
    this.vertSpeed = _d.subVectors(s.vel, b.vel).dot(up);
    const reliefMax = b.radius * (b.surface.rel * 2.2 + 0.03) + 2000;
    if (b.def.landable && this.altitude < reliefMax + 30000) {
      this.nearGround = true;
      if (!s.landed) this.radarAlt = this.altitude - this.terrainHeightBelow(b, rel) - this.ship.gear;
      else this.radarAlt = 0;
    } else { this.nearGround = false; this.radarAlt = Infinity; }
    const rho = b.density(this.altitude);
    this.density = rho;
    const sp = this.vSurf.length();
    this.dynPressure = 0.5 * rho * sp * sp;
    this.heat = s.landed ? 0 : 1.74e-4 * Math.sqrt(rho) * sp * sp * sp;
    this.gForce = s.landed ? s.landed.surfaceG / 9.80665 : s.thrustAccel.length() / 9.80665;
    this.orbit = s.landed ? null : this.computeOrbit(b);
  }

  private computeOrbit(b: Body): OrbitInfo {
    const s = this.ship;
    const r = new Vector3().subVectors(s.pos, b.pos), v = new Vector3().subVectors(s.vel, b.vel);
    const mu = b.mu, rl = r.length(), v2 = v.lengthSq();
    const h = new Vector3().crossVectors(r, v);
    const evec = new Vector3().crossVectors(v, h).multiplyScalar(1 / mu).addScaledVector(r, -1 / rl);
    const e = evec.length();
    const energy = v2 / 2 - mu / rl;
    const a = -mu / (2 * energy);
    const bound = energy < 0 && e < 1;
    const p = h.lengthSq() / mu;
    const rp = p / (1 + e);
    const ra = bound ? p / (1 - e) : Infinity;
    return { body: b, a, e, rp, ra, period: bound ? 2 * Math.PI * Math.sqrt(a * a * a / mu) : Infinity, h, evec, bound };
  }

  setWarpIndex(delta: number) {
    let i = 0;
    for (let k = 0; k < WARP_LEVELS.length; k++) if (WARP_LEVELS[k] <= this.warp * 1.0001) i = k;
    i = clamp(i + delta, 0, WARP_LEVELS.length - 1);
    this.warp = WARP_LEVELS[i];
    if (this.ap.active) this.ap.autoWarp = false;
  }

  private dryWarned = false;
  /** drills running (only possible while landed on a mineable body in a mining ship) */
  mining = false;

  private readonly _siteDir = new Vector3();
  /** the surface deposit the ship is sitting on, if any */
  get landedSite(): Site | null {
    const b = this.ship.landed;
    if (!b || b.isStation || !b.def.ore) return null;
    return siteAt(b, this._siteDir.copy(this.ship.landedLocal).normalize());
  }

  /** why mining isn't possible right now, or null */
  canMine(): string | null {
    const b = this.ship.landed;
    const rig = this.econ.ship.miner;
    if (!rig) return 'This ship has no mining rig — the Kestrel can drill ice; Prospector, Excavator and Behemoth mine everything';
    if (!b || b.isStation) return rig.only ? 'Land on an icy asteroid to drill for ice' : 'Land on an asteroid to mine';
    if (!b.def.ore) return `${b.name} has nothing worth mining — try an asteroid`;
    if (this.econ.mineRate(b, this.landedSite) <= 0) {
      return sitesFor(b).some(x => this.econ.mineRate(b, x) > 0)
        ? `Nothing your ice drill can cut here — land on one of ${b.name}'s ice or Helionite deposits (scan it to find them)`
        : `No ice on ${b.name} — the ice drill can't cut metal ore`;
    }
    if (this.econ.cargoFree < 1) return 'Cargo hold full';
    if (this.econ.fuel <= 0) return 'Out of fuel';
    return null;
  }

  toggleMining() {
    if (this.mining) { this.mining = false; this.onEvent('Drills stopped', 'info'); return; }
    const why = this.canMine();
    if (why) { this.onEvent(why, 'warn'); return; }
    this.mining = true;
    const b = this.ship.landed!;
    const site = this.landedSite;
    const got = this.econ.minedNames(b, site).slice(0, 3).join(', ');
    const rate = this.econ.mineRate(b, site).toFixed(1);
    if (site && !this.econ.rigTakes(site.focus)) {
      const focus = COMMODITIES.find(c => c.id === site.focus)?.name ?? site.focus;
      this.onEvent(`Your ${this.econ.ship.name}'s drill can't recover ${focus} — at deposit ${site.label} it only gets ${got} (${rate} t/h). ${focus} needs a mining ship (Prospector, Excavator or Behemoth).`, 'warn');
    } else this.onEvent(site
      ? `Drilling deposit ${site.label} (${site.name}) on ${b.name}: ${got} at ${rate} t/h — use time warp to speed it up`
      : `Drilling ${b.name} away from any deposit: ${got} at ${rate} t/h — scan for deposits to do better`, 'good');
  }

  canJump(target?: StarSystem): string | null {
    if (this.ship.docked) return 'Undock before jumping';
    if (this.ship.landed) return 'Take off before jumping';
    const b = this.dominant;
    if (this.altitude < Math.max(b.atmoTop, b.radius * 0.02)) return `Too close to ${b.name} to jump`;
    if (target) {
      const need = this.econ.jumpFuel(this.jumpDistanceLy(target));
      if (need > this.econ.fuel) return `Jump needs ${need.toFixed(1)} t of fuel — you have ${this.econ.fuel.toFixed(1)} t`;
    }
    return null;
  }

  jumpDistanceLy(target: StarSystem): number { return target.galPos.distanceTo(this.system.galPos) / 9.4607304725808e15; }

  /** emergency tow to the nearest station in this system */
  /** orbital space stations a tow can take you to (none in uncharted systems) */
  towStations(): Body[] { return this.system.bodies.filter(b => b.isStation && !b.isPort); }

  /** emergency tow to the nearest space station in this system for a flat fee */
  requestTow(): string | null {
    if (this.ship.docked) return 'Already docked';
    const sts = this.towStations();
    if (!sts.length) return 'No space station in this system — no tow available';
    const s = this.ship;
    const near = sts.reduce((a, b) => (a.pos.distanceTo(s.pos) < b.pos.distanceTo(s.pos) ? a : b));
    const fee = Math.min(this.econ.towFee(), Math.max(0, Math.round(this.econ.credits)));
    this.econ.credits = Math.max(0, this.econ.credits - this.econ.towFee());
    this.career.spend('tow', fee); this.career.count('tows'); this.career.note(`Towed to ${near.name}`, 'warn');
    this.econ.fuel = Math.max(this.econ.fuel, this.econ.ship.fuelCap * 0.05);
    this.ap.disengage();
    this.mining = false;
    s.landed = null;
    this.dock(near, true);
    this.dryWarned = false;
    this.onEvent(`Towed to ${near.name}. Tow fee: ${fee.toLocaleString('en-US')} credits${fee < this.econ.towFee() ? ' (all you had — the rest was waived)' : ''}`, 'warn');
    return null;
  }

  jumpTo(target: StarSystem) {
    const from = this.system;
    if (target === from) return;
    this.jumpArmed = null; this.jumpCharge = 0;
    this.econ.fuel = Math.max(0, this.econ.fuel - this.econ.jumpFuel(this.jumpDistanceLy(target)));
    this.career.count('jumps'); this.career.note(`Jumped from ${from.name} to ${target.name} (${this.jumpDistanceLy(target).toFixed(1)} ly)`, 'info');
    this.ap.disengage();
    this.warp = 1;
    this.system = target;
    target.update(this.t);
    const star = target.star;
    const dir = new Vector3().subVectors(from.galPos, target.galPos).normalize();
    // arrive in the orbital plane, on the side facing where we came from
    dir.y *= 0.25; dir.normalize();
    const dist = Math.max(target.extent * 1.5, star.radius * 40);
    const tang = new Vector3().crossVectors(new Vector3(0, 1, 0), dir).normalize();
    const s = this.ship;
    s.pos.copy(dir).multiplyScalar(dist);
    s.vel.copy(tang).multiplyScalar(Math.sqrt(star.mu / dist));
    s.landed = null;
    this.lookAlong(dir.clone().negate(), new Vector3(0, 1, 0));
    this.dominant = star;
    this.nearGround = false; this.radarAlt = Infinity;
    this.refreshDerived();
    this.onJump(from, target);
  }
}

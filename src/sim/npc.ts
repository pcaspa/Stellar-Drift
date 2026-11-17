import { Matrix4, Quaternion, Vector3 } from 'three';
import { SHIPS } from '../data/ships';
import type { Sim } from './sim';
import type { Body, StarSystem } from './universe';

export const MAX_NPCS = 3;
/** distance of the lower traffic port from a station's centre, m (below the reactor module) */
const TRAFFIC_PORT = 230;

const NAMES = [
  'Calypso Trader', 'Northern Lark', 'Ironwood', 'Pale Horizon', "Kepler's Due", 'Saint Brendan', 'Long Haul',
  'Amber Tide', 'Ishikawa Maru', 'Copper Wren', 'Halcyon', 'Quiet Meridian', 'Dawn Treader II', 'Vanguard Rose',
  'Mother Lode', 'Bright Anvil', 'Silent Hour', 'Tycho Express',
];

export type NpcState = 'docked' | 'depart' | 'cruise' | 'hold' | 'pirate';

export interface Npc {
  id: string;
  name: string;
  shipId: string;
  /** sim-frame state, metres */
  pos: Vector3; vel: Vector3;
  /** current engine acceleration (world frame) */
  acc: Vector3;
  quat: Quaternion;
  maxAcc: number;
  state: NpcState;
  dest: Body;
  /** seconds left docked / holding / departing */
  timer: number;
  /** offset from the destination while holding (or from the origin station while departing) */
  holdRel: Vector3;
  /** station being departed from, and the direction out of its port */
  origin: Body | null;
  departDir: Vector3;
  /** total acceleration over the last update (engine plus the destination's orbital motion), m/s² */
  aTot: Vector3;
  /** sim time the state above refers to */
  t: number;
}

function rng(seed: number) {
  let h = seed >>> 0 || 1;
  return () => { h = (Math.imul(h, 1664525) + 1013904223) >>> 0; return h / 4294967296; };
}

const _r = new Vector3(), _v = new Vector3(), _d = new Vector3(), _ax = new Vector3(), _q = new Quaternion();
const _m = new Matrix4();
const _g = new Vector3(), _v0 = new Vector3();

/**
 * Background traffic: up to three NPC ships in the player's current system flying their own
 * routes between stations, planets and asteroids. They fly a simple accelerate–flip–brake
 * profile relative to their destination (no gravity), dock at stations for a while, then leave.
 */
export class NpcTraffic {
  npcs: Npc[] = [];
  private system: StarSystem | null = null;
  private rand = rng(1);
  private fastForward = false;

  constructor(private sim: Sim) {}

  private pickDest(npc: Npc | null, sys: StarSystem): Body {
    // only full mining ships go prospecting (the Kestrel's ice drill is a sideline)
    const rig = npc ? SHIPS.find(s => s.id === npc.shipId)?.miner : undefined;
    const miner = !!rig && !rig.only;
    const pool: [Body, number][] = [];
    for (const b of sys.bodies) {
      if (npc && b === npc.dest) continue;
      if (b.isStation && !b.isPort) pool.push([b, 4]);
      else if (b.def.kind === 'planet' || b.def.kind === 'moon') pool.push([b, 0.6]);
      else if (b.def.kind === 'asteroid' && miner) pool.push([b, 3]);
    }
    // keep routes local-ish: strongly prefer destinations in the current neighbourhood
    const here = npc ? npc.pos : this.sim.ship.pos;
    const weighted = pool.map(([b, w]) => [b, w / (1 + b.pos.distanceTo(here) / 3e11)] as [Body, number]);
    const total = weighted.reduce((a, [, w]) => a + w, 0);
    let x = this.rand() * total;
    for (const [b, w] of weighted) { x -= w; if (x <= 0) return b; }
    return weighted[0][0];
  }

  private reset(sys: StarSystem) {
    this.system = sys;
    let seed = 0; for (let i = 0; i < sys.id.length; i++) seed = seed * 31 + sys.id.charCodeAt(i);
    this.rand = rng(seed + Math.floor(this.sim.t / 86400));
    this.npcs = [];
    const stations = sys.bodies.filter(b => b.isStation && !b.isPort);
    if (!stations.length) return;
    const count = sys.id === 'sol' ? MAX_NPCS : 2 + Math.floor(this.rand() * 2);
    const used = new Set<string>();
    // the station nearest the player gets a ship that is about to depart, so traffic is visible early
    const nearSt = stations.reduce((a, b) => (a.pos.distanceTo(this.sim.ship.pos) < b.pos.distanceTo(this.sim.ship.pos) ? a : b));
    for (let i = 0; i < count; i++) {
      const cls = SHIPS[Math.floor(this.rand() * SHIPS.length)];
      let name = NAMES[Math.floor(this.rand() * NAMES.length)];
      while (used.has(name)) name = NAMES[Math.floor(this.rand() * NAMES.length)];
      used.add(name);
      const npc: Npc = {
        id: `npc${i}`, name, shipId: cls.id,
        pos: new Vector3(), vel: new Vector3(), acc: new Vector3(), quat: new Quaternion(),
        maxAcc: 9 + 14 * cls.perf * this.rand(), state: 'docked', dest: nearSt, timer: 0, holdRel: new Vector3(),
        origin: null, departDir: new Vector3(), aTot: new Vector3(), t: this.sim.t,
      };
      if (i === 0) {
        npc.dest = nearSt; npc.state = 'docked'; npc.timer = 20 + this.rand() * 40;
        this.placeAt(npc, nearSt);
      } else {
        // already under way somewhere between two destinations
        const from = this.pickDest(null, sys);
        npc.dest = from;
        const to = this.pickDest(npc, sys);
        const f = 0.2 + 0.6 * this.rand();
        npc.pos.lerpVectors(from.pos, to.pos, f);
        npc.vel.copy(to.vel).addScaledVector(_d.subVectors(to.pos, from.pos).normalize(), 200 + 2000 * this.rand());
        npc.dest = to; npc.state = 'cruise';
      }
      this.npcs.push(npc);
    }
  }

  private placeAt(npc: Npc, b: Body) {
    npc.holdRel.set(0, 0, 0);
    npc.pos.copy(b.pos); npc.vel.copy(b.vel);
  }

  /** leave a station along its docking axis */
  private depart(npc: Npc) {
    const from = npc.dest;
    if (from.isStation) {
      from.orientation(this.sim.t, _q);
      // NPC traffic uses the station's lower (traffic) port; the upper port is the player's
      _ax.set(0, -1, 0).applyQuaternion(_q);
      // the drift out of the port is tracked relative to the station (NPCs feel no gravity)
      npc.origin = from;
      npc.departDir.copy(_ax);
      npc.holdRel.copy(_ax).multiplyScalar(TRAFFIC_PORT + 10);
      npc.pos.copy(from.pos).add(npc.holdRel);
      npc.vel.copy(from.vel).addScaledVector(_ax, 6);
      npc.state = 'depart'; npc.timer = 45;
      // nose out along the docking axis
      _m.lookAt(_d.set(0, 0, 0), _ax, _r.set(0, 0, 1).applyQuaternion(_q));
      npc.quat.setFromRotationMatrix(_m);
    } else {
      npc.state = 'cruise';
    }
    npc.dest = this.pickDest(npc, this.system!);
  }

  update(simDt: number) {
    const sys = this.sim.system;
    if (sys !== this.system) this.reset(sys);
    if (simDt <= 0) return;
    // at high time warp a final approach can't be resolved frame by frame; ships within
    // 200 km of their arrival point simply complete it (nobody can watch it at that speed)
    this.fastForward = simDt > 5;
    const t1 = this.sim.t, t0 = t1 - simDt;
    for (const npc of this.npcs) {
      // raiders are flown by the pirate encounter
      if (npc.state === 'pirate') continue;
      _v0.copy(npc.vel);
      // fine steps on final approach, coarse ones in deep space
      const near = npc.state === 'cruise' && npc.pos.distanceTo(npc.dest.pos) < 3e6;
      const steps = Math.min(60, Math.max(1, Math.ceil(simDt / (near ? 3 : 30))));
      const dt = simDt / steps;
      for (let k = 0; k < steps; k++) {
        // move the destination (and departure station) along their orbits for each step
        if (steps > 1) { npc.dest.updateTo(t0 + (k + 1) * dt); npc.origin?.updateTo(t0 + (k + 1) * dt); }
        this.step(npc, dt);
      }
      // net acceleration this update, so others can extrapolate its motion (docking snaps clamped)
      npc.aTot.subVectors(npc.vel, _v0).multiplyScalar(1 / simDt).clampLength(0, 100);
      npc.t = t1;
    }
    // put every body back at the frame's time
    this.sim.system.update(t1);
  }

  private step(npc: Npc, dt: number) {
    const D = npc.dest;
    switch (npc.state) {
      case 'docked':
        npc.pos.copy(D.pos); npc.vel.copy(D.vel); npc.acc.set(0, 0, 0);
        npc.timer -= dt;
        if (npc.timer <= 0) this.depart(npc);
        return;
      case 'hold':
        npc.pos.copy(D.pos).add(npc.holdRel); npc.vel.copy(D.vel); npc.acc.set(0, 0, 0);
        npc.timer -= dt;
        if (npc.timer <= 0) { npc.state = 'cruise'; npc.dest = this.pickDest(npc, this.system!); }
        return;
      case 'depart': {
        // drift straight out of the port, in the station's frame, before turning onto course
        const o = npc.origin ?? D;
        npc.holdRel.addScaledVector(npc.departDir, 6 * dt);
        npc.pos.copy(o.pos).add(npc.holdRel);
        npc.vel.copy(o.vel).addScaledVector(npc.departDir, 6);
        npc.acc.set(0, 0, 0);
        npc.timer -= dt;
        if (npc.timer <= 0) { npc.state = 'cruise'; npc.origin = null; }
        return;
      }
    }
    // cruise: accelerate–flip–brake towards the arrival point, relative to the destination.
    // Stations: their docking port; other bodies: a standoff at parking-orbit distance.
    let aim = D.pos;
    if (D.isStation) {
      D.orientation(this.sim.t, _q);
      aim = _ax.set(0, -1, 0).applyQuaternion(_q).multiplyScalar(TRAFFIC_PORT + 20).add(D.pos);
    }
    _r.subVectors(npc.pos, aim);
    const d = _r.length();
    const stand = D.isStation ? 0 : Math.max(D.parkingRadius(), D.radius * 1.05);
    const ds = Math.max(0, d - stand);
    _v.subVectors(npc.vel, D.vel);
    const a = npc.maxAcc;
    // share the destination's own orbital acceleration (equivalent to feeling the same gravity),
    // so the guidance below only has to null the relative motion
    D.accel(_g);
    npc.vel.addScaledVector(_g, dt);
    _v.subVectors(npc.vel, D.vel);
    // braking profile; never ask for more than half the remaining gap per step (stable at any warp)
    const speed = Math.min(Math.sqrt(2 * a * 0.8 * ds), ds / 3 + 0.5, 0.5 * ds / dt + 0.2);
    _d.copy(_r).multiplyScalar(-1 / Math.max(d, 1e-6) * speed).sub(_v); // velocity change wanted
    const need = _d.length();
    const step = Math.min(need, a * dt);
    if (need > 1e-9) npc.acc.copy(_d).multiplyScalar(step / need / dt); else npc.acc.set(0, 0, 0);
    npc.vel.addScaledVector(npc.acc, dt);
    npc.pos.addScaledVector(npc.vel, dt);
    if ((ds < 30 && _v.length() < 4) || (this.fastForward && ds < 2e5)) {
      npc.pos.copy(aim).addScaledVector(_r.normalize(), D.isStation ? 0 : stand); npc.vel.copy(D.vel);
      if (D.isStation) { npc.state = 'docked'; npc.timer = 1200 + this.rand() * 4800; }
      else { npc.state = 'hold'; npc.timer = 600 + this.rand() * 3000; npc.holdRel.subVectors(npc.pos, D.pos); }
    }
  }
}

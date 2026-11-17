import { Quaternion, Vector3 } from 'three';
import { COMMODITIES } from '../data/commodities';
import type { Npc } from './npc';
import type { Sim } from './sim';

const DAY = 86400;
const NAMES = ['Black Gull', 'Rust Widow', 'Grinning Jack', 'Night Heron', 'Red Comet', 'Hollow Crown', 'Magpie', 'Scavenger Nine', 'Cold Debt', 'Sable Fang'];

/** cargo worth less than this (base value) doesn't interest raiders */
export const PIRATE_MIN_VALUE = 15000;
/** they break off once you are this far away, m */
export const PIRATE_ESCAPE_M = 80000;
/** a station's patrols keep raiders out of this radius, m */
const STATION_GUARD_M = 50000;
/** real seconds to answer the demand before they move to board */
export const PIRATE_DEMAND_S = 45;
/** share of the cargo's value they demand / of the hold they take by force */
const DEMAND_SHARE = 0.25;
const BOARD_SHARE = 0.5;

export interface Encounter {
  npc: Npc;
  /** pirate position / velocity relative to the player's ship */
  rel: Vector3;
  relV: Vector3;
  /** pirate's maximum acceleration, m/s² */
  acc: number;
  demand: number;
  /** real seconds left to answer */
  timer: number;
  phase: 'demand' | 'board';
}

const _d = new Vector3(), _a = new Vector3();

/**
 * Raiders: carrying valuable cargo through open space (especially uncharted space) can bring a
 * pirate interceptor alongside. It demands a share of the cargo's value; pay, or out-run it
 * at full drive power (fast, lightly loaded ships can; laden haulers can't), or reach a station's
 * patrol zone, or jump out. Ignore it and it boards you and takes half the hold.
 */
export class Pirates {
  active: Encounter | null = null;
  /** no new encounter before this sim time */
  private quietUntil = 0;
  private checkT = 0;
  /** raiders already came for you on this flight (cleared when you dock or land) */
  private metThisFlight = false;
  private lastT = NaN;

  constructor(private sim: Sim) {}

  /** base value of what you're carrying (plus sealed contract cargo) */
  cargoValue(): number {
    const e = this.sim.econ;
    let v = 0;
    for (const [id, n] of Object.entries(e.cargo)) v += n * (COMMODITIES.find(c => c.id === id)?.base ?? 0);
    for (const c of e.career?.contracts ?? []) if (c.kind === 'courier') v += c.tonnes * (COMMODITIES.find(x => x.id === c.commodity)?.base ?? 0) * 0.5;
    return v;
  }

  /** expected encounters per day of flight with the current cargo */
  risk(): number {
    const v = this.cargoValue();
    if (v < PIRATE_MIN_VALUE) return 0;
    // stealth hulls never show up on a raider's scope
    if (this.sim.econ.ship.stealth) return 0;
    const sys = this.sim.system;
    return 0.12 * Math.min(3, v / 80000) * (sys.def.uncharted ? 1.8 : sys.id === 'sol' ? 0.7 : 1);
  }

  private exposed(): boolean {
    const sim = this.sim, s = sim.ship;
    if (s.docked || s.landed || sim.jumpTransit > 0) return false;
    if (sim.altitude < 5e5) return false;
    return !this.nearStation();
  }

  private nearStation(): boolean {
    const s = this.sim.ship;
    return this.sim.system.bodies.some(b => b.isStation && !b.isPort && b.pos.distanceTo(s.pos) < STATION_GUARD_M * 6);
  }

  update(realDt: number) {
    const sim = this.sim, t = sim.t;
    if (isNaN(this.lastT)) this.lastT = t;
    const dt = Math.max(0, t - this.lastT);
    this.lastT = t;
    if (this.active) { this.fly(realDt, dt); return; }
    // a flight ends when you dock or touch down: the next one may be raided again
    if (sim.ship.docked || sim.ship.landed) this.metThisFlight = false;
    if (this.metThisFlight) return;
    this.checkT += dt;
    if (this.checkT < 60 && dt < 60) return;
    const span = this.checkT; this.checkT = 0;
    if (t < this.quietUntil || !this.exposed()) return;
    const lambda = this.risk();
    if (lambda > 0 && Math.random() < 1 - Math.exp(-lambda * span / DAY)) this.spawn();
  }

  private spawn() {
    const sim = this.sim, s = sim.ship;
    const v = this.cargoValue();
    // they come in from behind, already closing
    const back = _d.subVectors(s.vel, sim.dominant.vel);
    if (back.lengthSq() < 1) back.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5);
    back.normalize().negate();
    const rel = back.clone().multiplyScalar(28000);
    const relV = back.clone().multiplyScalar(-250);
    const name = NAMES[Math.floor(Math.random() * NAMES.length)];
    const npc: Npc = {
      id: 'pirate', name: `${name} (raider)`, shipId: Math.random() < 0.5 ? 'heron' : 'prospector',
      pos: rel.clone().add(s.pos), vel: relV.clone().add(s.vel), acc: new Vector3(), quat: new Quaternion(),
      maxAcc: 0, state: 'pirate', dest: sim.dominant, timer: 0, holdRel: new Vector3(), origin: null,
      departDir: new Vector3(), aTot: new Vector3(), t: sim.t,
    };
    const acc = 150 + 40 * Math.random();
    npc.maxAcc = acc;
    this.active = { npc, rel, relV, acc, demand: Math.max(1000, Math.round(v * DEMAND_SHARE / 100) * 100), timer: PIRATE_DEMAND_S, phase: 'demand' };
    sim.traffic.npcs = [...sim.traffic.npcs, npc];
    this.metThisFlight = true;
    sim.warp = 1;
    if (sim.ap.active) sim.ap.disengage();
    const c = sim.econ.career;
    c?.count('pirateEncounters');
    const msg = `Raider ${name} closing from behind! They demand ${this.active.demand.toLocaleString('en-US')} cr — PAY, or run at full power`;
    c?.note(msg, 'warn');
    sim.onEvent(msg, 'warn');
  }

  private end(msg: string, kind: 'info' | 'warn' | 'good', stat: string) {
    const sim = this.sim, a = this.active;
    if (!a) return;
    sim.traffic.npcs = sim.traffic.npcs.filter(n => n !== a.npc);
    this.active = null;
    this.quietUntil = sim.t + DAY;
    sim.econ.career?.count(stat);
    sim.econ.career?.note(msg, kind);
    sim.onEvent(msg, kind);
    sim.econ.save(); sim.econ.onChange();
  }

  /** pay the demand (credits, or a share of the hold if you can't) */
  pay() {
    const a = this.active, e = this.sim.econ;
    if (!a) return;
    if (e.credits >= a.demand) {
      e.credits -= a.demand;
      e.career?.spend('pirates', a.demand);
      this.end(`Paid the raiders ${a.demand.toLocaleString('en-US')} cr. They peel away.`, 'info', 'piratePaid');
    } else {
      const lost = this.take(DEMAND_SHARE);
      this.end(`Not enough credits — the raiders took ${lost} of your cargo instead.`, 'warn', 'piratePaid');
    }
    this.sim.applyShipClass();
  }

  /** remove a share of every lot in the hold; returns a description */
  private take(share: number): string {
    const e = this.sim.econ;
    let t = 0, value = 0;
    for (const id of Object.keys(e.cargo)) {
      const n = Math.ceil(e.cargo[id] * share);
      if (n <= 0) continue;
      value += n * (COMMODITIES.find(c => c.id === id)?.base ?? 0);
      e.jettison(id, n);
      t += n;
    }
    e.career?.spend('pirates', value);
    return `${t} t`;
  }

  private fly(realDt: number, simDt: number) {
    const sim = this.sim, s = sim.ship, a = this.active!;
    if (!sim.traffic.npcs.includes(a.npc)) { this.end('You jumped clear of the raiders.', 'good', 'pirateEscapes'); return; }
    if (s.docked || s.landed) { this.end('The raiders break off as you set down.', 'good', 'pirateEscapes'); return; }
    if (this.sim.system.bodies.some(b => b.isStation && !b.isPort && b.pos.distanceTo(s.pos) < STATION_GUARD_M)) {
      this.end('Station patrol craft scramble — the raiders turn tail.', 'good', 'pirateEscapes'); return;
    }
    a.timer -= realDt;
    if (a.phase === 'demand' && a.timer <= 0) {
      a.phase = 'board';
      sim.onEvent('No answer — the raiders are moving to board you!', 'warn');
    }
    // relative motion: both feel (nearly) the same gravity, so only the engines matter
    const steps = Math.min(30, Math.max(1, Math.ceil(simDt / 0.2)));
    const dt = simDt / steps;
    const stand = a.phase === 'demand' ? 2500 : 0;
    for (let k = 0; k < steps; k++) {
      const d = a.rel.length();
      const gap = Math.max(0, d - stand);
      const speed = Math.min(Math.sqrt(2 * a.acc * 0.8 * gap), gap / 2 + 1);
      _d.copy(a.rel).multiplyScalar(-speed / Math.max(d, 1e-6)).sub(a.relV);
      const need = _d.length(), step = Math.min(need, a.acc * dt);
      _a.copy(_d).multiplyScalar(need > 1e-9 ? step / need / dt : 0);
      a.npc.acc.copy(_a);
      a.relV.addScaledVector(_a, dt).addScaledVector(s.thrustAccel, -dt);
      a.rel.addScaledVector(a.relV, dt);
    }
    a.npc.pos.copy(s.pos).add(a.rel);
    a.npc.vel.copy(s.vel).add(a.relV);
    a.npc.aTot.copy(a.npc.acc);
    a.npc.t = sim.t;
    const d = a.rel.length();
    if (d > PIRATE_ESCAPE_M) { this.end('You out-ran the raiders! They break off the chase.', 'good', 'pirateEscapes'); return; }
    if (a.phase === 'board' && d < 3000) {
      const lost = this.take(BOARD_SHARE);
      // sealed contract cargo goes with it
      const c = sim.econ.career;
      if (c) for (const k of c.contracts.filter(x => x.kind === 'courier')) c.abandon(k);
      this.end(`Boarded! The raiders stripped ${lost} from your hold.`, 'warn', 'pirateBoarded');
      sim.applyShipClass();
    }
  }
}

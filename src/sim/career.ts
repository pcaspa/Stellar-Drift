import { COMMODITIES } from '../data/commodities';
import { SHIPS, type ShipClass } from '../data/ships';
import type { Sim } from './sim';
import { Autopilot } from './autopilot';
import type { Body, StarSystem } from './universe';

const DAY = 86400;
const AU = 1.495978707e11;
const LY = 9.4607304725808e15;
/** contract time limits assume the slowest ship, fully laden, flying in economy mode (Atlas, full hold) */
const SLOW_ACC = 6.1 * 9.81 * 0.5 * 0.75;

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function rng(seed: number) {
  let h = seed >>> 0 || 1;
  return () => { h = (Math.imul(h, 1664525) + 1013904223) >>> 0; return h / 4294967296; };
}

// ------------------------------------------------------------------ contracts
export type ContractKind = 'courier' | 'passengers' | 'procure' | 'survey';

export interface Contract {
  id: string;
  kind: ContractKind;
  client: string;
  /** station that offered it */
  from: string;
  /** destination station id (survey: the station the data goes back to) */
  to: string;
  toSystem: string;
  /** courier: sealed cargo; procure: commodity to bring */
  commodity?: string;
  /** hold space taken (courier cargo, passenger cabins) or tonnes to deliver (procure) */
  tonnes: number;
  pax?: number;
  /** survey: the uncharted system, the body to scan there, and whether it has been scanned */
  survey?: string;
  scan?: string;
  scanned?: boolean;
  reward: number;
  penalty: number;
  /** sim time limit (set when accepted) */
  deadline: number;
  /** time allowed from acceptance, s */
  duration?: number;
}

const CLIENTS = [
  'Helios Freight', 'Ceres Mutual', 'Tycho Logistics', 'Ares Agricultural Co-op', 'Kuiper Water Authority',
  'Luna Medical Trust', 'Tau Ceti Concord', 'Orbital Survey Office', 'Barnard Mining Guild', 'Marigold Couriers',
  'Huygens Refining', 'Earth Relief Fund', 'Proxima Settlers Union', 'Deep Field Institute',
];
const PAX_KIND = ['contract engineers', 'colonists', 'tourists', 'research staff', 'medical team', 'miners on rotation', 'diplomatic delegation'];

/** most contracts you can hold at once */
export const MAX_CONTRACTS = 4;
/** contract offers at a station change this often */
const OFFER_EPOCH = 2 * DAY;

// ------------------------------------------------------------------ running costs
/** daily cost of running a ship (crew wages + maintenance), as a fraction of its price */
export const UPKEEP_PER_DAY = 0.004;
export const CREW_SHARE = 0.4;
export function upkeepPerDay(c: ShipClass): number { return c.upkeep ?? c.price * UPKEEP_PER_DAY; }
/** port charges each time you dock */
export function dockingFee(c: ShipClass): number { return Math.round(25 + 0.0004 * c.price); }

// ------------------------------------------------------------------ fleet
export interface FleetShip {
  id: string;
  shipId: string;
  name: string;
  /** trade loop between two stations (ids), or idle */
  a?: string;
  b?: string;
  /** progress through the current loop, days */
  progress: number;
  cycles: number;
  lastProfit: number;
  totalProfit: number;
}
export const MAX_FLEET = 5;
/** the crew's share of a trade loop's profit */
export const FLEET_CREW_CUT = 0.25;
/** share of the quoted best margin a crew actually realises (partial loads, price slippage, middlemen) */
export const FLEET_YIELD = 0.35;
/** chance that a loop is lost to accidents, spoilage or raiders */
const FLEET_LOSS = 0.04;
/** resale value of a fleet ship, fraction of its price */
export const FLEET_RESALE = 0.6;
const FLEET_NAMES = ['Wanderer', 'Hope of Ceres', 'Morning Star', 'Little Bear', 'Steady Hand', 'Far Meadow', 'Iron Lotus',
  'Sable', 'Good Fortune', 'Albedo', 'Second Wind', 'Lantern', 'Swift Return', 'Patience'];

// ------------------------------------------------------------------ ledger
export type EarnKind = 'trade' | 'mining' | 'contracts' | 'survey' | 'fleet' | 'other';
export type SpendKind = 'fuel' | 'ships' | 'upkeep' | 'port' | 'tow' | 'medical' | 'pirates' | 'penalties';
export interface LogEntry { t: number; msg: string; kind: 'info' | 'warn' | 'good'; }

export interface CareerData {
  contracts: Contract[];
  closed: string[];
  owed: number;
  fleet: FleetShip[];
  earned: Record<string, number>;
  spent: Record<string, number>;
  counts: Record<string, number>;
  routes: Record<string, { profit: number; tonnes: number }>;
  boughtAt: Record<string, string>;
  log: LogEntry[];
  startT: number;
  playSec: number;
  nextId: number;
}

/**
 * Career layer over the market: contracts offered at stations, ship running costs, a ledger of
 * where your credits come from and go, a logbook, and a fleet of crewed ships flying trade loops.
 * Persisted with the economy save.
 */
export class Career {
  contracts: Contract[] = [];
  /** ids of offers taken or finished (so they don't come back) */
  private closed: string[] = [];
  /** running costs not yet settled (paid automatically whenever you dock) */
  owed = 0;
  fleet: FleetShip[] = [];
  earned: Record<string, number> = {};
  spent: Record<string, number> = {};
  counts: Record<string, number> = {};
  routes: Record<string, { profit: number; tonnes: number }> = {};
  /** where each commodity in the hold was last bought (or 'mined on X') */
  boughtAt: Record<string, string> = {};
  log: LogEntry[] = [];
  startT = 0;
  playSec = 0;
  private nextId = 1;
  private lastT = NaN;
  private slow = 0;
  private offerCache = new Map<string, Contract[]>();

  onEvent: (msg: string, kind?: 'info' | 'warn' | 'good') => void = () => {};

  constructor(private sim: Sim) {}

  get econ() { return this.sim.econ; }

  // ------------------------------------------------------------ ledger helpers
  earn(kind: EarnKind, amt: number) { if (amt) this.earned[kind] = (this.earned[kind] ?? 0) + amt; }
  spend(kind: SpendKind, amt: number) { if (amt) this.spent[kind] = (this.spent[kind] ?? 0) + amt; }
  count(k: string, n = 1) { this.counts[k] = (this.counts[k] ?? 0) + n; }
  note(msg: string, kind: LogEntry['kind'] = 'info') {
    this.log.push({ t: this.sim.t, msg, kind });
    if (this.log.length > 400) this.log.splice(0, this.log.length - 400);
  }

  /** market hooks (called by the economy) */
  bought(id: string, at: string) { this.boughtAt[id] = at; }
  mined(id: string, n: number, on: string) { this.boughtAt[id] = `mined on ${on}`; this.count('tonnesMined', n); }
  sold(id: string, n: number, revenue: number, basis: number, at: string) {
    const from = this.boughtAt[id] ?? 'unknown';
    const profit = revenue - basis;
    const mined = from.startsWith('mined');
    this.earn(mined ? 'mining' : 'trade', profit);
    this.count('tonnesSold', n);
    const name = COMMODITIES.find(c => c.id === id)?.name ?? id;
    const key = `${name}: ${from} → ${at}`;
    const r = this.routes[key] ?? (this.routes[key] = { profit: 0, tonnes: 0 });
    r.profit += profit; r.tonnes += n;
    if ((this.econ.cargo[id] ?? 0) <= 0) delete this.boughtAt[id];
  }

  get totalEarned() { return Object.values(this.earned).reduce((a, b) => a + b, 0); }
  get totalSpent() { return Object.values(this.spent).reduce((a, b) => a + b, 0); }

  // ------------------------------------------------------------ hold space
  /** hold space taken by contract cargo and passenger cabins */
  get reserved(): number {
    return this.contracts.reduce((a, c) => a + (c.kind === 'courier' || c.kind === 'passengers' ? c.tonnes : 0), 0);
  }

  // ------------------------------------------------------------ travel estimates
  private stations(): Body[] { return this.sim.universe.systems.flatMap(s => s.bodies.filter(b => b.isStation)); }
  station(id: string): Body | undefined { return this.stations().find(b => b.id === id); }
  system(id: string): StarSystem | undefined { return this.sim.universe.systems.find(s => s.id === id); }

  /** rough autopilot trip time from a station to another station (or system), days */
  legDays(a: Body, to: Body | StarSystem, perf = 0.8): number {
    const acc = 6.1 * 9.81 * perf * 0.5;
    const t = (d: number) => 2 * Math.sqrt(Math.max(d, 1e6) / acc) / DAY;
    const toSys = 'galPos' in to ? to : to.system;
    if (toSys === a.system && !('galPos' in to)) return 0.25 + t(a.pos.distanceTo(to.pos));
    // out to a clear jump point, then in from the arrival point
    const arrive = Math.max(toSys.extent * 1.5, toSys.star.radius * 40);
    return 0.5 + t(Math.max(a.pos.length() * 0.2, 5e9)) + ('galPos' in to ? 0 : t(arrive));
  }
  ly(a: StarSystem, b: StarSystem) { return a.galPos.distanceTo(b.galPos) / LY; }

  /**
   * Generous autopilot trip time in economy mode for the slowest laden ship, days: the same trip model
   * the autopilot flies, with 30% extra distance (planets move on), undocking and docking. Between
   * systems: climb out and jump, then the economy leg from the arrival point.
   */
  ecoDays(from: Body, to: Body | StarSystem): number {
    const eco = (d: number) => Autopilot.trip(Math.max(d, 1e6), SLOW_ACC, true).t / DAY;
    const toSys = 'galPos' in to ? to : to.system;
    if (!('galPos' in to) && to.system === from.system) return 0.6 + eco(from.pos.distanceTo(to.pos) * 1.3);
    const arrive = Math.max(toSys.extent * 1.5, toSys.star.radius * 40);
    return 1 + eco(arrive * 1.2);
  }

  /** time allowed for a contract, s (comfortably achievable in economy mode) */
  durationFor(c: Contract): number {
    const from = this.station(c.from), to = this.station(c.to);
    if (!from || !to) return 30 * DAY;
    if (c.kind === 'survey') {
      const sys = this.system(c.survey ?? c.toSystem);
      const body = sys?.byId.get(c.scan ?? '');
      if (!sys) return 30 * DAY;
      const out = this.ecoDays(from, sys), back = body ? this.ecoDays(body, to) : out;
      return (1.5 * (out + back) + 4) * DAY;
    }
    const e = this.ecoDays(from, to);
    switch (c.kind) {
      case 'courier': return (1.5 * e + 2) * DAY;
      case 'passengers': return (1.35 * e + 1.5) * DAY;
      default: return (1.6 * e + 5) * DAY; // procurement: time to buy or mine the goods too
    }
  }

  // ------------------------------------------------------------ offers
  /** contracts on offer at a station (deterministic for a couple of days at a time) */
  offers(st: Body): Contract[] {
    const t = this.sim.t;
    const epoch = Math.floor(t / OFFER_EPOCH);
    const key = `${st.id}:${epoch}`;
    let list = this.offerCache.get(key);
    if (!list) { list = this.generate(st, epoch); this.offerCache.set(key, list); }
    // (the clock starts when you accept: an offer always shows its full time)
    return list.filter(c => !this.closed.includes(c.id) && !this.contracts.some(x => x.id === c.id))
      .map(c => ({ ...c, deadline: t + (c.duration ?? 0) }));
  }

  private generate(st: Body, epoch: number): Contract[] {
    const rand = rng(hash(`${st.id}:${epoch}`));
    const pick = <T>(a: T[]) => a[Math.floor(rand() * a.length)];
    const local = st.system.bodies.filter(b => b.isStation && b !== st);
    const far = this.stations().filter(b => b.system !== st.system && this.ly(b.system, st.system) < 13);
    const uncharted = this.sim.universe.systems.filter(s => s.def.uncharted && this.ly(s, st.system) < 15);
    const goods = COMMODITIES.filter(c => !c.restricted && c.id !== 'helionite');
    const out: Contract[] = [];
    const n = 5;
    for (let i = 0; i < n; i++) {
      const id = `${st.id}:${epoch}:${i}`;
      const roll = rand();
      const client = pick(CLIENTS);
      if (roll < 0.12 && uncharted.length) {
        const sys = pick(uncharted);
        // something specific to scan there: one of its asteroids (the ore survey) or a planet
        const rocks = sys.bodies.filter(b => b.def.kind === 'asteroid');
        const worlds = sys.bodies.filter(b => b.def.kind === 'planet' || b.def.kind === 'moon');
        const body = rocks.length && (rand() < 0.6 || !worlds.length) ? pick(rocks) : worlds.length ? pick(worlds) : null;
        if (!body) continue;
        const ly = this.ly(sys, st.system);
        const reward = Math.round((4000 + 1300 * ly) / 50) * 50;
        out.push({ id, kind: 'survey', client: 'Orbital Survey Office', from: st.id, to: st.id, toSystem: st.system.id, tonnes: 0,
          survey: sys.id, scan: body.id, scanned: false,
          reward, penalty: Math.round(reward * 0.2), deadline: 0 });
        continue;
      }
      const dest = (rand() < 0.65 || !far.length) && local.length ? pick(local) : far.length ? pick(far) : null;
      if (!dest) continue;
      const ly = this.ly(dest.system, st.system);
      const au = dest.system === st.system ? st.pos.distanceTo(dest.pos) / AU : 0;
      const reach = Math.sqrt(au) + 0.9 * ly;
      if (roll < 0.47) {
        const tonnes = pick([5, 8, 10, 12, 15, 20, 30, 45, 60, 90, 140, 220, 400]);
        const c = pick(goods);
        const reward = Math.round((600 + tonnes * (25 + 60 * reach)) / 10) * 10;
        out.push({ id, kind: 'courier', client, from: st.id, to: dest.id, toSystem: dest.system.id, commodity: c.id, tonnes,
          reward, penalty: Math.round(reward * 0.35), deadline: 0 });
      } else if (roll < 0.74) {
        const pax = pick([2, 3, 4, 6, 8, 10, 12, 16, 24, 40]);
        const reward = Math.round(pax * (120 + 220 * reach) / 10) * 10;
        out.push({ id, kind: 'passengers', client: pick(PAX_KIND), from: st.id, to: dest.id, toSystem: dest.system.id, tonnes: pax, pax,
          reward, penalty: Math.round(reward * 0.5), deadline: 0 });
      } else {
        const c = pick(goods);
        const tonnes = pick([5, 10, 15, 20, 30, 50, 80, 120]);
        const reward = Math.round((400 + tonnes * c.base * (1.35 + 0.08 * reach)) / 10) * 10;
        out.push({ id, kind: 'procure', client, from: st.id, to: dest.id, toSystem: dest.system.id, commodity: c.id, tonnes,
          reward, penalty: Math.round(reward * 0.15), deadline: 0 });
      }
    }
    for (const c of out) c.duration = this.durationFor(c);
    return out;
  }

  /** why a contract can't be accepted right now, or null */
  cantAccept(c: Contract): string | null {
    if (this.contracts.length >= MAX_CONTRACTS) return `You can hold at most ${MAX_CONTRACTS} contracts`;
    if ((c.kind === 'courier' || c.kind === 'passengers') && this.econ.cargoFree < c.tonnes)
      return c.kind === 'courier' ? `Needs ${c.tonnes} t of free hold space` : `Needs ${c.tonnes} t of hold space for cabins`;
    return null;
  }

  accept(c: Contract): string | null {
    const why = this.cantAccept(c);
    if (why) return why;
    this.contracts.push({ ...c, deadline: this.sim.t + (c.duration ?? this.durationFor(c)) });
    this.closed.push(c.id);
    if (this.closed.length > 300) this.closed.splice(0, this.closed.length - 300);
    this.note(`Contract accepted: ${this.describe(c)}`, 'info');
    this.sim.applyShipClass();
    this.econ.save(); this.econ.onChange();
    return null;
  }

  abandon(c: Contract) { this.fail(c, 'abandoned'); }

  private fail(c: Contract, why: string) {
    this.contracts = this.contracts.filter(x => x !== c);
    this.charge('penalties', c.penalty);
    this.count('contractsFailed');
    const msg = `Contract ${why}: ${this.describe(c)} — penalty ${c.penalty.toLocaleString('en-US')} cr`;
    this.note(msg, 'warn'); this.sim.onEvent(msg, 'warn');
    this.sim.applyShipClass();
    this.econ.save(); this.econ.onChange();
  }

  private complete(c: Contract) {
    this.contracts = this.contracts.filter(x => x !== c);
    this.econ.credits += c.reward;
    this.earn('contracts', c.reward);
    this.count('contractsDone');
    const msg = `Contract complete: ${this.describe(c)} — paid ${c.reward.toLocaleString('en-US')} cr`;
    this.note(msg, 'good'); this.sim.onEvent(msg, 'good');
    this.sim.applyShipClass();
    this.econ.save(); this.econ.onChange();
  }

  destName(c: Contract): string {
    if (c.kind === 'survey' && !c.scan) return `${this.system(c.toSystem)?.name ?? c.toSystem} system`;
    const b = this.station(c.to);
    return b ? (b.system === this.sim.system ? b.name : `${b.name} (${b.system.name})`) : c.to;
  }
  /** where to fly next for a contract: for a survey, the body to scan (or its system) until it's scanned */
  destBody(c: Contract): Body | StarSystem | undefined {
    if (c.kind === 'survey' && !c.scan) return this.system(c.toSystem);
    if (c.kind === 'survey' && !c.scanned) {
      const sys = this.system(c.survey!);
      return sys === this.sim.system ? sys?.byId.get(c.scan!) ?? sys : sys;
    }
    return this.station(c.to);
  }
  /** the survey's body and system names */
  surveyNames(c: Contract): { body: string; sys: string } {
    const sys = this.system(c.survey ?? c.toSystem);
    return { body: sys?.byId.get(c.scan ?? '')?.name ?? c.scan ?? '', sys: sys?.name ?? '' };
  }
  /** a scan finished (or an already-scanned body was looked at): records survey data */
  onScan(b: Body) {
    for (const c of this.contracts) {
      if (c.kind !== 'survey' || c.scanned || c.scan !== b.id) continue;
      c.scanned = true;
      const msg = `Survey data on ${b.name} recorded — take it back to ${this.destName(c)} to get paid`;
      this.note(msg, 'good'); this.sim.onEvent(msg, 'good');
      this.econ.save();
    }
  }

  describe(c: Contract): string {
    const cn = c.commodity ? COMMODITIES.find(x => x.id === c.commodity)?.name : '';
    switch (c.kind) {
      case 'courier': return `deliver ${c.tonnes} t of sealed ${cn} to ${this.destName(c)}`;
      case 'passengers': return `carry ${c.pax} ${c.client} to ${this.destName(c)}`;
      case 'procure': return `bring ${c.tonnes} t of ${cn} to ${this.destName(c)}`;
      case 'survey': {
        if (!c.scan) return `survey the uncharted ${this.destName(c)}`;
        const n = this.surveyNames(c);
        return `scan ${n.body} in the uncharted ${n.sys} system and bring the data to ${this.destName(c)}`;
      }
    }
  }

  // ------------------------------------------------------------ fleet
  fleetCount(): number { return this.fleet.length; }

  buyFleetShip(id: string): string | null {
    const c = SHIPS.find(s => s.id === id);
    if (!c) return 'Unknown ship';
    if (this.fleet.length >= MAX_FLEET) return `Your fleet is limited to ${MAX_FLEET} ships`;
    if (this.owed > 0.5) return `Settle your outstanding running costs (${Math.ceil(this.owed).toLocaleString('en-US')} cr) first`;
    if (this.econ.credits < c.price) return `You need ${Math.ceil(c.price - this.econ.credits).toLocaleString('en-US')} more credits`;
    this.econ.credits -= c.price;
    this.spend('ships', c.price);
    const used = new Set(this.fleet.map(f => f.name));
    const name = FLEET_NAMES.find(n => !used.has(n)) ?? `Fleet ${this.nextId}`;
    const home = this.sim.ship.docked;
    this.fleet.push({ id: `f${this.nextId++}`, shipId: c.id, name, a: home?.id, b: undefined, progress: 0, cycles: 0, lastProfit: 0, totalProfit: 0 });
    this.note(`Bought the ${c.name} "${name}" for your fleet and hired a crew`, 'good');
    this.econ.save(); this.econ.onChange();
    return null;
  }

  sellFleetShip(f: FleetShip) {
    const c = SHIPS.find(s => s.id === f.shipId)!;
    const v = Math.round(c.price * FLEET_RESALE);
    this.fleet = this.fleet.filter(x => x !== f);
    this.econ.credits += v;
    this.earn('other', v);
    this.note(`Sold fleet ship "${f.name}" (${c.name}) for ${v.toLocaleString('en-US')} cr`, 'info');
    this.econ.save(); this.econ.onChange();
  }

  assign(f: FleetShip, a: string | undefined, b: string | undefined) {
    f.a = a; f.b = b && b !== a ? b : undefined; f.progress = 0;
    const A = a ? this.station(a) : undefined, B = f.b ? this.station(f.b) : undefined;
    if (A && B) this.note(`"${f.name}" assigned to the loop ${A.name} ⇄ ${B.name}`, 'info');
    this.econ.save();
  }

  /** a loop's length in days for a fleet ship */
  loopDays(f: FleetShip): number {
    const A = f.a ? this.station(f.a) : undefined, B = f.b ? this.station(f.b) : undefined;
    if (!A || !B) return 0;
    const c = SHIPS.find(s => s.id === f.shipId)!;
    // crews fly economically and wait for cargo and buyers at each end
    return 2 * (2 * this.legDays(A, B, c.perf * 0.85) + 1.5);
  }

  /** best per-tonne margin buying at A and selling at B right now */
  bestMargin(A: Body, B: Body): { id: string; m: number } {
    const t = this.sim.t;
    const qa = this.econ.quotes(A, t), qb = this.econ.quotes(B, t);
    let best = { id: '', m: 0 };
    for (let i = 0; i < qa.length; i++) {
      if (!qa[i].canBuy || qa[i].c.id === 'helionite') continue;
      const m = qb[i].sell - qa[i].buy;
      if (m > best.m) best = { id: qa[i].c.id, m };
    }
    return best;
  }

  /** expected profit of one loop for the owner (after the crew's cut) */
  loopProfit(f: FleetShip): number {
    const A = f.a ? this.station(f.a) : undefined, B = f.b ? this.station(f.b) : undefined;
    if (!A || !B) return 0;
    const cap = SHIPS.find(s => s.id === f.shipId)!.cargo;
    return (this.bestMargin(A, B).m + this.bestMargin(B, A).m) * cap * FLEET_YIELD * (1 - FLEET_CREW_CUT);
  }

  // ------------------------------------------------------------ running costs
  /** total running cost per day: your ship plus the fleet */
  get upkeepRate(): number {
    return upkeepPerDay(this.econ.ship) + this.fleet.reduce((a, f) => a + upkeepPerDay(SHIPS.find(s => s.id === f.shipId)!), 0);
  }

  /** take a charge from credits; whatever can't be paid now is added to what's owed */
  charge(kind: SpendKind, amt: number) {
    if (amt <= 0) return;
    this.spend(kind, amt);
    const pay = Math.min(amt, Math.max(0, this.econ.credits));
    this.econ.credits -= pay;
    this.owed += amt - pay;
  }

  /** pay running costs when docked */
  private settle() {
    if (this.owed <= 0.5 || this.econ.credits <= 0) return;
    const pay = Math.min(this.owed, this.econ.credits);
    this.econ.credits -= pay;
    this.owed -= pay;
    this.econ.onChange();
  }

  /** a (non-silent) docking: port charges */
  onDocked(st: Body) {
    const fee = dockingFee(this.econ.ship);
    this.spend('port', fee);
    this.owed += fee;
    const due = this.owed;
    this.count('docks');
    this.settle();
    const left = this.owed;
    if (due > 1) this.sim.onEvent(`Port charges and running costs settled: ${Math.round(due - left).toLocaleString('en-US')} cr${left > 1 ? ` — ${Math.round(left).toLocaleString('en-US')} cr still owed` : ''}`, left > 1 ? 'warn' : 'info');
    this.note(`Docked at ${st.name}`, 'info');
    this.checkContracts();
  }

  // ------------------------------------------------------------ per frame
  tick(realDt: number) {
    const t = this.sim.t;
    this.playSec += realDt;
    if (isNaN(this.lastT)) this.lastT = t;
    const dt = Math.max(0, t - this.lastT);
    this.lastT = t;
    if (dt > 0) {
      // running costs accrue continuously and are billed at the next station
      const cost = this.upkeepRate * dt / DAY;
      this.owed += cost;
      this.spend('upkeep', cost);
      // distance flown (relative to the dominant body)
      if (!this.sim.ship.landed) this.count('distance', this.sim.ship.vel.distanceTo(this.sim.dominant.vel) * dt);
      this.fleetTick(dt / DAY);
    }
    this.slow -= realDt;
    if (this.slow > 0) return;
    this.slow = 0.5;
    if (this.sim.ship.docked) this.settle();
    this.checkContracts();
  }

  private checkContracts() {
    const sim = this.sim, t = sim.t, docked = sim.ship.docked;
    for (const c of [...this.contracts]) {
      // (older survey contracts, without a scan target, paid on arrival in the system)
      if (c.kind === 'survey' && !c.scan && sim.system.id === c.toSystem) { this.complete(c); continue; }
      if (c.kind === 'survey' && c.scan && c.scanned && docked && docked.id === c.to) { this.complete(c); continue; }
      if (docked && docked.id === c.to) {
        if (c.kind === 'courier' || c.kind === 'passengers') { this.complete(c); continue; }
        if (c.kind === 'procure' && (this.econ.cargo[c.commodity!] ?? 0) >= c.tonnes) {
          this.econ.cargo[c.commodity!] -= c.tonnes;
          if (this.econ.cargo[c.commodity!] <= 0) { delete this.econ.cargo[c.commodity!]; delete this.econ.paid[c.commodity!]; }
          this.complete(c); continue;
        }
      }
      if (t > c.deadline) this.fail(c, 'expired');
    }
  }

  private fleetTick(days: number) {
    for (const f of this.fleet) {
      const L = this.loopDays(f);
      if (!L) continue;
      f.progress += days;
      // at high warp several loops can finish in one frame
      let n = 0;
      while (f.progress >= L && n < 50) {
        f.progress -= L; n++;
        const lost = Math.random() < FLEET_LOSS;
        const p = lost ? 0 : Math.round(this.loopProfit(f));
        f.cycles++; f.lastProfit = p; f.totalProfit += p;
        if (lost) { this.note(`Fleet: "${f.name}" lost a loop's cargo to an accident en route`, 'warn'); this.count('fleetLosses'); }
        else if (p > 0) { this.econ.credits += p; this.earn('fleet', p); }
      }
      if (n) this.econ.onChange();
    }
  }

  // ------------------------------------------------------------ persistence
  toJSON(): CareerData {
    return {
      contracts: this.contracts, closed: this.closed, owed: this.owed, fleet: this.fleet,
      earned: this.earned, spent: this.spent, counts: this.counts, routes: this.routes, boughtAt: this.boughtAt,
      log: this.log, startT: this.startT, playSec: this.playSec, nextId: this.nextId,
    };
  }

  load(d: Partial<CareerData> | undefined, t: number) {
    this.contracts = d?.contracts ?? []; this.closed = d?.closed ?? []; this.owed = d?.owed ?? 0;
    this.fleet = (d?.fleet ?? []).filter(f => SHIPS.some(s => s.id === f.shipId));
    this.earned = d?.earned ?? {}; this.spent = d?.spent ?? {}; this.counts = d?.counts ?? {};
    this.routes = d?.routes ?? {}; this.boughtAt = d?.boughtAt ?? {}; this.log = d?.log ?? [];
    this.startT = d?.startT ?? t; this.playSec = d?.playSec ?? 0; this.nextId = d?.nextId ?? 1;
    this.lastT = t;
    // contracts taken under the old (fast-travel) time limits get the economy-mode allowance
    for (const c of this.contracts) {
      if (c.duration) continue;
      c.duration = this.durationFor(c);
      c.deadline = Math.max(c.deadline, t + c.duration);
    }
  }
}

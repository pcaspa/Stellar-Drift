import { COMMODITIES, Commodity, ECONOMIES } from '../data/commodities';
import { FULL_TANK_DV, JUMP_TANK_PER_LY, SHIPS, ShipClass } from '../data/ships';
import { ORE_MIX } from '../data/asteroids';
import type { Body } from './universe';
import { OFF_SITE_RICHNESS, type Site } from './sites';
import type { Career, CareerData } from './career';

const SAVE_KEY = 'stellardrift.save.v1';
/** commodity id of the drive fuel */
export const FUEL_ID = 'helionite';
const DAY = 86400;
/** how fast market pressure from your own trades decays (e-folding time) */
const PRESSURE_TAU = 4 * DAY;
/** price impact per tonne traded, as a fraction of a station's typical lot */
const IMPACT = 0.0035;
const SPREAD = 0.035;

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) / 4294967296;
}

export interface Quote { c: Commodity; buy: number; sell: number; mid: number; canBuy: boolean; trend: number; }

interface SaveData {
  credits: number; ship: string; cargo: Record<string, number>; fuel?: number;
  paid: Record<string, number>;
  pressure: Record<string, { v: number; t: number }>;
  docked?: string; system?: string; t?: number;
  visited?: string[];
  place?: SavedPlace;
  career?: CareerData;
}

/** where the ship was when not docked: relative to a body (body-fixed frame when landed) */
export interface SavedPlace { body: string; landed: boolean; pos: number[]; vel: number[]; quat: number[]; }

export class Economy {
  credits = 3000;
  shipId = 'kestrel';
  /** tonnes held per commodity */
  cargo: Record<string, number> = {};
  /** average price paid per commodity (for profit display) */
  paid: Record<string, number> = {};
  private pressure: Record<string, { v: number; t: number }> = {};
  onChange: () => void = () => {};
  /** contracts, running costs, ledger and fleet (set up by the sim) */
  career: Career | null = null;
  /** career data read from the save, until the career layer picks it up */
  careerData: CareerData | undefined;

  /** fusion fuel aboard, tonnes */
  fuel = 12;

  get ship(): ShipClass { return SHIPS.find(s => s.id === this.shipId) ?? SHIPS[0]; }
  get fuelFrac(): number { return this.fuel / this.ship.fuelCap; }
  /** total mass divided by dry mass: cargo and fuel make every burn cost more */
  get massFactor(): number { const s = this.ship; return (s.dryMass + this.cargoUsed + this.fuel) / s.dryMass; }

  /** tonnes of fuel needed for a given delta-v (m/s) at the current mass */
  fuelFor(dv: number): number { return dv * this.massFactor * this.ship.fuelCap / FULL_TANK_DV; }

  /** burn fuel for an impulse; returns the fraction of the requested burn that was possible */
  burn(dv: number): number {
    if (dv <= 0) return 1;
    const need = this.fuelFor(dv);
    if (need <= this.fuel) { this.fuel -= need; return 1; }
    const f = this.fuel / need;
    this.fuel = 0;
    return f;
  }

  jumpFuel(ly: number): number { return ly * JUMP_TANK_PER_LY * this.ship.fuelCap * Math.sqrt(this.massFactor); }

  /** Helionite (fuel) price per tonne at a station: its market buying price (cheap at refineries, dear on the frontier) */
  fuelPrice(station: Body, t: number): number {
    return this.quote(station, COMMODITIES.find(c => c.id === FUEL_ID)!, t).buy;
  }

  /** move Helionite from the cargo hold into the fuel tank; returns tonnes loaded */
  loadFuel(tonnes = Infinity): number {
    const n = Math.min(tonnes, this.cargo[FUEL_ID] ?? 0, Math.max(0, this.ship.fuelCap - this.fuel));
    if (n <= 0.0005) return 0;
    this.fuel += n;
    this.cargo[FUEL_ID] -= n;
    if (this.cargo[FUEL_ID] <= 1e-6) { delete this.cargo[FUEL_ID]; delete this.paid[FUEL_ID]; }
    this.save(); this.onChange();
    return n;
  }

  /** fill up (or buy as much as you can afford); returns tonnes bought */
  refuel(station: Body, t: number): number {
    const p = this.fuelPrice(station, t);
    const want = Math.max(0, this.ship.fuelCap - this.fuel);
    const can = Math.min(want, this.credits / p);
    if (can <= 0.0005) return 0;
    this.fuel += can;
    this.credits -= can * p;
    this.career?.spend('fuel', can * p);
    this.save(); this.onChange();
    return can;
  }

  // ------------------------------------------------------------- mining
  /** partially extracted tonnes per commodity (only whole tonnes go into the hold) */
  private oreBuf: Record<string, number> = {};
  /** tonnes mined this session (for the HUD) */
  minedTotal = 0;

  /**
   * tonnes per hour of each commodity the current ship's rig recovers: on a surface deposit its
   * concentrated mix and bonus richness, anywhere else the body's bulk ore at reduced richness
   */
  mineYield(body: Body, site: Site | null = null): Record<string, number> {
    const m = this.ship.miner, ore = body.def.ore, out: Record<string, number> = {};
    if (!m || !ore) return out;
    const mix = site ? site.mix : ORE_MIX[ore.cls];
    const rich = ore.rich * (site ? site.rich : OFF_SITE_RICHNESS);
    for (const [id, f] of Object.entries(mix)) {
      if (m.only && !m.only.includes(id)) continue;
      if (f > 0) out[id] = m.rate * rich * f;
    }
    return out;
  }

  /** names of what the current rig would actually keep (largest first) */
  minedNames(body: Body, site: Site | null = null): string[] {
    return Object.entries(this.mineYield(body, site)).sort((a, b) => b[1] - a[1])
      .map(([id]) => COMMODITIES.find(c => c.id === id)?.name ?? id);
  }

  /** true if the rig can recover the commodity a deposit is rich in */
  rigTakes(id: string): boolean { const m = this.ship.miner; return !!m && (!m.only || m.only.includes(id)); }

  /** total recovery rate on this body (or deposit) with the current ship, t/h (0 if not possible) */
  mineRate(body: Body, site: Site | null = null): number { return Object.values(this.mineYield(body, site)).reduce((a, b) => a + b, 0); }

  /**
   * Run the drills for dt seconds on a body. Returns null while mining can continue,
   * otherwise the reason it stopped.
   */
  mine(body: Body, dt: number, site: Site | null = null): string | null {
    const m = this.ship.miner, ore = body.def.ore;
    if (!m) return 'this ship has no mining rig';
    if (!ore) return `${body.name} has nothing worth mining`;
    const yieldH = this.mineYield(body, site);
    const rate = Object.values(yieldH).reduce((a, b) => a + b, 0);
    if (rate <= 0) return `${body.name} has nothing your ${this.ship.name}'s rig can recover`;
    if (this.cargoFree < 1) return 'cargo hold full';
    if (this.fuel <= 0) return 'out of fuel';
    let amount = rate * dt / 3600;
    amount = Math.min(amount, this.fuel / m.fuelPerTonne);
    this.fuel = Math.max(0, this.fuel - amount * m.fuelPerTonne);
    this.minedTotal += amount;
    let changed = false;
    for (const [id, r] of Object.entries(yieldH)) {
      const f = r / rate;
      this.oreBuf[id] = (this.oreBuf[id] ?? 0) + amount * f;
      while (this.oreBuf[id] >= 1 && this.cargoFree >= 1) {
        this.oreBuf[id] -= 1;
        const held = this.cargo[id] ?? 0;
        // mined ore cost nothing but fuel: track it at zero purchase price
        this.paid[id] = ((this.paid[id] ?? 0) * held) / (held + 1);
        this.cargo[id] = held + 1;
        this.career?.mined(id, 1, body.name);
        changed = true;
      }
    }
    if (changed) { this.save(); this.onChange(); }
    if (this.cargoFree < 1) return 'cargo hold full';
    if (this.fuel <= 0) return 'out of fuel';
    return null;
  }

  // ------------------------------------------------------------- exploration
  /** uncharted systems already surveyed (first arrival) */
  visited: string[] = [];
  static readonly SURVEY_BONUS = 1250;

  /** first arrival in an uncharted system pays a survey bonus; returns the credits paid (0 if already surveyed) */
  survey(systemId: string): number {
    if (this.visited.includes(systemId)) return 0;
    this.visited.push(systemId);
    this.credits += Economy.SURVEY_BONUS;
    this.career?.earn('survey', Economy.SURVEY_BONUS);
    this.save(); this.onChange();
    return Economy.SURVEY_BONUS;
  }

  /** emergency tow fee */
  /** emergency tow to the nearest space station (if you have less, it takes what you have) */
  static readonly TOW_FEE = 10000;
  towFee(): number { return Economy.TOW_FEE; }
  get cargoUsed(): number { return Object.values(this.cargo).reduce((a, b) => a + b, 0) + (this.career?.reserved ?? 0); }
  get cargoFree(): number { return this.ship.cargo - this.cargoUsed; }

  private mult(station: Body, id: string): number {
    const eco = ECONOMIES[station.def.station!.economy];
    return eco.mult[id] ?? 1;
  }

  private pressureNow(key: string, t: number): number {
    const p = this.pressure[key];
    if (!p) return 0;
    return p.v * Math.exp(-Math.max(0, t - p.t) / PRESSURE_TAU);
  }

  quote(station: Body, c: Commodity, t: number): Quote {
    const m = this.mult(station, c.id);
    const seed = hash(station.id + c.id);
    // slow deterministic market drift (periods of weeks to months)
    const days = t / DAY;
    const drift = 1 + 0.09 * Math.sin(days / (9 + 14 * seed) + seed * 40) + 0.05 * Math.sin(days / (3 + 4 * seed) + seed * 17);
    const trend = Math.cos(days / (9 + 14 * seed) + seed * 40);
    // interstellar premium on everything that has to be hauled between stars
    const remote = station.system.id === 'sol' ? 1 : 1.12;
    const press = this.pressureNow(station.id + ':' + c.id, t);
    const mid = c.base * m * drift * (m > 1 ? remote : 1) * (1 + press);
    return {
      c, mid, buy: Math.ceil(mid * (1 + SPREAD)), sell: Math.floor(mid * (1 - SPREAD)),
      canBuy: !c.restricted || m < 1, trend,
    };
  }

  quotes(station: Body, t: number): Quote[] { return COMMODITIES.map(c => this.quote(station, c, t)); }

  private push(station: Body, id: string, t: number, dv: number) {
    const key = station.id + ':' + id;
    const v = Math.max(-0.45, Math.min(0.8, this.pressureNow(key, t) + dv));
    this.pressure[key] = { v, t };
  }

  /** refund (at the price paid) anything bought beyond the hold's capacity — repairs saves made
   * while buying could overfill the hold; returns credits refunded */
  refundedOnLoad = 0;
  private fixOverload() {
    let over = this.cargoUsed - this.ship.cargo;
    if (over <= 1e-6) return;
    // most expensive purchases first, then anything else
    const ids = Object.keys(this.cargo).sort((a, b) => (this.paid[b] ?? 0) - (this.paid[a] ?? 0));
    for (const id of ids) {
      if (over <= 1e-6) break;
      const n = Math.min(this.cargo[id], Math.ceil(over - 1e-6));
      const refund = n * (this.paid[id] ?? 0);
      this.credits += refund; this.refundedOnLoad += refund;
      this.cargo[id] -= n; over -= n;
      if (this.cargo[id] <= 1e-6) { delete this.cargo[id]; delete this.paid[id]; }
    }
    this.save();
  }

  /** returns tonnes actually bought */
  buy(station: Body, id: string, tonnes: number, t: number): number {
    const c = COMMODITIES.find(x => x.id === id)!;
    let done = 0, spent = 0;
    // trade tonne by tonne so price impact is applied fairly
    for (let i = 0; i < tonnes; i++) {
      const q = this.quote(station, c, t);
      // (the hold is only updated after the loop, so count what this purchase has already added)
      if (!q.canBuy || this.cargoFree - done < 1 || this.credits < q.buy) break;
      this.credits -= q.buy; spent += q.buy; done++;
      this.push(station, id, t, IMPACT);
    }
    if (done) {
      const held = this.cargo[id] ?? 0;
      this.paid[id] = ((this.paid[id] ?? 0) * held + spent) / (held + done);
      this.cargo[id] = held + done;
      this.career?.bought(id, station.name);
      this.save(); this.onChange();
    }
    return done;
  }

  /** returns credits earned */
  sell(station: Body, id: string, tonnes: number, t: number): number {
    const c = COMMODITIES.find(x => x.id === id)!;
    let earned = 0, done = 0;
    const n = Math.min(tonnes, this.cargo[id] ?? 0);
    for (let i = 0; i < n; i++) {
      const q = this.quote(station, c, t);
      this.credits += q.sell; earned += q.sell; done++;
      this.push(station, id, t, -IMPACT);
    }
    if (done) {
      const basis = (this.paid[id] ?? 0) * done;
      this.cargo[id] -= done;
      if (this.cargo[id] <= 0) { delete this.cargo[id]; delete this.paid[id]; }
      this.career?.sold(id, done, earned, basis, station.name);
      this.save(); this.onChange();
    }
    return earned;
  }

  /** throw cargo overboard; returns tonnes removed */
  jettison(id: string, tonnes: number): number {
    const n = Math.min(tonnes, this.cargo[id] ?? 0);
    if (n <= 0) return 0;
    this.cargo[id] -= n;
    if (this.cargo[id] <= 0) { delete this.cargo[id]; delete this.paid[id]; }
    this.save(); this.onChange();
    return n;
  }

  tradeIn(): number { return Math.round(this.ship.price * 0.7); }

  /** buy a new ship, trading in the current one. returns an error message or null */
  buyShip(id: string): string | null {
    const s = SHIPS.find(x => x.id === id);
    if (!s) return 'Unknown ship';
    if (s.id === this.shipId) return 'You already fly this ship';
    const cost = s.price - this.tradeIn();
    if (cost > this.credits) return `You need ${Math.ceil(cost - this.credits).toLocaleString('en-US')} more credits`;
    if (this.cargoUsed > s.cargo) return `Sell cargo first: the ${s.name} holds only ${s.cargo} t`;
    const owed = this.career?.owed ?? 0;
    if (owed > 0.5) return `Settle your outstanding running costs (${Math.ceil(owed).toLocaleString('en-US')} cr) first`;
    this.credits -= cost;
    if (cost >= 0) this.career?.spend('ships', cost); else this.career?.earn('other', -cost);
    this.career?.note(`Bought a ${s.name}`, 'good');
    this.shipId = s.id;
    this.fuel = s.fuelCap; // new ships are delivered fully fuelled
    this.save(); this.onChange();
    return null;
  }

  // ------------------------------------------------------------- persistence
  dockedAt: string | undefined;
  systemId: string | undefined;
  /** ship position when the save was made away from a station */
  place: SavedPlace | undefined;
  savedT: number | undefined;

  save(extra?: { docked?: string; system?: string; t?: number }) {
    if (extra) { this.dockedAt = extra.docked; this.systemId = extra.system; this.savedT = extra.t; }
    const d: SaveData = {
      credits: this.credits, ship: this.shipId, cargo: this.cargo, fuel: this.fuel, paid: this.paid, pressure: this.pressure,
      docked: this.dockedAt, system: this.systemId, t: this.savedT, visited: this.visited,
      place: this.dockedAt ? undefined : this.place,
      career: this.career?.toJSON() ?? this.careerData,
    };
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(d)); } catch { /* storage unavailable: play without saving */ }
  }

  load(): boolean {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return false;
      const d = JSON.parse(raw) as SaveData;
      if (typeof d.credits !== 'number' || !SHIPS.some(s => s.id === d.ship)) return false;
      this.credits = d.credits; this.shipId = d.ship;
      this.cargo = d.cargo ?? {}; this.paid = d.paid ?? {}; this.pressure = d.pressure ?? {};
      this.dockedAt = d.docked; this.systemId = d.system; this.savedT = d.t;
      this.visited = Array.isArray(d.visited) ? d.visited : [];
      this.place = d.place && Array.isArray(d.place.pos) ? d.place : undefined;
      this.careerData = d.career;
      this.fuel = typeof d.fuel === 'number' ? Math.min(d.fuel, this.ship.fuelCap) : this.ship.fuelCap;
      this.fixOverload();
      return true;
    } catch { return false; }
  }

  reset() {
    try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ }
    this.credits = 3000; this.shipId = 'kestrel'; this.cargo = {}; this.paid = {}; this.pressure = {}; this.fuel = 12; this.visited = [];
    this.dockedAt = undefined; this.systemId = undefined; this.savedT = undefined; this.place = undefined;
    this.careerData = undefined; this.career?.load(undefined, 0);
    this.onChange();
  }
}

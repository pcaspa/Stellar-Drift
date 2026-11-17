export interface ShipClass {
  id: string;
  name: string;
  role: string;
  /** purchase price, credits */
  price: number;
  /** cargo capacity, tonnes */
  cargo: number;
  /** engine performance multiplier (bigger ships are slower) */
  perf: number;
  /** overall length, m */
  length: number;
  /** empty mass, tonnes */
  dryMass: number;
  /** fusion fuel (deuterium/helium-3 pellets) capacity, tonnes */
  fuelCap: number;
  /**
   * mining rig: extraction rate (tonnes of ore per hour of sim time at richness 1), fuel burned per
   * tonne kept, and optionally the only commodities it can recover (everything else is left behind)
   */
  miner?: { rate: number; fuelPerTonne: number; only?: string[] };
  /** stealth hull: raiders never pick it up */
  stealth?: boolean;
  /** running costs per day, credits (default: a fixed share of the price) */
  upkeep?: number;
  desc: string;
}

/** delta-v a full tank gives an unladen ship, m/s (fusion torch, game-balanced) */
export const FULL_TANK_DV = 4.8e7;
/** jump drive fuel use: fraction of a full tank per light-year */
export const JUMP_TANK_PER_LY = 0.0125;

export const SHIPS: ShipClass[] = [
  { id: 'kestrel', name: 'Kestrel', role: 'Fast courier', price: 40000, cargo: 20, perf: 1.0, length: 28, dryMass: 45, fuelCap: 12,
    miner: { rate: 6, fuelPerTonne: 0.015, only: ['water', 'helionite'] },
    desc: 'Agile lifting-body courier with twin fusion torches and a small ice-coring drill (water ice and frozen Helionite). Small hold, huge fun.' },
  { id: 'prospector', name: 'Prospector', role: 'Mining cutter', price: 75000, cargo: 35, perf: 0.9, length: 34, dryMass: 70, fuelCap: 16,
    miner: { rate: 8, fuelPerTonne: 0.012 },
    desc: 'Entry-level mining cutter: a core drill, two ore hoppers and landing struts built for low gravity.' },
  { id: 'heron', name: 'Heron', role: 'Light freighter', price: 140000, cargo: 60, perf: 0.85, length: 46, dryMass: 160, fuelCap: 30,
    desc: 'A reliable workhorse: six standard containers on an open spine, three main engines.' },
  { id: 'excavator', name: 'Excavator', role: 'Mining barge', price: 420000, cargo: 140, perf: 0.7, length: 64, dryMass: 380, fuelCap: 60,
    miner: { rate: 30, fuelPerTonne: 0.01 },
    desc: 'Twin-drill mining barge with a refinery spine and six ore hoppers.' },
  { id: 'albatross', name: 'Albatross', role: 'Medium freighter', price: 480000, cargo: 160, perf: 0.72, length: 72, dryMass: 420, fuelCap: 70,
    desc: 'Twelve-container hauler with deployable radiators and a pressurised crew deck.' },
  { id: 'leviathan', name: 'Leviathan', role: 'Heavy hauler', price: 1500000, cargo: 420, perf: 0.6, length: 112, dryMass: 1100, fuelCap: 160,
    desc: 'Twin cargo spines, insulated propellant spheres and six engines. A trader\'s flagship.' },
  { id: 'behemoth', name: 'Behemoth', role: 'Industrial miner', price: 1900000, cargo: 500, perf: 0.55, length: 120, dryMass: 1400, fuelCap: 190,
    miner: { rate: 110, fuelPerTonne: 0.008 },
    desc: 'A flying strip-mine: four heavy drills, an on-board smelter and a hold the size of a cathedral.' },
  { id: 'atlas', name: 'Atlas', role: 'Bulk carrier', price: 5200000, cargo: 1100, perf: 0.5, length: 170, dryMass: 2600, fuelCap: 360,
    desc: 'A city-block of cargo racks behind an eight-engine fusion cluster. The biggest thing you can fly.' },
  { id: 'wraith', name: 'Wraith', role: 'Stealth mining carrier', price: 10000000, cargo: 1100, perf: 0.985, length: 170, dryMass: 2400, fuelCap: 380,
    miner: { rate: 140, fuelPerTonne: 0.007 }, stealth: true, upkeep: 8000,
    desc: 'A black, radar-absorbing blade the size of an Atlas, with four heavy drills in its belly and a six-torch drive. Raiders never see it coming — or going.' },
];

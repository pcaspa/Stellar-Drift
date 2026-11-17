export interface Commodity {
  id: string;
  name: string;
  /** base price, credits per tonne */
  base: number;
  fictional?: boolean;
  /** only buyable where produced (exotic goods) */
  restricted?: boolean;
  desc: string;
}

export const COMMODITIES: Commodity[] = [
  { id: 'water', name: 'Water Ice', base: 60, desc: 'Drinking, shielding and propellant feedstock. The universal currency of space.' },
  { id: 'oxygen', name: 'Liquid Oxygen', base: 75, desc: 'Breathing gas and oxidiser.' },
  { id: 'hydrogen', name: 'Liquid Hydrogen', base: 90, desc: 'Fusion fuel and reaction mass.' },
  { id: 'nitrogen', name: 'Nitrogen', base: 55, desc: 'Buffer gas for habitats and fertiliser feedstock.' },
  { id: 'methane', name: 'Methane', base: 70, desc: 'Hydrocarbon feedstock for plastics and rocket fuel.' },
  { id: 'helium3', name: 'Helium-3', base: 1200, desc: 'Clean aneutronic fusion fuel, mined from regolith and gas giants.' },
  { id: 'iron', name: 'Iron Ore', base: 45, desc: 'Bulk metal for shipyards and construction.' },
  { id: 'titanium', name: 'Titanium', base: 325, desc: 'Light, strong structural metal.' },
  { id: 'rareearths', name: 'Rare Earth Elements', base: 900, desc: 'Neodymium, dysprosium and friends — magnets and electronics.' },
  { id: 'platinum', name: 'Platinum-Group Metals', base: 2600, desc: 'Catalysts and electronics, abundant in metallic asteroids.' },
  { id: 'food', name: 'Food Rations', base: 150, desc: 'Shelf-stable meals for crews and colonies.' },
  { id: 'produce', name: 'Hydroponic Produce', base: 260, desc: 'Fresh fruit and vegetables — priceless far from home.' },
  { id: 'medical', name: 'Medical Supplies', base: 1300, desc: 'Pharmaceuticals, diagnostics and radiation treatment.' },
  { id: 'machinery', name: 'Machinery', base: 700, desc: 'Mining rigs, fabricators and habitat systems.' },
  { id: 'electronics', name: 'Electronics', base: 1600, desc: 'Processors, sensors and control systems.' },
  { id: 'luxury', name: 'Luxury Goods', base: 2250, desc: 'Wine, art, real wood and other comforts of Earth.' },
  { id: 'nanofiber', name: 'Nanofiber Weave', base: 1900, fictional: true, desc: 'Carbon-nanotube textile used for hulls and tethers.' },
  { id: 'fusioncores', name: 'Fusion Cores', base: 3900, fictional: true, restricted: true, desc: 'Sealed compact fusion reactors.' },
  { id: 'terraform', name: 'Terraforming Kits', base: 4500, fictional: true, restricted: true, desc: 'Engineered microbes and atmosphere processors.' },
  { id: 'xenobio', name: 'Xeno-Biologics', base: 5500, fictional: true, restricted: true, desc: 'Biochemistry samples from exoplanet environments.' },
  { id: 'quantum', name: 'Quantum Processors', base: 7500, fictional: true, restricted: true, desc: 'Cryogenic qubit arrays for navigation computers.' },
  { id: 'antimatter', name: 'Antimatter Cells', base: 12000, fictional: true, restricted: true, desc: 'Magnetically confined antihydrogen. Handle with care.' },
  // fusion drive fuel: what every ship's tank holds; refuelling buys it at the station's market price
  { id: 'helionite', name: 'Helionite', base: 190, fictional: true, desc: 'Frozen deuterium–helium-3 fusion pellets: the fuel in every drive. Load cargo Helionite into your tank anywhere.' },
  // only found in the asteroid belts of uncharted systems (no station sells them)
  { id: 'iridium', name: 'Iridium', base: 4750, restricted: true, desc: 'The rarest stable metal in the Earth’s crust: spark electrodes, crucibles and drive-bell alloys.' },
  { id: 'rhodium', name: 'Rhodium', base: 7000, restricted: true, desc: 'Ultra-rare platinum-group metal for catalysts and mirror coatings.' },
  { id: 'xenocrystal', name: 'Xenocrystals', base: 14000, fictional: true, restricted: true, desc: 'Lattice-perfect crystals grown over billions of years in alien dust discs. Prized for quantum memory.' },
  { id: 'exotic', name: 'Exotic Matter', base: 36000, fictional: true, restricted: true, desc: 'Barely stable negative-energy inclusions — the holy grail of jump-drive research.' },
];

export type EconomyType = 'core' | 'lunar' | 'mars' | 'titan' | 'pluto' | 'frontier' | 'research' | 'refinery' | 'mining' | 'earthport';

/** price multipliers: < 1 produced here (cheap), > 1 in demand (expensive) */
export const ECONOMIES: Record<EconomyType, { label: string; mult: Record<string, number> }> = {
  core: { label: 'High-tech core world', mult: {
    iridium: 1.3, rhodium: 1.35, xenocrystal: 1.2, exotic: 1.15,
    electronics: 0.7, medical: 0.7, luxury: 0.75, machinery: 0.75, quantum: 0.85, food: 0.85, fusioncores: 0.9,
    water: 1.6, helium3: 1.5, platinum: 1.4, rareearths: 1.45, titanium: 1.3, xenobio: 1.8, antimatter: 1.25 } },
  lunar: { label: 'Lunar mining & industry', mult: {
    helionite: 0.75,
    helium3: 0.6, titanium: 0.65, iron: 0.7, oxygen: 0.7,
    food: 1.5, produce: 1.6, water: 1.7, medical: 1.3, electronics: 1.2, luxury: 1.2 } },
  mars: { label: 'Agricultural & industrial colony', mult: {
    helionite: 1.15,
    produce: 0.7, food: 0.8, iron: 0.75, rareearths: 0.8, nanofiber: 0.8,
    water: 1.4, nitrogen: 1.6, machinery: 1.4, electronics: 1.3, terraform: 1.5, medical: 1.3 } },
  titan: { label: 'Hydrocarbon refinery', mult: {
    helionite: 0.75,
    methane: 0.5, nitrogen: 0.5, hydrogen: 0.7, nanofiber: 0.7,
    food: 1.6, produce: 1.7, medical: 1.5, machinery: 1.5, luxury: 1.4, fusioncores: 1.3 } },
  pluto: { label: 'Frontier ice outpost', mult: {
    helionite: 1.45,
    water: 0.55, nitrogen: 0.6, methane: 0.7,
    food: 1.8, produce: 1.8, medical: 1.7, machinery: 1.6, electronics: 1.6, luxury: 1.6, fusioncores: 1.4 } },
  frontier: { label: 'Frontier colony', mult: {
    helionite: 1.45, iridium: 1.15, rhodium: 1.1,
    xenobio: 0.7, platinum: 0.85, water: 0.8, terraform: 1.6,
    medical: 1.8, electronics: 1.8, machinery: 1.7, food: 1.6, produce: 1.7, quantum: 1.5, luxury: 1.8 } },
  research: { label: 'Research station', mult: {
    helionite: 1.15, xenocrystal: 1.5, exotic: 1.6,
    quantum: 0.7, xenobio: 0.65, antimatter: 0.85, terraform: 0.8,
    produce: 1.6, medical: 1.6, luxury: 1.7, electronics: 1.4, food: 1.5, helium3: 1.3 } },
  refinery: { label: 'Gas giant refinery', mult: {
    helionite: 0.55, exotic: 1.3,
    hydrogen: 0.5, helium3: 0.55, antimatter: 0.7, fusioncores: 0.7,
    machinery: 1.6, food: 1.6, medical: 1.5, titanium: 1.4, produce: 1.7, electronics: 1.3 } },
  // Earth's ground spaceports: everything made on Earth is cheap here; anything from space is dear
  earthport: { label: 'Earth spaceport', mult: {
    food: 0.5, produce: 0.45, medical: 0.55, machinery: 0.55, electronics: 0.6, luxury: 0.5, oxygen: 0.65, nitrogen: 0.7,
    nanofiber: 0.85, water: 0.75,
    helium3: 1.6, platinum: 1.5, rareearths: 1.35, titanium: 1.25, helionite: 1.3,
    iridium: 1.45, rhodium: 1.5, xenocrystal: 1.4, exotic: 1.25, xenobio: 2.0, antimatter: 1.3 } },
  mining: { label: 'Mining outpost', mult: {
    helionite: 1.15,
    iron: 0.55, titanium: 0.6, platinum: 0.6, rareearths: 0.65,
    food: 1.7, water: 1.5, machinery: 1.4, medical: 1.5, oxygen: 1.5, produce: 1.8, luxury: 1.5 } },
};

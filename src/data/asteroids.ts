import { AU_KM, BodyDef, SystemDef } from './types';

export type OreClass = 'C' | 'S' | 'M' | 'X' | 'H';

/** fraction of extracted material per commodity, by spectral class */
export const ORE_MIX: Record<OreClass, Record<string, number>> = {
  // carbonaceous: water ice, volatiles and some metal
  C: { water: 0.45, iron: 0.2, nitrogen: 0.1, methane: 0.1, rareearths: 0.1, platinum: 0.05 },
  // silicaceous: stony-iron with titanium and rare earths
  S: { iron: 0.45, titanium: 0.25, rareearths: 0.15, water: 0.1, platinum: 0.05 },
  // metallic: exposed planetary cores, rich in platinum-group metals
  M: { iron: 0.55, platinum: 0.2, rareearths: 0.15, titanium: 0.1 },
  // exotic: only in uncharted systems — metal-rich with ultra-rare metals, xenocrystals and traces of exotic matter
  X: { iron: 0.3, rareearths: 0.15, iridium: 0.14, platinum: 0.12, rhodium: 0.1, helionite: 0.1, xenocrystal: 0.07, exotic: 0.02 },
  // helionite-bearing: icy bodies with frozen fusion fuel (uncharted systems only)
  H: { helionite: 0.4, water: 0.25, helium3: 0.1, methane: 0.1, iridium: 0.05, xenocrystal: 0.05, nitrogen: 0.05 },
};

export const ORE_LABEL: Record<OreClass, string> = {
  C: 'C-type · carbonaceous', S: 'S-type · stony-iron', M: 'M-type · metallic',
  X: 'X-type · exotic', H: 'H-type · helionite-bearing',
};

const PALETTE: Record<OreClass, string[]> = {
  C: ['#4d4a46', '#2f2d2a', '#6b665f'],
  S: ['#8f8273', '#5e554b', '#b0a392'],
  M: ['#8d8f93', '#5c5e62', '#b9bcc1'],
  X: ['#6e5a7d', '#3d3049', '#a48fb8'],
  H: ['#5d7f8f', '#34505c', '#a3c6d4'],
};

/** GM (km^3/s^2) of a rocky body of radius r km and density rho kg/m^3 */
function gmFor(rKm: number, rho = 2000): number {
  return 6.674e-20 * (4 / 3) * Math.PI * rKm ** 3 * rho * 1e9;
}

interface Rock { id: string; name: string; a: number; e: number; i: number; node: number; w: number; M: number; r: number; gm?: number; rot: number; cls: OreClass; rich: number; desc: string; }

/** ten more real main-belt asteroids (J2000-ish elements, mean radius km) */
const SOL_ROCKS: Rock[] = [
  { id: 'hygiea', name: 'Hygiea', a: 3.142, e: 0.112, i: 3.83, node: 283.2, w: 312.3, M: 152, r: 217, gm: 5.78, rot: 13.8, cls: 'C', rich: 1.0,
    desc: 'Fourth-largest asteroid and possibly the smallest dwarf planet. A dark, nearly round ball of carbonaceous rock and ice.' },
  { id: 'juno', name: 'Juno', a: 2.669, e: 0.257, i: 12.99, node: 169.8, w: 248.1, M: 30, r: 127, gm: 1.8, rot: 7.21, cls: 'S', rich: 1.1,
    desc: 'One of the first four asteroids discovered (1804). A bright stony body with a large fresh crater.' },
  { id: 'psyche', name: 'Psyche', a: 2.924, e: 0.134, i: 3.10, node: 150.0, w: 229.2, M: 80, r: 111, gm: 1.53, rot: 4.196, cls: 'M', rich: 1.5,
    desc: 'A metal-rich world that may be the exposed core of a shattered protoplanet. Target of NASA\'s Psyche mission.' },
  { id: 'eunomia', name: 'Eunomia', a: 2.643, e: 0.187, i: 11.75, node: 292.9, w: 98.6, M: 260, r: 135, gm: 2.1, rot: 6.08, cls: 'S', rich: 1.0,
    desc: 'Largest of the stony S-type asteroids and parent of a whole collisional family.' },
  { id: 'davida', name: 'Davida', a: 3.165, e: 0.188, i: 15.94, node: 107.6, w: 337.2, M: 200, r: 145, gm: 2.26, rot: 5.13, cls: 'C', rich: 0.9,
    desc: 'One of the largest asteroids: a dark, primitive carbonaceous body.' },
  { id: 'interamnia', name: 'Interamnia', a: 3.056, e: 0.155, i: 17.31, node: 280.3, w: 95.6, M: 330, r: 166, gm: 2.5, rot: 8.73, cls: 'C', rich: 1.05,
    desc: 'A large, surprisingly round asteroid of an unusual F-type composition, rich in volatiles.' },
  { id: 'sylvia', name: 'Sylvia', a: 3.48, e: 0.09, i: 10.86, node: 73.0, w: 263.6, M: 120, r: 136, gm: 0.99, rot: 5.18, cls: 'C', rich: 0.85,
    desc: 'A porous rubble pile with two small moons, Romulus and Remus.' },
  { id: 'hebe', name: 'Hebe', a: 2.425, e: 0.203, i: 14.74, node: 138.6, w: 239.8, M: 10, r: 93, gm: 0.93, rot: 7.27, cls: 'S', rich: 1.2,
    desc: 'Probable parent body of the H-chondrite meteorites that fall to Earth.' },
  { id: 'iris', name: 'Iris', a: 2.386, e: 0.231, i: 5.52, node: 259.5, w: 145.3, M: 190, r: 100, gm: 0.91, rot: 7.14, cls: 'S', rich: 1.0,
    desc: 'A bright stony asteroid, sometimes visible through binoculars.' },
  { id: 'bamberga', name: 'Bamberga', a: 2.684, e: 0.341, i: 11.1, node: 327.8, w: 44.2, M: 270, r: 114, gm: 0.69, rot: 29.4, cls: 'C', rich: 0.95,
    desc: 'A very dark carbonaceous asteroid on an eccentric orbit, slowly rotating.' },
];

/** composition for the pre-existing Sol small bodies */
export const SOL_ORE: Record<string, { cls: OreClass; rich: number }> = {
  ceres: { cls: 'C', rich: 1.3 }, vesta: { cls: 'S', rich: 1.15 }, pallas: { cls: 'C', rich: 0.9 },
};

/** asteroid belts for the exoplanet systems: [inner AU, outer AU], catalogue prefix */
const EXO_BELTS: Record<string, { inner: number; outer: number; prefix: string; visual: boolean }> = {
  proxima: { inner: 0.07, outer: 0.11, prefix: 'PRX', visual: true },
  barnard: { inner: 0.06, outer: 0.09, prefix: 'BRN', visual: true },
  wolf359: { inner: 0.3, outer: 0.6, prefix: 'WLF', visual: true },
  lalande: { inner: 0.9, outer: 1.4, prefix: 'LAL', visual: true },
  epseri: { inner: 2.6, outer: 3.1, prefix: 'EPS', visual: false },
  ross128: { inner: 0.08, outer: 0.12, prefix: 'ROS', visual: true },
  tauceti: { inner: 2.0, outer: 3.0, prefix: 'TAU', visual: true },
  gj876: { inner: 0.55, outer: 0.8, prefix: 'GJ8', visual: true },
  trappist1: { inner: 0.09, outer: 0.13, prefix: 'TRP', visual: true },
  '55cnc': { inner: 2.0, outer: 3.0, prefix: 'CNC', visual: true },
};

function rng(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
  return () => { h = (Math.imul(h, 1664525) + 1013904223) >>> 0; return h / 4294967296; };
}

function rockDef(r: Rock, starId: string): BodyDef {
  return {
    id: r.id, name: r.name, parent: starId, kind: 'asteroid', radius: r.r, gm: r.gm ?? gmFor(r.r),
    orbit: { a: r.a * AU_KM, e: r.e, i: r.i, node: r.node, argPeri: r.w, M0: r.M, plane: 'ecliptic' },
    rotationHours: r.rot, pole: [r.node * 1.7 % 360, 30 + (r.w % 50)],
    surface: 'rock', palette: PALETTE[r.cls], landable: true, relief: Math.max(0.5, r.r * 0.06), tempK: 170,
    desc: r.desc, ore: { cls: r.cls, rich: r.rich },
  };
}

/** extra bodies and belts for a system: asteroids (Sol: real ones; others: generated catalogue) */
export function asteroidsFor(sys: SystemDef): { bodies: BodyDef[]; belts: NonNullable<SystemDef['belts']> } {
  const star = sys.bodies.find(b => !b.parent)!;
  if (sys.id === 'sol') return { bodies: SOL_ROCKS.map(r => rockDef(r, star.id)), belts: [] };
  const belt = sys.oreBelt ? { ...sys.oreBelt, visual: false } : EXO_BELTS[sys.id];
  if (!belt) return { bodies: [], belts: [] };
  const rnd = rng(sys.id + 'belt');
  // uncharted belts are untouched: exotic and helionite-bearing rocks, and richer on average
  const wild = !!sys.uncharted;
  const classes: OreClass[] = wild ? ['X', 'H', 'X', 'M', 'H', 'C'] : ['C', 'S', 'M', 'C', 'S'];
  const count = classes.length;
  const bodies: BodyDef[] = [];
  for (let n = 0; n < count; n++) {
    const cls = classes[(n + Math.floor(rnd() * count)) % count];
    const r: Rock = {
      id: `${sys.id}_ast${n + 1}`, name: `${belt.prefix}-${101 + n * 7 + Math.floor(rnd() * 6)}`,
      a: belt.inner + (belt.outer - belt.inner) * rnd(), e: 0.02 + 0.13 * rnd(), i: 8 * rnd(),
      node: 360 * rnd(), w: 360 * rnd(), M: 360 * rnd(), r: Math.round(4 + 70 * rnd() ** 2), rot: 3 + 20 * rnd(),
      cls, rich: Math.round((wild ? 1.1 + 0.9 * rnd() : 0.7 + 0.9 * rnd()) * 100) / 100,
      desc: wild ? `An unexplored ${ORE_LABEL[cls]} asteroid in the ${sys.name} belt. No one has ever set down here.`
        : `Catalogued ${cls}-type asteroid in the ${sys.name} belt.`,
    };
    bodies.push(rockDef(r, star.id));
  }
  const belts = belt.visual ? [{ inner: belt.inner, outer: belt.outer, count: 1800, color: '#8a8378' }] : [];
  return { bodies, belts };
}

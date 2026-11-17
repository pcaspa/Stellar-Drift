import { AU_KM, AtmosphereDef, BodyDef, SurfaceType, SystemDef } from './types';

const GM_SUN = 1.32712440018e11;
const GM_EARTH = 398600.4418;
const R_EARTH = 6371;
const R_SUN = 695700;

export interface ExoStar { name: string; mass: number; radius: number; teff: number; lum: number; spectral: string; desc: string; }
export interface ExoPlanet {
  letter: string; a: number; e?: number; mass: number; radius?: number;
  type?: SurfaceType; note: string; discovery: string; candidate?: boolean;
}

function starColor(teff: number): string {
  if (teff < 2800) return '#ff7a3d';
  if (teff < 3300) return '#ff9a5c';
  if (teff < 3800) return '#ffb27a';
  if (teff < 4600) return '#ffc999';
  if (teff < 5300) return '#ffe2bd';
  if (teff < 6000) return '#fff1dc';
  return '#f4f6ff';
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) / 4294967296;
}

function massToRadius(m: number): number {
  if (m < 2) return Math.pow(m, 0.279);
  if (m < 130) return 1.213 * Math.pow(m / 2, 0.55);
  return 11.5;
}

function classify(m: number, r: number, teq: number): SurfaceType {
  if (m > 50 || r > 6) return 'gas';
  if (m > 9 || r > 2.4) return 'icegiant';
  if (teq > 1000) return 'lava';
  if (teq > 330) return m > 2.5 ? 'venus' : 'rock';
  if (teq > 230) return m > 3 ? 'ocean' : 'terra';
  return 'ice';
}

function palette(type: SurfaceType, teq: number, seed: number): string[] {
  switch (type) {
    case 'gas':
      if (teq > 900) return ['#27314f', '#141a30', '#4a3a5c', '#d9623a'];
      if (teq > 350) return ['#5a78b5', '#39558f', '#8aa3d4', '#c9d6f0'];
      if (teq > 150) return ['#e8e4dc', '#c9c0b0', '#f7f5f0', '#a8b5c9'];
      return seed > 0.5 ? ['#c9a47a', '#e8d9bd', '#a8693f', '#f0e6d0'] : ['#d6b98c', '#b58a5a', '#efe2c4', '#8f5d3a'];
    case 'icegiant':
      if (teq > 600) return ['#6b5fa8', '#4a3f85', '#9a8fd0'];
      if (teq > 250) return ['#6fb0c9', '#4a8aa8', '#a8d6e6'];
      return seed > 0.5 ? ['#4a78d9', '#3558b0', '#7a9ff0'] : ['#8fd0db', '#6ab5c4', '#b8e6ee'];
    case 'lava': return ['#2a1a14', '#140c0a', '#ff5a1a', '#ffb347'];
    case 'venus': return ['#c9a060', '#8f6a38', '#e6cc98'];
    case 'rock': return seed > 0.5 ? ['#8a6f5c', '#5a4538', '#b0957f'] : ['#7d7872', '#4f4b47', '#a8a29a'];
    case 'terra': return ['#1f4f8f', '#5a7a3a', '#b59a6a', '#f0f0f0'];
    case 'ocean': return ['#16407a', '#0f2d5c', '#2a66a8', '#f4f6f8'];
    default: return ['#d6e2ec', '#9ab0c4', '#f7fafc'];
  }
}

function atmosphere(type: SurfaceType, m: number, r: number, teq: number): AtmosphereDef | undefined {
  const g = m / (r * r); // in Earth g
  switch (type) {
    case 'gas': {
      const H = Math.max(8, 27 * (teq / 165) * (2.5 / Math.max(0.4, g)));
      const hot = teq > 900;
      return { density: 0.2, scaleHeight: Math.min(H, 400), pressureBar: 1000, composition: 'H₂, He (assumed)',
        rayleigh: hot ? [5, 7, 14] : [7, 8.5, 11], mie: 2, mieColor: [1, 0.95, 0.85] };
    }
    case 'icegiant': {
      const H = Math.max(10, 25 * (teq / 75) * (1 / Math.max(0.4, g)) * 0.25);
      return { density: 0.4, scaleHeight: Math.min(H, 300), pressureBar: 1000, composition: 'H₂, He, volatiles (assumed)',
        rayleigh: [4, 10, 18], mie: 1.5, mieColor: [0.85, 0.95, 1] };
    }
    case 'venus':
      return { density: 30, scaleHeight: 14, pressureBar: 40, composition: 'CO₂-dominated (assumed)',
        rayleigh: [40, 32, 14], mie: 25, mieColor: [1, 0.85, 0.55] };
    case 'terra':
      return { density: 1.2, scaleHeight: 8.5 / Math.max(0.5, g), pressureBar: 1, composition: 'N₂/CO₂ (hypothetical)',
        rayleigh: [7.5, 12, 26], mie: 5, mieColor: [1, 0.95, 0.9] };
    case 'ocean':
      return { density: 2.5, scaleHeight: 9 / Math.max(0.5, g), pressureBar: 2, composition: 'H₂O vapour, N₂ (hypothetical)',
        rayleigh: [6, 13, 30], mie: 8, mieColor: [1, 1, 1] };
    case 'lava':
      return { density: 0.05, scaleHeight: 6, pressureBar: 0.01, composition: 'Vaporised rock: Na, SiO (hypothetical)',
        rayleigh: [14, 6, 3], mie: 6, mieColor: [1, 0.6, 0.3] };
    default: return undefined;
  }
}

function typeLabel(type: SurfaceType, m: number): string {
  switch (type) {
    case 'gas': return 'Gas giant';
    case 'icegiant': return m < 12 ? 'Sub-Neptune' : 'Neptune-like';
    case 'lava': return 'Lava world';
    case 'venus': return 'Hot super-Earth';
    case 'rock': return 'Barren rocky world';
    case 'terra': return 'Temperate rocky world';
    case 'ocean': return 'Possible ocean world';
    default: return 'Cold icy world';
  }
}

export function build(id: string, name: string, distLy: number, ra: number, dec: number, desc: string,
  star: ExoStar, planets: ExoPlanet[], belts?: SystemDef['belts']): SystemDef {
  const starId = id + '_star';
  const bodies: BodyDef[] = [{
    id: starId, name: star.name, kind: 'star', radius: star.radius * R_SUN, gm: star.mass * GM_SUN,
    rotationHours: 24 * (20 + 60 * hash(id)), pole: [hash(id + 'ra') * 360, 50 + hash(id + 'dec') * 40],
    surface: 'star', palette: [starColor(star.teff)], landable: false, tempK: star.teff,
    star: { teff: star.teff, luminosity: star.lum, spectral: star.spectral, color: starColor(star.teff) },
    desc: star.desc,
  }];
  for (const p of planets) {
    const seed = hash(id + p.letter);
    const r = p.radius ?? massToRadius(p.mass);
    const teq = 278 * Math.pow(star.lum, 0.25) / Math.sqrt(p.a) * 0.92;
    const type = p.type ?? classify(p.mass, r, teq);
    const locked = p.a < 0.3;
    const landable = type !== 'gas' && type !== 'icegiant';
    bodies.push({
      id: `${id}_${p.letter}`, name: `${name} ${p.letter}`, parent: starId, kind: 'planet',
      radius: r * R_EARTH, gm: p.mass * GM_EARTH,
      orbit: { a: p.a * AU_KM, e: p.e ?? 0, i: (hash(id + p.letter + 'i') - 0.5) * 3, node: seed * 360,
        argPeri: hash(id + p.letter + 'w') * 360, M0: hash(id + p.letter + 'm') * 360, plane: 'ecliptic' },
      rotationHours: locked ? undefined : 10 + 30 * seed,
      surface: type, palette: palette(type, teq, seed), landable,
      relief: type === 'lava' ? 3 : type === 'ice' ? 2 : type === 'ocean' ? 1.5 : 6,
      atmosphere: atmosphere(type, p.mass, r, teq), tempK: Math.round(teq),
      desc: `${typeLabel(type, p.mass)}${p.candidate ? ' (unconfirmed candidate)' : ''}. ${p.note}`,
      speculative: true, discovery: p.discovery,
    });
  }
  return { id, name, distLy, ra, dec, desc, bodies, belts };
}

export const hms = (h: number, m: number, s: number) => (h + m / 60 + s / 3600) * 15;
export const dms = (d: number, m: number, s: number) => Math.sign(d || 1) * (Math.abs(d) + m / 60 + s / 3600);

export const EXO_SYSTEMS: SystemDef[] = [
  build('proxima', 'Proxima Centauri', 4.2465, hms(14, 29, 43), -dms(62, 40, 46),
    'The nearest star to the Sun, a small flare-prone red dwarf in the Alpha Centauri system.',
    { name: 'Proxima Centauri', mass: 0.1221, radius: 0.1542, teff: 3042, lum: 0.00155, spectral: 'M5.5Ve',
      desc: 'Nearest star to the Sun. A red dwarf one-eighth the Sun\'s mass, given to violent flares.' },
    [
      { letter: 'd', a: 0.02885, e: 0.04, mass: 0.26, note: 'One of the lightest exoplanets found by radial velocity; a hot sub-Earth on a 5.1-day orbit.', discovery: '2022, radial velocity (ESPRESSO)' },
      { letter: 'b', a: 0.04856, e: 0.02, mass: 1.07, type: 'terra', note: 'Earth-mass planet in the habitable zone on an 11.2-day orbit. The nearest known exoplanet; whether it keeps an atmosphere is unknown.', discovery: '2016, radial velocity (HARPS)' },
    ]),
  build('barnard', "Barnard's Star", 5.963, hms(17, 57, 48), dms(4, 41, 36),
    'Second-nearest star system and the fastest-moving star in our sky. Four small planets confirmed in 2024–25.',
    { name: "Barnard's Star", mass: 0.162, radius: 0.187, teff: 3195, lum: 0.00356, spectral: 'M4V',
      desc: 'An ancient, quiet red dwarf roughly 10 billion years old.' },
    [
      { letter: 'd', a: 0.0188, mass: 0.263, note: 'Hot sub-Earth on a 2.34-day orbit.', discovery: '2025, radial velocity (MAROON-X / ESPRESSO)' },
      { letter: 'b', a: 0.0229, mass: 0.299, note: 'Hot sub-Earth on a 3.15-day orbit.', discovery: '2024, radial velocity (ESPRESSO)' },
      { letter: 'c', a: 0.0274, mass: 0.335, note: 'Hot sub-Earth on a 4.12-day orbit.', discovery: '2025, radial velocity (MAROON-X / ESPRESSO)' },
      { letter: 'e', a: 0.0381, mass: 0.193, note: 'The lightest of the four, on a 6.74-day orbit.', discovery: '2025, radial velocity (MAROON-X / ESPRESSO)' },
    ]),
  build('wolf359', 'Wolf 359', 7.86, hms(10, 56, 29), dms(7, 0, 53),
    'One of the faintest and lowest-mass stars near the Sun.',
    { name: 'Wolf 359', mass: 0.110, radius: 0.144, teff: 2749, lum: 0.00106, spectral: 'M6V',
      desc: 'A very dim, very cool flare star barely above the hydrogen-burning limit.' },
    [
      { letter: 'b', a: 1.845, e: 0.04, mass: 43.9, candidate: true, note: 'A cold Neptune-mass candidate on an 8-year orbit, awaiting confirmation.', discovery: '2019, radial velocity (candidate)' },
    ]),
  build('lalande', 'Lalande 21185', 8.304, hms(11, 3, 20), dms(35, 58, 12),
    'The brightest red dwarf in the northern sky and fourth-nearest star system.',
    { name: 'Lalande 21185', mass: 0.389, radius: 0.392, teff: 3547, lum: 0.0195, spectral: 'M2V',
      desc: 'A quiet red dwarf about 40% the mass of the Sun.' },
    [
      { letter: 'b', a: 0.0789, e: 0.06, mass: 2.69, note: 'Hot super-Earth on a 12.9-day orbit, too close for liquid water.', discovery: '2017, radial velocity' },
      { letter: 'c', a: 2.94, e: 0.13, mass: 13.6, note: 'Cold Neptune-mass planet on an 8-year orbit.', discovery: '2021, radial velocity' },
    ]),
  build('epseri', 'Epsilon Eridani', 10.475, hms(3, 32, 56), -dms(9, 27, 30),
    'A young Sun-like star less than a billion years old, ringed by debris belts.',
    { name: 'Epsilon Eridani', mass: 0.82, radius: 0.738, teff: 5084, lum: 0.34, spectral: 'K2V',
      desc: 'A young, active orange dwarf — a snapshot of what the early Solar System may have looked like.' },
    [
      { letter: 'b', a: 3.53, e: 0.06, mass: 242, note: 'Jupiter-like gas giant (≈0.76 Jupiter masses) on a 7.3-year orbit, also named AEgir.', discovery: '2000, radial velocity; confirmed by astrometry' },
    ],
    [{ inner: 2.6, outer: 3.1, count: 1500, color: '#8a8378' }, { inner: 55, outer: 75, count: 4000, color: '#8f96a0' }]),
  build('ross128', 'Ross 128', 11.007, hms(11, 47, 44), dms(0, 48, 16),
    'A quiet red dwarf hosting one of the nearest temperate Earth-mass planets.',
    { name: 'Ross 128', mass: 0.168, radius: 0.1967, teff: 3192, lum: 0.00362, spectral: 'M4V',
      desc: 'An old, inactive red dwarf — good news for any atmosphere its planet may have.' },
    [
      { letter: 'b', a: 0.0496, e: 0.12, mass: 1.4, type: 'terra', note: 'Temperate planet on a 9.9-day orbit near the inner edge of the habitable zone.', discovery: '2017, radial velocity (HARPS)' },
    ]),
  build('tauceti', 'Tau Ceti', 11.912, hms(1, 44, 4), -dms(15, 56, 15),
    'The nearest single Sun-like star, long a favourite of science fiction.',
    { name: 'Tau Ceti', mass: 0.783, radius: 0.793, teff: 5344, lum: 0.488, spectral: 'G8V',
      desc: 'A stable, metal-poor yellow dwarf surrounded by a massive debris disc.' },
    [
      { letter: 'g', a: 0.133, e: 0.06, mass: 1.75, note: 'Hot super-Earth on a 20-day orbit.', discovery: '2017, radial velocity', candidate: true },
      { letter: 'h', a: 0.243, e: 0.23, mass: 1.83, note: 'Hot super-Earth on a 49-day orbit.', discovery: '2017, radial velocity', candidate: true },
      { letter: 'e', a: 0.538, e: 0.18, mass: 3.93, note: 'Super-Earth near the inner edge of the habitable zone, 163-day orbit.', discovery: '2012/2017, radial velocity', candidate: true },
      { letter: 'f', a: 1.334, e: 0.16, mass: 3.93, note: 'Cold super-Earth near the outer habitable zone, 636-day orbit.', discovery: '2012/2017, radial velocity', candidate: true },
    ],
    [{ inner: 6, outer: 52, count: 5000, color: '#8f8a80' }]),
  build('gj876', 'Gliese 876', 15.24, hms(22, 53, 17), -dms(14, 15, 49),
    'A red dwarf with four planets, three locked in a 1:2:4 Laplace resonance.',
    { name: 'Gliese 876', mass: 0.346, radius: 0.372, teff: 3201, lum: 0.0129, spectral: 'M3.5V',
      desc: 'The first red dwarf found to host planets.' },
    [
      { letter: 'd', a: 0.0218, e: 0.03, mass: 6.9, type: 'lava', note: 'Scorched super-Earth on a 1.94-day orbit.', discovery: '2005, radial velocity' },
      { letter: 'c', a: 0.1363, e: 0.25, mass: 235, note: 'Gas giant (0.74 Jupiter masses) on a 30-day orbit, in resonance with planets b and e.', discovery: '2001, radial velocity' },
      { letter: 'b', a: 0.2177, e: 0.03, mass: 760, note: 'Massive gas giant (2.4 Jupiter masses) on a 61-day orbit — the first planet found around a red dwarf.', discovery: '1998, radial velocity' },
      { letter: 'e', a: 0.3501, e: 0.04, mass: 16, note: 'Uranus-mass planet on a 124-day orbit, completing the resonant chain.', discovery: '2010, radial velocity' },
    ]),
  build('trappist1', 'TRAPPIST-1', 40.66, hms(23, 6, 29), -dms(5, 2, 29),
    'Seven Earth-sized worlds packed around an ultracool dwarf — all closer than Mercury is to the Sun.',
    { name: 'TRAPPIST-1', mass: 0.0898, radius: 0.1192, teff: 2566, lum: 0.000553, spectral: 'M8V',
      desc: 'An ultracool red dwarf barely larger than Jupiter. From any of its planets the others appear as large as our Moon.' },
    [
      { letter: 'b', a: 0.01154, mass: 1.374, radius: 1.116, type: 'rock', note: 'JWST measurements suggest a bare rock with little or no atmosphere. 1.5-day orbit.', discovery: '2016, transit (TRAPPIST)' },
      { letter: 'c', a: 0.0158, mass: 1.308, radius: 1.097, type: 'rock', note: 'JWST rules out a thick CO₂ atmosphere. 2.4-day orbit.', discovery: '2016, transit (TRAPPIST)' },
      { letter: 'd', a: 0.02227, mass: 0.388, radius: 0.788, type: 'rock', note: 'Small, low-density world at the inner edge of the habitable zone. 4.0-day orbit.', discovery: '2016, transit' },
      { letter: 'e', a: 0.02925, mass: 0.692, radius: 0.92, type: 'terra', note: 'The most Earth-like in density and stellar flux; a prime target in the search for habitable worlds. 6.1-day orbit.', discovery: '2017, transit (Spitzer)' },
      { letter: 'f', a: 0.03849, mass: 1.039, radius: 1.045, type: 'ocean', note: 'Low density suggests a water-rich composition. 9.2-day orbit.', discovery: '2017, transit (Spitzer)' },
      { letter: 'g', a: 0.04683, mass: 1.321, radius: 1.129, type: 'ice', note: 'Largest of the seven, probably water-rich and cold. 12.4-day orbit.', discovery: '2017, transit (Spitzer)' },
      { letter: 'h', a: 0.06189, mass: 0.326, radius: 0.755, type: 'ice', note: 'Outermost and coldest, likely an ice world. 18.8-day orbit.', discovery: '2017, transit (Spitzer / K2)' },
    ]),
  build('55cnc', '55 Cancri', 41.06, hms(8, 52, 36), dms(28, 19, 51),
    'A Sun-like star with five known planets, including a famous lava super-Earth.',
    { name: '55 Cancri A (Copernicus)', mass: 0.905, radius: 0.943, teff: 5172, lum: 0.582, spectral: 'K0IV-V',
      desc: 'A metal-rich Sun-like star with a distant red dwarf companion.' },
    [
      { letter: 'e', a: 0.01544, e: 0.05, mass: 7.99, radius: 1.875, type: 'lava', note: 'Janssen: an 18-hour year and a dayside hot enough (≈2,400 °C) to keep its surface molten.', discovery: '2004, radial velocity; transits 2011' },
      { letter: 'b', a: 0.1134, mass: 255, note: 'Galileo: a warm gas giant (0.8 Jupiter masses) on a 14.7-day orbit.', discovery: '1996, radial velocity' },
      { letter: 'c', a: 0.2373, e: 0.03, mass: 51.2, note: 'Brahe: a Saturn-mass planet on a 44-day orbit.', discovery: '2002, radial velocity' },
      { letter: 'f', a: 0.7708, e: 0.08, mass: 47.8, note: 'Harriot: a Saturn-mass planet in the habitable zone, 260-day orbit.', discovery: '2007, radial velocity' },
      { letter: 'd', a: 5.957, e: 0.13, mass: 991, note: 'Lipperhey: a massive Jupiter analogue (3.1 Jupiter masses) on a 15-year orbit.', discovery: '2002, radial velocity' },
    ]),
];

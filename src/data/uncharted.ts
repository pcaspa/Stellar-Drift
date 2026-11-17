import type { SystemDef } from './types';
import { build, dms, hms, type ExoPlanet, type ExoStar } from './exo';

/**
 * Twenty real nearby stars with confirmed (or strongly suspected) exoplanets that nobody in the game
 * has visited yet: no stations, no traffic — just their planets and rich, untouched asteroid belts
 * carrying ultra-rare metals, xenocrystals, exotic matter and frozen Helionite fuel.
 * Star and planet parameters are from published surveys (masses are minimum masses for most
 * radial-velocity planets); the asteroid belts are fictional.
 */
function uncharted(id: string, name: string, distLy: number, ra: number, dec: number, desc: string,
  star: ExoStar, planets: ExoPlanet[], belt: [number, number], prefix: string): SystemDef {
  const def = build(id, name, distLy, ra, dec, desc, star, planets,
    [{ inner: belt[0], outer: belt[1], count: 1600, color: '#7d7488' }]);
  return { ...def, uncharted: true, oreBelt: { inner: belt[0], outer: belt[1], prefix } };
}

export const UNCHARTED_SYSTEMS: SystemDef[] = [
  uncharted('lacaille9352', 'Lacaille 9352', 10.72, hms(23, 5, 52), -dms(35, 51, 11),
    'One of the brightest red dwarfs in the sky, hosting two hot super-Earths.',
    { name: 'Lacaille 9352', mass: 0.49, radius: 0.47, teff: 3688, lum: 0.037, spectral: 'M0.5V', desc: 'A large, quiet red dwarf with unusually low flare activity.' },
    [
      { letter: 'b', a: 0.068, mass: 4.2, note: 'Hot super-Earth on a 9.3-day orbit.', discovery: '2020, radial velocity (RedDots)' },
      { letter: 'c', a: 0.12, mass: 7.6, note: 'Super-Earth on a 21.8-day orbit, just inside the habitable zone.', discovery: '2020, radial velocity (RedDots)' },
    ], [0.45, 0.7], 'LAC'),
  uncharted('gj15a', 'Groombridge 34', 11.62, hms(0, 18, 23), dms(44, 1, 23),
    'A pair of red dwarfs; the brighter one hosts a super-Earth and a distant Neptune-mass world.',
    { name: 'Groombridge 34 A', mass: 0.38, radius: 0.38, teff: 3567, lum: 0.022, spectral: 'M1.5V', desc: 'The primary of a wide binary of two red dwarfs.' },
    [
      { letter: 'b', a: 0.072, mass: 3.0, note: 'Hot super-Earth on an 11.4-day orbit.', discovery: '2014, radial velocity (Eta-Earth)' },
      { letter: 'c', a: 5.4, mass: 36, note: 'Cold Neptune-mass planet on a 20-year orbit.', discovery: '2018, radial velocity (CARMENES)' },
    ], [1.2, 1.9], 'GRB'),
  uncharted('epsindi', 'Epsilon Indi', 11.87, hms(22, 3, 22), -dms(56, 47, 10),
    'An orange dwarf with a cold super-Jupiter photographed by JWST, and a pair of brown dwarfs further out.',
    { name: 'Epsilon Indi A', mass: 0.76, radius: 0.71, teff: 4649, lum: 0.22, spectral: 'K5V', desc: 'One of the closest Sun-like stars, with a binary brown dwarf companion 1,460 AU away.' },
    [
      { letter: 'Ab', a: 28, e: 0.4, mass: 2000, note: 'A frigid super-Jupiter (≈6 Jupiter masses), one of the coldest planets ever imaged directly.', discovery: '2019 astrometry; imaged by JWST 2024' },
    ], [3.0, 4.6], 'EPI'),
  uncharted('gj1061', 'Gliese 1061', 11.98, hms(3, 35, 60), -dms(44, 30, 45),
    'A dim red dwarf with three compact Earth-mass planets, one of them temperate.',
    { name: 'Gliese 1061', mass: 0.113, radius: 0.156, teff: 2953, lum: 0.0016, spectral: 'M5.5V', desc: 'A faint, quiet red dwarf in the southern constellation Horologium.' },
    [
      { letter: 'b', a: 0.021, mass: 1.37, note: 'Hot rocky planet on a 3.2-day orbit.', discovery: '2019, radial velocity (RedDots)' },
      { letter: 'c', a: 0.035, mass: 1.74, type: 'terra', note: 'In the habitable zone on a 6.7-day orbit.', discovery: '2019, radial velocity (RedDots)' },
      { letter: 'd', a: 0.054, mass: 1.64, note: 'Near the outer edge of the habitable zone, 13-day orbit.', discovery: '2019, radial velocity (RedDots)' },
    ], [0.1, 0.16], 'GLA'),
  uncharted('yzceti', 'YZ Ceti', 12.11, hms(1, 12, 31), -dms(16, 59, 56),
    'A flaring red dwarf with three tightly packed rocky planets — and possibly radio auroras driven by them.',
    { name: 'YZ Ceti', mass: 0.13, radius: 0.157, teff: 3151, lum: 0.0022, spectral: 'M4.5V', desc: 'A small flare star whose radio bursts may come from star–planet magnetic interaction.' },
    [
      { letter: 'b', a: 0.0156, mass: 0.7, note: 'Scorched rocky world on a 2-day orbit.', discovery: '2017, radial velocity (HARPS)' },
      { letter: 'c', a: 0.0209, mass: 1.14, note: 'Hot Earth-mass planet on a 3.1-day orbit.', discovery: '2017, radial velocity (HARPS)' },
      { letter: 'd', a: 0.0276, mass: 1.09, note: 'Earth-mass planet on a 4.7-day orbit.', discovery: '2017, radial velocity (HARPS)' },
    ], [0.07, 0.11], 'YZC'),
  uncharted('luyten', "Luyten's Star", 12.35, hms(7, 27, 25), dms(5, 13, 33),
    'A red dwarf with a temperate super-Earth — and the target of a 2017 "Sónar" message from Earth.',
    { name: "Luyten's Star", mass: 0.29, radius: 0.32, teff: 3382, lum: 0.0088, spectral: 'M3.5V', desc: 'A quiet red dwarf in Canis Minor, close to Procyon in the sky.' },
    [
      { letter: 'c', a: 0.0365, mass: 1.18, note: 'Hot rocky planet on a 4.7-day orbit.', discovery: '2017, radial velocity (HARPS)' },
      { letter: 'b', a: 0.0911, mass: 2.89, type: 'terra', note: 'Super-Earth in the habitable zone on an 18.6-day orbit.', discovery: '2017, radial velocity (HARPS)' },
      { letter: 'd', a: 0.712, mass: 10.8, candidate: true, note: 'Cold sub-Neptune candidate on a 413-day orbit.', discovery: '2019, radial velocity (candidate)' },
    ], [0.25, 0.4], 'LUY'),
  uncharted('teegarden', "Teegarden's Star", 12.5, hms(2, 53, 1), dms(16, 52, 53),
    'A tiny ultracool dwarf with three Earth-mass planets — b has one of the highest Earth-similarity scores known.',
    { name: "Teegarden's Star", mass: 0.097, radius: 0.107, teff: 2904, lum: 0.00073, spectral: 'M7V', desc: 'A faint, old ultracool dwarf found only in 2003.' },
    [
      { letter: 'b', a: 0.0259, mass: 1.05, type: 'terra', note: 'Temperate Earth-mass planet on a 4.9-day orbit.', discovery: '2019, radial velocity (CARMENES)' },
      { letter: 'c', a: 0.0455, mass: 1.11, note: 'Cool Earth-mass planet on an 11.4-day orbit.', discovery: '2019, radial velocity (CARMENES)' },
      { letter: 'd', a: 0.0791, mass: 0.82, note: 'Cold outer planet on a 26-day orbit.', discovery: '2024, radial velocity (CARMENES)' },
    ], [0.12, 0.18], 'TEE'),
  uncharted('wolf1061', 'Wolf 1061', 14.05, hms(16, 30, 18), -dms(12, 39, 45),
    'A red dwarf in Ophiuchus with three planets, the middle one in the habitable zone.',
    { name: 'Wolf 1061', mass: 0.294, radius: 0.307, teff: 3342, lum: 0.0097, spectral: 'M3V', desc: 'A quiet red dwarf one-third the mass of the Sun.' },
    [
      { letter: 'b', a: 0.0375, mass: 1.91, note: 'Hot super-Earth on a 4.6-day orbit.', discovery: '2015, radial velocity (HARPS)' },
      { letter: 'c', a: 0.089, mass: 3.41, type: 'terra', note: 'Super-Earth in the habitable zone on a 17.9-day orbit.', discovery: '2015, radial velocity (HARPS)' },
      { letter: 'd', a: 0.47, mass: 7.7, note: 'Cold super-Earth on a 217-day orbit.', discovery: '2015, radial velocity (HARPS)' },
    ], [0.7, 1.05], 'WLX'),
  uncharted('gj687', 'Gliese 687', 14.84, hms(17, 36, 26), dms(68, 20, 21),
    'A northern red dwarf with a Neptune-mass planet near its habitable zone.',
    { name: 'Gliese 687', mass: 0.41, radius: 0.42, teff: 3413, lum: 0.021, spectral: 'M3V', desc: 'A red dwarf high in the northern sky in Draco.' },
    [
      { letter: 'b', a: 0.164, mass: 17.2, note: 'Neptune-mass planet on a 38-day orbit.', discovery: '2014, radial velocity (Lick / Keck)' },
      { letter: 'c', a: 1.165, mass: 16, candidate: true, note: 'Cold Neptune-mass candidate on a 728-day orbit.', discovery: '2020, radial velocity (candidate)' },
    ], [0.45, 0.75], 'DRA'),
  uncharted('gj674', 'Gliese 674', 14.8, hms(17, 28, 40), -dms(46, 53, 43),
    'A red dwarf in Ara with a hot Neptune skimming close to its surface.',
    { name: 'Gliese 674', mass: 0.35, radius: 0.36, teff: 3404, lum: 0.016, spectral: 'M2.5V', desc: 'A moderately active red dwarf with a 34-day rotation.' },
    [
      { letter: 'b', a: 0.039, mass: 11.1, note: 'Hot Neptune on a 4.7-day orbit.', discovery: '2007, radial velocity (HARPS)' },
    ], [0.3, 0.5], 'ARA'),
  uncharted('gj1002', 'Gliese 1002', 15.8, hms(0, 6, 43), -dms(7, 32, 17),
    'A quiet red dwarf with two Earth-mass planets, both in the habitable zone.',
    { name: 'Gliese 1002', mass: 0.12, radius: 0.137, teff: 3024, lum: 0.0013, spectral: 'M5.5V', desc: 'An exceptionally inactive red dwarf — kind to any atmospheres.' },
    [
      { letter: 'b', a: 0.0457, mass: 1.08, type: 'terra', note: 'Earth-mass planet in the habitable zone, 10.3-day orbit.', discovery: '2022, radial velocity (ESPRESSO / CARMENES)' },
      { letter: 'c', a: 0.0738, mass: 1.36, type: 'terra', note: 'Earth-mass planet near the outer habitable zone, 21-day orbit.', discovery: '2022, radial velocity (ESPRESSO / CARMENES)' },
    ], [0.15, 0.24], 'GLB'),
  uncharted('gj832', 'Gliese 832', 16.2, hms(21, 33, 34), -dms(49, 0, 32),
    'A red dwarf with a cold Jupiter analogue on a decade-long orbit.',
    { name: 'Gliese 832', mass: 0.45, radius: 0.48, teff: 3590, lum: 0.035, spectral: 'M2V', desc: 'A metal-poor red dwarf in Grus.' },
    [
      { letter: 'b', a: 3.56, e: 0.08, mass: 216, note: 'A cold gas giant (0.68 Jupiter masses) on a 9.4-year orbit.', discovery: '2008, radial velocity (AAPS)' },
    ], [1.0, 1.8], 'GRU'),
  uncharted('gj229', 'Gliese 229', 18.8, hms(6, 10, 35), -dms(21, 51, 53),
    'A red dwarf with two super-Earths and the famous brown dwarf Gliese 229 B — itself a tight pair.',
    { name: 'Gliese 229 A', mass: 0.58, radius: 0.55, teff: 3700, lum: 0.044, spectral: 'M1V', desc: 'Host of the first methane brown dwarf ever found (1995).' },
    [
      { letter: 'c', a: 0.339, mass: 7.3, note: 'Super-Earth on a 122-day orbit.', discovery: '2020, radial velocity' },
      { letter: 'b', a: 0.898, mass: 10.0, note: 'Cold sub-Neptune on a 526-day orbit.', discovery: '2020, radial velocity' },
    ], [1.6, 2.4], 'LEP'),
  uncharted('gj581', 'Gliese 581', 20.55, hms(15, 19, 27), -dms(7, 43, 20),
    'A celebrated red dwarf system with three planets, once claimed to host a habitable world.',
    { name: 'Gliese 581', mass: 0.31, radius: 0.30, teff: 3480, lum: 0.013, spectral: 'M3V', desc: 'An old, quiet red dwarf in Libra.' },
    [
      { letter: 'e', a: 0.0285, mass: 1.66, note: 'Hot rocky planet on a 3.15-day orbit.', discovery: '2009, radial velocity (HARPS)' },
      { letter: 'b', a: 0.0406, mass: 15.8, note: 'Hot Neptune on a 5.4-day orbit.', discovery: '2005, radial velocity (HARPS)' },
      { letter: 'c', a: 0.0721, mass: 5.5, note: 'Super-Earth on a 12.9-day orbit, inside the habitable zone\'s inner edge.', discovery: '2007, radial velocity (HARPS)' },
    ], [0.35, 0.55], 'LIB'),
  uncharted('hd219134', 'HD 219134', 21.34, hms(23, 13, 17), dms(57, 10, 6),
    'The nearest star with a transiting rocky planet — an orange dwarf with six planets.',
    { name: 'HD 219134', mass: 0.81, radius: 0.78, teff: 4699, lum: 0.27, spectral: 'K3V', desc: 'A bright orange dwarf in Cassiopeia, visible to the naked eye.' },
    [
      { letter: 'b', a: 0.0385, mass: 4.74, radius: 1.6, type: 'lava', note: 'Transiting rocky super-Earth on a 3.1-day orbit.', discovery: '2015, radial velocity; transits (Spitzer)' },
      { letter: 'c', a: 0.065, mass: 4.36, radius: 1.51, note: 'Transiting rocky super-Earth on a 6.8-day orbit.', discovery: '2015, radial velocity; transits' },
      { letter: 'f', a: 0.146, mass: 7.3, note: 'Super-Earth on a 22.7-day orbit.', discovery: '2015, radial velocity (HARPS-N)' },
      { letter: 'd', a: 0.237, mass: 16.2, note: 'Neptune-mass planet on a 47-day orbit.', discovery: '2015, radial velocity (HARPS-N)' },
      { letter: 'g', a: 0.375, mass: 11, note: 'Neptune-mass planet on a 94-day orbit.', discovery: '2015, radial velocity (HARPS-N)' },
      { letter: 'h', a: 3.11, mass: 108, note: 'Saturn-mass planet on a 5.8-year orbit.', discovery: '2015, radial velocity (HARPS-N)' },
    ], [1.3, 2.2], 'CAS'),
  uncharted('ltt1445', 'LTT 1445', 22.4, hms(3, 1, 51), -dms(16, 35, 36),
    'A triple red-dwarf system; the primary hosts three planets, two seen transiting.',
    { name: 'LTT 1445 A', mass: 0.257, radius: 0.265, teff: 3340, lum: 0.0083, spectral: 'M3V', desc: 'The brightest of three red dwarfs bound together in Eridanus.' },
    [
      { letter: 'c', a: 0.0266, mass: 1.54, radius: 1.15, note: 'Transiting rocky planet on a 3.1-day orbit.', discovery: '2021, transit (TESS)' },
      { letter: 'b', a: 0.0381, mass: 2.87, radius: 1.30, note: 'Transiting rocky planet on a 5.4-day orbit; JWST finds no thick atmosphere.', discovery: '2019, transit (TESS)' },
      { letter: 'd', a: 0.0634, mass: 2.7, note: 'Super-Earth on a 24-day orbit.', discovery: '2022, radial velocity' },
    ], [0.18, 0.3], 'ERI'),
  uncharted('gj667c', 'Gliese 667 C', 23.6, hms(17, 18, 57), -dms(34, 59, 23),
    'A red dwarf in a triple-star system, hosting a temperate super-Earth with two orange suns in its sky.',
    { name: 'Gliese 667 C', mass: 0.33, radius: 0.42, teff: 3350, lum: 0.0137, spectral: 'M1.5V', desc: 'The smallest member of a triple system; Gliese 667 A and B shine 230 AU away.' },
    [
      { letter: 'b', a: 0.0505, mass: 5.6, note: 'Hot super-Earth on a 7.2-day orbit.', discovery: '2009, radial velocity (HARPS)' },
      { letter: 'c', a: 0.125, mass: 3.8, type: 'terra', note: 'Super-Earth in the habitable zone on a 28-day orbit.', discovery: '2011, radial velocity (HARPS)' },
    ], [0.3, 0.5], 'SCO'),
  uncharted('61vir', '61 Virginis', 27.9, hms(13, 18, 24), -dms(18, 18, 40),
    'A near-twin of the Sun with three close-in planets and a cold dust disc.',
    { name: '61 Virginis', mass: 0.94, radius: 0.98, teff: 5531, lum: 0.80, spectral: 'G7V', desc: 'One of the most Sun-like stars nearby, slightly older and cooler than the Sun.' },
    [
      { letter: 'b', a: 0.05, mass: 5.1, note: 'Hot super-Earth on a 4.2-day orbit.', discovery: '2009, radial velocity (Keck / AAT)' },
      { letter: 'c', a: 0.217, mass: 18.2, note: 'Neptune-mass planet on a 38-day orbit.', discovery: '2009, radial velocity (Keck / AAT)' },
      { letter: 'd', a: 0.476, mass: 22.9, note: 'Neptune-mass planet on a 123-day orbit.', discovery: '2009, radial velocity (Keck / AAT)' },
    ], [2.2, 3.4], 'VIR'),
  uncharted('aumic', 'AU Microscopii', 31.7, hms(20, 45, 10), -dms(31, 20, 27),
    'A baby star only 22 million years old, with two young Neptunes and a vast edge-on debris disc.',
    { name: 'AU Microscopii', mass: 0.5, radius: 0.75, teff: 3700, lum: 0.1, spectral: 'M1Ve', desc: 'A young, violently flaring red dwarf whose dusty disc shows fast-moving ripples.' },
    [
      { letter: 'b', a: 0.0645, mass: 10.2, radius: 4.2, note: 'A puffy young Neptune on an 8.5-day orbit.', discovery: '2020, transit (TESS / Spitzer)' },
      { letter: 'c', a: 0.11, mass: 14.2, radius: 3.2, note: 'Young Neptune on an 18.9-day orbit.', discovery: '2021, transit (TESS)' },
    ], [0.5, 0.9], 'MIC'),
  uncharted('gj436', 'Gliese 436', 31.9, hms(11, 42, 11), dms(26, 42, 23),
    'Home of a "burning ice" Neptune trailing a vast comet-like tail of escaping hydrogen.',
    { name: 'Gliese 436', mass: 0.45, radius: 0.42, teff: 3480, lum: 0.025, spectral: 'M2.5V', desc: 'A quiet red dwarf in Leo.' },
    [
      { letter: 'b', a: 0.0291, e: 0.15, mass: 21.4, radius: 4.2, note: 'A hot Neptune on a 2.6-day orbit, losing its atmosphere in a 15-million-km tail.', discovery: '2004, radial velocity; transits 2007' },
    ], [0.3, 0.5], 'LEO'),
];

import { AU_KM, BodyDef, OrbitDef, SystemDef } from './types';

/** JPL approximate elements at J2000: a(AU), e, I, L, long.peri, long.node (deg) */
function jpl(a: number, e: number, i: number, L: number, lp: number, node: number): OrbitDef {
  return { a: a * AU_KM, e, i, node, argPeri: lp - node, M0: L - lp, plane: 'ecliptic' };
}
/** heliocentric small body: a(AU), e, i, node, argPeri, M0 */
function helio(a: number, e: number, i: number, node: number, argPeri: number, M0: number): OrbitDef {
  return { a: a * AU_KM, e, i, node, argPeri, M0, plane: 'ecliptic' };
}
/** moon in parent's equatorial plane: a(km), e, i, phase */
function moon(a: number, e: number, i: number, M0: number, node = 0): OrbitDef {
  return { a, e, i, node, argPeri: 0, M0, plane: 'equator' };
}

const bodies: BodyDef[] = [
  {
    id: 'sun', name: 'Sun', kind: 'star', radius: 695700, gm: 1.32712440018e11,
    rotationHours: 609.12, pole: [286.13, 63.87], surface: 'star', palette: ['#fff4e0'],
    texture: 'sun.jpg', landable: false, tempK: 5772,
    star: { teff: 5772, luminosity: 1, spectral: 'G2V', color: '#fff1dc' },
    desc: 'Our home star: a G-type main-sequence star holding 99.86% of the Solar System\'s mass.',
  },
  {
    id: 'mercury', name: 'Mercury', parent: 'sun', kind: 'planet', radius: 2439.7, gm: 22032,
    orbit: jpl(0.38709927, 0.20563593, 7.00497902, 252.2503235, 77.45779628, 48.33076593),
    rotationHours: 1407.6, pole: [281.01, 61.41], surface: 'rock', palette: ['#8c8580', '#5e5a57', '#b5aca4'],
    texture: 'mercury.jpg', landable: true, relief: 4, tempK: 440,
    desc: 'Smallest planet, scorched and cratered. Days reach 430 °C; nights fall to −180 °C.',
  },
  {
    id: 'venus', name: 'Venus', parent: 'sun', kind: 'planet', radius: 6051.8, gm: 324859,
    orbit: jpl(0.72333566, 0.00677672, 3.39467605, 181.9790995, 131.60246718, 76.67984255),
    rotationHours: -5832.5, pole: [272.76, 67.16], surface: 'venus', palette: ['#d9b36c', '#a8763a', '#e8d6a8'],
    texture: 'venus_surface.jpg', cloudTexture: 'venus_atmosphere.jpg', landable: true, relief: 5, tempK: 737,
    atmosphere: { density: 65, scaleHeight: 15.9, pressureBar: 92, composition: 'CO₂ 96.5%, N₂ 3.5%, sulfuric acid clouds',
      rayleigh: [42, 34, 14], mie: 30, mieColor: [1.0, 0.85, 0.55] },
    desc: 'A runaway greenhouse world. Crushing 92 bar CO₂ atmosphere, 464 °C surface, permanent sulfuric acid cloud deck.',
  },
  {
    id: 'earth', name: 'Earth', parent: 'sun', kind: 'planet', radius: 6371.0, gm: 398600.4418,
    orbit: jpl(1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0),
    rotationHours: 23.9345, pole: [0, 90], surface: 'earth', palette: ['#2a5fa8', '#3f7a3a', '#c9b88a', '#ffffff'],
    texture: 'earth_day.jpg', nightTexture: 'earth_night.jpg', cloudTexture: 'earth_clouds.jpg', landable: true, relief: 6, tempK: 288,
    atmosphere: { density: 1.225, scaleHeight: 8.5, pressureBar: 1.013, composition: 'N₂ 78%, O₂ 21%, Ar 0.9%',
      rayleigh: [5.8, 13.5, 33.1], mie: 4, mieColor: [1, 1, 1] },
    desc: 'Home. The only world known to harbour life, with liquid water oceans covering 71% of its surface.',
  },
  {
    id: 'moon', name: 'Moon', parent: 'earth', kind: 'moon', radius: 1737.4, gm: 4902.8,
    orbit: { a: 384400, e: 0.0549, i: 5.145, node: 125.08, argPeri: 318.15, M0: 135.27, plane: 'ecliptic' },
    pole: [270, 66.54], surface: 'rock', palette: ['#9a9691', '#5d5a57', '#c4c0ba'],
    texture: 'moon.jpg', landable: true, relief: 5, tempK: 220,
    desc: 'Earth\'s only natural satellite. Airless, cratered, and the only other world humans have walked on.',
  },
  {
    id: 'mars', name: 'Mars', parent: 'sun', kind: 'planet', radius: 3389.5, gm: 42828.37,
    orbit: jpl(1.52371034, 0.0933941, 1.84969142, -4.55343205, -23.94362959, 49.55953891),
    rotationHours: 24.6229, pole: [317.68, 52.89], surface: 'mars', palette: ['#b5613a', '#7a3d22', '#d99a6c'],
    texture: 'mars.jpg', landable: true, relief: 9, tempK: 210,
    atmosphere: { density: 0.020, scaleHeight: 11.1, pressureBar: 0.006, composition: 'CO₂ 95%, N₂ 2.8%, Ar 2%',
      rayleigh: [9.5, 6.6, 4.2], mie: 32, mieColor: [1.0, 0.6, 0.3], mieH: 1 },
    desc: 'The Red Planet. Thin CO₂ air, iron-oxide dust, the tallest volcano and deepest canyon in the Solar System.',
  },
  {
    id: 'phobos', name: 'Phobos', parent: 'mars', kind: 'moon', radius: 11.27, gm: 7.087e-4,
    orbit: moon(9376, 0.0151, 1.09, 20), surface: 'rock', palette: ['#6b5f55', '#463e38', '#85776a'],
    landable: true, relief: 1.2, tempK: 233,
    desc: 'Larger, inner moon of Mars. A dark rubble pile orbiting so low it rises in the west and sets in the east.',
  },
  {
    id: 'deimos', name: 'Deimos', parent: 'mars', kind: 'moon', radius: 6.2, gm: 9.615e-5,
    orbit: moon(23463, 0.00033, 0.93, 200), surface: 'rock', palette: ['#8a7b6c', '#5d5248', '#a39383'],
    landable: true, relief: 0.6, tempK: 233,
    desc: 'Tiny outer moon of Mars, smooth and dusty. Escape velocity is about 5.6 m/s.',
  },
  {
    id: 'ceres', name: 'Ceres', parent: 'sun', kind: 'dwarf', radius: 469.7, gm: 62.63,
    orbit: helio(2.7675, 0.0758, 10.59, 80.3, 73.6, 6.0), rotationHours: 9.074, pole: [291.4, 66.8],
    surface: 'rock', palette: ['#7d7872', '#55514d', '#a39e97'], landable: true, relief: 3, tempK: 168,
    desc: 'Largest object in the asteroid belt and the closest dwarf planet. Bright salt deposits dot Occator crater.',
  },
  {
    id: 'vesta', name: 'Vesta', parent: 'sun', kind: 'asteroid', radius: 262.7, gm: 17.29,
    orbit: helio(2.3615, 0.0887, 7.14, 103.8, 151.2, 205.5), rotationHours: 5.342, pole: [309.03, 42.23],
    surface: 'rock', palette: ['#9b958c', '#6b665f', '#bdb6ab'], landable: true, relief: 8, tempK: 170,
    desc: 'Second most massive asteroid, a differentiated protoplanet with a giant south-polar impact basin.',
  },
  {
    id: 'pallas', name: 'Pallas', parent: 'sun', kind: 'asteroid', radius: 256, gm: 13.6,
    orbit: helio(2.772, 0.2313, 34.84, 173.1, 310.0, 78.2), rotationHours: 7.813, pole: [33, -3],
    surface: 'rock', palette: ['#7f8388', '#565a5e', '#a1a5aa'], landable: true, relief: 6, tempK: 164,
    desc: 'Third largest asteroid, on a steeply inclined orbit. Heavily cratered — the "golf ball" asteroid.',
  },
  {
    id: 'jupiter', name: 'Jupiter', parent: 'sun', kind: 'planet', radius: 69911, gm: 126686534,
    orbit: jpl(5.202887, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909),
    rotationHours: 9.925, pole: [268.06, 64.5], surface: 'gas', palette: ['#c9a47a', '#e8d9bd', '#a8693f', '#f0e6d0'],
    texture: 'jupiter.jpg', landable: false, tempK: 165,
    atmosphere: { density: 0.16, scaleHeight: 27, pressureBar: 1000, composition: 'H₂ 90%, He 10%, ammonia clouds',
      rayleigh: [7, 8.5, 11], mie: 2, mieColor: [1, 0.95, 0.85] },
    rings: { inner: 92000, outer: 129000, color: '#9a8468', opacity: 0.05 },
    desc: 'King of the planets: 318 Earth masses of hydrogen and helium, with storms larger than Earth.',
  },
  {
    id: 'io', name: 'Io', parent: 'jupiter', kind: 'moon', radius: 1821.6, gm: 5959.9,
    orbit: moon(421700, 0.0041, 0.05, 40), surface: 'io', palette: ['#d9c95a', '#c47a2c', '#e8e0a0', '#3a2a1a'],
    landable: true, relief: 4, tempK: 110,
    desc: 'Most volcanically active body known. Tidal heating drives over 400 active volcanoes and sulfur plains.',
  },
  {
    id: 'europa', name: 'Europa', parent: 'jupiter', kind: 'moon', radius: 1560.8, gm: 3202.7,
    orbit: moon(671034, 0.009, 0.47, 130), surface: 'ice', palette: ['#d9d2c2', '#a37a55', '#f2efe8'],
    landable: true, relief: 0.4, tempK: 102,
    desc: 'Smooth ice shell criss-crossed by reddish fractures, hiding a global saltwater ocean.',
  },
  {
    id: 'ganymede', name: 'Ganymede', parent: 'jupiter', kind: 'moon', radius: 2634.1, gm: 9887.8,
    orbit: moon(1070412, 0.0013, 0.2, 250), surface: 'rock', palette: ['#8f867a', '#5c544b', '#bdb6aa'],
    landable: true, relief: 2, tempK: 110,
    desc: 'Largest moon in the Solar System — bigger than Mercury — with its own magnetic field.',
  },
  {
    id: 'callisto', name: 'Callisto', parent: 'jupiter', kind: 'moon', radius: 2410.3, gm: 7179.3,
    orbit: moon(1882709, 0.0074, 0.19, 310), surface: 'rock', palette: ['#5e554a', '#3b352e', '#9c9282'],
    landable: true, relief: 2.5, tempK: 134,
    desc: 'Ancient, dark and the most heavily cratered surface known.',
  },
  {
    id: 'saturn', name: 'Saturn', parent: 'sun', kind: 'planet', radius: 58232, gm: 37931187,
    orbit: jpl(9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448),
    rotationHours: 10.656, pole: [40.59, 83.54], surface: 'gas', palette: ['#e3cf9f', '#c9ad73', '#f0e4c0'],
    texture: 'saturn.jpg', landable: false, tempK: 134,
    atmosphere: { density: 0.19, scaleHeight: 59.5, pressureBar: 1000, composition: 'H₂ 96%, He 3%',
      rayleigh: [8, 8.5, 9.5], mie: 2, mieColor: [1, 0.95, 0.8] },
    rings: { inner: 74500, outer: 140220, texture: 'saturn_ring.png', color: '#d8c8a0', opacity: 1 },
    desc: 'The ringed giant. Its ice rings span 280,000 km yet are typically only tens of metres thick.',
  },
  {
    id: 'mimas', name: 'Mimas', parent: 'saturn', kind: 'moon', radius: 198.2, gm: 2.503,
    orbit: moon(185539, 0.0196, 1.57, 10), surface: 'ice', palette: ['#c9c9c9', '#8f8f8f', '#e6e6e6'],
    landable: true, relief: 4, tempK: 64,
    desc: 'Small icy moon dominated by the giant crater Herschel.',
  },
  {
    id: 'enceladus', name: 'Enceladus', parent: 'saturn', kind: 'moon', radius: 252.1, gm: 7.211,
    orbit: moon(237948, 0.0047, 0.02, 95), surface: 'ice', palette: ['#f4f7fa', '#c5d5e3', '#ffffff'],
    landable: true, relief: 0.8, tempK: 75,
    desc: 'Brilliant white ice moon. Geysers at the south pole vent water from a subsurface ocean into space.',
  },
  {
    id: 'tethys', name: 'Tethys', parent: 'saturn', kind: 'moon', radius: 531.1, gm: 41.21,
    orbit: moon(294619, 0.0001, 1.12, 170), surface: 'ice', palette: ['#d6d6d2', '#a3a39e', '#efefec'],
    landable: true, relief: 3, tempK: 86,
    desc: 'Icy moon marked by the Odysseus basin and the Ithaca Chasma canyon system.',
  },
  {
    id: 'dione', name: 'Dione', parent: 'saturn', kind: 'moon', radius: 561.4, gm: 73.11,
    orbit: moon(377396, 0.0022, 0.02, 230), surface: 'ice', palette: ['#c9c8c4', '#8e8c87', '#e8e7e3'],
    landable: true, relief: 2.5, tempK: 87,
    desc: 'Icy moon with bright wispy cliffs of fractured ice across its trailing hemisphere.',
  },
  {
    id: 'rhea', name: 'Rhea', parent: 'saturn', kind: 'moon', radius: 763.8, gm: 153.94,
    orbit: moon(527108, 0.0013, 0.35, 290), surface: 'ice', palette: ['#c4c2bd', '#8a8883', '#e2e0db'],
    landable: true, relief: 3, tempK: 76,
    desc: 'Saturn\'s second-largest moon, a heavily cratered ball of ice and rock.',
  },
  {
    id: 'titan', name: 'Titan', parent: 'saturn', kind: 'moon', radius: 2574.7, gm: 8978.14,
    orbit: moon(1221870, 0.0288, 0.35, 60), surface: 'titan', palette: ['#b5823a', '#5c4424', '#d9a85c', '#2a2218'],
    landable: true, relief: 0.6, tempK: 94,
    atmosphere: { density: 5.3, scaleHeight: 21, pressureBar: 1.45, composition: 'N₂ 95%, CH₄ 5%, organic haze',
      rayleigh: [34, 20, 6], mie: 22, mieColor: [1.0, 0.7, 0.3], mieH: 1.4 },
    desc: 'The only moon with a thick atmosphere. Methane rain, hydrocarbon seas and dunes beneath an orange haze.',
  },
  {
    id: 'iapetus', name: 'Iapetus', parent: 'saturn', kind: 'moon', radius: 734.5, gm: 120.5,
    orbit: moon(3560820, 0.0283, 15.47, 340), surface: 'rock', palette: ['#b8b2a6', '#3a2f26', '#e6e2d8'],
    landable: true, relief: 10, tempK: 110,
    desc: 'Two-toned moon — one hemisphere coal-dark, the other bright ice — with a 13 km-high equatorial ridge.',
  },
  {
    id: 'uranus', name: 'Uranus', parent: 'sun', kind: 'planet', radius: 25362, gm: 5793939,
    orbit: jpl(19.18916464, 0.04725744, 0.77263783, 313.23810451, 170.9542763, 74.01692503),
    rotationHours: -17.24, pole: [257.31, -15.18], surface: 'icegiant', palette: ['#a8dfe6', '#8fd0db', '#c4ecf0'],
    texture: 'uranus.jpg', landable: false, tempK: 76,
    atmosphere: { density: 0.42, scaleHeight: 27.7, pressureBar: 1000, composition: 'H₂ 83%, He 15%, CH₄ 2.3%',
      rayleigh: [4, 12, 15], mie: 1.5, mieColor: [0.8, 1, 1] },
    rings: { inner: 38000, outer: 51150, color: '#8a9aa0', opacity: 0.12 },
    desc: 'Ice giant tipped on its side, with a 98° axial tilt. Methane gives it a pale cyan colour.',
  },
  {
    id: 'miranda', name: 'Miranda', parent: 'uranus', kind: 'moon', radius: 235.8, gm: 4.3,
    orbit: moon(129390, 0.0013, 4.34, 15), surface: 'ice', palette: ['#b8b8b8', '#7d7d7d', '#dcdcdc'],
    landable: true, relief: 8, tempK: 60,
    desc: 'Patchwork moon of jumbled terrain, home to Verona Rupes — a 20 km cliff, the tallest known.',
  },
  {
    id: 'ariel', name: 'Ariel', parent: 'uranus', kind: 'moon', radius: 578.9, gm: 83.5,
    orbit: moon(191020, 0.0012, 0.04, 100), surface: 'ice', palette: ['#bdbbb6', '#86847f', '#dedcd7'],
    landable: true, relief: 4, tempK: 60,
    desc: 'Brightest of Uranus\'s moons, cut by broad fault valleys.',
  },
  {
    id: 'umbriel', name: 'Umbriel', parent: 'uranus', kind: 'moon', radius: 584.7, gm: 85.1,
    orbit: moon(266000, 0.0039, 0.13, 190), surface: 'rock', palette: ['#6f6e6c', '#4a4948', '#8e8d8a'],
    landable: true, relief: 3, tempK: 75,
    desc: 'Darkest of the major Uranian moons, ancient and cratered.',
  },
  {
    id: 'titania', name: 'Titania', parent: 'uranus', kind: 'moon', radius: 788.4, gm: 226.9,
    orbit: moon(435910, 0.0011, 0.08, 260), surface: 'ice', palette: ['#b3aca4', '#7d766f', '#d6cfc7'],
    landable: true, relief: 4, tempK: 70,
    desc: 'Largest moon of Uranus, with enormous canyons and fault scarps.',
  },
  {
    id: 'oberon', name: 'Oberon', parent: 'uranus', kind: 'moon', radius: 761.4, gm: 205.3,
    orbit: moon(583520, 0.0014, 0.07, 330), surface: 'rock', palette: ['#a39a92', '#6e665f', '#c4bbb3'],
    landable: true, relief: 4, tempK: 75,
    desc: 'Outermost major moon of Uranus, reddish and heavily cratered.',
  },
  {
    id: 'neptune', name: 'Neptune', parent: 'sun', kind: 'planet', radius: 24622, gm: 6836529,
    orbit: jpl(30.06992276, 0.00859048, 1.77004347, -55.12002969, 44.96476227, 131.78422574),
    rotationHours: 16.11, pole: [299.36, 43.46], surface: 'icegiant', palette: ['#3d5fd9', '#2b47b0', '#6f8ff0'],
    texture: 'neptune.jpg', landable: false, tempK: 72,
    atmosphere: { density: 0.45, scaleHeight: 19.7, pressureBar: 1000, composition: 'H₂ 80%, He 19%, CH₄ 1.5%',
      rayleigh: [3, 8, 22], mie: 1.5, mieColor: [0.8, 0.9, 1] },
    desc: 'Outermost planet. Deep blue, with the fastest winds in the Solar System at over 2,000 km/h.',
  },
  {
    id: 'proteus', name: 'Proteus', parent: 'neptune', kind: 'moon', radius: 210, gm: 2.6,
    orbit: moon(117647, 0.0005, 0.08, 70), surface: 'rock', palette: ['#6b6763', '#484542', '#8a8681'],
    landable: true, relief: 10, tempK: 51,
    desc: 'Dark, irregular inner moon of Neptune — about as large as a body can be without becoming round.',
  },
  {
    id: 'triton', name: 'Triton', parent: 'neptune', kind: 'moon', radius: 1353.4, gm: 1428.5,
    orbit: moon(354759, 0.00002, 156.87, 200), surface: 'ice', palette: ['#d9c9c0', '#b89a94', '#f0e8e4'],
    landable: true, relief: 1, tempK: 38,
    atmosphere: { density: 0.0001, scaleHeight: 14, pressureBar: 0.000014, composition: 'N₂ with trace CH₄',
      rayleigh: [0.4, 0.5, 0.8], mie: 0.2 },
    desc: 'Captured Kuiper belt object orbiting backwards. Nitrogen geysers erupt from its pinkish frozen surface.',
  },
  {
    id: 'pluto', name: 'Pluto', parent: 'sun', kind: 'dwarf', radius: 1188.3, gm: 869.6,
    orbit: jpl(39.48211675, 0.2488273, 17.14001206, 238.92903833, 224.06891629, 110.30393684),
    rotationHours: -153.29, pole: [132.99, -6.16], surface: 'ice', palette: ['#c9ad8f', '#7a5a45', '#efe6d8'],
    landable: true, relief: 3.5, tempK: 44,
    atmosphere: { density: 0.00009, scaleHeight: 50, pressureBar: 0.00001, composition: 'N₂, CH₄, CO',
      rayleigh: [0.25, 0.4, 0.8], mie: 0.25, mieColor: [0.6, 0.75, 1] },
    desc: 'Dwarf planet with nitrogen-ice glaciers, water-ice mountains and a thin blue haze.',
  },
  {
    id: 'charon', name: 'Charon', parent: 'pluto', kind: 'moon', radius: 606, gm: 105.88,
    orbit: moon(19591, 0.0002, 0.08, 120), surface: 'ice', palette: ['#9a9590', '#6b5650', '#bfbab4'],
    landable: true, relief: 4, tempK: 53,
    desc: 'Pluto\'s giant companion, half its size. The pair are mutually tidally locked.',
  },
  {
    id: 'haumea', name: 'Haumea', parent: 'sun', kind: 'dwarf', radius: 780, gm: 267.4,
    orbit: helio(43.2, 0.195, 28.2, 122.2, 239.0, 218.0), rotationHours: 3.915, pole: [285, -10],
    surface: 'ice', palette: ['#e6e6e6', '#b0a8a4', '#ffffff'], landable: true, relief: 2, tempK: 40,
    desc: 'Egg-shaped dwarf planet spinning once every 3.9 hours, with crystalline water ice and a ring.',
  },
  {
    id: 'makemake', name: 'Makemake', parent: 'sun', kind: 'dwarf', radius: 715, gm: 207,
    orbit: helio(45.4, 0.161, 29.0, 79.6, 295.0, 165.5), rotationHours: 22.83, pole: [0, 60],
    surface: 'ice', palette: ['#c9a58a', '#8f6650', '#e6cdb8'], landable: true, relief: 2, tempK: 38,
    desc: 'Reddish Kuiper belt dwarf planet coated in frozen methane.',
  },
  {
    id: 'eris', name: 'Eris', parent: 'sun', kind: 'dwarf', radius: 1163, gm: 1108,
    orbit: helio(67.86, 0.4407, 44.04, 35.95, 151.6, 205.0), rotationHours: 378.9, pole: [0, 45],
    surface: 'ice', palette: ['#e8e8ea', '#c0c0c6', '#ffffff'], landable: true, relief: 2, tempK: 30,
    desc: 'Most massive known dwarf planet, far beyond Pluto. Its discovery prompted Pluto\'s reclassification.',
  },
  {
    id: 'halley', name: 'Halley\'s Comet', parent: 'sun', kind: 'comet', radius: 5.5, gm: 1.47e-5,
    // perihelion 1986-02-09, period ~75.3 yr
    orbit: helio(17.834, 0.96714, 162.26, 58.42, 111.33, 66.4), rotationHours: 52.8, pole: [0, 30],
    surface: 'rock', palette: ['#3a3632', '#22201e', '#55504a'], landable: true, relief: 0.6, tempK: 60,
    desc: 'The most famous periodic comet, returning every 75–79 years. Currently in the outer system, heading back for 2061.',
  },
];

export const SOL: SystemDef = {
  id: 'sol', name: 'Sol', distLy: 0, ra: 0, dec: 0,
  desc: 'The Solar System: 8 planets, 5 recognised dwarf planets and hundreds of moons.',
  bodies,
  belts: [
    { inner: 2.1, outer: 3.3, count: 3500, color: '#8a8378' },
    { inner: 38, outer: 48, count: 2500, color: '#7a8590' },
  ],
};

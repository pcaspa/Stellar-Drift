import type { EconomyType } from './commodities';

export interface StationDef {
  id: string;
  name: string;
  system: string;
  /** body it orbits */
  parent: string;
  /** orbital altitude above the parent's surface, km (undefined = automatic) */
  altKm?: number;
  economy: EconomyType;
  /** visual variant ('pad' = ground spaceport) */
  style: 'ring' | 'twin' | 'spindle' | 'pad';
  /** ground spaceport on the parent's surface instead of an orbit: geographic latitude / longitude, degrees */
  port?: { lat: number; lon: number };
  desc: string;
}

export const STATIONS: StationDef[] = [
  // ground spaceports on Earth (real launch sites)
  { id: 'sp_canaveral', name: 'Cape Canaveral', system: 'sol', parent: 'earth', port: { lat: 28.49, lon: -81.13 }, economy: 'earthport', style: 'pad',
    desc: 'Florida’s Space Coast: Kennedy and Canaveral’s launch complexes, now a sprawling commercial spaceport.' },
  { id: 'sp_starbase', name: 'Starbase', system: 'sol', parent: 'earth', port: { lat: 25.997, lon: -97.157 }, economy: 'earthport', style: 'pad',
    desc: 'The heavy-lift yard at Boca Chica, Texas, where super-heavy boosters are caught by the launch tower.' },
  { id: 'sp_baikonur', name: 'Baikonur Cosmodrome', system: 'sol', parent: 'earth', port: { lat: 45.92, lon: 63.342 }, economy: 'earthport', style: 'pad',
    desc: 'The world’s first spaceport, on the Kazakh steppe — Sputnik and Gagarin flew from here.' },
  { id: 'sp_kourou', name: 'Guiana Space Centre', system: 'sol', parent: 'earth', port: { lat: 5.239, lon: -52.768 }, economy: 'earthport', style: 'pad',
    desc: 'Europe’s spaceport at Kourou, close to the equator for a free boost from Earth’s spin.' },
  { id: 'sp_tanegashima', name: 'Tanegashima', system: 'sol', parent: 'earth', port: { lat: 30.4, lon: 130.97 }, economy: 'earthport', style: 'pad',
    desc: 'Japan’s seaside launch centre, often called the most beautiful spaceport in the world.' },
  // ground bases on other worlds (landmark sites)
  { id: 'sp_tranquility', name: 'Tranquility Base', system: 'sol', parent: 'moon', port: { lat: 0.674, lon: 23.473 }, economy: 'lunar', style: 'pad',
    desc: 'Built around the preserved Apollo 11 landing site in Mare Tranquillitatis. Regolith smelters and helium-3 strip mines.' },
  { id: 'sp_shackleton', name: 'Shackleton Base', system: 'sol', parent: 'moon', port: { lat: -89.4, lon: 0 }, economy: 'lunar', style: 'pad',
    desc: 'On the sunlit rim of Shackleton crater at the lunar south pole, mining water ice from the permanently dark floor.' },
  { id: 'sp_jezero', name: 'Jezero Base', system: 'sol', parent: 'mars', port: { lat: 18.38, lon: 77.58 }, economy: 'mars', style: 'pad',
    desc: 'In the ancient river delta where Perseverance first went looking for signs of past life. Greenhouses and a busy landing field.' },
  { id: 'sp_selk', name: 'Selk Base', system: 'sol', parent: 'titan', port: { lat: 7.0, lon: 161.0 }, economy: 'titan', style: 'pad',
    desc: 'Beside Selk crater, where the Dragonfly rotorcraft first flew. Pumps methane and tholins out of the dunes.' },
  { id: 'sp_sputnik', name: 'Sputnik Base', system: 'sol', parent: 'pluto', port: { lat: 25.0, lon: 175.0 }, economy: 'pluto', style: 'pad',
    desc: 'On the glacier-flat nitrogen-ice plain of Sputnik Planitia, the heart of Pluto. The most remote landing field in the Solar System.' },
  { id: 'st_gateway', name: 'Gateway Station', system: 'sol', parent: 'earth', altKm: 410, economy: 'core', style: 'ring',
    desc: 'The busiest port in human space, successor to the ISS. Shipyards, banks and the best-stocked market in the Solar System.' },
  { id: 'st_tranquility', name: 'Tranquility Hub', system: 'sol', parent: 'moon', altKm: 110, economy: 'lunar', style: 'spindle',
    desc: 'Orbital terminus of the lunar mass drivers. Helium-3 and titanium flow up from the regolith refineries below.' },
  { id: 'st_ares', name: 'Ares Orbital', system: 'sol', parent: 'mars', altKm: 520, economy: 'mars', style: 'ring',
    desc: 'Gateway to the Martian colonies. Exports greenhouse produce and Tharsis metals; always hungry for water and nitrogen.' },
  { id: 'st_kraken', name: 'Kraken Station', system: 'sol', parent: 'titan', altKm: 1500, economy: 'titan', style: 'twin',
    desc: 'Named for Kraken Mare. Skims Titan\'s methane seas and atmosphere for hydrocarbons and nitrogen.' },
  { id: 'st_tombaugh', name: 'Tombaugh Outpost', system: 'sol', parent: 'pluto', altKm: 320, economy: 'pluto', style: 'spindle',
    desc: 'The loneliest bar in the Solar System. Ice miners pay anything for fresh food.' },
  { id: 'st_centauri', name: 'Centauri Gate', system: 'proxima', parent: 'proxima_b', economy: 'frontier', style: 'ring',
    desc: 'Humanity\'s first interstellar port, watching over the nearest exoplanet.' },
  { id: 'st_barnard', name: 'Barnard Deep', system: 'barnard', parent: 'barnard_e', economy: 'mining', style: 'spindle',
    desc: 'Automated mining depot stripping the metal-rich sub-Earths of Barnard\'s Star.' },
  { id: 'st_wolf', name: 'Wolf Watch', system: 'wolf359', parent: 'wolf359_b', economy: 'mining', style: 'twin',
    desc: 'A cold, quiet outpost orbiting the candidate planet of Wolf 359.' },
  { id: 'st_lalande', name: 'Lalande Forge', system: 'lalande', parent: 'lalande_c', economy: 'mining', style: 'twin',
    desc: 'Smelters and foundries running on the endless ice of Lalande 21185 c.' },
  { id: 'st_aegir', name: 'Ægir Highport', system: 'epseri', parent: 'epseri_b', economy: 'refinery', style: 'ring',
    desc: 'Gas-giant refinery above Epsilon Eridani b, famous for its antimatter traps.' },
  { id: 'st_ross', name: 'Ross Haven', system: 'ross128', parent: 'ross128_b', economy: 'frontier', style: 'ring',
    desc: 'Supply base for the survey teams studying temperate Ross 128 b.' },
  { id: 'st_concord', name: 'Tau Ceti Concord', system: 'tauceti', parent: 'tauceti_e', economy: 'research', style: 'ring',
    desc: 'Joint research station studying the super-Earths of Tau Ceti.' },
  { id: 'st_resonance', name: 'Resonance Station', system: 'gj876', parent: 'gj876_b', economy: 'refinery', style: 'spindle',
    desc: 'Rides the Laplace resonance of Gliese 876, harvesting the gas giant below.' },
  { id: 'st_sisters', name: 'Seven Sisters', system: 'trappist1', parent: 'trappist1_e', economy: 'research', style: 'ring',
    desc: 'Astrobiology station above TRAPPIST-1 e — the most promising address for life beyond Earth.' },
  { id: 'st_harriot', name: 'Harriot Station', system: '55cnc', parent: '55cnc_f', economy: 'refinery', style: 'twin',
    desc: 'Floats above the habitable-zone giant 55 Cancri f, refining its hydrogen.' },
];

/** height of a ground spaceport's landing deck above the terrain, m */
export const PAD_TOP_M = 2;

/** physical size used for markers / distance, km */
export const STATION_RADIUS_KM = 0.18;

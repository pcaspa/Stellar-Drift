import type { StationDef } from './stations';
import type { OreClass } from './asteroids';

export type SurfaceType =
  | 'star' | 'gas' | 'icegiant' | 'rock' | 'mars' | 'earth' | 'terra'
  | 'ocean' | 'ice' | 'lava' | 'titan' | 'venus' | 'io';

export interface AtmosphereDef {
  /** surface density kg/m^3 (at radius = body radius; for giants the 1-bar level) */
  density: number;
  /** scale height in km */
  scaleHeight: number;
  pressureBar: number;
  composition: string;
  /** visual Rayleigh scattering coefficients, 1e-6 per metre, RGB */
  rayleigh: [number, number, number];
  /** visual Mie (haze) coefficient, 1e-6 per metre */
  mie: number;
  /** tint of Mie haze */
  mieColor?: [number, number, number];
  /** Mie (aerosol/dust) scale height as a fraction of the gas scale height; default 0.25 */
  mieH?: number;
}

export interface OrbitDef {
  /** semi-major axis, km */
  a: number;
  e: number;
  /** inclination, deg */
  i: number;
  /** longitude of ascending node, deg */
  node: number;
  /** argument of periapsis, deg */
  argPeri: number;
  /** mean anomaly at J2000, deg */
  M0: number;
  /** reference plane */
  plane: 'ecliptic' | 'equator';
}

export interface BodyDef {
  id: string;
  name: string;
  parent?: string;
  kind: 'star' | 'planet' | 'moon' | 'dwarf' | 'asteroid' | 'comet' | 'station';
  station?: StationDef;
  /** mineable composition (asteroids) */
  ore?: { cls: OreClass; rich: number };
  /** mean radius km */
  radius: number;
  /** GM km^3/s^2 */
  gm: number;
  orbit?: OrbitDef;
  /** sidereal rotation period, hours (negative = retrograde). undefined = tidally locked */
  rotationHours?: number;
  /** north pole RA/Dec (deg, J2000 equatorial) */
  pole?: [number, number];
  surface: SurfaceType;
  /** main colours used by procedural generation / distant dot */
  palette: string[];
  texture?: string;
  nightTexture?: string;
  cloudTexture?: string;
  landable: boolean;
  /** terrain relief amplitude, km */
  relief?: number;
  atmosphere?: AtmosphereDef;
  rings?: { inner: number; outer: number; texture?: string; color: string; opacity: number };
  /** effective / mean surface temperature K */
  tempK?: number;
  /** star only */
  star?: { teff: number; luminosity: number; spectral: string; color: string };
  desc: string;
  /** true when appearance is speculative */
  speculative?: boolean;
  discovery?: string;
}

export interface SystemDef {
  id: string;
  name: string;
  /** distance from Sol in light years */
  distLy: number;
  /** RA (deg), Dec (deg) */
  ra: number;
  dec: number;
  desc: string;
  bodies: BodyDef[];
  /** optional debris belts: [innerAU, outerAU, count] */
  belts?: { inner: number; outer: number; count: number; color: string }[];
  /** never visited by anyone: no stations or traffic, rich unexplored asteroid belt */
  uncharted?: boolean;
  /** mineable asteroid belt (AU) and catalogue prefix for its asteroids */
  oreBelt?: { inner: number; outer: number; prefix: string };
}

export const AU_KM = 149597870.7;
export const G_EARTH = 9.80665;
export const LY_M = 9.4607304725808e15;
export const C_LIGHT = 299792458;

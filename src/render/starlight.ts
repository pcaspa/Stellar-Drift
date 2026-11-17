import { Color } from 'three';

/** approximate blackbody colour (linear RGB, max channel 1) — Tanner Helland's fit */
function blackbody(teff: number): [number, number, number] {
  const t = teff / 100;
  let r: number, g: number, b: number;
  if (t <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(t) - 161.1195681661;
    b = t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  } else {
    r = 329.698727446 * Math.pow(t - 60, -0.1332047592);
    g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
    b = 255;
  }
  const c = (x: number) => Math.pow(Math.min(255, Math.max(0, x)) / 255, 2.2);
  return [c(r), c(g), c(b)];
}

const SUN = blackbody(5772);

/**
 * Colour of starlight as an eye adapted to sunlight would see it: the Sun is white,
 * cooler stars are orange/red, hotter stars bluish. Max channel = 1.
 */
export function starLightColor(teff: number): Color {
  const bb = blackbody(teff);
  const r = bb[0] / SUN[0], g = bb[1] / SUN[1], b = bb[2] / SUN[2];
  const m = Math.max(r, g, b);
  return new Color(r / m, g / m, b / m);
}

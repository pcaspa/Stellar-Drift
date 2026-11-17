import { Quaternion, Vector3 } from 'three';
import { ORE_MIX } from '../data/asteroids';
import type { Body } from './universe';

/**
 * Surface deposits on mineable bodies: concentrated patches of one commodity (an ice-filled
 * crater, a platinum vein…) at fixed spots on the surface. A scan reveals them; landing on one
 * gives its richer mix, while drilling anywhere else only reaches thin, mixed regolith.
 */
export interface Site {
  id: string;
  /** A, B, C… */
  label: string;
  name: string;
  body: Body;
  /** direction of the site from the body centre, body-fixed frame (unit) */
  dir: Vector3;
  /** terrain height at the site, m above the mean radius */
  h: number;
  /** commodity the deposit is rich in */
  focus: string;
  /** fraction of each commodity in the extracted material */
  mix: Record<string, number>;
  /** richness multiplier relative to the bulk ore of the body */
  rich: number;
  /** set when this "site" is a ground spaceport's landing pad */
  port?: Body;
}

/** a ground spaceport as a landing site on its planet (used by the landing autopilot) */
export function portSite(st: Body): Site {
  return {
    id: st.id, label: 'PAD', name: st.name, body: st.parent!, dir: st.portDir!,
    get h() { return st.portH; }, focus: '', mix: {}, rich: 1, port: st,
  };
}

/** richness of drilling anywhere that is not on a deposit (relative to the body's bulk ore) */
export const OFF_SITE_RICHNESS = 0.6;

const NAMES: Record<string, string[]> = {
  water: ['Ice-filled crater floor', 'Buried ice lens', 'Frost-lined fissure'],
  iron: ['Iron-rich outcrop', 'Metal-rich ejecta field'],
  titanium: ['Ilmenite-bearing ridge', 'Titanium-rich basalt'],
  rareearths: ['Rare-earth regolith basin', 'Phosphate-rich scarp'],
  platinum: ['Platinum-group vein', 'Exposed metallic core'],
  nitrogen: ['Nitrogen frost field', 'Volatile-rich hollow'],
  methane: ['Methane clathrate deposit', 'Dark volatile streak'],
  helionite: ['Helionite frost vent', 'Frozen fuel lens', 'Blue-ice helionite sheet'],
  helium3: ['Helium-3 regolith bed', 'Solar-wind implanted plain'],
  iridium: ['Iridium-rich impact melt', 'Dense iridium nodule field'],
  rhodium: ['Rhodium-bearing vein', 'Shattered rhodium core'],
  xenocrystal: ['Xenocrystal geode field', 'Glittering crystal cavern'],
  exotic: ['Exotic-matter anomaly', 'Gravimetric anomaly'],
};

function rng(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
  return () => { h = (Math.imul(h, 1664525) + 1013904223) >>> 0; return h / 4294967296; };
}

const cache = new WeakMap<Body, Site[]>();

/** the deposits on a body (empty for bodies with nothing to mine); deterministic per body */
export function sitesFor(b: Body): Site[] {
  const hit = cache.get(b);
  if (hit) return hit;
  const out: Site[] = [];
  const ore = b.def.ore;
  if (ore) {
    const rand = rng(b.id + ':sites');
    const base = ORE_MIX[ore.cls];
    const kinds = Object.keys(base).filter(k => base[k] > 0);
    // icy and stony rocks always have an ice deposit (the Kestrel's ice drill needs one)
    const focuses: string[] = [...(base.water ? ['water'] : []), ...(base.helionite ? ['helionite'] : []), ...(base.exotic ? ['exotic'] : [])];
    const n = b.radius > 200e3 ? 4 : 3;
    while (focuses.length < n) {
      // pick by abundance, favouring commodities not used yet
      const pool = kinds.map(k => [k, base[k] * (focuses.includes(k) ? 0.15 : 1)] as [string, number]);
      let x = rand() * pool.reduce((a, [, w]) => a + w, 0);
      let pick = pool[0][0];
      for (const [k, w] of pool) { x -= w; if (x <= 0) { pick = k; break; } }
      focuses.push(pick);
    }
    focuses.forEach((focus, i) => {
      // concentrate the focus commodity to 55–75 % of the material
      // (ultra-rare finds are concentrated far less: an exotic-matter anomaly is a fifth exotic at best)
      const share = focus === 'exotic' ? 0.12 + 0.1 * rand() : focus === 'xenocrystal' ? 0.3 + 0.15 * rand()
        : focus === 'iridium' || focus === 'rhodium' ? 0.4 + 0.15 * rand() : 0.55 + 0.2 * rand();
      const rest = 1 - base[focus];
      const mix: Record<string, number> = {};
      for (const k of kinds) mix[k] = k === focus ? share : rest > 0 ? base[k] / rest * (1 - share) : 0;
      // random spot, kept away from the poles so it is easy to reach
      const lon = rand() * Math.PI * 2, lat = (rand() * 2 - 1) * 1.0;
      const dir = new Vector3(Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon)).normalize();
      const names = NAMES[focus] ?? ['Mineral deposit'];
      const label = String.fromCharCode(65 + i);
      out.push({
        id: `${b.id}:${label}`, label, name: names[Math.floor(rand() * names.length)], body: b, dir,
        h: b.surface.height(dir.x, dir.y, dir.z, 0), focus, mix, rich: 1.25 + 0.55 * rand(),
      });
    });
  }
  cache.set(b, out);
  return out;
}

/** how close (m, along the surface) a landing must be to count as on the deposit */
export function siteRadius(b: Body): number { return Math.max(1500, b.radius * 0.015); }

const _q = new Quaternion();

/** world-space position of a site at time t (on the ground), into out */
export function sitePos(site: Site, t: number, out: Vector3): Vector3 {
  const b = site.body;
  b.orientation(t, _q);
  return out.copy(site.dir).applyQuaternion(_q).multiplyScalar(b.radius + site.h).add(b.pos);
}

/** world-space local vertical at a site */
export function siteUp(site: Site, t: number, out: Vector3): Vector3 {
  site.body.orientation(t, _q);
  return out.copy(site.dir).applyQuaternion(_q);
}

/** the deposit at a body-fixed location (unit direction), or null if none is close enough */
export function siteAt(b: Body, localDir: Vector3): Site | null {
  const r = siteRadius(b) / b.radius;
  let best: Site | null = null, bestA = r;
  for (const s of sitesFor(b)) {
    const a = Math.acos(Math.max(-1, Math.min(1, s.dir.dot(localDir))));
    if (a <= bestA) { bestA = a; best = s; }
  }
  return best;
}

/** surface distance (m) between a site and a body-fixed direction */
export function siteDistance(site: Site, localDir: Vector3): number {
  return Math.acos(Math.max(-1, Math.min(1, site.dir.dot(localDir)))) * site.body.radius;
}

import { Vector3 } from 'three';
import type { Sim } from '../sim/sim';
import { StarSystem, equatorialToSim } from '../sim/universe';
import { LY_M } from '../data/types';

/** well-known neighbours without catalogued planets in the game, drawn for context */
const CONTEXT_STARS: { name: string; ra: number; dec: number; ly: number; color: string; mag: number }[] = [
  { name: 'Alpha Centauri A/B', ra: 219.90, dec: -60.83, ly: 4.37, color: '#fff1dc', mag: 0 },
  { name: 'Sirius', ra: 101.287, dec: -16.716, ly: 8.6, color: '#cfdcff', mag: -1.4 },
  { name: '61 Cygni', ra: 316.73, dec: 38.75, ly: 11.4, color: '#ffc999', mag: 5.2 },
  { name: 'Procyon', ra: 114.825, dec: 5.225, ly: 11.46, color: '#f4f6ff', mag: 0.4 },
  { name: "Kapteyn's Star", ra: 77.92, dec: -45.02, ly: 12.83, color: '#ffb27a', mag: 8.9 },
  { name: 'Altair', ra: 297.70, dec: 8.87, ly: 16.73, color: '#e8eeff', mag: 0.8 },
  { name: 'Vega', ra: 279.23, dec: 38.78, ly: 25.0, color: '#cfdcff', mag: 0 },
  { name: 'Fomalhaut', ra: 344.41, dec: -29.62, ly: 25.1, color: '#d8e2ff', mag: 1.2 },
  { name: 'Pollux', ra: 116.33, dec: 28.03, ly: 33.8, color: '#ffd59a', mag: 1.1 },
  { name: 'Arcturus', ra: 213.92, dec: 19.18, ly: 36.7, color: '#ffc070', mag: -0.05 },
  { name: 'Capella', ra: 79.17, dec: 46.0, ly: 42.9, color: '#fff0c8', mag: 0.08 },
];

// galactic frame: x towards the galactic centre, y to the north galactic pole
const NGP = equatorialToSim(192.85948, 27.12825).normalize();
const GC = (() => { const c = equatorialToSim(266.405, -28.936); return c.addScaledVector(NGP, -c.dot(NGP)).normalize(); })();
const GZ = new Vector3().crossVectors(GC, NGP).normalize();

/** sim-frame vector (any unit) -> galactic (x: centre, y: north, z: rotation) */
function toGal(v: Vector3, out = new Vector3()): Vector3 {
  return out.set(v.dot(GC), v.dot(NGP), v.dot(GZ));
}

interface Pt { gal: Vector3; name: string; color: string; size: number; sys?: StarSystem; }

/**
 * Galactic view of the local stellar neighbourhood: a rotatable 3D chart in galactic
 * coordinates with drop-lines to the galactic plane, the jump route and fuel cost to the
 * selected system, and an inset showing where the neighbourhood sits in the Milky Way.
 */
export class GalaxyMap {
  private yaw = 0.6;
  private pitch = 0.55;
  /** camera distance, light years */
  private dist = 62;
  private focus = new Vector3();
  private focusSys: StarSystem | null = null;
  private pts: Pt[] = [];
  private hits: { x: number; y: number; sys: StarSystem }[] = [];

  constructor(private sim: Sim, private getTargetSystem: () => StarSystem | null, private onPick: (s: StarSystem) => void) {
    for (const s of sim.universe.systems) {
      const st = s.star.def.star!;
      this.pts.push({
        gal: toGal(s.galPos).multiplyScalar(1 / LY_M), name: s.name, color: st.color,
        size: 3 + Math.min(4, Math.max(0, Math.log10(st.luminosity * 1000 + 1) * 1.3)), sys: s,
      });
    }
    for (const c of CONTEXT_STARS) {
      this.pts.push({ gal: toGal(equatorialToSim(c.ra, c.dec)).multiplyScalar(c.ly), name: c.name, color: c.color, size: Math.max(1.6, 4 - c.mag * 0.35) });
    }
  }

  centreOn(sys: StarSystem | null) {
    this.focusSys = sys;
    if (sys) toGal(sys.galPos, this.focus).multiplyScalar(1 / LY_M); else this.focus.set(0, 0, 0);
  }

  wheel(dy: number) { this.dist = Math.min(400, Math.max(12, this.dist * Math.exp(dy * 0.0015))); }
  rotate(dx: number, dy: number) {
    this.yaw -= dx * 0.006;
    this.pitch = Math.min(1.5, Math.max(-0.2, this.pitch + dy * 0.006));
  }
  pick(x: number, y: number): boolean {
    let best: StarSystem | null = null, bd = 20;
    for (const h of this.hits) { const d = Math.hypot(h.x - x, h.y - y); if (d < bd) { bd = d; best = h.sys; } }
    if (best) { this.onPick(best); return true; }
    return false;
  }

  /** galactic position (ly) -> screen; null when behind the camera */
  private proj(g: Vector3, W: number, H: number): { x: number; y: number; z: number } | null {
    const p = new Vector3().subVectors(g, this.focus);
    // yaw about the galactic pole, then pitch to look down on the plane
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    const x1 = p.x * cy - p.z * sy, z1 = p.x * sy + p.z * cy;
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const y2 = p.y * cp - z1 * sp, z2 = p.y * sp + z1 * cp;
    const depth = this.dist - z2;
    if (depth < 1) return null;
    const F = Math.min(W, H) * 1.1;
    return { x: W / 2 + x1 * F / depth, y: H / 2 - y2 * F / depth, z: depth };
  }

  draw(ctx: CanvasRenderingContext2D, W: number, H: number) {
    const sim = this.sim, here = sim.system, tgt = this.getTargetSystem();
    if (!this.focusSys) this.centreOn(here);
    ctx.fillStyle = 'rgba(2,5,12,0.94)'; ctx.fillRect(0, 0, W, H);
    this.hits.length = 0;
    // galactic plane grid around the focus: rings every 10 ly + bearings
    const plane = (x: number, z: number) => this.proj(new Vector3(this.focus.x + x, 0, this.focus.z + z), W, H);
    ctx.lineWidth = 1;
    for (let r = 10; r <= 50; r += 10) {
      ctx.strokeStyle = r % 50 === 0 ? 'rgba(95,227,255,0.3)' : 'rgba(95,227,255,0.12)';
      ctx.beginPath();
      for (let i = 0; i <= 96; i++) {
        const a = i / 96 * Math.PI * 2, p = plane(Math.cos(a) * r, Math.sin(a) * r);
        if (!p) continue;
        if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();
      const lp = plane(r, 0);
      if (lp) { ctx.fillStyle = 'rgba(95,227,255,0.45)'; ctx.font = '11px "Share Tech Mono", monospace'; ctx.fillText(`${r} ly`, lp.x + 4, lp.y - 4); }
    }
    for (let k = 0; k < 12; k++) {
      const a = k / 12 * Math.PI * 2, p0 = plane(0, 0), p1 = plane(Math.cos(a) * 50, Math.sin(a) * 50);
      if (!p0 || !p1) continue;
      ctx.strokeStyle = 'rgba(95,227,255,0.07)';
      ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.stroke();
    }
    // direction of the galactic centre
    const gcA = plane(46, 0), gcB = plane(56, 0);
    if (gcA && gcB) {
      ctx.strokeStyle = '#ffd36b'; ctx.fillStyle = '#ffd36b';
      ctx.beginPath(); ctx.moveTo(gcA.x, gcA.y); ctx.lineTo(gcB.x, gcB.y); ctx.stroke();
      ctx.beginPath(); ctx.arc(gcB.x, gcB.y, 3, 0, Math.PI * 2); ctx.fill();
      ctx.font = '600 11px Rajdhani, sans-serif';
      ctx.fillText('TO GALACTIC CENTRE · 26,000 ly', gcB.x + 6, gcB.y + 4);
    }
    // stars, far to near, with drop-lines to the galactic plane
    const items = this.pts.map(p => ({ p, s: this.proj(p.gal, W, H), base: this.proj(new Vector3(p.gal.x, 0, p.gal.z), W, H) }))
      .filter(i => i.s).sort((a, b) => b.s!.z - a.s!.z);
    const fuel = sim.econ.fuel;
    for (const { p, s, base } of items) {
      const sp = s!;
      const game = !!p.sys;
      const isHere = p.sys === here, isT = !!tgt && p.sys === tgt;
      if (base) {
        ctx.strokeStyle = p.gal.y >= 0 ? 'rgba(125,200,255,0.35)' : 'rgba(255,150,120,0.3)';
        ctx.setLineDash(p.gal.y >= 0 ? [] : [3, 3]);
        ctx.beginPath(); ctx.moveTo(sp.x, sp.y); ctx.lineTo(base.x, base.y); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(125,200,255,0.4)';
        ctx.beginPath(); ctx.ellipse(base.x, base.y, 2.5, 1.2, 0, 0, Math.PI * 2); ctx.fill();
      }
      const r = p.size * Math.min(1.6, Math.max(0.6, 90 / sp.z));
      ctx.shadowColor = p.color; ctx.shadowBlur = game ? 12 : 6;
      ctx.fillStyle = p.color;
      ctx.globalAlpha = game ? 1 : 0.55;
      ctx.beginPath(); ctx.arc(sp.x, sp.y, r, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0; ctx.globalAlpha = 1;
      if (game) {
        const ly = p.sys!.galPos.distanceTo(here.galPos) / LY_M;
        const need = isHere ? 0 : sim.econ.jumpFuel(ly);
        const ok = need <= fuel;
        if (isHere) { ctx.strokeStyle = '#6dffa8'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(sp.x, sp.y, r + 6, 0, Math.PI * 2); ctx.stroke(); ctx.lineWidth = 1; }
        if (isT) { ctx.strokeStyle = '#5fe3ff'; ctx.lineWidth = 1.5; ctx.strokeRect(sp.x - r - 7, sp.y - r - 7, (r + 7) * 2, (r + 7) * 2); ctx.lineWidth = 1; }
        ctx.font = '600 13px Rajdhani, sans-serif';
        ctx.fillStyle = isHere ? '#6dffa8' : isT ? '#ffffff' : ok ? '#cfe9ff' : '#ff8f8f';
        ctx.fillText(p.name, sp.x + r + 8, sp.y - 2);
        ctx.font = '11px "Share Tech Mono", monospace';
        ctx.fillStyle = isHere ? '#6dffa8' : ok ? 'rgba(207,233,255,0.7)' : 'rgba(255,143,143,0.8)';
        ctx.fillText(isHere ? 'YOU ARE HERE' : `${ly.toFixed(1)} ly · ${need.toFixed(1)} t`, sp.x + r + 8, sp.y + 12);
        // never-visited uncharted systems: dashed violet ring and tag
        if (p.sys!.def.uncharted && !sim.econ.visited.includes(p.sys!.id)) {
          ctx.strokeStyle = 'rgba(201,168,255,0.85)'; ctx.setLineDash([3, 3]);
          ctx.beginPath(); ctx.arc(sp.x, sp.y, r + 4, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
          ctx.fillStyle = '#c9a8ff'; ctx.fillText('UNCHARTED', sp.x + r + 8, sp.y + 25);
        }
        this.hits.push({ x: sp.x, y: sp.y, sys: p.sys! });
      } else if (sp.z < 140) {
        ctx.font = '11px Rajdhani, sans-serif';
        ctx.fillStyle = 'rgba(160,175,195,0.55)';
        ctx.fillText(p.name, sp.x + r + 5, sp.y + 3);
      }
    }
    // jump route to the selected system
    if (tgt && tgt !== here) {
      const a = this.proj(toGal(here.galPos).multiplyScalar(1 / LY_M), W, H), b = this.proj(toGal(tgt.galPos).multiplyScalar(1 / LY_M), W, H);
      if (a && b) {
        const ly = tgt.galPos.distanceTo(here.galPos) / LY_M, need = sim.econ.jumpFuel(ly), ok = need <= fuel;
        ctx.strokeStyle = ok ? '#5fe3ff' : '#ff6b6b'; ctx.setLineDash([8, 6]); ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.setLineDash([]); ctx.lineWidth = 1;
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        const txt = `JUMP ${ly.toFixed(2)} ly · ${need.toFixed(1)} t fuel${ok ? '' : ' — NOT ENOUGH FUEL'}`;
        ctx.font = '600 13px "Share Tech Mono", monospace';
        const w = ctx.measureText(txt).width;
        ctx.fillStyle = 'rgba(2,6,14,0.85)'; ctx.fillRect(mx - w / 2 - 6, my - 11, w + 12, 20);
        ctx.fillStyle = ok ? '#5fe3ff' : '#ff8f8f'; ctx.fillText(txt, mx - w / 2, my + 4);
      }
    }
    this.drawInset(ctx, W, H);
    // legend
    ctx.font = '12px Rajdhani, sans-serif'; ctx.fillStyle = 'rgba(159,184,212,0.85)';
    ctx.fillText(`Galactic coordinates · drag to rotate · scroll to zoom · click a system to target it · fuel ${fuel.toFixed(1)} t`, 20, H - 18);
  }

  /** small Milky Way with the neighbourhood's location */
  private drawInset(ctx: CanvasRenderingContext2D, W: number, H: number) {
    const R = 92, cx = W - R - 24, cy = H - R - 44;
    ctx.save();
    ctx.fillStyle = 'rgba(4,8,18,0.85)'; ctx.strokeStyle = 'rgba(95,227,255,0.25)';
    ctx.beginPath(); ctx.arc(cx, cy, R + 10, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    // bulge + bar
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 0.35);
    g.addColorStop(0, 'rgba(255,236,200,0.95)'); g.addColorStop(1, 'rgba(255,200,140,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R * 0.35, 0, Math.PI * 2); ctx.fill();
    // four logarithmic spiral arms
    for (let arm = 0; arm < 4; arm++) {
      for (let i = 0; i < 260; i++) {
        const t = i / 260;
        const a = arm * Math.PI / 2 + t * 4.2;
        const rr = R * (0.18 + 0.82 * t);
        const jx = (Math.sin(i * 12.9898 + arm) * 43758.5453 % 1) * 4, jy = (Math.sin(i * 78.233 + arm) * 12345.678 % 1) * 4;
        ctx.fillStyle = `rgba(${170 + 60 * t},${190 + 40 * t},255,${0.5 * (1 - t * 0.6)})`;
        ctx.fillRect(cx + Math.cos(a) * rr + jx, cy + Math.sin(a) * rr + jy, 1.6, 1.6);
      }
    }
    // the Sun sits ~26,000 ly out of 50,000; the galactic centre is "down" in our frame (x points to it)
    const sunR = R * 0.52, sa = Math.PI / 2;
    const sx = cx + Math.cos(sa) * sunR, sy = cy + Math.sin(sa) * sunR;
    ctx.strokeStyle = '#6dffa8'; ctx.fillStyle = '#6dffa8';
    ctx.beginPath(); ctx.arc(sx, sy, 3, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(sx, sy, 7, 0, Math.PI * 2); ctx.stroke();
    ctx.font = '600 11px Rajdhani, sans-serif';
    ctx.fillText('YOU ARE HERE', sx + 10, sy + 4);
    ctx.fillStyle = 'rgba(159,184,212,0.85)';
    ctx.fillText('MILKY WAY · ORION ARM', cx - 52, cy - R - 16);
    ctx.restore();
  }
}

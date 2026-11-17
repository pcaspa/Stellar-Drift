import { Quaternion, Vector3 } from 'three';
import type { Sim } from '../sim/sim';
import type { Body } from '../sim/universe';
import { AU_KM } from '../data/types';
import { fmtDist, fmtNum, fmtSpeed, fmtTime } from './format';
import { ORE_LABEL, ORE_MIX } from '../data/asteroids';
import { COMMODITIES } from '../data/commodities';
import { sitesFor, siteUp, type Site } from '../sim/sites';
import type { Npc } from '../sim/npc';

const _sa = new Vector3(), _sb = new Vector3(), _sc = new Vector3(), _sd = new Vector3(), _se = new Vector3();

/** spectrometer range for a composition scan, m */
export const SCAN_RANGE = 2e8;

type Mode = 'radar' | 'from' | 'to' | 'scan';

const G = '#39ff7a';
const G2 = 'rgba(57,255,122,0.55)';
const G3 = 'rgba(57,255,122,0.22)';
const AMBER = '#ffd36b';
const NPC = '#ff9f43';
const RANGES = [2e3, 10e3, 50e3, 250e3, 1e6, 5e6, 25e6, 1e8, 5e8, 2e9, 0.1 * AU_KM * 1e3, AU_KM * 1e3, 10 * AU_KM * 1e3, 100 * AU_KM * 1e3];

const _q = new Quaternion();
const _v = new Vector3(), _w = new Vector3();

interface Basis { o: Vector3; e1: Vector3; e2: Vector3; e3: Vector3; }

/**
 * Green-phosphor scope with three modes:
 *  RADAR — objects around the ship in the ship's own frame, stalks show height above/below
 *  FROM  — the ship's orbit around the body it is near (or has just left)
 *  TO    — the ship relative to the target's orbit
 */
export class Scope {
  private canvas = document.getElementById('scopeCanvas') as HTMLCanvasElement;
  private ctx = this.canvas.getContext('2d')!;
  private label = document.getElementById('scopeLabel')!;
  mode: Mode = 'radar';
  /** -1 = auto */
  private rangeIdx = -1;
  private sweep = 0;
  private time = 0;
  private lastBody: Body | null = null;
  private W = 300; private H = 300;

  /** targeted ship, highlighted on the radar */
  getNpc: () => Npc | null = () => null;
  /** a radar blip was clicked */
  onPick: (pick: { npc?: Npc; body?: Body }) => void = () => {};
  /** where radar blips were drawn this frame (for click picking) */
  private radarHits: { x: number; y: number; npc?: Npc; body?: Body }[] = [];

  /** a deposit was chosen (or cleared) as the landing site from the scan display */
  onTargetSite: (s: Site | null) => void = () => {};

  constructor(private sim: Sim, private target: () => Body | null, private getSite: () => Site | null = () => null) {
    this.canvas.addEventListener('click', e => this.onCanvasClick(e));
    const btn = (id: string, m: Mode) => {
      document.getElementById(id)!.onclick = () => { this.mode = m; this.syncButtons(); };
    };
    btn('scRadar', 'radar'); btn('scFrom', 'from'); btn('scTo', 'to'); btn('scScan', 'scan');
    document.getElementById('scZoomIn')!.onclick = () => this.zoom(-1);
    document.getElementById('scZoomOut')!.onclick = () => this.zoom(1);
    document.getElementById('scRange')!.onclick = () => { this.rangeIdx = -1; };
    this.syncButtons();
  }

  private zoom(d: number) {
    if (this.rangeIdx < 0) {
      // start manual zoom from the current automatic range
      const r = this.autoRange();
      let best = 0;
      RANGES.forEach((x, i) => { if (Math.abs(Math.log(x / r)) < Math.abs(Math.log(RANGES[best] / r))) best = i; });
      this.rangeIdx = best;
    }
    this.rangeIdx = Math.max(0, Math.min(RANGES.length - 1, this.rangeIdx + d));
  }

  /** zoom factor for FROM/TO modes (1 = fit) */
  private get viewZoom(): number { return this.rangeIdx < 0 ? 1 : Math.pow(2, 7 - this.rangeIdx); }

  private syncButtons() {
    for (const [id, m] of [['scRadar', 'radar'], ['scFrom', 'from'], ['scTo', 'to'], ['scScan', 'scan']] as const) {
      document.getElementById(id)!.classList.toggle('active', this.mode === m);
    }
  }

  private autoRange(): number {
    const s = this.sim.ship, t = this.target();
    if (t && t.system === this.sim.system) {
      const d = Math.max(t.pos.distanceTo(s.pos) - t.radius, 500);
      return Math.min(d * 1.35, 2e14);
    }
    const dom = this.sim.dominant;
    return Math.max((dom.pos.distanceTo(s.pos) - (dom.isStar ? 0 : dom.radius)) * 1.6, 2000);
  }

  draw(dt: number) {
    const c = this.canvas, dpr = Math.min(window.devicePixelRatio, 2);
    const pw = Math.round(this.W * dpr), ph = Math.round(this.H * dpr);
    if (c.width !== pw || c.height !== ph) { c.width = pw; c.height = ph; }
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.time += dt;
    // phosphor persistence: fade the previous frame instead of clearing it
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, this.W, this.H);
    ctx.lineWidth = 1;
    ctx.font = '10px "Share Tech Mono", monospace';
    ctx.textBaseline = 'middle';
    if (this.sim.ship.docked) this.lastBody = this.sim.ship.docked.parent;
    else if (!this.sim.dominant.isStar) this.lastBody = this.sim.dominant;
    if (this.mode === 'radar') this.drawRadar(dt);
    else if (this.mode === 'from') this.drawFrom();
    else if (this.mode === 'to') this.drawTo();
    else this.drawScan(dt);
    document.getElementById('scRange')!.textContent = this.mode === 'scan' ? `${fmtDist(SCAN_RANGE)}` : this.mode === 'radar'
      ? (this.rangeIdx < 0 ? 'AUTO ' : '') + fmtDist(this.rangeIdx < 0 ? this.autoRange() : RANGES[this.rangeIdx]).replace(' ', '')
      : this.rangeIdx < 0 ? 'FIT' : `×${this.viewZoom >= 1 ? this.viewZoom.toFixed(0) : this.viewZoom.toFixed(2)}`;
  }

  private glow(color: string, blur = 6) { this.ctx.shadowColor = color; this.ctx.shadowBlur = blur; }
  private noGlow() { this.ctx.shadowBlur = 0; }

  // ------------------------------------------------------------------ RADAR
  private drawRadar(dt: number) {
    this.radarHits.length = 0;
    const ctx = this.ctx, sim = this.sim, s = sim.ship, tgt = this.target();
    const R = this.rangeIdx < 0 ? this.autoRange() : RANGES[this.rangeIdx];
    const cx = this.W / 2, cy = 150, rx = 128, ry = 58, hs = 1.7;
    // plane grid
    ctx.strokeStyle = G3;
    for (const k of [0.25, 0.5, 0.75, 1]) { ctx.beginPath(); ctx.ellipse(cx, cy, rx * k, ry * k, 0, 0, Math.PI * 2); ctx.stroke(); }
    ctx.beginPath(); ctx.moveTo(cx - rx, cy); ctx.lineTo(cx + rx, cy); ctx.moveTo(cx, cy - ry); ctx.lineTo(cx, cy + ry); ctx.stroke();
    // forward field-of-view wedge
    ctx.strokeStyle = G2;
    const fa = 0.55;
    ctx.beginPath(); ctx.moveTo(cx, cy);
    ctx.lineTo(cx - Math.sin(fa) * rx, cy - Math.cos(fa) * ry); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.sin(fa) * rx, cy - Math.cos(fa) * ry);
    ctx.stroke();
    // sweep
    this.sweep = (this.sweep + dt * 2.2) % (Math.PI * 2);
    const sx = cx + Math.sin(this.sweep) * rx, sy = cy - Math.cos(this.sweep) * ry;
    const grad = ctx.createLinearGradient(cx, cy, sx, sy);
    grad.addColorStop(0, 'rgba(57,255,122,0)'); grad.addColorStop(1, 'rgba(57,255,122,0.9)');
    ctx.strokeStyle = grad; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(sx, sy); ctx.stroke(); ctx.lineWidth = 1;

    // objects in the ship frame (x right, y up, -z forward)
    const inv = _q.copy(s.quat).invert();
    type Blip = { b: Body; x: number; y: number; z: number; d: number };
    const blips: Blip[] = [];
    for (const b of sim.system.bodies) {
      if (b === s.landed) continue;
      _v.subVectors(b.pos, s.pos).applyQuaternion(inv);
      const d = _v.length() - (b.isStation ? 0 : b.radius);
      if (d > R * 3 && b !== tgt) continue;
      blips.push({ b, x: _v.x, y: _v.y, z: _v.z, d });
    }
    blips.sort((a, b) => b.d - a.d);
    let labelled = 0;
    for (const p of blips) {
      const len = Math.hypot(p.x, p.y, p.z) || 1;
      // keep the bearing, compress distance into the radar range
      const k = Math.min(1, p.d / R) / len;
      const px = cx + p.x * k * rx, pz = cy + p.z * k * ry;
      const py = pz - p.y * k * ry * hs;
      const out = p.d > R;
      const isT = p.b === tgt;
      const col = isT ? AMBER : p.b.isStation ? '#a6ffcf' : G;
      ctx.strokeStyle = isT ? 'rgba(255,211,107,0.7)' : G2;
      // stalk from the plane to the blip: up = above you, down = below you
      ctx.beginPath(); ctx.moveTo(px, pz); ctx.lineTo(px, py); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(px, pz, 2.5, 1.1, 0, 0, Math.PI * 2); ctx.stroke();
      this.glow(col, out ? 2 : 7);
      ctx.fillStyle = col; ctx.strokeStyle = col;
      const size = p.b.isStar ? 4 : p.b.def.kind === 'planet' ? 3.2 : p.b.isStation ? 2.6 : 2.2;
      if (out) { ctx.beginPath(); ctx.arc(px, py, size * 0.7, 0, Math.PI * 2); ctx.stroke(); }
      else if (p.b.isStation) ctx.fillRect(px - size, py - size, size * 2, size * 2);
      else { ctx.beginPath(); ctx.arc(px, py, size, 0, Math.PI * 2); ctx.fill(); }
      if (isT && Math.floor(this.time * 2.5) % 2 === 0) { ctx.strokeRect(px - 7, py - 7, 14, 14); }
      this.radarHits.push({ x: px, y: py, body: p.b });
      this.noGlow();
      if (isT || (labelled < 5 && !out && p.d < R)) {
        labelled++;
        ctx.fillStyle = col;
        ctx.fillText(`${p.b.name.toUpperCase()} ${fmtDist(p.d)}`, px + 7, py - 1);
      }
    }
    // NPC ships: orange triangles with stalks (amber and boxed when targeted); click one to target it
    const tn = this.getNpc();
    for (const npc of sim.traffic.npcs) {
      if (npc.state === 'docked' && npc !== tn) continue;
      _v.subVectors(npc.pos, s.pos).applyQuaternion(inv);
      const d = _v.length();
      if (d > R * 3) continue;
      const k = Math.min(1, d / R) / Math.max(d, 1e-6);
      const px = cx + _v.x * k * rx, pz = cy + _v.z * k * ry, py = pz - _v.y * k * ry * hs;
      ctx.strokeStyle = 'rgba(255,159,67,0.6)';
      ctx.beginPath(); ctx.moveTo(px, pz); ctx.lineTo(px, py); ctx.stroke();
      const sel = npc === tn, col = sel ? AMBER : NPC;
      this.glow(col, 6);
      ctx.fillStyle = col; ctx.strokeStyle = col;
      ctx.beginPath(); ctx.moveTo(px, py - 4); ctx.lineTo(px + 3.5, py + 3); ctx.lineTo(px - 3.5, py + 3); ctx.closePath();
      if (d > R) ctx.stroke(); else ctx.fill();
      if (sel && Math.floor(this.time * 2.5) % 2 === 0) ctx.strokeRect(px - 7, py - 7, 14, 14);
      this.noGlow();
      if (d < R || sel) ctx.fillText(`${npc.name.toUpperCase()} ${fmtDist(d)}`, px + 6, py - 2);
      this.radarHits.push({ x: px, y: py, npc });
    }
    // own ship + velocity relative to the dominant body
    this.glow(G, 8);
    ctx.fillStyle = G;
    ctx.beginPath(); ctx.moveTo(cx, cy - 6); ctx.lineTo(cx + 4.5, cy + 4); ctx.lineTo(cx - 4.5, cy + 4); ctx.closePath(); ctx.fill();
    _w.subVectors(s.vel, sim.dominant.vel).applyQuaternion(inv);
    const vl = _w.length();
    if (vl > 1 && !s.landed) {
      _w.multiplyScalar(1 / vl);
      ctx.strokeStyle = G; ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + _w.x * rx * 0.5, cy + _w.z * ry * 0.5 - _w.y * ry * 0.5 * hs); ctx.stroke();
      ctx.setLineDash([]);
    }
    this.noGlow();
    ctx.fillStyle = G2;
    ctx.fillText('FWD', cx - 9, 84);
    const t = tgt && tgt.system === sim.system ? tgt : null;
    this.label.textContent = `RANGE ${fmtDist(R)}  ·  stalks: up = above, down = below` +
      (t ? `\nTGT ${t.name.toUpperCase()}  ${fmtDist(t.pos.distanceTo(s.pos) - (t.isStation ? 0 : t.radius))}` : '');
  }

  // ------------------------------------------------------------------ shared orbit drawing
  /** plane through `centre` spanned by the ship's relative orbit (falls back to the body's equator) */
  private orbitBasis(centre: Body, r: Vector3, v: Vector3): Basis {
    const e3 = new Vector3().crossVectors(r, v);
    if (e3.lengthSq() < 1e-6 * r.lengthSq() * v.lengthSq() || v.lengthSq() < 1) e3.copy(centre.isStar ? new Vector3(0, 1, 0) : centre.axis);
    e3.normalize();
    const e1 = new Vector3(1, 0, 0).addScaledVector(e3, -e3.x);
    if (e1.lengthSq() < 1e-6) e1.set(0, 0, 1).addScaledVector(e3, -e3.z);
    e1.normalize();
    const e2 = new Vector3().crossVectors(e3, e1);
    return { o: centre.pos.clone(), e1, e2, e3 };
  }

  private toScreen(p: Vector3, b: Basis, scale: number, out: { x: number; y: number; h: number }) {
    _v.subVectors(p, b.o);
    out.x = this.W / 2 + _v.dot(b.e1) * scale;
    out.y = 150 - _v.dot(b.e2) * scale;
    out.h = _v.dot(b.e3) * scale;
    return out;
  }

  /** draw a Keplerian conic for relative state (r, v) around mu, projected into basis */
  private conic(r: Vector3, v: Vector3, mu: number, b: Basis, scale: number, color: string, dashed = false): { rp: number; ra: number; e: number; period: number } {
    const ctx = this.ctx;
    const h = new Vector3().crossVectors(r, v);
    const rl = r.length();
    const evec = new Vector3().crossVectors(v, h).multiplyScalar(1 / mu).addScaledVector(r, -1 / rl);
    const e = evec.length();
    const p = h.lengthSq() / mu;
    const P = e > 1e-6 ? evec.clone().normalize() : r.clone().normalize();
    const Q = new Vector3().crossVectors(h, P).normalize();
    const bound = e < 1;
    const maxNu = bound ? Math.PI : Math.acos(Math.max(-1, -1 / e)) * 0.985;
    ctx.strokeStyle = color; ctx.setLineDash(dashed ? [4, 4] : []);
    this.glow(color, 5);
    ctx.beginPath();
    let first = true;
    const o = { x: 0, y: 0, h: 0 };
    for (let i = 0; i <= 240; i++) {
      const nu = -maxNu + 2 * maxNu * i / 240;
      const rr = p / (1 + e * Math.cos(nu));
      if (!isFinite(rr) || rr < 0 || rr > 1e15) { first = true; continue; }
      _w.copy(P).multiplyScalar(Math.cos(nu) * rr).addScaledVector(Q, Math.sin(nu) * rr).add(b.o);
      this.toScreen(_w, b, scale, o);
      if (Math.abs(o.x) > 3000 || Math.abs(o.y) > 3000) { first = true; continue; }
      if (first) { ctx.moveTo(o.x, o.y); first = false; } else ctx.lineTo(o.x, o.y);
    }
    ctx.stroke(); ctx.setLineDash([]); this.noGlow();
    const rp = p / (1 + e), ra = bound ? p / (1 - e) : Infinity;
    // periapsis / apoapsis markers
    ctx.fillStyle = color;
    for (const [rr, lbl, sign] of [[rp, 'Pe', 1], [ra, 'Ap', -1]] as const) {
      if (!isFinite(rr)) continue;
      _w.copy(P).multiplyScalar(rr * sign).add(b.o);
      this.toScreen(_w, b, scale, o);
      ctx.beginPath(); ctx.arc(o.x, o.y, 2, 0, Math.PI * 2); ctx.fill();
      ctx.fillText(lbl, o.x + 4, o.y - 6);
    }
    const a = -mu / (2 * (v.lengthSq() / 2 - mu / rl));
    return { rp, ra, e, period: bound ? 2 * Math.PI * Math.sqrt(a * a * a / mu) : Infinity };
  }

  private body(b: Body, basis: Basis, scale: number, color = G, label = true) {
    const ctx = this.ctx, o = { x: 0, y: 0, h: 0 };
    this.toScreen(b.pos, basis, scale, o);
    const r = Math.max(b.isStation ? 2 : 2.5, b.radius * scale);
    this.glow(color, 8);
    ctx.strokeStyle = color; ctx.fillStyle = 'rgba(57,255,122,0.12)';
    ctx.beginPath(); ctx.arc(o.x, o.y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    if (b.atmoTop && r > 6) {
      ctx.strokeStyle = G3; ctx.beginPath(); ctx.arc(o.x, o.y, (b.radius + b.atmoTop * 0.6) * scale, 0, Math.PI * 2); ctx.stroke();
    }
    this.noGlow();
    if (label) { ctx.fillStyle = color; ctx.fillText(b.name.toUpperCase(), o.x + Math.min(r, 60) + 5, o.y + (r > 40 ? -r * 0.5 : 0)); }
    return o;
  }

  private shipMarker(basis: Basis, scale: number, v: Vector3) {
    const ctx = this.ctx, s = this.sim.ship, o = { x: 0, y: 0, h: 0 };
    this.toScreen(s.pos, basis, scale, o);
    // out-of-plane stalk
    if (Math.abs(o.h) > 2) {
      ctx.strokeStyle = G2; ctx.beginPath(); ctx.moveTo(o.x, o.y); ctx.lineTo(o.x, o.y - Math.max(-60, Math.min(60, o.h))); ctx.stroke();
    }
    this.glow(AMBER, 10);
    ctx.fillStyle = AMBER;
    ctx.beginPath(); ctx.arc(o.x, o.y, 3.5, 0, Math.PI * 2); ctx.fill();
    const vx = v.dot(basis.e1), vy = -v.dot(basis.e2), vl = Math.hypot(vx, vy);
    if (vl > 1e-6) {
      ctx.strokeStyle = AMBER; ctx.beginPath(); ctx.moveTo(o.x, o.y); ctx.lineTo(o.x + vx / vl * 16, o.y + vy / vl * 16); ctx.stroke();
    }
    this.noGlow();
    return o;
  }

  // ------------------------------------------------------------------ FROM
  private drawFrom() {
    const sim = this.sim, s = sim.ship;
    let B = sim.dominant;
    // when coasting in the star's domain, keep showing the body we just left while still near it
    if (B.isStar && this.lastBody && !this.lastBody.isStar && this.lastBody.system === sim.system
      && this.lastBody.pos.distanceTo(s.pos) < Math.max(this.lastBody.soi * 30, this.lastBody.radius * 400)) B = this.lastBody;
    const r = new Vector3().subVectors(s.pos, B.pos), v = new Vector3().subVectors(s.vel, B.vel);
    const basis = this.orbitBasis(B, r, v);
    // fit: apoapsis (if bound) or current distance
    const mu = B.mu;
    const en = v.lengthSq() / 2 - mu / r.length();
    const a = -mu / (2 * en);
    const hv = new Vector3().crossVectors(r, v);
    const e = Math.sqrt(Math.max(0, 1 + 2 * en * hv.lengthSq() / (mu * mu)));
    const extent = en < 0 && e < 1 ? a * (1 + e) : r.length() * 1.4;
    const fit = Math.max(extent, B.radius * 1.6, r.length() * 1.15);
    const scale = 128 / fit * this.viewZoom;
    // grid rings
    const ctx = this.ctx;
    ctx.strokeStyle = G3;
    for (const k of [0.33, 0.66, 1]) { ctx.beginPath(); ctx.arc(this.W / 2, 150, 128 * k, 0, Math.PI * 2); ctx.stroke(); }
    // children (moons / stations) orbits
    for (const c of B.children) {
      if (c.a * scale < 4 || c.a * scale > 2000) continue;
      ctx.strokeStyle = c.isStation ? 'rgba(166,255,207,0.35)' : G3;
      ctx.beginPath();
      const bb = Math.sqrt(1 - c.e * c.e), o = { x: 0, y: 0, h: 0 };
      for (let i = 0; i <= 120; i++) {
        const E = i / 120 * Math.PI * 2;
        _w.copy(c.P).multiplyScalar(c.a * (Math.cos(E) - c.e)).addScaledVector(c.Q, c.a * bb * Math.sin(E)).add(B.pos);
        this.toScreen(_w, basis, scale, o);
        if (i === 0) ctx.moveTo(o.x, o.y); else ctx.lineTo(o.x, o.y);
      }
      ctx.stroke();
      this.body(c, basis, scale, c.isStation ? '#a6ffcf' : G2, c.a * scale > 25);
    }
    this.body(B, basis, scale);
    let info = '';
    if (s.landed === B) info = `LANDED ON ${B.name.toUpperCase()}`;
    else {
      const o = this.conic(r, v, mu, basis, scale, G);
      info = `Pe ${fmtDist(o.rp - B.radius)}  Ap ${isFinite(o.ra) ? fmtDist(o.ra - B.radius) : 'ESCAPE'}` +
        (isFinite(o.period) ? `  T ${fmtTime(o.period)}` : `  e ${o.e.toFixed(2)}`);
    }
    this.shipMarker(basis, scale, v);
    this.label.textContent = `FROM ${B.name.toUpperCase()}  ALT ${fmtDist(r.length() - B.radius)}  V ${fmtSpeed(v.length())}\n${info}`;
  }

  // ------------------------------------------------------------------ SCAN
  /** bodies whose composition has been scanned (shared with the nav panel) */
  readonly scanned = new Set<string>();
  onScanned: (b: Body) => void = () => {};
  /** a body's scan data is available (fresh scan, or an earlier one viewed again) */
  onScanData: (b: Body) => void = () => {};
  private scanId = '';
  private scanP = 0;
  private best: { id: string; name: string; pct: number; where: string; price: number }[] = [];

  private drawScan(dt: number) {
    const ctx = this.ctx, sim = this.sim, s = sim.ship;
    // a landing site is not something to scan: with a spaceport targeted, keep showing its planet
    // (the port stays highlighted in the list); orbital stations simply can't be scanned
    const picked = this.target();
    const T = picked?.isPort ? picked.parent : picked;
    const cx = this.W / 2;
    ctx.fillStyle = G; ctx.font = '11px "Share Tech Mono", monospace';
    if (!T || T.system !== sim.system) {
      this.glow(G, 6); ctx.font = '14px "Share Tech Mono", monospace';
      ctx.fillText('NO TARGET', cx - 38, 140); this.noGlow();
      this.label.textContent = 'Select an asteroid to scan it for ore';
      return;
    }
    if (T.isStation) {
      this.glow(G, 6); ctx.font = '13px "Share Tech Mono", monospace';
      const t1 = 'NOT A SCAN TARGET';
      ctx.fillText(t1, cx - ctx.measureText(t1).width / 2, 130); this.noGlow();
      ctx.font = '11px "Share Tech Mono", monospace';
      ctx.fillText(T.name.toUpperCase(), 12, 18);
      this.label.textContent = 'Stations trade — scan an asteroid for ore,\nor a planet for its spaceports';
      return;
    }
    const dist = Math.max(0, T.pos.distanceTo(s.pos) - T.radius);
    const inRange = dist <= SCAN_RANGE || s.landed === T;
    if (T.id !== this.scanId) {
      this.scanId = T.id;
      this.scanP = this.scanned.has(T.id) ? 1 : 0;
      // an already-scanned body shows its own results straight away (not the previous target's)
      if (this.scanP >= 1) { this.computeBest(T); this.onScanData(T); } else this.best = [];
    }
    // body outline with a scanning sweep
    const r = 36, cy = 60;
    this.glow(G, 8);
    ctx.strokeStyle = G2; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    for (const [a, rr, k] of [[0.7, 0.25, 0.4], [2.3, 0.18, 0.55], [4.1, 0.22, 0.3], [5.3, 0.12, 0.7]]) {
      ctx.beginPath(); ctx.arc(cx + Math.cos(a) * r * k, cy + Math.sin(a) * r * k, r * rr, 0, Math.PI * 2); ctx.stroke();
    }
    if (inRange && this.scanP < 1) {
      this.scanP = Math.min(1, this.scanP + dt / 2.5);
      const y = cy - r + 2 * r * ((this.time * 0.9) % 1);
      ctx.strokeStyle = G; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(cx - r - 6, y); ctx.lineTo(cx + r + 6, y); ctx.stroke(); ctx.lineWidth = 1;
      if (this.scanP >= 1) this.finishScan(T);
    }
    this.noGlow();
    ctx.fillStyle = G;
    ctx.fillText(T.name.toUpperCase(), 12, 18);
    ctx.fillText(fmtDist(dist), this.W - 12 - ctx.measureText(fmtDist(dist)).width, 18);
    if (!inRange) {
      ctx.fillStyle = AMBER;
      ctx.fillText('OUT OF SCANNER RANGE', cx - 62, 135);
      this.label.textContent = `Close to within ${fmtDist(SCAN_RANGE)} to scan\n(${fmtDist(dist - SCAN_RANGE)} to go)`;
      return;
    }
    if (this.scanP < 1) {
      const t = `SCANNING ${(this.scanP * 100).toFixed(0)}%`;
      ctx.fillText(t, cx - ctx.measureText(t).width / 2, 135);
      ctx.strokeStyle = G2; ctx.strokeRect(40, 145, this.W - 80, 8);
      ctx.fillRect(41, 146, (this.W - 82) * this.scanP, 6);
      this.label.textContent = 'Spectrometer and radar sounding in progress…';
      return;
    }
    const ore = T.def.ore;
    // inhabited worlds: list their ground spaceports (TARGET makes one the destination)
    const ports = T.children.filter(c => c.isPort);
    this.portHits = [];
    if (!ore && ports.length) {
      const fwd = _sa.subVectors(T.pos, s.pos).normalize();
      const upS = _sb.set(0, 1, 0).applyQuaternion(s.quat);
      const right = _sc.crossVectors(fwd, upS); if (right.lengthSq() < 1e-6) right.set(1, 0, 0); right.normalize();
      const up2 = _sd.crossVectors(right, fwd).normalize();
      const tgt = this.target();
      ports.forEach((p, i) => {
        const w = _se.subVectors(p.pos, T.pos).normalize();
        const px = cx + r * w.dot(right), py = cy - r * w.dot(up2);
        const near = w.dot(fwd) < 0;
        ctx.strokeStyle = ctx.fillStyle = '#a6ffcf';
        if (near) ctx.fillRect(px - 2.5, py - 2.5, 5, 5); else ctx.strokeRect(px - 2.5, py - 2.5, 5, 5);
        ctx.fillText(String(i + 1), px + 5, py - 4);
      });
      let y = 112;
      ctx.fillStyle = G; ctx.fillText(`${ports.length} GROUND SPACEPORTS`, 12, y); y += 16;
      ports.forEach((p, i) => {
        const isT = p === tgt;
        const st = p.def.station!.port!;
        if (isT) { ctx.fillStyle = 'rgba(57,255,122,0.12)'; ctx.fillRect(6, y - 10, this.W - 12, 14); }
        ctx.fillStyle = isT ? AMBER : G;
        ctx.fillText(`${i + 1} ${p.name.toUpperCase().slice(0, 19)}`, 10, y);
        ctx.fillStyle = G2;
        ctx.fillText(`${Math.abs(st.lat).toFixed(0)}${st.lat >= 0 ? 'N' : 'S'} ${Math.abs(st.lon).toFixed(0)}${st.lon >= 0 ? 'E' : 'W'}`, 168, y);
        const bx = this.W - 58;
        ctx.strokeStyle = isT ? AMBER : G2; ctx.strokeRect(bx, y - 10, 48, 13);
        ctx.fillStyle = isT ? AMBER : G; ctx.fillText('TARGET', bx + 24 - ctx.measureText('TARGET').width / 2, y);
        this.portHits.push({ y0: y - 11, y1: y + 3, port: p });
        y += 15;
      });
      this.label.textContent = `Spaceports trade like stations; LAND AT PAD sets down\nand docks. ${T.name}: no mineable deposits`;
      return;
    }
    if (!ore) {
      ctx.fillStyle = AMBER;
      ctx.fillText('NO MINEABLE DEPOSITS', cx - 60, 135);
      this.label.textContent = T.isStation ? 'Stations trade — they cannot be mined' : 'Ore is only economical on asteroids';
      return;
    }
    // results
    ctx.fillStyle = G;
    ctx.fillText(`${ORE_LABEL[ore.cls].toUpperCase()}`, 12, 112);
    ctx.fillText(`RICHNESS ${(ore.rich * 100).toFixed(0)}%`, this.W - 12 - ctx.measureText(`RICHNESS ${(ore.rich * 100).toFixed(0)}%`).width, 112);
    const sites = sitesFor(T);
    const tgtSite = this.getSite();
    if (!this.inspect || this.inspect.body !== T) this.inspect = tgtSite?.body === T ? tgtSite : sites[0] ?? null;
    // deposits marked on the body picture (as seen from the ship; hollow = far side)
    {
      const fwd = _sa.subVectors(T.pos, s.pos).normalize();
      const upS = _sb.set(0, 1, 0).applyQuaternion(s.quat);
      const right = _sc.crossVectors(fwd, upS); if (right.lengthSq() < 1e-6) right.set(1, 0, 0); right.normalize();
      const up2 = _sd.crossVectors(right, fwd).normalize();
      for (const st of sites) {
        const w = siteUp(st, sim.t, _se);
        const px = cx + r * w.dot(right), py = cy - r * w.dot(up2);
        const near = w.dot(fwd) < 0;
        const col = st === tgtSite ? AMBER : G;
        ctx.strokeStyle = col; ctx.fillStyle = col;
        ctx.beginPath(); ctx.arc(px, py, 3.5, 0, Math.PI * 2);
        if (near) ctx.fill(); else ctx.stroke();
        ctx.fillText(st.label, px + 5, py - 4);
      }
    }
    // deposit list: click a row to inspect it, TARGET to make it the landing site
    const rig = sim.econ.ship.miner;
    this.hits = [];
    let y = 128;
    ctx.fillStyle = G3; ctx.fillText('SURFACE DEPOSITS', 12, y); y += 14;
    for (const st of sites) {
      const isT = st === tgtSite, isI = st === this.inspect;
      if (isI) { ctx.fillStyle = 'rgba(57,255,122,0.12)'; ctx.fillRect(6, y - 10, this.W - 12, 14); }
      const c = COMMODITIES.find(x => x.id === st.focus);
      const ok = !rig || !rig.only || rig.only.includes(st.focus);
      ctx.fillStyle = isT ? AMBER : ok ? G : G2;
      ctx.fillText(`${isT ? '◆' : ' '}${st.label}  ${(c?.name ?? st.focus).toUpperCase()} ${(st.mix[st.focus] * 100).toFixed(0)}%`, 10, y);
      if (ok) ctx.fillText(`×${st.rich.toFixed(1)}`, 196, y);
      else { ctx.fillStyle = 'rgba(255,120,100,0.85)'; ctx.fillText('NO RIG', 186, y); }
      // target button
      const bx = this.W - 58;
      ctx.strokeStyle = isT ? AMBER : G2; ctx.strokeRect(bx, y - 10, 48, 13);
      ctx.fillStyle = isT ? AMBER : G;
      const bt = isT ? 'TARGET' : 'TARGET';
      ctx.fillText(bt, bx + 24 - ctx.measureText(bt).width / 2, y);
      if (isT) { ctx.fillStyle = 'rgba(255,211,107,0.18)'; ctx.fillRect(bx + 1, y - 9, 46, 11); }
      this.hits.push({ y0: y - 11, y1: y + 3, site: st, bx });
      y += 14;
    }
    // composition of the inspected deposit
    const sel = this.inspect;
    const mix = sel ? sel.mix : ORE_MIX[ore.cls];
    y += 3;
    ctx.fillStyle = G2;
    ctx.fillText(sel ? `${sel.label} · ${sel.name.toUpperCase()}` : 'BULK REGOLITH', 12, y); y += 13;
    const rows = Object.entries(mix).filter(([, f]) => f > 0).sort((a, b) => b[1] - a[1]).slice(0, 3);
    for (const [id, f] of rows) {
      const c = COMMODITIES.find(x => x.id === id)!;
      const kept = !rig || !rig.only || rig.only.includes(id);
      ctx.fillStyle = kept ? G : G3;
      ctx.fillText(c.name.toUpperCase(), 12, y);
      ctx.fillText(`${(f * 100).toFixed(0)}%`, 150, y);
      ctx.strokeStyle = G3; ctx.strokeRect(178, y - 4, 60, 7);
      ctx.fillStyle = kept ? G2 : G3; ctx.fillRect(179, y - 3, 58 * Math.min(1, f / 0.75), 5);
      ctx.fillStyle = kept ? AMBER : G3;
      const pr = `${fmtNum(this.prices[id] ?? c.base)}`;
      ctx.fillText(pr, this.W - 12 - ctx.measureText(pr).width, y);
      y += 12;
    }
    const yieldH = sim.econ.mineYield(T, sel);
    const rate = Object.values(yieldH).reduce((a, b) => a + b, 0);
    const perHour = Object.entries(yieldH).reduce((a, [id, t]) => a + t * (this.prices[id] ?? 0), 0);
    const where = sel ? `DEPOSIT ${sel.label}: ` : '';
    this.label.textContent = rate > 0
      ? `${where}${rig?.only ? 'ICE DRILL ' : ''}${rate.toFixed(1)} t/h ${sim.econ.minedNames(T, sel).slice(0, 2).join('+').toUpperCase()} · ≈ ${fmtNum(perHour)} cr/h\n${sel && !sim.econ.rigTakes(sel.focus) ? 'NO RIG for the main ore here — needs a mining ship' : 'TARGET a deposit, then LAND to set down on it'}`
      : rig?.only ? `${where}nothing your ice drill can cut\nTARGET an ice or Helionite deposit, then LAND`
        : `${where}mining ship required to extract\nTARGET a deposit to mark a landing site`;
  }

  /** deposit being inspected in the scan display */
  private inspect: Site | null = null;
  /** clickable spaceport rows drawn this frame */
  private portHits: { y0: number; y1: number; port: Body }[] = [];
  /** clickable deposit rows drawn this frame */
  private hits: { y0: number; y1: number; site: Site; bx: number }[] = [];
  /** best selling price per commodity in this system (refreshed on each scan view) */
  private prices: Record<string, number> = {};

  private onCanvasClick(e: MouseEvent) {
    const rect = this.canvas.getBoundingClientRect();
    // offsetX/Y are in the canvas's own (untransformed) CSS pixels, also when mounted in the cockpit
    const x = e.offsetX ?? (e.clientX - rect.left), y = e.offsetY ?? (e.clientY - rect.top);
    if (this.mode === 'radar') {
      // nearest blip within reach; ships win over bodies at the same spot
      let best: typeof this.radarHits[number] | null = null, bd = 14 * 14;
      for (const h of this.radarHits) {
        const d2 = (h.x - x) ** 2 + (h.y - y) ** 2 - (h.npc ? 30 : 0);
        if (d2 < bd) { bd = d2; best = h; }
      }
      if (best) this.onPick(best.npc ? { npc: best.npc } : { body: best.body });
      return;
    }
    if (this.mode !== 'scan') return;
    const ph = this.portHits.find(h => y >= h.y0 && y <= h.y1);
    if (ph) { this.onPick({ body: ph.port }); return; }
    const hit = this.hits.find(h => y >= h.y0 && y <= h.y1);
    if (!hit) return;
    this.inspect = hit.site;
    if (x >= hit.bx - 4) this.onTargetSite(this.getSite() === hit.site ? null : hit.site);
  }

  private finishScan(T: Body) {
    this.scanned.add(T.id);
    this.computeBest(T);
    this.onScanned(T);
    this.onScanData(T);
  }

  /** composition of a scanned body with the best selling price for each part in this system */
  private computeBest(T: Body) {
    const ore = T.def.ore;
    this.best = [];
    if (ore) {
      const stations = this.sim.system.bodies.filter(b => b.isStation);
      for (const [id, f] of Object.entries(ORE_MIX[ore.cls]).sort((a, b) => b[1] - a[1])) {
        const c = COMMODITIES.find(x => x.id === id)!;
        let price = c.base, where = '';
        for (const st of stations) {
          const q = this.sim.econ.quote(st, c, this.sim.t);
          if (q.sell > price || !where) { price = q.sell; where = st.name; }
        }
        this.best.push({ id, name: c.name, pct: f * 100, where, price });
        this.prices[id] = price;
      }
    }
  }

  /** composition summary for the nav panel (null until scanned) */
  scanSummary(b: Body): string | null {
    if (!this.scanned.has(b.id) || !b.def.ore) return null;
    return Object.entries(ORE_MIX[b.def.ore.cls]).sort((x, y) => y[1] - x[1])
      .map(([id, f]) => `${COMMODITIES.find(c => c.id === id)!.name} ${(f * 100).toFixed(0)}%`).join(', ');
  }

  // ------------------------------------------------------------------ TO
  private drawTo() {
    const sim = this.sim, s = sim.ship, T = this.target();
    const ctx = this.ctx;
    if (!T || T.system !== sim.system) {
      ctx.fillStyle = G; this.glow(G, 6);
      ctx.font = '14px "Share Tech Mono", monospace';
      ctx.fillText('NO TARGET', this.W / 2 - 38, 150);
      this.noGlow();
      this.label.textContent = 'Select a destination to plot your approach';
      return;
    }
    const rT = new Vector3().subVectors(s.pos, T.pos), vT = new Vector3().subVectors(s.vel, T.vel);
    const dist = rT.length();
    const near = !T.parent || T.isStation ? dist < 60e3 || !T.parent : dist < Math.max(T.soi * 1.2, T.radius * 12);
    if (near) {
      // target-centred: your trajectory relative to the target and its parking orbit
      const basis = this.orbitBasis(T, rT, vT);
      const park = T.parkingRadius();
      const fit = Math.max(dist * 1.2, park * 1.3, T.radius * 1.6);
      const scale = 128 / fit * this.viewZoom;
      ctx.strokeStyle = G2; ctx.setLineDash([2, 4]);
      ctx.beginPath(); ctx.arc(this.W / 2, 150, park * scale, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
      this.body(T, basis, scale, AMBER);
      if (T.mu > 1) this.conic(rT, vT, T.mu, basis, scale, G);
      this.shipMarker(basis, scale, vT);
      const closing = -rT.dot(vT) / Math.max(dist, 1);
      this.label.textContent = `TO ${T.name.toUpperCase()}  ${fmtDist(dist - (T.isStation ? 0 : T.radius))}\nREL V ${fmtSpeed(vT.length())}  CLOSING ${fmtSpeed(closing)}`;
      return;
    }
    // centre on the closest ancestor of the target whose domain also contains you (e.g. Earth when
    // you are at Earth and the target orbits the Moon); O is the body on the target's chain orbiting it
    let O: Body = T, P: Body = T.parent!;
    while (P.parent && P.pos.distanceTo(s.pos) > P.soi) { O = P; P = P.parent; }
    const basis: Basis = { o: P.pos.clone(), e1: O.P.clone(), e2: O.Q.clone(), e3: O.orbitNormal.clone() };
    const rP = new Vector3().subVectors(s.pos, P.pos);
    const fit = Math.max(O.a * (1 + O.e), rP.length()) * 1.12;
    const scale = 128 / fit * this.viewZoom;
    // orbit of the target (or of the body it rides with)
    ctx.strokeStyle = AMBER; this.glow(AMBER, 5); ctx.beginPath();
    const bb = Math.sqrt(1 - O.e * O.e), o = { x: 0, y: 0, h: 0 };
    for (let i = 0; i <= 160; i++) {
      const E = i / 160 * Math.PI * 2;
      _w.copy(O.P).multiplyScalar(O.a * (Math.cos(E) - O.e)).addScaledVector(O.Q, O.a * bb * Math.sin(E)).add(P.pos);
      this.toScreen(_w, basis, scale, o);
      if (i === 0) ctx.moveTo(o.x, o.y); else ctx.lineTo(o.x, o.y);
    }
    ctx.stroke(); this.noGlow();
    this.body(P, basis, scale, G2);
    if (O !== T) this.body(O, basis, scale, G2, false);
    const tp = this.body(T, basis, scale, AMBER);
    // your own trajectory around the parent
    const vP = new Vector3().subVectors(s.vel, P.vel);
    if (!s.landed) this.conic(rP, vP, P.mu, basis, scale, G, true);
    const sp = this.shipMarker(basis, scale, vP);
    ctx.strokeStyle = 'rgba(255,211,107,0.35)'; ctx.setLineDash([2, 3]);
    ctx.beginPath(); ctx.moveTo(sp.x, sp.y); ctx.lineTo(tp.x, tp.y); ctx.stroke(); ctx.setLineDash([]);
    const above = rP.dot(O.orbitNormal);
    this.label.textContent = `TO ${T.name.toUpperCase()}  ${fmtDist(dist - (T.isStation ? 0 : T.radius))}\n` +
      `${Math.abs(above) < 1 ? 'IN' : above > 0 ? fmtDist(above) + ' ABOVE' : fmtDist(-above) + ' BELOW'} ITS ORBITAL PLANE`;
  }
}

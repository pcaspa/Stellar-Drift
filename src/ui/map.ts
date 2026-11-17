import { Vector3 } from 'three';
import type { Sim } from '../sim/sim';
import { Body, StarSystem } from '../sim/universe';
import { GalaxyMap } from './galaxyMap';
import { fmtDist } from './format';

const KIND_COLOR: Record<string, string> = { star: '#ffd9a0', planet: '#6fb4ff', moon: '#9aa9bd', dwarf: '#b59aff', asteroid: '#b59aff', comet: '#7fd9c4' };

/** top-down 2D map of the current star system */
export class SystemMap {
  private el = document.getElementById('map')!;
  private canvas = document.getElementById('mapCanvas') as HTMLCanvasElement;
  private ctx = this.canvas.getContext('2d')!;
  open = false;
  /** metres per pixel */
  private scale = 1e9;
  private centre = new Vector3();
  private follow: 'star' | 'ship' | 'target' | 'free' = 'star';
  private drag: { x: number; y: number; moved: boolean } | null = null;
  private hits: { x: number; y: number; b: Body }[] = [];
  /** which chart is shown: this star system, or the local galactic neighbourhood */
  mode: 'system' | 'galaxy' = 'galaxy';
  private galaxy: GalaxyMap;

  constructor(private sim: Sim, private getTarget: () => Body | null, private onPick: (b: Body) => void,
    private getTargetSystem: () => StarSystem | null, onPickSystem: (s: StarSystem) => void) {
    this.galaxy = new GalaxyMap(sim, getTargetSystem, onPickSystem);
    try { const m = localStorage.getItem('stellardrift.mapmode'); if (m === 'system' || m === 'galaxy') this.mode = m; } catch { /* ignore */ }
    document.getElementById('mapSys')!.onclick = () => this.setMode('system');
    document.getElementById('mapGal')!.onclick = () => this.setMode('galaxy');
    this.setMode(this.mode);
    const c = this.canvas;
    c.addEventListener('wheel', e => {
      e.preventDefault();
      if (this.mode === 'galaxy') { this.galaxy.wheel(e.deltaY); return; }
      const f = Math.exp(e.deltaY * 0.0015);
      // zoom about the cursor
      const wx = this.centre.x + (e.clientX - c.clientWidth / 2) * this.scale;
      const wz = this.centre.z + (e.clientY - c.clientHeight / 2) * this.scale;
      this.scale = Math.min(1e12, Math.max(50, this.scale * f));
      if (this.follow === 'free') {
        this.centre.x = wx - (e.clientX - c.clientWidth / 2) * this.scale;
        this.centre.z = wz - (e.clientY - c.clientHeight / 2) * this.scale;
      }
    }, { passive: false });
    c.addEventListener('pointerdown', e => { this.drag = { x: e.clientX, y: e.clientY, moved: false }; c.setPointerCapture(e.pointerId); });
    c.addEventListener('pointermove', e => {
      if (!this.drag) return;
      const dx = e.clientX - this.drag.x, dy = e.clientY - this.drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) this.drag.moved = true;
      if (this.drag.moved && this.mode === 'galaxy') {
        this.galaxy.rotate(dx, dy);
        this.drag.x = e.clientX; this.drag.y = e.clientY;
      } else if (this.drag.moved) {
        this.follow = 'free';
        this.centre.x -= dx * this.scale; this.centre.z -= dy * this.scale;
        this.drag.x = e.clientX; this.drag.y = e.clientY;
      }
    });
    c.addEventListener('pointerup', e => {
      if (this.drag && !this.drag.moved && this.mode === 'galaxy') {
        this.galaxy.pick(e.clientX, e.clientY);
      } else if (this.drag && !this.drag.moved) {
        let best: Body | null = null, bd = 18;
        for (const h of this.hits) { const d = Math.hypot(h.x - e.clientX, h.y - e.clientY); if (d < bd) { bd = d; best = h.b; } }
        if (best) this.onPick(best);
      }
      this.drag = null;
    });
    document.getElementById('mapStar')!.onclick = () => {
      if (this.mode === 'galaxy') { this.galaxy.centreOn(this.sim.system); return; }
      this.follow = 'star'; this.fit();
    };
    document.getElementById('mapShip')!.onclick = () => { this.follow = 'ship'; this.scale = Math.max(2e4, this.sim.ship.pos.distanceTo(this.sim.dominant.pos) / 150); };
    document.getElementById('mapTarget')!.onclick = () => {
      if (this.mode === 'galaxy') { const ts = getTargetSystem(); if (ts) this.galaxy.centreOn(ts); return; }
      const t = this.getTarget(); if (!t) return;
      this.follow = 'target';
      const far = t.children.reduce((m, c) => Math.max(m, c.a), t.radius * 4);
      this.scale = far / 250;
    };
    document.getElementById('mapClose')!.onclick = () => this.toggle(false);
  }

  setMode(m: 'system' | 'galaxy') {
    this.mode = m;
    try { localStorage.setItem('stellardrift.mapmode', m); } catch { /* ignore */ }
    document.getElementById('mapSys')!.classList.toggle('active', m === 'system');
    document.getElementById('mapGal')!.classList.toggle('active', m === 'galaxy');
    document.getElementById('mapTitle')!.textContent = m === 'galaxy' ? 'GALACTIC NEIGHBOURHOOD' : `${this.sim.system.name.toUpperCase()} SYSTEM`;
    document.getElementById('mapStar')!.textContent = m === 'galaxy' ? 'CENTRE HERE' : 'CENTRE STAR';
    document.getElementById('mapShip')!.classList.toggle('hidden', m === 'galaxy');
    document.getElementById('mapHint')!.textContent = m === 'galaxy'
      ? 'Drag to rotate · scroll to zoom · click a system to target it'
      : 'Scroll to zoom · drag to pan · click a body to target it';
    if (m === 'galaxy') this.galaxy.centreOn(this.sim.system);
  }

  fit() { this.scale = Math.max(this.sim.system.extent, 1e9) * 1.15 / (Math.min(window.innerWidth, window.innerHeight) / 2); }

  toggle(on = !this.open) {
    this.open = on;
    this.el.classList.toggle('hidden', !on);
    if (on) this.setMode(this.mode);
    if (on && this.follow === 'star') this.fit();
  }

  draw() {
    // nothing to centre on without a target
    const tb = document.getElementById('mapTarget') as HTMLButtonElement;
    const noTgt = this.mode === 'galaxy' ? !this.getTargetSystem() : !this.getTarget();
    if (tb.disabled !== noTgt) { tb.disabled = noTgt; tb.title = noTgt ? 'Select a target first' : 'Centre on the target'; }
    if (!this.open) return;
    const c = this.canvas, ctx = this.ctx, dpr = Math.min(window.devicePixelRatio, 2);
    const W = c.clientWidth, H = c.clientHeight;
    if (c.width !== W * dpr || c.height !== H * dpr) { c.width = W * dpr; c.height = H * dpr; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (this.mode === 'galaxy') { this.galaxy.draw(ctx, W, H); return; }
    const sim = this.sim, sys = sim.system, tgt = this.getTarget();
    if (this.follow === 'star') this.centre.copy(sys.star.pos);
    else if (this.follow === 'ship') this.centre.copy(sim.ship.pos);
    else if (this.follow === 'target' && tgt) this.centre.copy(tgt.pos);
    const sx = (x: number) => W / 2 + (x - this.centre.x) / this.scale;
    const sy = (z: number) => H / 2 + (z - this.centre.z) / this.scale;
    this.hits.length = 0;

    // orbits
    ctx.lineWidth = 1;
    for (const b of sys.bodies) {
      if (!b.parent) continue;
      const apx = b.a / this.scale;
      if (apx < 6 || apx > 2e5) continue;
      ctx.strokeStyle = b.def.kind === 'planet' ? 'rgba(111,180,255,0.4)' : 'rgba(150,160,190,0.25)';
      ctx.beginPath();
      const bb = Math.sqrt(1 - b.e * b.e);
      for (let i = 0; i <= 180; i++) {
        const E = i / 180 * 2 * Math.PI;
        const x = b.a * (Math.cos(E) - b.e), y = b.a * bb * Math.sin(E);
        const X = sx(b.parent.pos.x + b.P.x * x + b.Q.x * y), Y = sy(b.parent.pos.z + b.P.z * x + b.Q.z * y);
        if (i === 0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y);
      }
      ctx.stroke();
    }
    // ship trajectory around the dominant body
    const o = sim.orbit;
    if (o && isFinite(o.rp)) {
      const e = o.e, p = o.rp * (1 + e);
      const P = new Vector3().copy(o.evec); if (e < 1e-6) P.subVectors(sim.ship.pos, o.body.pos); P.normalize();
      const Q = new Vector3().crossVectors(o.h, P).normalize();
      const maxNu = o.bound ? Math.PI : Math.acos(-1 / e) * 0.96;
      ctx.strokeStyle = 'rgba(53,224,255,0.9)'; ctx.setLineDash([5, 4]); ctx.beginPath();
      for (let i = 0; i <= 200; i++) {
        const nu = -maxNu + 2 * maxNu * i / 200, r = p / (1 + e * Math.cos(nu));
        const X = sx(o.body.pos.x + (P.x * Math.cos(nu) + Q.x * Math.sin(nu)) * r), Y = sy(o.body.pos.z + (P.z * Math.cos(nu) + Q.z * Math.sin(nu)) * r);
        if (i === 0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y);
      }
      ctx.stroke(); ctx.setLineDash([]);
    }
    // bodies
    ctx.font = '600 13px Rajdhani, sans-serif'; ctx.textBaseline = 'middle';
    for (const b of sys.bodies) {
      const X = sx(b.pos.x), Y = sy(b.pos.z);
      if (X < -50 || X > W + 50 || Y < -50 || Y > H + 50) continue;
      const apx = b.parent ? b.a / this.scale : 1e9;
      if (apx < 10 && b !== tgt) continue;
      const rpx = Math.max(b.isStar ? 5 : b.def.kind === 'planet' ? 3.5 : 2.5, b.radius / this.scale);
      ctx.fillStyle = b.def.palette[0];
      if (b.isStar) { ctx.shadowColor = b.def.star!.color; ctx.shadowBlur = 18; ctx.fillStyle = b.def.star!.color; }
      ctx.beginPath(); ctx.arc(X, Y, rpx, 0, 2 * Math.PI); ctx.fill(); ctx.shadowBlur = 0;
      if (b === tgt) { ctx.strokeStyle = '#5fe3ff'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(X, Y, rpx + 6, 0, 2 * Math.PI); ctx.stroke(); ctx.lineWidth = 1; }
      ctx.fillStyle = b === tgt ? '#ffffff' : KIND_COLOR[b.def.kind];
      ctx.fillText(b.name, X + rpx + 6, Y);
      this.hits.push({ x: X, y: Y, b });
    }
    // NPC traffic
    ctx.font = '600 12px Rajdhani, sans-serif';
    for (const npc of sim.traffic.npcs) {
      if (npc.state === 'docked') continue;
      const nx = sx(npc.pos.x), ny = sy(npc.pos.z);
      if (nx < -20 || nx > W + 20 || ny < -20 || ny > H + 20) continue;
      ctx.fillStyle = '#ff9f43';
      ctx.beginPath(); ctx.moveTo(nx, ny - 5); ctx.lineTo(nx + 4, ny + 4); ctx.lineTo(nx - 4, ny + 4); ctx.closePath(); ctx.fill();
      ctx.fillText(`${npc.name} → ${npc.dest.name}`, nx + 8, ny + 2);
      ctx.strokeStyle = 'rgba(255,159,67,0.25)'; ctx.setLineDash([3, 4]);
      ctx.beginPath(); ctx.moveTo(nx, ny); ctx.lineTo(sx(npc.dest.pos.x), sy(npc.dest.pos.z)); ctx.stroke(); ctx.setLineDash([]);
    }
    // ship
    const X = sx(sim.ship.pos.x), Y = sy(sim.ship.pos.z);
    ctx.strokeStyle = '#6dffa8'; ctx.fillStyle = '#6dffa8'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(X, Y - 7); ctx.lineTo(X + 5, Y + 5); ctx.lineTo(X - 5, Y + 5); ctx.closePath(); ctx.stroke();
    ctx.fillText('YOU', X + 10, Y + 12);
    if (tgt) { ctx.strokeStyle = 'rgba(109,255,168,0.25)'; ctx.beginPath(); ctx.moveTo(X, Y); ctx.lineTo(sx(tgt.pos.x), sy(tgt.pos.z)); ctx.stroke(); }
    // scale bar
    const barM = Math.pow(10, Math.floor(Math.log10(this.scale * 160)));
    ctx.strokeStyle = '#9fb8d4'; ctx.fillStyle = '#9fb8d4'; ctx.beginPath();
    ctx.moveTo(24, H - 28); ctx.lineTo(24 + barM / this.scale, H - 28); ctx.stroke();
    ctx.fillText(fmtDist(barM), 24, H - 14);
  }
}

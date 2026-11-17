import { Quaternion, Vector3 } from 'three';
import type { Sim } from '../sim/sim';
import type { World } from '../render/world';
import type { Body } from '../sim/universe';
import { G_EARTH } from '../data/types';
import { fmtDist, fmtSpeed, fmtTime } from './format';
import { guidance, Guidance } from '../sim/guidance';
import { DASH_TOP_FRAC } from '../render/cockpitPanels';
import { siteDistance, sitePos, type Site } from '../sim/sites';
import type { Npc } from '../sim/npc';

const _sp = new Vector3(), _sv = new Vector3(), _sq = new Quaternion();

const HUD = '#7dffb0';
const HUD_DIM = 'rgba(125,255,176,0.45)';
const WARN = '#ffb347';
const DEG = Math.PI / 180;

const _q = new Quaternion();
const _v = new Vector3(), _u = new Vector3(), _f = new Vector3(), _n = new Vector3(), _e = new Vector3();

/**
 * Collimated heads-up display drawn over the cockpit view, plus the two dashboard displays
 * (attitude repeater and ship status) that the 3D cockpit shows on its screens.
 */
export class CockpitHud {
  private canvas = document.createElement('canvas');
  private ctx = this.canvas.getContext('2d')!;
  private t = 0;
  private screenTimer = 0;

  /** landing site chosen on the target, if any */
  getSite: () => Site | null = () => null;
  /** another ship chosen as the target, if any */
  getNpc: () => Npc | null = () => null;

  constructor(private sim: Sim, private world: World, private target: () => Body | null,
    private statusCanvas: HTMLCanvasElement, private attCanvas: HTMLCanvasElement) {
    this.canvas.id = 'hudCanvas';
    document.body.insertBefore(this.canvas, document.getElementById('markers'));
  }

  draw(dt: number) {
    const on = this.world.view === 'cockpit';
    document.body.classList.toggle('cockpit', on);
    this.canvas.style.display = on ? 'block' : 'none';
    if (!on) return;
    this.t += dt;
    const W = window.innerWidth, H = window.innerHeight, dpr = Math.min(window.devicePixelRatio, 2);
    if (this.canvas.width !== Math.round(W * dpr) || this.canvas.height !== Math.round(H * dpr)) {
      this.canvas.width = Math.round(W * dpr); this.canvas.height = Math.round(H * dpr);
    }
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = HUD; ctx.fillStyle = HUD;
    ctx.shadowColor = HUD; ctx.shadowBlur = 4;
    ctx.font = '600 13px "Share Tech Mono", monospace';
    ctx.textBaseline = 'middle';

    const sim = this.sim, s = sim.ship, w = this.world, dom = sim.dominant;
    const cx = W / 2, cy = H * 0.36;
    // the HUD is collimated on the windscreen only: never draw over the console
    const dashTop = H * DASH_TOP_FRAC - 4;
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, W, dashTop); ctx.clip();
    // side readouts sit inside the free area between the left panel and the scope
    const side = Math.max(150, Math.min(330, W * 0.17));
    const ppr = w.pxPerRad;
    const camInv = _q.copy(w.camQuat).invert();

    // ---------------- pitch ladder + horizon (near a body)
    const up = _u.subVectors(s.pos, dom.pos).normalize();
    const nearBody = !dom.isStar && sim.altitude < dom.radius * 8;
    const fwdW = _f.set(0, 0, -1).applyQuaternion(w.camQuat);
    const upCam = _v.copy(up).applyQuaternion(camInv); // local up in camera space
    const pitch = Math.asin(Math.max(-1, Math.min(1, fwdW.dot(up))));
    const roll = Math.atan2(upCam.x, upCam.y);
    if (nearBody) {
      ctx.save();
      ctx.beginPath(); ctx.rect(cx - 260, cy - 230, 520, dashTop - (cy - 230)); ctx.clip();
      ctx.translate(cx, cy); ctx.rotate(roll);
      for (let p = -90; p <= 90; p += 10) {
        const y = (pitch - p * DEG) * ppr;
        if (Math.abs(y) > 260) continue;
        const half = p === 0 ? 240 : 70;
        ctx.strokeStyle = p === 0 ? HUD : HUD_DIM;
        ctx.setLineDash(p < 0 ? [8, 6] : []);
        ctx.beginPath();
        if (p === 0) { ctx.moveTo(-half, y); ctx.lineTo(-40, y); ctx.moveTo(40, y); ctx.lineTo(half, y); }
        else {
          const tick = p > 0 ? 8 : -8;
          ctx.moveTo(-half, y + tick); ctx.lineTo(-half, y); ctx.lineTo(-30, y);
          ctx.moveTo(30, y); ctx.lineTo(half, y); ctx.lineTo(half, y + tick);
        }
        ctx.stroke(); ctx.setLineDash([]);
        if (p !== 0) { ctx.fillStyle = HUD_DIM; ctx.fillText(String(p), half + 6, y); ctx.fillText(String(p), -half - 26, y); }
      }
      ctx.restore();
      // heading tape
      _n.copy(dom.axis).addScaledVector(up, -dom.axis.dot(up));
      if (_n.lengthSq() < 1e-8) _n.set(1, 0, 0);
      _n.normalize();
      _e.crossVectors(_n, up);
      const fh = _v.copy(fwdW).addScaledVector(up, -fwdW.dot(up));
      const hdg = ((Math.atan2(fh.dot(_e), fh.dot(_n)) / DEG) + 360) % 360;
      const ty = 70;
      ctx.strokeStyle = HUD; ctx.fillStyle = HUD;
      ctx.beginPath(); ctx.moveTo(cx - 160, ty); ctx.lineTo(cx + 160, ty); ctx.stroke();
      for (let d = Math.floor((hdg - 40) / 5) * 5; d <= hdg + 40; d += 5) {
        const x = cx + (d - hdg) * 4;
        const major = ((d % 10) + 10) % 10 === 0;
        ctx.beginPath(); ctx.moveTo(x, ty); ctx.lineTo(x, ty - (major ? 9 : 5)); ctx.stroke();
        if (((d % 30) + 30) % 30 === 0) {
          const v = ((d % 360) + 360) % 360;
          const lbl = v === 0 ? 'N' : v === 90 ? 'E' : v === 180 ? 'S' : v === 270 ? 'W' : String(v / 10).padStart(2, '0');
          ctx.fillText(lbl, x - ctx.measureText(lbl).width / 2, ty - 18);
        }
      }
      ctx.beginPath(); ctx.moveTo(cx, ty + 2); ctx.lineTo(cx - 6, ty + 10); ctx.lineTo(cx + 6, ty + 10); ctx.closePath(); ctx.fill();
      ctx.fillText(String(Math.round(hdg)).padStart(3, '0'), cx - 12, ty + 22);
    }

    // ---------------- boresight (waterline) marker
    ctx.strokeStyle = HUD;
    ctx.beginPath();
    ctx.moveTo(cx - 34, cy); ctx.lineTo(cx - 14, cy); ctx.lineTo(cx - 7, cy + 8); ctx.lineTo(cx, cy); ctx.lineTo(cx + 7, cy + 8); ctx.lineTo(cx + 14, cy); ctx.lineTo(cx + 34, cy);
    ctx.stroke();

    // ---------------- flight path marker (prograde) and retrograde
    const vref = _v.copy(sim.nearGround || sim.density > 1e-7 ? sim.vSurf : _e.subVectors(s.vel, dom.vel));
    const p = { x: 0, y: 0 };
    if (vref.lengthSq() > 1 && !s.landed) {
      vref.normalize();
      if (w.projectDir(vref, p)) {
        const x = p.x, y = p.y;
        ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2);
        ctx.moveTo(x - 7, y); ctx.lineTo(x - 18, y); ctx.moveTo(x + 7, y); ctx.lineTo(x + 18, y); ctx.moveTo(x, y - 7); ctx.lineTo(x, y - 14);
        ctx.stroke();
      }
      vref.negate();
      if (w.projectDir(vref, p)) {
        const x = p.x, y = p.y;
        ctx.strokeStyle = WARN;
        ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2); ctx.moveTo(x - 5, y - 5); ctx.lineTo(x + 5, y + 5); ctx.moveTo(x + 5, y - 5); ctx.lineTo(x - 5, y + 5); ctx.stroke();
        ctx.strokeStyle = HUD;
      }
    }

    // ---------------- target designator
    const tgt = this.target();
    if (tgt && tgt.system === sim.system) {
      const d = tgt.pos.distanceTo(s.pos) - (tgt.isStation ? 0 : tgt.radius);
      const vis = w.project(tgt.pos, p) && p.x > 20 && p.x < W - 20 && p.y > 20 && p.y < H - 20;
      ctx.strokeStyle = WARN; ctx.fillStyle = WARN; ctx.shadowColor = WARN;
      if (vis) {
        const r = 16, k = 6;
        ctx.beginPath();
        for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
          ctx.moveTo(p.x + sx * r, p.y + sy * (r - k)); ctx.lineTo(p.x + sx * r, p.y + sy * r); ctx.lineTo(p.x + sx * (r - k), p.y + sy * r);
        }
        ctx.stroke();
        ctx.fillText(`${tgt.name.toUpperCase()}  ${fmtDist(d)}`, p.x + 22, p.y - 10);
      } else {
        // off-screen: arrow around the boresight pointing toward the target
        _v.subVectors(tgt.pos, s.pos).applyQuaternion(camInv);
        const a = Math.atan2(-_v.y, _v.x);
        const R = 120;
        const ax = cx + Math.cos(a) * R, ay = cy + Math.sin(a) * R;
        ctx.save(); ctx.translate(ax, ay); ctx.rotate(a);
        ctx.beginPath(); ctx.moveTo(14, 0); ctx.lineTo(-6, -9); ctx.lineTo(-2, 0); ctx.lineTo(-6, 9); ctx.closePath(); ctx.fill();
        ctx.restore();
        ctx.fillText(`${tgt.name.toUpperCase()} ${fmtDist(d)}`, ax + (Math.cos(a) > 0 ? 18 : -150), ay + 18);
      }
      ctx.strokeStyle = HUD; ctx.fillStyle = HUD; ctx.shadowColor = HUD;
    }

    // ---------------- targeted ship: corner brackets with name, range and closing speed
    const tn = this.getNpc();
    if (tn && sim.traffic.npcs.includes(tn)) {
      const d = tn.pos.distanceTo(s.pos);
      const closing = -_sv.subVectors(s.vel, tn.vel).dot(_v.subVectors(s.pos, tn.pos).normalize());
      const txt = `${tn.name.toUpperCase()}  ${fmtDist(d)}  ${closing >= 0 ? 'CLOSING' : 'OPENING'} ${fmtSpeed(Math.abs(closing))}`;
      const vis = w.project(tn.pos, p) && p.x > 20 && p.x < W - 20 && p.y > 20 && p.y < H - 20;
      const NC = '#ff9f43';
      ctx.strokeStyle = NC; ctx.fillStyle = NC; ctx.shadowColor = NC;
      if (vis) {
        const r = 14, k = 6;
        ctx.beginPath();
        for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
          ctx.moveTo(p.x + sx * r, p.y + sy * (r - k)); ctx.lineTo(p.x + sx * r, p.y + sy * r); ctx.lineTo(p.x + sx * (r - k), p.y + sy * r);
        }
        ctx.stroke();
        ctx.fillText(txt, p.x + 20, p.y - 10);
      } else {
        _v.subVectors(tn.pos, s.pos).applyQuaternion(camInv);
        const a = Math.atan2(-_v.y, _v.x), R = 130;
        const ax = cx + Math.cos(a) * R, ay = cy + Math.sin(a) * R;
        ctx.save(); ctx.translate(ax, ay); ctx.rotate(a);
        ctx.beginPath(); ctx.moveTo(14, 0); ctx.lineTo(-6, -9); ctx.lineTo(-2, 0); ctx.lineTo(-6, 9); ctx.closePath(); ctx.fill();
        ctx.restore();
        ctx.fillText(txt, ax + (Math.cos(a) > 0 ? 18 : -230), ay + 18);
      }
      ctx.strokeStyle = HUD; ctx.fillStyle = HUD; ctx.shadowColor = HUD;
    }

    // ---------------- landing site (amber diamond on the surface; arrow when off-screen)
    const site = this.getSite();
    const sb = site?.body;
    if (site && sb && sb === tgt && sb.system === sim.system && s.pos.distanceTo(sb.pos) < sb.radius * 60 && !(s.landed === sb && sim.landedSite === site)) {
      const P = sitePos(site, sim.t, _sp);
      const vis = w.project(P, p) && p.x > 20 && p.x < W - 20 && p.y > 20 && p.y < H - 20;
      const SC = '#ffd36b';
      ctx.strokeStyle = SC; ctx.fillStyle = SC; ctx.shadowColor = SC;
      const ground = siteDistance(site, _sv.subVectors(s.pos, sb.pos).applyQuaternion(sb.orientation(sim.t, _sq).invert()).normalize());
      const txt = `SITE ${site.label}  ${fmtDist(ground)}`;
      if (vis) {
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(p.x, p.y - 10); ctx.lineTo(p.x + 10, p.y); ctx.lineTo(p.x, p.y + 10); ctx.lineTo(p.x - 10, p.y); ctx.closePath(); ctx.stroke();
        ctx.beginPath(); ctx.arc(p.x, p.y, 2, 0, Math.PI * 2); ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.fillText(txt, p.x + 16, p.y + 4);
      } else {
        _v.subVectors(P, s.pos).applyQuaternion(camInv);
        const a = Math.atan2(-_v.y, _v.x), R = 145;
        const ax = cx + Math.cos(a) * R, ay = cy + Math.sin(a) * R;
        ctx.save(); ctx.translate(ax, ay); ctx.rotate(a);
        ctx.beginPath(); ctx.moveTo(12, 0); ctx.lineTo(0, -8); ctx.lineTo(-12, 0); ctx.lineTo(0, 8); ctx.closePath(); ctx.stroke();
        ctx.restore();
        ctx.fillText(txt, ax + (Math.cos(a) > 0 ? 16 : -130), ay + 18);
      }
      ctx.strokeStyle = HUD; ctx.fillStyle = HUD; ctx.shadowColor = HUD;
    }

    // ---------------- jump vector (drive armed): point here and burn at full power
    if (sim.jumpArmed) {
      const JV = '#c9a8ff';
      ctx.strokeStyle = JV; ctx.fillStyle = JV; ctx.shadowColor = JV;
      const dir = sim.jumpDir(sim.jumpArmed, _e);
      if (w.projectDir(dir, p) && p.x > 30 && p.x < W - 30 && p.y > 30 && p.y < H - 30) {
        const r = 18 + 6 * Math.sin(this.t * 5) * sim.jumpCharge;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.stroke();
        for (const a of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
          ctx.beginPath(); ctx.moveTo(p.x + Math.cos(a) * (r + 4), p.y + Math.sin(a) * (r + 4)); ctx.lineTo(p.x + Math.cos(a) * (r + 12), p.y + Math.sin(a) * (r + 12)); ctx.stroke();
        }
        if (sim.jumpCharge > 0) { ctx.beginPath(); ctx.arc(p.x, p.y, r + 16, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * sim.jumpCharge); ctx.stroke(); }
        ctx.lineWidth = 1.5;
        ctx.fillText(`JUMP · ${sim.jumpArmed.name.toUpperCase()}`, p.x + r + 16, p.y - r);
      } else {
        _v.copy(dir).applyQuaternion(camInv);
        const a = Math.atan2(-_v.y, _v.x), R = 170;
        const ax = cx + Math.cos(a) * R, ay = cy + Math.sin(a) * R;
        ctx.save(); ctx.translate(ax, ay); ctx.rotate(a);
        ctx.beginPath(); ctx.moveTo(18, 0); ctx.lineTo(0, -11); ctx.lineTo(0, 11); ctx.closePath(); ctx.fill();
        ctx.restore();
        ctx.fillText('TURN TO JUMP VECTOR', ax - 70, ay + 24);
      }
      ctx.strokeStyle = HUD; ctx.fillStyle = HUD; ctx.shadowColor = HUD;
    }

    // ---------------- manual-flight steering cue (autopilot off)
    if (tgt && !sim.ap.active) {
      const gd = guidance(sim, tgt, this.gd, this.getSite());
      if (gd) this.drawCue(gd, cx, cy, W, H);
    }

    // ---------------- speed / altitude tapes
    const spd = sim.nearGround || s.landed || sim.density > 1e-7 ? sim.vSurf.length() : _e.subVectors(s.vel, dom.vel).length();
    const radar = sim.nearGround && sim.radarAlt < 40000;
    const alt = radar ? sim.radarAlt : sim.altitude;
    this.box(cx - side, cy, 'SPD', fmtSpeed(spd), radar ? 'SURF' : `REL ${dom.name.toUpperCase()}`);
    this.box(cx + side - 80, cy, radar ? 'RALT' : 'ALT', s.docked ? 'DOCKED' : s.landed ? 'LANDED' : fmtDist(alt), `VS ${sim.vertSpeed >= 0 ? '+' : ''}${fmtSpeed(sim.vertSpeed)}`);

    // ---------------- bottom-left block: thrust, g, fuel, autopilot
    const econ = sim.econ;
    const thr = s.thrustAccel.length();
    const lines = [
      `THR ${(thr / G_EARTH).toFixed(2)} g / ${((sim.ap.active ? sim.ap.accel : s.maxAccel) / G_EARTH).toFixed(1)} g`,
      `FUEL ${econ.fuel.toFixed(2)} t  ${(econ.fuelFrac * 100).toFixed(0)}%`,
      `WARP ${sim.effWarp < 1.05 ? '1' : sim.effWarp.toFixed(0)}×`,
      sim.ap.active ? `AP ${sim.ap.status.toUpperCase()}` : 'AP OFF',
    ];
    if (sim.mining && s.landed) lines.push(`MINING ${sim.landedSite ? 'DEPOSIT ' + sim.landedSite.label : 'REGOLITH'} ${econ.mineRate(s.landed, sim.landedSite).toFixed(1)} t/h  HOLD ${econ.cargoUsed}/${econ.ship.cargo} t`);
    const o = sim.orbit;
    if (o && !s.landed) lines.push(`PE ${fmtDist(o.rp - dom.radius)}  AP ${o.bound ? fmtDist(o.ra - dom.radius) : 'ESC'}${o.bound ? '  T ' + fmtTime(o.period) : ''}`);
    lines.forEach((l, i) => ctx.fillText(l, cx - side, cy + 70 + i * 18));

    // ---------------- warnings
    const warns: string[] = [];
    if (sim.nearGround && sim.radarAlt < 600 && sim.vertSpeed < -40 && !s.landed) warns.push('PULL UP');
    if (sim.nearGround && !s.landed && !sim.gearDown && sim.radarAlt < 1000 && sim.vertSpeed < -2) warns.push('GEAR UP');
    if (sim.heat > 6e5) warns.push('HEATING');
    if (econ.fuelFrac < 0.1) warns.push('FUEL LOW');
    if (sim.dynPressure > 60000) warns.push('MAX Q');
    if (warns.length && Math.floor(this.t * 3) % 2 === 0) {
      ctx.fillStyle = WARN; ctx.shadowColor = WARN;
      ctx.font = '700 22px "Share Tech Mono", monospace';
      warns.forEach((wn, i) => ctx.fillText(wn, cx - ctx.measureText(wn).width / 2, cy + 90 + i * 26));
    }
    ctx.restore();

    this.screenTimer -= dt;
    if (this.screenTimer <= 0) { this.screenTimer = 0.1; this.drawScreens(pitch, roll, nearBody); }
  }

  private gd: Guidance = { dir: new Vector3(), dv: 0, state: 'coast', error: 0 };

  /** steering cue: point the nose at the diamond and burn (W) until it says COAST */
  private drawCue(gd: Guidance, cx: number, cy: number, W: number, H: number) {
    const ctx = this.ctx, p = { x: 0, y: 0 };
    const CUE = '#ff6bff';
    ctx.strokeStyle = CUE; ctx.fillStyle = CUE; ctx.shadowColor = CUE;
    const txt = gd.state === 'hold' ? 'ON STATION' : gd.state === 'coast' ? 'ON COURSE · COAST'
      : `${gd.state === 'brake' ? 'BRAKE' : 'BURN'} ${fmtSpeed(gd.dv)}${gd.error < 0.05 ? ' · ALIGNED — THRUST (W)' : ''}`;
    if (gd.state === 'hold' || gd.state === 'coast') {
      ctx.fillText(txt, cx - ctx.measureText(txt).width / 2, cy + 46);
      ctx.strokeStyle = HUD; ctx.fillStyle = HUD; ctx.shadowColor = HUD;
      return;
    }
    const on = this.world.projectDir(gd.dir, p) && p.x > 30 && p.x < W - 30 && p.y > 30 && p.y < H - 30;
    if (on) {
      const r = 11;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(p.x, p.y - r); ctx.lineTo(p.x + r, p.y); ctx.lineTo(p.x, p.y + r); ctx.lineTo(p.x - r, p.y); ctx.closePath(); ctx.stroke();
      ctx.beginPath(); ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2); ctx.fill();
      ctx.lineWidth = 1.5;
      // line from the boresight to the cue
      ctx.setLineDash([4, 6]); ctx.globalAlpha = 0.6;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(p.x, p.y); ctx.stroke();
      ctx.setLineDash([]); ctx.globalAlpha = 1;
      ctx.fillText(txt, p.x + 16, p.y + 16);
    } else {
      const camInv = _q.copy(this.world.camQuat).invert();
      _v.copy(gd.dir).applyQuaternion(camInv);
      const a = Math.atan2(-_v.y, _v.x);
      const R = 150;
      const ax = cx + Math.cos(a) * R, ay = cy + Math.sin(a) * R;
      ctx.save(); ctx.translate(ax, ay); ctx.rotate(a);
      ctx.beginPath(); ctx.moveTo(16, 0); ctx.lineTo(0, -10); ctx.lineTo(0, 10); ctx.closePath(); ctx.fill();
      ctx.restore();
      const t2 = `TURN TO CUE · ${txt}`;
      ctx.fillText(t2, Math.min(W - ctx.measureText(t2).width - 10, Math.max(10, ax + (Math.cos(a) > 0 ? 20 : -ctx.measureText(t2).width - 20))), ay + 20);
    }
    ctx.strokeStyle = HUD; ctx.fillStyle = HUD; ctx.shadowColor = HUD;
  }

  private box(x: number, y: number, label: string, value: string, sub: string) {
    const ctx = this.ctx;
    ctx.font = '600 11px "Share Tech Mono", monospace';
    ctx.fillStyle = HUD_DIM; ctx.fillText(label, x, y - 22);
    ctx.strokeStyle = HUD; ctx.strokeRect(x - 6, y - 13, 92, 26);
    ctx.font = '600 15px "Share Tech Mono", monospace';
    ctx.fillStyle = HUD; ctx.fillText(value, x, y);
    ctx.font = '600 11px "Share Tech Mono", monospace';
    ctx.fillStyle = HUD_DIM; ctx.fillText(sub, x, y + 24);
    ctx.font = '600 13px "Share Tech Mono", monospace';
    ctx.fillStyle = HUD;
  }

  /** dashboard displays */
  private drawScreens(pitch: number, roll: number, nearBody: boolean) {
    const sim = this.sim, econ = sim.econ, s = sim.ship;
    // attitude repeater
    {
      const c = this.attCanvas.getContext('2d')!, W = c.canvas.width, H = c.canvas.height;
      c.fillStyle = '#02060c'; c.fillRect(0, 0, W, H);
      c.save(); c.translate(W / 2, H / 2); c.rotate(-roll);
      const off = nearBody ? pitch / DEG * 4 : 0;
      c.fillStyle = nearBody ? '#1e5a8f' : '#0a1426'; c.fillRect(-W, -H * 2 + off, W * 2, H * 2);
      c.fillStyle = nearBody ? '#5a3c1e' : '#0a1426'; c.fillRect(-W, off, W * 2, H * 2);
      c.strokeStyle = '#ffffff'; c.lineWidth = 3;
      c.beginPath(); c.moveTo(-W, off); c.lineTo(W, off); c.stroke();
      c.lineWidth = 2; c.font = '20px monospace'; c.fillStyle = '#fff';
      for (let p = -60; p <= 60; p += 10) {
        if (!p) continue;
        const y = off - p * 4;
        c.beginPath(); c.moveTo(-40, y); c.lineTo(40, y); c.stroke();
        c.fillText(String(p), 48, y + 6);
      }
      c.restore();
      c.strokeStyle = '#ffd36b'; c.lineWidth = 5;
      c.beginPath(); c.moveTo(W / 2 - 90, H / 2); c.lineTo(W / 2 - 30, H / 2); c.lineTo(W / 2 - 15, H / 2 + 15);
      c.moveTo(W / 2 + 90, H / 2); c.lineTo(W / 2 + 30, H / 2); c.lineTo(W / 2 + 15, H / 2 + 15); c.stroke();
      c.fillStyle = '#7dffb0'; c.font = '600 22px monospace';
      c.fillText(nearBody ? `ATTITUDE · ${sim.dominant.name.toUpperCase()}` : 'ATTITUDE · INERTIAL', 16, 30);
    }
    // ship status
    {
      const c = this.statusCanvas.getContext('2d')!, W = c.canvas.width, H = c.canvas.height;
      c.fillStyle = '#02060c'; c.fillRect(0, 0, W, H);
      c.fillStyle = '#7dffb0'; c.font = '600 24px monospace';
      c.fillText(`${econ.ship.name.toUpperCase()} · SHIP STATUS`, 16, 32);
      const bar = (y: number, label: string, f: number, txt: string, col: string) => {
        c.fillStyle = '#7dffb0'; c.font = '600 20px monospace'; c.fillText(label, 16, y);
        c.strokeStyle = '#2f6f4a'; c.lineWidth = 2; c.strokeRect(16, y + 10, W - 32, 26);
        c.fillStyle = col; c.fillRect(18, y + 12, (W - 36) * Math.max(0, Math.min(1, f)), 22);
        c.fillStyle = '#e8fff0'; c.fillText(txt, W - 16 - c.measureText(txt).width, y);
      };
      bar(80, 'FUEL', econ.fuelFrac, `${econ.fuel.toFixed(2)} / ${econ.ship.fuelCap} t`, econ.fuelFrac < 0.15 ? '#ff6b6b' : '#ffb347');
      bar(150, 'CARGO', econ.cargoUsed / econ.ship.cargo, `${econ.cargoUsed} / ${econ.ship.cargo} t`, '#5fe3ff');
      bar(220, 'HULL TEMP', Math.min(1, sim.heat / 2e6), sim.heat > 1e5 ? `${(sim.heat / 1e6).toFixed(1)} MW/m²` : 'NOMINAL', '#ff8a4a');
      c.fillStyle = '#7dffb0'; c.font = '600 20px monospace';
      c.fillText(`CREDITS ${Math.round(econ.credits).toLocaleString('en-US')}`, 16, 300);
      const gear = `GEAR ${sim.gearCmd.toUpperCase()} · ${sim.gearDown ? 'DOWN' : 'UP'}`;
      c.fillStyle = sim.gearDown ? '#7dffb0' : '#ffb347';
      c.fillText(gear, W - 16 - c.measureText(gear).width, 300);
      c.fillStyle = '#7dffb0';
      c.fillText(s.docked ? `DOCKED · ${s.docked.name.toUpperCase()}` : s.landed ? `LANDED · ${s.landed.name.toUpperCase()}` : `MASS ×${econ.massFactor.toFixed(2)}`, 16, 336);
    }
  }
}

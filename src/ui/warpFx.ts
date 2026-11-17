import { Vector3 } from 'three';
import { Sim } from '../sim/sim';
import type { World } from '../render/world';

interface Star { x: number; y: number; z: number; hue: number; }

const _d = new Vector3();

/**
 * Jump transit effect: once the drive fires, stars stream out of the jump point and accelerate
 * into long streaks while the view widens, then the screen whites out; the ship arrives at the
 * peak of the flash and the streaks slow and fade as the flash clears over the new system.
 */
export class WarpFx {
  private canvas = document.getElementById('warpfx') as HTMLCanvasElement;
  private ctx = this.canvas.getContext('2d')!;
  private flash = document.getElementById('flash') as HTMLElement;
  private stars: Star[] = [];
  /** seconds since arrival (-1 = not arriving) */
  private after = -1;
  private fx = 0; private fy = 0;
  private speed = 0;

  constructor(private sim: Sim, private world: World) {
    for (let i = 0; i < 900; i++) this.stars.push(this.spawn(Math.random()));
  }

  private spawn(z = 1): Star {
    // spread across a disc, denser towards the edges so the tunnel reads as a tunnel
    const a = Math.random() * Math.PI * 2, r = 0.08 + Math.sqrt(Math.random()) * 1.4;
    return { x: Math.cos(a) * r, y: Math.sin(a) * r, z: Math.max(0.05, z), hue: Math.random() };
  }

  /** the ship has arrived (called at the jump): the flash peaks and the streaks wind down */
  arrive() { this.after = 0; }

  update(dt: number) {
    const sim = this.sim, T = Sim.JUMP_TRANSIT_S;
    const inTransit = sim.jumpTransit > 0;
    const p = inTransit ? Math.min(1, sim.jumpTransit / T) : 0;
    if (this.after >= 0) this.after += dt;
    if (this.after > 2) this.after = -1;
    const arriving = this.after >= 0;
    const W = window.innerWidth, H = window.innerHeight;
    const c = this.canvas;
    if (!inTransit && !arriving) {
      if (c.style.display !== 'none') { c.style.display = 'none'; this.flash.style.opacity = '0'; }
      return;
    }
    c.style.display = 'block';
    const dpr = Math.min(window.devicePixelRatio, 1.5);
    if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    // stream out of the jump point (screen centre when it is off-screen)
    if (inTransit && sim.jumpArmed) {
      const pt = { x: W / 2, y: H / 2 };
      if (this.world.projectDir(sim.jumpDir(sim.jumpArmed, _d), pt) && pt.x > 0 && pt.x < W && pt.y > 0 && pt.y < H) { this.fx = pt.x; this.fy = pt.y; }
      else { this.fx = W / 2; this.fy = H / 2; }
    } else if (!inTransit && this.after < 0.05) { this.fx = W / 2; this.fy = H / 2; }

    // speed: a gentle start that runs away exponentially; after arrival it bleeds off quickly
    const target = inTransit ? 0.15 + 5.5 * p * p * p : 2.2 * Math.exp(-this.after * 3.2);
    this.speed += (target - this.speed) * Math.min(1, dt * (inTransit ? 6 : 10));
    const alpha = inTransit ? Math.min(1, p / 0.18) : Math.max(0, 1 - this.after / 1.1);
    const K = Math.max(W, H) * 0.32;

    // darken the scene into a tunnel, with a violet-blue glow at the vanishing point
    const vg = ctx.createRadialGradient(this.fx, this.fy, 0, this.fx, this.fy, Math.max(W, H) * 0.75);
    vg.addColorStop(0, `rgba(150,170,255,${0.35 * alpha * (inTransit ? p : 1)})`);
    vg.addColorStop(0.25, `rgba(40,30,90,${0.25 * alpha})`);
    vg.addColorStop(1, `rgba(0,0,8,${0.55 * alpha})`);
    ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);

    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    const trail = Math.min(0.7, this.speed * 0.09);
    for (const st of this.stars) {
      st.z -= this.speed * dt;
      if (st.z <= 0.03) { Object.assign(st, this.spawn(1)); continue; }
      const z1 = st.z, z0 = Math.min(1.2, st.z + trail + 0.004);
      const x1 = this.fx + st.x / z1 * K, y1 = this.fy + st.y / z1 * K;
      const x0 = this.fx + st.x / z0 * K, y0 = this.fy + st.y / z0 * K;
      if ((x1 < -50 || x1 > W + 50 || y1 < -50 || y1 > H + 50) && (x0 < -50 || x0 > W + 50 || y0 < -50 || y0 > H + 50)) continue;
      const near = 1 - Math.min(1, z1);
      const a = alpha * (0.25 + 0.75 * near);
      // white core with a blue or violet tint
      const r = st.hue < 0.5 ? 170 + 85 * near : 200, g = st.hue < 0.5 ? 200 + 55 * near : 160 + 60 * near, b = 255;
      ctx.strokeStyle = `rgba(${r | 0},${g | 0},${b},${a.toFixed(3)})`;
      ctx.lineWidth = 0.6 + 2.4 * near * near;
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';

    // the view widens as the ship accelerates (the world eases it back after arrival)
    if (inTransit) this.world.jumpFx = Math.max(this.world.jumpFx, 0.85 * p * p);

    // white-out at the moment of the jump, clearing over the new system
    const f = inTransit ? Math.max(0, (p - 0.7) / 0.3) ** 1.5 : this.after < 0.15 ? 1 : Math.max(0, 1 - (this.after - 0.15) / 1.3);
    this.flash.style.opacity = f.toFixed(3);
  }
}

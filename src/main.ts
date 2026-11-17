import './ui/style.css';
import { Sim, THRUST_LEVELS } from './sim/sim';
import { World } from './render/world';
import { Hud } from './ui/hud';
import { Sound } from './audio/sound';
import { WarpFx } from './ui/warpFx';
import { confirmClick } from './ui/confirm';

const canvas = document.getElementById('view') as HTMLCanvasElement;
// (checked before the sim starts: starting a fresh career docks at Gateway and writes a save)
const hadSave = (() => { try { return !!localStorage.getItem('stellardrift.save.v1'); } catch { return false; } })();
const sim = new Sim();
const world = new World(canvas, sim);
const hud = new Hud(sim, world);
const sound = new Sound(sim);
// jump transit: accelerating star streaks, then the flash; arrival winds them down
const warpFx = new WarpFx(sim, world);
sim.onJumpStart = () => sound.warpIn(Sim.JUMP_TRANSIT_S);
sim.onCrash = () => {
  sound.crash();
  const f = document.getElementById('crashfx')!; f.classList.remove('go'); void f.offsetWidth; f.classList.add('go');
  world.shakeKick = 1;
};
{ const arrived = sim.onJump; sim.onJump = (a, b) => { arrived(a, b); warpFx.arrive(); }; }
{
  const btn = document.getElementById('btnSound')!;
  const show = () => { btn.classList.toggle('active', sound.enabled); btn.textContent = sound.enabled ? 'SOUND' : 'MUTED'; };
  show();
  btn.addEventListener('click', () => { sound.toggle(); show(); });
  document.addEventListener('keydown', e => { if (e.code === 'KeyP' && started) { sound.toggle(); show(); } });
  // every message gets an audible cue
  const toast = hud.toast.bind(hud);
  hud.toast = (m, k = 'info') => { sound.alert(k); toast(m, k); };
}
// first suggested trade run: Gateway → Tranquility Hub (lunar helium-3 sells well back at Earth)
{
  const docked = sim.ship.docked;
  const suggest = docked?.id === 'st_gateway' ? sim.system.byId.get('st_tranquility') : docked ? null : sim.system.byId.get('earth');
  if (suggest) hud.select(suggest);
}
if (hadSave) {
  document.getElementById('newGame')!.classList.remove('hidden');
  document.getElementById('start')!.textContent = 'CONTINUE CAREER';
}
/** set while starting a new career: nothing may save the old ship's whereabouts over the wiped save */
let resetting = false;
// new career: offer to save the current one to a file first
{
  const show = (on: boolean) => {
    document.getElementById('newChoice')!.classList.toggle('hidden', !on);
    for (const id of ['start', 'newGame']) document.getElementById(id)!.classList.toggle('hidden', on);
  };
  document.getElementById('newGame')!.addEventListener('click', () => { document.getElementById('ncMsg')!.textContent = ''; show(true); });
  document.getElementById('ncCancel')!.addEventListener('click', () => show(false));
  document.getElementById('ncSave')!.addEventListener('click', () => {
    const name = exportCareer();
    document.getElementById('ncMsg')!.textContent = name ? `Saved as ${name} (check your downloads).` : 'Browser storage is unavailable — nothing to save.';
  });
  document.getElementById('ncErase')!.addEventListener('click', () => {
    if (!confirmClick(document.getElementById('ncErase') as HTMLButtonElement, 'CLICK AGAIN TO ERASE')) return;
    resetting = true;
    sim.econ.reset();
    location.reload();
  });
}
window.addEventListener('beforeunload', () => { if (!resetting) sim.saveGame(); });

// ---------------------------------------------------------------- export / import the career (help panel)
const SAVE_PREFIX = 'stellardrift.';
/** download the career as a .json file; returns the file name (null if storage is unavailable) */
function exportCareer(): string | null {
  sim.saveGame();
  const data: Record<string, string> = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)!;
      if (k.startsWith(SAVE_PREFIX)) data[k] = localStorage.getItem(k)!;
    }
  } catch { return null; }
  const file = { game: 'stellar-drift', version: 1, exported: new Date().toISOString(), data };
  const now = new Date(), p2 = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}-${p2(now.getMonth() + 1)}-${p2(now.getDate())}-${p2(now.getHours())}${p2(now.getMinutes())}`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(file, null, 1)], { type: 'application/json' }));
  a.download = `stellar-drift-career-${stamp}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  return a.download;
}
document.getElementById('saveExport')!.addEventListener('click', () => {
  if (!exportCareer()) { hud.toast('Browser storage is unavailable — nothing to export', 'warn'); return; }
  hud.toast(`Career exported: ${Math.round(sim.econ.credits).toLocaleString('en-US')} cr, ${sim.econ.ship.name}`, 'good');
});
const importBtn = document.getElementById('saveImport') as HTMLButtonElement;
const fileIn = document.getElementById('saveFile') as HTMLInputElement;
importBtn.addEventListener('click', () => {
  if (!confirmClick(importBtn, 'REPLACES THIS CAREER — CLICK AGAIN')) return;
  fileIn.value = '';
  fileIn.click();
});
fileIn.addEventListener('change', async () => {
  const f = fileIn.files?.[0];
  if (!f) return;
  try {
    const file = JSON.parse(await f.text()) as { game?: string; data?: Record<string, unknown> };
    const data = file.data;
    const main = data?.['stellardrift.save.v1'];
    const career = typeof main === 'string' ? JSON.parse(main) as { credits?: unknown; ship?: unknown } : null;
    if (file.game !== 'stellar-drift' || !data || !career || typeof career.credits !== 'number' || typeof career.ship !== 'string')
      throw new Error('not a Stellar Drift career file');
    // nothing may save the current career over the imported one on the way out
    resetting = true;
    for (const k of Object.keys(localStorage)) if (k.startsWith(SAVE_PREFIX)) localStorage.removeItem(k);
    for (const [k, v] of Object.entries(data)) if (k.startsWith(SAVE_PREFIX) && typeof v === 'string') localStorage.setItem(k, v);
    hud.toast(`Career loaded from ${f.name} — restarting…`, 'good');
    setTimeout(() => location.reload(), 600);
  } catch (err) {
    resetting = false;
    hud.toast(`Couldn't import ${f.name}: ${(err as Error).message}`, 'warn');
  }
});
// autosave the ship's whereabouts now and then (a crash or reload then resumes where you were)
setInterval(() => { if (started && !resetting) sim.saveGame(); }, 20000);

// ---------------------------------------------------------------- input
const keys = new Set<string>();
let started = false;
let steer: { x: number; y: number } | null = null;
let steerX = 0, steerY = 0;
let orbitCam: { x: number; y: number } | null = null;

window.addEventListener('keydown', e => {
  if (!started || e.repeat && !['Equal', 'Minus'].includes(e.code)) { keys.add(e.code); return; }
  keys.add(e.code);
  const s = sim.ship;
  switch (e.code) {
    case 'Comma': sim.setWarpIndex(-1); break;
    case 'Period': sim.setWarpIndex(1); break;
    case 'Slash': sim.warp = 1; if (sim.ap.active) sim.ap.autoWarp = false; e.preventDefault(); break;
    case 'Equal': case 'NumpadAdd': s.thrustLevel = Math.min(THRUST_LEVELS.length - 1, s.thrustLevel + 1); break;
    case 'Minus': case 'NumpadSubtract': s.thrustLevel = Math.max(0, s.thrustLevel - 1); break;
    case 'KeyV': hud.toggleView(); break;
    case 'KeyM': hud.map.toggle(); break;
    case 'KeyO': hud.toggleOrbits(); break;
    case 'KeyH': document.getElementById('help')!.classList.toggle('hidden'); break;
    case 'KeyG': hud.cmdOrbit(); break;
    case 'KeyL': hud.cmdLand(); break;
    case 'KeyC': hud.cmdCirc(); break;
    case 'KeyJ': hud.cmdJump(); break;
    case 'KeyX': sim.ap.disengage('Autopilot disengaged'); break;
    case 'KeyT': hud.toggleStation(); break;
    case 'KeyN': hud.toggleNav(); break;
    case 'KeyK': sim.toggleMining(); break;
    case 'KeyB': hud.scope.mode = hud.scope.mode === 'radar' ? 'from' : hud.scope.mode === 'from' ? 'to' : 'radar';
      for (const [id, m] of [['scRadar', 'radar'], ['scFrom', 'from'], ['scTo', 'to']]) document.getElementById(id)!.classList.toggle('active', hud.scope.mode === m);
      break;
    case 'KeyU': hud.cmdUndock(); break;
    case 'KeyY': sim.cycleGear(); break;
    case 'KeyI': hud.cargo.toggle(); break;
    case 'KeyZ': hud.career.toggle(); break;
    case 'Escape': hud.map.toggle(false); hud.station.show(false); hud.cargo.toggle(false); hud.career.toggle(false); break;
  }
  if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
});
window.addEventListener('keyup', e => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());

canvas.addEventListener('contextmenu', e => e.preventDefault());
canvas.addEventListener('pointerdown', e => {
  canvas.setPointerCapture(e.pointerId);
  if (e.button === 0) { steer = { x: e.clientX, y: e.clientY }; steerX = steerY = 0; }
  else orbitCam = { x: e.clientX, y: e.clientY };
});
canvas.addEventListener('pointermove', e => {
  if (steer) {
    steerX = Math.max(-1, Math.min(1, (e.clientX - steer.x) / 160));
    steerY = Math.max(-1, Math.min(1, (e.clientY - steer.y) / 160));
  }
  if (orbitCam) {
    world.camYaw -= (e.clientX - orbitCam.x) * 0.006;
    world.camPitch = Math.max(-1.4, Math.min(1.4, world.camPitch + (e.clientY - orbitCam.y) * 0.006));
    orbitCam.x = e.clientX; orbitCam.y = e.clientY;
  }
});
const release = () => { steer = null; steerX = steerY = 0; orbitCam = null; };
canvas.addEventListener('pointerup', release);
canvas.addEventListener('pointercancel', release);
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  const L = world.ship.length;
  world.camDist = Math.max(L * 1.1, Math.min(L * 80, world.camDist * Math.exp(e.deltaY * 0.0012)));
}, { passive: false });

function readInput() {
  const s = sim.ship, k = (c: string) => (keys.has(c) ? 1 : 0);
  s.thrustInput.set(k('KeyD') - k('KeyA'), k('KeyR') - k('KeyF'), k('KeyS') - k('KeyW'));
  s.rotInput.set(
    k('ArrowUp') - k('ArrowDown') - steerY,   // pitch
    k('ArrowLeft') - k('ArrowRight') - steerX, // yaw
    k('KeyQ') - k('KeyE'),                     // roll
  );
  // any manual thrust takes control back from the autopilot
  if (sim.ap.active && sim.ap.mode !== 'align' && s.thrustInput.lengthSq() > 0) sim.ap.disengage('Manual control — autopilot disengaged');
}

// top bar ✕ EXIT: confirm, save, and go to the home page
{
  const btn = document.getElementById('btnExit') as HTMLButtonElement;
  btn.addEventListener('click', () => {
    if (!confirmClick(btn, 'CONFIRM EXIT', 4000)) return;
    if (!resetting) sim.saveGame();
    location.href = 'home/index.html';
  });
}
// closing the intro dialog (✕ or Esc) is the same as continuing
document.getElementById('introClose')!.addEventListener('click', () => document.getElementById('start')!.click());
window.addEventListener('keydown', e => {
  if (e.code === 'Escape' && !started && !document.getElementById('intro')!.classList.contains('hidden')) document.getElementById('start')!.click();
});
document.getElementById('start')!.addEventListener('click', () => {
  if (sim.econ.refundedOnLoad > 0) {
    hud.toast(`Your hold was overfilled by a market bug — the excess was refunded: ${Math.round(sim.econ.refundedOnLoad).toLocaleString('en-US')} cr`, 'info');
    sim.econ.refundedOnLoad = 0;
  }
  started = true;
  hud.started = true;
  document.getElementById('intro')!.classList.add('hidden');
  // the station screen stays closed at start-up (STATION / T opens it); the controls help only
  // pops up for a brand-new career (H shows it any time)
  if (!hadSave) document.getElementById('help')!.classList.remove('hidden');
});

// ---------------------------------------------------------------- loop
let last = performance.now();
function loop(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (started) { readInput(); sim.frame(dt); }
  else { sim.system.update(sim.t); world.camYaw += dt * 0.03; }
  world.update(dt);
  hud.update(dt);
  sound.update(dt, started);
  warpFx.update(dt);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// handy for debugging from the console
Object.assign(window as object, { sim, world, hud, sound, warpFx });

if (import.meta.env.DEV && location.search.includes('auto')) setTimeout(() => document.getElementById('start')!.click(), 300);

if (import.meta.env.DEV) {
  /** dev helper: teleport into orbit around a body and frame it. __go('sol','mars', 3000) */
  Object.assign(window as object, {
    __go: async (sys: string, id: string, alt: number, yaw = 0.3, pitch = 0.1, dist = 120, el = 0, phase?: number, wait = 4000) => {
      if (!started) document.getElementById('start')!.click();
      world.view = 'chase';
      if (sim.system.id !== sys) sim.jumpTo(sim.universe.get(sys));
      world.jumpFx = 0;
      const b = sim.system.byId.get(id)!;
      hud.select(b); sim.ap.disengage(); sim.warp = 1;
      sim.placeInOrbit(b, b.radius + alt, phase);
      const V = sim.ship.pos.constructor as new () => typeof sim.ship.pos;
      if (el) {
        const rel = new V().subVectors(sim.ship.pos, b.pos); const r = rel.length(); rel.normalize();
        rel.multiplyScalar(Math.cos(el)).addScaledVector(b.isStar ? new V().set(0, 1, 0) : b.axis, Math.sin(el)).normalize();
        sim.ship.pos.copy(b.pos).addScaledVector(rel, r);
      }
      sim.lookAlong(new V().subVectors(b.pos, sim.ship.pos).normalize(), new V().set(0, 1, 0));
      Object.assign(world, { camYaw: yaw, camPitch: pitch, camDist: dist });
      document.getElementById('hud')!.style.visibility = 'hidden';
      document.getElementById('markers')!.style.visibility = 'hidden';
      if (wait) await new Promise(r => setTimeout(r, wait)); // (no frame may run mid-setup when chained)
      return 'ok';
    },
    /** dev helper: hover just above a body's surface, looking at the horizon */
    __hover: async (sys: string, id: string, alt: number, yaw = 0.4, pitch = -0.08, dist = 70, wait = 6000) => {
      const w = window as unknown as { __go: (...a: unknown[]) => Promise<string> };
      await w.__go(sys, id, alt, yaw, pitch, dist, 0, undefined, 0);
      const b = sim.system.byId.get(id)!;
      const V = sim.ship.pos.constructor as new () => typeof sim.ship.pos;
      const rel = new V().subVectors(sim.ship.pos, b.pos);
      const up = rel.clone().normalize();
      sim.ship.vel.copy(b.axis).multiplyScalar(b.rotRate).cross(rel).add(b.vel);
      sim.lookAlong(new V().crossVectors(up, b.axis).normalize(), up);
      await new Promise(r => setTimeout(r, wait));
      return 'ok';
    },
    __hud: (on = true) => {
      document.getElementById('hud')!.style.visibility = on ? '' : 'hidden';
      document.getElementById('markers')!.style.visibility = on ? '' : 'hidden';
    },
  });
}

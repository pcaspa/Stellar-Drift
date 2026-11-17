import { Quaternion, Vector3 } from 'three';

const _sP = new Vector3(), _sU = new Vector3(), _sV = new Vector3(), _sQ = new Quaternion();
import { AU_KM, G_EARTH } from '../data/types';
import { Sim, THRUST_LEVELS } from '../sim/sim';
import { Body, StarSystem, simTimeToDate } from '../sim/universe';
import type { World } from '../render/world';
import { fmtDist, fmtNum, fmtSpeed, fmtTime, fmtWarp } from './format';
import { SystemMap } from './map';
import { StationPanel } from './station';
import { Scope } from './scope';
import { CargoPanel } from './cargo';
import { CareerPanel } from './careerPanel';
import { confirmClick } from './confirm';
import { COMMODITIES } from '../data/commodities';
import { siteDistance, sitePos, siteUp, type Site } from '../sim/sites';
import { CockpitHud } from './cockpitHud';
import { guidance, Guidance } from '../sim/guidance';
import { Autopilot } from '../sim/autopilot';
import { ECONOMIES } from '../data/commodities';
import { ORE_LABEL } from '../data/asteroids';
import { SHIPS } from '../data/ships';
import type { Npc } from '../sim/npc';

const $ = (id: string) => document.getElementById(id)!;
const UI_KEY = 'stellardrift.ui';
function loadUiPrefs(): Record<string, boolean> {
  try { return JSON.parse(localStorage.getItem(UI_KEY) ?? '{}'); } catch { return {}; }
}
function saveUiPref(k: string, v: boolean) {
  try { const p = loadUiPrefs(); p[k] = v; localStorage.setItem(UI_KEY, JSON.stringify(p)); } catch { /* ignore */ }
}
const SURFACE_LABEL: Record<string, string> = {
  star: 'Star', gas: 'Gas giant', icegiant: 'Ice giant', rock: 'Rocky, airless', mars: 'Desert world', earth: 'Living world',
  terra: 'Temperate rocky world', ocean: 'Ocean world', ice: 'Icy world', lava: 'Lava world', titan: 'Hazy moon', venus: 'Greenhouse world', io: 'Volcanic moon',
};
const KIND_LABEL: Record<string, string> = { star: 'Star', planet: 'Planet', moon: 'Moon', dwarf: 'Dwarf planet', asteroid: 'Asteroid', comet: 'Comet', station: 'Space station' };

interface Marker { el: HTMLDivElement; label: HTMLSpanElement; dist: HTMLElement; body?: Body; sys?: StarSystem; prio: number; }

export class Hud {
  targetBody: Body | null = null;
  targetSystem: StarSystem | null = null;
  readonly map: SystemMap;
  private markers: Marker[] = [];
  private markerSys: StarSystem | null = null;
  private tab: 'system' | 'stars' = 'system';
  private navTimer = 0;
  private slow = 0;
  private pro = this.mkVec('vec'); private retro = this.mkVec('vec retro');
  private cue = this.mkVec('cue');
  private siteMk = this.mkVec('sitemk');
  private gd: Guidance = { dir: new Vector3(), dv: 0, state: 'coast', error: 0 };
  private p = { x: 0, y: 0 };
  private placed: { x: number; y: number }[] = [];

  constructor(private sim: Sim, private world: World) {
    this.map = new SystemMap(sim, () => this.targetBody, b => this.select(b), () => this.targetSystem, sys => {
      this.select(null, sys);
      if (this.tab !== 'stars') { this.tab = 'stars'; this.buildNav(); }
    });
    sim.onEvent = (m, k) => this.toast(m, k);
    sim.onJump = (_from, to) => {
      this.toast(`Arrived in the ${to.name} system`, 'good');
      if (to.def.uncharted) {
        const bonus = sim.econ.survey(to.id);
        if (bonus) this.toast(`First survey of uncharted ${to.name}! The Survey Office pays ${bonus.toLocaleString('en-US')} cr. Scan its asteroid belt for rare finds.`, 'good');
      }
      this.targetSystem = null; this.targetBody = null;
      this.tab = 'system'; this.buildNav(); this.refreshTarget();
      world.jumpFx = 1;
    };
    $('tabSystem').onclick = () => { this.tab = 'system'; this.buildNav(); };
    $('tabStars').onclick = () => { this.tab = 'stars'; this.buildNav(); };
    $('warpDown').onclick = () => sim.setWarpIndex(-1);
    $('warpUp').onclick = () => sim.setWarpIndex(1);
    $('warpReset').onclick = () => { sim.warp = 1; if (sim.ap.active) sim.ap.autoWarp = false; };
    $('btnMap').onclick = () => this.map.toggle();
    $('btnView').onclick = () => this.toggleView();
    $('btnOrbits').onclick = () => this.toggleOrbits();
    $('btnHelp').onclick = () => $('help').classList.toggle('hidden');
    $('apOrbit').onclick = () => this.cmdOrbit();
    $('apLand').onclick = () => this.cmdLand();
    $('apJump').onclick = () => this.cmdJump();
    $('apCirc').onclick = () => this.cmdCirc();
    $('apUndock').onclick = () => this.cmdUndock();
    // travel mode (remembered per browser)
    sim.ap.economy = !!loadUiPrefs().economy;
    const syncTravel = () => { $('trFast').classList.toggle('active', !sim.ap.economy); $('trEco').classList.toggle('active', sim.ap.economy); };
    const setTravel = (eco: boolean) => { sim.ap.economy = eco; saveUiPref('economy', eco); syncTravel(); };
    $('trFast').onclick = () => setTravel(false);
    $('trEco').onclick = () => setTravel(true);
    syncTravel();
    $('gearBtn').onclick = () => sim.cycleGear();
    $('apOff').onclick = () => sim.ap.disengage('Autopilot disengaged');
    // orbit lines: off unless the player turned them on (remembered per browser)
    world.showOrbits = !!loadUiPrefs().orbits;
    $('btnOrbits').classList.toggle('active', world.showOrbits);
    this.station = new StationPanel(sim, (m, k) => this.toast(m, k), b => {
      if (b.system === sim.system) this.select(b); else this.select(null, b.system);
    });
    this.cargo = new CargoPanel(sim, (m, k) => this.toast(m, k));
    this.career = new CareerPanel(sim, (m, k) => this.toast(m, k), t => {
      if ('galPos' in t) { if (t === sim.system) this.toast('You are already in that system', 'info'); else this.select(null, t); }
      else if (t.system === sim.system) this.select(t); else this.select(null, t.system);
    });
    this.station.contractClick = btn => this.career.contractClick(btn);
    this.station.fleet = { html: () => this.career.fleetHtml(), click: btn => this.career.fleetClick(btn), change: e => this.career.fleetChange(e) };
    $('btnStation').onclick = () => this.toggleStation();
    // collapsible navigation panel and sections (state remembered per browser)
    const prefs = loadUiPrefs();
    const sections = ['secAp', 'secTarget', 'secInfo', 'secDest'];
    for (const id of sections) {
      const el = $(id);
      if (prefs[id] !== undefined) el.classList.toggle('collapsed', prefs[id]);
      (el.querySelector(':scope > .sechead') as HTMLElement).onclick = () => {
        el.classList.toggle('collapsed');
        saveUiPref(id, el.classList.contains('collapsed'));
      };
    }
    // the navigation panel starts collapsed unless the player has expanded it since this default
    // was introduced (older saved "expanded" states are reset once)
    if (!prefs.navDefaultCollapsed) { saveUiPref('navDefaultCollapsed', true); saveUiPref('nav', true); prefs.nav = true; }
    if (prefs.nav ?? true) $('nav').classList.add('collapsed');
    $('navHead').onclick = () => this.toggleNav();
    // the scope panel collapses the same way, and also starts collapsed
    if (prefs.scope ?? true) $('scope').classList.add('collapsed');
    $('scopeHead').onclick = () => {
      const s = $('scope');
      s.classList.toggle('collapsed');
      saveUiPref('scope', s.classList.contains('collapsed'));
    };
    this.scope = new Scope(sim, () => this.targetBody, () => this.targetSite);
    this.scope.onTargetSite = site => this.setSite(site);
    this.scope.getNpc = () => this.targetNpc;
    this.scope.onPick = pick => { if (pick.npc) this.selectNpc(pick.npc); else if (pick.body) this.select(pick.body); };
    $('tSiteClear').onclick = () => this.setSite(null);
    this.scope.onScanned = b => { if (b === this.targetBody) this.refreshTarget(); this.toast(`Scan complete: ${b.name}`, 'good'); };
    this.scope.onScanData = b => sim.career.onScan(b);
    $('apMine').onclick = () => sim.toggleMining();
    this.cockpitHud = new CockpitHud(sim, world, () => this.targetBody, world.cockpit.statusCanvas, world.cockpit.attCanvas);
    this.cockpitHud.getSite = () => this.targetSite;
    this.cockpitHud.getNpc = () => this.targetNpc;
    $('apTow').onclick = () => {
      if (!confirmClick($('apTow') as HTMLButtonElement, `CONFIRM TOW · ${sim.econ.towFee().toLocaleString('en-US')} cr`)) return;
      const err = sim.requestTow();
      if (err) this.toast(err, 'warn');
    };
    sim.onDock = (st, silent) => {
      // landing on a spaceport pad doesn't pop up the station screen (STATION / T opens it)
      if ((!silent || this.started) && !st.isPort) this.station.show(true, st);
      else if (st.isPort && !silent) this.toast(`Landed at ${st.name} — press T (or STATION) for the market, fuel and shipyard`, 'info');
      this.refreshTarget();
    };
    sim.econ.onChange = () => sim.applyShipClass();
    this.buildNav();
    this.refreshTarget();
  }
  readonly station: StationPanel;
  readonly cargo: CargoPanel;
  readonly career: CareerPanel;
  readonly scope: Scope;
  readonly cockpitHud: CockpitHud;
  started = false;
  private scopeMini = '';
  private undockShown: boolean | null = null;
  private gearTxt = '';

  toggleNav() {
    const n = $('nav');
    n.classList.toggle('collapsed');
    saveUiPref('nav', n.classList.contains('collapsed'));
  }

  toggleStation() {
    const st = this.sim.ship.docked;
    if (!st) { this.toast('Dock at a station to trade', 'warn'); return; }
    this.station.show(!this.station.open, st);
  }

  private mkVec(cls: string) { const d = document.createElement('div'); d.className = cls; $('markers').appendChild(d); return d; }

  toggleView() { this.world.view = this.world.view === 'chase' ? 'cockpit' : 'chase'; }
  toggleOrbits() {
    this.world.showOrbits = !this.world.showOrbits;
    $('btnOrbits').classList.toggle('active', this.world.showOrbits);
    saveUiPref('orbits', this.world.showOrbits);
  }

  /** keyboard shortcuts obey the same rules as the buttons: a greyed-out command explains itself */
  private blocked(id: string): boolean {
    this.btnKey = ''; this.updateApButtons();
    const el = $(id) as HTMLButtonElement;
    if (!el.disabled) return false;
    this.toast(el.title, 'info');
    return true;
  }

  cmdOrbit() {
    if (this.targetNpc) {
      if (this.blocked('apOrbit')) return;
      this.station.show(false);
      this.sim.ap.engageRendezvous(this.targetNpc);
      return;
    }
    if (!this.targetBody) { this.toast('Select a destination first', 'warn'); return; }
    if (this.blocked('apOrbit')) return;
    this.sim.ap.engageOrbit(this.targetBody);
  }
  cmdLand() {
    const t = this.targetBody;
    if (!t) { this.toast('Select a destination first', 'warn'); return; }
    if (this.blocked('apLand')) return;
    if (t.isStation) { this.station.show(false); this.sim.ap.engageDock(t); }
    else this.sim.ap.engageLand(t, this.targetSite?.body === t ? this.targetSite : null);
  }
  cmdCirc() {
    if (this.blocked('apCirc')) return;
    const s = this.sim.ship;
    // landed: climb back to a parking orbit around the body we're sitting on
    if (s.landed && !s.docked) { this.sim.ap.engageOrbit(s.landed); return; }
    this.station.show(false); this.sim.ap.engageCircularize();
  }
  /** autopilot departure from the station: back out to a safe distance and hold */
  cmdUndock() {
    if (!this.sim.ship.docked) return;
    this.station.show(false);
    this.sim.ap.engageUndock();
  }
  cmdJump() {
    const t = this.targetSystem;
    if (!t) { this.toast('Select a star system first (Star Systems tab)', 'warn'); return; }
    if (t === this.sim.system) return;
    if (this.sim.jumpArmed === t) { this.sim.disarmJump('Jump drive disarmed'); return; }
    if (this.pendingJump === t) { this.pendingJump = null; this.sim.ap.disengage('Jump preparation cancelled'); return; }
    const grounded = this.groundedReason();
    if (grounded) { this.toast(grounded, 'info'); return; }
    const sim = this.sim, s = sim.ship;
    const need = sim.econ.jumpFuel(sim.jumpDistanceLy(t));
    if (need > sim.econ.fuel) { this.toast(`Jump needs ${need.toFixed(1)} t of Helionite — you have ${sim.econ.fuel.toFixed(1)} t`, 'warn'); return; }
    const why = sim.canJump(t);
    if (why) {
      // not clear yet: let the autopilot get us clear, then arm the drive automatically
      this.pendingJump = t; this.pendingClimb = false;
      this.station.show(false);
      if (s.docked) { sim.ap.engageUndock(); this.toast(`Undocking — the jump drive will arm for ${t.name} once clear`, 'info'); }
      else if (s.landed) { sim.ap.engageOrbit(s.landed); this.toast(`Lifting off — the jump drive will arm for ${t.name} once clear of ${s.landed.name}`, 'info'); }
      else { sim.ap.engageOrbit(sim.dominant); this.toast(`Climbing away from ${sim.dominant.name} — the jump drive will arm for ${t.name} once clear`, 'info'); }
      return;
    }
    this.armJumpNow(t);
  }

  /** jump requested from the ground / a dock: armed automatically once the ship is clear */
  pendingJump: StarSystem | null = null;

  private armJumpNow(t: StarSystem) {
    const why = this.sim.armJump(t);
    if (why) { this.toast(why, 'warn'); return; }
    this.toast(`Jump drive armed for ${t.name}: drive power set to maximum — hold W to burn along the jump vector`, 'info');
  }

  private updatePendingJump() {
    const pj = this.pendingJump, sim = this.sim;
    if (!pj) return;
    if (this.targetSystem !== pj || sim.jumpArmed) { this.pendingJump = null; return; }
    if (!sim.canJump(pj)) { this.pendingJump = null; this.armJumpNow(pj); return; }
    if (!sim.ap.active && !sim.ship.docked) {
      // undocked (or levelled off) but still too close: climb once more, to a parking orbit
      if (!this.pendingClimb && /^Too close/.test(sim.canJump(pj) ?? '')) {
        this.pendingClimb = true;
        sim.ap.engageOrbit(sim.dominant, Math.max(sim.dominant.parkingRadius(), (sim.dominant.radius + sim.dominant.atmoTop) * 1.05));
        return;
      }
      // the pilot took over (or the autopilot gave up) before we got clear
      this.pendingJump = null; this.toast('Jump preparation cancelled', 'info');
    }
  }
  private pendingClimb = false;

  /** jump checklist: alignment, power, burn, then spool-up */
  private updateJumpStatus() {
    const sim = this.sim, t = sim.jumpArmed, el = $('jumpStatus'), btn = $('apJump');
    if (!t) {
      el.classList.add('hidden');
      const sh = sim.ship;
      btn.textContent = this.pendingJump ? 'PREPARING JUMP…' : 'ENGAGE JUMP DRIVE';
      void sh;
      btn.classList.remove('armed');
      return;
    }
    const r = sim.jumpReadiness(t);
    const step = sim.jumpTransit > 0 ? 'TRANSIT' : !r.aligned ? `ALIGN ${r.angle.toFixed(r.angle < 10 ? 1 : 0)}°` : !r.maxLevel ? 'SET MAX POWER (+)' : !r.burning ? 'BURN — HOLD W' : `SPOOLING ${(sim.jumpCharge * 100).toFixed(0)}%`;
    btn.textContent = `ARMED · ${step}`; btn.classList.add('armed');
    el.classList.remove('hidden');
    const tick = (ok: boolean, txt: string) => `<span class="${ok ? 'ok' : ''}">${ok ? '■' : '□'} ${txt}</span>`;
    el.innerHTML = `<div class="jt">${sim.jumpTransit > 0 ? 'JUMPING' : 'JUMP DRIVE ARMED'} · ${t.name.toUpperCase()}</div>
      <div class="jc">${tick(r.aligned, `ALIGNED ${r.angle.toFixed(1)}° (≤ 2°)`)}${tick(r.maxLevel, 'MAX DRIVE POWER')}${tick(r.burning, 'MAIN ENGINE AT FULL BURN')}</div>
      <div class="jb"><div style="width:${(sim.jumpCharge * 100).toFixed(0)}%"></div></div>`;
  }

  toast(msg: string, kind: 'info' | 'warn' | 'good' = 'info') {
    const d = document.createElement('div');
    d.className = `toast ${kind}`; d.textContent = msg;
    const box = $('toasts'); box.appendChild(d);
    while (box.children.length > 4) box.firstChild!.remove();
    setTimeout(() => { d.style.opacity = '0'; setTimeout(() => d.remove(), 600); }, 4200);
  }

  /** surface deposit chosen as the landing site on the target body (from the scan display) */
  targetSite: Site | null = null;

  setSite(site: Site | null) {
    if (site && site.body !== this.targetBody) this.select(site.body);
    this.targetSite = site;
    if (site) {
      const econ = this.sim.econ;
      if (econ.ship.miner && !econ.rigTakes(site.focus)) {
        const focus = COMMODITIES.find(c => c.id === site.focus)?.name ?? site.focus;
        const got = econ.minedNames(site.body, site).join(', ');
        this.toast(`Landing site set: deposit ${site.label} — but your ${econ.ship.name}'s drill can't recover ${focus}${got ? `; here it would only get ${got}` : ''}. ${focus} needs a mining ship.`, 'warn');
      } else this.toast(`Landing site set: deposit ${site.label} on ${site.body.name} — ${site.name}. LAND (L) to set down there.`, 'info');
    }
    this.refreshTarget();
  }

  /** another ship chosen as the target (from the radar or its marker) */
  targetNpc: Npc | null = null;

  selectNpc(npc: Npc) {
    this.targetBody = null; this.targetSystem = null; this.targetSite = null;
    this.targetNpc = npc;
    this.refreshTarget();
    this.highlightNav();
  }

  select(b: Body | null, sys: StarSystem | null = null) {
    this.targetNpc = null;
    if (b !== this.targetBody) this.targetSite = null;
    this.targetBody = b; this.targetSystem = sys;
    this.refreshTarget();
    this.highlightNav();
  }

  // ------------------------------------------------------------------ navigation list
  private buildNav() {
    $('tabSystem').classList.toggle('active', this.tab === 'system');
    $('tabStars').classList.toggle('active', this.tab === 'stars');
    const list = $('navList'); list.innerHTML = '';
    const sim = this.sim;
    const item = (name: string, color: string, depth: number, onClick: () => void, key: string, parent: HTMLElement = list) => {
      const d = document.createElement('div');
      d.className = `nitem d${depth}`; d.dataset.key = key;
      d.innerHTML = `<span class="dot" style="background:${color};color:${color}"></span><span>${name}</span><span class="nd"></span>`;
      d.onclick = onClick; parent.appendChild(d);
      return d;
    };
    const group = (t: string) => { const g = document.createElement('div'); g.className = 'ngroup'; g.textContent = t; list.appendChild(g); };
    if (this.tab === 'system') {
      const sys = sim.system;
      group('STAR');
      item(sys.star.name, sys.star.def.star!.color, 0, () => this.select(sys.star), sys.star.id);
      const planets = sys.star.children.filter(b => b.def.kind === 'planet').sort((a, b) => a.a - b.a);
      const rocks = sys.star.children.filter(b => b.def.kind === 'asteroid').sort((a, b) => a.a - b.a);
      // the belt spans its asteroids' orbits; dwarf planets orbiting inside it (Ceres) belong to it too
      const bMin = rocks.length ? rocks[0].a : 0, bMax = rocks.length ? rocks[rocks.length - 1].a : 0;
      const others = sys.star.children.filter(b => b.def.kind !== 'planet' && b.def.kind !== 'asteroid');
      const beltMembers = [...rocks, ...others.filter(b => b.a >= bMin && b.a <= bMax)].sort((a, b) => a.a - b.a);
      const small = others.filter(b => !beltMembers.includes(b)).sort((a, b) => a.a - b.a);
      group('PLANETS');
      const add = (b: Body, depth: number, parent: HTMLElement = list) => {
        // orbital stations: green squares; ground bases / spaceports: amber diamonds
        const col = b.isPort ? '#ffc861' : b.isStation ? '#7dffb8' : b.def.palette[0];
        const it = item(b.name.replace(sys.name + ' ', sys.id === 'sol' ? '' : sys.name + ' '), col, depth, () => this.select(b), b.id, parent);
        if (b.isPort) it.classList.add('port');
        else if (b.isStation) it.classList.add('stn');
        [...b.children].sort((x, y) => x.a - y.a).forEach(c => add(c, depth + 1, parent));
      };
      const addBelt = () => {
        const collapsed = !!loadUiPrefs().belt;
        const head = document.createElement('div');
        head.className = 'nbelt' + (collapsed ? ' collapsed' : '');
        const au = (m: number) => (m / 1.495978707e11).toFixed(m < 1.5e11 ? 2 : 1);
        head.innerHTML = `<span class="beltdots">∴</span><span>Asteroid belt</span><span class="nd">${beltMembers.length} · ${au(bMin)}–${au(bMax)} AU</span><i class="chev">▾</i>`;
        const box = document.createElement('div');
        box.className = 'beltbox';
        head.onclick = () => { const c = !head.classList.contains('collapsed'); head.classList.toggle('collapsed', c); saveUiPref('belt', c); };
        list.appendChild(head); list.appendChild(box);
        beltMembers.forEach(p => add(p, 1, box));
      };
      // walk outward from the star, dropping the belt in where its orbits fall
      let beltDone = !beltMembers.length;
      for (const p of planets) {
        if (!beltDone && p.a > bMin) { addBelt(); beltDone = true; }
        add(p, 0);
      }
      if (!beltDone) addBelt();
      if (small.length) { group('DWARF PLANETS & COMETS'); small.forEach(p => add(p, 0)); }
    } else {
      group('WITHIN 45 LIGHT-YEARS');
      const here = sim.system;
      const systems = [...sim.universe.systems].sort((a, b) => a.galPos.distanceTo(here.galPos) - b.galPos.distanceTo(here.galPos));
      for (const s of systems) {
        const d = item(s.name, s.star.def.star!.color, 0, () => this.select(null, s), 'sys:' + s.id);
        if (s === here) d.classList.add('here');
        const n = s.bodies.filter(b => b.def.kind === 'planet').length;
        const unch = s.def.uncharted && !this.sim.econ.visited.includes(s.id);
        (d.querySelector('.nd') as HTMLElement).textContent = s === here ? 'HERE' : `${(s.galPos.distanceTo(here.galPos) / 9.4607e15).toFixed(1)} ly · ${n}p${unch ? ' · ?' : ''}`;
        if (s.def.uncharted) { d.classList.add('unch'); d.title = unch ? 'Uncharted: never visited, no stations — rich asteroid belt' : 'Surveyed frontier system: no stations'; }
      }
    }
    this.highlightNav();
    this.navTimer = 0;
  }

  private highlightNav() {
    const key = this.targetBody ? this.targetBody.id : this.targetSystem ? 'sys:' + this.targetSystem.id : '';
    $('navList').querySelectorAll<HTMLElement>('.nitem').forEach(e => e.classList.toggle('sel', e.dataset.key === key));
  }

  private updateNavDistances() {
    if (this.tab !== 'system') return;
    const sim = this.sim;
    $('navList').querySelectorAll<HTMLElement>('.nitem').forEach(e => {
      const b = sim.system.byId.get(e.dataset.key!);
      if (b) (e.querySelector('.nd') as HTMLElement).textContent = fmtDist(Math.max(0, b.pos.distanceTo(sim.ship.pos) - b.radius));
    });
  }

  /**
   * Label and enable the autopilot buttons for the current situation, so commands that would do
   * nothing (land where you already are, dock where you're docked, repeat a manoeuvre that is
   * already running, circularise on the ground…) are greyed out, with the reason as a tooltip.
   */
  private btnKey = '';
  private updateApButtons() {
    const sim = this.sim, s = sim.ship, ap = sim.ap, b = this.targetBody;
    const set = (id: string, label: string, why: string | null, title: string) => {
      const el = $(id) as HTMLButtonElement;
      el.textContent = label;
      el.disabled = !!why;
      el.title = why ?? title;
    };
    const apOn = (mode: string) => ap.active && ap.mode === mode && ap.target === b;
    // cheap change detection: only touch the DOM when something relevant changed
    const circular = !!sim.orbit && sim.orbit.bound && sim.orbit.e < 0.005 && sim.density < 1e-9;
    // a stable orbit around the target: bound, periapsis clear of terrain and atmosphere, not wildly eccentric
    const o = sim.orbit;
    const orbitingB = !!b && !b.isStation && !s.landed && !!o && o.body === b && o.bound && o.e < 0.3
      && o.rp > b.radius * (1 + b.surface.rel * 2.2) + b.atmoTop + Math.max(500, b.radius * 0.005);
    const key = [orbitingB, this.pendingJump?.id, b?.id, this.targetNpc?.id, ap.rvHolding, this.targetSite?.id, s.landed?.id, s.docked?.id, ap.active, ap.mode, ap.target?.id, circular, this.targetSystem?.id, sim.jumpArmed?.id].join('|');
    if (key === this.btnKey) return;
    this.btnKey = key;

    const npc = this.targetNpc;
    if (npc) {
      const on = ap.active && ap.mode === 'rendezvous' && ap.rv === npc;
      set('apOrbit', on ? (ap.rvHolding ? 'HOLDING STATION' : 'RENDEZVOUS…') : 'RENDEZVOUS', on ? `Already meeting ${npc.name}` : null,
        `Fly to ${npc.name}, match its velocity and keep station alongside (G)`);
    }
    if (b) {
      if (b.isPort) {
        const here = s.docked === b;
        const landing = ap.active && ap.mode === 'land' && ap.site?.port === b;
        set('apOrbit', 'APPROACH', 'Spaceports are on the ground — use LAND AT PAD', 'Spaceports are on the ground');
        // already on the ground (another pad, or landed): it's a hop over, so call it that
        const grounded = !!s.landed && (!s.landed.isStation || s.landed.isPort);
        set('apLand', here ? 'DOCKED' : landing ? (grounded ? 'FLYING…' : 'LANDING…') : grounded ? 'FLY TO' : 'LAND AT PAD',
          here ? `Already docked at ${b.name}` : landing ? 'The autopilot is already on its way there' : null,
          grounded ? `Lift off, fly to ${b.name} and land on its pad (L)` : 'Fly there and land on the pad (L)');
      } else if (b.isStation) {
        const here = s.docked === b;
        set('apOrbit', 'APPROACH', here ? `Already docked at ${b.name}` : apOn('orbit') ? 'Already approaching' : null,
          'Fly to the station and hold position nearby (G)');
        set('apLand', here ? 'DOCKED' : apOn('dock') ? 'DOCKING…' : 'DOCK',
          here ? `Already docked at ${b.name}` : apOn('dock') ? 'The autopilot is already docking' : null, 'Fly there and dock (L)');
      } else {
        const onIt = s.landed === b;
        const site = this.targetSite?.body === b ? this.targetSite : null;
        // on the body but not at the chosen deposit: hop over to it
        const atSite = !site || (onIt && sim.landedSite === site);
        set('apOrbit', onIt ? 'LIFT OFF & ORBIT' : orbitingB ? 'IN ORBIT' : 'FLY TO & ORBIT',
          apOn('orbit') ? `Already flying to orbit ${b.name}` : orbitingB ? `Already in orbit around ${b.name}` : null,
          onIt ? `Take off and climb to a parking orbit around ${b.name} (G)` : 'Fly there and enter a stable orbit (G)');
        set('apLand', onIt && atSite ? 'LANDED' : apOn('land') ? 'LANDING…' : site ? (onIt ? `HOP TO SITE ${site.label}` : `LAND AT SITE ${site.label}`) : 'LAND',
          !b.def.landable ? `${b.name} has no solid surface to land on` : onIt && atSite ? (site ? `Already at site ${site.label}` : `Already landed on ${b.name}`)
            : apOn('land') ? 'The autopilot is already landing' : null,
          site ? `Fly to deposit ${site.label} and land on it (L)` : 'Fly there and land (L)');
      }
    }
    // circularise: needs to be flying, and only does something if the orbit isn't circular yet
    const onGround = !!s.landed && !s.docked;
    const circWhy = ap.active && ap.mode === 'orbit' ? 'The autopilot is already flying an orbit manoeuvre'
      : !onGround && circular ? 'Your orbit is already circular' : null;
    set('apCirc', onGround ? 'LIFT OFF TO ORBIT' : 'CIRCULARISE', circWhy,
      onGround ? `Take off and climb to a parking orbit around ${s.landed!.name} (C)` : 'Circularise the current orbit (C)');
    // jump: must be clear of stations and surfaces (arming/disarming otherwise stays available)
    const js = this.targetSystem;
    if (js && js !== sim.system && !sim.jumpArmed) {
      const el = $('apJump') as HTMLButtonElement;
      const busy = this.pendingJump === js;
      el.disabled = busy;
      el.title = busy ? 'Getting clear — the drive arms automatically' : s.docked ? 'Undock, then arm the jump drive (J)'
        : s.landed ? 'Lift off to a safe height, then arm the jump drive (J)' : 'Jump to this star system (J)';
    } else ($('apJump') as HTMLButtonElement).disabled = false;

    // on the ground or at a dock the only autopilot action is getting airborne (LIFT OFF TO ORBIT /
    // UNDOCK / LIFT OFF); everything else comes back once the ship is flying
    const grounded = this.groundedReason();
    if (grounded) {
      for (const id of ['apOrbit', 'apLand', 'apJump']) {
        const el = $(id) as HTMLButtonElement;
        el.disabled = true; el.title = grounded;
      }
      // greyed-out buttons keep their ordinary names (no "LIFT OFF & ORBIT" / "HOP" / "FLY TO" that can't be pressed)
      if (b && !b.isStation && /LIFT OFF/.test($('apOrbit').textContent ?? '')) $('apOrbit').textContent = 'FLY TO & ORBIT';
      const lt = $('apLand').textContent ?? '';
      if (b && (lt === 'FLY TO' || lt.startsWith('HOP'))) $('apLand').textContent = b.isPort ? 'LAND AT PAD' : 'LAND';
    }
  }

  /** why the autopilot can only launch right now (null when flying) */
  private groundedReason(): string | null {
    const s = this.sim.ship;
    if (s.docked) return s.docked.isPort ? 'Lift off first (LIFT OFF / U)' : 'Undock first (UNDOCK / U)';
    if (s.landed) return 'Take off first (LIFT OFF TO ORBIT / C)';
    return null;
  }

  // ------------------------------------------------------------------ target panel
  private refreshTarget() {
    const b = this.targetBody, s = this.targetSystem;
    const site = this.targetSite && this.targetSite.body === b ? this.targetSite : null;
    $('tSite').classList.toggle('hidden', !site);
    if (site) {
      const c = COMMODITIES.find(x => x.id === site.focus);
      $('tSiteTxt').textContent = `◆ Site ${site.label} · ${site.name} · ${c?.name ?? site.focus} ${(site.mix[site.focus] * 100).toFixed(0)}% · ×${site.rich.toFixed(1)}`;
    }
    const info = $('tInfo');
    const npc = this.targetNpc;
    $('apOrbit').classList.toggle('hidden', !b && !npc);
    $('travelMode').classList.toggle('hidden', !b);
    $('apLand').classList.toggle('hidden', !b);
    $('apJump').classList.toggle('hidden', !s || s === this.sim.system);
    this.btnKey = ''; // relabel the autopilot buttons for the new target
    if (npc) {
      const cls = SHIPS.find(x => x.id === npc.shipId);
      $('tName').textContent = npc.name;
      $('tType').textContent = `${cls?.name ?? 'Ship'} · ${cls?.role ?? ''}`;
      const doing = npc.state === 'docked' ? `Docked at ${npc.dest.name}` : npc.state === 'hold' ? `Holding near ${npc.dest.name}`
        : npc.state === 'depart' ? `Departing ${npc.origin?.name ?? 'station'}` : `En route to ${npc.dest.name}`;
      const rows: [string, string][] = [['Status', doing], ['Length', `${cls?.length ?? '?'} m`], ['Cargo capacity', `${fmtNum(cls?.cargo ?? 0)} t`]];
      info.innerHTML = `<p>An independent ${(cls?.role ?? 'ship').toLowerCase()} going about its business. RENDEZVOUS (G) flies alongside and keeps station with it.</p><table>${rows.map(r => `<tr><td>${r[0]}</td><td>${r[1]}</td></tr>`).join('')}</table>`;
      return;
    }
    if (b && b.isStation) {
      const d = b.def, eco = ECONOMIES[d.station!.economy], par = b.parent!;
      $('tName').textContent = b.name;
      $('tType').textContent = `${b.isPort ? 'Ground spaceport' : 'Space station'} · ${eco.label}`;
      const qs = this.sim.econ.quotes(b, this.sim.t);
      const exp = qs.filter(q => q.canBuy).sort((x, y) => x.mid / x.c.base - y.mid / y.c.base).slice(0, 3);
      const imp = [...qs].sort((x, y) => y.mid / y.c.base - x.mid / x.c.base).slice(0, 3);
      const port = d.station!.port;
      const ll = (v: number, p: string, n: string) => `${Math.abs(v).toFixed(2)}°${v >= 0 ? p : n}`;
      const rows: [string, string][] = [
        ...(port ? [['Location', `${ll(port.lat, 'N', 'S')}, ${ll(port.lon, 'E', 'W')} on ${par.name}`], ['Pad elevation', `${fmtNum(b.portH)} m`]] as [string, string][]
          : [['Orbiting', par.name], ['Altitude', `${fmtNum((b.a - par.radius) / 1000)} km`], ['Orbital period', fmtTime(b.period)]] as [string, string][]),
        ['Exports', exp.map(q => q.c.name).join(', ')], ['Imports', imp.map(q => q.c.name).join(', ')],
      ];
      info.innerHTML = `<p>${d.desc}</p><table>${rows.map(r => `<tr><td>${r[0]}</td><td>${r[1]}</td></tr>`).join('')}</table>`;
    } else if (b) {
      const d = b.def;
      $('tName').textContent = b.name;
      $('tType').textContent = `${KIND_LABEL[d.kind]} · ${d.star ? d.star.spectral : SURFACE_LABEL[d.surface]}`;
      const rows: [string, string][] = [];
      rows.push(['Radius', `${fmtNum(d.radius, d.radius < 100 ? 1 : 0)} km`]);
      rows.push(['Surface gravity', `${(b.surfaceG / G_EARTH).toFixed(b.surfaceG < 0.1 ? 4 : 2)} g`]);
      if (d.star) { rows.push(['Temperature', `${fmtNum(d.star.teff)} K`]); rows.push(['Luminosity', `${d.star.luminosity} L☉`]); }
      else if (d.tempK) rows.push(['Mean temp', `${d.tempK} K (${d.tempK - 273} °C)`]);
      if (b.parent) {
        rows.push(['Orbit radius', b.parent.isStar ? `${(b.a / 1000 / AU_KM).toFixed(b.a / 1000 / AU_KM < 0.1 ? 4 : 2)} AU` : `${fmtNum(b.a / 1000)} km`]);
        rows.push(['Orbital period', fmtTime(b.period)]);
      }
      if (b.rotRate) rows.push(['Day length', d.rotationHours === undefined ? 'Tidally locked' : fmtTime(Math.abs(d.rotationHours) * 3600) + (d.rotationHours < 0 ? ' (retro)' : '')]);
      if (d.atmosphere) {
        rows.push(['Atmosphere', d.atmosphere.pressureBar >= 1000 ? 'Deep, no surface' : `${d.atmosphere.pressureBar} bar`]);
        rows.push(['Composition', d.atmosphere.composition]);
      } else if (!d.star) rows.push(['Atmosphere', 'None']);
      if (d.discovery) rows.push(['Discovered', d.discovery]);
      if (d.ore) {
        const sum = this.scope.scanSummary(b);
        rows.push(['Ore', sum ? `${ORE_LABEL[d.ore.cls]} · richness ${(d.ore.rich * 100).toFixed(0)}%` : 'Unknown — scan it (SCAN display)']);
        if (sum) rows.push(['Composition', sum]);
      }
      info.innerHTML = `<p>${d.desc}</p>${d.speculative ? '<span class="spec">APPEARANCE: ARTIST\'S IMPRESSION</span>' : ''}
        <table>${rows.map(r => `<tr><td>${r[0]}</td><td>${r[1]}</td></tr>`).join('')}</table>`;
    } else if (s) {
      $('tName').textContent = s.name;
      const st = s.star.def.star!;
      $('tType').textContent = `Star system · ${st.spectral}`;
      const planets = s.bodies.filter(x => x.def.kind === 'planet');
      const rows: [string, string][] = [
        ['Distance from Sol', s.def.distLy ? `${s.def.distLy.toFixed(2)} ly` : '—'],
        ['Star', `${s.star.name}`], ['Star temp', `${fmtNum(st.teff)} K`], ['Luminosity', `${st.luminosity} L☉`],
        ['Known planets', `${planets.length}`],
      ];
      info.innerHTML = `<p>${s.def.desc}</p><table>${rows.map(r => `<tr><td>${r[0]}</td><td>${r[1]}</td></tr>`).join('')}</table>
        <p class="hint">${s === this.sim.system ? 'You are here.' : 'The jump drive needs clear space: leave any atmosphere first.'}</p>`;
    } else {
      $('tName').textContent = 'No target';
      $('tType').textContent = '';
      info.innerHTML = '<p class="hint">Choose a destination from the list on the left, click a label in space, or open the map (M).</p>';
    }
  }

  // ------------------------------------------------------------------ markers
  private rebuildMarkers() {
    const box = $('markers');
    for (const m of this.markers) m.el.remove();
    this.markers = [];
    const mk = (cls: string, name: string, prio: number): Marker => {
      const el = document.createElement('div');
      el.className = `mk ${cls}`;
      el.innerHTML = `<i></i><span></span><small></small>`;
      const label = el.children[1] as HTMLSpanElement; label.textContent = name;
      box.appendChild(el);
      return { el, label, dist: el.children[2] as HTMLElement, prio };
    };
    const sys = this.sim.system;
    for (const b of sys.bodies) {
      const k = b.def.kind;
      const m = mk(k === 'moon' ? 'moon' : k === 'star' ? 'star' : k === 'station' ? 'stn' : '', b.name,
        k === 'star' ? 1 : k === 'planet' ? 2 : k === 'station' ? 3 : k === 'moon' ? 4 : 3);
      m.body = b;
      m.el.onclick = e => { e.stopPropagation(); this.select(b); };
      this.markers.push(m);
    }
    for (const s of this.sim.universe.systems) {
      if (s === sys) continue;
      const m = mk('sys', s.name, 5); m.sys = s;
      m.el.onclick = e => { e.stopPropagation(); this.select(null, s); };
      this.markers.push(m);
    }
    this.markers.sort((a, b) => a.prio - b.prio);
    this.markerSys = sys;
  }

  private updateMarkers() {
    const sim = this.sim, world = this.world, p = this.p;
    if (this.markerSys !== sim.system) this.rebuildMarkers();
    const W = window.innerWidth, H = window.innerHeight;
    const hideAll = this.map.open;
    this.placed.length = 0;
    const dir = new Vector3();
    // selected first so it always wins overlap tests
    const ordered = [...this.markers].sort((a, b) => (this.isSel(b) ? 1 : 0) - (this.isSel(a) ? 1 : 0));
    for (const m of ordered) {
      let show = !hideAll, x = 0, y = 0;
      const sel = this.isSel(m);
      if (show && m.body) {
        const b = m.body, v = world.viewOf(b);
        show = world.project(b.pos, p) && !this.occluded(b.pos, b);
        if (show && v) {
          if (v.pxRadius > H * 0.3 && !sel) show = false;
          if ((b.def.kind === 'moon' || b.isStation) && !sel) {
            const par = b.parent!;
            const dp = par.pos.distanceTo(world.camPos);
            if (dp > b.a * 60) show = false;
          }
          if ((b.def.kind === 'asteroid' || b.def.kind === 'comet' || b.def.kind === 'dwarf') && !sel && this.tab !== 'system') show = false;
          if (b.def.kind === 'asteroid' && !sel && b.pos.distanceTo(sim.ship.pos) > 5e10) show = false;
        }
      } else if (show && m.sys) {
        show = (this.tab === 'stars' || sel) && world.projectDir(world.neighbourDir(m.sys, dir), p)
          && !this.occluded(dir.multiplyScalar(1e18).add(world.camPos), null);
      }
      if (show) {
        x = p.x; y = p.y;
        if (x < -40 || x > W + 40 || y < -20 || y > H + 20) show = false;
      }
      if (show && !sel) {
        for (const q of this.placed) if (Math.abs(q.x - x) < 46 && Math.abs(q.y - y) < 15) { show = false; break; }
      }
      m.el.style.display = show ? '' : 'none';
      if (!show) continue;
      this.placed.push({ x, y });
      m.el.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px)`;
      m.el.classList.toggle('sel', sel);
      if (sel && m.body) m.dist.textContent = fmtDist(Math.max(0, m.body.pos.distanceTo(sim.ship.pos) - m.body.radius));
      else if (sel && m.sys) m.dist.textContent = fmtDist(m.sys.galPos.distanceTo(sim.system.galPos));
      else if (m.dist.textContent) m.dist.textContent = '';
    }
    // NPC traffic markers
    this.updateNpcMarkers(hideAll, W, H);
    // prograde / retrograde relative to the dominant body
    const vel = dir.subVectors(sim.ship.vel, sim.dominant.vel);
    const showVec = !hideAll && !sim.ship.landed && vel.lengthSq() > 4;
    let ok = showVec && world.projectDir(vel.normalize(), p);
    this.pro.style.display = ok ? '' : 'none';
    if (ok) this.pro.style.transform = `translate(${p.x.toFixed(1)}px,${p.y.toFixed(1)}px)`;
    ok = showVec && world.projectDir(vel.negate(), p);
    this.retro.style.display = ok ? '' : 'none';
    if (ok) this.retro.style.transform = `translate(${p.x.toFixed(1)}px,${p.y.toFixed(1)}px)`;
    // manual-flight steering cue (chase view; the cockpit HUD draws its own)
    const tb = this.targetBody;
    const gd = !hideAll && tb && !sim.ap.active && world.view === 'chase' ? guidance(sim, tb, this.gd, this.targetSite) : null;
    ok = !!gd && gd.state !== 'coast' && gd.state !== 'hold' && world.projectDir(gd.dir, p) && p.x > 0 && p.x < W && p.y > 0 && p.y < H;
    this.cue.style.display = ok ? '' : 'none';
    this.updateSiteMarker(hideAll, W, H);
    if (ok && gd) {
      this.cue.style.transform = `translate(${p.x.toFixed(1)}px,${p.y.toFixed(1)}px)`;
      this.cue.dataset.label = `${gd.state === 'brake' ? 'BRAKE' : 'BURN'} ${fmtSpeed(gd.dv)}${gd.error < 0.05 ? ' · ALIGNED' : ''}`;
    }
  }

  /**
   * Landing-site marker: a diamond on the surface at the chosen deposit with its distance and
   * height above it, so it can be found and flown to by hand (dimmed while on the far side).
   */
  private updateSiteMarker(hideAll: boolean, W: number, H: number) {
    const sim = this.sim, site = this.targetSite, el = this.siteMk, p = this.p;
    const b = site?.body;
    let show = !hideAll && !!site && !!b && b.system === sim.system && this.world.view === 'chase'
      && sim.ship.pos.distanceTo(b.pos) < b.radius * 60 && !(sim.ship.landed === b && sim.landedSite === site);
    if (show) {
      const P = sitePos(site!, sim.t, _sP);
      show = this.world.project(P, p) && p.x > -20 && p.x < W + 20 && p.y > -20 && p.y < H + 20;
      if (show) {
        const up = siteUp(site!, sim.t, _sU);
        const far = _sV.subVectors(this.world.camPos, P).dot(up) < 0;
        const ground = siteDistance(site!, _sV.subVectors(sim.ship.pos, b!.pos).applyQuaternion(b!.orientation(sim.t, _sQ).invert()).normalize());
        const above = sim.ship.pos.distanceTo(b!.pos) - (b!.radius + site!.h);
        el.style.transform = `translate(${p.x.toFixed(1)}px,${p.y.toFixed(1)}px)`;
        el.classList.toggle('far', far);
        el.dataset.label = `SITE ${site!.label} · ${fmtDist(ground)}${above < 50e3 ? ` · ${fmtDist(Math.max(0, above))} above` : ''}`;
      }
    }
    el.style.display = show ? '' : 'none';
  }

  /** true if a large nearby body sits between the camera and the point */
  private occluded(target: Vector3, self: Body | null): boolean {
    const cam = this.world.camPos;
    const dx = target.x - cam.x, dy = target.y - cam.y, dz = target.z - cam.z;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    for (const v of this.world.views) {
      if (v.body === self || v.pxRadius < 3 || v.dist >= len) continue;
      // ray-sphere: closest approach of the line of sight to the body's centre
      const t = (v.rel.x * dx + v.rel.y * dy + v.rel.z * dz) / len;
      if (t <= 0) continue;
      const d2 = v.rel.lengthSq() - t * t;
      if (d2 < v.body.radius * v.body.radius) return true;
    }
    return false;
  }

  private npcMarkers: { npc: Npc; el: HTMLDivElement }[] = [];
  private npcList: Npc[] | null = null;

  private updateNpcMarkers(hideAll: boolean, W: number, H: number) {
    const sim = this.sim, p = this.p;
    if (this.npcList !== sim.traffic.npcs) {
      for (const m of this.npcMarkers) m.el.remove();
      this.npcList = sim.traffic.npcs;
      this.npcMarkers = this.npcList.map(npc => {
        const el = document.createElement('div');
        el.className = 'mk npc';
        el.innerHTML = '<i></i><span></span><small></small>';
        el.onclick = e => { e.stopPropagation(); this.selectNpc(npc); };
        $('markers').appendChild(el);
        return { npc, el };
      });
    }
    for (const { npc, el } of this.npcMarkers) {
      const d = npc.pos.distanceTo(sim.ship.pos);
      const sel = npc === this.targetNpc;
      const show = !hideAll && (npc.state !== 'docked' || sel) && (d < 5e9 || sel) && this.world.project(npc.pos, p) && p.x > -40 && p.x < W + 40 && p.y > -20 && p.y < H + 20;
      el.style.display = show ? '' : 'none';
      if (!show) continue;
      el.classList.toggle('sel', sel);
      el.style.transform = `translate(${p.x.toFixed(1)}px,${p.y.toFixed(1)}px)`;
      (el.children[1] as HTMLElement).textContent = npc.name;
      const ship = SHIPS.find(x => x.id === npc.shipId);
      (el.children[2] as HTMLElement).textContent = `${fmtDist(d)} · ${ship ? ship.name : ''} → ${npc.dest.name}`;
    }
  }

  private isSel(m: Marker) { return (!!m.body && m.body === this.targetBody) || (!!m.sys && m.sys === this.targetSystem); }

  private barSync = 0;
  /** the top bar and the bottom instrument bar share one width: the wider one's natural width */
  syncBars() {
    const top = $('topbar'), bot = $('flight');
    top.style.width = ''; bot.style.width = '';
    // cockpit view: the bottom bar only carries credits and cargo, kept compact over the dashboard
    if (document.body.classList.contains('cockpit')) return;
    const w = Math.max(top.offsetWidth, bot.offsetWidth);
    if (!w) return;
    top.style.width = `${w}px`; bot.style.width = `${w}px`;
  }

  // ------------------------------------------------------------------ per frame
  update(dt: number) {
    const sim = this.sim, s = sim.ship, dom = sim.dominant;
    this.updateMarkers();
    this.map.draw();
    this.station.update(dt);
    this.cargo.update(dt);
    this.career.update(dt);
    this.scope.draw(dt);
    const sm = this.scope.mode.toUpperCase();
    if (this.scopeMini !== sm) { this.scopeMini = sm; $('scopeMini').textContent = sm; }
    this.cockpitHud.draw(dt);
    this.updatePendingJump();
    this.updateJumpStatus();
    this.slow -= dt;
    if (this.slow > 0) return;
    this.slow = 0.1;
    this.barSync -= 0.1;
    if (this.barSync <= 0) { this.barSync = 1; this.syncBars(); }

    $('sysName').textContent = sim.system.name;
    const econ = sim.econ;
    $('credits').textContent = fmtNum(Math.round(econ.credits));
    $('cargo').textContent = `${fmtNum(econ.cargoUsed)}/${fmtNum(econ.ship.cargo)} t`;
    $('btnStation').classList.toggle('hidden', !s.docked);
    $('btnStation').classList.toggle('active', this.station.open);
    this.updateApButtons();
    const d = simTimeToDate(sim.t);
    $('date').textContent = isNaN(d.getTime()) ? `T+${fmtTime(sim.t)}` : d.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
    const w = $('warp');
    w.textContent = (sim.ap.active && sim.ap.autoWarp ? 'AUTO ' : '') + fmtWarp(sim.effWarp);
    w.classList.toggle('limited', sim.warpLimited);

    // flight instruments
    const surfaceRef = !s.docked && (sim.nearGround || s.landed || sim.density > 1e-7);
    const v = surfaceRef ? sim.vSurf.length() : new Vector3().subVectors(s.vel, dom.vel).length();
    $('vVal').textContent = fmtSpeed(v);
    $('vRef').textContent = surfaceRef ? 'SURFACE' : `REL ${dom.name.toUpperCase()}`;
    const radar = sim.nearGround && sim.radarAlt < 40000;
    $('altVal').textContent = s.docked ? 'DOCKED' : s.landed ? 'LANDED' : fmtDist(radar ? sim.radarAlt : sim.altitude);
    $('altRef').textContent = radar ? `RADAR · ${dom.name.toUpperCase()}` : `ABOVE ${dom.name.toUpperCase()}`;
    $('vsVal').textContent = s.landed ? '0 m/s' : (sim.vertSpeed >= 0 ? '+' : '') + fmtSpeed(sim.vertSpeed);
    const o = sim.orbit;
    $('apVal').textContent = o ? (o.bound ? fmtDist(o.ra - dom.radius) : 'Escape') : '—';
    $('peVal').textContent = o && isFinite(o.rp) ? fmtDist(o.rp - dom.radius) : '—';
    ($('peVal') as HTMLElement).style.color = o && o.rp < dom.radius + dom.atmoTop * 0.5 ? 'var(--warn)' : '';
    $('perVal').textContent = o && o.bound ? fmtTime(o.period) : '—';
    const amax = sim.ap.active ? sim.ap.accel : s.maxAccel;
    $('thrVal').textContent = `${(amax / G_EARTH).toFixed(amax < 5 ? 2 : 1)} g${sim.ap.active ? ' AP' : ''}`;
    $('thrBar').style.width = `${sim.ap.active ? 100 : (s.thrustLevel + 1) / THRUST_LEVELS.length * 100}%`;
    $('gVal').textContent = `${sim.gForce.toFixed(2)} g`;
    const ff = econ.fuelFrac;
    $('fuelVal').textContent = `${econ.fuel.toFixed(econ.fuel < 10 ? 2 : 1)} t`;
    ($('fuelBar') as HTMLElement).style.width = `${ff * 100}%`;
    $('fuelBar').parentElement!.classList.toggle('low', ff < 0.15);
    const onOre = !!s.landed && !s.docked && !!s.landed.def.ore;
    const isMiner = !!econ.ship.miner && (onOre || sim.mining);
    $('mineRow').classList.toggle('hidden', !isMiner);
    if (isMiner) {
      const btn = $('apMine');
      btn.textContent = sim.mining ? 'STOP MINING (K)' : 'START MINING (K)';
      btn.classList.toggle('on', sim.mining);
      const why = sim.mining ? null : sim.canMine();
      // greyed out whenever drilling can't start (full hold included); STOP always stays available
      ($('apMine') as HTMLButtonElement).disabled = !sim.mining && !!why;
      $('apMine').title = sim.mining ? 'Stop the drills (K)' : why ?? 'Start the drills (K)';
      const hold = `HOLD ${fmtNum(econ.cargoUsed)}/${fmtNum(econ.ship.cargo)} t`;
      $('mineStatus').textContent = sim.mining && s.landed
        ? `DRILLING ${sim.landedSite ? 'DEPOSIT ' + sim.landedSite.label : 'REGOLITH'} · ${s.landed.name.toUpperCase()}  ${econ.mineRate(s.landed, sim.landedSite).toFixed(1)} t/h
→ ${econ.minedNames(s.landed, sim.landedSite).slice(0, 3).join(', ').toUpperCase()}
${hold} · FUEL ${econ.fuel.toFixed(2)} t`
        : `${why ?? (s.landed && s.landed.def.ore ? (sim.landedSite ? `Ready · on deposit ${sim.landedSite.label}` : 'Ready · off-deposit (60% richness)') : 'Ready to drill')}
${hold}`;
    }
    // out of fuel and a space station in this system: a tow can fetch you
    const towOk = econ.fuel < econ.ship.fuelCap * 0.01 && !s.docked && sim.towStations().length > 0;
    $('apTow').classList.toggle('hidden', !towOk);
    if (towOk && !($('apTow') as HTMLButtonElement).dataset.armed) $('apTow').title = `Pay ${econ.towFee().toLocaleString('en-US')} cr to be towed to the nearest space station`;
    const atm = dom.def.atmosphere;
    const localG = dom.mu / Math.pow(dom.radius + Math.max(sim.altitude, 0), 2);
    if (atm && sim.density > 1e-9) {
      const pBar = atm.pressureBar >= 1000 ? Math.exp(-sim.altitude / dom.scaleH) : atm.pressureBar * Math.exp(-Math.max(sim.altitude, 0) / dom.scaleH);
      $('envVal').textContent = `${pBar < 0.001 ? pBar.toExponential(1) : pBar.toFixed(3)} bar\n${sim.heat > 2e5 ? 'HEATING ' + (sim.heat / 1e6).toFixed(1) + ' MW/m²' : 'g ' + localG.toFixed(2) + ' m/s²'}`;
    } else $('envVal').textContent = `Vacuum\ng ${localG < 0.01 ? localG.toExponential(1) : localG.toFixed(2)} m/s²`;

    // autopilot
    const aps = $('apStatus');
    aps.textContent = sim.ap.active ? sim.ap.status || 'Engaged' : sim.jumpArmed ? `Jump armed → ${sim.jumpArmed.name}` : s.docked ? `Docked at ${s.docked.name}` : s.landed ? `Landed on ${s.landed.name}` : 'Manual flight';
    aps.classList.toggle('on', sim.ap.active);
    ($('apOff') as HTMLButtonElement).disabled = !sim.ap.active;
    // landing gear selector and actual state
    const gTxt = `${sim.gearCmd.toUpperCase()} · ${sim.gearDown ? 'DOWN' : 'UP'}`;
    if (this.gearTxt !== gTxt) {
      this.gearTxt = gTxt;
      const gb = $('gearBtn');
      gb.textContent = gTxt;
      gb.classList.toggle('down', sim.gearDown);
    }
    const canUndock = !!s.docked && sim.ap.mode !== 'undock';
    const undockLbl = s.docked?.isPort ? 'LIFT OFF' : 'UNDOCK';
    if ($('apUndock').textContent !== undockLbl) $('apUndock').textContent = undockLbl;
    if (this.undockShown !== canUndock) {
      this.undockShown = canUndock;
      $('apUndock').classList.toggle('hidden', !canUndock);
      $('apCirc').classList.toggle('hidden', canUndock);
    }

    // target readouts
    const tb = this.targetBody, tn = this.targetNpc;
    $('navMini').textContent = tn ? tn.name : tb ? tb.name : this.targetSystem ? this.targetSystem.name : '';
    if (tn) {
      if (!sim.traffic.npcs.includes(tn)) { this.select(null); }
      else {
        const d = tn.pos.distanceTo(s.pos);
        const rv = new Vector3().subVectors(s.vel, tn.vel).length();
        $('tDist').textContent = fmtDist(d);
        $('tVel').textContent = fmtSpeed(rv);
        const a = sim.ap.accel;
        const fuel = econ.fuelFor(2 * Math.sqrt(d * a) + rv);
        $('tTrip').textContent = `${fmtTime(2 * Math.sqrt(d / a) + rv / a)} · ${fuel < 0.1 ? fuel.toFixed(3) : fuel.toFixed(1)} t`;
        $('tTrip').style.color = fuel > econ.fuel ? 'var(--bad)' : '';
      }
    } else if (tb) {
      const d = Math.max(0, tb.pos.distanceTo(s.pos) - tb.radius);
      const rv = new Vector3().subVectors(s.vel, tb.vel).length();
      $('tDist').textContent = fmtDist(d);
      $('tVel').textContent = fmtSpeed(rv);
      // trip estimate at autopilot acceleration for the chosen travel mode (fast: accelerate half
      // way, flip, brake; economy: cruise at a tenth of the speed)
      const a = sim.ap.accel;
      const fmtF = (f: number) => (f < 0.1 ? f.toFixed(3) : f.toFixed(1));
      const est = (eco: boolean) => { const r = Autopilot.trip(d, a, eco); return { t: r.t, fuel: econ.fuelFor(r.dv + rv) }; };
      const cur = est(sim.ap.economy), fast = est(false), eco = est(true);
      const fuel = cur.fuel;
      const trip = $('tTrip');
      trip.textContent = s.landed === tb ? '—' : `${fmtTime(cur.t)} · ${fmtF(fuel)} t`;
      trip.title = `Fast: ${fmtTime(fast.t)}, ${fmtF(fast.fuel)} t of Helionite
Economy: ${fmtTime(eco.t)}, ${fmtF(eco.fuel)} t`;
      trip.style.color = fuel > econ.fuel ? 'var(--bad)' : '';
    } else if (this.targetSystem) {
      const ly = sim.jumpDistanceLy(this.targetSystem);
      const need = econ.jumpFuel(ly);
      $('tDist').textContent = fmtDist(this.targetSystem.galPos.distanceTo(sim.system.galPos));
      $('tVel').textContent = '—';
      $('tTrip').textContent = this.targetSystem === sim.system ? '—' : `jump · ${need.toFixed(1)} t`;
      $('tTrip').style.color = need > econ.fuel ? 'var(--bad)' : '';
    } else { $('tDist').textContent = '—'; $('tVel').textContent = '—'; $('tTrip').textContent = '—'; }

    this.navTimer -= 0.1;
    if (this.navTimer <= 0) { this.navTimer = 0.5; this.updateNavDistances(); }
  }
}

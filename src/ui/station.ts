import { AmbientLight, Box3, DirectionalLight, PerspectiveCamera, PMREMGenerator, Scene, SRGBColorSpace, Vector3, WebGLRenderer, AgXToneMapping } from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { ECONOMIES } from '../data/commodities';
import { SHIPS } from '../data/ships';
import type { Sim } from '../sim/sim';
import type { Body } from '../sim/universe';
import { buildShip } from '../render/shipModels';
import type { Quote } from '../sim/economy';
import { dockingFee, MAX_CONTRACTS, MAX_FLEET, upkeepPerDay } from '../sim/career';
import { contractCard } from './careerPanel';
import { fmtDist, fmtNum } from './format';

const $ = (id: string) => document.getElementById(id)!;
const cr = (n: number) => `${fmtNum(Math.round(n))} cr`;

let thumbs: Record<string, string> | null = null;
/** render a studio thumbnail of every ship class once */
function shipThumbs(): Record<string, string> {
  if (thumbs) return thumbs;
  thumbs = {};
  const canvas = document.createElement('canvas');
  const r = new WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  r.setSize(360, 200, false);
  r.toneMapping = AgXToneMapping; r.toneMappingExposure = 1.2;
  r.outputColorSpace = SRGBColorSpace;
  const scene = new Scene();
  const pm = new PMREMGenerator(r);
  scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.6;
  const key = new DirectionalLight('#ffffff', 3.2); key.position.set(-3, 4, -2);
  const rim = new DirectionalLight('#9fc4ff', 1.5); rim.position.set(3, 1, 4);
  scene.add(key, rim, new AmbientLight('#ffffff', 0.15));
  const cam = new PerspectiveCamera(30, 360 / 200, 0.1, 5000);
  for (const s of SHIPS) {
    const d = buildShip(s.id);
    d.gear.visible = false;
    d.group.traverse(o => { if (o.type === 'Sprite' || o.type === 'SpotLight') o.visible = false; });
    for (const p of d.plumes) p.mesh.visible = false;
    scene.add(d.group);
    const box = new Box3().setFromObject(d.group);
    const size = box.getSize(new Vector3()).length();
    const c = box.getCenter(new Vector3());
    cam.position.copy(c).add(new Vector3(-0.75, 0.45, -0.7).normalize().multiplyScalar(size * 1.35));
    cam.lookAt(c);
    r.render(scene, cam);
    thumbs[s.id] = canvas.toDataURL('image/png');
    scene.remove(d.group);
    d.group.traverse(o => { const m = o as { geometry?: { dispose(): void } }; m.geometry?.dispose(); });
  }
  pm.dispose(); r.dispose();
  return thumbs;
}

export class StationPanel {
  open = false;
  private tab: 'market' | 'contracts' | 'shipyard' | 'fleet' | 'info' = 'market';
  private timer = 0;
  private st: Body | null = null;

  /** market comparison: '' (off), 'best-sys', 'best-all' or a station id */
  private cmp = '';
  private cmpSort = false;
  /** contract buttons shared with the career panel (set by the HUD) */
  contractClick: (btn: HTMLButtonElement) => boolean = () => false;
  /** fleet tab, provided by the career panel (set by the HUD) */
  fleet: { html(): string; click(btn: HTMLButtonElement): boolean; change(e: Event): void } | null = null;

  constructor(private sim: Sim, private toast: (m: string, k?: 'info' | 'warn' | 'good') => void,
    private onTarget: (b: Body) => void = () => {}) {
    // the comparison bar stays put while the price table below it refreshes every second
    $('stMarket').innerHTML = `<div class="cmpbar">
        <label for="stCmp">COMPARE PRICES WITH</label><select id="stCmp"></select>
        <button id="stCmpSort" class="hidden" title="Sort commodities by margin">SORT BY MARGIN</button>
        <button id="stCmpTgt" class="hidden">SET AS TARGET</button>
        <div id="stCmpInfo"></div>
      </div><div id="stMktTbl"></div>`;
    const sel = $('stCmp') as HTMLSelectElement;
    sel.onchange = () => { this.cmp = sel.value; sel.blur(); this.render(); };
    // keep the flight keys from acting on the dropdown and vice versa
    sel.addEventListener('keydown', e => e.stopPropagation());
    $('stCmpSort').onclick = () => { this.cmpSort = !this.cmpSort; this.render(); };
    $('stCmpTgt').onclick = () => {
      const b = this.cmpStation();
      if (!b) return;
      this.onTarget(b);
      this.toast(b.system === this.sim.system ? `Target set: ${b.name}` : `Target set: ${b.system.name} system (${b.name})`, 'info');
    };
    $('stTabMarket').onclick = () => this.setTab('market');
    $('stTabShipyard').onclick = () => this.setTab('shipyard');
    $('stTabContracts').onclick = () => this.setTab('contracts');
    $('stTabFleet').onclick = () => this.setTab('fleet');
    $('stFleet').addEventListener('click', e => {
      const btn = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
      if (btn && this.fleet?.click(btn)) this.render();
    });
    $('stFleet').addEventListener('change', e => { this.fleet?.change(e); this.render(); });
    $('stFleet').addEventListener('keydown', e => e.stopPropagation());
    $('stContracts').addEventListener('click', e => {
      const btn = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
      if (!btn || !this.st) return;
      const car = this.sim.career;
      if (btn.dataset.accept) {
        const c = car.offers(this.st).find(x => x.id === btn.dataset.accept);
        const err = c ? car.accept(c) : 'That offer is gone';
        if (err) this.toast(err, 'warn'); else this.toast(`Contract accepted: ${car.describe(c!)}`, 'good');
      } else this.contractClick(btn);
      this.render();
    });
    $('stTabInfo').onclick = () => this.setTab('info');
    $('stClose').onclick = () => this.show(false);
    $('stRefuel').onclick = () => {
      if (!this.st) return;
      const t = this.sim.econ.refuel(this.st, this.sim.t);
      if (t > 0) this.toast(`Refuelled ${t.toFixed(2)} t`, 'good');
      else this.toast(this.sim.econ.fuel >= this.sim.econ.ship.fuelCap - 0.001 ? 'Tank already full' : 'Not enough credits', 'warn');
      this.render();
    };
    $('stMarket').addEventListener('click', e => {
      const btn = (e.target as HTMLElement).closest('button');
      if (!btn || !this.st || !btn.dataset.act) return;
      const id = btn.dataset.id!, act = btn.dataset.act;
      const econ = this.sim.econ, t = this.sim.t;
      if (act.startsWith('b')) {
        const want = act === 'bmax' ? 1e9 : Number(act.slice(1));
        const got = econ.buy(this.st, id, want, t);
        if (!got) this.toast(econ.cargoFree < 1 ? 'Cargo hold is full' : 'Not enough credits', 'warn');
      } else {
        const n = act === 'sall' ? 1e9 : Number(act.slice(1));
        econ.sell(this.st, id, n, t);
      }
      this.sim.applyShipClass();
      this.render();
    });
    $('stShipyard').addEventListener('click', e => {
      const btn = (e.target as HTMLElement).closest('button');
      if (!btn) return;
      if (btn.dataset.fleet) {
        const err = this.sim.career.buyFleetShip(btn.dataset.fleet);
        if (err) this.toast(err, 'warn');
        else this.toast(`New fleet ship bought and crewed — assign its trade loop in the FLEET tab`, 'good');
        this.render();
        return;
      }
      const err = this.sim.econ.buyShip(btn.dataset.ship!);
      if (err) this.toast(err, 'warn');
      else {
        this.sim.applyShipClass();
        // re-seat the new hull on the docking port
        if (this.st) this.sim.dock(this.st, true);
        this.toast(`Welcome aboard your new ${this.sim.econ.ship.name}!`, 'good');
      }
      this.render();
    });
  }

  show(on: boolean, st?: Body) {
    if (st) this.st = st;
    this.open = on && !!this.st;
    $('station').classList.toggle('hidden', !this.open);
    if (this.open) { this.fillCompare(); this.render(); }
  }

  private allStations(): Body[] { return this.sim.universe.systems.flatMap(s => s.bodies.filter(b => b.isStation)); }

  private cmpStation(): Body | null {
    if (!this.cmp || this.cmp.startsWith('best-')) return null;
    return this.allStations().find(b => b.id === this.cmp) ?? null;
  }

  /** stations to compare against, grouped by system: this system first, then by distance */
  private fillCompare() {
    const sim = this.sim, st = this.st!, here = sim.system;
    const systems = [...sim.universe.systems].sort((a, b) =>
      (a === here ? -1 : 0) - (b === here ? -1 : 0) || a.galPos.distanceTo(here.galPos) - b.galPos.distanceTo(here.galPos));
    let h = `<option value="">— nothing (this station only) —</option>
      <option value="best-sys">Best price in the ${here.name} system</option>
      <option value="best-all">Best price at any station</option>`;
    for (const s of systems) {
      const sts = s.bodies.filter(b => b.isStation && b !== st);
      if (!sts.length) continue;
      const lbl = s === here ? `${s.name} system (here)` : `${s.name} · ${sim.jumpDistanceLy(s).toFixed(1)} ly`;
      h += `<optgroup label="${lbl}">${sts.map(b => `<option value="${b.id}">${b.name} — ${ECONOMIES[b.def.station!.economy].label}</option>`).join('')}</optgroup>`;
    }
    const sel = $('stCmp') as HTMLSelectElement;
    sel.innerHTML = h;
    if (this.cmp === st.id || (this.cmp && !this.cmp.startsWith('best-') && !this.cmpStation())) this.cmp = '';
    sel.value = this.cmp;
  }

  /** where a station is relative to you: distance in this system, or jump range and fuel */
  private whereIs(b: Body): string {
    const sim = this.sim;
    if (b.system === sim.system) return `${fmtDist(b.pos.distanceTo(this.st!.pos))} away`;
    const ly = sim.jumpDistanceLy(b.system);
    return `${b.system.name} system · ${ly.toFixed(1)} ly · jump ${sim.econ.jumpFuel(ly).toFixed(1)} t fuel`;
  }

  private setTab(t: 'market' | 'contracts' | 'shipyard' | 'fleet' | 'info') { this.tab = t; this.render(); }

  update(dt: number) {
    const docked = this.sim.ship.docked;
    if (this.open && docked !== this.st) { this.show(false); return; }
    if (!this.open) return;
    this.timer -= dt;
    if (this.timer <= 0 && (this.tab === 'market' || this.tab === 'contracts' || (this.tab === 'fleet' && !document.activeElement?.closest('#stFleet select')))) { this.timer = 1; this.render(); }
  }

  private render() {
    const st = this.st, sim = this.sim, econ = sim.econ;
    if (!st) return;
    const eco = ECONOMIES[st.def.station!.economy];
    $('stName').textContent = st.name;
    $('stSub').textContent = st.isPort ? `${eco.label} · on ${st.parent!.name} · ${st.system.name} system`
      : `${eco.label} · orbiting ${st.parent!.name} · ${st.system.name} system`;
    $('stCredits').textContent = cr(econ.credits);
    $('stCargo').textContent = `${fmtNum(econ.cargoUsed)} / ${fmtNum(econ.ship.cargo)} t`;
    ($('stCargoBar') as HTMLElement).style.width = `${Math.min(100, econ.cargoUsed / econ.ship.cargo * 100)}%`;
    $('stShip').textContent = `${econ.ship.name} · ${econ.ship.role}`;
    $('stUpkeep').textContent = `running costs ${cr(sim.career.upkeepRate)}/day${sim.career.owed > 0.5 ? ` · ${cr(sim.career.owed)} OWED` : ''}`;
    $('stUpkeep').classList.toggle('owed', sim.career.owed > 0.5);
    const fp = econ.fuelPrice(st, sim.t);
    const missing = Math.max(0, econ.ship.fuelCap - econ.fuel);
    $('stFuel').textContent = `${econ.fuel.toFixed(1)} / ${econ.ship.fuelCap} t`;
    ($('stFuelBar') as HTMLElement).style.width = `${econ.fuelFrac * 100}%`;
    $('stRefuel').textContent = missing < 0.01 ? 'TANK FULL' : `REFUEL · ${cr(missing * fp)}`;
    ($('stRefuel') as HTMLButtonElement).disabled = missing < 0.01;
    $('stRefuel').title = `Helionite here: ${fmtNum(fp)} cr/t`;
    for (const [id, t] of [['stTabMarket', 'market'], ['stTabContracts', 'contracts'], ['stTabShipyard', 'shipyard'], ['stTabFleet', 'fleet'], ['stTabInfo', 'info']] as const) $(id).classList.toggle('active', this.tab === t);
    $('stMarket').classList.toggle('hidden', this.tab !== 'market');
    $('stShipyard').classList.toggle('hidden', this.tab !== 'shipyard');
    $('stContracts').classList.toggle('hidden', this.tab !== 'contracts');
    $('stFleet').classList.toggle('hidden', this.tab !== 'fleet');
    $('stInfo').classList.toggle('hidden', this.tab !== 'info');

    if (this.tab === 'market') {
      // comparison against another station (or the best price on offer anywhere)
      const mode = this.cmp, one = this.cmpStation();
      const pool = mode === 'best-sys' ? sim.system.bodies.filter(b => b.isStation && b !== st)
        : mode === 'best-all' ? this.allStations().filter(b => b !== st) : one ? [one] : [];
      const comparing = pool.length > 0;
      $('stCmpSort').classList.toggle('hidden', !comparing);
      $('stCmpSort').classList.toggle('active', this.cmpSort);
      $('stCmpTgt').classList.toggle('hidden', !one);
      document.querySelector('.st-card')!.classList.toggle('cmp', comparing);
      const short = (b: Body) => b.name.replace(/ (Station|Orbital|Base|Port|Hub)$/, '');
      let quotes = econ.quotes(st, sim.t).map(q => {
        let there: Quote | null = null, at: Body | null = null;
        for (const b of pool) {
          const q2 = econ.quote(b, q.c, sim.t);
          if (!there || q2.sell > there.sell) { there = q2; at = b; }
        }
        const held = econ.cargo[q.c.id] ?? 0;
        // buy here and sell there; for goods you can't buy here, what hauling your cargo there adds
        const margin = !there ? null : q.canBuy ? there.sell - q.buy : held ? there.sell - q.sell : null;
        return { q, there, at, margin };
      });
      if (comparing && this.cmpSort) quotes = [...quotes].sort((a, b) => (b.margin ?? -1e12) - (a.margin ?? -1e12));
      // the best full hold you could carry there right now (ignoring your own price impact)
      let bestHaul = '';
      if (comparing) {
        let top: typeof quotes[number] | null = null, topProfit = 0;
        for (const x of quotes) {
          if (!x.q.canBuy || x.margin == null || x.margin <= 0) continue;
          const t = Math.max(0, Math.min(econ.cargoFree, Math.floor(econ.credits / x.q.buy)));
          if (t * x.margin > topProfit) { topProfit = t * x.margin; top = x; }
        }
        bestHaul = top ? `Best haul: <b>${top.q.c.name}</b> +${fmtNum(top.margin!)}/t${pool.length > 1 ? ` → ${top.at!.name}` : ''}
          · ~${cr(topProfit)} for what you can carry and afford`
          : 'Nothing bought here sells for more there right now.';
      }
      $('stCmpInfo').innerHTML = one ? `${ECONOMIES[one.def.station!.economy].label} · orbiting ${one.parent!.name} · ${this.whereIs(one)}<br>${bestHaul}`
        : comparing ? `Highest selling price among ${pool.length} stations${mode === 'best-sys' ? ' in this system' : ''}<br>${bestHaul}` : '';
      const rows = quotes.map(({ q, there, at, margin }) => {
        const held = econ.cargo[q.c.id] ?? 0;
        const paid = econ.paid[q.c.id];
        const rel = q.mid / q.c.base;
        const cls = rel < 0.85 ? 'cheap' : rel > 1.2 ? 'dear' : '';
        const tag = rel < 0.85 ? '<span class="tag cheap">EXPORT</span>' : rel > 1.2 ? '<span class="tag dear">IN DEMAND</span>' : '';
        const profit = held && paid ? q.sell - paid : 0;
        const trend = q.trend > 0.3 ? '▲' : q.trend < -0.3 ? '▼' : '';
        return `<tr class="${held ? 'held' : ''}">
          <td><div class="cn">${q.c.name}${q.c.restricted ? ' <span class="tag fic">RARE</span>' : ''} ${tag}</div><div class="cd">${q.c.desc}</div></td>
          <td class="num ${cls}">${q.canBuy ? fmtNum(q.buy) : '<span class="na">—</span>'}</td>
          <td class="num">${fmtNum(q.sell)} <span class="tr">${trend}</span></td>
          <td class="num">${held ? `${fmtNum(held)} t${paid ? `<div class="pf ${profit >= 0 ? 'up' : 'down'}">${profit >= 0 ? '+' : ''}${fmtNum(profit)}/t</div>` : ''}` : '<span class="na">—</span>'}</td>
          ${comparing ? `<td class="num there">${there ? fmtNum(there.sell) : ''}<div class="sub">${pool.length > 1 ? short(at!) : there!.canBuy ? `buy ${fmtNum(there!.buy)}` : 'not sold there'}</div></td>
          <td class="num">${margin == null ? '<span class="na">—</span>'
            : `<span class="mg ${margin > 0 ? 'up' : 'down'}">${margin > 0 ? '+' : ''}${fmtNum(margin)}</span>${q.canBuy ? '' : '<div class="sub">vs selling here</div>'}`}</td>` : ''}
          <td class="act">
            <button data-id="${q.c.id}" data-act="b1" ${q.canBuy ? '' : 'disabled'}>+1</button><button data-id="${q.c.id}" data-act="b10" ${q.canBuy ? '' : 'disabled'}>+10</button><button data-id="${q.c.id}" data-act="bmax" ${q.canBuy ? '' : 'disabled'}>MAX</button>
            <button class="s" data-id="${q.c.id}" data-act="s1" ${held ? '' : 'disabled'}>−1</button><button class="s" data-id="${q.c.id}" data-act="s10" ${held ? '' : 'disabled'}>−10</button><button class="s" data-id="${q.c.id}" data-act="sall" ${held ? '' : 'disabled'}>ALL</button>
          </td></tr>`;
      }).join('');
      const cmpHead = !comparing ? '' : `<th title="Selling price there">${one ? `SELL @ ${short(one).toUpperCase()}` : 'BEST SELL'}</th><th title="Selling price there minus buying price here">MARGIN /t</th>`;
      $('stMktTbl').innerHTML = `<table><thead><tr><th>COMMODITY</th><th>BUY</th><th>SELL</th><th>HOLD</th>${cmpHead}<th></th></tr></thead><tbody>${rows}</tbody></table>
        <div class="hint">Prices in credits per tonne. Your own trades move prices; markets recover over a few days. Rare goods can only be bought where they are produced.${comparing ? ' Other stations’ prices come live over the comms relay and will move as you trade there.' : ''}</div>`;
    } else if (this.tab === 'contracts') {
      const car = sim.career, offers = car.offers(st);
      const mine = car.contracts;
      $('stContracts').innerHTML = `<div class="lbl">CONTRACT BOARD · ${st.name}</div>
        ${offers.length ? offers.map(c => contractCard(sim, c, 'offer')).join('') : '<div class="hold-empty">No contracts on offer right now<br><span>New offers are posted every two days.</span></div>'}
        <div class="lbl" style="margin-top:12px">YOUR CONTRACTS · ${mine.length}/${MAX_CONTRACTS}</div>
        ${mine.length ? mine.map(c => contractCard(sim, c, 'active')).join('') : '<div class="hint">None yet.</div>'}
        <div class="hint">Courier cargo and passenger cabins take hold space until delivered. Deliveries are paid when you dock at the destination; procurement when you dock there with the goods; surveys when you return with the scan data.</div>`;
    } else if (this.tab === 'fleet') {
      $('stFleet').innerHTML = `<div class="lbl">YOUR FLEET · ${sim.career.fleet.length}/${MAX_FLEET}</div>${this.fleet?.html() ?? ''}`;
    } else if (this.tab === 'shipyard') {
      const th = shipThumbs();
      const trade = econ.tradeIn();
      $('stShipyard').innerHTML = SHIPS.map(s => {
        const cur = s.id === econ.shipId;
        const net = s.price - trade;
        return `<div class="shipcard ${cur ? 'cur' : ''}">
          <img src="${th[s.id]}" alt="${s.name}" />
          <div class="sc-body">
            <div class="sc-name">${s.name} <span>${s.role}</span></div>
            <div class="sc-desc">${s.desc}</div>
            <div class="sc-stats"><div><b>${fmtNum(s.cargo)} t</b><span>CARGO</span></div><div><b>${s.fuelCap} t</b><span>FUEL TANK</span></div>${s.miner ? `<div><b>${s.miner.rate} t/h</b><span>${s.miner.only ? 'ICE DRILL' : 'MINING RATE'}</span></div>` : ''}<div><b>${(6.1 * s.perf).toFixed(1)} g</b><span>AUTOPILOT ACCEL</span></div><div><b>${s.length} m</b><span>LENGTH</span></div><div><b>${cr(s.price)}</b><span>PRICE</span></div></div>
            ${cur ? '<div class="sc-cur">CURRENT SHIP · trade-in value ' + cr(trade) + '</div>'
              : `<button class="primary" data-ship="${s.id}" ${net > econ.credits ? 'disabled' : ''}>${net >= 0 ? 'BUY · ' + cr(net) + ' after trade-in' : 'DOWNGRADE · receive ' + cr(-net)}</button>`}
            <button class="fleetbtn" data-fleet="${s.id}" ${s.price > econ.credits || sim.career.fleet.length >= MAX_FLEET ? 'disabled' : ''} title="A hired crew flies it on a trade loop you choose">ADD TO FLEET · ${cr(s.price)}</button>
            <div class="sc-upkeep">Running costs ${cr(upkeepPerDay(s))}/day · port charges ${cr(dockingFee(s))} per docking</div>
          </div></div>`;
      }).join('');
    } else {
      const par = st.parent!;
      const alt = st.a - par.radius;
      const qs = econ.quotes(st, sim.t);
      const exp = qs.filter(q => q.canBuy).sort((a, b) => a.mid / a.c.base - b.mid / b.c.base).slice(0, 4);
      const imp = [...qs].sort((a, b) => b.mid / b.c.base - a.mid / a.c.base).slice(0, 4);
      $('stInfo').innerHTML = `<p>${st.def.desc}</p>
        <table class="kv">${st.def.station!.port
          ? `<tr><td>Location</td><td>${st.def.station!.port.lat.toFixed(2)}°, ${st.def.station!.port.lon.toFixed(2)}° on ${par.name}</td></tr><tr><td>Pad elevation</td><td>${fmtNum(st.portH)} m</td></tr>`
          : `<tr><td>Orbiting</td><td>${par.name}</td></tr><tr><td>Altitude</td><td>${fmtNum(alt / 1000)} km</td></tr>
        <tr><td>Orbital period</td><td>${(st.period / 3600).toFixed(2)} h</td></tr>`}<tr><td>Economy</td><td>${eco.label}</td></tr>
        <tr><td>Helionite (fuel)</td><td>${fmtNum(econ.fuelPrice(st, sim.t))} cr/t</td></tr>
        <tr><td>Cheap here</td><td>${exp.map(q => q.c.name).join(', ')}</td></tr><tr><td>Pays well for</td><td>${imp.map(q => q.c.name).join(', ')}</td></tr></table>
        <p class="hint">Tip: buy what a station exports, then sell it where it is in demand. Interstellar routes pay a 12% premium.</p>`;
    }
  }
}

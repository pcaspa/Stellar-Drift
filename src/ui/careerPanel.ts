import { COMMODITIES } from '../data/commodities';
import { SHIPS } from '../data/ships';
import type { Sim } from '../sim/sim';
import { type Body, type StarSystem, simTimeToDate } from '../sim/universe';
import { type Contract, CREW_SHARE, dockingFee, FLEET_CREW_CUT, FLEET_RESALE, MAX_CONTRACTS, MAX_FLEET, upkeepPerDay } from '../sim/career';
import { PIRATE_ESCAPE_M } from '../sim/pirates';
import { THRUST_LEVELS } from '../sim/sim';
import { confirmClick } from './confirm';
import { fmtDist, fmtNum } from './format';
import { SCAN_RANGE } from './scope';

const $ = (id: string) => document.getElementById(id)!;
const cr = (n: number) => `${fmtNum(Math.round(n))} cr`;
const DAY = 86400;
const KIND_LABEL: Record<Contract['kind'], string> = { courier: 'COURIER', passengers: 'PASSENGERS', procure: 'PROCUREMENT', survey: 'SURVEY' };

/** game date for the logbook */
export function fmtDate(t: number): string {
  const d = simTimeToDate(t);
  return isNaN(d.getTime()) ? `T+${(t / DAY).toFixed(2)} d` : d.toISOString().replace('T', ' ').slice(0, 16);
}

function left(s: number): string {
  if (s <= 0) return 'overdue';
  const d = s / DAY;
  return d >= 1.5 ? `${d.toFixed(1)} days left` : `${(s / 3600).toFixed(1)} h left`;
}

/** one contract as a card (used by the station board and the career panel) */
export function contractCard(sim: Sim, c: Contract, mode: 'offer' | 'active'): string {
  const car = sim.career;
  const cn = c.commodity ? COMMODITIES.find(x => x.id === c.commodity)?.name : '';
  const tLeft = c.deadline - sim.t;
  const urgent = tLeft < DAY * 0.5;
  let detail = '';
  if (c.kind === 'courier') detail = `${c.tonnes} t of sealed ${cn} (takes ${c.tonnes} t of hold space; can't be sold)`;
  else if (c.kind === 'passengers') detail = `${c.pax} ${c.client} (cabins take ${c.tonnes} t of hold space)`;
  else if (c.kind === 'procure') {
    const have = sim.econ.cargo[c.commodity!] ?? 0;
    detail = `buy or mine ${c.tonnes} t of ${cn} and bring it there${mode === 'active' ? ` · aboard: ${have}/${c.tonnes} t` : ''}`;
  } else if (!c.scan) detail = 'jump into the system to survey it (no station there — bring fuel)';
  else {
    const n = car.surveyNames(c), here = sim.system.id === c.survey;
    const step = (done: boolean, now: boolean, t: string) => `<div class="cc-step ${done ? 'done' : now ? 'now' : ''}">${done ? '✓' : now ? '▸' : '·'} ${t}</div>`;
    const arrived = here || !!c.scanned;
    detail = step(arrived, mode === 'active' && !arrived, `Jump to the uncharted <b>${n.sys}</b> system (no station there — carry spare Helionite)`)
      + step(!!c.scanned, mode === 'active' && arrived && !c.scanned, `Target <b>${n.body}</b> and scan it with the scope's SCAN button from within ${fmtDist(SCAN_RANGE)}`)
      + step(false, mode === 'active' && !!c.scanned, `Bring the survey data back to <b>${car.destName(c)}</b> and dock to get paid`);
  }
  const why = mode === 'offer' ? car.cantAccept(c) : null;
  return `<div class="ccard ${c.kind}">
    <div class="cc-main">
      <div class="cc-top"><span class="cc-kind">${KIND_LABEL[c.kind]}</span><span class="cc-client">${c.kind === 'passengers' ? 'Passenger transport' : c.client}</span></div>
      <div class="cc-dest">→ ${car.destName(c)}</div>
      <div class="cc-detail">${detail}</div>
    </div>
    <div class="cc-side">
      <div class="cc-reward">${cr(c.reward)}</div>
      <div class="cc-meta ${urgent ? 'urgent' : ''}">${left(tLeft)} · penalty ${cr(c.penalty)}</div>
      <div class="cc-btns">${mode === 'offer'
        ? `<button class="primary" data-accept="${c.id}" ${why ? `disabled title="${why}"` : ''}>ACCEPT</button>${why ? `<div class="cc-why">${why}</div>` : ''}`
        : `<button data-target="${c.id}">SET TARGET</button><button class="danger" data-abandon="${c.id}">ABANDON</button>`}</div>
    </div></div>`;
}

/**
 * Career panel (Z): active contracts, earnings and spending and the logbook (the fleet view is shown in the station dialog); plus the
 * raider alert while pirates are alongside.
 */
export class CareerPanel {
  open = false;
  private tab: 'contracts' | 'stats' | 'log' = 'contracts';
  private timer = 0;

  constructor(private sim: Sim, private toast: (m: string, k?: 'info' | 'warn' | 'good') => void,
    private onTarget: (t: Body | StarSystem) => void) {
    $('btnLog').onclick = () => this.toggle();
    $('logClose').onclick = () => this.toggle(false);
    for (const t of ['contracts', 'stats', 'log'] as const) $(`logTab_${t}`).onclick = () => { this.tab = t; this.render(); };
    $('logBody').addEventListener('click', e => this.click(e));
    $('logBody').addEventListener('keydown', e => e.stopPropagation());
    $('pirPay').onclick = () => sim.pirates.pay();
  }

  toggle(on = !this.open) {
    this.open = on;
    $('career').classList.toggle('hidden', !on);
    $('btnLog').classList.toggle('active', on);
    if (on) this.render();
  }

  /** handle the contract buttons (shared with the station's board) */
  contractClick(btn: HTMLButtonElement): boolean {
    const car = this.sim.career;
    if (btn.dataset.target) {
      const c = car.contracts.find(x => x.id === btn.dataset.target);
      const d = c && car.destBody(c);
      if (d) { this.onTarget(d); this.toast(`Target set: ${car.destName(c!)}`, 'info'); }
      return true;
    }
    if (btn.dataset.abandon) {
      if (!confirmClick(btn, 'CONFIRM')) return true;
      const c = car.contracts.find(x => x.id === btn.dataset.abandon);
      if (c) car.abandon(c);
      return true;
    }
    return false;
  }

  private click(e: Event) {
    const btn = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
    if (!btn) return;
    const car = this.sim.career;
    void car;
    if (this.contractClick(btn)) this.render();
  }

  /** fleet buttons (in the station's FLEET tab); returns true if handled */
  fleetClick(btn: HTMLButtonElement): boolean {
    if (!btn.dataset.sell) return false;
    if (!confirmClick(btn, 'CLICK TO SELL')) return true;
    const car = this.sim.career;
    const f = car.fleet.find(x => x.id === btn.dataset.sell);
    if (f) car.sellFleetShip(f);
    return true;
  }

  /** fleet loop selectors (in the station's FLEET tab) */
  fleetChange(e: Event) { this.change(e); }

  private change(e: Event) {
    const sel = e.target as HTMLSelectElement;
    const id = sel.dataset.fleet;
    if (!id) return;
    const f = this.sim.career.fleet.find(x => x.id === id);
    if (!f) return;
    if (sel.dataset.end === 'a') this.sim.career.assign(f, sel.value || undefined, f.b);
    else this.sim.career.assign(f, f.a, sel.value || undefined);
    sel.blur();
    this.render();
    this.onFleetChanged();
  }

  update(dt: number) {
    this.pirateUi();
    if (!this.open) return;
    this.timer -= dt;
    if (this.timer <= 0) { this.timer = 1; this.render(); }
  }

  private pirateUi() {
    const a = this.sim.pirates.active, el = $('pirate');
    el.classList.toggle('hidden', !a);
    if (!a) return;
    const s = this.sim.ship, d = a.rel.length();
    const mine = THRUST_LEVELS[THRUST_LEVELS.length - 1] * s.perf;
    const can = mine > a.acc;
    $('pirName').textContent = a.npc.name.replace(' (raider)', '');
    $('pirInfo').innerHTML = `${fmtDist(d)} away · they pull <b>${(a.acc / 9.81).toFixed(1)} g</b>, your drive at full power <b class="${can ? 'good' : 'bad'}">${(mine / 9.81).toFixed(1)} g</b>`;
    $('pirMsg').innerHTML = a.phase === 'demand'
      ? `Demand: <b>${cr(a.demand)}</b> · answer within <b>${Math.max(0, a.timer).toFixed(0)} s</b> or they board and take half your hold.`
      : `<b class="bad">Moving to board!</b> Get ${fmtDist(PIRATE_ESCAPE_M)} clear, reach a station's patrol zone, land or jump out.`;
    $('pirHint').textContent = can ? 'You can out-run them: full drive power (+) and hold W away from them.' : 'Your ship is too slow (or too laden) to out-run them: pay, reach a station, land or jump.';
    ($('pirPay') as HTMLButtonElement).textContent = this.sim.econ.credits >= a.demand ? `PAY ${cr(a.demand)}` : 'HAND OVER 25% OF CARGO';
  }

  private allStations(): Body[] { return this.sim.universe.systems.flatMap(s => s.bodies.filter(b => b.isStation)); }

  render() {
    if (!this.open) return;
    const sim = this.sim, car = sim.career, econ = sim.econ;
    for (const t of ['contracts', 'stats', 'log'] as const) $(`logTab_${t}`).classList.toggle('active', this.tab === t);
    $('logSub').textContent = `${cr(econ.credits)}${car.owed > 0.5 ? ` · ${cr(car.owed)} running costs owed` : ''}`;
    let h = '';
    if (this.tab === 'contracts') {
      h = car.contracts.length
        ? car.contracts.map(c => contractCard(sim, c, 'active')).join('')
        : `<div class="hold-empty">No active contracts<br><span>Dock at any station and open its CONTRACTS board. You can hold up to ${MAX_CONTRACTS}.</span></div>`;
      h += `<div class="hint">Deliveries are paid automatically when you dock at the destination; procurement when you dock there with the goods aboard; surveys when you bring the scan data back. Missing a deadline or abandoning costs the penalty.</div>`;
    } else if (this.tab === 'stats') h = this.stats();
    else if (this.tab === 'log') {
      h = car.log.length ? `<table class="logtbl">${[...car.log].reverse().slice(0, 200).map(l =>
        `<tr class="${l.kind}"><td class="num">${fmtDate(l.t)}</td><td>${l.msg}</td></tr>`).join('')}</table>`
        : '<div class="hold-empty">The logbook is empty</div>';
    }
    $('logBody').innerHTML = h;
  }

  private stats(): string {
    const sim = this.sim, car = sim.career, econ = sim.econ, k = car.counts;
    const days = Math.max(1e-3, (sim.t - car.startT) / DAY), hrs = Math.max(1e-3, car.playSec / 3600);
    const earned = car.totalEarned, spent = car.totalSpent, net = earned - spent;
    const row = (l: string, v: number, neg = false) => `<tr><td>${l}</td><td class="num ${neg ? 'down' : 'up'}">${neg ? '−' : ''}${cr(v)}</td></tr>`;
    const E: [string, string][] = [['trade', 'Trading profit'], ['mining', 'Mining sales'], ['contracts', 'Contracts'], ['survey', 'Survey bonuses'], ['fleet', 'Fleet loops'], ['other', 'Ship sales & other']];
    const S: [string, string][] = [['upkeep', 'Running costs (crew, maintenance)'], ['port', 'Port charges'], ['fuel', 'Fuel'], ['ships', 'Ships'], ['tow', 'Tows'], ['medical', 'Medical (crashes)'], ['pirates', 'Raiders'], ['penalties', 'Contract penalties']];
    const routes = Object.entries(car.routes).sort((a, b) => b[1].profit - a[1].profit).slice(0, 8);
    const ship = econ.ship, up = upkeepPerDay(ship);
    const fleetUp = car.upkeepRate - up;
    const n = (x: string) => fmtNum(k[x] ?? 0);
    return `<div class="statgrid">
      <div><div class="lbl">EARNED</div><table class="kv">${E.map(([id, l]) => row(l, car.earned[id] ?? 0)).join('')}<tr class="tot"><td>Total</td><td class="num up">${cr(earned)}</td></tr></table></div>
      <div><div class="lbl">SPENT</div><table class="kv">${S.map(([id, l]) => row(l, car.spent[id] ?? 0, true)).join('')}<tr class="tot"><td>Total</td><td class="num down">−${cr(spent)}</td></tr></table></div>
    </div>
    <div class="statline">Net <b class="${net >= 0 ? 'up' : 'down'}">${cr(net)}</b> · <b>${cr(net / days)}</b> per game day · <b>${cr(net / hrs)}</b> per hour played</div>
    <div class="statgrid">
      <div><div class="lbl">RUNNING COSTS</div><table class="kv">
        <tr><td>${ship.name}: crew wages</td><td class="num">${cr(up * CREW_SHARE)}/day</td></tr>
        <tr><td>${ship.name}: maintenance</td><td class="num">${cr(up * (1 - CREW_SHARE))}/day</td></tr>
        ${car.fleet.length ? `<tr><td>Fleet (${car.fleet.length} ships)</td><td class="num">${cr(fleetUp)}/day</td></tr>` : ''}
        <tr><td>Port charges per docking</td><td class="num">${cr(dockingFee(ship))}</td></tr>
        <tr class="tot"><td>Owed (paid at the next station)</td><td class="num">${cr(car.owed)}</td></tr></table></div>
      <div><div class="lbl">CAREER</div><table class="kv">
        <tr><td>Game days / hours played</td><td class="num">${days.toFixed(1)} d / ${hrs.toFixed(1)} h</td></tr>
        <tr><td>Distance flown</td><td class="num">${fmtDist(k.distance ?? 0)}</td></tr>
        <tr><td>Dockings · jumps</td><td class="num">${n('docks')} · ${n('jumps')}</td></tr>
        <tr><td>Systems surveyed</td><td class="num">${econ.visited.length}</td></tr>
        <tr><td>Tonnes mined · sold</td><td class="num">${n('tonnesMined')} · ${n('tonnesSold')}</td></tr>
        <tr><td>Contracts done · failed</td><td class="num">${n('contractsDone')} · ${n('contractsFailed')}</td></tr>
        <tr><td>Raiders: met · escaped · paid · boarded</td><td class="num">${n('pirateEncounters')} · ${n('pirateEscapes')} · ${n('piratePaid')} · ${n('pirateBoarded')}</td></tr>
        <tr><td>Crashes · tows</td><td class="num">${n('crashes')} · ${n('tows')}</td></tr></table></div>
    </div>
    <div class="lbl" style="margin-top:10px">BEST ROUTES</div>
    ${routes.length ? `<table class="kv">${routes.map(([key, r]) => `<tr><td>${key}</td><td class="num">${fmtNum(r.tonnes)} t · <span class="${r.profit >= 0 ? 'up' : 'down'}">${cr(r.profit)}</span></td></tr>`).join('')}</table>` : '<div class="hint">Sell some cargo to see which routes pay best.</div>'}`;
  }

  private stationOptions(sel: string | undefined): string {
    const here = this.sim.system;
    const systems = [...this.sim.universe.systems].filter(s => s.bodies.some(b => b.isStation))
      .sort((a, b) => (a === here ? -1 : 0) - (b === here ? -1 : 0) || a.galPos.distanceTo(here.galPos) - b.galPos.distanceTo(here.galPos));
    return `<option value="">— idle —</option>` + systems.map(s => `<optgroup label="${s.name}">${s.bodies.filter(b => b.isStation)
      .map(b => `<option value="${b.id}" ${b.id === sel ? 'selected' : ''}>${b.name}</option>`).join('')}</optgroup>`).join('');
  }

  /** called after a fleet change (the station re-renders its FLEET tab) */
  onFleetChanged: () => void = () => {};

  fleetHtml(): string {
    const car = this.sim.career;
    if (!car.fleet.length) return `<div class="hold-empty">You don't own any fleet ships yet<br><span>Buy one in the SHIPYARD tab with ADD TO FLEET (up to ${MAX_FLEET}). A hired crew flies it on a trade loop between two stations you choose and wires you the profit, less a ${FLEET_CREW_CUT * 100}% crew share.</span></div>`;
    void this.allStations;
    return car.fleet.map(f => {
      const c = SHIPS.find(s => s.id === f.shipId)!;
      const L = car.loopDays(f), p = car.loopProfit(f), up = upkeepPerDay(c);
      const A = f.a ? car.station(f.a) : undefined, B = f.b ? car.station(f.b) : undefined;
      const perDay = L ? p / L : 0;
      const ma = A && B ? car.bestMargin(A, B) : null, mb = A && B ? car.bestMargin(B, A) : null;
      const goods = (m: { id: string; m: number } | null) => m && m.id ? COMMODITIES.find(x => x.id === m.id)!.name : 'nothing profitable';
      return `<div class="fleetcard">
        <div class="fc-head"><b>"${f.name}"</b> <span>${c.name} · ${fmtNum(c.cargo)} t</span>
          <button class="danger" data-sell="${f.id}">SELL · ${cr(c.price * FLEET_RESALE)}</button></div>
        <div class="fc-route"><label>LOOP</label>
          <select data-fleet="${f.id}" data-end="a">${this.stationOptions(f.a)}</select> ⇄
          <select data-fleet="${f.id}" data-end="b">${this.stationOptions(f.b)}</select></div>
        ${L ? `<div class="fc-stats">
            <span>Loop <b>${L.toFixed(1)} d</b></span>
            <span>Carries ${goods(ma)} out, ${goods(mb)} back</span>
            <span>Profit/loop <b class="${p > 0 ? 'up' : 'down'}">${cr(p)}</b></span>
            <span>Per day <b class="${perDay > up ? 'up' : 'down'}">${cr(perDay)}</b> vs upkeep <b>${cr(up)}</b></span></div>
          <div class="bar"><div style="width:${Math.min(100, f.progress / L * 100).toFixed(1)}%"></div></div>
          <div class="fc-tot">${f.cycles} loops · last ${cr(f.lastProfit)} · total ${cr(f.totalProfit)}</div>`
          : `<div class="fc-tot">Idle — pick two stations for a trade loop. Still costs ${cr(up)}/day in crew and maintenance.</div>`}
      </div>`;
    }).join('') + `<div class="hint">Profits are wired to you at the end of each loop (prices at that moment). About 1 loop in 25 is lost to accidents or raiders. Fleet ships sell back for ${FLEET_RESALE * 100}% of their price.</div>`;
  }
}

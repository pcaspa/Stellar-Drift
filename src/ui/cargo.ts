import { COMMODITIES } from '../data/commodities';
import type { Sim } from '../sim/sim';
import type { Body } from '../sim/universe';
import { fmtNum } from './format';

const $ = (id: string) => document.getElementById(id)!;
const cr = (n: number) => `${fmtNum(Math.round(n))} cr`;

/**
 * Cargo hold manifest: every commodity aboard with its quantity, what you paid, and what it would
 * fetch (here when docked, otherwise at the best-paying station in this system). Cargo can be sold
 * from here while docked, or jettisoned in flight.
 */
export class CargoPanel {
  open = false;
  private timer = 0;
  /** jettison waiting for a second click (commodity id) */
  private armedDump = '';
  private armedUntil = 0;

  constructor(private sim: Sim, private toast: (m: string, k?: 'info' | 'warn' | 'good') => void) {
    $('cargoBtn').onclick = () => this.toggle();
    $('holdClose').onclick = () => this.toggle(false);
    $('holdBody').addEventListener('click', e => {
      const btn = (e.target as HTMLElement).closest('button');
      if (!btn) return;
      const id = btn.dataset.id!, act = btn.dataset.act!;
      const econ = this.sim.econ, c = COMMODITIES.find(x => x.id === id);
      const held = econ.cargo[id] ?? 0;
      if (!c || !held) return;
      const st = this.sim.ship.docked;
      if (act === 'load') {
        const n = econ.loadFuel();
        if (n > 0) this.toast(`Loaded ${n.toFixed(1)} t of Helionite into the tank`, 'good');
      } else if (act === 'sell' && st) {
        const got = econ.sell(st, id, held, this.sim.t);
        this.toast(`Sold ${fmtNum(held)} t of ${c.name} for ${cr(got)}`, 'good');
      } else if (act === 'dump' || act === 'dump1') {
        const n = act === 'dump1' ? 1 : held;
        // (in-game two-click confirm: the browser's confirm() dialog is blocked in some embedded views)
        if (act === 'dump' && !(this.armedDump === id && performance.now() < this.armedUntil)) {
          this.armedDump = id; this.armedUntil = performance.now() + 4000; this.render(); return;
        }
        this.armedDump = '';
        econ.jettison(id, n);
        this.toast(`Jettisoned ${fmtNum(n)} t of ${c.name}`, 'info');
      }
      this.sim.applyShipClass();
      this.render();
    });
  }

  toggle(on = !this.open) {
    this.open = on;
    $('hold').classList.toggle('hidden', !on);
    $('cargoBtn').classList.toggle('active', on);
    if (on) this.render();
  }

  update(dt: number) {
    if (!this.open) return;
    this.timer -= dt;
    if (this.timer <= 0) { this.timer = 0.5; this.render(); }
  }

  /** best selling price for a commodity: at the station you are docked at, else anywhere in this system */
  private bestSell(id: string): { price: number; at: Body | null } {
    const sim = this.sim, c = COMMODITIES.find(x => x.id === id)!;
    const here = sim.ship.docked;
    if (here) return { price: sim.econ.quote(here, c, sim.t).sell, at: here };
    let price = 0, at: Body | null = null;
    // buyers in this system; in uncharted space (no stations) the best buyer anywhere
    const local = sim.system.bodies.filter(b => b.isStation);
    const pool = local.length ? local : sim.universe.systems.flatMap(x => x.bodies.filter(b => b.isStation));
    for (const st of pool) {
      const q = sim.econ.quote(st, c, sim.t);
      if (q.sell > price) { price = q.sell; at = st; }
    }
    return { price, at };
  }

  private render() {
    const sim = this.sim, econ = sim.econ, docked = sim.ship.docked;
    const used = econ.cargoUsed, cap = econ.ship.cargo;
    $('holdSub').textContent = `${econ.ship.name} · ${fmtNum(used)} / ${fmtNum(cap)} t · ${fmtNum(Math.max(0, cap - used))} t free`;
    ($('holdBar') as HTMLElement).style.width = `${Math.min(100, used / cap * 100)}%`;
    const items = Object.entries(econ.cargo).filter(([, t]) => t > 0)
      .map(([id, t]) => ({ id, t, c: COMMODITIES.find(x => x.id === id)!, paid: econ.paid[id], ...this.bestSell(id) }))
      .filter(x => x.c)
      .sort((a, b) => b.t * b.price - a.t * a.price);
    // contract cargo and passenger cabins: aboard, but not yours to sell
    const held = sim.career.contracts.filter(c => c.kind === 'courier' || c.kind === 'passengers');
    const contractRows = held.map(c => `<tr class="contract"><td><div class="cn">${c.kind === 'courier' ? `Sealed ${COMMODITIES.find(x => x.id === c.commodity)?.name ?? ''}` : `${c.pax} passengers (cabins)`} <span class="tag">CONTRACT</span></div></td>
        <td class="num">${fmtNum(c.tonnes)} t</td><td colspan="3" class="num"><div class="sub">for ${sim.career.destName(c)} · pays ${cr(c.reward)}</div></td><td></td></tr>`).join('');
    if (!items.length) {
      $('holdBody').innerHTML = held.length ? `<table><tbody>${contractRows}</tbody></table>`
        : `<div class="hold-empty">The hold is empty.<br><span>Buy goods at a station market, or mine an asteroid.</span></div>`;
      return;
    }
    let total = 0, cost = 0;
    const rows = items.map(x => {
      const value = x.t * x.price;
      total += value; cost += (x.paid ?? 0) * x.t;
      const pf = x.paid !== undefined ? x.price - x.paid : null;
      const share = x.t / cap * 100;
      return `<tr>
        <td><div class="cn">${x.c.name}${x.c.restricted ? ' <span class="tag fic">RARE</span>' : ''}</div>
          <div class="hbar"><div style="width:${share.toFixed(1)}%"></div></div></td>
        <td class="num">${fmtNum(x.t)} t</td>
        <td class="num">${x.paid === undefined ? '—' : x.paid === 0 ? '<span class="mined">MINED</span>' : fmtNum(x.paid)}</td>
        <td class="num">${x.price ? fmtNum(x.price) : '—'}<div class="sub">${x.at ? (docked ? 'here' : x.at.system === sim.system ? x.at.name : `${x.at.name} (${x.at.system.name})`) : 'no buyer'}</div></td>
        <td class="num">${fmtNum(value)}${pf !== null && x.paid ? `<div class="pf ${pf >= 0 ? 'up' : 'down'}">${pf >= 0 ? '+' : ''}${fmtNum(pf)}/t</div>` : ''}</td>
        <td class="act">${x.id === 'helionite' && econ.fuel < econ.ship.fuelCap - 0.05 ? `<button data-id="${x.id}" data-act="load" title="Move it into the fuel tank">LOAD TANK</button>` : ''}${docked
          ? `<button data-id="${x.id}" data-act="sell" title="Sell all of it here">SELL ALL</button>`
          : `<button class="s" data-id="${x.id}" data-act="dump1" title="Jettison one tonne">−1</button><button class="s" data-id="${x.id}" data-act="dump" title="Jettison all of it">${this.armedDump === x.id && performance.now() < this.armedUntil ? 'CONFIRM' : 'JETTISON'}</button>`}</td>
      </tr>`;
    }).join('');
    $('holdBody').innerHTML = `<table>
      <thead><tr><th>COMMODITY</th><th>QTY</th><th>PAID /t</th><th>${docked ? 'SELL HERE' : 'BEST SELL'}</th><th>VALUE</th><th></th></tr></thead>
      <tbody>${rows}${contractRows}</tbody></table>
      <div class="hold-total"><span>${items.length} commodit${items.length === 1 ? 'y' : 'ies'} aboard</span>
        <span>Value ${docked ? 'here' : 'at best prices'}: <b>${cr(total)}</b>${cost > 0 ? ` · paid ${cr(cost)}` : ''}</span></div>`;
  }
}

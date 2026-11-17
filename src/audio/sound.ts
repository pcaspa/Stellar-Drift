import { Vector3 } from 'three';
import type { Sim } from '../sim/sim';

const PREF_KEY = 'stellardrift.sound';

/**
 * Procedural sound effects (Web Audio, no sample files): engine rumble, RCS hiss, atmospheric
 * wind and re-entry roar, mining drills, jump-drive spool, plus one-shots for docking, landing,
 * warnings and UI clicks. The audio context starts on the first user gesture, as browsers require.
 */
export class Sound {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private white!: AudioBuffer;
  private brown!: AudioBuffer;
  enabled = true;

  // continuous voices
  private engG!: GainNode; private engF!: BiquadFilterNode; private engO!: OscillatorNode;
  private rcsG!: GainNode;
  private windG!: GainNode; private windF!: BiquadFilterNode;
  private drillG!: GainNode;
  private spoolG!: GainNode; private spoolO!: OscillatorNode; private spoolO2!: OscillatorNode;

  // state for edge detection
  private prevLanded: unknown = undefined;
  private prevDocked: unknown = undefined;
  private prevSystem: unknown = undefined;
  private prevAng = new Vector3();
  private rcsLevel = 0;

  constructor(private sim: Sim) {
    try { this.enabled = localStorage.getItem(PREF_KEY) !== 'off'; } catch { /* ignore */ }
    const start = () => this.init();
    window.addEventListener('pointerdown', start, { once: false });
    window.addEventListener('keydown', start, { once: false });
    // a soft click for every button press
    document.addEventListener('click', e => { if ((e.target as HTMLElement).closest('button')) this.click(); }, true);
  }

  toggle(): boolean {
    this.enabled = !this.enabled;
    try { localStorage.setItem(PREF_KEY, this.enabled ? 'on' : 'off'); } catch { /* ignore */ }
    if (this.ctx) this.master.gain.setTargetAtTime(this.enabled ? 0.55 : 0, this.ctx.currentTime, 0.05);
    return this.enabled;
  }

  private init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') void this.ctx.resume(); return; }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain();
    this.master.gain.value = this.enabled ? 0.55 : 0;
    // gentle limiter so stacked effects never clip
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12; comp.ratio.value = 6;
    this.master.connect(comp).connect(ctx.destination);

    const n = ctx.sampleRate * 2;
    this.white = ctx.createBuffer(1, n, ctx.sampleRate);
    this.brown = ctx.createBuffer(1, n, ctx.sampleRate);
    const w = this.white.getChannelData(0), b = this.brown.getChannelData(0);
    let last = 0;
    for (let i = 0; i < n; i++) {
      w[i] = Math.random() * 2 - 1;
      last = (last + 0.02 * w[i]) / 1.02;
      b[i] = last * 3.5;
    }

    // engine: low brown-noise rumble with a sub-bass drone
    this.engG = this.gain(0);
    this.engF = ctx.createBiquadFilter(); this.engF.type = 'lowpass'; this.engF.frequency.value = 150; this.engF.Q.value = 0.7;
    this.loop(this.brown).connect(this.engF).connect(this.engG);
    this.engO = ctx.createOscillator(); this.engO.type = 'sawtooth'; this.engO.frequency.value = 36;
    const engOF = ctx.createBiquadFilter(); engOF.type = 'lowpass'; engOF.frequency.value = 110;
    const engOG = ctx.createGain(); engOG.gain.value = 0.25;
    this.engO.connect(engOF).connect(engOG).connect(this.engG);
    this.engO.start();

    // RCS: short hissing puffs
    this.rcsG = this.gain(0);
    const rcsF = ctx.createBiquadFilter(); rcsF.type = 'highpass'; rcsF.frequency.value = 2500;
    this.loop(this.white).connect(rcsF).connect(this.rcsG);

    // atmosphere: wind / plasma roar
    this.windG = this.gain(0);
    this.windF = ctx.createBiquadFilter(); this.windF.type = 'bandpass'; this.windF.frequency.value = 400; this.windF.Q.value = 0.6;
    this.loop(this.white).connect(this.windF).connect(this.windG);

    // mining drills: band-passed grinding, chopped by a low-frequency square wave
    this.drillG = this.gain(0);
    const drillF = ctx.createBiquadFilter(); drillF.type = 'bandpass'; drillF.frequency.value = 220; drillF.Q.value = 2;
    const chop = ctx.createGain(); chop.gain.value = 0.6;
    const lfo = ctx.createOscillator(); lfo.type = 'square'; lfo.frequency.value = 9;
    const lfoG = ctx.createGain(); lfoG.gain.value = 0.4;
    lfo.connect(lfoG).connect(chop.gain); lfo.start();
    this.loop(this.brown).connect(drillF).connect(chop).connect(this.drillG);

    // jump drive spool: two detuned rising tones
    this.spoolG = this.gain(0);
    this.spoolO = ctx.createOscillator(); this.spoolO.type = 'sine';
    this.spoolO2 = ctx.createOscillator(); this.spoolO2.type = 'triangle';
    const sp2 = ctx.createGain(); sp2.gain.value = 0.35;
    this.spoolO.connect(this.spoolG); this.spoolO2.connect(sp2).connect(this.spoolG);
    this.spoolO.start(); this.spoolO2.start();

    this.prevLanded = this.sim.ship.landed;
    this.prevDocked = this.sim.ship.docked;
    this.prevSystem = this.sim.system;
  }

  private gain(v: number): GainNode {
    const g = this.ctx!.createGain(); g.gain.value = v; g.connect(this.master); return g;
  }

  private loop(buf: AudioBuffer): AudioBufferSourceNode {
    const s = this.ctx!.createBufferSource();
    s.buffer = buf; s.loop = true;
    s.loopStart = Math.random(); // decorrelate voices sharing a buffer
    s.start(0, Math.random() * 1.5);
    return s;
  }

  private set(p: AudioParam, v: number, tau = 0.08) { p.setTargetAtTime(v, this.ctx!.currentTime, tau); }

  /** per-frame update of the continuous sounds and event detection */
  update(dt: number, started: boolean) {
    const ctx = this.ctx;
    if (!ctx || !this.enabled || dt <= 0) return;
    const sim = this.sim, s = sim.ship;
    if (!started) { for (const g of [this.engG, this.rcsG, this.windG, this.drillG, this.spoolG]) this.set(g.gain, 0); return; }

    // engine: loudness and brightness follow thrust
    const thr = Math.min(1, s.thrustAccel.length() / Math.max(1, s.maxAccel));
    this.set(this.engG.gain, thr > 0.001 ? 0.12 + 0.55 * Math.sqrt(thr) : 0, thr > 0.001 ? 0.06 : 0.25);
    this.set(this.engF.frequency, 140 + 700 * thr);
    this.set(this.engO.frequency, 34 + 18 * thr);

    // RCS: rotation commands and attitude changes made by the autopilot
    const angAcc = this.prevAng.distanceTo(s.angVel) / dt;
    this.prevAng.copy(s.angVel);
    const want = Math.min(1, s.rotInput.length() * 0.8 + angAcc * 2);
    this.rcsLevel += (want - this.rcsLevel) * Math.min(1, dt * 12);
    this.set(this.rcsG.gain, s.landed ? 0 : this.rcsLevel * 0.18, 0.03);

    // atmosphere: wind rises with dynamic pressure, deepening into a roar when heating
    let wind = 0;
    if (sim.density > 1e-7 && !s.landed) {
      const d = sim.dominant;
      const v = new Vector3().subVectors(s.vel, d.vel).length();
      const q = 0.5 * sim.density * v * v;
      wind = Math.min(1, Math.sqrt(q / 40000));
      this.set(this.windF.frequency, 250 + Math.min(1600, v / 6));
    }
    const roar = Math.min(1, sim.heat / 3e6);
    this.set(this.windG.gain, Math.min(0.7, wind * 0.5 + roar * 0.35), 0.2);

    // mining
    this.set(this.drillG.gain, sim.mining ? 0.35 : 0, 0.15);

    // jump drive spool
    const ch = sim.jumpArmed ? sim.jumpCharge : 0;
    this.set(this.spoolG.gain, ch > 0 ? 0.08 + 0.18 * ch : 0, 0.1);
    this.set(this.spoolO.frequency, 180 + 1200 * ch * ch);
    this.set(this.spoolO2.frequency, 183 + 1206 * ch * ch);

    // events
    if (sim.system !== this.prevSystem) { this.prevSystem = sim.system; this.whoosh(); }
    if (s.docked !== this.prevDocked) {
      if (s.docked) this.clunk(true); else if (this.prevDocked) { this.clunk(false); this.hiss(0.6); }
      this.prevDocked = s.docked;
    }
    if (s.landed !== this.prevLanded) {
      if (s.landed && !s.docked) this.thump();
      this.prevLanded = s.landed;
    }
  }

  // ------------------------------------------------------------- one-shots
  private env(g: GainNode, peak: number, attack: number, decay: number, t0 = this.ctx!.currentTime) {
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
  }

  private tone(type: OscillatorType, f0: number, f1: number, peak: number, dur: number, delay = 0) {
    const ctx = this.ctx!, t0 = ctx.currentTime + delay;
    const o = ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t0); o.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
    const g = this.gain(0); this.env(g, peak, 0.005, dur, t0);
    o.connect(g); o.start(t0); o.stop(t0 + dur + 0.05);
    o.onended = () => g.disconnect();
  }

  private noise(type: BiquadFilterType, f0: number, f1: number, peak: number, attack: number, dur: number, buf = this.white) {
    const ctx = this.ctx!, t0 = ctx.currentTime;
    const s = ctx.createBufferSource(); s.buffer = buf;
    const f = ctx.createBiquadFilter(); f.type = type; f.Q.value = 0.8;
    f.frequency.setValueAtTime(f0, t0); f.frequency.exponentialRampToValueAtTime(f1, t0 + attack + dur);
    const g = this.gain(0); this.env(g, peak, attack, dur, t0);
    s.connect(f).connect(g); s.start(t0); s.stop(t0 + attack + dur + 0.05);
    s.onended = () => g.disconnect();
  }

  private ready() { return !!this.ctx && this.enabled; }

  click() { if (this.ready()) this.tone('square', 1800, 1200, 0.04, 0.03); }

  /** docking clamps engaging (or releasing): a heavy thud with a metallic ring */
  clunk(engage: boolean) {
    if (!this.ready()) return;
    this.tone('sine', engage ? 90 : 120, 40, 0.6, 0.35);
    this.noise('lowpass', 900, 120, 0.4, 0.002, 0.25, this.brown);
    this.tone('triangle', 620, 600, 0.08, 0.6, 0.02);
    this.tone('triangle', 931, 925, 0.05, 0.5, 0.02);
    if (engage) { this.tone('sine', 80, 40, 0.4, 0.3, 0.18); this.hiss(0.35); }
  }

  /** pressure equalisation */
  hiss(level: number) { if (this.ready()) this.noise('highpass', 3000, 1500, 0.12 * level, 0.05, 0.9); }

  /** touchdown on a planet or asteroid */
  thump() {
    if (!this.ready()) return;
    this.tone('sine', 70, 30, 0.7, 0.45);
    this.noise('lowpass', 500, 80, 0.5, 0.004, 0.5, this.brown);
  }

  /** jump transit: a rising roar that peaks as the ship jumps */
  warpIn(dur: number) {
    if (!this.ready()) return;
    const ctx = this.ctx!, t0 = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = this.white; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 1.2;
    f.frequency.setValueAtTime(150, t0); f.frequency.exponentialRampToValueAtTime(4000, t0 + dur);
    const g = this.gain(0);
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.6, t0 + dur); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur + 0.25);
    src.connect(f).connect(g); src.start(t0); src.stop(t0 + dur + 0.3);
    src.onended = () => g.disconnect();
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(60, t0); o.frequency.exponentialRampToValueAtTime(900, t0 + dur);
    const og = this.gain(0); og.gain.setValueAtTime(0.0001, t0); og.gain.exponentialRampToValueAtTime(0.12, t0 + dur); og.gain.exponentialRampToValueAtTime(0.0001, t0 + dur + 0.2);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1200;
    o.connect(lp).connect(og); o.start(t0); o.stop(t0 + dur + 0.25);
    o.onended = () => og.disconnect();
  }

  /** crash: a deep impact boom, a burst of debris noise and a metallic groan */
  crash() {
    if (!this.ready()) return;
    this.tone('sine', 55, 22, 1.0, 0.9);
    this.noise('lowpass', 1800, 90, 0.9, 0.005, 1.1, this.brown);
    this.noise('bandpass', 3000, 400, 0.35, 0.01, 0.6);
    this.tone('sawtooth', 160, 70, 0.12, 1.2, 0.15);
  }

  /** arrival after a jump */
  whoosh() {
    if (!this.ready()) return;
    this.noise('bandpass', 2400, 120, 0.5, 0.08, 1.8);
    this.tone('sine', 900, 50, 0.3, 1.6);
  }

  /** message chimes: warning double beep, success rising chime */
  alert(kind: 'info' | 'warn' | 'good') {
    if (!this.ready()) return;
    if (kind === 'warn') { this.tone('square', 880, 880, 0.06, 0.12); this.tone('square', 660, 660, 0.06, 0.14, 0.16); }
    else if (kind === 'good') { this.tone('sine', 660, 660, 0.12, 0.18); this.tone('sine', 990, 990, 0.12, 0.3, 0.1); }
    else this.tone('sine', 740, 740, 0.07, 0.15);
  }
}

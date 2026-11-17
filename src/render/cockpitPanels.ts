import { Euler, PerspectiveCamera, Vector3 } from 'three';

/** a flat display in camera space (camera looks down -Z), metres; rotation order YXZ */
export interface MfdPose { x: number; y: number; z: number; ry: number; rx: number; w: number; h: number; }

export interface DashLayout {
  /** console face: top edge centre, tilt, and the height that is visible on screen */
  top: Vector3; rx: number; visH: number; width: number;
  /** "down the face" direction and face normal */
  down: Vector3; normal: Vector3;
  nav: MfdPose; scope: MfdPose; att: MfdPose; status: MfdPose; ap: MfdPose;
  /** target screen: beside the autopilot, under the status screen */
  tgt: MfdPose;
  /** screen-space y (fraction of viewport height) of the console's top edge */
  topFrac: number;
}

const VFOV_HALF = 27.5 * Math.PI / 180;
/** console top edge sits this far below the centre of view */
const TOP_ANGLE = 5 * Math.PI / 180;
const TOP_DEPTH = 1.1;
const TILT = -0.22;
/** screen-space y of the console's top edge as a fraction of viewport height */
export const DASH_TOP_FRAC = 0.5 + 0.5 * Math.tan(TOP_ANGLE) / Math.tan(VFOV_HALF);

/**
 * The cockpit console: a large tilted panel filling the bottom ~40% of the view, with the
 * navigation display (left), attitude + status screens (centre) and the scope (right) set
 * flush into its face. Shared by the 3D cockpit and the DOM panel placement so they line up.
 */
export function dashLayout(aspect: number, scopeRatio: number): DashLayout {
  const tanV = Math.tan(VFOV_HALF), tanH = tanV * aspect;
  const top = new Vector3(0, -TOP_DEPTH * Math.tan(TOP_ANGLE), -TOP_DEPTH);
  const down = new Vector3(0, -Math.cos(TILT), -Math.sin(TILT));   // along the face, away from the top edge
  const normal = new Vector3(0, Math.sin(-TILT), Math.cos(TILT));  // facing up/back towards the pilot
  // how far down the face is still on screen (where the ray hits the bottom edge of the view)
  const visH = (tanV * -top.z + top.y) / (-down.y + tanV * down.z);
  // usable half-width at the console's depth, scaled down on narrow windows
  const halfW = tanH * (-top.z + visH * 0.5 * down.z * -1);
  const k = Math.min(1, halfW / 0.95);
  const margin = 0.03;
  const at = (u: number, s: number, w: number, h: number): MfdPose => {
    const p = top.clone().addScaledVector(down, s).addScaledVector(normal, 0.006);
    return { x: u, y: p.y, z: p.z, rx: TILT, ry: 0, w, h };
  };
  // fit each display into the visible band of the face
  const band = visH - margin * 2;
  // navigation: fixed width, the full height of the band (its DOM height is set to match)
  const navW = 0.44 * k, navH = band;
  const scW = Math.min(0.42 * k, band / scopeRatio), scH = scW * scopeRatio;
  const sideU = halfW - margin - 0.02;
  // centre columns: attitude (4:3) with the autopilot screen beneath it; status (4:3) beside it
  const apMin = 0.13, gap = 0.018;
  const centreW = Math.min(0.34 * k, (2 * sideU - navW - scW - 0.08) / 2 - 0.02, (band - apMin - gap) / 0.75);
  const attH = centreW * 0.75;
  const apH = band - attH - gap;
  const leftX = -(centreW / 2 + 0.015), rightX = centreW / 2 + 0.015;
  return {
    top, rx: TILT, visH, width: 2 * halfW + 1.2, down, normal,
    nav: at(-(sideU - navW / 2), margin + navH / 2, navW, navH),
    scope: at(sideU - scW / 2, margin + scH / 2, scW, scH),
    att: at(leftX, margin + attH / 2, centreW, attH),
    ap: at(leftX, margin + attH + gap + apH / 2, centreW, apH),
    status: at(rightX, margin + attH / 2, centreW, attH),
    tgt: at(rightX, margin + attH + gap + apH / 2, centreW, apH),
    topFrac: 0.5 + 0.5 * Math.tan(TOP_ANGLE) / tanV,
  };
}

/** CSS matrix3d mapping an element of size w×h onto the screen quad p0..p3 (TL, TR, BR, BL) */
function quadMatrix(w: number, h: number, p: [number, number][]): string {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = p;
  const sx = x0 - x1 + x2 - x3, sy = y0 - y1 + y2 - y3;
  let a: number, b: number, c: number, d: number, e: number, f: number, g = 0, k = 0;
  if (Math.abs(sx) < 1e-9 && Math.abs(sy) < 1e-9) {
    a = x1 - x0; b = x3 - x0; c = x0; d = y1 - y0; e = y3 - y0; f = y0;
  } else {
    const dx1 = x1 - x2, dx2 = x3 - x2, dy1 = y1 - y2, dy2 = y3 - y2;
    const den = dx1 * dy2 - dx2 * dy1;
    g = (sx * dy2 - dx2 * sy) / den;
    k = (dx1 * sy - sx * dy1) / den;
    a = x1 - x0 + g * x1; b = x3 - x0 + k * x3; c = x0;
    d = y1 - y0 + g * y1; e = y3 - y0 + k * y3; f = y0;
  }
  a /= w; d /= w; g /= w; b /= h; e /= h; k /= h;
  const m = [a, d, 0, g, b, e, 0, k, 0, 0, 1, 0, c, f, 0, 1];
  return `matrix3d(${m.map(v => v.toFixed(8)).join(',')})`;
}

const _e = new Euler(), _r = new Vector3(), _u = new Vector3(), _c = new Vector3(), _p = new Vector3();

/**
 * In cockpit view the navigation panel and the scope become screens set into the console.
 * The DOM panels stay in the page (fully interactive); each frame they get a perspective
 * transform mapping them onto the projected corners of their spot on the 3D console.
 */
export class CockpitPanels {
  active = false;
  /** container for the autopilot section while it is mounted under the artificial horizon */
  private apBox: HTMLElement;
  /** container for the target section, beside the autopilot screen */
  private tgtBox: HTMLElement;
  /** nav sections moved onto their own console screens: section, screen, and where it came from */
  private mounts: { sec: HTMLElement; box: HTMLElement; home: { parent: HTMLElement; next: Node | null; collapsed: boolean } | null }[];

  constructor(private nav: HTMLElement, private scope: HTMLElement) {
    const box = (id: string) => {
      const b = document.createElement('div');
      b.id = id; b.className = 'panel';
      document.getElementById('hud')!.appendChild(b);
      return b;
    };
    this.apBox = box('cockpitAp');
    this.tgtBox = box('cockpitTgt');
    this.mounts = [
      { sec: document.getElementById('secAp')!, box: this.apBox, home: null },
      { sec: document.getElementById('secTarget')!, box: this.tgtBox, home: null },
    ];
  }

  layout(aspect: number): DashLayout {
    const scR = this.scope.offsetHeight / Math.max(1, this.scope.offsetWidth) || 1.1;
    return dashLayout(aspect, scR);
  }

  /** size an element's height so its aspect matches its spot on the console */
  private fitHeight(el: HTMLElement, pose: MfdPose) {
    const h = Math.round(el.offsetWidth * pose.h / pose.w);
    if (Math.abs(el.offsetHeight - h) > 1) el.style.height = `${h}px`;
  }

  private mountSections(on: boolean) {
    for (const m of on ? this.mounts : [...this.mounts].reverse()) {
      if (on && !m.home) {
        m.home = { parent: m.sec.parentElement!, next: m.sec.nextSibling, collapsed: m.sec.classList.contains('collapsed') };
        m.sec.classList.remove('collapsed');
        m.box.appendChild(m.sec);
      } else if (!on && m.home) {
        m.home.parent.insertBefore(m.sec, m.home.next);
        m.sec.classList.toggle('collapsed', m.home.collapsed);
        m.home = null;
      }
    }
  }

  private place(el: HTMLElement, pose: MfdPose, camera: PerspectiveCamera) {
    const W = window.innerWidth, H = window.innerHeight;
    const fpx = (H / 2) / Math.tan(camera.fov * Math.PI / 360);
    _e.set(pose.rx, pose.ry, 0, 'YXZ');
    _r.set(1, 0, 0).applyEuler(_e).multiplyScalar(pose.w / 2);
    _u.set(0, 1, 0).applyEuler(_e).multiplyScalar(pose.h / 2);
    _c.set(pose.x, pose.y, pose.z);
    const corners: [number, number][] = [];
    for (const [sr, su] of [[-1, 1], [1, 1], [1, -1], [-1, -1]]) {
      _p.copy(_c).addScaledVector(_r, sr).addScaledVector(_u, su);
      const iz = 1 / Math.max(1e-3, -_p.z);
      corners.push([W / 2 + _p.x * iz * fpx, H / 2 - _p.y * iz * fpx]);
    }
    el.style.transform = quadMatrix(el.offsetWidth, el.offsetHeight, corners);
  }

  update(on: boolean, camera: PerspectiveCamera): DashLayout | null {
    if (on !== this.active) {
      this.active = on;
      document.body.classList.toggle('cockpit-panels', on);
      this.mountSections(on);
      if (!on) {
        for (const el of [this.nav, this.scope, this.apBox, this.tgtBox]) { el.style.transform = ''; el.style.height = ''; }
      }
    }
    if (!on) return null;
    const L = this.layout(camera.aspect);
    this.fitHeight(this.nav, L.nav);
    this.fitHeight(this.apBox, L.ap);
    this.fitHeight(this.tgtBox, L.tgt);
    this.place(this.nav, L.nav, camera);
    this.place(this.scope, L.scope, camera);
    this.place(this.apBox, L.ap, camera);
    this.place(this.tgtBox, L.tgt, camera);
    return L;
  }
}

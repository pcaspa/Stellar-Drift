import {
  BoxGeometry, CanvasTexture, CylinderGeometry, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, PointLight,
  Quaternion, SRGBColorSpace, Vector3,
} from 'three';
import type { DashLayout, MfdPose } from './cockpitPanels';

/**
 * Cockpit interior shown in cockpit view, built in camera space (camera looks down -Z) and
 * re-attached to the camera every frame. The console face, its screens and the recessed frames
 * for the navigation display and scope are placed from the shared DashLayout so the DOM panels
 * mounted on it line up exactly.
 */
export class Cockpit {
  readonly group = new Group();
  readonly statusCanvas = document.createElement('canvas');
  readonly attCanvas = document.createElement('canvas');
  private screens: CanvasTexture[] = [];
  private face: Mesh;
  private coaming: Mesh;
  private lowerBody: Mesh;
  private attScreen: Mesh;
  private statusScreen: Mesh;
  private frames: Mesh[] = [];
  private switches = new Group();
  private big = false;
  private layoutKey = '';

  constructor() {
    this.statusCanvas.width = 512; this.statusCanvas.height = 384;
    this.attCanvas.width = 512; this.attCanvas.height = 384;
    const shell = new MeshStandardMaterial({ color: '#16191e', roughness: 0.95, metalness: 0.05, envMapIntensity: 0.2 });
    const trim = new MeshStandardMaterial({ color: '#3a3f48', roughness: 0.45, metalness: 0.7 });
    const frame = new MeshStandardMaterial({ color: '#121519', roughness: 0.55, metalness: 0.5 });
    const g = this.group;
    const mesh = (geo: BoxGeometry | CylinderGeometry | PlaneGeometry, mat: MeshStandardMaterial | MeshBasicMaterial) => {
      const m = new Mesh(geo, mat);
      m.castShadow = true; m.receiveShadow = true; m.renderOrder = 9900;
      g.add(m);
      return m;
    };
    // console face + body beneath it, padded coaming along the top edge
    this.face = mesh(new BoxGeometry(1, 1, 1), shell);
    this.lowerBody = mesh(new BoxGeometry(1, 1, 1), shell);
    this.coaming = mesh(new BoxGeometry(1, 1, 1), trim);
    // recessed bezels for the two DOM displays (navigation, scope)
    for (let i = 0; i < 4; i++) this.frames.push(mesh(new BoxGeometry(1, 1, 1), frame));
    // attitude + status screens
    const screen = (src: HTMLCanvasElement) => {
      const tex = new CanvasTexture(src);
      tex.colorSpace = SRGBColorSpace;
      this.screens.push(tex);
      const bezel = mesh(new BoxGeometry(1, 1, 1), frame);
      const scr = new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial({ map: tex, toneMapped: false }));
      scr.position.z = 0.51; scr.renderOrder = 9901;
      bezel.add(scr);
      return bezel;
    };
    this.attScreen = screen(this.attCanvas);
    this.statusScreen = screen(this.statusCanvas);
    // switch banks under the centre screens
    for (let r = 0; r < 2; r++) for (let c = 0; c < 14; c++) {
      const sw = new Mesh(new BoxGeometry(0.022, 0.022, 0.018), c % 5 === 4 ? new MeshStandardMaterial({ color: '#d9a520', roughness: 0.4, metalness: 0.3, emissive: '#3a2a00' }) : trim);
      sw.position.set((c - 6.5) * 0.034, -r * 0.04, 0);
      sw.renderOrder = 9900;
      this.switches.add(sw);
    }
    g.add(this.switches);

    // canopy frame: side pillars and a top arch (kept to the edges of the view)
    const pillar = (x: number, y: number, z: number, rx: number, rz: number, h: number) => {
      const m = mesh(new BoxGeometry(0.07, h, 0.1), frame);
      m.position.set(x, y, z); m.rotation.set(rx, 0, rz);
    };
    for (const s of [-1, 1]) { pillar(s * 1.0, 0.25, -1.3, 0.15, s * 0.32, 1.9); pillar(s * 1.75, 0.45, -0.8, 0.1, s * 0.85, 1.6); }
    const arch = mesh(new BoxGeometry(3.0, 0.08, 0.12), frame);
    arch.position.set(0, 0.66, -1.32); arch.rotation.x = 0.35;
    const rail = mesh(new CylinderGeometry(0.018, 0.018, 2.6, 8), trim);
    rail.position.set(0, 0.71, -1.26); rail.rotation.z = Math.PI / 2;
    // big-ship bridges get mullions
    const mull = new Group();
    for (const s of [-1, 1]) {
      const m = new Mesh(new BoxGeometry(0.05, 1.4, 0.08), frame);
      m.position.set(s * 0.55, 0.35, -1.45); m.rotation.x = 0.18;
      mull.add(m);
    }
    const hb = new Mesh(new BoxGeometry(2.8, 0.05, 0.08), frame);
    hb.position.set(0, 0.58, -1.5); mull.add(hb);
    mull.visible = false; mull.name = 'mullions';
    g.add(mull);
    // soft console glow
    const glow = new PointLight('#7fd6ff', 0.5, 2.5, 2);
    glow.position.set(0, -0.1, -0.7);
    g.add(glow);
    g.visible = false;
  }

  setBigShip(big: boolean) {
    if (big === this.big) return;
    this.big = big;
    this.group.getObjectByName('mullions')!.visible = big;
  }

  /** place a box-geometry mesh as a flat plate over a pose, pushed back by `back` metres */
  private plate(m: Mesh, p: MfdPose, w: number, h: number, depth: number, back: number) {
    m.rotation.set(p.rx, p.ry, 0, 'YXZ');
    m.scale.set(w, h, depth);
    const off = new Vector3(0, 0, -back).applyEuler(m.rotation);
    m.position.set(p.x + off.x, p.y + off.y, p.z + off.z);
  }

  /** lay the console out for the current window shape */
  layout(L: DashLayout) {
    const key = `${L.nav.x.toFixed(4)}|${L.nav.w.toFixed(4)}|${L.scope.w.toFixed(4)}|${L.ap.h.toFixed(4)}|${L.visH.toFixed(4)}`;
    if (key === this.layoutKey) return;
    this.layoutKey = key;
    const faceH = L.visH + 0.5;
    // face: its top edge on L.top, extending down the face direction
    const c = L.top.clone().addScaledVector(L.down, faceH / 2).addScaledVector(L.normal, -0.03);
    this.face.rotation.set(L.rx, 0, 0);
    this.face.scale.set(L.width, faceH, 0.06);
    this.face.position.copy(c);
    // (the face already runs below the bottom of the view, so no separate body is needed)
    this.lowerBody.visible = false;
    // coaming: a rounded lip along the top edge
    // lies almost flat along the top edge, overhanging the face slightly like a glare shield
    this.coaming.rotation.set(-0.12, 0, 0);
    this.coaming.scale.set(L.width, 0.03, 0.16);
    this.coaming.position.copy(L.top).addScaledVector(L.normal, 0.03).add(new Vector3(0, -0.012, 0));
    // bezels for the DOM displays
    this.plate(this.frames[0], L.nav, L.nav.w + 0.03, L.nav.h + 0.03, 0.02, 0.011);
    this.plate(this.frames[1], L.scope, L.scope.w + 0.03, L.scope.h + 0.03, 0.02, 0.011);
    this.plate(this.frames[2], L.ap, L.ap.w + 0.03, L.ap.h + 0.03, 0.02, 0.011);
    this.plate(this.frames[3], L.tgt, L.tgt.w + 0.03, L.tgt.h + 0.03, 0.02, 0.011);
    // centre screens (the screen plane sits on the bezel's front face)
    this.plate(this.attScreen, L.att, L.att.w + 0.02, L.att.h + 0.02, 0.012, 0.0);
    this.plate(this.statusScreen, L.status, L.status.w + 0.02, L.status.h + 0.02, 0.012, 0.0);
    for (const s of [this.attScreen, this.statusScreen]) {
      const scr = s.children[0];
      scr.scale.set((s.scale.x - 0.02) / s.scale.x, (s.scale.y - 0.02) / s.scale.y, 1);
    }
    // switch banks below the status screen (the autopilot screen sits below the attitude screen)
    const sp = new Vector3(L.status.x, L.status.y, L.status.z).addScaledVector(L.down, L.status.h / 2 + 0.05).addScaledVector(L.normal, 0.002);
    this.switches.position.copy(sp);
    this.switches.rotation.set(L.rx, 0, 0);
    this.switches.scale.setScalar(Math.min(1, L.status.w / 0.5));
    // (that spot now holds the target screen)
    this.switches.visible = false;
  }

  /** place at the camera (scene origin) facing the camera direction */
  update(camQuat: Quaternion) {
    this.group.position.set(0, 0, 0);
    this.group.quaternion.copy(camQuat);
    for (const t of this.screens) t.needsUpdate = true;
  }
}

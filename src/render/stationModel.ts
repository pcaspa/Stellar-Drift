import {
  AdditiveBlending, BoxGeometry, Color, CylinderGeometry, Group, Mesh, MeshStandardMaterial, Sprite, SpriteMaterial, TorusGeometry, Vector3,
} from 'three';
import { makeMaterials, ShipMaterials } from './materials';
import { glowTexture } from './textures';

/**
 * Space station, built around the local +Y axis (the docking axis, which the simulation aligns
 * with the station's orbit normal). The docking port mouth sits at y = +150 m.
 */
export const PORT_Y = 150;
import { PAD_TOP_M } from '../data/stations';
/** height of a ground spaceport's landing deck above the terrain, m */
export const PAD_TOP = PAD_TOP_M;

let mats: ShipMaterials | null = null;

/** matte materials for ground pads (shared by every pad) */
let padMatCache: { apron: MeshStandardMaterial; deck: MeshStandardMaterial; paint: MeshStandardMaterial; steel: MeshStandardMaterial; tank: MeshStandardMaterial } | null = null;
function padMats() {
  if (padMatCache) return padMatCache;
  const mk = (color: string, roughness: number, metalness = 0) => new MeshStandardMaterial({ color, roughness, metalness, envMapIntensity: 0.25 });
  padMatCache = {
    apron: mk('#4a4d52', 0.97),
    deck: mk('#6e7176', 0.95),
    paint: mk('#c9a23a', 0.85),
    steel: mk('#5f646b', 0.7, 0.35),
    tank: mk('#b9bcbf', 0.8, 0.05),
  };
  return padMatCache;
}

function cylY(r1: number, r2: number, h: number, mat: Mesh['material'], x: number, y: number, z: number, seg = 40, open = false) {
  const g = new CylinderGeometry(r1, r2, h, seg, 1, open);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * Math.max(1, Math.round(2 * Math.PI * Math.max(r1, r2) / 10)), uv.getY(i) * h / 10);
  const m = new Mesh(g, mat);
  m.position.set(x, y, z);
  m.castShadow = m.receiveShadow = true;
  return m;
}
function box(w: number, h: number, d: number, mat: Mesh['material'], x: number, y: number, z: number) {
  const g = new BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * Math.max(1, Math.max(w, d) / 10), uv.getY(i) * Math.max(1, h / 10));
  const m = new Mesh(g, mat);
  m.position.set(x, y, z);
  m.castShadow = m.receiveShadow = true;
  return m;
}

export class StationModel {
  readonly group = new Group();
  private spin = new Group();
  private blinkers: { s: Sprite; phase: number; period: number }[] = [];
  private time = 0;
  private spinRate: number;

  constructor(style: 'ring' | 'twin' | 'spindle' | 'pad', seed: number) {
    if (!mats) mats = makeMaterials('#dfe3e8', '#454b55', '#d9a520', 777);
    const m = mats;
    const g = this.group;
    if (style === 'pad') { this.spinRate = 0; this.buildPad(m); return; }
    g.add(this.spin);
    this.spinRate = 2 * Math.PI / (style === 'spindle' ? 90 : 60);

    // ---- central spine
    g.add(cylY(14, 14, 220, m.hull, 0, 0, 0, 48));
    for (const y of [-90, -40, 40, 90]) g.add(cylY(15.5, 15.5, 4, m.dark, 0, y, 0, 48));
    g.add(cylY(16, 16, 30, m.windows, 0, 60, 0, 48));
    // docking port at the top
    g.add(cylY(9, 12, 20, m.hull2, 0, 120, 0, 40));
    g.add(cylY(7, 9, 12, m.dark, 0, 136, 0, 32));
    const collar = new Mesh(new TorusGeometry(7.5, 1.2, 12, 40), m.accent);
    collar.rotation.x = Math.PI / 2; collar.position.y = PORT_Y - 4;
    g.add(collar);
    g.add(cylY(5.5, 5.5, 8, m.metal, 0, PORT_Y - 4, 0, 32, true));
    // approach light ring + guidance strobes
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * Math.PI * 2;
      this.light(i % 2 ? '#6dffa8' : '#ffffff', Math.cos(a) * 10, PORT_Y - 4, Math.sin(a) * 10, 3, 1.2, i / 8);
    }
    for (let k = 1; k <= 4; k++) this.light('#ffcf6d', 0, PORT_Y + k * 60, 0, 5 + k, 1.6, k * 0.12);
    // lower module: reactor + radiators
    g.add(cylY(10, 16, 30, m.hull2, 0, -125, 0, 40));
    g.add(cylY(18, 18, 14, m.foil, 0, -146, 0, 40));
    for (let i = 0; i < 4; i++) {
      const a = i / 4 * Math.PI * 2 + Math.PI / 4;
      const r = box(0.6, 60, 70, m.radiator, Math.cos(a) * 50, -120, Math.sin(a) * 50);
      r.rotation.y = -a;
      g.add(r);
      const arm = box(36, 2, 2, m.metal, Math.cos(a) * 25, -120, Math.sin(a) * 25);
      arm.rotation.y = -a;
      g.add(arm);
    }
    // solar wings
    for (const s of [1, -1]) {
      g.add(box(150, 2.5, 2.5, m.metal, s * 90, -60, 0));
      for (let k = 0; k < 4; k++) {
        const p = box(30, 0.3, 64, m.solar, s * (40 + k * 34), -60, 0);
        p.rotation.x = 0.35;
        g.add(p);
      }
    }
    // comms dish
    const dish = cylY(0, 9, 3, m.metal, 22, 92, 0, 32, true);
    dish.rotation.z = -0.8;
    g.add(dish);

    // ---- rotating habitat
    const rings = style === 'twin' ? [-10, 25] : style === 'spindle' ? [] : [0];
    for (const y of rings) {
      const R = 110;
      const torus = new Mesh(new TorusGeometry(R, 11, 24, 120), m.hull);
      torus.rotation.x = Math.PI / 2; torus.position.y = y;
      torus.castShadow = torus.receiveShadow = true;
      this.spin.add(torus);
      // window band on the outer rim
      const band = cylY(R + 10.6, R + 10.6, 6, m.windows, 0, y, 0, 160, true);
      this.spin.add(band);
      for (let i = 0; i < 6; i++) {
        const a = i / 6 * Math.PI * 2;
        const spoke = cylY(3.2, 3.2, R - 14, m.hull2, Math.cos(a) * (R / 2 + 7), y, Math.sin(a) * (R / 2 + 7), 16);
        spoke.rotation.z = Math.PI / 2; spoke.rotation.y = -a;
        this.spin.add(spoke);
        // habitat pods
        const pod = box(20, 14, 26, m.hull2, Math.cos(a + 0.5) * R, y, Math.sin(a + 0.5) * R);
        pod.rotation.y = -(a + 0.5);
        this.spin.add(pod);
      }
      this.spin.add(cylY(20, 20, 16, m.dark, 0, y, 0, 48));
      this.light('#ff3030', R + 12, y, 0, 6, 2.0, 0);
      this.light('#ff3030', -R - 12, y, 0, 6, 2.0, 0.5);
    }
    if (style === 'spindle') {
      // stacked cylindrical habitats around the spine
      for (let i = 0; i < 5; i++) {
        const a = i / 5 * Math.PI * 2;
        this.spin.add(cylY(11, 11, 80, m.hull, Math.cos(a) * 30, -5, Math.sin(a) * 30, 32));
        this.spin.add(cylY(11.3, 11.3, 8, m.windows, Math.cos(a) * 30, 10, Math.sin(a) * 30, 32, true));
        this.spin.add(cylY(11.3, 11.3, 8, m.windows, Math.cos(a) * 30, -25, Math.sin(a) * 30, 32, true));
      }
    }
    // cargo yard: parked containers on a frame
    const cc = m.container;
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + seed;
      const c = box(6, 2.6, 2.6, cc[i % cc.length], Math.cos(a) * 21, -100 + (i % 2) * 3, Math.sin(a) * 21);
      c.rotation.y = -a;
      g.add(c);
    }
  }

  private light(color: string, x: number, y: number, z: number, size: number, period: number, phase: number, gain = 4) {
    const s = new Sprite(new SpriteMaterial({ map: glowTexture(64, 3), color: new Color(color).multiplyScalar(gain), blending: AdditiveBlending, depthWrite: false, transparent: true }));
    s.position.set(x, y, z); s.scale.setScalar(size); s.renderOrder = 9600;
    this.group.add(s);
    this.blinkers.push({ s, phase, period });
  }

  /**
   * Ground spaceport, built on local +Y = up with the landing deck surface at y = PAD_TOP: a deep
   * concrete apron (its foundation reaches well into the ground to hide uneven terrain), the
   * landing circle with edge lights, a launch tower with a beacon, fuel tanks and a hangar.
   */
  private buildPad(m: ShipMaterials) {
    const g = this.group;
    const deck = PAD_TOP;
    // matte, non-metallic surfaces: the ships' polished hull materials mirror the sky and bloom badly
    // on a big flat deck, so the pad gets its own concrete, paint and weathered fittings
    const pm = padMats();
    // apron and foundation
    g.add(cylY(95, 110, 40, pm.apron, 0, deck - 20, 0, 64));
    g.add(cylY(70, 70, 0.4, pm.deck, 0, deck + 0.05, 0, 64));
    // painted landing markings: outer ring, inner circle and an H (flat paint, not raised metal)
    const ring = new Mesh(new TorusGeometry(52, 1.2, 4, 96), pm.paint);
    ring.rotation.x = Math.PI / 2; ring.scale.z = 0.15; ring.position.y = deck + 0.27; g.add(ring);
    const inner = new Mesh(new TorusGeometry(20, 0.8, 4, 64), pm.paint);
    inner.rotation.x = Math.PI / 2; inner.scale.z = 0.15; inner.position.y = deck + 0.27; g.add(inner);
    for (const x of [-7, 7]) { const b = new Mesh(new BoxGeometry(2.4, 0.06, 18), pm.paint); b.position.set(x, deck + 0.28, 0); g.add(b); }
    const bar = new Mesh(new BoxGeometry(14, 0.06, 2.4), pm.paint); bar.position.set(0, deck + 0.28, 0); g.add(bar);
    // small, soft edge lights
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      this.light(i % 2 ? '#6dffa8' : '#ffffff', Math.cos(a) * 68, deck + 0.8, Math.sin(a) * 68, 1.6, 1.6, i / 16, 1.6);
    }
    // launch / service tower with a red beacon
    const tx = 92;
    g.add(cylY(4.5, 5.5, 70, pm.steel, tx, deck + 35, 0, 12));
    for (let y = 8; y < 70; y += 10) { const arm = new Mesh(new BoxGeometry(14, 1.2, 3), pm.steel); arm.position.set(tx - 7, deck + y, 0); g.add(arm); }
    this.light('#ff3030', tx, deck + 74, 0, 4, 1.4, 0, 2);
    // fuel tanks and a hangar on the apron edge
    for (const z of [-26, -8]) g.add(cylY(7, 7, 18, pm.tank, -88, deck + 9, z, 24));
    const hangar = new Mesh(new BoxGeometry(34, 16, 26), pm.tank); hangar.position.set(-70, deck + 8, 46); g.add(hangar);
    const door = new Mesh(new BoxGeometry(22, 12, 0.6), pm.apron); door.position.set(-70, deck + 6, 33); g.add(door);
    this.light('#ffcf6d', -70, deck + 18, 33, 3, 2.2, 0.3, 1.6);
  }

  update(dt: number) {
    this.time += dt;
    this.spin.rotation.y = (this.time * this.spinRate) % (Math.PI * 2);
    for (const b of this.blinkers) b.s.visible = ((this.time / b.period + b.phase) % 1) < 0.25;
  }

  get portPosition() { return new Vector3(0, PORT_Y, 0); }
}

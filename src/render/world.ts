import {
  AgXToneMapping, AdditiveBlending, AmbientLight, BackSide, BufferAttribute, BufferGeometry, Color, HalfFloatType, HemisphereLight,
  Line, LineBasicMaterial, Mesh, MeshBasicMaterial, PerspectiveCamera, PMREMGenerator, PointLight, SpotLight, Points, PointsMaterial, Quaternion,
  Scene, SphereGeometry, Sprite, SpriteMaterial, SRGBColorSpace, Vector2, Vector3, WebGLRenderer, WebGLRenderTarget,
  Matrix4, CubeCamera, DirectionalLight, PCFSoftShadowMap, PlaneGeometry, ShadowMaterial, WebGLCubeRenderTarget,
} from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { AU_KM } from '../data/types';
import type { Sim } from '../sim/sim';
import { Body, StarSystem, equatorialToSim } from '../sim/universe';
import { BodyView } from './bodyView';
import { ShipModel } from './shipModels';
import { StationModel } from './stationModel';
import { Cockpit } from './cockpit';
import type { Npc } from '../sim/npc';
import { CockpitPanels } from './cockpitPanels';
import { glowTexture, loadTexture } from './textures';
import { starLightColor } from './starlight';

const _q = new Quaternion(), _q2 = new Quaternion();
const _v = new Vector3(), _v2 = new Vector3(), _v3 = new Vector3(), _v4 = new Vector3();
const X_AXIS = new Vector3(1, 0, 0), Y_AXIS = new Vector3(0, 1, 0);

function mulberry(seed: number) {
  return () => { let t = seed += 0x6D2B79F5; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export class World {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  views: BodyView[] = [];
  private viewById = new Map<string, BodyView>();
  private system: StarSystem | null = null;
  private starLight = new PointLight('#ffffff', 3.4, 0, 0);
  private groundSpot: SpotLight;
  private bellySpot: SpotLight;
  private ambient = new AmbientLight('#8fa4c4', 0.035);
  private skyLight = new HemisphereLight('#88aaff', '#443322', 0);
  readonly ship: ShipModel;
  readonly cockpit: Cockpit;
  readonly panels: CockpitPanels;
  readonly shipScene = new Scene();
  private sun = new DirectionalLight('#ffffff', 3.4);
  private shipAmbient = new AmbientLight('#8fa4c4', 0.04);
  private shipSky = new HemisphereLight('#88aaff', '#443322', 0);
  private pmrem: PMREMGenerator;
  private cubeRT: WebGLCubeRenderTarget;
  private cubeCam: CubeCamera;
  private envRT: WebGLRenderTarget | null = null;
  private envTimer = 0;
  private shadowCatcher: Mesh;
  private stations = new Map<string, StationModel>();
  /** fraction of the star's disc visible from the ship (eclipses, night side) */
  sunVisible = 1;
  private shipOrbit: Line;
  private belts: Points[] = [];
  private neighbours: Sprite[] = [];
  private skyGroup = new Scene();
  /** camera position, sim frame (double precision) */
  readonly camPos = new Vector3();
  readonly camQuat = new Quaternion();
  view: 'chase' | 'cockpit' = 'chase';
  camYaw = 0.5; camPitch = 0.22; camDist = 75;
  showOrbits = false;
  private orbitAlpha = 1;
  jumpFx = 0;
  /** crash jolt for the camera, 1 = just crashed */
  shakeKick = 0;
  pxPerRad = 1000;
  private readonly size = new Vector2();
  private baseFov = 55;
  private shake = 0;

  constructor(canvas: HTMLCanvasElement, private sim: Sim) {
    this.renderer = new WebGLRenderer({ canvas, antialias: false, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = AgXToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.camera = new PerspectiveCamera(this.baseFov, 1, 0.5, 1e16);
    this.scene.add(this.camera);

    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFSoftShadowMap;

    const rt = new WebGLRenderTarget(4, 4, { type: HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    // spacecraft are drawn in a second pass sharing the depth buffer: they get a directional
    // "sun" with soft self-shadowing and live reflections, which the planet-scale scene can't use
    const shipPass = new RenderPass(this.shipScene, this.camera);
    shipPass.clear = false;
    this.composer.addPass(shipPass);
    this.bloom = new UnrealBloomPass(new Vector2(4, 4), 0.4, 0.4, 2.2);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.scene.add(this.starLight, this.ambient, this.skyLight);
    // landing light on the terrain: the ship model's own spotlight lives in the spacecraft scene and
    // can't reach the planet, so this one shines from the ship onto the ground (always present, so
    // switching it on never forces shader recompiles)
    this.groundSpot = new SpotLight('#fff4e0', 0, 3000, 0.72, 0.6, 0);
    this.scene.add(this.groundSpot, this.groundSpot.target);
    // belly floodlight: straight down, wide, so the ground right under the ship is lit as well
    this.bellySpot = new SpotLight('#fff4e0', 0, 1000, 1.05, 0.8, 0);
    this.scene.add(this.bellySpot, this.bellySpot.target);

    // ship scene lighting
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.shipScene.add(this.sun, this.sun.target, this.shipAmbient, this.shipSky);
    this.pmrem = new PMREMGenerator(this.renderer);
    this.shipScene.environment = this.pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.shipScene.environmentIntensity = 0.15;
    this.cubeRT = new WebGLCubeRenderTarget(128, { type: HalfFloatType });
    this.cubeCam = new CubeCamera(1, 1e16, this.cubeRT);
    this.scene.add(this.cubeCam);
    const catcher = new PlaneGeometry(1, 1); catcher.rotateX(-Math.PI / 2);
    this.shadowCatcher = new Mesh(catcher, new ShadowMaterial({ opacity: 0.55, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
    this.shadowCatcher.receiveShadow = true;
    this.shipScene.add(this.shadowCatcher);

    this.cockpit = new Cockpit();
    this.shipScene.add(this.cockpit.group);
    this.panels = new CockpitPanels(document.getElementById('nav')!, document.getElementById('scope')!);
    this.ship = new ShipModel();
    this.ship.setClass(sim.econ.shipId);
    this.camDist = this.ship.length * 2.7;
    this.shipScene.add(this.ship.group);

    const og = new BufferGeometry();
    og.setAttribute('position', new BufferAttribute(new Float32Array(361 * 3), 3));
    this.shipOrbit = new Line(og, new LineBasicMaterial({ color: '#35e0ff', transparent: true, opacity: 0.75, depthWrite: false }));
    this.shipOrbit.frustumCulled = false; this.shipOrbit.renderOrder = 7100;
    this.scene.add(this.shipOrbit);

    this.buildSky();
    this.setSystem(sim.system);
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  private buildSky() {
    const rnd = mulberry(1337);
    // three brightness classes
    const classes: [number, number, number][] = [[9000, 1.2, 0.45], [1600, 1.9, 0.8], [260, 2.8, 1.25]];
    for (const [count, size, bright] of classes) {
      const pos = new Float32Array(count * 3), col = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        const z = rnd() * 2 - 1, a = rnd() * 2 * Math.PI, r = Math.sqrt(1 - z * z);
        pos[i * 3] = r * Math.cos(a) * 1000; pos[i * 3 + 1] = z * 1000; pos[i * 3 + 2] = r * Math.sin(a) * 1000;
        const temp = rnd();
        const c = temp < 0.25 ? [1.0, 0.78, 0.6] : temp < 0.6 ? [1, 0.95, 0.88] : temp < 0.85 ? [0.92, 0.95, 1] : [0.72, 0.82, 1];
        const b = bright * (0.5 + 0.5 * rnd());
        col[i * 3] = c[0] * b; col[i * 3 + 1] = c[1] * b; col[i * 3 + 2] = c[2] * b;
      }
      const g = new BufferGeometry();
      g.setAttribute('position', new BufferAttribute(pos, 3));
      g.setAttribute('color', new BufferAttribute(col, 3));
      const p = new Points(g, new PointsMaterial({ size, sizeAttenuation: false, vertexColors: true, depthTest: false, depthWrite: false }));
      p.frustumCulled = false; p.renderOrder = -1000;
      this.scene.add(p);
    }
    loadTexture('stars.jpg').then(tex => {
      if (!tex) return;
      const m = new Mesh(new SphereGeometry(900, 48, 24),
        new MeshBasicMaterial({ map: tex, side: BackSide, depthTest: false, depthWrite: false, color: new Color(0.42, 0.42, 0.46) }));
      // texture is in equatorial coordinates: tilt to the ecliptic sim frame
      m.quaternion.setFromUnitVectors(Y_AXIS, equatorialToSim(0, 90).normalize());
      m.scale.x = -1;
      m.renderOrder = -1001; m.frustumCulled = false;
      this.scene.add(m);
    });
  }

  setSystem(system: StarSystem) {
    for (const v of this.views) v.dispose();
    for (const b of this.belts) { this.scene.remove(b); b.geometry.dispose(); }
    for (const n of this.neighbours) this.scene.remove(n);
    this.views = []; this.belts = []; this.neighbours = []; this.viewById.clear();
    this.system = system;
    for (const b of system.bodies) {
      const v = new BodyView(b, this.scene);
      this.views.push(v); this.viewById.set(b.id, v);
    }
    this.starLight.color.copy(starLightColor(system.star.def.star!.teff));
    this.sun.color.copy(this.starLight.color);
    for (const st of this.stations.values()) {
      this.shipScene.remove(st.group);
      st.group.traverse(o => { if ((o as Mesh).isMesh) (o as Mesh).geometry.dispose(); });
    }
    this.stations.clear();
    let si = 0;
    for (const b of system.bodies) {
      if (!b.isStation) continue;
      const m = new StationModel(b.def.station!.style, si++ * 1.3);
      m.group.visible = false;
      this.shipScene.add(m.group);
      this.stations.set(b.id, m);
    }
    // debris belts
    const rnd = mulberry(system.id.length * 7919 + 13);
    for (const belt of system.def.belts ?? []) {
      const pos = new Float32Array(belt.count * 3);
      for (let i = 0; i < belt.count; i++) {
        const r = (belt.inner + (belt.outer - belt.inner) * (0.5 + 0.5 * (rnd() + rnd() - 1))) * AU_KM * 1000;
        const a = rnd() * 2 * Math.PI, inc = (rnd() + rnd() - 1) * 0.16;
        pos[i * 3] = r * Math.cos(a) * Math.cos(inc); pos[i * 3 + 1] = r * Math.sin(inc); pos[i * 3 + 2] = r * Math.sin(a) * Math.cos(inc);
      }
      const g = new BufferGeometry();
      g.setAttribute('position', new BufferAttribute(pos, 3));
      const p = new Points(g, new PointsMaterial({ size: 1.3, sizeAttenuation: false, color: belt.color, transparent: true, opacity: 0.5, depthWrite: false }));
      p.frustumCulled = false; p.renderOrder = 6500;
      this.scene.add(p); this.belts.push(p);
    }
    // neighbouring stars drawn at their true directions
    const tex = glowTexture(64, 3);
    for (const other of this.sim.universe.systems) {
      if (other === system) continue;
      const d = _v.subVectors(other.galPos, system.galPos);
      const distLy = d.length() / 9.4607e15;
      const L = other.star.def.star!.luminosity;
      const mag = 4.83 - 2.5 * Math.log10(L) + 5 * Math.log10(distLy / 32.616);
      const s = new Sprite(new SpriteMaterial({
        map: tex, color: new Color(other.star.def.star!.color).multiplyScalar(1.4), sizeAttenuation: false, depthTest: false, depthWrite: false,
        transparent: true, blending: AdditiveBlending, opacity: Math.min(1, Math.max(0.35, 1 - mag * 0.07)),
      }));
      s.scale.setScalar(Math.min(0.022, Math.max(0.006, 0.016 - mag * 0.0012)));
      s.position.copy(d).normalize().multiplyScalar(800);
      s.renderOrder = -900; s.userData.system = other;
      this.scene.add(s); this.neighbours.push(s);
    }
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.size.set(w, h);
  }

  viewOf(b: Body) { return this.viewById.get(b.id); }

  /** project a sim-frame position to screen pixels. returns false if behind the camera */
  project(p: Vector3, out: { x: number; y: number }): boolean {
    _v.subVectors(p, this.camPos).applyMatrix4(this.camera.matrixWorldInverse);
    if (_v.z > 0) return false;
    _v.applyMatrix4(this.camera.projectionMatrix);
    out.x = (_v.x * 0.5 + 0.5) * this.size.x; out.y = (-_v.y * 0.5 + 0.5) * this.size.y;
    return true;
  }

  /** project a direction (e.g. distant star or velocity vector) */
  projectDir(dir: Vector3, out: { x: number; y: number }): boolean {
    _v.copy(dir).applyQuaternion(_q.copy(this.camQuat).invert());
    if (_v.z > -1e-6) return false;
    _v.applyMatrix4(this.camera.projectionMatrix);
    out.x = (_v.x * 0.5 + 0.5) * this.size.x; out.y = (-_v.y * 0.5 + 0.5) * this.size.y;
    return true;
  }

  /** directional sun with eclipses, soft shadows, ground shadow and live reflections for spacecraft */
  private updateShipLighting(dt: number, star: Body, dom: Body) {
    const sim = this.sim, s = sim.ship, L = this.ship.length;
    const shipRel = _v.subVectors(s.pos, this.camPos);
    const toStar = _v2.subVectors(star.pos, s.pos);
    const dStar = toStar.length();
    toStar.multiplyScalar(1 / dStar);
    // eclipse: how much of the star's disc is hidden behind any body
    const aStar = Math.asin(Math.min(1, star.radius / dStar));
    let vis = 1;
    for (const b of sim.system.bodies) {
      if (b === star || b.isStation || b.radius < 50e3) continue;
      const v = _v3.subVectors(b.pos, s.pos);
      const t = v.dot(toStar);
      if (t <= 0 || t > dStar) continue;
      const dv = v.length();
      const aB = Math.asin(Math.min(1, (b.radius + b.atmoTop * 0.15) / dv));
      const sep = Math.acos(Math.min(1, t / dv));
      const f = Math.min(1, Math.max(0, (sep - (aB - aStar)) / (2 * aStar + 1e-9)));
      vis = Math.min(vis, f * f * (3 - 2 * f));
    }
    this.sunVisible += (vis - this.sunVisible) * Math.min(1, dt * 8);
    this.sun.intensity = 3.4 * this.sunVisible;
    this.shipSky.color.copy(this.skyLight.color);
    this.shipSky.intensity = this.skyLight.intensity;
    if (this.shipSky.intensity > 0) this.shipSky.position.copy(this.skyLight.position);

    // ground shadow catcher under a ship that is close to the surface
    const catcherOn = sim.nearGround && sim.radarAlt < L * 4 && dom.def.landable;
    let S = L * 0.8;
    this.shadowCatcher.visible = catcherOn;
    if (catcherOn) {
      const up = _v3.subVectors(s.pos, dom.pos).normalize();
      this.shadowCatcher.position.copy(shipRel).addScaledVector(up, -(Math.max(0, sim.radarAlt) + s.gear) + 0.15);
      this.shadowCatcher.quaternion.setFromUnitVectors(Y_AXIS, up);
      this.shadowCatcher.scale.setScalar(L * 4);
      S = L * 2.2;
    }
    // near a station, widen the shadow volume so the ship shadows the station and vice versa
    for (const [id, m] of this.stations) {
      if (!m.group.visible) continue;
      const b = sim.system.byId.get(id)!;
      if (b.pos.distanceTo(s.pos) < 1200) S = Math.max(S, 320);
    }
    this.sun.position.copy(shipRel).addScaledVector(toStar, S * 3);
    this.sun.target.position.copy(shipRel);
    const cam = this.sun.shadow.camera;
    if (cam.right !== S) {
      cam.left = -S; cam.right = S; cam.top = S; cam.bottom = -S; cam.near = S * 0.5; cam.far = S * 6;
      cam.updateProjectionMatrix();
      this.sun.shadow.normalBias = S * 0.0015;
    }

    // live environment reflections of the planet / sky around the ship
    this.envTimer -= dt;
    if (this.envTimer <= 0) {
      this.envTimer = 0.35;
      this.cubeCam.position.copy(shipRel);
      this.cubeCam.update(this.renderer, this.scene);
      const next = this.pmrem.fromCubemap(this.cubeRT.texture);
      this.shipScene.environment = next.texture;
      this.shipScene.environmentIntensity = 1;
      this.envRT?.dispose();
      this.envRT = next;
    }
  }

  private npcViews = new Map<string, { model: ShipModel; npc: Npc }>();

  /** draw NPC ships near the camera; models are created per NPC and reused */
  private updateNpcs(dt: number) {
    const sim = this.sim, live = new Set<string>();
    for (const npc of sim.traffic.npcs) {
      const key = `${sim.system.id}:${npc.id}:${npc.shipId}`;
      live.add(key);
      let v = this.npcViews.get(key);
      const rel = _v3.subVectors(npc.pos, this.camPos);
      const near = npc.state !== 'docked' && rel.lengthSq() < 9e12; // within ~3000 km
      if (!v) {
        if (!near) continue;
        const model = new ShipModel(true);
        model.setClass(npc.shipId);
        this.shipScene.add(model.group);
        v = { model, npc };
        this.npcViews.set(key, v);
      }
      const g = v.model.group;
      g.visible = near;
      if (!near) continue;
      g.position.copy(rel);
      // nose along the engine thrust (flip-and-burn), otherwise keep the last attitude
      const a = npc.acc.length();
      if (a > 0.05) {
        _v.copy(npc.acc).multiplyScalar(1 / a);
        const up = Math.abs(_v.y) > 0.95 ? X_AXIS : Y_AXIS;
        this.npcMat.lookAt(_v2.set(0, 0, 0), _v, up);
        _q2.setFromRotationMatrix(this.npcMat);
        npc.quat.slerp(_q2, Math.min(1, dt * 1.5));
      }
      g.quaternion.copy(npc.quat);
      const thr = _v.copy(npc.acc).applyQuaternion(_q.copy(npc.quat).invert()).multiplyScalar(1 / 25);
      v.model.update(dt, thr, false, 0, _v2.set(0, 0, -1), 0, false);
    }
    // drop models for NPCs that no longer exist (new system)
    for (const [key, v] of this.npcViews) {
      if (live.has(key)) continue;
      this.shipScene.remove(v.model.group);
      v.model.group.traverse(o => { if ((o as Mesh).isMesh) (o as Mesh).geometry.dispose(); });
      this.npcViews.delete(key);
    }
  }
  private npcMat = new Matrix4();

  neighbourDir(sys: StarSystem, out: Vector3): Vector3 {
    return out.subVectors(sys.galPos, this.sim.system.galPos).normalize();
  }

  /** view to go back to after a jump (cockpit view is swapped for the chase view during one) */
  private viewBeforeJump: 'chase' | 'cockpit' | null = null;
  /** seconds since arrival while the jump camera is still in charge */
  private jumpCamAfter = -1;
  private distBeforeJump = 0;

  /**
   * Going into a jump the camera swings round to directly behind the ship (switching from the
   * cockpit if need be), so the star streaks pour past the hull; after arrival, once the flash has
   * cleared, the previous view comes back.
   */
  private jumpCamera(dt: number) {
    const sim = this.sim;
    const spooling = !!sim.jumpArmed && (sim.jumpTransit > 0 || sim.jumpCharge > 0.15);
    if (spooling) this.jumpCamAfter = 0;
    else if (this.jumpCamAfter >= 0) {
      this.jumpCamAfter += dt;
      // spool-up abandoned (no jump happened) or arrival flash cleared: hand the camera back
      if (this.jumpCamAfter > (this.jumpFx > 0 ? 1.6 : 0.2)) {
        this.jumpCamAfter = -1;
        if (this.viewBeforeJump) { this.view = this.viewBeforeJump; this.viewBeforeJump = null; }
        if (this.distBeforeJump > 0) { this.camDist = this.distBeforeJump; this.distBeforeJump = 0; }
      }
    }
    if (!spooling && this.jumpCamAfter < 0) return;
    if (this.view === 'cockpit') { this.viewBeforeJump = 'cockpit'; this.view = 'chase'; }
    if (this.distBeforeJump === 0) this.distBeforeJump = this.camDist; // the player's zoom comes back afterwards
    // ease to straight behind and slightly above, a little closer in
    const k = 1 - Math.exp(-dt * (sim.jumpTransit > 0 ? 6 : 3));
    const yaw = Math.atan2(Math.sin(this.camYaw), Math.cos(this.camYaw)); // wrap to ±π, shortest way round
    this.camYaw = yaw + (0 - yaw) * k;
    this.camPitch += (0.1 - this.camPitch) * k;
    const want = this.ship.length * 2.4;
    this.camDist += (want - this.camDist) * k;
  }

  update(dt: number) {
    const sim = this.sim, s = sim.ship;
    if (sim.system !== this.system) this.setSystem(sim.system);
    if (this.ship.classId !== sim.econ.shipId) {
      const old = this.ship.length;
      this.ship.setClass(sim.econ.shipId);
      this.camDist *= this.ship.length / old;
    }

    // ---- camera
    this.jumpCamera(dt);
    _q.setFromAxisAngle(Y_AXIS, this.camYaw);
    _q2.setFromAxisAngle(X_AXIS, -this.camPitch);
    const want = _q.premultiply(s.quat).multiply(_q2);
    if (this.view === 'chase') {
      const k = s.landed ? 1 : 1 - Math.exp(-dt * 7);
      this.camQuat.slerp(want, k);
      this.camPos.set(0, this.camDist * 0.16, this.camDist).applyQuaternion(this.camQuat).add(s.pos);
    } else {
      this.camQuat.copy(want);
      this.camPos.copy(this.ship.design.cockpit).applyQuaternion(s.quat).add(s.pos);
    }
    // gentle shake from thrust and aerodynamic load
    const load = Math.min(1, sim.dynPressure / 40000 + sim.heat / 3e6) + Math.min(0.25, s.thrustAccel.length() / 600);
    this.shake += (load - this.shake) * Math.min(1, dt * 4);
    // a crash gives the camera a hard jolt that dies away
    if (this.shakeKick > 0) { this.shake = Math.max(this.shake, this.shakeKick * 6); this.shakeKick = Math.max(0, this.shakeKick - dt * 1.5); }
    if (this.shake > 0.01 && sim.effWarp < 20) {
      const a = this.shake * (this.view === 'chase' ? 0.5 : 0.06);
      this.camPos.x += (Math.random() - 0.5) * a; this.camPos.y += (Math.random() - 0.5) * a; this.camPos.z += (Math.random() - 0.5) * a;
    }
    // keep the camera above the terrain
    const dom = sim.dominant;
    if (sim.nearGround && dom.def.landable) {
      const rel = _v.subVectors(this.camPos, dom.pos);
      const r = rel.length();
      dom.orientation(sim.t, _q2).invert();
      _v2.copy(rel).multiplyScalar(1 / r).applyQuaternion(_q2);
      const minR = dom.radius + dom.surface.height(_v2.x, _v2.y, _v2.z, 0) + 2.5;
      if (r < minR) this.camPos.addScaledVector(rel.multiplyScalar(1 / r), minR - r);
    }
    this.camera.quaternion.copy(this.camQuat);
    this.camera.position.set(0, 0, 0);
    if (this.jumpFx > 0) this.jumpFx = Math.max(0, this.jumpFx - dt * 0.7);
    const fov = this.baseFov + 60 * this.jumpFx * this.jumpFx;
    if (Math.abs(fov - this.camera.fov) > 0.01) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
    this.camera.updateMatrixWorld(true);
    this.pxPerRad = (this.size.y / 2) / Math.tan(this.camera.fov * Math.PI / 360);

    // ---- bodies, far to near
    // orbit lines fade out as you approach a surface (from there they only clutter the sky)
    const camAlt = this.camPos.distanceTo(dom.pos) - dom.radius;
    const orbitAlpha = !this.showOrbits ? 0 : dom.isStar ? 1
      : Math.min(1, Math.max(0, (camAlt - dom.radius * 0.04) / (dom.radius * 0.5)));
    this.orbitAlpha = orbitAlpha;
    for (const v of this.views) v.dist = v.body.pos.distanceTo(this.camPos);
    const sorted = [...this.views].sort((a, b) => b.dist - a.dist);
    for (let i = 0; i < sorted.length; i++) {
      const v = sorted[i];
      v.update(this.camPos, sim.t, this.pxPerRad, i * 2, orbitAlpha, v.body === dom ? 7 : 1.5);
    }

    // ---- lighting
    const star = sim.system.star;
    this.starLight.position.subVectors(star.pos, this.camPos);
    // sky light when inside an atmosphere on the day side
    let sky = 0;
    if (dom.def.atmosphere) {
      const up = _v.subVectors(this.camPos, dom.pos).normalize();
      const sunDir = _v2.subVectors(star.pos, dom.pos).normalize();
      const elev = up.dot(sunDir);
      const dens = Math.min(1, dom.density(Math.max(0, sim.altitude)) / Math.min(dom.rho0, 1.2));
      sky = dens * Math.min(1, Math.max(0, elev * 3 + 0.3));
      const a = dom.def.atmosphere;
      const m = Math.max(...a.rayleigh);
      this.skyLight.color.setRGB(0.35 + 0.65 * a.rayleigh[0] / m, 0.35 + 0.65 * a.rayleigh[1] / m, 0.35 + 0.65 * a.rayleigh[2] / m);
      this.skyLight.position.copy(up);
    }
    this.skyLight.intensity = sky * 0.9;

    // ---- ship
    const g = this.ship.group;
    const L = this.ship.length;
    g.visible = this.view === 'chase';
    g.position.subVectors(s.pos, this.camPos);
    g.quaternion.copy(s.quat);
    const inv = _q.copy(s.quat).invert();
    const thr = _v.copy(s.thrustAccel).applyQuaternion(inv).multiplyScalar(1 / (55 * s.perf));
    const air = _v2.copy(sim.vSurf).normalize().applyQuaternion(inv);
    const lowAlt = sim.nearGround && sim.radarAlt < Math.max(1500, L * 40);
    const night = lowAlt ? 1 - Math.min(1, this.skyLight.intensity * 3) * this.sunVisible : 0;
    const landing = lowAlt ? Math.max(0.25, night) : 0;
    this.ship.update(dt, thr, sim.gearDown,sim.heat / 1.5e6, air, landing, sim.mining);
    // ground pool of light under the nose: brighter in the dark, reaching the terrain from ~1.5 km down
    const gs = this.groundSpot;
    gs.intensity = landing > 0.3 ? 5 * landing : 0;
    if (gs.intensity > 0) {
      gs.position.set(0, -L * 0.08, -L * 0.2).applyQuaternion(s.quat).add(g.position);
      // high up the beam points mostly down; close to the ground it tilts forward to flood the area ahead
      const fwd = Math.max(0, Math.min(1, 1 - sim.radarAlt / 300));
      gs.target.position.set(0, -L * (2 - 0.8 * fwd), -L * (0.9 + 1.8 * fwd)).applyQuaternion(s.quat).add(g.position);
      gs.distance = Math.max(250, (sim.radarAlt + L) * 3);
    }
    const bs = this.bellySpot;
    bs.intensity = gs.intensity * 0.55;
    if (bs.intensity > 0) {
      bs.position.set(0, -L * 0.1, 0).applyQuaternion(s.quat).add(g.position);
      bs.target.position.set(0, -L * 3, 0).applyQuaternion(s.quat).add(g.position);
      bs.distance = Math.max(120, (sim.radarAlt + L) * 2.5);
    }

    // ---- NPC traffic
    this.updateNpcs(dt);

    // ---- cockpit interior + the HTML panels mounted on its side displays
    const inCockpit = this.view === 'cockpit';
    this.cockpit.group.visible = inCockpit;
    const dash = this.panels.update(inCockpit, this.camera);
    if (inCockpit && dash) {
      this.cockpit.setBigShip(L > 40);
      this.cockpit.layout(dash);
      this.cockpit.update(this.camQuat);
    }

    // ---- stations
    for (const [id, m] of this.stations) {
      const b = sim.system.byId.get(id)!;
      const rel = _v3.subVectors(b.pos, this.camPos);
      m.group.visible = rel.lengthSq() < 4e12; // within ~2000 km
      // ground pads: only within 400 km and only when above the camera's horizon
      // (the spacecraft scene is drawn over the planet, so it must not show through it)
      if (m.group.visible && b.isPort) {
        const up = _v4.subVectors(b.pos, b.parent!.pos).normalize();
        m.group.visible = rel.lengthSq() < 1.6e11 && -rel.dot(up) > -0.02 * rel.length();
      }
      if (!m.group.visible) continue;
      m.group.position.copy(rel);
      b.orientation(sim.t, m.group.quaternion);
      m.update(dt);
    }

    this.updateShipLighting(dt, star, dom);

    // ---- ship orbit path
    const o = sim.orbit;
    const inAir = sim.density > dom.rho0 * 1e-4 || (sim.nearGround && sim.radarAlt < 30000);
    this.shipOrbit.visible = !!o && this.showOrbits && !inAir && isFinite(o.rp) && (o.bound || o.e > 1.001);
    if (o && this.shipOrbit.visible) {
      const attr = this.shipOrbit.geometry.attributes.position as BufferAttribute;
      const e = o.e, p = o.rp * (1 + e);
      const P = _v.copy(o.evec);
      if (e < 1e-6) P.subVectors(s.pos, o.body.pos);
      P.normalize();
      const Q = _v2.crossVectors(o.h, P).normalize();
      const maxNu = o.bound ? Math.PI : Math.acos(-1 / e) * 0.96;
      for (let i = 0; i <= 360; i++) {
        const nu = -maxNu + (2 * maxNu) * i / 360;
        const r = p / (1 + e * Math.cos(nu));
        attr.setXYZ(i, (P.x * Math.cos(nu) + Q.x * Math.sin(nu)) * r, (P.y * Math.cos(nu) + Q.y * Math.sin(nu)) * r, (P.z * Math.cos(nu) + Q.z * Math.sin(nu)) * r);
      }
      attr.needsUpdate = true;
      this.shipOrbit.position.subVectors(o.body.pos, this.camPos);
      const below = o.rp < o.body.radius;
      (this.shipOrbit.material as LineBasicMaterial).color.set(below ? '#ff8a4a' : '#35e0ff');
    }

    for (const b of this.belts) { b.position.copy(this.camPos).negate(); b.visible = this.orbitAlpha > 0.05; }

    this.composer.render(dt);
  }
}

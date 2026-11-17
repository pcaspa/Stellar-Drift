import {
  AdditiveBlending, BufferAttribute, BufferGeometry, CanvasTexture, Color, CustomBlending, RepeatWrapping, WebGLProgramParametersWithUniforms, DoubleSide, Line, LineBasicMaterial, LineLoop,
  Material, Mesh, MeshBasicMaterial, MeshStandardMaterial, OneMinusSrcAlphaFactor, Quaternion, RingGeometry, Scene, ShaderMaterial,
  SphereGeometry, Sprite, SpriteMaterial, SrcAlphaFactor, Texture, Vector3,
} from 'three';
import { Body } from '../sim/universe';
import { AtmosphereView } from './atmosphere';
import { Terrain } from './terrain';
import { bakeSurface, buildLandMask, glowTexture, loadTexture, texturesFromArrays } from './textures';
import { bakeInBackground } from './bakeService';
import { patchTerrainShader } from './terrainShader';
import { LandMask } from '../sim/surface';

const sphereGeo = new SphereGeometry(1, 128, 64);
let glowTex: Texture | null = null;
let dotTex: Texture | null = null;
const _q = new Quaternion(), _qi = new Quaternion();
const _v = new Vector3(), _sun = new Vector3(), _cl = new Vector3();

const RING_VERT = /* glsl */`
varying vec2 vUv; varying vec3 vLocal;
#include <common>
#include <logdepthbuf_pars_vertex>
void main() {
  vUv = uv; vLocal = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  #include <logdepthbuf_vertex>
}`;
const RING_FRAG = /* glsl */`
uniform sampler2D uMap; uniform bool uHasMap; uniform vec3 uColor; uniform float uOpacity;
uniform vec3 uSunLocal; uniform float uPlanetR; uniform float uSeed;
varying vec2 vUv; varying vec3 vLocal;
#include <common>
#include <logdepthbuf_pars_fragment>
void main() {
  #include <logdepthbuf_fragment>
  vec4 c;
  if (uHasMap) c = texture2D(uMap, vec2(vUv.x, 0.5));
  else {
    float r = vUv.x;
    float b = 0.55 + 0.45 * sin(r * 90.0 + uSeed) * sin(r * 37.0 + 1.3);
    c = vec4(uColor, b * smoothstep(0.0, 0.08, r) * smoothstep(1.0, 0.9, r));
  }
  // shadow of the planet on the ring plane (ray towards the sun vs sphere)
  float b = dot(vLocal, uSunLocal);
  float cc = dot(vLocal, vLocal) - uPlanetR * uPlanetR;
  float h = b * b - cc;
  float shadow = (h > 0.0 && b < 0.0) ? 0.06 : 1.0;
  gl_FragColor = vec4(c.rgb * uColor * 1.6 * shadow, c.a * uOpacity);
}`;

function hexColor(h: string) { return new Color(h); }

/** city lights only on the night side */
function patchNightLights(sh: WebGLProgramParametersWithUniforms) {
  sh.fragmentShader = sh.fragmentShader.replace('#include <lights_fragment_end>',
    `#include <lights_fragment_end>
     totalEmissiveRadiance *= 1.0 - smoothstep(0.0, 0.03, dot(reflectedLight.directDiffuse, vec3(1.0)));`);
}

/** roughness texture: water smooth, land rough (green channel is read by three.js) */
function landRoughness(mask: LandMask): CanvasTexture {
  const w = mask.w, h = mask.h;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    const v = 255 * (0.28 + 0.7 * mask.data[i]);
    img.data[i * 4] = v; img.data[i * 4 + 1] = v; img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = new CanvasTexture(c);
  t.wrapS = RepeatWrapping;
  return t;
}

/** darken gas/ice giant limbs (and add a soft terminator) — they have no hard surface */
function patchLimbDarkening(sh: WebGLProgramParametersWithUniforms, k: number) {
  sh.fragmentShader = sh.fragmentShader.replace('#include <lights_fragment_end>',
    `#include <lights_fragment_end>
     {
       float mu = clamp(dot(normalize(vViewPosition), normal), 0.0, 1.0);
       float ld = pow(mu, ${k.toFixed(2)});
       reflectedLight.directDiffuse *= ld;
     }`);
}

export class BodyView {
  readonly sphere: Mesh;
  private mat: MeshStandardMaterial | MeshBasicMaterial;
  atmo: AtmosphereView | null = null;
  clouds: Mesh | null = null;
  rings: Mesh | null = null;
  glow: Sprite | null = null;
  dot: Sprite;
  terrain: Terrain | null = null;
  orbitLine: Line | null = null;
  private terrainMat: Material | null = null;
  private textured = false;
  private baked = false;
  private ready = false;
  /** camera distance to centre, m */
  dist = 0;
  /** apparent radius in pixels */
  pxRadius = 0;
  readonly rel = new Vector3();
  groundAlt = 0;

  constructor(public body: Body, private scene: Scene) {
    const def = body.def;
    if (!dotTex) dotTex = glowTexture(64, 3);
    if (!glowTex) glowTex = glowTexture(256, 2.4);
    const base = hexColor(def.palette[0]);
    if (body.isStar) {
      const c = hexColor(def.star!.color);
      this.mat = new MeshBasicMaterial({ color: c.clone().multiplyScalar(6) });
      // limb darkening + slowly boiling granulation; the core runs white-hot
      this.mat.onBeforeCompile = sh => {
        sh.uniforms.uTime = { value: 0 };
        this.mat.userData.shader = sh;
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', '#include <common>\nvarying vec3 vN; varying vec3 vV; varying vec3 vObj;')
          .replace('#include <begin_vertex>', `#include <begin_vertex>
            vN = normalize(normalMatrix * normal); vObj = position;
            vV = -(modelViewMatrix * vec4(position, 1.0)).xyz;`);
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <common>', `#include <common>
            varying vec3 vN; varying vec3 vV; varying vec3 vObj; uniform float uTime;
            float sh13(vec3 p){ p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
            float sn(vec3 p){ vec3 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
              return mix(mix(mix(sh13(i), sh13(i+vec3(1,0,0)), f.x), mix(sh13(i+vec3(0,1,0)), sh13(i+vec3(1,1,0)), f.x), f.y),
                         mix(mix(sh13(i+vec3(0,0,1)), sh13(i+vec3(1,0,1)), f.x), mix(sh13(i+vec3(0,1,1)), sh13(i+vec3(1,1,1)), f.x), f.y), f.z); }`)
          .replace('#include <opaque_fragment>', `
            float mu = clamp(dot(normalize(vN), normalize(vV)), 0.0, 1.0);
            float limb = 0.35 + 0.65 * pow(mu, 0.55);
            float gran = 0.82 + 0.18 * sn(vObj * 60.0 + uTime * 0.05) + 0.1 * sn(vObj * 240.0 - uTime * 0.12);
            outgoingLight *= limb * gran;
            outgoingLight += vec3(1.0) * pow(mu, 3.0) * 3.0;
            #include <opaque_fragment>`);
      };
      this.glow = new Sprite(new SpriteMaterial({ map: glowTex, color: c, blending: AdditiveBlending, depthWrite: false, transparent: true }));
      this.glow.renderOrder = 9000;
      scene.add(this.glow);
    } else {
      this.mat = new MeshStandardMaterial({ color: base, roughness: 0.95, metalness: 0 });
      if (def.surface === 'gas' || def.surface === 'icegiant') {
        this.mat.onBeforeCompile = sh => patchLimbDarkening(sh, def.surface === 'gas' ? 0.42 : 0.3);
      }
    }
    this.sphere = new Mesh(sphereGeo, this.mat);
    this.sphere.scale.setScalar(body.radius);
    scene.add(this.sphere);

    this.dot = new Sprite(new SpriteMaterial({
      map: dotTex, color: body.isStar ? hexColor(def.star!.color) : base.clone().lerp(new Color('#ffffff'), 0.45),
      sizeAttenuation: false, depthWrite: false, transparent: true, blending: AdditiveBlending,
    }));
    this.dot.scale.setScalar(body.isStar ? 0.02 : 0.009);
    scene.add(this.dot);

    if (body.isStation) {
      // the station model itself lives in the spacecraft scene; here it is only a distant beacon
      (this.dot.material as SpriteMaterial).color.set('#7dffb8');
      this.dot.scale.setScalar(0.007);
      this.sphere.visible = false;
      return;
    }
    if (def.atmosphere) { this.atmo = new AtmosphereView(body); scene.add(this.atmo.mesh); }
    if (def.rings) this.makeRings();
    if (body.parent) this.makeOrbitLine();
    this.loadAssets();
  }

  private async loadAssets() {
    const def = this.body.def;
    if (def.texture) {
      const tex = await loadTexture(def.texture);
      if (tex) {
        this.textured = true;
        this.mat.map = tex;
        if (this.body.isStar) (this.mat as MeshBasicMaterial).color.set(def.star!.color).multiplyScalar(5);
        else this.mat.color.set('#ffffff');
        this.mat.needsUpdate = true;
        if (def.surface === 'earth') this.body.surface.landMask = buildLandMask(tex);
        if (def.nightTexture) {
          const night = await loadTexture(def.nightTexture);
          if (night) {
            const m = this.mat as MeshStandardMaterial;
            m.emissiveMap = night; m.emissive.set('#ffd9a0'); m.emissiveIntensity = 1.4;
            m.onBeforeCompile = sh => patchNightLights(sh);
            m.needsUpdate = true;
          }
        }
        if (this.body.surface.landMask) {
          // glossy oceans: sun glint from orbit
          const m = this.mat as MeshStandardMaterial;
          m.roughnessMap = landRoughness(this.body.surface.landMask);
          m.roughness = 1;
          m.needsUpdate = true;
        }
        if (def.cloudTexture) this.makeClouds(def.cloudTexture);
      }
    }
    this.ready = true;
  }

  private async makeClouds(name: string) {
    const tex = await loadTexture(name);
    if (!tex) return;
    const venus = this.body.def.surface === 'venus';
    const m = new MeshStandardMaterial(venus
      ? { map: tex, roughness: 1 }
      : { color: '#ffffff', alphaMap: tex, roughness: 1 });
    // blended during the opaque pass so the atmosphere is drawn over the clouds
    m.transparent = false; m.depthWrite = false;
    m.blending = CustomBlending; m.blendSrc = SrcAlphaFactor; m.blendDst = OneMinusSrcAlphaFactor;
    this.clouds = new Mesh(sphereGeo, m);
    this.clouds.scale.setScalar(this.body.radius + (venus ? 62000 : 9000));
    this.scene.add(this.clouds);
  }

  private makeRings() {
    const r = this.body.def.rings!;
    const geo = new RingGeometry(r.inner * 1000, r.outer * 1000, 180, 1);
    const pos = geo.attributes.position, uv = geo.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      const d = Math.hypot(pos.getX(i), pos.getY(i));
      uv.setXY(i, (d / 1000 - r.inner) / (r.outer - r.inner), 0.5);
    }
    const mat = new ShaderMaterial({
      vertexShader: RING_VERT, fragmentShader: RING_FRAG, transparent: true, side: DoubleSide, depthWrite: false,
      uniforms: {
        uMap: { value: null }, uHasMap: { value: false }, uColor: { value: hexColor(r.color) }, uOpacity: { value: r.opacity },
        uSunLocal: { value: new Vector3(1, 0, 0) }, uPlanetR: { value: this.body.radius }, uSeed: { value: this.body.radius % 7 },
      },
    });
    this.rings = new Mesh(geo, mat);
    this.rings.renderOrder = 8000;
    this.scene.add(this.rings);
    if (r.texture) loadTexture(r.texture).then(t => {
      if (t) { mat.uniforms.uMap.value = t; mat.uniforms.uHasMap.value = true; mat.uniforms.uColor.value.set('#ffffff'); }
    });
  }

  private makeOrbitLine() {
    const b = this.body, n = 360;
    const pts = new Float32Array(n * 3);
    const bb = Math.sqrt(1 - b.e * b.e);
    for (let i = 0; i < n; i++) {
      const E = i / n * 2 * Math.PI;
      const x = b.a * (Math.cos(E) - b.e), y = b.a * bb * Math.sin(E);
      pts[i * 3] = b.P.x * x + b.Q.x * y; pts[i * 3 + 1] = b.P.y * x + b.Q.y * y; pts[i * 3 + 2] = b.P.z * x + b.Q.z * y;
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(pts, 3));
    const kind = b.def.kind;
    const color = kind === 'planet' ? '#4f8fd9' : kind === 'moon' ? '#7f8fa8' : kind === 'comet' ? '#7fd9c4' : '#8f7fb5';
    this.orbitLine = new LineLoop(geo, new LineBasicMaterial({ color, transparent: true, opacity: 0.5, depthWrite: false }));
    this.orbitLine.frustumCulled = false;
    this.orbitLine.renderOrder = 7000;
    this.scene.add(this.orbitLine);
  }

  /** sharp surface map: 0 = not yet, 1 = baking in the background, 2 = applied */
  private hiRes = 0;
  private disposed = false;

  /**
   * Approaching a body with a procedural surface: bake a much sharper map in a Web Worker and swap
   * it in when ready, so the surface is crisp well before the close-range terrain takes over.
   */
  private maybeHiRes(dist: number) {
    if (this.hiRes || !this.baked || this.textured || this.body.isStar || this.body.isStation) return;
    const b = this.body;
    if (dist - b.radius > b.radius * 40) return;
    this.hiRes = 1;
    const w = b.radius > 300e3 ? 2048 : 1024;
    bakeInBackground(b.def, w, w / 2).then(r => {
      if (!r || this.disposed) { if (!r) this.hiRes = 0; return; }
      const baked = texturesFromArrays(r, r.w, r.h);
      const m = this.mat as MeshStandardMaterial;
      const old = [m.map, m.bumpMap, m.roughnessMap, m.emissiveMap];
      m.map = baked.map;
      if (baked.bump) m.bumpMap = baked.bump;
      if (baked.rough) m.roughnessMap = baked.rough;
      if (baked.emissive) m.emissiveMap = baked.emissive;
      m.needsUpdate = true;
      for (const t of old) if (t && t !== m.map && t !== m.bumpMap && t !== m.roughnessMap && t !== m.emissiveMap) t.dispose();
      this.hiRes = 2;
    });
  }

  private ensureBaked() {
    if (this.baked || this.textured || this.body.isStar || !this.ready) return;
    this.baked = true;
    const s = this.body.surface;
    const big = s.type === 'gas' || s.type === 'icegiant' || this.body.radius > 2e6;
    const baked = bakeSurface(s, big ? 1024 : 512, big ? 512 : 256);
    const m = this.mat as MeshStandardMaterial;
    m.map = baked.map; m.color.set('#ffffff');
    if (baked.bump) { m.bumpMap = baked.bump; m.bumpScale = 3; }
    if (baked.rough) { m.roughnessMap = baked.rough; m.roughness = 1; }
    if (baked.emissive) { m.emissiveMap = baked.emissive; m.emissive.set('#ffffff'); m.emissiveIntensity = 2.5; }
    m.needsUpdate = true;
  }

  private ensureTerrain() {
    if (this.terrain || !this.body.def.landable || !this.ready) return;
    const s = this.body.surface;
    const mat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.93, metalness: 0 });
    const src = this.mat as MeshStandardMaterial;
    if (this.textured) mat.map = src.map;
    const night = this.textured && !!src.emissiveMap;
    if (night) {
      mat.emissiveMap = src.emissiveMap; mat.emissive.copy(src.emissive); mat.emissiveIntensity = src.emissiveIntensity;
    }
    // photo-mapped bodies get a little less procedural albedo so the real map still dominates
    const detailAmp = this.textured ? 0.28 : 0.4;
    const bumpAmp = s.type === 'ice' ? 0.6 : 1.0;
    mat.onBeforeCompile = sh => {
      patchTerrainShader(sh, detailAmp, bumpAmp, s.type === 'lava');
      if (night) patchNightLights(sh);
      mat.userData.shader = sh;
    };
    this.terrainMat = mat;
    this.terrain = new Terrain(this.body, this.scene, mat, this.textured, s.type === 'lava');
  }

  /**
   * camPos: camera position in the sim frame. Returns nothing; updates all visuals.
   * pxPerRad: pixels per radian of view angle. order: draw order rank (far bodies first).
   */
  update(camPos: Vector3, t: number, pxPerRad: number, order: number, orbitAlpha: number, terrainBudget: number) {
    const b = this.body;
    const rel = this.rel.subVectors(b.pos, camPos);
    const dist = this.dist = rel.length();
    this.maybeHiRes(dist);
    this.pxRadius = Math.atan2(b.radius, dist) * pxPerRad;
    if (b.isStation) {
      // beacon until the real model is resolvable (~2000 km); never drawn on top of a nearby planet
      this.dot.visible = dist > 1.5e6;
      this.dot.position.copy(rel);
      (this.dot.material as SpriteMaterial).opacity = 0.9;
      this.dot.renderOrder = 6000;
      return;
    }
    b.orientation(t, _q);
    const big = this.pxRadius > 1.2;

    // direction to the star from this body
    _sun.copy(b.pos).negate();
    if (_sun.lengthSq() < 1) _sun.set(1, 0, 0);
    _sun.normalize();

    // distant point of light
    this.dot.visible = this.pxRadius < 1.6;
    if (this.dot.visible) {
      this.dot.position.copy(rel);
      const o = Math.min(1, Math.max(0.1, 0.3 + 0.22 * Math.log10(this.pxRadius * 100 + 1e-9)));
      (this.dot.material as SpriteMaterial).opacity = b.isStar ? 1 : o;
      this.dot.renderOrder = 6000;
    }

    if (big) this.ensureBaked();
    // detailed terrain only when close; from orbit the smooth photo-mapped sphere looks cleaner
    const useTerrain = b.def.landable && dist - b.radius < Math.min(b.radius * 5, 250e3) && this.ready;
    if (useTerrain) this.ensureTerrain();
    const terrainOn = !!(useTerrain && this.terrain);

    this.sphere.visible = big && !terrainOn;
    if (this.sphere.visible) {
      this.sphere.position.copy(rel);
      this.sphere.quaternion.copy(_q);
      this.sphere.renderOrder = order;
    }
    if (this.terrain) {
      const sh = this.terrainMat?.userData.shader as WebGLProgramParametersWithUniforms | undefined;
      if (sh) sh.uniforms.uTime.value = performance.now() / 1000;
      if (terrainOn) {
        _qi.copy(_q).invert();
        _cl.copy(rel).negate().applyQuaternion(_qi);
        this.terrain.update(_cl, rel, _q, order, terrainBudget);
        // local ground level for the atmosphere shader
        const d = _v.copy(_cl).normalize();
        const h = b.surface.height(d.x, d.y, d.z, 1e-5);
        this.groundAlt = Math.min(h, dist - b.radius - 2);
      } else { this.terrain.hide(); this.groundAlt = 0; }
    }

    if (this.clouds) {
      const alt = dist - b.radius;
      const venus = b.def.surface === 'venus';
      const lo = venus ? 55000 : 12000, hi = venus ? 90000 : 60000;
      const f = Math.min(1, Math.max(0, (alt - lo) / (hi - lo)));
      this.clouds.visible = big && f > 0;
      if (this.clouds.visible) {
        this.clouds.position.copy(rel);
        // slow cloud drift
        this.clouds.quaternion.copy(_q).multiply(_qi.setFromAxisAngle(_v.set(0, 1, 0), t * 2e-6 % (2 * Math.PI)));
        this.clouds.renderOrder = order + 0.3;
        const m = this.clouds.material as MeshStandardMaterial;
        m.opacity = venus ? f : f * 0.9;
      }
    }

    if (this.atmo) {
      this.atmo.mesh.visible = this.pxRadius > 2;
      if (this.atmo.mesh.visible) {
        this.atmo.mesh.renderOrder = order + 0.5;
        this.atmo.update(rel, _sun, terrainOn ? this.groundAlt - 1 : 0);
      }
    }

    if (this.rings) {
      this.rings.visible = this.pxRadius > 1;
      if (this.rings.visible) {
        this.rings.position.copy(rel);
        // ring plane = equator: RingGeometry lies in XY, rotate so its normal is the spin axis
        _qi.setFromUnitVectors(_v.set(0, 0, 1), b.axis);
        this.rings.quaternion.copy(_qi);
        const u = (this.rings.material as ShaderMaterial).uniforms;
        (u.uSunLocal.value as Vector3).copy(_sun).applyQuaternion(_qi.invert());
      }
    }

    if (this.glow) {
      const ssh = this.mat.userData.shader as WebGLProgramParametersWithUniforms | undefined;
      if (ssh) ssh.uniforms.uTime.value = performance.now() / 1000;
      this.glow.position.copy(rel);
      const s = Math.max(b.radius * 9, dist * 0.09);
      this.glow.scale.setScalar(s);
      (this.glow.material as SpriteMaterial).opacity = Math.min(1, 0.35 + 0.65 * Math.min(1, dist / (b.radius * 60)));
    }

    if (this.orbitLine) {
      const par = b.parent!;
      const isMoon = par.parent !== null;
      let op = 0;
      if (orbitAlpha > 0) {
        op = orbitAlpha * Math.min(1, Math.max(0, (dist / b.a - 0.004) / 0.02));
        if (isMoon) {
          const dp = _v.subVectors(par.pos, camPos).length();
          op *= Math.min(1, Math.max(0, (b.a * 400 - dp) / (b.a * 200)));
        }
      }
      this.orbitLine.visible = op > 0.01;
      if (this.orbitLine.visible) {
        this.orbitLine.position.subVectors(par.pos, camPos);
        (this.orbitLine.material as LineBasicMaterial).opacity = op * (isMoon ? 0.4 : 0.55);
      }
    }
  }

  dispose() {
    this.disposed = true;
    const s = this.scene;
    s.remove(this.sphere, this.dot);
    if (this.atmo) s.remove(this.atmo.mesh);
    if (this.clouds) s.remove(this.clouds);
    if (this.rings) s.remove(this.rings);
    if (this.glow) s.remove(this.glow);
    if (this.orbitLine) { s.remove(this.orbitLine); this.orbitLine.geometry.dispose(); }
    this.terrain?.dispose();
    this.terrainMat?.dispose();
    this.mat.map?.dispose?.();
    this.mat.dispose();
  }
}

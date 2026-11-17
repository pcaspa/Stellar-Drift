import { starLightColor } from './starlight';
import { BackSide, CustomBlending, AddEquation, OneFactor, SrcAlphaFactor, Mesh, ShaderMaterial, SphereGeometry, Vector3 } from 'three';
import { Body } from '../sim/universe';

const VERT = /* glsl */`
varying vec3 vDir;
#include <common>
#include <logdepthbuf_pars_vertex>
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vDir = wp.xyz; // camera sits at the scene origin
  gl_Position = projectionMatrix * viewMatrix * wp;
  #include <logdepthbuf_vertex>
}`;

const FRAG = /* glsl */`
precision highp float;
uniform vec3 uCam;      // camera relative to planet centre, in planet radii
uniform vec3 uSunDir;
uniform float uRt;      // top of atmosphere, radii
uniform float uRg;      // local ground radius, radii
uniform vec3 uBetaR;    // Rayleigh coefficient per planet radius
uniform float uBetaM;
uniform vec3 uMieCol;
uniform float uHr;
uniform float uHm;
uniform float uSunI;
uniform vec3 uSunColor;
varying vec3 vDir;
#include <common>
#include <logdepthbuf_pars_fragment>
#define STEPS 18
#define LSTEPS 5

vec2 sph(vec3 o, vec3 d, float r) {
  float b = dot(o, d);
  float c = dot(o, o) - r * r;
  float h = b * b - c;
  if (h < 0.0) return vec2(1e9, -1e9);
  h = sqrt(h);
  return vec2(-b - h, -b + h);
}
float dens(float h, float H) { return exp(min(-h / H, 40.0)); }

void main() {
  #include <logdepthbuf_fragment>
  vec3 d = normalize(vDir);
  vec2 ta = sph(uCam, d, uRt);
  if (ta.x > ta.y || ta.y < 0.0) discard;
  float t0 = max(ta.x, 0.0), t1 = ta.y;
  vec2 tg = sph(uCam, d, uRg);
  bool ground = tg.x < tg.y && tg.x > 0.0;
  if (ground) {
    // grazing hits near the geometric horizon are treated as sky: the real terrain horizon
    // differs from this smooth sphere, and stopping the ray there leaves a dark band
    float dh = sqrt(max(dot(uCam, uCam) - uRg * uRg, 1e-12));
    float g = smoothstep(0.995, 0.8, tg.x / dh);
    t1 = mix(t1, min(t1, tg.x), g);
    ground = g > 0.5;
  }
  float seg = (t1 - t0) / float(STEPS);
  vec3 sumR = vec3(0.0), sumM = vec3(0.0);
  float odR = 0.0, odM = 0.0;
  // dither the start to hide banding
  // interleaved gradient noise: far less visible than white-noise dither
  float jitter = 0.5 + 0.5 * (fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) - 0.5);
  for (int i = 0; i < STEPS; i++) {
    vec3 p = uCam + d * (t0 + (float(i) + jitter) * seg);
    float h = length(p) - 1.0;
    float dR = dens(h, uHr) * seg, dM = dens(h, uHm) * seg;
    odR += dR; odM += dM;
    vec2 tl = sph(p, uSunDir, uRt);
    float segL = tl.y / float(LSTEPS);
    float lR = 0.0, lM = 0.0;
    for (int j = 0; j < LSTEPS; j++) {
      vec3 q = p + uSunDir * ((float(j) + 0.5) * segL);
      float hl = length(q) - 1.0;
      lR += dens(hl, uHr) * segL; lM += dens(hl, uHm) * segL;
    }
    vec2 sh = sph(p, uSunDir, 0.997);
    float lit = (sh.x < sh.y && sh.y > 0.0) ? 0.0 : 1.0;
    vec3 att = exp(-(uBetaR * (odR + lR) + uBetaM * 1.1 * (odM + lM))) * lit;
    sumR += dR * att; sumM += dM * att;
  }
  float mu = dot(d, uSunDir);
  float phR = 0.0596831 * (1.0 + mu * mu);
  float g = 0.76;
  float phM = 0.1193662 * ((1.0 - g * g) * (1.0 + mu * mu)) / ((2.0 + g * g) * pow(1.0 + g * g - 2.0 * g * mu, 1.5));
  vec3 col = uSunI * uSunColor * (sumR * uBetaR * phR + sumM * uBetaM * uMieCol * phM);
  vec3 trans = exp(-(uBetaR * odR + uBetaM * 1.1 * odM));
  float a = dot(trans, vec3(0.3333));
  // a bright sky hides the stars behind it
  if (!ground) a *= 1.0 - clamp(dot(col, vec3(0.3333)) * 12.0, 0.0, 1.0);
  gl_FragColor = vec4(col, a);
}`;

const geo = new SphereGeometry(1, 96, 48);

export class AtmosphereView {
  readonly mesh: Mesh;
  readonly mat: ShaderMaterial;
  /** visual top of atmosphere, m */
  readonly top: number;

  constructor(public body: Body) {
    const a = body.def.atmosphere!;
    const R = body.radius;
    const H = a.scaleHeight * 1000;
    this.top = H * 10;
    const mc = a.mieColor ?? [1, 1, 1];
    const sc = starLightColor(body.system.star.def.star!.teff);
    const sunColor = new Vector3(sc.r, sc.g, sc.b);
    this.mat = new ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG,
      uniforms: {
        uCam: { value: new Vector3() }, uSunDir: { value: new Vector3(1, 0, 0) },
        uRt: { value: 1 + this.top / R }, uRg: { value: 1 },
        uBetaR: { value: new Vector3(a.rayleigh[0], a.rayleigh[1], a.rayleigh[2]).multiplyScalar(1e-6 * R) },
        uBetaM: { value: a.mie * 1e-6 * R }, uMieCol: { value: new Vector3(mc[0], mc[1], mc[2]) },
        uHr: { value: H / R }, uHm: { value: H * (a.mieH ?? 0.25) / R }, uSunI: { value: 11 }, uSunColor: { value: sunColor },
      },
      side: BackSide, transparent: false, depthTest: false, depthWrite: false,
      blending: CustomBlending, blendEquation: AddEquation, blendSrc: OneFactor, blendDst: SrcAlphaFactor,
    });
    this.mesh = new Mesh(geo, this.mat);
    this.mesh.scale.setScalar(R + this.top * 1.02);
    this.mesh.frustumCulled = false;
  }

  /** camRel = camera - body centre (m), groundAlt = terrain height under the camera (m) */
  update(bodyRel: Vector3, sunDir: Vector3, groundAlt: number) {
    const R = this.body.radius;
    this.mesh.position.copy(bodyRel);
    const u = this.mat.uniforms;
    (u.uCam.value as Vector3).copy(bodyRel).multiplyScalar(-1 / R);
    (u.uSunDir.value as Vector3).copy(sunDir);
    u.uRg.value = 1 + groundAlt / R;
    // single scattering under-lights the sky seen from inside; from space it is already bright enough
    const camAlt = bodyRel.length() - R;
    const f = Math.min(1, Math.max(0, camAlt / this.top));
    u.uSunI.value = 11 - 6 * f;
  }
}

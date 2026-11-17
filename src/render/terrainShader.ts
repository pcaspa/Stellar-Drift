import type { WebGLProgramParametersWithUniforms } from 'three';

/**
 * Patches a MeshStandardMaterial used for terrain chunks with:
 *  - multi-octave procedural albedo variation + bump shading (fades out per octave when it
 *    gets smaller than a pixel, so it never aliases)
 *  - glossy liquid surfaces (oceans / hydrocarbon seas) via a per-vertex "water" attribute
 *  - optional emissive lava glow
 *
 * Noise is evaluated on `dpos`, the body-fixed position with a per-chunk offset that is a
 * multiple of PERIOD removed. The noise is periodic with PERIOD so chunks stay seamless while
 * the shader only ever sees small, precise numbers.
 */
export const DETAIL_PERIOD = 8192;

const VERT_HEAD = /* glsl */`
attribute vec3 dpos;
attribute float water;
attribute float glow;
varying vec3 vDpos;
varying float vWater;
varying float vGlow;
`;
const VERT_BODY = /* glsl */`
vDpos = dpos;
vWater = water;
vGlow = glow;
`;

const FRAG_HEAD = /* glsl */`
varying vec3 vDpos;
varying float vWater;
varying float vGlow;
uniform float uDetailAmp;
uniform float uBumpAmp;
uniform float uTime;

float th13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}
float tvnoise(vec3 p, float per) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  vec3 a = mod(i, per), b = mod(i + 1.0, per);
  float n000 = th13(vec3(a.x, a.y, a.z)), n100 = th13(vec3(b.x, a.y, a.z));
  float n010 = th13(vec3(a.x, b.y, a.z)), n110 = th13(vec3(b.x, b.y, a.z));
  float n001 = th13(vec3(a.x, a.y, b.z)), n101 = th13(vec3(b.x, a.y, b.z));
  float n011 = th13(vec3(a.x, b.y, b.z)), n111 = th13(vec3(b.x, b.y, b.z));
  return mix(mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y),
             mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y), u.z) * 2.0 - 1.0;
}
// returns (albedo variation, height in metres)
vec2 terrainDetail(vec3 p, float footprint) {
  float alb = 0.0, h = 0.0;
  float wl = 2048.0;          // wavelength of the first octave, metres
  for (int k = 0; k < 12; k++) {
    // fade an octave out as its wavelength approaches ~3 pixels
    float w = 1.0 - smoothstep(2.0, 5.0, footprint / wl * 8.0);
    if (w <= 0.0) break;
    float per = ${DETAIL_PERIOD.toFixed(1)} / wl;
    float n = tvnoise(p / wl + float(k) * 7.31, per);
    float r = 1.0 - abs(tvnoise(p / wl * 1.0 + 3.7 + float(k) * 1.9, per));
    alb += n * w * 0.55;
    h += (r * r - 0.4) * wl * 0.09 * w + n * wl * 0.03 * w;
    wl *= 0.5;
    alb *= 0.82;
  }
  return vec2(alb, h);
}
`;

export function patchTerrainShader(sh: WebGLProgramParametersWithUniforms, detailAmp: number, bumpAmp: number, lava: boolean) {
  sh.uniforms.uDetailAmp = { value: detailAmp };
  sh.uniforms.uBumpAmp = { value: bumpAmp };
  sh.uniforms.uTime = { value: 0 };
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', '#include <common>\n' + VERT_HEAD)
    .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + VERT_BODY);
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', '#include <common>\n' + FRAG_HEAD)
    .replace('#include <color_fragment>', /* glsl */`
      #include <color_fragment>
      float tFoot = length(fwidth(vDpos));
      vec2 tDet = terrainDetail(vDpos, tFoot);
      float tLand = 1.0 - vWater;
      diffuseColor.rgb *= 1.0 + tDet.x * uDetailAmp * tLand;
    `)
    .replace('#include <roughnessmap_fragment>', /* glsl */`
      #include <roughnessmap_fragment>
      roughnessFactor = mix(roughnessFactor, 0.16, vWater);
    `)
    .replace('#include <normal_fragment_maps>', /* glsl */`
      #include <normal_fragment_maps>
      {
        // Mikkelsen-style bump mapping from screen-space derivatives of the procedural height
        float bh = tDet.y * uBumpAmp * tLand;
        if (vWater > 0.5) {
          float wf = 1.0 - smoothstep(2.0, 40.0, tFoot);
          bh = (tvnoise(vDpos / 8.0 + vec3(0.0, uTime * 0.25, 0.0), ${(DETAIL_PERIOD / 8).toFixed(1)})
              + 0.5 * tvnoise(vDpos / 2.0 + vec3(uTime * 0.4, 0.0, 0.0), ${(DETAIL_PERIOD / 2).toFixed(1)})) * 0.25 * wf;
        }
        vec3 dpdx = dFdx(-vViewPosition), dpdy = dFdy(-vViewPosition);
        float dhx = dFdx(bh), dhy = dFdy(bh);
        vec3 r1 = cross(dpdy, normal), r2 = cross(normal, dpdx);
        float det = dot(dpdx, r1);
        vec3 grad = sign(det) * (dhx * r1 + dhy * r2);
        vec3 nn = abs(det) * normal - grad;
        if (dot(nn, nn) > 1e-20) normal = normalize(nn);
      }
    `);
  if (lava) {
    sh.fragmentShader = sh.fragmentShader.replace('#include <lights_fragment_end>',
      '#include <lights_fragment_end>\ntotalEmissiveRadiance += vec3(2.6, 0.7, 0.12) * vGlow * (0.85 + 0.3 * tDet.x);');
  }
}

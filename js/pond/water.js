// Mặt nước: khúc xạ nền nước theo độ dốc của lưới sóng + sóng nền, ánh nắng lấp lánh,
// đỉnh sóng sáng, đáy sóng tối, sườn dốc ánh màu trời.
import * as THREE from 'three';
import { SUN, AMBIENT_WAVES, AMBIENT_GAIN } from './config.js';

const WAVES_GLSL = /* glsl */ `
uniform vec4 uWaves[5];
vec3 waves(vec2 p, float t){
  vec3 r = vec3(0.0);
  for (int i = 0; i < 5; i++){
    vec4 w = uWaves[i];
    vec2 dd = vec2(cos(w.x), sin(w.x));
    float k = 6.2831853 / w.y;
    float ph = k * (dot(dd, p) - w.z * t);
    r.x += w.w * sin(ph);
    r.yz += w.w * k * cos(ph) * dd;
  }
  return r;
}`;

const VERT = /* glsl */ `
uniform vec4 uArea;
varying vec2 vImg;
varying vec3 vWorld;
void main(){
  vImg = uArea.xy + vec2(uv.x, 1.0 - uv.y) * uArea.zw;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const FRAG = /* glsl */ `
uniform sampler2D uWater;
uniform sampler2D uHeight;
uniform vec4 uArea;
uniform vec4 uRegion;
uniform vec2 uGrid;
uniform float uCell, uAmpScale;
uniform float uTime, uAmb, uGain, uRefr, uNormal, uShade, uDiffuse, uCaustic, uGlint, uFresnel;
uniform vec2 uSun;
uniform vec3 uL, uCam;
varying vec2 vImg;
varying vec3 vWorld;
${WAVES_GLSL}
void main(){
  vec2 g = (vImg - uArea.xy) / (uGrid * uCell);
  // lấy mẫu cách 1,5 ô: nội suy song tuyến làm mượt pháp tuyến, không lộ ô lưới
  vec2 tx = 1.5 / uGrid;
  float h  = texture2D(uHeight, g).r;
  float hl = texture2D(uHeight, g - vec2(tx.x, 0.0)).r;
  float hr = texture2D(uHeight, g + vec2(tx.x, 0.0)).r;
  float hu = texture2D(uHeight, g - vec2(0.0, tx.y)).r;
  float hd = texture2D(uHeight, g + vec2(0.0, tx.y)).r;
  vec2 grad = vec2(hr - hl, hd - hu) / (3.0 * uCell) * uGain;
  vec3 amb = waves(vImg, uTime) * uAmb;
  vec2 G = grad + amb.yz;

  vec2 p = vImg - G * uRefr;
  vec2 wuv = (p - uRegion.xy) / uRegion.zw;
  vec3 c = texture2D(uWater, vec2(wuv.x, 1.0 - wuv.y)).rgb;

  // chiều cao và độ cong quy về ô 4 px để sáng/tối giống nhau ở mọi độ phóng
  float lap = (hl + hr + hu + hd - 4.0 * h) * uGain / uAmpScale;
  c *= 1.0 + clamp(h / uAmpScale * uGain * uShade, -0.14, 0.14);
  // sườn sóng quay về phía mặt trời sáng lên, sườn khuất tối đi → vòng sóng rõ nét
  vec2 toSun = normalize(vec2(uL.x, -uL.y));
  c *= 1.0 + clamp(dot(-G, toSun) * uDiffuse, -0.28, 0.32);
  c += vec3(0.75, 0.88, 1.0) * clamp(-lap * uCaustic, 0.0, 0.22);

  vec3 n = normalize(vec3(-G.x * uNormal, G.y * uNormal, 1.0));
  vec3 V = normalize(uCam - vWorld);
  vec3 Hh = normalize(uL + V);
  float sp = pow(max(dot(n, Hh), 0.0), 90.0);
  float sunNear = exp(-length(vImg - uSun) / 900.0);
  c += vec3(1.0, 0.97, 0.88) * sp * uGlint * (0.3 + 0.7 * sunNear);

  float slope = clamp(length(grad) * uFresnel, 0.0, 0.28);
  c = mix(c, vec3(0.80, 0.91, 1.0), slope);

  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}`;

// area: vùng mặt nước (toạ độ ảnh) — trùng với gốc lưới sóng; region: vùng texture nước (rộng hơn area).
export function createWater({ waterTexture, region, area, sim, reduceMotion }) {
  const uniforms = {
    uWater: { value: waterTexture },
    uHeight: { value: sim.texture },
    uArea: { value: new THREE.Vector4(area.x, area.y, area.w, area.h) },
    uRegion: { value: new THREE.Vector4(region.x, region.y, region.w, region.h) },
    uGrid: { value: new THREE.Vector2(sim.cols, sim.rows) },
    uCell: { value: sim.cell },
    uAmpScale: { value: sim.ampScale },
    uTime: { value: 0 },
    uAmb: { value: (reduceMotion ? 0.35 : 1) * AMBIENT_GAIN },
    uWaves: { value: AMBIENT_WAVES.map((w) => new THREE.Vector4(...w)) },
    uGain: { value: 1 },
    uRefr: { value: 46 },
    uNormal: { value: 2.6 },
    uShade: { value: 0.03 },
    uDiffuse: { value: 1.5 },
    uCaustic: { value: 1.6 },
    uGlint: { value: 0.75 },
    uFresnel: { value: 0.9 },
    uSun: { value: new THREE.Vector2(SUN.img[0], SUN.img[1]) },
    uL: { value: new THREE.Vector3(...SUN.dir).normalize() },
    uCam: { value: new THREE.Vector3() },
  };
  const material = new THREE.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader: FRAG, depthTest: false, depthWrite: false });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(area.w, area.h), material);
  mesh.renderOrder = 0;
  mesh.frustumCulled = false;
  return { mesh, uniforms };
}

// Sóng nền tính trên CPU, cùng công thức với shader, để vịt nhấp nhô khớp mặt nước.
export function waveAt(x, y, t, gain, out) {
  let h = 0, gx = 0, gy = 0;
  for (const w of AMBIENT_WAVES) {
    const dx = Math.cos(w[0]), dy = Math.sin(w[0]), k = 6.2831853 / w[1];
    const ph = k * (dx * x + dy * y - w[2] * t), s = Math.sin(ph), c = Math.cos(ph);
    h += w[3] * s; gx += w[3] * k * c * dx; gy += w[3] * k * c * dy;
  }
  out.h = h * gain; out.gx = gx * gain; out.gy = gy * gain;
  return out;
}

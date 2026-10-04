// Mặt nước nhìn TỪ DƯỚI HỒ LÊN.
//
// Đứng trên bờ nhìn xuống thì ta thấy nắng dội lại trên đỉnh sóng. Từ dưới nhìn lên thì khác hẳn:
// mặt nước là một tấm thấu kính méo mó. Chỗ mặt nước cong lõm sẽ TỤ ánh sáng trên trời lại thành
// vệt sáng chói; chỗ cong lồi thì xoè ánh sáng ra nên tối đi. Vậy cái quyết định sáng tối ở đây là
// ĐỘ CONG của mặt nước (Laplace), không phải độ dốc như bản nhìn từ trên.
// Thêm hai dấu hiệu nữa của góc nhìn dưới nước: nền bị khúc xạ lệch đi theo độ dốc, và chỗ dốc quá
// mức tới hạn thì phản xạ toàn phần, soi lại đáy hồ tối om thay vì nhìn thấy trời.
import * as THREE from 'three';
import { SUN, AMBIENT_WAVES, AMBIENT_GAIN } from './config.js';

// Phép chiếu ảnh ↔ mặt phẳng nước (xem persp.js) và sóng nền, dùng chung cho shader nước và vật nổi.
// waves(img, t): sóng phẳng trên MẶT PHẲNG NƯỚC tại điểm ảnh img → (chiều cao, đạo hàm theo px ảnh x,
// đạo hàm theo px ảnh y, Laplace trên mặt nước). Bước sóng tính trên mặt nước nên lên màn hình sóng ở
// xa (thấp) ngắn lại, dọc màn hình dẹt lại — cùng phối cảnh với mọi thứ khác.
export const WAVES_GLSL = /* glsl */ `
uniform vec4 uWaves[5];
uniform float uSquash;
uniform vec4 uPersp; // (cx, y0, near, k): S(y) = near + k·(y − y0)
float perspS(float y){ return uPersp.z + uPersp.w * (y - uPersp.y); }
vec2 planeOf(vec2 img){
  float s = perspS(img.y);
  return vec2((img.x - uPersp.x) / s, log(s / uPersp.z) / (uPersp.w * uSquash));
}
vec2 gradToImage(vec2 g, vec2 img){
  float s = perspS(img.y);
  return vec2(g.x / s, g.y / (s * uSquash) - g.x * (img.x - uPersp.x) * uPersp.w / (s * s));
}
vec4 waves(vec2 img, float t){
  vec2 p = planeOf(img);
  vec4 r = vec4(0.0);
  vec2 gp = vec2(0.0);
  for (int i = 0; i < 5; i++){
    vec4 w = uWaves[i];
    vec2 dd = vec2(cos(w.x), sin(w.x));
    float k = 6.2831853 / w.y;
    float ph = k * (dot(dd, p) - w.z * t);
    float s = sin(ph);
    r.x += w.w * s;
    gp += w.w * k * cos(ph) * dd;
    r.w += -w.w * k * k * s;
  }
  r.yz = gradToImage(gp, img);
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
uniform vec2 uSimOrigin; // gốc lưới sóng trên mặt phẳng nước
uniform vec2 uGrid;
uniform float uCell, uAmpScale; // ô vuông trên mặt phẳng nước (toạ độ phối cảnh)
uniform float uTime, uAmb, uGain, uRefr, uFocus, uFocusTint, uTIR, uShade, uSunGain;
uniform vec2 uSun;
uniform vec3 uL;
varying vec2 vImg;
varying vec3 vWorld;
${WAVES_GLSL}

void main(){
  vec2 g = (planeOf(vImg) - uSimOrigin) / (uGrid * uCell); // toạ độ texture lưới sóng tại điểm ảnh này
  // lấy mẫu cách 1,5 ô: nội suy song tuyến làm mượt, không lộ ô lưới
  vec2 tx = 1.5 / uGrid;
  float h  = texture2D(uHeight, g).r;
  float hl = texture2D(uHeight, g - vec2(tx.x, 0.0)).r;
  float hr = texture2D(uHeight, g + vec2(tx.x, 0.0)).r;
  float hu = texture2D(uHeight, g - vec2(0.0, tx.y)).r;
  float hd = texture2D(uHeight, g + vec2(0.0, tx.y)).r;

  vec2 grad = gradToImage(vec2(hr - hl, hd - hu) / (3.0 * uCell), vImg) * uGain; // độ dốc theo px ảnh
  // độ cong trên mặt nước (lưới đẳng hướng ở đó), quy về ô 4 px để sáng tối như nhau ở mọi độ phóng
  float lapSim = (hl + hr + hu + hd - 4.0 * h) * uGain / uAmpScale;

  vec4 amb = waves(vImg, uTime) * uAmb;
  vec2 G = grad + amb.yz;
  float lap = lapSim + amb.w;

  // 1) khúc xạ: từ dưới nhìn lên, cảnh phía trên bị mặt nước bẻ lệch theo độ dốc
  vec2 p = vImg - G * uRefr;
  vec2 wuv = (p - uRegion.xy) / uRegion.zw;
  vec3 c = texture2D(uWater, vec2(wuv.x, 1.0 - wuv.y)).rgb;

  // 2) tụ sáng: đây là thứ tạo ra hình sóng khi nhìn từ dưới lên.
  // Mặt cong lõm gom tia sáng lại -> vệt chói; cong lồi thì xoè ra -> tối.
  // Càng gần chỗ mặt trời rọi xuống thì tương phản càng mạnh.
  float sunNear = exp(-length(vImg - uSun) / 1500.0);
  float focus = clamp(-lap * uFocus * (0.55 + uSunGain * sunNear), -0.55, 1.5);
  c *= 1.0 + focus;
  // phần chói nhất ngả sang trắng xanh như ánh sáng xuyên qua mặt nước
  c += vec3(0.78, 0.90, 1.0) * max(0.0, focus - 0.28) * uFocusTint;

  // 3) chiều cao chỉ còn góp một chút để lớp nước dày mỏng khác nhau
  c *= 1.0 + clamp((h / uAmpScale) * uGain * uShade, -0.10, 0.10);

  // 4) dốc quá mức tới hạn thì mặt nước thành gương soi đáy hồ -> tối lại
  float steep = clamp(length(G) * uTIR, 0.0, 0.40);
  c = mix(c, c * vec3(0.62, 0.70, 0.80), steep);

  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}`;

// area: vùng mặt nước (toạ độ ảnh) — trùng gốc lưới sóng; region: vùng texture nước (rộng hơn area).
export function createWater({ waterTexture, region, area, sim, reduceMotion }) {
  const uniforms = {
    uWater: { value: waterTexture },
    uHeight: { value: sim.texture },
    uArea: { value: new THREE.Vector4(area.x, area.y, area.w, area.h) },
    uRegion: { value: new THREE.Vector4(region.x, region.y, region.w, region.h) },
    uGrid: { value: new THREE.Vector2(sim.cols, sim.rows) },
    uCell: { value: sim.cell },
    uSimOrigin: { value: new THREE.Vector2(sim.ox, sim.oy) },
    uSquash: { value: sim.sq },
    uPersp: { value: sim.persp.uniform() },
    uAmpScale: { value: sim.ampScale },
    uTime: { value: 0 },
    uAmb: { value: (reduceMotion ? 0.35 : 1) * AMBIENT_GAIN },
    uWaves: { value: AMBIENT_WAVES.map((w) => new THREE.Vector4(...w)) },
    uGain: { value: 1 },
    uRefr: { value: 54 },      // độ lệch khúc xạ của nền
    uFocus: { value: 8.5 },    // độ mạnh của vệt tụ sáng
    uFocusTint: { value: 0.42 }, // độ ngả trắng xanh ở chỗ chói nhất
    uTIR: { value: 1.6 },      // ngưỡng phản xạ toàn phần
    uShade: { value: 0.025 },
    uSunGain: { value: 0.8 },
    uSun: { value: new THREE.Vector2(SUN.img[0], SUN.img[1]) },
    uL: { value: new THREE.Vector3(...SUN.dir).normalize() },
  };
  const material = new THREE.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader: FRAG, depthTest: false, depthWrite: false });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(area.w, area.h), material);
  mesh.renderOrder = 0;
  mesh.frustumCulled = false;
  return { mesh, uniforms };
}

// Sóng nền tính trên CPU, cùng công thức với shader, để vịt và lá nhấp nhô khớp mặt nước.
// persp: phép chiếu ảnh ↔ mặt phẳng nước (persp.js). Đạo hàm trả về theo px ảnh.
export function waveAt(x, y, t, gain, out, persp) {
  const [X, Y] = persp.toPlane(x, y);
  let h = 0, gX = 0, gY = 0;
  for (const w of AMBIENT_WAVES) {
    const dx = Math.cos(w[0]), dy = Math.sin(w[0]), k = 6.2831853 / w[1];
    const ph = k * (dx * X + dy * Y - w[2] * t), s = Math.sin(ph), c = Math.cos(ph);
    h += w[3] * s; gX += w[3] * k * c * dx; gY += w[3] * k * c * dy;
  }
  const [gx, gy] = persp.gradToImage(gX, gY, x, y);
  out.h = h * gain; out.gx = gx * gain; out.gy = gy * gain;
  return out;
}

// Mặt nước nhìn TỪ DƯỚI HỒ LÊN, trên nền tranh vòm cây + bầu trời (images-bg/bg.webp, nướng sẵn từ PSD của
// gói art bằng tools/bake-bg.py).
//
// Đứng trên bờ nhìn xuống thì ta thấy nắng dội lại trên đỉnh sóng. Từ dưới nhìn lên thì khác hẳn:
// mặt nước là một tấm thấu kính méo mó. Chỗ mặt nước cong lõm sẽ TỤ ánh sáng trên trời lại thành
// vệt sáng chói; chỗ cong lồi thì xoè ánh sáng ra nên tối đi. Vậy cái quyết định sáng tối ở đây là
// ĐỘ CONG của mặt nước (Laplace), không phải độ dốc như bản nhìn từ trên.
// Thêm hai dấu hiệu nữa của góc nhìn dưới nước: nền bị khúc xạ lệch đi theo độ dốc, và chỗ dốc quá
// mức tới hạn thì phản xạ toàn phần, soi lại đáy hồ tối om thay vì nhìn thấy trời.
// Mọi thứ trên chỉ xảy ra trong VÙNG MẶT NƯỚC (mặt nạ uZone: bên trên cung SURFACE.arc, mép hoà mềm);
// phần dưới là nước sâu, đứng yên, chỉ có tia nắng lung linh. Trong elip mặt nước còn phủ LƯỚI SÓNG TRẮNG
// (WATER-EFFECT 2.svg) lấy mẫu trên mặt phẳng nước nên ô lưới co theo phối cảnh và méo theo gợn sóng.
import * as THREE from 'three';
import { SUN, AMBIENT_WAVES, AMBIENT_GAIN, SURFACE, NET, RAYS, DEEP_FLOW, FOLIAGE } from './config.js';

// Phép chiếu ảnh ↔ mặt phẳng nước (xem persp.js) và sóng nền, dùng chung cho shader nước và vật nổi.
// waves(img, t): sóng phẳng trên MẶT PHẲNG NƯỚC tại điểm ảnh img → (chiều cao, đạo hàm theo px ảnh x,
// đạo hàm theo px ảnh y, Laplace trên mặt nước). Bước sóng tính trên mặt nước nên lên màn hình sóng ở
// xa (thấp) ngắn lại, dọc màn hình dẹt lại — cùng phối cảnh với mọi thứ khác.
export const WAVES_GLSL = /* glsl */ `
uniform vec4 uWaves[5];
uniform float uSquash;
uniform vec4 uPersp;   // (cx, y0, near, k) — xem persp.js; điểm tụ ở (cx, vy = y0 − near/k)
uniform float uRadial; // 1: phối cảnh bán kính quanh điểm tụ; 0: chỉ co theo y (bản cũ)
float perspS(vec2 img){
  if (uRadial < 0.5) return uPersp.z + uPersp.w * (img.y - uPersp.y);
  return -uPersp.w * length(vec2(img.x - uPersp.x, uPersp.y - uPersp.z / uPersp.w - img.y));
}
vec2 planeOf(vec2 img){
  if (uRadial < 0.5) {
    float s = uPersp.z + uPersp.w * (img.y - uPersp.y);
    return vec2((img.x - uPersp.x) / s, log(s / uPersp.z) / (uPersp.w * uSquash));
  }
  vec2 d = vec2(img.x - uPersp.x, uPersp.y - uPersp.z / uPersp.w - img.y);
  float r = length(d), rTop = -uPersp.z / uPersp.w;
  return vec2(-atan(d.x, d.y) / uPersp.w, log(r / rTop) / (uPersp.w * uSquash));
}
vec2 gradToImage(vec2 g, vec2 img){
  if (uRadial < 0.5) {
    float s = uPersp.z + uPersp.w * (img.y - uPersp.y);
    return vec2(g.x / s, g.y / (s * uSquash) - g.x * (img.x - uPersp.x) * uPersp.w / (s * s));
  }
  vec2 d = vec2(img.x - uPersp.x, uPersp.y - uPersp.z / uPersp.w - img.y);
  float r = length(d), s = -uPersp.w * r, ct = d.y / r, st = d.x / r;
  return vec2((g.x * ct - g.y * st / uSquash) / s, (g.x * st + g.y * ct / uSquash) / s);
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

// Lưới sóng trắng (WATER-EFFECT 2.svg) trong elip mặt nước — dùng chung cho shader nước và vật nổi (phần nổi
// của vịt/lá nhìn xuyên qua mặt nước nên lưới cũng phủ lên, như tranh mẫu). Lấy mẫu TRÊN MẶT PHẲNG NƯỚC nên ô
// lưới to ở trên, nhỏ dần xuống dưới, nghiêng theo tia về điểm tụ như vòng sóng; trôi chậm; nước thì còn méo
// theo gợn sóng (G = độ dốc theo px ảnh). Soft light (W3C = Photoshop) với lớp phủ trắng: b → D(b).
export const NET_GLSL = /* glsl */ `
uniform sampler2D uNet;  // lưới (alpha), lặp
uniform vec4 uEllipse;   // elip mặt nước (cx, cy, rx, ry)
uniform vec4 uNetA;      // (cỡ một bản lưới trên mặt nước, kéo dọc, độ phủ trắng, soft light)
uniform vec4 uNetB;      // (mép mờ elip 0..1, khúc xạ lưới px, tỉ lệ ảnh lưới w/h, chưa dùng)
uniform vec4 uNetDrift;  // (biên độ X, biên độ Y, tần số X, tần số Y) trôi trên mặt nước
vec3 softWhite(vec3 b){ return mix(((16.0 * b - 12.0) * b + 4.0) * b, sqrt(b), step(0.25, b)); }
float netAt(vec2 img, vec2 G, float t){
  vec2 e = (img - uEllipse.xy) / uEllipse.zw;
  float inE = 1.0 - smoothstep(uNetB.x, 1.0, dot(e, e));
  vec2 drift = vec2(sin(t * uNetDrift.z * 6.2831853) * uNetDrift.x, cos(t * uNetDrift.w * 6.2831853) * uNetDrift.y);
  vec2 P = planeOf(img - G * uNetB.y) + drift;
  vec2 nuv = vec2(P.x / uNetA.x, P.y / (uNetA.x / uNetB.z * uNetA.y));
  return texture2D(uNet, nuv).a * inE;
}
vec3 applyNet(vec3 c, float net){
  c = mix(c, softWhite(c), net * uNetA.w);
  return mix(c, vec3(1.0), net * uNetA.z);
}`;

const VERT = /* glsl */ `
uniform vec4 uArea;
varying vec2 vImg;
void main(){
  vImg = uArea.xy + vec2(uv.x, 1.0 - uv.y) * uArea.zw;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
}`;

const FRAG = /* glsl */ `
uniform sampler2D uBg;     // nền đã nướng (tranh + các lớp nước), phủ uBgRect (toạ độ ảnh); ngoài khổ kéo dài mép
uniform sampler2D uHeight; // lưới sóng mô phỏng
uniform sampler2D uZone;   // mặt nạ vùng mặt nước (kênh r), phủ uZoneRect
uniform vec4 uArea, uBgRect, uZoneRect;
uniform vec2 uSimOrigin, uGrid;
uniform float uCell, uAmpScale;
uniform float uTime, uAmb, uGain, uRefr, uFocus, uFocusTint, uTIR, uShade, uSunGain;
uniform vec2 uSun;
uniform vec3 uRays;    // (biên độ, perp.x, perp.y)
uniform vec4 uRayW;    // (bước sóng 1, tốc độ 1, bước sóng 2, tốc độ 2)
uniform float uDeepBlur; // bán kính làm mờ nền ở nước sâu (px ảnh) — xem bước 1
uniform vec4 uFlow;      // liquify nước sâu: (méo tối đa px, cỡ xoáy px, tốc độ, độ cuộn) — DEEP_FLOW
uniform sampler2D uFoliage; // mặt nạ cây (assets.js → foliageMask): r = trường dời, g = mờ rộng (để tìm ngọn)
uniform vec4 uFoliageA;  // (dời tối đa px, tần số góc, cơn gió amt, 1/khoảng cách cơn gió s)
uniform vec2 uFoliageC;  // tâm khoảng trời (toạ độ ảnh)
uniform vec4 uFlowB;     // (tia nắng uốn px, mảng sáng ±, cỡ mảng px, tốc độ mảng)
// Value noise mượt + fbm 2 tầng cho dòng chảy nước sâu.
float flowHash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float flowNoise(vec2 p){
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(flowHash(i), flowHash(i + vec2(1.0, 0.0)), u.x), mix(flowHash(i + vec2(0.0, 1.0)), flowHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float flowFbm(vec2 p){ return 0.65 * flowNoise(p) + 0.35 * flowNoise(p * 2.03 + 17.1); }
varying vec2 vImg;
${WAVES_GLSL}
${NET_GLSL}

void main(){
  vec3 zm = texture2D(uZone, (vImg - uZoneRect.xy) / uZoneRect.zw).rgb;
  float zone = zm.r; // 1 = mặt nước, 0 = nước sâu (sóng, khúc xạ tắt dần qua mép)
  float deep = 1.0 - zm.g; // cùng vùng, chuyển rộng hơn: độ mờ của nước sâu tăng dần qua mép, không có đường ranh
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
  vec2 G = (grad + amb.yz) * zone; // ngoài vùng mặt nước: không sóng, không khúc xạ
  float lap = (lapSim + amb.w) * zone;

  // 1) khúc xạ: từ dưới nhìn lên, cảnh phía trên bị mặt nước bẻ lệch theo độ dốc
  vec2 p = vImg - G * uRefr;
  // 1b) liquify nước sâu: nền uốn lượn chậm theo dòng chảy cuộn (domain warp — nhiễu dời toạ độ của chính
  // nó nên xoáy chứ không trôi thẳng). Nặng dần từ mép xuống sâu (kênh b), trên mặt nước = 0 (deep = 0).
  vec2 fq = vImg / uFlow.y + uTime * uFlow.z;
  vec2 warp = vec2(flowFbm(fq + uFlow.w * flowFbm(fq + vec2(3.1, 7.7)) + uTime * 0.013),
                   flowFbm(fq + uFlow.w * flowFbm(fq + vec2(9.4, 1.3)) - uTime * 0.011)) * 2.0 - 1.0;
  float wDeep = deep * mix(0.5, 1.0, 1.0 - zm.b);
  p += warp * uFlow.x * wDeep;
  // 1c) tán cây trong nền đung đưa theo gió: chỉ chỗ mặt nạ cây (trời mây đứng yên), lắc theo phương tiếp tuyến
  // quanh tâm khoảng trời; ngọn (rìa khối cây vươn ra trời) lắc đủ, lõi và gốc ~25 %; các cụm lệch pha theo nhiễu
  // không gian; thỉnh thoảng một cơn gió mạnh hơn. Trường dời mượt (mặt nạ đã làm mờ) nên ảnh uốn liền, không rách.
  vec2 fuv = (p - uBgRect.xy) / uBgRect.zw;
  vec2 fm = texture2D(uFoliage, vec2(fuv.x, 1.0 - fuv.y)).rg; // cùng quy ước lật dọc với uBg
  vec2 rc = p - uFoliageC;
  vec2 ftan = vec2(-rc.y, rc.x) / max(length(rc), 1.0);
  float fph = flowNoise(p / 350.0) * 6.2831853;
  float sway = sin(uTime * uFoliageA.y + fph) * 0.75 + sin(uTime * uFoliageA.y * 1.7 + fph * 1.3) * 0.25;
  float gust = 1.0 + uFoliageA.z * smoothstep(0.55, 0.9, flowNoise(vec2(uTime * uFoliageA.w, 0.5)));
  p += ftan * uFoliageA.x * fm.r * (0.25 + 0.75 * (1.0 - fm.g)) * sway * gust;
  vec2 buv = (p - uBgRect.xy) / uBgRect.zw;
  // Nước sâu nhìn qua một lớp nước dày nên hơi nhoè: làm mờ Gauss 3×3 (trọng số 4-2-1) bán kính tăng dần qua
  // mép — mặt nước giữ nét, nước sâu mờ ~1–2 px. Chỗ chuyển là chính độ mờ, KHÔNG vẽ đường viền (chủ dự án
  // bác vệt sáng/dải tối dọc mép: "vẽ cái đường đấy thì không còn chân thật"). Lấy mẫu vô điều kiện.
  vec2 bo = vec2(1.0, -1.0) * uDeepBlur * deep / uBgRect.zw;
  vec2 bu = vec2(buv.x, 1.0 - buv.y);
  vec3 c = texture2D(uBg, bu).rgb * 4.0
    + (texture2D(uBg, bu + vec2(bo.x, 0.0)).rgb + texture2D(uBg, bu - vec2(bo.x, 0.0)).rgb
     + texture2D(uBg, bu + vec2(0.0, bo.y)).rgb + texture2D(uBg, bu - vec2(0.0, bo.y)).rgb) * 2.0
    + texture2D(uBg, bu + bo).rgb + texture2D(uBg, bu - bo).rgb
    + texture2D(uBg, bu + vec2(bo.x, -bo.y)).rgb + texture2D(uBg, bu - vec2(bo.x, -bo.y)).rgb;
  c /= 16.0;

  // 2) tụ sáng: đây là thứ tạo ra hình sóng khi nhìn từ dưới lên.
  // Mặt cong lõm gom tia sáng lại -> vệt chói; cong lồi thì xoè ra -> tối.
  // Càng gần chỗ mặt trời rọi xuống thì tương phản càng mạnh.
  float sunNear = exp(-length(vImg - uSun) / 1500.0);
  float focus = clamp(-lap * uFocus * (0.55 + uSunGain * sunNear), -0.55, 1.5);
  c *= 1.0 + focus;
  // phần chói nhất ngả sang trắng xanh như ánh sáng xuyên qua mặt nước
  c += vec3(0.78, 0.90, 1.0) * max(0.0, focus - 0.28) * uFocusTint;

  // 3) chiều cao chỉ còn góp một chút để lớp nước dày mỏng khác nhau
  c *= 1.0 + clamp((h / uAmpScale) * uGain * uShade, -0.10, 0.10) * zone;

  // 4) dốc quá mức tới hạn thì mặt nước thành gương soi đáy hồ -> tối lại
  float steep = clamp(length(G) * uTIR, 0.0, 0.40);
  c = mix(c, c * vec3(0.62, 0.70, 0.80), steep);

  // 5) nước sâu: tia nắng lung linh — hai dải sin trôi theo phương vuông góc với tia
  // ở nước sâu tia uốn lượn theo cùng dòng chảy liquify (dời toạ độ theo warp), trên mặt nước giữ thẳng
  float u = dot(vImg + warp * uFlowB.x * wDeep, uRays.yz);
  float ray = sin(u / uRayW.x + uTime * uRayW.y) * 0.6 + sin(u / uRayW.z - uTime * uRayW.w) * 0.4;
  c *= 1.0 + uRays.x * ray * (1.0 - 0.7 * zone);
  // 5c) nước sâu: mảng sáng tối to, rất mờ, loang chậm — nắng xuyên mặt nước dao động. Không có nét.
  vec2 pq = vImg / uFlowB.z + vec2(uTime * uFlowB.w, -uTime * uFlowB.w * 0.7);
  float patchL = flowFbm(pq + 0.8 * flowFbm(pq * 0.7 + vec2(5.2, 2.9) + uTime * uFlowB.w * 0.5)) * 2.0 - 1.0;
  c *= 1.0 + uFlowB.y * patchL * wDeep * 2.0;

  // 6) lưới sóng trắng trong elip mặt nước (NET_GLSL), méo theo gợn sóng
  c = applyNet(c, netAt(vImg, G, uTime));

  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}`;

// Uniform của lưới sóng trắng cho một vật liệu (nước hoặc vật nổi). net = { texture, aspect } hoặc null (không
// có lưới: texture 1×1 trong suốt, độ phủ 0). reduceMotion: trôi chậm lại.
let emptyNet = null, black = null;
const blackTex = () => {
  if (!black) { black = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1); black.needsUpdate = true; }
  return black;
};
export function netUniforms(net, reduceMotion) {
  if (!net && !emptyNet) {
    emptyNet = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
    emptyNet.needsUpdate = true;
  }
  const slow = reduceMotion ? 0.4 : 1;
  return {
    uNet: { value: net ? net.texture : emptyNet },
    uEllipse: { value: new THREE.Vector4(SURFACE.ellipse.cx, SURFACE.ellipse.cy, SURFACE.ellipse.rx, SURFACE.ellipse.ry) },
    uNetA: { value: new THREE.Vector4(NET.scale, NET.aspect, net ? NET.opacity : 0, net ? NET.soft : 0) },
    uNetB: { value: new THREE.Vector4(SURFACE.ellipse.edge, NET.refract, net ? net.aspect : 1, 0) },
    uNetDrift: { value: new THREE.Vector4(NET.drift[0] * slow, NET.drift[1] * slow, NET.driftHz[0], NET.driftHz[1]) },
  };
}

// bg: { texture, rect } nền nướng sẵn; net: { texture, aspect } lưới sóng trắng (null = không có);
// zone: { texture, rect } mặt nạ vùng mặt nước; area: vùng mặt nước vẽ (toạ độ ảnh, = world).
export function createWater({ bg, net, zone, area, sim, reduceMotion }) {
  const uniforms = {
    ...netUniforms(net, reduceMotion),
    uBg: { value: bg.texture },
    uFoliage: { value: bg.foliage ? bg.foliage.texture : blackTex() },
    uFoliageA: { value: new THREE.Vector4(bg.foliage ? FOLIAGE.amp * (reduceMotion ? 0.5 : 1) : 0, 6.2831853 / FOLIAGE.period, FOLIAGE.gust.amt, 1 / FOLIAGE.gust.every) },
    uFoliageC: { value: new THREE.Vector2(FOLIAGE.centre[0], FOLIAGE.centre[1]) },
    uBgRect: { value: new THREE.Vector4(bg.rect.x, bg.rect.y, bg.rect.w, bg.rect.h) },
    uHeight: { value: sim.texture },
    uZone: { value: zone.texture },
    uZoneRect: { value: new THREE.Vector4(zone.rect.x, zone.rect.y, zone.rect.w, zone.rect.h) },
    uArea: { value: new THREE.Vector4(area.x, area.y, area.w, area.h) },
    uGrid: { value: new THREE.Vector2(sim.cols, sim.rows) },
    uCell: { value: sim.cell },
    uSimOrigin: { value: new THREE.Vector2(sim.ox, sim.oy) },
    uSquash: { value: sim.sq },
    uPersp: { value: sim.persp.uniform() },
    uRadial: { value: sim.persp.radial ? 1 : 0 },
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
    uDeepBlur: { value: SURFACE.deepBlur.px },
    uFlow: { value: new THREE.Vector4(DEEP_FLOW.amp * (reduceMotion ? 0.5 : 1), DEEP_FLOW.scale, DEEP_FLOW.speed * (reduceMotion ? 0.5 : 1), DEEP_FLOW.curl) },
    uFlowB: { value: new THREE.Vector4(DEEP_FLOW.rayBend, DEEP_FLOW.patch.amp, DEEP_FLOW.patch.scale, DEEP_FLOW.patch.speed * (reduceMotion ? 0.5 : 1)) },
    uRays: { value: new THREE.Vector3(reduceMotion ? RAYS.amp * 0.5 : RAYS.amp, RAYS.perp[0], RAYS.perp[1]) },
    uRayW: { value: new THREE.Vector4(RAYS.waves[0][0], RAYS.waves[0][1] / RAYS.waves[0][0], RAYS.waves[1][0], RAYS.waves[1][1] / RAYS.waves[1][0]) },
  };
  const material = new THREE.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader: FRAG, depthTest: false, depthWrite: false });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(area.w, area.h), material);
  mesh.renderOrder = 0;
  mesh.frustumCulled = false;
  const update = (t) => { uniforms.uTime.value = t; };
  return { mesh, uniforms, update };
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

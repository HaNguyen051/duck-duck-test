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
import { SUN, AMBIENT_WAVES, AMBIENT_GAIN, SURFACE, NET, RAYS, DEEP_FLOW, FOLIAGE, NIGHT } from './config.js';

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
uniform sampler2D uBgNight; // nền đêm, cùng khung (chưa nạp thì = uBg)
uniform float uNight;       // 0 = ngày, 1 = đêm; giữa = đang chuyển (scene.js)
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
uniform sampler2D uFoliage; // mặt nạ cây (assets.js → foliageMask): r = trường dời, g = mờ rộng, b = gần vùng trời
uniform vec4 uFoliageA;  // (trần độ dời px, làn gió px/s, cơn gió amt, 1/khoảng cách cơn gió s)
uniform vec2 uFoliageC;  // tâm khoảng trời (toạ độ ảnh)
uniform vec4 uFolL1;     // L1 tiền cảnh góc trên: (góc xoay rad, tịnh tiến min px, max px, ω)
uniform vec4 uFolL2;     // L2 hai sườn: (góc xoay rad, tịnh tiến min px, max px, ω)
uniform vec4 uFolL3;     // L3 đáy hồ: (dập dềnh min px, max px, ω, —)
uniform vec4 uFolL4;     // L4 lá viền: (rung min px, max px, ω, độ đục thấp nhất)
uniform vec4 uFolD;      // trễ pha cố định của 4 lớp (s)
uniform vec4 uFolC;      // vùng góc trên của L1: (y bắt đầu nhạt, y hết, khoảng cách mép bên bắt đầu nhạt, hết) px ảnh
uniform float uFolJ;     // lệch pha theo cụm trong cùng lớp (s)
uniform vec2 uFolLow;    // vùng đáy hồ của L3: cây thấp hơn y bắt đầu → hết (px ảnh); cộng thêm vùng nước sâu
uniform vec4 uFolK;      // tách cụm: (cỡ ô px, độ rộng hoà giáp ranh theo cỡ ô, biên độ ô min, max)
uniform float uFolR;     // tách cụm: lệch hướng lắc tối đa ± rad
uniform float uFolDebug; // 1: tô màu bốn lớp cây (soi bằng __pond), 0: bình thường
uniform vec4 uFlowB;     // (tia nắng uốn px, mảng sáng ±, cỡ mảng px, tốc độ mảng)
// Value noise mượt + fbm 2 tầng cho dòng chảy nước sâu.
float flowHash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float flowNoise(vec2 p){
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(flowHash(i), flowHash(i + vec2(1.0, 0.0)), u.x), mix(flowHash(i + vec2(0.0, 1.0)), flowHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float flowFbm(vec2 p){ return 0.65 * flowNoise(p) + 0.35 * flowNoise(p * 2.03 + 17.1); }
// Nền tại uv: ngày hoà sang đêm theo uNight (lấy mẫu cả hai vô điều kiện — không lấy mẫu trong nhánh rẽ).
vec3 bgAt(vec2 uv){ return mix(texture2D(uBg, uv).rgb, texture2D(uBgNight, uv).rgb, uNight); }
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
  // 1c) cây trong nền chuyển động theo 4 LỚP (bản mô tả thứ hai của chủ dự án, 2026-10-06), trời mây đứng yên. Bản mô
  // tả viết cho CSS/GSAP 4 phần tử, nhưng nền là MỘT ảnh WebGL nên các lớp chia mềm từ mặt nạ cây (r = cây, b = gần
  // vùng trời) và mặt nạ vùng mặt nước (deep), mỗi lớp chu kỳ + trễ riêng, không lớp nào đồng bộ với lớp nào:
  //   L1 tiền cảnh — cây lớn góc trên trái/phải: xoay ±0,8° quanh gốc cành phía mép ngoài + 2–3 px, 8 s, trễ 0;
  //   L2 hai sườn  — tán dọc hai bên: xoay ±2° + 5–7 px, 5,5 s, trễ 1,5 s;
  //   L3 đáy hồ    — vòng cây phía dưới nhìn qua nước sâu: dập dềnh 2–3 px (lên xuống, hơi lệch ngang), 4,5 s;
  //   L4 lá viền   — chồi lá sát khoảng trời: rung 1–2 px, 3 s, và trong suốt 0,85 → 1 theo caustics (bước 1d).
  // Gốc cành = chỗ tia (tâm trời → điểm) cắt mép khung; độ xoay = góc × khoảng cách tới gốc, theo phương tiếp tuyến.
  // Easing sin (ease-in-out). Trong một lớp các cụm lệch thêm uFolJ s theo nhiễu vị trí + làn gió lướt ngang.
  // Độ dời chặn ở trần uFoliageA.x px (20) để ảnh không kéo giãn lộ; trường dời mượt nên ảnh uốn liền, không rách.
  vec2 fuv = (p - uBgRect.xy) / uBgRect.zw;
  vec3 fm = texture2D(uFoliage, vec2(fuv.x, 1.0 - fuv.y)).rgb; // cùng quy ước lật dọc với uBg; b = gần trời
  vec2 rc = p - uFoliageC;
  float rcl = max(length(rc), 1.0);
  vec2 fdir = rc / rcl, ftan = vec2(-fdir.y, fdir.x);
  // khoảng cách từ tâm trời tới mép khung theo tia này (tia cắt hình chữ nhật artboard), rồi tới gốc cành
  vec2 ext = vec2(mix(uFoliageC.x - uBgRect.x, uBgRect.x + uBgRect.z - uFoliageC.x, step(0.0, fdir.x)),
                  mix(uFoliageC.y - uBgRect.y, uBgRect.y + uBgRect.w - uFoliageC.y, step(0.0, fdir.y)));
  vec2 tb = ext / max(abs(fdir), vec2(1e-4));
  float armL = max(min(tb.x, tb.y) - rcl, 0.0);
  // trọng số lớp, ưu tiên L4 > L3 > L1 > L2
  float w4 = smoothstep(0.08, 0.35, fm.b);
  // đáy hồ: vòng cây phía dưới — theo độ cao (mặt nước chữ V kéo xuống tận đáy giữa nên không thể chỉ dựa vào deep)
  float w3 = max(smoothstep(uFolLow.x, uFolLow.y, p.y - uBgRect.y), smoothstep(0.35, 0.75, deep)) * (1.0 - w4);
  float dSide = min(p.x - uBgRect.x, uBgRect.x + uBgRect.z - p.x);
  float corner = (1.0 - smoothstep(uFolC.x, uFolC.y, p.y - uBgRect.y)) * (1.0 - smoothstep(uFolC.z, uFolC.w, dSide));
  float w1 = corner * (1.0 - w4) * (1.0 - w3);
  float w2 = max(0.0, 1.0 - w1 - w3 - w4);
  w1 *= fm.r; w2 *= fm.r; w3 *= fm.r; w4 *= fm.r;
  float cn = flowNoise(p / 420.0 + 7.3);                                  // biên độ riêng từng cụm
  float tc = uTime - uFolJ * flowNoise(p / 420.0) - p.x / uFoliageA.y;    // lệch cụm + gió lướt
  vec4 tL = vec4(tc) - uFolD;                                             // thời gian riêng 4 lớp
  // TÁCH CỤM (chủ dự án: "mảng cây gần nhất bên phải chuyển động cùng một mảng" → "vẫn chưa đủ tách"): cây chia thành
  // các Ô RIÊNG BIỆT (tổ ong ngẫu nhiên ~uFolK.x px), mỗi ô một nhịp HOÀN TOÀN ngẫu nhiên (lệch tới cả chu kỳ), một
  // hướng lắc (±uFolR) và một biên độ riêng; chỉ dải giáp ranh (rộng ~uFolK.y × cỡ ô) là hoà. Hoà trên vector
  // (cos φ, sin φ)·biên độ — vì sin(θ + φ) tuyến tính theo nó — nên hai ô ngược pha thì dải giáp ranh tự đứng yên
  // chứ không bị kéo giãn. Bản trước dùng trường nhiễu liên tục: hai điểm cạnh nhau luôn gần cùng nhịp, vẫn thành khối.
  vec2 cq = p / uFolK.x, ci = floor(cq), cf = fract(cq);
  vec2 CP = vec2(0.0), CD = vec2(0.0);
  float cws = 0.0;
  for (int cj = -1; cj <= 1; cj++) for (int ck = -1; ck <= 1; ck++) {
    vec2 g = vec2(float(ck), float(cj)), id = ci + g;
    vec2 r = g + vec2(flowHash(id + 0.37), flowHash(id + 5.11)) - cf;   // tâm ô lệch ngẫu nhiên trong ô lưới
    float cw = exp(-dot(r, r) / (uFolK.y * uFolK.y));
    float ph = 6.2831853 * flowHash(id + 9.73);
    float am = mix(uFolK.z, uFolK.w, flowHash(id + 2.29));
    float tr = (flowHash(id + 7.41) - 0.5) * 2.0 * uFolR;
    CP += cw * am * vec2(cos(ph), sin(ph));
    CD += cw * vec2(cos(tr), sin(tr));
    cws += cw;
  }
  CP /= cws;
  CD /= max(length(CD), 1e-4);
  vec2 cdir = vec2(CD.x * ftan.x - CD.y * ftan.y, CD.y * ftan.x + CD.x * ftan.y);
  // sin(a + φ_ô) của ô (đã hoà, kèm biên độ ô): sin a · cos φ + cos a · sin φ
  #define SINC(a) (sin(a) * CP.x + cos(a) * CP.y)
  float d1 = uFolL1.x * SINC(tL.x * uFolL1.w) * armL + mix(uFolL1.y, uFolL1.z, cn) * SINC(tL.x * uFolL1.w + 0.7);
  float d2 = uFolL2.x * SINC(tL.y * uFolL2.w) * armL + mix(uFolL2.y, uFolL2.z, cn) * SINC(tL.y * uFolL2.w + 0.6);
  vec2 d3 = mix(uFolL3.x, uFolL3.y, cn) * vec2(0.5 * SINC(tL.z * uFolL3.z + 1.1), SINC(tL.z * uFolL3.z));
  d3 = vec2(CD.x * d3.x - CD.y * d3.y, CD.y * d3.x + CD.x * d3.y);
  float d4 = mix(uFolL4.x, uFolL4.y, cn) * (0.7 * SINC(tL.w * uFolL4.z) + 0.3 * SINC(tL.w * uFolL4.z * 2.0 + 1.1));
  float gust = 1.0 + uFoliageA.z * smoothstep(0.55, 0.9, flowNoise(vec2(uTime * uFoliageA.w, 0.5)));
  vec2 fdv = (cdir * (w1 * d1 + w2 * d2 + w4 * d4) + w3 * d3) * gust;
  p += fdv * min(1.0, uFoliageA.x / max(length(fdv), 1e-4));
  vec2 buv = (p - uBgRect.xy) / uBgRect.zw;
  // Nước sâu nhìn qua một lớp nước dày nên hơi nhoè: làm mờ Gauss 3×3 (trọng số 4-2-1) bán kính tăng dần qua
  // mép — mặt nước giữ nét, nước sâu mờ ~1–2 px. Chỗ chuyển là chính độ mờ, KHÔNG vẽ đường viền (chủ dự án
  // bác vệt sáng/dải tối dọc mép: "vẽ cái đường đấy thì không còn chân thật"). Lấy mẫu vô điều kiện.
  vec2 bo = vec2(1.0, -1.0) * uDeepBlur * deep / uBgRect.zw;
  vec2 bu = vec2(buv.x, 1.0 - buv.y);
  vec3 c = bgAt(bu) * 4.0
    + (bgAt(bu + vec2(bo.x, 0.0)) + bgAt(bu - vec2(bo.x, 0.0))
     + bgAt(bu + vec2(0.0, bo.y)) + bgAt(bu - vec2(0.0, bo.y))) * 2.0
    + bgAt(bu + bo) + bgAt(bu - bo)
    + bgAt(bu + vec2(bo.x, -bo.y)) + bgAt(bu - vec2(bo.x, -bo.y));
  c /= 16.0;
  float sunNear = exp(-length(vImg - uSun) / 1500.0);
  // 1d) L4 lá viền TRONG SUỐT 0,85 → 1: lá mỏng li ti đón nắng hoà một phần với màu trời ngay phía sau (mẫu nền lệch
  // 45 px về phía tâm trời), mạnh lên khi mặt nước chỗ đó tụ sáng (caustics, cùng công thức bước 2) và theo nhịp 3 s.
  // (Ánh sáng le lói cũ trên cả tán đã bỏ — bản mô tả mới chỉ đổi sáng ở lớp này.)
  vec2 su = (p - fdir * 45.0 - uBgRect.xy) / uBgRect.zw;
  vec3 skyC = bgAt(vec2(su.x, 1.0 - su.y));
  float focusPre = clamp(-lap * uFocus * (0.55 + uSunGain * sunNear), -0.55, 1.5);
  float trans = clamp(0.5 + 0.3 * sin(tL.w * uFolL4.z + 0.4) + 1.2 * max(focusPre, 0.0), 0.0, 1.0);
  c = mix(c, skyC, w4 * (1.0 - uFolL4.w) * trans);
  // soi (uFolDebug): 1 = tô lớp (L1 đỏ, L2 lục, L3 vàng, L4 lam); 2 = trường dời (đỏ/lục = dời ngang/dọc, xám = đứng yên)
  float dbg2 = step(1.5, uFolDebug);
  c = mix(c, vec3(w1 + w3, w2 + w3, w4) + c * 0.25, clamp(uFolDebug, 0.0, 1.0) * (1.0 - dbg2));
  c = mix(c, vec3(0.5 + fdv / (2.0 * uFoliageA.x), 0.5) * (0.35 + 0.65 * fm.r), dbg2);

  // 2) tụ sáng: đây là thứ tạo ra hình sóng khi nhìn từ dưới lên.
  // Mặt cong lõm gom tia sáng lại -> vệt chói; cong lồi thì xoè ra -> tối.
  // Càng gần chỗ mặt trời rọi xuống thì tương phản càng mạnh.
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
const TAU = Math.PI * 2, rad = (d) => (d * Math.PI) / 180;
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

const FOCUS_TINT = 0.42; // độ ngả trắng xanh ở chỗ chói nhất (ban ngày; đêm nhân NIGHT.focusTint)

// bg: { texture, rect, foliage, night? } nền nướng sẵn (night: texture nền đêm nếu đã nạp); net: { texture, aspect } lưới sóng trắng (null = không có);
// zone: { texture, rect } mặt nạ vùng mặt nước; area: vùng mặt nước vẽ (toạ độ ảnh, = world).
export function createWater({ bg, net, zone, area, sim, reduceMotion }) {
  const uniforms = {
    ...netUniforms(net, reduceMotion),
    uBg: { value: bg.texture },
    uBgNight: { value: bg.night || bg.texture },
    uNight: { value: 0 },
    uFoliage: { value: bg.foliage ? bg.foliage.texture : blackTex() },
    uFoliageA: { value: new THREE.Vector4(bg.foliage ? FOLIAGE.cap * (reduceMotion ? 0.5 : 1) : 0, FOLIAGE.wind, FOLIAGE.gust.amt, 1 / FOLIAGE.gust.every) },
    uFolL1: { value: new THREE.Vector4(rad(FOLIAGE.fore.deg), FOLIAGE.fore.shift[0], FOLIAGE.fore.shift[1], TAU / FOLIAGE.fore.period) },
    uFolL2: { value: new THREE.Vector4(rad(FOLIAGE.side.deg), FOLIAGE.side.shift[0], FOLIAGE.side.shift[1], TAU / FOLIAGE.side.period) },
    uFolL3: { value: new THREE.Vector4(FOLIAGE.lower.shift[0], FOLIAGE.lower.shift[1], TAU / FOLIAGE.lower.period, 0) },
    uFolL4: { value: new THREE.Vector4(FOLIAGE.fringe.shift[0], FOLIAGE.fringe.shift[1], TAU / FOLIAGE.fringe.period, FOLIAGE.fringe.opacity) },
    uFolD: { value: new THREE.Vector4(FOLIAGE.fore.delay, FOLIAGE.side.delay, FOLIAGE.lower.delay, FOLIAGE.fringe.delay) },
    uFolC: { value: new THREE.Vector4(FOLIAGE.corner.top[0], FOLIAGE.corner.top[1], FOLIAGE.corner.side[0], FOLIAGE.corner.side[1]) },
    uFolJ: { value: FOLIAGE.jitter },
    uFolLow: { value: new THREE.Vector2(FOLIAGE.lower.y[0], FOLIAGE.lower.y[1]) },
    uFolK: { value: new THREE.Vector4(FOLIAGE.cluster.size, FOLIAGE.cluster.blend, FOLIAGE.cluster.amp[0], FOLIAGE.cluster.amp[1]) },
    uFolR: { value: rad(FOLIAGE.cluster.turn) },
    uFolDebug: { value: 0 },
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
    uFocusTint: { value: FOCUS_TINT },
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
  // night: 0 = ngày … 1 = đêm (đã làm mềm ở scene.js)
  const update = (t, night = 0) => {
    uniforms.uTime.value = t;
    uniforms.uNight.value = night;
    uniforms.uFocusTint.value = FOCUS_TINT * (1 + (NIGHT.focusTint - 1) * night);
  };
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

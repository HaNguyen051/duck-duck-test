// Con vịt dựng bằng khối 3D thật, thay cho 24 khung ảnh turntable.
//
// Vì sao bỏ khung ảnh: các khung đó do AI của Illustrator sinh riêng từng cái chứ không render từ
// một model, nên mỗi khung lệch khỏi quỹ đạo turntable chuẩn trung bình 11 px (cá biệt 32 px).
// Sai số ấy cố định, không giảm khi thêm khung — mà bước dịch giữa hai khung thì nhỏ dần. Ở 24 khung
// nhiễu đã chiếm 26% bước; lên 48 khung là 53%, lên 72 khung là 79%, tức vịt giật lui giật tới.
// Dựng 3D thì xoay được ở mọi góc, không còn khái niệm khung.
//
// Tỉ lệ đo từ chính các khung cũ: dài : rộng = 520 : 285, chìm khoảng 60% thân.
// Bảng màu lấy nguyên 7 màu phẳng của tranh gốc, tô phẳng theo ngưỡng nên vẫn ra nét vẽ tay.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { DUCK3D, SUN, AMBIENT_WAVES, AMBIENT_GAIN } from './config.js';

const C = DUCK3D.colors;
// Bảng màu trong config là mã sRGB (đọc từ tranh). Shader làm việc trong không gian tuyến tính rồi
// mới mã hoá lại sang sRGB khi xuất, nên phải đổi sang tuyến tính TRƯỚC khi nạp — không thì màu bị
// đẩy sáng lên hai lần, (127,127,127) hoá thành 186 và tương phản nổi/chìm bị nén mất.
const toLinear = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const v3 = (c) => new THREE.Vector3(toLinear(c[0]), toLinear(c[1]), toLinear(c[2]));

/* ------------------------------------------------------------------ hình khối */
// Mỗi khối mang bốn thuộc tính riêng:
//   aColor  màu gốc (mỏ, chân, mắt giữ nguyên màu này)
//   aTone   0 = giữ nguyên màu · 1 = đổi màu theo mực nước (thân, cổ, đầu)
//   aPaddle 0 = đứng yên · 1 = chân trái · 2 = chân phải  (để quẫy trong vertex shader)
//   aPivot  khớp để xoay khi quẫy
function tag(geo, color, tone, paddle, pivot) {
  // Tính pháp tuyến TRƯỚC khi bỏ chỉ mục: lúc này các đỉnh còn dùng chung nên pháp tuyến được
  // trung bình lại, mặt cong ra mượt. Bỏ chỉ mục rồi mới tính thì mỗi tam giác một pháp tuyến,
  // con vịt sẽ bị chia múi như xếp giấy.
  if (!geo.attributes.normal) geo.computeVertexNormals();
  if (geo.index) geo = geo.toNonIndexed();
  const n = geo.attributes.position.count;
  const col = new Float32Array(n * 3), tn = new Float32Array(n), pd = new Float32Array(n);
  const pv = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    col[i * 3] = toLinear(color[0]); col[i * 3 + 1] = toLinear(color[1]); col[i * 3 + 2] = toLinear(color[2]);
    tn[i] = tone; pd[i] = paddle;
    pv[i * 3] = pivot?.[0] || 0; pv[i * 3 + 1] = pivot?.[1] || 0; pv[i * 3 + 2] = pivot?.[2] || 0;
  }
  geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aTone', new THREE.BufferAttribute(tn, 1));
  geo.setAttribute('aPaddle', new THREE.BufferAttribute(pd, 1));
  geo.setAttribute('aPivot', new THREE.BufferAttribute(pv, 3));
  geo.deleteAttribute('uv');
  return geo;
}

// Dáng nhìn ngang của con vịt: [x, y, nửa bề ngang, nửa bề cao] tại từng chặng dọc xương sống,
// từ chóp đuôi ra tới trán. Quét một mặt cắt bầu dục dọc theo đó sẽ ra MỘT TẤM DA LIỀN cho cả
// thân, cổ và đầu — không có chỗ nối như khi dán khối rời.
const PROFILE = [
  [-272, 148,   9,   7], [-234, 112,  46,  33], [-184,  62,  94,  74], // đuôi vểnh cao hơn lưng
  [-112,  18, 128, 114], [ -20,  -8, 143, 150], [  70,  -4, 135, 146], // lưng hơi lòng, bụng sâu
  [ 136,  22, 108, 120], [ 170,  66,  72,  84],                        // ức dựng lên thành cổ
  [ 184, 112,  46,  52], [ 192, 152,  46,  50],                        // cổ thon, vừa phải
  [ 200, 182,  64,  68], [ 222, 202,  86,  86], [ 252, 198,  78,  76], // đầu
  [ 278, 188,  44,  40], [ 292, 180,   7,   6],
];

// Quét mặt cắt bầu dục dọc xương sống. Mặt cắt luôn vuông góc với hướng đi của xương sống,
// và vì xương sống nằm trọn trong mặt phẳng XY nên lấy trục Z làm bề ngang là không bị xoắn.
function loftBody(stations, rings, slices) {
  const spine = new THREE.CatmullRomCurve3(stations.map((p) => new THREE.Vector3(p[0], p[1], 0)), false, 'catmullrom', 0.4);
  const wCurve = stations.map((p) => p[2]), hCurve = stations.map((p) => p[3]);
  // Bán kính phải nội suy MƯỢT như xương sống. Nội suy tuyến tính thì hai thứ không khớp nhau,
  // chỗ đổi bán kính nhanh (ức lên cổ) sẽ gấp khúc thành nếp nhăn trên lưng.
  const lerpR = (arr, t) => {
    const n = arr.length, f = t * (n - 1);
    const i = Math.min(n - 1, Math.max(0, Math.floor(f))), k = f - i;
    const p0 = arr[Math.max(0, i - 1)], p1 = arr[i];
    const p2 = arr[Math.min(n - 1, i + 1)], p3 = arr[Math.min(n - 1, i + 2)];
    return 0.5 * (2 * p1 + (-p0 + p2) * k + (2 * p0 - 5 * p1 + 4 * p2 - p3) * k * k
                + (-p0 + 3 * p1 - 3 * p2 + p3) * k * k * k);
  };
  const pos = [], idx = [];
  for (let r = 0; r <= rings; r++) {
    const t = r / rings;
    const P = spine.getPoint(t), T = spine.getTangent(t).normalize();
    const W = new THREE.Vector3(0, 0, 1);                 // bề ngang
    const U = new THREE.Vector3().crossVectors(W, T).normalize(); // bề cao, vuông góc xương sống
    const hw = lerpR(wCurve, t), hh = lerpR(hCurve, t);
    for (let sdx = 0; sdx < slices; sdx++) {
      const a = (sdx / slices) * Math.PI * 2;
      pos.push(
        P.x + W.x * hw * Math.cos(a) + U.x * hh * Math.sin(a),
        P.y + W.y * hw * Math.cos(a) + U.y * hh * Math.sin(a),
        P.z + W.z * hw * Math.cos(a) + U.z * hh * Math.sin(a),
      );
    }
  }
  for (let r = 0; r < rings; r++) for (let sdx = 0; sdx < slices; sdx++) {
    const a = r * slices + sdx, b = r * slices + ((sdx + 1) % slices);
    const c = a + slices, d = b + slices;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Bàn chân có màng: một cái quạt dẹt, ba ngón.
function webbedFoot() {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(-0.40, -0.70); shape.lineTo(-0.18, -0.60);
  shape.lineTo(-0.06, -0.88); shape.lineTo(0.06, -0.88);
  shape.lineTo(0.18, -0.60); shape.lineTo(0.40, -0.70);
  shape.lineTo(0, 0);
  const g = new THREE.ExtrudeGeometry(shape, { depth: 0.07, bevelEnabled: false });
  g.translate(0, 0, -0.035);
  return g;
}

export function buildDuckGeometry() {
  const D = DUCK3D, parts = [];
  const add = (g, color, tone = 1, paddle = 0, pivot = null) => parts.push(tag(g, color, tone, paddle, pivot));
  const k = D.bodyLen / 520; // mọi số trong PROFILE đo theo thân dài 520

  // thân + cổ + đầu: một tấm da liền
  const skin = loftBody(PROFILE, 86, 40);
  skin.scale(k, k, (D.bodyWidth / 285) * k);
  add(skin, C.above);

  // mỏ: nón dẹt chĩa ra trước, nối vào trán
  const beak = new THREE.ConeGeometry(D.headR * 0.52, D.beakLen, 20);
  beak.rotateZ(-Math.PI / 2 - 0.22);
  beak.scale(1, 0.58, 1.08);
  beak.translate(300 * k, 172 * k, 0);
  add(beak, C.beak, 0);

  // mắt hai bên
  for (const s of [1, -1]) {
    const eye = new THREE.SphereGeometry(D.eyeR, 14, 10);
    eye.translate(246 * k, 218 * k, s * 64 * k);
    add(eye, C.eye, 0);
  }

  // chân: cẳng + bàn chân có màng, quẫy lệch pha nhau
  [1, -1].forEach((s, i) => {
    // chân nằm lùi về sau, sát bụng — vịt đang bơi chứ không phải chim đứng
    const px = -26 * k, py = -126 * k, pz = s * 66 * k;
    const pivot = [px, py, pz];
    const shin = new THREE.CylinderGeometry(D.legR, D.legR * 0.88, D.legLen, 12);
    shin.translate(0, -D.legLen * 0.5, 0);
    shin.rotateZ(-0.30); // chân chếch về sau như vịt đang đạp nước, không chống thẳng như cái giá
    shin.translate(px, py, pz);
    add(shin, C.foot, 0, i + 1, pivot);

    const foot = webbedFoot();
    foot.scale(D.footW, D.footW, 1);
    foot.rotateX(-Math.PI / 2 + D.footPitch);
    foot.rotateZ(-0.30);
    foot.translate(px + D.legLen * 0.30, py - D.legLen * 0.95, pz);
    add(foot, C.web, 0, i + 1, pivot);
  });

  // KHÔNG tính lại pháp tuyến sau khi gộp — làm thế là mất hết độ mượt vừa dựng được.
  return mergeGeometries(parts, false);
}

/* ------------------------------------------------------------------ vật liệu */
const VERT = /* glsl */ `
attribute vec3 aColor;
attribute float aTone;
attribute float aPaddle;
attribute vec3 aPivot;
uniform float uTime, uAmb, uWaterY, uRefr, uPaddle;
uniform vec2 uCentre;      // tâm khung nhìn trong toạ độ ảnh, để quy vị trí thế giới về toạ độ ảnh
uniform vec4 uWaves[5];
varying vec3 vColor;
varying float vTone, vDiff, vLocalY;

// Sóng nền, cùng công thức với water.js. Trả về (chiều cao, đạo hàm x, đạo hàm y).
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
}

void main(){
  vec3 pos = position;

  // chân quẫy: xoay quanh khớp háng, hai chân lệch pha nhau nửa nhịp
  if (aPaddle > 0.5) {
    float ph = uTime * 6.2831853 * 0.75 + (aPaddle > 1.5 ? 3.14159 : 0.0);
    float a = sin(ph) * uPaddle;
    float c = cos(a), s = sin(a);
    vec3 d = pos - aPivot;
    pos = aPivot + vec3(d.x * c - d.y * s, d.x * s + d.y * c, d.z);
  }

  vec4 world = modelMatrix * vec4(pos, 1.0);
  float under = step(pos.y, uWaterY);   // 1 = nằm dưới mặt nước

  // Phần chìm nhìn qua lớp nước nên bị sóng bẻ lệch — đây là dấu hiệu chính của "đang ở dưới nước".
  vec2 img = vec2(world.x + uCentre.x, uCentre.y - world.y);
  vec3 w = waves(img, uTime) * uAmb;
  world.xy -= w.yz * uRefr * under * vec2(1.0, -1.0);

  vec3 n = normalize(mat3(modelMatrix) * normal);
  vDiff = dot(n, normalize(vec3(0.86, 0.51, 0.55)));
  // Chuyển độ cao sang fragment shader thay vì chuyển sẵn kết quả nổi/chìm: nội suy một giá trị
  // 0/1 giữa các đỉnh thì đường ranh mặt nước bám theo cạnh tam giác, hiện ra răng cưa bậc thang.
  vColor = aColor; vTone = aTone; vLocalY = pos.y - uWaterY;
  gl_Position = projectionMatrix * viewMatrix * world;
}`;

const FRAG = /* glsl */ `
uniform vec3 uAbove, uBelow, uHiAbove, uHiBelow;
uniform float uStep, uEdge;
varying vec3 vColor;
varying float vTone, vDiff, vLocalY;
void main(){
  // Đường mặt nước tính ở TỪNG ĐIỂM ẢNH, hoà mềm trong uEdge đơn vị cho hết răng cưa.
  float under = 1.0 - smoothstep(-uEdge, uEdge, vLocalY);
  // Tô PHẲNG theo ngưỡng chứ không chuyển sắc mượt — tranh gốc chỉ có 7 màu phẳng, không có dải màu.
  vec3 base = vColor, hi = vColor;
  if (vTone > 0.5) {
    base = mix(uAbove, uBelow, under);
    hi = mix(uHiAbove, uHiBelow, under);
  }
  // mặt cong mượt nên đường ranh sáng/tối cũng phải hoà mềm một chút, không thì lại răng cưa
  float lit = smoothstep(uStep - 0.06, uStep + 0.06, vDiff);
  gl_FragColor = vec4(mix(base, hi, lit), 1.0);
  #include <colorspace_fragment>
}`;

export function duckMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uAmb: { value: AMBIENT_GAIN },
      uWaterY: { value: DUCK3D.waterY },
      uRefr: { value: DUCK3D.refract },
      uPaddle: { value: DUCK3D.paddle },
      uCentre: { value: new THREE.Vector2() },
      uWaves: { value: AMBIENT_WAVES.map((w) => new THREE.Vector4(...w)) },
      uAbove: { value: v3(C.above) },
      uBelow: { value: v3(C.below) },
      uHiAbove: { value: v3(C.aboveHi) },
      uHiBelow: { value: v3(C.belowHi) },
      uStep: { value: DUCK3D.liteStep },
      uEdge: { value: DUCK3D.waterEdge },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    side: THREE.DoubleSide,
  });
}

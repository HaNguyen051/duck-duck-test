// Vật liệu dùng chung cho mọi thứ NỔI trên mặt nước nhìn từ đáy hồ lên (vịt, lá sen):
// texture gốc + một nguồn sáng dịu + cắt theo mực nước ở từng điểm ảnh. Phần NỔI là phần nhìn xuyên
// qua mặt nước nên xỉn màu và bị độ dốc mặt nước (sóng nền + gợn mô phỏng) bẻ lệch; phần chìm ở
// cùng môi trường với người xem nên rõ nét. Vịt bật thêm DUCK_RIG để có chân, đầu, đuôi cử động.
import * as THREE from 'three';
import { SUN, AMBIENT_WAVES, AMBIENT_GAIN } from './config.js';
import { WAVES_GLSL, NET_GLSL, netUniforms } from './water.js';
import { FLAT_PERSP } from './persp.js';

export const FLOATER_VERT = /* glsl */ `
uniform float uTime, uAmb, uWaterY, uRefr, uRefrMax;
#ifdef DUCK_RIG
attribute vec3 aLeg;    // (trọng số háng, pha quẫy, trọng số cổ chân)
attribute vec3 aPivot;  // khớp háng
attribute vec3 aAnkle;  // khớp cổ chân
attribute float aTail;  // trọng số đuôi
attribute float aHead;  // trọng số đầu
uniform float uPhase, uPaddle, uBase, uHz, uAnkle, uAnkleLag, uTail, uHeadYaw, uHeadPitch;
uniform vec3 uTailPivot, uHeadPivot;
#endif
uniform vec2 uCentre;   // tâm khung nhìn trong toạ độ ảnh, để quy vị trí thế giới về toạ độ ảnh
uniform float uKp;      // hệ số thị sai ở độ cao của vịt (scene.js → place): ảnh = thế giới / uKp
// lưới sóng mô phỏng (watersim.js), cùng cách lấy mẫu với water.js
uniform sampler2D uHeight;
uniform vec2 uSimOrigin, uGrid;
uniform float uCell, uSimGain;
varying vec2 vUv;
varying vec3 vN, vP;
varying float vLocalY;
varying vec2 vImg; // toạ độ ảnh của điểm (để phủ lưới sóng trắng lên phần nổi)
${WAVES_GLSL}

// xoay điểm và pháp tuyến quanh trục Z (ngang thân) đi qua pivot — gập chân trước/sau
void rotZ(inout vec3 p, inout vec3 nrm, vec3 pivot, float a){
  float c = cos(a), s = sin(a);
  vec3 d = p - pivot;
  p = pivot + vec3(d.x * c - d.y * s, d.x * s + d.y * c, d.z);
  nrm = vec3(nrm.x * c - nrm.y * s, nrm.x * s + nrm.y * c, nrm.z);
}
// xoay quanh trục Y (đứng) đi qua pivot — vẫy đuôi sang hai bên
void rotY(inout vec3 p, inout vec3 nrm, vec3 pivot, float a){
  float c = cos(a), s = sin(a);
  vec3 d = p - pivot;
  p = pivot + vec3(d.x * c + d.z * s, d.y, -d.x * s + d.z * c);
  nrm = vec3(nrm.x * c + nrm.z * s, nrm.y, -nrm.x * s + nrm.z * c);
}

void main(){
  vec3 pos = position, nor = normal;

#ifdef DUCK_RIG
  // Đầu: cúi/ngẩng quanh trục ngang rồi quay ngang quanh trục đứng, đều qua gốc cổ (góc do ducks.js tính)
  if (aHead > 0.0) {
    rotZ(pos, nor, uHeadPivot, uHeadPitch * aHead);
    rotY(pos, nor, uHeadPivot, uHeadYaw * aHead);
  }

  // Chân quẫy: cẳng chân xoay quanh khớp háng theo trục ngang thân, hai chân lệch pha nửa nhịp;
  // bàn chân gập quanh cổ chân, TRỄ PHA so với cẳng — nhờ thế nhịp đạp dẻo như roi, không cứng như que.
  // Gập cổ chân trước (trong hệ của cẳng chân), rồi mới xoay cả cẳng quanh háng.
  // uBase kéo chân về sau (vịt bơi thì chân duỗi ra sau chứ không chống thẳng như đang đứng).
  if (aLeg.x > 0.0) {
    float ph = uTime * 6.2831853 * uHz + uPhase + aLeg.y;
    if (aLeg.z > 0.0) rotZ(pos, nor, aAnkle, sin(ph - uAnkleLag) * uAnkle * aLeg.z);
    rotZ(pos, nor, aPivot, (uBase + sin(ph) * uPaddle) * aLeg.x);
  }
  // đuôi thỉnh thoảng vẫy ngang (góc do ducks.js tính theo lịch)
  if (aTail > 0.0) rotY(pos, nor, uTailPivot, uTail * aTail);
#endif

  vec4 world = modelMatrix * vec4(pos, 1.0);
  // 1 = nổi trên mặt nước, tức nhìn xuyên qua mặt nước từ dưới lên. Hoà trong vài px để tam giác vắt
  // qua mực nước bị kéo giãn chứ không rách.
  float through = smoothstep(uWaterY - 3.0, uWaterY + 3.0, pos.y);

  // Phần nhìn xuyên qua mặt nước bị bẻ lệch theo độ dốc mặt nước — dấu hiệu chính cho biết ta đang
  // ở dưới nước. Độ dốc = sóng nền + gợn sóng mô phỏng (chạm tay, sóng sau đuôi) TẠI CHỖ tia nhìn
  // xuyên qua mặt nước. Cùng chiều với khúc xạ của nền trong water.js, không thì vịt trượt ngược nền.
  if (through > 0.0) {
    vec2 img = vec2(world.x / uKp + uCentre.x, uCentre.y - world.y / uKp);
    vec2 slope = waves(img, uTime).yz * uAmb;
    if (uSimGain > 0.0) {
      vec2 gu = (planeOf(img) - uSimOrigin) / (uGrid * uCell), tx = 1.5 / uGrid;
      float hl = texture2D(uHeight, gu - vec2(tx.x, 0.0)).r, hr = texture2D(uHeight, gu + vec2(tx.x, 0.0)).r;
      float hu = texture2D(uHeight, gu - vec2(0.0, tx.y)).r, hd = texture2D(uHeight, gu + vec2(0.0, tx.y)).r;
      slope += gradToImage(vec2(hr - hl, hd - hu) / (3.0 * uCell), img) * uSimGain;
    }
    vec2 d = slope * uRefr;
    float len = length(d);
    if (len > uRefrMax) d *= uRefrMax / len;
    world.xy += d * through * uKp * vec2(1.0, -1.0);
  }

  vN = normalize(mat3(modelMatrix) * nor);
  vP = world.xyz;
  vUv = uv;
  vImg = vec2(world.x / uKp + uCentre.x, uCentre.y - world.y / uKp);
  // Chuyển độ cao sang fragment shader thay vì chuyển sẵn kết quả nổi/chìm: nội suy một giá trị
  // 0/1 giữa các đỉnh thì đường ranh mặt nước bám theo cạnh tam giác, hiện ra răng cưa bậc thang.
  vLocalY = pos.y - uWaterY;
  gl_Position = projectionMatrix * viewMatrix * world;
}`;

export const FLOATER_FRAG = /* glsl */ `
uniform sampler2D uMap, uNormalMap;
uniform vec2 uNormalScale;
uniform vec3 uL, uThroughTint, uTint, uBelowTint, uThroughHaze;
uniform float uAmbient, uDiffuse, uEdge, uThroughDesat, uBelowDepth, uBelowDesat, uThroughHazeAmt, uTime, uNetGain;
varying vec2 vUv;
varying vec3 vN, vP;
varying float vLocalY;
varying vec2 vImg;
${WAVES_GLSL}
${NET_GLSL}

// Model không có tangent, nên dựng khung tiếp tuyến từ đạo hàm màn hình (cùng cách three.js làm
// trong normalmap_pars_fragment). glTF quy ước trục Y của normal map ngược với khung này → uNormalScale.y âm.
vec3 perturb(vec3 N, vec3 p, vec2 uv, vec3 mapN){
  vec3 q0 = dFdx(p), q1 = dFdy(p);
  vec2 st0 = dFdx(uv), st1 = dFdy(uv);
  vec3 q1perp = cross(q1, N), q0perp = cross(N, q0);
  vec3 T = q1perp * st0.x + q0perp * st1.x;
  vec3 B = q1perp * st0.y + q0perp * st1.y;
  float det = max(dot(T, T), dot(B, B));
  float s = (det == 0.0) ? 0.0 : inversesqrt(det);
  return normalize(T * (mapN.x * s) + B * (mapN.y * s) + N * mapN.z);
}

void main(){
  vec3 base = texture2D(uMap, vUv).rgb * uTint;
  vec3 n = normalize(vN);
  if (!gl_FrontFacing) n = -n;
  #ifdef HAS_NMAP
    vec3 mapN = texture2D(uNormalMap, vUv).xyz * 2.0 - 1.0;
    mapN.xy *= uNormalScale;
    n = perturb(n, vP, vUv, mapN);
  #endif

  // Texture đã có sẵn bóng vẽ; chỉ thêm một nguồn sáng dịu từ phía mặt trời của tranh cho có khối.
  float lam = dot(n, uL);
  vec3 col = base * (uAmbient + uDiffuse * (0.5 + 0.5 * lam));

  // Đường mặt nước tính ở TỪNG ĐIỂM ẢNH, hoà mềm trong uEdge đơn vị cho hết răng cưa.
  // Phần NỔI nhìn xuyên qua mặt nước: xỉn màu, bớt tương phản, ngả màu nước. Phần chìm giữ nguyên.
  // Nhẹ tay — cái bán được cảm giác "qua lớp nước" là chuyển động (khúc xạ ở vertex shader), không phải màu.
  float through = smoothstep(-uEdge, uEdge, vLocalY);
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  // rồi pha về màu sáng của bầu trời nhìn qua mặt nước (nền mới sáng: phần nổi nhạt đi chứ không tối đi)
  vec3 veiled = mix(mix(col, vec3(lum), uThroughDesat) * uThroughTint, uThroughHaze, uThroughHazeAmt);
  col = mix(col, veiled, through);
  // Phần nổi nhìn xuyên qua mặt nước nên LƯỚI SÓNG TRẮNG của mặt nước phủ lên nó (như tranh mẫu); phần chìm
  // ở trước mặt nước thì không. uNetA.z = 0 khi không có lưới (trang soi).
  if (uNetA.z + uNetA.w > 0.0) col = applyNet(col, netAt(vImg, vec2(0.0), uTime) * through * uNetGain);
  // Phần CHÌM: ở trong nước thì ngả màu nước — xanh lam, hơi tối, bớt bão hoà — càng sâu càng rõ
  // (nước hút ánh sáng đỏ). Không có bước này thì mép lá trĩu xuống nước vẫn tươi nguyên như ngoài
  // không khí. Vịt để rất nhẹ (bụng gần mặt nước gần như không đổi, chân sâu hơn mới ngả), lá và cuống rõ hơn.
  float depth = smoothstep(0.0, uBelowDepth, -vLocalY) * (1.0 - through);
  vec3 wet = mix(col, vec3(dot(col, vec3(0.299, 0.587, 0.114))), uBelowDesat) * uBelowTint;
  col = mix(col, wet, depth);

  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

// Uniform chung. `look` = { refract, refractMax, ambient, diffuse, normalScale, waterEdge, throughTint, throughDesat,
// throughHaze, throughHazeAmt, netGain, belowTint, belowDepth, belowDesat }
// (DUCK_MODEL hoặc LEAF_MODEL). `ambGain`: độ mạnh sóng nền của cảnh (giảm khi bật giảm chuyển động).
export function floaterUniforms(model, look, ambGain = AMBIENT_GAIN) {
  return {
    uMap: { value: model.map },
    uNormalMap: { value: model.normalMap },
    uNormalScale: { value: new THREE.Vector2(look.normalScale, -look.normalScale) },
    uTint: { value: new THREE.Vector3(1, 1, 1) },
    uTime: { value: 0 },
    uAmb: { value: ambGain },
    uWaterY: { value: 0 },
    uRefr: { value: look.refract },
    uRefrMax: { value: look.refractMax },
    uKp: { value: 1 },
    uHeight: { value: null },
    uSimOrigin: { value: new THREE.Vector2() },
    uGrid: { value: new THREE.Vector2(1, 1) },
    uCell: { value: 1 },
    uSquash: { value: 0.39 },
    uPersp: { value: FLAT_PERSP.clone() }, // trang soi: không phối cảnh
    uSimGain: { value: 0 }, // 0 = không có lưới sóng (các trang soi)
    uCentre: { value: new THREE.Vector2() },
    uWaves: { value: AMBIENT_WAVES.map((w) => new THREE.Vector4(...w)) },
    uL: { value: new THREE.Vector3(...SUN.dir).normalize() },
    uAmbient: { value: look.ambient },
    uDiffuse: { value: look.diffuse },
    uEdge: { value: look.waterEdge },
    uThroughTint: { value: new THREE.Vector3(...look.throughTint) },
    uThroughDesat: { value: look.throughDesat },
    uThroughHaze: { value: new THREE.Vector3(...(look.throughHaze || [1, 1, 1])) },
    uThroughHazeAmt: { value: look.throughHazeAmt || 0 },
    uNetGain: { value: look.netGain ?? 1 }, // lưới sóng trắng phủ lên phần nổi đậm bao nhiêu (lá: nhẹ hơn vịt)
    uRadial: { value: 0 }, // trang soi: không phối cảnh
    ...netUniforms(null, false), // trang soi: không có lưới sóng trắng; bindFloater nối lưới của cảnh
    uBelowTint: { value: new THREE.Vector3(...(look.belowTint || [1, 1, 1])) },
    uBelowDepth: { value: look.belowDepth || 1 },
    uBelowDesat: { value: look.belowDesat || 0 },
  };
}

// Nối vật liệu với lưới sóng của cảnh (để phần nổi bị gợn sóng bẻ lệch), với khung nhìn, và với lưới sóng
// trắng (net = { texture, aspect } của assets, phủ lên phần nổi).
export function bindFloater(material, { sim, centre, squash, net, reduceMotion }) {
  const u = material.uniforms;
  u.uCentre.value.set(centre[0], centre[1]);
  u.uSquash.value = squash;
  if (net) Object.entries(netUniforms(net, reduceMotion)).forEach(([k, v]) => { u[k].value = v.value; });
  if (sim) {
    u.uHeight.value = sim.texture;
    u.uSimOrigin.value.set(sim.ox, sim.oy);
    u.uGrid.value.set(sim.cols, sim.rows);
    u.uCell.value = sim.cell;
    u.uPersp.value.copy(sim.persp.uniform());
    u.uRadial.value = sim.persp.radial ? 1 : 0;
    u.uSimGain.value = 1;
  }
}

export function floaterMaterial(model, look, ambGain, extra = {}) {
  return new THREE.ShaderMaterial({
    defines: { ...(model.normalMap ? { HAS_NMAP: '' } : {}), ...(extra.defines || {}) },
    uniforms: { ...floaterUniforms(model, look, ambGain), ...(extra.uniforms || {}) },
    vertexShader: FLOATER_VERT,
    fragmentShader: FLOATER_FRAG,
    side: THREE.DoubleSide,
    // Vào danh sách TRONG SUỐT (alpha vẫn = 1) để thứ tự vẽ theo renderOrder: lá sprite cũ và giọt nước
    // là vật trong suốt, three vẽ hết vật đục trước rồi mới tới vật trong suốt. forceSinglePass: không
    // thì DoubleSide + transparent bị vẽ thành hai lượt.
    transparent: true,
    forceSinglePass: true,
  });
}

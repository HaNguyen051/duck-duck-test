// Con vịt là MODEL 3D THẬT (models/duck.glb): Tripo sinh từ ảnh, rồi tools/prepare-duck.mjs rút gọn
// lưới và xoay về hệ chuẩn — mũi +X, lưng +Y, hai bên ±Z, gan bàn chân chạm y = 0, tâm thân ở x = z = 0.
// File này (1) nạp model, (2) "rig" hai chân để quẫy được dù model không có xương, (3) viết vật liệu:
// texture gốc + ánh sáng nhẹ + cắt theo mực nước. GÓC NHÌN TỪ DƯỚI ĐÁY HỒ LÊN, nên phần NỔI của vịt
// mới là phần nhìn xuyên qua mặt nước — xỉn màu và lay theo sóng; phần chìm ở cùng môi trường với
// người xem nên rõ nét, sáng.
//
// Vì sao không dùng khung ảnh turntable: xem CLAUDE.md ("Đừng tăng số khung ảnh turntable").
// Vì sao không dựng bằng khối hình học: đã thử, trông như đồ chơi ghép khối — người dùng bác.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { DUCK_MODEL } from './config.js';
import { floaterMaterial } from './floater.js';

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/* ------------------------------------------------------------------ nạp */
// Trả về { geometry, map, normalMap, height, contact: [a, b], water } — đơn vị px ảnh, gốc toạ độ
// ĐÚNG MỰC NƯỚC (y = 0 là mặt nước, chân ở y < 0). Gọi một lần lúc mở trang (assets.js); geometry
// và texture dùng chung cho cả hai con và qua mọi lần dựng lại cảnh.
export async function loadDuckModel(url = DUCK_MODEL.url) {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.loadAsync(url);
  gltf.scene.updateMatrixWorld(true);
  let mesh = null;
  gltf.scene.traverse((o) => { if (o.isMesh && !mesh) mesh = o; });
  if (!mesh) throw new Error('Model vịt không có lưới nào: ' + url);

  const map = mesh.material.map || null, normalMap = mesh.material.normalMap || null;
  for (const t of [map, normalMap]) if (t) t.anisotropy = 8;
  const geometry = unpack(mesh);
  const info = rig(geometry);
  return { geometry, map, normalMap, ...info };
}

// File đã lượng tử hoá: toạ độ là số nguyên 16 bit, hệ số về mét nằm trên node. Chép ra Float32 rồi
// nhân ma trận node — áp ma trận thẳng vào thuộc tính int16 thì kết quả bị cắt cụt thành rác.
// Dùng chung cho lá (leaf3d.js).
export function unpack(mesh) {
  const src = mesh.geometry, m = mesh.matrixWorld, nm = new THREE.Matrix3().getNormalMatrix(m);
  const p = src.attributes.position, q = src.attributes.normal, t = src.attributes.uv, n = p.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2);
  const v = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    v.fromBufferAttribute(p, i).applyMatrix4(m);
    pos[i * 3] = v.x; pos[i * 3 + 1] = v.y; pos[i * 3 + 2] = v.z;
    if (q) {
      v.fromBufferAttribute(q, i).applyMatrix3(nm).normalize();
      nor[i * 3] = v.x; nor[i * 3 + 1] = v.y; nor[i * 3 + 2] = v.z;
    }
    if (t) { uv[i * 2] = t.getX(i); uv[i * 2 + 1] = t.getY(i); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  if (src.index) g.setIndex(src.index.clone());
  if (!q) g.computeVertexNormals();
  return g;
}

/* ------------------------------------------------------------------ rig chân */
// Model không có xương, nên "xương" được dựng từ hình học: mọi đỉnh dưới khớp háng là chân, chia
// hai bên theo LIÊN THÔNG của lưới; dưới cổ chân nữa là bàn chân (khớp thứ hai, cho nhịp đạp dẻo);
// phần thân phía sau là đuôi. Mỗi đỉnh mang trọng số 0..1 (như trọng số da) để chỗ nối kéo giãn mượt
// chứ không rách; vertex shader xoay đỉnh quanh khớp theo trọng số đó.
// Model gốc đứng giữa bước: hai chân lệch sang một bên thân và một chân nhấc cao hơn. Nên (1) cổ chân
// dò riêng cho từng chân, (2) hai chân được dời đều về ±legSpread, hoà dần trên cả đoạn cẳng cho
// chân nghiêng nhẹ chứ không gãy khúc ở háng.
function rig(g) {
  const D = DUCK_MODEL, pos = g.attributes.position, n = pos.count;
  g.computeBoundingBox();
  const bb = g.boundingBox, k = D.length / (bb.max.x - bb.min.x);
  for (let i = 0; i < n; i++) pos.setXYZ(i, pos.getX(i) * k, (pos.getY(i) - bb.min.y) * k, pos.getZ(i) * k);
  const h = (bb.max.y - bb.min.y) * k; // chiều cao px: mọi số trong DUCK_MODEL quy về chiều cao này
  const hipY = D.hip * h, band = D.hipBand * h, spread = D.legSpread * h, moveBand = D.spreadBand * h;
  const ankleBand = D.ankleBand * h;
  const X = (i) => pos.getX(i), Y = (i) => pos.getY(i), Z = (i) => pos.getZ(i);

  // hai cẳng chân: lấy đỉnh trong dải ngay dưới háng, tách theo khe hở lớn nhất trên trục ngang
  const shaft = [];
  for (let i = 0; i < n; i++) if (Y(i) >= hipY - 0.045 * h && Y(i) < hipY - 0.015 * h) shaft.push(i);
  shaft.sort((a, b) => Z(a) - Z(b));
  let gap = 0, cut = shaft.length >> 1;
  for (let i = 1; i < shaft.length; i++) if (Z(shaft[i]) - Z(shaft[i - 1]) > gap) { gap = Z(shaft[i]) - Z(shaft[i - 1]); cut = i; }
  if (cut <= 0 || cut >= shaft.length) throw new Error('Không tách được hai cẳng chân — kiểm tra DUCK_MODEL.hip');
  const mean = (ids, f) => ids.reduce((s, i) => s + f(i), 0) / ids.length;
  const sA = shaft.slice(0, cut), sB = shaft.slice(cut);
  const xHip = (mean(sA, X) + mean(sB, X)) / 2, zMid = (mean(sA, Z) + mean(sB, Z)) / 2;
  const legs = [sA, sB].map((ids, j) => ({
    x: mean(ids, X), z: mean(ids, Z), tx: xHip, tz: j ? spread : -spread, phase: j ? Math.PI : 0,
  }));

  // Chia chân theo liên thông: nối các đỉnh cùng tam giác (và các đỉnh trùng vị trí — đường nối UV
  // nhân đôi đỉnh) trong vùng dưới dải hoà mềm; nhóm nào chứa đỉnh cẳng chân nào thì thuộc chân ấy.
  // Chia theo khoảng cách tới trục cẳng thì ngón chân bè ra quá giữa sẽ bị gán nhầm sang chân kia.
  const low = (i) => Y(i) <= hipY - band;
  const parent = new Int32Array(n).map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) i = parent[i] = parent[parent[i]]; return i; };
  const unite = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[a] = b; };
  const idx = g.index ? g.index.array : null, nt = idx ? idx.length : n;
  for (let t = 0; t < nt; t += 3) {
    const a = idx ? idx[t] : t, b = idx ? idx[t + 1] : t + 1, c = idx ? idx[t + 2] : t + 2;
    if (low(a) && low(b) && low(c)) { unite(a, b); unite(b, c); }
  }
  const seen = new Map(), q = h * 1e-4;
  for (let i = 0; i < n; i++) if (low(i)) {
    const key = `${Math.round(X(i) / q)},${Math.round(Y(i) / q)},${Math.round(Z(i) / q)}`;
    const j = seen.get(key); if (j === undefined) seen.set(key, i); else unite(i, j);
  }
  const owner = new Map(); // gốc nhóm → chân
  [sA, sB].forEach((ids, j) => { for (const i of ids) if (low(i)) owner.set(find(i), j); });
  const legOf = (i) => {
    const o = low(i) ? owner.get(find(i)) : undefined;
    if (o !== undefined) return o;
    return Math.abs(Z(i) - legs[1].z) < Math.abs(Z(i) - legs[0].z) ? 1 : 0; // dải hoà mềm, hoặc mảnh rời
  };

  // Cổ chân từng chân: dò từ háng xuống, chỗ bề ngang lát cắt bung ra gấp đôi bề ngang cẳng là bàn chân.
  const lab = new Int8Array(n).fill(-1);
  for (let i = 0; i < n; i++) if (Y(i) <= hipY + band) lab[i] = legOf(i);
  const STEP = 0.005 * h, NS = Math.ceil(hipY / STEP);
  legs.forEach((L, j) => {
    const sl = Array.from({ length: NS }, () => [Infinity, -Infinity, Infinity, -Infinity, 0, 0]);
    for (let i = 0; i < n; i++) {
      if (lab[i] !== j || Y(i) >= hipY) continue;
      const s = sl[Math.min(NS - 1, Math.floor(Y(i) / STEP))];
      s[0] = Math.min(s[0], X(i)); s[1] = Math.max(s[1], X(i)); s[2] = Math.min(s[2], Z(i)); s[3] = Math.max(s[3], Z(i));
      s[4] += X(i); s[5]++;
    }
    const width = (s) => (s[5] ? Math.max(s[1] - s[0], s[3] - s[2]) : 0);
    const ref = sl.slice(Math.floor((hipY - 0.05 * h) / STEP), Math.floor((hipY - 0.02 * h) / STEP)).filter((s) => s[5]).map(width).sort((a, b) => a - b);
    const shaftW = ref.length ? ref[ref.length >> 1] : 0.05 * h;
    L.ankleY = D.ankle * h; L.ankleX = L.x;
    for (let s = Math.floor((hipY - 0.02 * h) / STEP); s >= 0; s--) {
      if (sl[s][5] && width(sl[s]) > 2 * shaftW) {
        L.ankleY = (s + 1) * STEP;
        const up = sl[Math.min(NS - 1, s + 2)];
        L.ankleX = up[5] ? up[4] / up[5] : L.x;
        break;
      }
    }
    L.ankleM = 1 - smooth(hipY - moveBand, hipY + band, L.ankleY); // cổ chân bị dời ngần này phần
  });

  // aLeg = (trọng số háng, pha quẫy, trọng số cổ chân); aPivot = khớp háng; aAnkle = khớp cổ chân
  const leg = new Float32Array(n * 3), pivot = new Float32Array(n * 3), ankle = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    let x = X(i), z = Z(i);
    const y = Y(i);
    if (y > hipY + band) continue;
    const L = legs[lab[i]];
    // trong dải hoà mềm, chỉ vùng bụng sát quanh cẳng chân mới bị kéo theo
    const near = y > hipY - band ? 1 - smooth(D.hipR0 * h, D.hipR1 * h, Math.hypot(x - L.x, z - L.z)) : 1;
    const w = (1 - smooth(hipY - band, hipY + band, y)) * near;
    if (w <= 0) continue;
    // dời chân: hoà trên đoạn cao hơn trọng số xoay, để cẳng chân nghiêng chứ không gập ở háng
    const m = (1 - smooth(hipY - moveBand, hipY + band, y)) * near;
    x += m * (L.tx - L.x); z += m * (L.tz - L.z);
    pos.setXYZ(i, x, y, z);
    leg[i * 3] = w; leg[i * 3 + 1] = L.phase;
    leg[i * 3 + 2] = w * (1 - smooth(L.ankleY - ankleBand, L.ankleY + ankleBand, y)); // bàn chân
    pivot[i * 3] = L.tx; pivot[i * 3 + 1] = hipY; pivot[i * 3 + 2] = L.tz;
    ankle[i * 3] = L.ankleX + L.ankleM * (L.tx - L.x); ankle[i * 3 + 1] = L.ankleY; ankle[i * 3 + 2] = L.tz;
  }
  g.setAttribute('aLeg', new THREE.BufferAttribute(leg, 3));
  g.setAttribute('aPivot', new THREE.BufferAttribute(pivot, 3));
  g.setAttribute('aAnkle', new THREE.BufferAttribute(ankle, 3));

  // đuôi: phần thân phía sau, trọng số tăng dần ra chóp; phần mông chìm sâu thì không vẫy
  const T = D.tail, tail = new Float32Array(n), tailX = -T.base * h;
  for (let i = 0; i < n; i++) {
    const w = smooth(-T.base * h, -T.tip * h, X(i)) * smooth(D.water * h - 0.08 * h, D.water * h + 0.04 * h, Y(i));
    if (w > 0) tail[i] = w;
  }
  g.setAttribute('aTail', new THREE.BufferAttribute(tail, 1));

  // đầu: mọi đỉnh trên gốc cổ, hoà mềm trong neckBand (cổ co giãn như da); khớp = tâm mặt cắt cổ
  const neckY = D.neck * h, nb = D.neckBand * h, head = new Float32Array(n);
  let hx = 0, hz = 0, hn = 0;
  for (let i = 0; i < n; i++) {
    const y = Y(i), w = smooth(neckY - nb, neckY + nb, y);
    if (w > 0) head[i] = w;
    if (Math.abs(y - neckY) < 0.015 * h) { hx += X(i); hz += Z(i); hn++; }
  }
  if (!hn) throw new Error(`Không có đỉnh nào ở gốc cổ DUCK_MODEL.neck = ${D.neck}`);
  g.setAttribute('aHead', new THREE.BufferAttribute(head, 1));
  const headPivot = new THREE.Vector3(hx / hn, neckY, hz / hn);

  // mặt cắt thân ở mực nước → hình elip tiếp nước; rồi dời gốc toạ độ về đúng tâm mặt cắt ấy
  const waterY = D.water * h;
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let i = 0; i < n; i++) {
    if (Math.abs(Y(i) - waterY) > 0.008 * h) continue;
    const x = X(i), z = Z(i);
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z;
  }
  if (!isFinite(x0)) throw new Error(`Không có đỉnh nào ở mực nước DUCK_MODEL.water = ${D.water} — phải nằm trong (0, 1)`);
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  for (let i = 0; i < n; i++) pos.setXYZ(i, X(i) - cx, Y(i) - waterY, Z(i) - cz);
  for (let i = 0; i < n; i++) if (leg[i * 3] > 0) {
    pivot[i * 3] -= cx; pivot[i * 3 + 1] -= waterY; pivot[i * 3 + 2] -= cz;
    ankle[i * 3] -= cx; ankle[i * 3 + 1] -= waterY; ankle[i * 3 + 2] -= cz;
  }
  for (const L of legs) {
    L.x -= cx; L.tx -= cx; L.z -= cz; L.tz -= cz; L.y = hipY - waterY;
    L.ankleX -= cx; L.ankleY -= waterY;
  }
  pos.needsUpdate = true;
  g.computeBoundingBox();
  g.computeBoundingSphere();
  headPivot.x -= cx; headPivot.y -= waterY; headPivot.z -= cz;
  return {
    height: h, water: waterY, contact: [(x1 - x0) / 2, (z1 - z0) / 2], legs, offAxis: (zMid - cz) / h,
    tailPivot: new THREE.Vector3(tailX - cx, 0, -cz), // gốc đuôi, ngay mực nước
    headPivot,
  };
}

/* ------------------------------------------------------------------ vật liệu */
// Shader dùng chung với lá ở floater.js; vịt bật DUCK_RIG và thêm uniform cho chân, đầu, đuôi.
// Mỗi con một vật liệu (pha quẫy, mực nước, biên độ quẫy khác nhau), texture dùng chung.
export function duckMaterial(model, ambGain) {
  const D = DUCK_MODEL;
  return floaterMaterial(model, D, ambGain, {
    defines: { DUCK_RIG: '' },
    uniforms: {
      uPhase: { value: 0 },
      uPaddle: { value: D.paddle },
      uBase: { value: D.paddleBase },
      uHz: { value: D.paddleHz },
      uAnkle: { value: D.ankleAmp },
      uAnkleLag: { value: D.ankleLag },
      uTail: { value: 0 },
      uTailPivot: { value: model.tailPivot.clone() },
      uHeadYaw: { value: 0 },
      uHeadPitch: { value: 0 },
      uHeadPivot: { value: model.headPivot.clone() },
    },
  });
}

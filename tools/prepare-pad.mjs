// Chuẩn bị model LÁ SEN KIỂU "NHÌN TỪ TRÊN" (sen_1, sen_2: Tripo sinh từ ảnh chụp/vẽ lá từ trên xuống) cho web.
//
// Khác hẳn lá cũ (prepare-leaf.mjs: tấm đứng trong XY, có cuống ngang), model này là một ĐĨA NẰM NGANG trong
// mặt phẳng XZ, dày như cái đệm (Tripo ép dày 8–20 % bề rộng), mặt trên có gân toả từ rốn và một cái nhú nhỏ,
// có KHE (rãnh chữ V từ mép vào gần tâm), KHÔNG có cuống. Script này:
//   1. kiểm tra bố cục (trục Y phải mỏng nhất), lật nếu --flip (mặt gân phải là +Y);
//   2. tâm = tâm đường tròn nội tiếp của hình chiếu XZ, bán kính R = trung bình nửa bề rộng X và Z;
//   3. xoay quanh trục đứng cho KHE về cùng một hướng ở mọi lá (--notch 1: +Z = phía trên màn hình, −1: −Z,
//      0: không xoay) — lá không tự xoay trong ao nên hướng khe cố định từ đây;
//   4. ÉP MỎNG: bề dày về --thick lần R (mặc định 0,06 ≈ 5 px ở lá 84 px) — đệm dày nhìn từ dưới lộ cả vách;
//   5. RỐN LÁ từ texture mặt trên (findNavel, như lá cũ: gân tối bỏ phiếu đường thẳng, đỉnh phiếu = chỗ hội tụ);
//      không thấy thì lấy tâm;
//   6. KHÔNG dựng cuống (mặc định --stemLen 0): người dùng muốn giữ lá đúng như model gốc ("để nguyên lá cũ không
//      gắn cuống"). --stemLen > 0 mới dựng ống trụ từ rốn ở mặt dưới rủ xuống −Y, nghiêng dần từ --lean0 tới --lean
//      độ về −Z, dài --stemLen R, bán kính --stemR R, thon 15 %, đầu bo tròn; màu = một ô ĐỒNG MÀU trên atlas gần
//      màu mặt dưới (sẫm hơn chút) — atlas Tripo vỡ vụn nên không lấy UV bừa được;
//   7. chuẩn hoá: tâm mặt lá về gốc, mặt dưới ở y = 0, R = 1; rút gọn (khoá đỉnh ống nếu có), nén texture, meshopt.
// Chạy: cd tools && node prepare-pad.mjs ~/Downloads/sen_1.glb ../models/sen_1.glb [--tris 24000] [--thick 0.06]
//       [--stemLen 0] [--lean0 4] [--lean 18] [--stemR 0.045] [--notch 1] [--flip]
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { weld, dedup, prune, quantize, meshopt, flatten, clearNodeTransform, textureCompress, compactPrimitive } from '@gltf-transform/functions';
import { MeshoptSimplifier, MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import sharp from 'sharp';
import { statSync } from 'node:fs';

const args = process.argv.slice(2);
const flag = (name, def) => { const i = args.indexOf(name); return i >= 0 ? parseFloat(args[i + 1]) : def; };
const has = (name) => args.includes(name);
const files = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--') && !isNaN(parseFloat(a))));
const [src, dst] = files;
if (!src || !dst) { console.error('Dùng: node prepare-pad.mjs <nguồn.glb> <đích.glb> [--tris 24000] [--thick 0.06] [--stemLen 1.6] [--lean0 4] [--lean 18] [--stemR 0.045] [--notch 1|-1|0] [--flip]'); process.exit(1); }
const TRIS = flag('--tris', 24000), THICK = flag('--thick', 0.06), STEMLEN = flag('--stemLen', 0), LEAN0 = flag('--lean0', 4), LEAN = flag('--lean', 18), STEMR = flag('--stemR', 0.045), NOTCH = flag('--notch', 1), FLIP = has('--flip');

await MeshoptSimplifier.ready; await MeshoptEncoder.ready; await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });

const doc = await io.read(src);
const before = countTris(doc);
await doc.transform(flatten());
for (const node of doc.getRoot().listNodes()) if (node.getMesh()) clearNodeTransform(node);
await doc.transform(weld());
const info = await reshapePad(doc);
simplifyPermissive(doc, TRIS, info.locked);
console.log(`Rút gọn lưới: ${before.toLocaleString()} → ${countTris(doc).toLocaleString()} tam giác`);

for (const m of doc.getRoot().listMeshes()) m.setName('leaf');
for (const m of doc.getRoot().listMaterials()) { m.setName('leaf'); m.setMetallicRoughnessTexture(null); }
for (const n of doc.getRoot().listNodes()) n.setName('leaf');
await doc.transform(dedup(), prune(),
  textureCompress({ encoder: sharp, resize: [1024, 1024], targetFormat: 'jpeg', quality: 88 }),
  quantize({ quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 12 }),
  weld(), dropDegenerate(), prune(),
  meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
await io.write(dst, doc);
const vcount = doc.getRoot().listMeshes().flatMap((m) => m.listPrimitives()).reduce((s, p) => s + p.getAttribute('POSITION').getCount(), 0);
console.log(`Ghi ${dst}: ${(statSync(dst).size / 1e6).toFixed(2)} MB, ${vcount.toLocaleString()} đỉnh, ${countTris(doc).toLocaleString()} tam giác`);
console.log('Số đo (bán kính mặt lá = 1):', JSON.stringify(info));

/* ------------------------------------------------------------------ hình học */
async function reshapePad(d) {
  const prims = d.getRoot().listMeshes().flatMap((m) => m.listPrimitives());
  if (prims.length !== 1) throw new Error('Script chỉ xử lý model một primitive');
  const prim = prims[0];
  const P = [], N = [], UV = [];
  {
    const a = prim.getAttribute('POSITION').getArray(), nr = prim.getAttribute('NORMAL')?.getArray(), uv = prim.getAttribute('TEXCOORD_0')?.getArray();
    for (let i = 0; i < a.length; i += 3) { P.push(a[i], a[i + 1], a[i + 2]); N.push(nr ? nr[i] : 0, nr ? nr[i + 1] : 1, nr ? nr[i + 2] : 0); }
    for (let i = 0; i < a.length / 3; i++) UV.push(uv ? uv[i * 2] : 0, uv ? uv[i * 2 + 1] : 0);
  }
  const n = P.length / 3;
  const IDX = prim.getIndices() ? Array.from(prim.getIndices().getArray()) : Array.from({ length: n }, (_, i) => i);
  const bbox = () => {
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) { const v = P[i * 3 + k]; if (v < mn[k]) mn[k] = v; if (v > mx[k]) mx[k] = v; }
    return { mn, mx, ext: [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]] };
  };
  let { ext } = bbox();
  if (!(ext[1] < ext[0] * 0.5 && ext[1] < ext[2] * 0.5)) throw new Error(`Không phải đĩa nằm ngang (bề dày Y ${ext[1].toFixed(3)} so với ${ext[0].toFixed(3)}×${ext[2].toFixed(3)}) — model kiểu tấm đứng thì dùng prepare-leaf.mjs`);

  // 1) lật: R_x(180°) (x, y, z) → (x, −y, −z), det = +1
  if (FLIP) for (let i = 0; i < n; i++) { P[i * 3 + 1] *= -1; P[i * 3 + 2] *= -1; N[i * 3 + 1] *= -1; N[i * 3 + 2] *= -1; }

  // mặt trên / mặt dưới theo pháp tuyến GỐC (trước khi ép mỏng — ép xong pháp tuyến vách cũng ngả lên, lẫn vào
  // mặt trên và lấn át việc dò rốn: vách của đệm dày có tới ~400k đỉnh dồn hết lên vành)
  const isTop = new Uint8Array(n), isBottom = new Uint8Array(n);
  for (let i = 0; i < n; i++) { if (N[i * 3 + 1] > 0.6) isTop[i] = 1; else if (N[i * 3 + 1] < -0.6) isBottom[i] = 1; }

  // 2) tâm = tâm hộp bao của hình chiếu XZ (khe chỉ khoét một góc nên hộp bao vẫn đúng tâm đĩa; tâm đường tròn
  //    nội tiếp thì bị khe đẩy lệch 0,3 R về phía đối diện — chỉ in ra để tham khảo); R = trung bình nửa bề rộng
  let { mn, mx } = bbox(); ext = [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]];
  const R = (ext[0] + ext[2]) / 4;
  const G = R / 60, cols = Math.ceil(ext[0] / G) + 2, rows = Math.ceil(ext[2] / G) + 2;
  const occ = new Uint8Array(cols * rows);
  for (let i = 0; i < n; i++) occ[(Math.floor((P[i * 3 + 2] - mn[2]) / G) + 1) * cols + Math.floor((P[i * 3] - mn[0]) / G) + 1] = 1;
  const dil = new Uint8Array(cols * rows);
  for (let y = 1; y < rows - 1; y++) for (let x = 1; x < cols - 1; x++) { let v = 0; for (let dy = -1; dy <= 1 && !v; dy++) for (let dx = -1; dx <= 1; dx++) if (occ[(y + dy) * cols + x + dx]) { v = 1; break; } dil[y * cols + x] = v; }
  const filled = new Uint8Array(cols * rows);
  for (let y = 1; y < rows - 1; y++) for (let x = 1; x < cols - 1; x++) { let v = 1; for (let dy = -1; dy <= 1 && v; dy++) for (let dx = -1; dx <= 1; dx++) if (!dil[(y + dy) * cols + x + dx]) { v = 0; break; } filled[y * cols + x] = v; }
  const dist = new Float32Array(cols * rows);
  for (let i = 0; i < dist.length; i++) dist[i] = filled[i] ? 1e9 : 0;
  const S2 = Math.SQRT2;
  for (let y = 1; y < rows; y++) for (let x = 1; x < cols - 1; x++) { const i = y * cols + x; if (!dist[i]) continue; dist[i] = Math.min(dist[i], dist[i - 1] + 1, dist[i - cols] + 1, dist[i - cols - 1] + S2, dist[i - cols + 1] + S2); }
  for (let y = rows - 2; y >= 0; y--) for (let x = cols - 2; x >= 1; x--) { const i = y * cols + x; if (!dist[i]) continue; dist[i] = Math.min(dist[i], dist[i + 1] + 1, dist[i + cols] + 1, dist[i + cols + 1] + S2, dist[i + cols - 1] + S2); }
  let best = 0, bi = 0;
  for (let i = 0; i < dist.length; i++) if (dist[i] < 1e8 && dist[i] > best) { best = dist[i]; bi = i; }
  const cxi = mn[0] + ((bi % cols) - 1 + 0.5) * G, czi = mn[2] + (Math.floor(bi / cols) - 1 + 0.5) * G, Rin = best * G;
  const cx = (mn[0] + mx[0]) / 2, cz = (mn[2] + mx[2]) / 2;
  for (let i = 0; i < n; i++) { P[i * 3] -= cx; P[i * 3 + 2] -= cz; } // tâm về (0, ·, 0)
  console.log(`  tâm nội tiếp lệch (${((cxi - cx) / R).toFixed(3)}, ${((czi - cz) / R).toFixed(3)}) R so với tâm hộp (dùng tâm hộp); R nội tiếp ${(Rin / R).toFixed(3)} R; dày ${(ext[1] / R).toFixed(3)} R`);

  // 3) khe lá: bán kính ngoài theo góc (72 nan), khe = dải nan liền nhau có bán kính < 0,75 trung vị
  let notchDeg = null;
  {
    const NB = 72, rad = new Float32Array(NB);
    for (let i = 0; i < n; i++) {
      const x = P[i * 3], z = P[i * 3 + 2], r = Math.hypot(x, z);
      const b = ((Math.floor(((Math.atan2(z, x) + Math.PI) / (2 * Math.PI)) * NB) % NB) + NB) % NB;
      if (r > rad[b]) rad[b] = r;
    }
    const med = [...rad].sort((a, b) => a - b)[NB >> 1];
    const low = [...rad].map((r) => r < med * 0.75);
    let bestLen = 0, bestStart = -1;
    for (let s = 0; s < NB; s++) {
      if (!low[s] || low[(s - 1 + NB) % NB]) continue; // chỉ bắt đầu ở đầu một dải
      let len = 0; while (len < NB && low[(s + len) % NB]) len++;
      if (len > bestLen) { bestLen = len; bestStart = s; }
    }
    if (bestLen >= 2 && bestLen < NB / 3) {
      const mid = bestStart + (bestLen - 1) / 2;
      const th = ((mid + 0.5) / NB) * 2 * Math.PI - Math.PI; // góc atan2(z, x) của khe
      notchDeg = +((th * 180) / Math.PI).toFixed(1);
      if (NOTCH !== 0) {
        const target = NOTCH > 0 ? Math.PI / 2 : -Math.PI / 2, phi = th - target; // R_y(phi): góc θ → θ − phi
        const c = Math.cos(phi), s = Math.sin(phi);
        for (let i = 0; i < n; i++) {
          const x = P[i * 3], z = P[i * 3 + 2]; P[i * 3] = x * c + z * s; P[i * 3 + 2] = -x * s + z * c;
          const nx = N[i * 3], nz = N[i * 3 + 2]; N[i * 3] = nx * c + nz * s; N[i * 3 + 2] = -nx * s + nz * c;
        }
      }
      console.log(`  khe lá: rộng ${bestLen * 5}°, ở góc ${notchDeg}° → xoay về ${NOTCH > 0 ? '+Z' : NOTCH < 0 ? '−Z' : '(giữ nguyên)'}`);
    } else console.log('  không thấy khe lá rõ (không xoay)');
  }

  // 4) ép mỏng quanh mặt dưới: y' = yMin + (y − yMin)·k; pháp tuyến chia k rồi chuẩn hoá lại
  ({ mn, mx } = bbox());
  const kThick = Math.min(1, (THICK * R) / (mx[1] - mn[1]));
  for (let i = 0; i < n; i++) {
    P[i * 3 + 1] = mn[1] + (P[i * 3 + 1] - mn[1]) * kThick;
    const nx = N[i * 3], ny = N[i * 3 + 1] / kThick, nz = N[i * 3 + 2], l = Math.hypot(nx, ny, nz) || 1;
    N[i * 3] = nx / l; N[i * 3 + 1] = ny / l; N[i * 3 + 2] = nz / l;
  }

  // 4b) MẶT DƯỚI lấy texture của MẶT TRÊN. Tripo không nhìn thấy mặt dưới nên vẽ bừa (xám xịt, lốm đốm) mà ta
  //     lại nhìn lá từ dưới lên. Lá sen thật mỏng, lọt nắng nên nhìn từ dưới vẫn thấy gân: chép UV của tam giác
  //     mặt trên nằm ngay trên xuống tam giác mặt dưới — toạ độ trọng tâm của từng đỉnh dưới trong tam giác trên
  //     → UV nội suy, cả ba đỉnh cùng một mảng atlas. (Chép từng ĐỈNH từ các tam giác trên khác nhau thì ba đỉnh
  //     rơi vào ba mảng atlas, tam giác thành vệt rác.) Mỗi tam giác dưới nhận ba đỉnh mới (tách đỉnh dùng chung);
  //     đỉnh cũ không còn ai dùng sẽ bị compactPrimitive bỏ sau khi rút gọn.
  {
    const h = R / 150, K = 4096, OFF = 2048;
    const cellKey = (x, z) => (Math.floor(x / h) + OFF) * K + (Math.floor(z / h) + OFF);
    const triCount = IDX.length / 3;
    const cen = (t) => { const a = IDX[t * 3], b = IDX[t * 3 + 1], c = IDX[t * 3 + 2]; return [(P[a * 3] + P[b * 3] + P[c * 3]) / 3, (P[a * 3 + 2] + P[b * 3 + 2] + P[c * 3 + 2]) / 3]; };
    const topTris = new Map();
    let nTop = 0;
    for (let t = 0; t < triCount; t++) {
      const a = IDX[t * 3], b = IDX[t * 3 + 1], c = IDX[t * 3 + 2];
      if (!(isTop[a] && isTop[b] && isTop[c])) continue;
      const [x, z] = cen(t), k = cellKey(x, z);
      let arr = topTris.get(k); if (!arr) topTris.set(k, (arr = [])); arr.push(t); nTop++;
    }
    let done = 0, miss = 0;
    for (let t = 0; t < triCount; t++) {
      const a = IDX[t * 3], b = IDX[t * 3 + 1], c = IDX[t * 3 + 2];
      if (!(isBottom[a] && isBottom[b] && isBottom[c])) continue;
      const [x, z] = cen(t), ix = Math.floor(x / h) + OFF, iz = Math.floor(z / h) + OFF;
      let bestT = -1, bestD = Infinity;
      for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
        const arr = topTris.get((ix + dx) * K + (iz + dz)); if (!arr) continue;
        for (const tt of arr) { const [tx, tz] = cen(tt); const dd = (tx - x) ** 2 + (tz - z) ** 2; if (dd < bestD) { bestD = dd; bestT = tt; } }
      }
      if (bestT < 0) { miss++; continue; }
      const A = IDX[bestT * 3], B = IDX[bestT * 3 + 1], C = IDX[bestT * 3 + 2];
      const ax = P[A * 3], az = P[A * 3 + 2], bx = P[B * 3], bz = P[B * 3 + 2], qx = P[C * 3], qz = P[C * 3 + 2];
      const det = (bx - ax) * (qz - az) - (qx - ax) * (bz - az);
      if (Math.abs(det) < 1e-18) { miss++; continue; }
      for (let e = 0; e < 3; e++) {
        const vi = IDX[t * 3 + e], px = P[vi * 3], pz = P[vi * 3 + 2];
        const l2 = ((px - ax) * (qz - az) - (qx - ax) * (pz - az)) / det;
        const l3 = ((bx - ax) * (pz - az) - (px - ax) * (bz - az)) / det;
        const l1 = 1 - l2 - l3;
        const ni = P.length / 3;
        P.push(px, P[vi * 3 + 1], pz); N.push(N[vi * 3], N[vi * 3 + 1], N[vi * 3 + 2]);
        // ngoại suy ở mép mảng atlas có thể lọt ra ngoài [0,1] → kẹp lại (không thì quantize bỏ qua UV và lấy mẫu vòng sang mép kia)
        const cl = (v) => Math.min(1, Math.max(0, v));
        UV.push(cl(l1 * UV[A * 2] + l2 * UV[B * 2] + l3 * UV[C * 2]), cl(l1 * UV[A * 2 + 1] + l2 * UV[B * 2 + 1] + l3 * UV[C * 2 + 1]));
        IDX[t * 3 + e] = ni;
      }
      done++;
    }
    console.log(`  mặt dưới lấy texture mặt trên: ${done.toLocaleString()} tam giác dưới ← ${nTop.toLocaleString()} tam giác trên (bỏ sót ${miss})`);
  }
  const n2 = P.length / 3, isBottom2 = new Uint8Array(n2);
  for (let i = n; i < n2; i++) isBottom2[i] = 1; // các đỉnh mặt dưới mới (mang UV mặt trên)

  // 5) rốn lá từ texture mặt trên
  let navel = await findNavel(d, P, UV, n, isTop);
  if (navel && Math.hypot(navel.x, navel.z) > 0.35 * R) { console.log(`  rốn dò được quá xa tâm (${(Math.hypot(navel.x, navel.z) / R).toFixed(2)} R) → bỏ, cắm ở tâm`); navel = null; }
  const root = [navel ? navel.x : 0, mn[1], navel ? navel.z : 0];
  {
    // y mặt dưới quanh rốn: phân vị 15 % của đỉnh mặt dưới (pháp tuyến xuống) trong 0,12 R
    const ys = [];
    for (let i = 0; i < n; i++) if (isBottom[i] && Math.hypot(P[i * 3] - root[0], P[i * 3 + 2] - root[2]) < 0.12 * R) ys.push(P[i * 3 + 1]);
    ys.sort((a, b) => a - b);
    if (ys.length >= 5) root[1] = ys[Math.floor(ys.length * 0.15)];
  }
  console.log(navel ? `  rốn lá (texture): (${(navel.x / R).toFixed(3)}, ${(navel.z / R).toFixed(3)}) R, độ trội ${navel.strength.toFixed(1)}` : '  không dò được rốn từ texture → cắm cuống ở tâm');

  // 6) cuống mới (chỉ khi --stemLen > 0): ống trụ rủ xuống −Y, nghiêng dần về −Z
  const tubeStart = P.length / 3;
  const keep = IDX.slice();
  if (STEMLEN > 0) {
    const stemUV = await pickStemUV(d, isBottom2, UV, n2);
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const unit = (a) => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
    const down = [0, -1, 0], h = [0, 0, -1], nrm = [1, 0, 0];
    const l0 = (LEAN0 * Math.PI) / 180, l1 = (LEAN * Math.PI) / 180;
    const Lnew = STEMLEN * R, rNew = STEMR * R;
    const STEPS = 240, Cpts = [[root[0], root[1], root[2]]], Tans = [];
    for (let k = 0; k < STEPS; k++) {
      const f = (k + 0.5) / STEPS, th = l0 + (l1 - l0) * f;
      const T = unit([down[0] * Math.cos(th) + h[0] * Math.sin(th), down[1] * Math.cos(th) + h[1] * Math.sin(th), down[2] * Math.cos(th) + h[2] * Math.sin(th)]);
      Tans.push(T);
      const prev = Cpts[k];
      Cpts.push([prev[0] + T[0] * (Lnew / STEPS), prev[1] + T[1] * (Lnew / STEPS), prev[2] + T[2] * (Lnew / STEPS)]);
    }
    const frameAt = (sv) => {
      const k = Math.min(STEPS - 1, Math.max(0, Math.floor((sv / Lnew) * STEPS))), fr = Math.min(1, Math.max(0, (sv / Lnew) * STEPS - k));
      const c0 = Cpts[k], c1 = Cpts[k + 1];
      return { C: [c0[0] + (c1[0] - c0[0]) * fr, c0[1] + (c1[1] - c0[1]) * fr, c0[2] + (c1[2] - c0[2]) * fr], T: Tans[k], B: unit(cross(Tans[k], nrm)) };
    };
    const capL = 1.6 * rNew;
    const radiusAt = (sv) => {
      let r = rNew * (1 - 0.15 * (sv / Lnew));
      if (sv > Lnew - capL) r *= Math.sqrt(Math.max(0, 1 - ((sv - (Lnew - capL)) / capL) ** 2));
      return r;
    };
    const RINGS = Math.max(10, Math.round(Lnew / (0.45 * rNew))), SIDES = 14;
    const ringBase = P.length / 3;
    for (let k = -1; k <= RINGS; k++) {
      // vòng −1 lùi vào trong lá 0,35 bán kính ống để không hở kẽ ở mặt dưới (lá mỏng: không lùi sâu hơn)
      const sv = k < 0 ? 0 : (Lnew * k) / RINGS, F = frameAt(sv), r = k < 0 ? radiusAt(0) : radiusAt(sv);
      if (k < 0) F.C = [F.C[0] - F.T[0] * 0.35 * rNew, F.C[1] - F.T[1] * 0.35 * rNew, F.C[2] - F.T[2] * 0.35 * rNew];
      const dr = k === RINGS ? -1 : (radiusAt(Math.min(Lnew, sv + 1e-4)) - r) / 1e-4;
      for (let j = 0; j < SIDES; j++) {
        const a = (2 * Math.PI * j) / SIDES, cs = Math.cos(a), sn = Math.sin(a);
        const rad = [nrm[0] * cs + F.B[0] * sn, nrm[1] * cs + F.B[1] * sn, nrm[2] * cs + F.B[2] * sn];
        P.push(F.C[0] + rad[0] * r, F.C[1] + rad[1] * r, F.C[2] + rad[2] * r);
        const NN = unit([rad[0] - F.T[0] * dr, rad[1] - F.T[1] * dr, rad[2] - F.T[2] * dr]);
        N.push(NN[0], NN[1], NN[2]);
        UV.push(stemUV[0], stemUV[1]);
      }
    }
    const v = (i) => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]];
    const a0 = ringBase, b0 = ringBase + 1, c0 = ringBase + SIDES;
    const e1 = [v(c0)[0] - v(a0)[0], v(c0)[1] - v(a0)[1], v(c0)[2] - v(a0)[2]], e2 = [v(b0)[0] - v(a0)[0], v(b0)[1] - v(a0)[1], v(b0)[2] - v(a0)[2]];
    const fn = cross(e1, e2), outward = fn[0] * N[a0 * 3] + fn[1] * N[a0 * 3 + 1] + fn[2] * N[a0 * 3 + 2] > 0;
    for (let k = 0; k < RINGS + 1; k++) for (let j = 0; j < SIDES; j++) {
      const a = ringBase + k * SIDES + j, b = ringBase + k * SIDES + ((j + 1) % SIDES), c = a + SIDES, dd = b + SIDES;
      if (outward) keep.push(a, c, b, b, c, dd); else keep.push(a, b, c, b, dd, c);
    }
    console.log(`  cuống mới: ${RINGS} vòng × ${SIDES} cạnh, dài ${STEMLEN} R, bán kính ${STEMR} R, UV (${stemUV[0].toFixed(3)}, ${stemUV[1].toFixed(3)}) màu ${stemUV[2].map((v) => v | 0).join(',')}`);
  }
  const tubeCount = P.length / 3 - tubeStart;
  if (!tubeCount) console.log('  không dựng cuống (--stemLen 0): giữ lá như model gốc');

  // 7) chuẩn hoá: mặt dưới ở y = 0, tâm mặt lá ở gốc, R = 1
  const nAll = P.length / 3;
  for (let i = 0; i < nAll; i++) { P[i * 3] /= R; P[i * 3 + 1] = (P[i * 3 + 1] - root[1]) / R; P[i * 3 + 2] /= R; }
  prim.getAttribute('POSITION').setArray(Float32Array.from(P));
  prim.getAttribute('NORMAL')?.setArray(Float32Array.from(N));
  if (prim.getAttribute('TEXCOORD_0')) prim.getAttribute('TEXCOORD_0').setArray(Float32Array.from(UV));
  else prim.setAttribute('TEXCOORD_0', d.createAccessor().setType('VEC2').setArray(Float32Array.from(UV)).setBuffer(d.getRoot().listBuffers()[0]));
  prim.getIndices().setArray(Uint32Array.from(keep));
  let top = -Infinity, lowest = Infinity;
  for (let i = 0; i < nAll; i++) { if (i < n && P[i * 3 + 1] > top) top = P[i * 3 + 1]; if (P[i * 3 + 1] < lowest) lowest = P[i * 3 + 1]; }
  return {
    R: +R.toFixed(4), innerR: +(Rin / R).toFixed(3), innerOff: [+((cxi - cx) / R).toFixed(3), +((czi - cz) / R).toFixed(3)], thickWas: +(ext[1] / R).toFixed(3), thickNow: +top.toFixed(3), kThick: +kThick.toFixed(3),
    notchDeg, navel: navel ? { dx: +(navel.x / R).toFixed(3), dz: +(navel.z / R).toFixed(3), strength: +navel.strength.toFixed(1) } : null,
    stemLen: STEMLEN, lowest: +lowest.toFixed(3), flip: FLIP, locked: tubeCount ? [tubeStart, tubeStart + tubeCount] : null,
  };
}

// RỐN LÁ từ texture mặt trên (bản XZ của findNavel trong prepare-leaf.mjs): rasterize độ sáng texture của các
// đỉnh mặt trên (pháp tuyến hướng lên) lên lưới G×G trong mặt phẳng XZ; gân = ô tối hơn nền (lọc thông cao);
// hướng gân từ tensor cấu trúc; mỗi ô gân bỏ phiếu cho cả đường thẳng dọc hướng ấy; đỉnh phiếu = chỗ hội tụ.
async function findNavel(d, P, UV, n, isTop) {
  const tex = d.getRoot().listMaterials()[0]?.getBaseColorTexture();
  if (!tex) return null;
  const { data, info } = await sharp(Buffer.from(tex.getImage())).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const tw = info.width, th = info.height;
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let i = 0; i < n; i++) { const x = P[i * 3], z = P[i * 3 + 2]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; }
  const G = 200, cell = Math.max(x1 - x0, z1 - z0) / (G - 2);
  const sum = new Float64Array(G * G), cnt = new Uint32Array(G * G);
  for (let i = 0; i < n; i++) {
    if (!isTop[i]) continue; // chỉ mặt trên (pháp tuyến gốc hướng lên)
    const gx = Math.floor((P[i * 3] - x0) / cell) + 1, gy = Math.floor((P[i * 3 + 2] - z0) / cell) + 1;
    if (gx < 0 || gy < 0 || gx >= G || gy >= G) continue;
    const px = Math.min(tw - 1, Math.max(0, Math.round(UV[i * 2] * (tw - 1)))), py = Math.min(th - 1, Math.max(0, Math.round(UV[i * 2 + 1] * (th - 1))));
    const o = (py * tw + px) * 4;
    sum[gy * G + gx] += 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2];
    cnt[gy * G + gx]++;
  }
  const lum = new Float32Array(G * G), mask = new Uint8Array(G * G);
  for (let i = 0; i < G * G; i++) if (cnt[i]) { lum[i] = sum[i] / cnt[i]; mask[i] = 1; }
  for (let pass = 0; pass < 2; pass++) {
    const l2 = Float32Array.from(lum), m2 = Uint8Array.from(mask);
    for (let y = 1; y < G - 1; y++) for (let x = 1; x < G - 1; x++) {
      const i = y * G + x; if (mask[i]) continue;
      let s = 0, c = 0;
      for (const j of [i + 1, i - 1, i + G, i - G]) if (mask[j]) { s += lum[j]; c++; }
      if (c >= 3) { l2[i] = s / c; m2[i] = 1; }
    }
    lum.set(l2); mask.set(m2);
  }
  const blur = (src, r) => {
    const tmp = new Float32Array(G * G), out = new Float32Array(G * G);
    for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) { let s = 0, c = 0; for (let k = -r; k <= r; k++) { const xx = x + k; if (xx < 0 || xx >= G) continue; const j = y * G + xx; if (mask[j]) { s += src[j]; c++; } } tmp[y * G + x] = c ? s / c : 0; }
    for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) { let s = 0, c = 0; for (let k = -r; k <= r; k++) { const yy = y + k; if (yy < 0 || yy >= G) continue; const j = yy * G + x; if (mask[j]) { s += tmp[j]; c++; } } out[y * G + x] = c ? s / c : 0; }
    return out;
  };
  const base = blur(lum, 7), sm = blur(lum, 1), hp = new Float32Array(G * G);
  let mean = 0, mN = 0;
  for (let i = 0; i < G * G; i++) if (mask[i]) { hp[i] = lum[i] - base[i]; mean += hp[i]; mN++; }
  mean /= Math.max(1, mN);
  let varSum = 0;
  for (let i = 0; i < G * G; i++) if (mask[i]) varSum += (hp[i] - mean) ** 2;
  const sd = Math.sqrt(varSum / Math.max(1, mN)), thr = mean - 0.7 * sd;
  const gxA = new Float32Array(G * G), gyA = new Float32Array(G * G);
  for (let y = 1; y < G - 1; y++) for (let x = 1; x < G - 1; x++) { const i = y * G + x; if (!mask[i]) continue; gxA[i] = (sm[i + 1] - sm[i - 1]) / 2; gyA[i] = (sm[i + G] - sm[i - G]) / 2; }
  const Jxx = new Float32Array(G * G), Jxy = new Float32Array(G * G), Jyy = new Float32Array(G * G);
  for (let i = 0; i < G * G; i++) { Jxx[i] = gxA[i] * gxA[i]; Jxy[i] = gxA[i] * gyA[i]; Jyy[i] = gyA[i] * gyA[i]; }
  const Sxx = blur(Jxx, 2), Sxy = blur(Jxy, 2), Syy = blur(Jyy, 2), acc = new Float32Array(G * G);
  for (let y = 1; y < G - 1; y++) for (let x = 1; x < G - 1; x++) {
    const i = y * G + x;
    if (!mask[i] || hp[i] > thr) continue;
    const a = Sxx[i], b = Sxy[i], c = Syy[i], tr = a + c;
    if (tr < 1e-6) continue;
    const coh = Math.sqrt((a - c) * (a - c) + 4 * b * b) / tr;
    if (coh < 0.25) continue;
    const tg = 0.5 * Math.atan2(2 * b, a - c), dx = -Math.sin(tg), dy = Math.cos(tg);
    const w = (thr - hp[i]) * coh;
    for (let t = -G; t <= G; t++) { const xx = Math.round(x + dx * t), yy = Math.round(y + dy * t); if (xx < 0 || yy < 0 || xx >= G || yy >= G) continue; acc[yy * G + xx] += w; }
  }
  const accS = blur(acc, 3);
  let best = -1, bi = -1, am = 0, ac = 0;
  for (let i = 0; i < G * G; i++) if (mask[i]) { am += accS[i]; ac++; if (accS[i] > best) { best = accS[i]; bi = i; } }
  am /= Math.max(1, ac);
  if (bi < 0 || best < 2.5 * am) return null;
  return { x: x0 + ((bi % G) - 1 + 0.5) * cell, z: z0 + (Math.floor(bi / G) - 1 + 0.5) * cell, strength: best / am };
}

// Màu cuống: atlas Tripo là mớ mảng xanh vỡ vụn, lấy UV bừa thì vớ phải mảng vàng. Lấy màu trung bình của
// mặt dưới lá (texture tại các đỉnh pháp tuyến xuống), sẫm đi một chút, rồi tìm ô 8×8 (trên bản 256²) ĐỒNG
// MÀU gần màu ấy nhất → tâm ô làm UV chung cho mọi đỉnh ống.
async function pickStemUV(d, isBottom, UV, n) {
  const tex = d.getRoot().listMaterials()[0]?.getBaseColorTexture();
  if (!tex) return [0.5, 0.5, [0, 0, 0]];
  const S = 256;
  const { data } = await sharp(Buffer.from(tex.getImage())).resize(S, S, { fit: 'fill' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const px = (u) => Math.min(S - 1, Math.max(0, Math.round(u * (S - 1))));
  let r = 0, g = 0, b = 0, c = 0;
  for (let i = 0; i < n; i += 5) {
    if (!isBottom[i]) continue;
    const o = (px(UV[i * 2 + 1]) * S + px(UV[i * 2])) * 4; r += data[o]; g += data[o + 1]; b += data[o + 2]; c++;
  }
  if (!c) return [0.5, 0.5, [0, 0, 0]];
  const target = [(r / c) * 0.78, (g / c) * 0.86, (b / c) * 0.78];
  const B = 8; let best = Infinity, bu = 0.5, bv = 0.5;
  for (let by = 0; by + B <= S; by += 4) for (let bx = 0; bx + B <= S; bx += 4) {
    let mr = 0, mg = 0, mb = 0;
    for (let y = by; y < by + B; y++) for (let x = bx; x < bx + B; x++) { const o = (y * S + x) * 4; mr += data[o]; mg += data[o + 1]; mb += data[o + 2]; }
    const k = B * B; mr /= k; mg /= k; mb /= k;
    let sd = 0;
    for (let y = by; y < by + B; y++) for (let x = bx; x < bx + B; x++) { const o = (y * S + x) * 4; sd += (data[o] - mr) ** 2 + (data[o + 1] - mg) ** 2 + (data[o + 2] - mb) ** 2; }
    sd = Math.sqrt(sd / k);
    const dist = Math.hypot(mr - target[0], mg - target[1], mb - target[2]) + 2 * sd;
    if (dist < best) { best = dist; bu = (bx + B / 2) / S; bv = (by + B / 2) / S; }
  }
  return [bu, bv, target];
}

/* ------------------------------------------------------------------ rút gọn / tiện ích (như prepare-leaf.mjs) */
function simplifyPermissive(d, targetTris, lockRange) {
  for (const m of d.getRoot().listMeshes()) for (const p of m.listPrimitives()) {
    const pos = p.getAttribute('POSITION').getArray(), uv = p.getAttribute('TEXCOORD_0')?.getArray();
    const idx = p.getIndices();
    const src = idx ? idx.getArray() : Uint32Array.from({ length: pos.length / 3 }, (_, i) => i);
    const idx32 = src instanceof Uint32Array ? src : Uint32Array.from(src);
    const locked = new Uint8Array(pos.length / 3);
    if (lockRange) for (let i = lockRange[0]; i < lockRange[1]; i++) locked[i] = 1;
    const [out, err] = uv
      ? MeshoptSimplifier.simplifyWithAttributes(idx32, pos, 3, uv, 2, [1.5, 1.5], locked, targetTris * 3, 0.3, ['Prune', 'Permissive'])
      : MeshoptSimplifier.simplify(idx32, pos, 3, targetTris * 3, 0.3, ['Prune', 'Permissive']);
    if (idx) idx.setArray(Uint32Array.from(out));
    else p.setIndices(d.createAccessor().setType('SCALAR').setArray(Uint32Array.from(out)).setBuffer(d.getRoot().listBuffers()[0]));
    compactPrimitive(p);
    console.log(`  rút gọn: sai số ${(+err).toFixed(4)}`);
  }
}
function dropDegenerate() {
  return (d) => {
    for (const m of d.getRoot().listMeshes()) for (const p of m.listPrimitives()) {
      const idx = p.getIndices(); if (!idx) continue;
      const a = idx.getArray(), out = [];
      for (let k = 0; k < a.length; k += 3) if (a[k] !== a[k + 1] && a[k + 1] !== a[k + 2] && a[k] !== a[k + 2]) out.push(a[k], a[k + 1], a[k + 2]);
      const cnt = p.getAttribute('POSITION').getCount();
      idx.setArray(cnt <= 65535 ? Uint16Array.from(out) : Uint32Array.from(out));
    }
  };
}
function countTris(d) {
  let n = 0;
  for (const m of d.getRoot().listMeshes()) for (const p of m.listPrimitives()) { const idx = p.getIndices(); n += (idx ? idx.getCount() : p.getAttribute('POSITION').getCount()) / 3; }
  return n;
}

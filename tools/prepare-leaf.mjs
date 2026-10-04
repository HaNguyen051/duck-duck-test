// Chuẩn bị 4 model lá sen (Tripo sinh từ ảnh lá vẽ) cho web. Model gốc là một tấm mỏng ĐỨNG trong mặt
// phẳng XY (như ảnh): mặt lá hình đĩa lệch về −X, cuống chĩa ngang sang +X. Script này:
//   1. nướng biến đổi node, hàn, rút gọn lưới;
//   2. tìm tâm và bán kính mặt lá (đường tròn nội tiếp lớn nhất của hình chiếu lên XY);
//   3. nhận diện cuống (ống tròn quanh một trục, cắm vào giữa mặt dưới lá). Trong model cuống gần như nằm
//      cùng mặt phẳng lá (chúi 0–20°) và uốn lượn gấp khúc — để nguyên thì nó nổi ngang trên mặt nước,
//      xoay cứng thì lộ khuỷu. Nên PHỦ LẠI cuống lên một đường trục mới trơn (giữ nguyên lưới + texture,
//      chỉ đổi đường trục): từ gốc đi gần thẳng đứng xuống (`--lean0`), cong nhẹ dần tới `--lean` độ ở
//      ngọn về phía dưới màn hình — như cuống sen thật, người dùng muốn "thẳng hoặc cong tự nhiên";
//   4. xoay cả lá nằm ngang: mặt lá vào mặt phẳng XZ, phía có cuống thành mặt DƯỚI (cuống chĩa −Y, xuống
//      nước); xoay quanh trục đứng cho cuống nghiêng về −Z (trên màn hình: xuống dưới, mọi lá cùng hướng);
//      đưa tâm mặt lá về gốc toạ độ, bán kính mặt lá = 1;
//   5. bỏ texture metallic-roughness (không dùng), thu basecolor/normal về 1024, quantize + meshopt.
// Chạy: cd tools && node prepare-leaf.mjs ~/Downloads/la_1.glb ../models/la_1.glb [--tris 24000] [--flatten 0.3] [--lean0 4] [--lean 18] [--stem 0.65] [--flip]
//   --flip: đảo chiều lật tự động (bình thường phía có cuống là mặt dưới).
//   --flatten k: ép độ cong của mặt lá về k lần (1 = giữ nguyên). Mặt lá Tripo cong như cái bát (sâu tới
//     0,8–1,3 lần bán kính!) nên mặc định 0,3; cuống không bị ép. Script in `bladeCurve` (độ cong / bán kính).
//   --lean0 / --lean deg: độ nghiêng của cuống so với phương thẳng đứng ở gốc / ở ngọn (cong đều giữa hai
//     giá trị), về phía dưới màn hình. Bằng nhau = cuống thẳng.
//   --stem k: rút cuống về k lần chiều dài — cuống Tripo dài 2–3 lần bán kính lá, hơi lố.
//   --stemR r: bán kính ống cuống mới, theo bán kính lá (mặc định 0,045) — thống nhất cho mọi lá.
//
// Rút gọn lưới gọi thẳng meshoptimizer với cờ Prune + Permissive: lưới Tripo vỡ thành hàng vạn mảnh rời
// (la_1: 23.455 mảnh), bộ rút gọn mặc định giữ nguyên mọi mép mảnh nên kẹt ở ~20% dù nới sai số bao
// nhiêu; Permissive cho gộp qua mép, Prune bỏ mảnh vụn. UV được tính vào sai số để không lem texture.
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
if (!src || !dst) { console.error('Dùng: node prepare-leaf.mjs <nguồn.glb> <đích.glb> [--ratio 0.02] [--error 0.01] [--flip]'); process.exit(1); }
const TRIS = flag('--tris', 24000), FLATTEN = flag('--flatten', 0.3), LEAN0 = flag('--lean0', 4), LEAN = flag('--lean', 18), STEM = flag('--stem', 0.65), STEMR = flag('--stemR', 0.045), FLIP = has('--flip');

await MeshoptSimplifier.ready; await MeshoptEncoder.ready; await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });

const doc = await io.read(src);
const before = countTris(doc);
await doc.transform(flatten());
for (const node of doc.getRoot().listNodes()) if (node.getMesh()) clearNodeTransform(node);
await doc.transform(weld());
// Đo và nắn hình TRÊN LƯỚI DÀY rồi mới rút gọn: đường tròn nội tiếp tìm trên lưới chiếu, lưới thưa thì
// hình chiếu thủng lỗ và vòng tròn tìm được bé đi, lệch tâm.
const info = await reshape(doc, FLIP, FLATTEN, LEAN0, LEAN, STEM, STEMR);
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

/* ------------------------------------------------------------------ rút gọn */
function simplifyPermissive(d, targetTris, lockRange) {
  for (const m of d.getRoot().listMeshes()) for (const p of m.listPrimitives()) {
    const pos = p.getAttribute('POSITION').getArray(), uv = p.getAttribute('TEXCOORD_0')?.getArray();
    const idx = p.getIndices();
    const src = idx ? idx.getArray() : Uint32Array.from({ length: pos.length / 3 }, (_, i) => i);
    const idx32 = src instanceof Uint32Array ? src : Uint32Array.from(src);
    // khoá đỉnh ống cuống (đã sạch và thưa sẵn) để bộ rút gọn không bóp méo nó
    const locked = new Uint8Array(pos.length / 3);
    if (lockRange) for (let i = lockRange[0]; i < lockRange[1]; i++) locked[i] = 1;
    const [out, err] = uv
      ? MeshoptSimplifier.simplifyWithAttributes(idx32, pos, 3, uv, 2, [1.5, 1.5], locked, targetTris * 3, 0.3, ['Prune', 'Permissive'])
      : MeshoptSimplifier.simplify(idx32, pos, 3, targetTris * 3, 0.3, ['Prune', 'Permissive']);
    if (idx) idx.setArray(Uint32Array.from(out));
    else p.setIndices(d.createAccessor().setType('SCALAR').setArray(Uint32Array.from(out)).setBuffer(d.getRoot().listBuffers()[0]));
    compactPrimitive(p); // bỏ đỉnh không còn ai dùng
    console.log(`  rút gọn: sai số ${(+err).toFixed(4)}`);
  }
}

/* ------------------------------------------------------------------ hình học */
// Model gốc (Tripo, từ ảnh vẽ): mặt lá là một đĩa trong mặt phẳng XY; cuống CẮM VÀO GIỮA MẶT DƯỚI lá
// (lá sen hình khiên) rồi chúi chéo ra khỏi mặt phẳng lá về một phía Z. Không đụng vào cuống: chỉ nhận
// diện nó (trụ tròn quanh một trục) để không ép phẳng, rồi xoay cả lá cho cuống chĩa xuống (−Y) và
// nghiêng về −Z (trên màn hình là xuống dưới, cùng hướng mọi lá).
async function reshape(d, flip, flatten, lean0Deg, lean1Deg, stemScale, stemR) {
  const prims = d.getRoot().listMeshes().flatMap((m) => m.listPrimitives());
  if (prims.length !== 1) throw new Error('Script chỉ xử lý model một primitive');
  const prim = prims[0];
  const P = [], N = [], UV = [];
  {
    const a = prim.getAttribute('POSITION').getArray(), nr = prim.getAttribute('NORMAL')?.getArray(), uv = prim.getAttribute('TEXCOORD_0')?.getArray();
    for (let i = 0; i < a.length; i += 3) { P.push(a[i], a[i + 1], a[i + 2]); N.push(nr ? nr[i] : 0, nr ? nr[i + 1] : 0, nr ? nr[i + 2] : 1); }
    for (let i = 0; i < a.length / 3; i++) UV.push(uv ? uv[i * 2] : 0, uv ? uv[i * 2 + 1] : 0);
  }
  const n = P.length / 3;
  const IDX = prim.getIndices() ? Array.from(prim.getIndices().getArray()) : Array.from({ length: n }, (_, i) => i);

  // 1) đường tròn nội tiếp lớn nhất của hình chiếu XY → tâm và bán kính mặt lá
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < n; i++) { const x = P[i * 3], y = P[i * 3 + 1]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  const G = 0.01, cols = Math.ceil((x1 - x0) / G) + 2, rows = Math.ceil((y1 - y0) / G) + 2;
  const occ = new Uint8Array(cols * rows);
  for (let i = 0; i < n; i++) occ[(Math.floor((P[i * 3 + 1] - y0) / G) + 1) * cols + Math.floor((P[i * 3] - x0) / G) + 1] = 1;
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
  const cx = x0 + ((bi % cols) - 1 + 0.5) * G, cy = y0 + (Math.floor(bi / cols) - 1 + 0.5) * G, R = best * G;

  // 2) cuống: hạt giống = đỉnh rơi vào ô MẢNH của hình chiếu — ô có mặt mà trong bán kính 4 ô quanh nó
  //    không có ô nào "dày" (cách mép ≥ 4 ô). Mép mặt lá cũng mỏng nhưng kề vùng dày nên không tính;
  //    phần cuống nằm dưới mặt lá thì chiếu trùng vào vùng dày nên cũng không — đoạn đó lấy sau bằng ống.
  //    (Lấy "ngoài đường tròn nội tiếp" làm hạt giống là sai: mặt lá không tròn, phần lớn lá nằm ngoài đó.)
  const thin = new Uint8Array(cols * rows);
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const i = y * cols + x;
    if (!occ[i]) continue;
    let maxd = 0;
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const yy = y + dy, xx = x + dx;
      if (yy < 0 || xx < 0 || yy >= rows || xx >= cols) continue;
      const v = dist[yy * cols + xx]; if (v < 1e8 && v > maxd) maxd = v;
    }
    if (maxd < 4) thin[i] = 1;
  }
  // Các ô mảnh gom thành từng mảng liên thông; cuống là mảng DÀI NHẤT (vươn xa tâm lá nhất), còn mép lá
  // răng cưa hay lỗ thủng chỉ là những mảng nhỏ rời rạc — lấy nhầm chúng là trục cuống khớp sai hết.
  const comp = new Int32Array(cols * rows).fill(-1);
  const compReach = [];
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const i0 = y * cols + x;
    if (!thin[i0] || comp[i0] >= 0) continue;
    const id = compReach.length, stack = [i0]; comp[i0] = id;
    let reach = 0, count = 0;
    while (stack.length) {
      const i = stack.pop(), yy = Math.floor(i / cols), xx = i % cols; count++;
      reach = Math.max(reach, Math.hypot(x0 + (xx - 0.5) * G - cx, y0 + (yy - 0.5) * G - cy));
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const nx = xx + dx, ny = yy + dy; if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        const j = ny * cols + nx; if (thin[j] && comp[j] < 0) { comp[j] = id; stack.push(j); }
      }
    }
    compReach.push(count >= 6 ? reach : 0);
  }
  let stemComp = 0;
  for (let c = 1; c < compReach.length; c++) if (compReach[c] > compReach[stemComp]) stemComp = c;
  let seeds = [];
  for (let i = 0; i < n; i++) {
    const cell = (Math.floor((P[i * 3 + 1] - y0) / G) + 1) * cols + Math.floor((P[i * 3] - x0) / G) + 1;
    if (comp[cell] === stemComp && Math.hypot(P[i * 3] - cx, P[i * 3 + 1] - cy) > R * 0.9) seeds.push(i);
  }
  if (seeds.length < 50) throw new Error('Không thấy cuống (vùng mảnh) trên hình chiếu — kiểm tra lại model');
  // Khớp đường thẳng (PCA) qua hạt giống → trục cuống, lặp 3 lần bỏ hạt giống lạc xa trục (mép lá răng
  // cưa cũng "mảnh"); rồi đỉnh nào nằm trong ống quanh trục (bán kính 2,5 lần bán kính cuống), từ tâm lá
  // ra tới chóp, là cuống — kể cả đoạn nằm dưới mặt lá.
  const mean3 = (ids) => { const m = [0, 0, 0]; for (const i of ids) for (let k = 0; k < 3; k++) m[k] += P[i * 3 + k] / ids.length; return m; };
  let p0, dir = [1, 0, 0], distAxis, rt;
  for (let pass = 0; pass < 3; pass++) {
    p0 = mean3(seeds);
    const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (const i of seeds) for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) C[r][c] += (P[i * 3 + r] - p0[r]) * (P[i * 3 + c] - p0[c]);
    for (let it = 0; it < 60; it++) { const v = [0, 1, 2].map((r) => C[r][0] * dir[0] + C[r][1] * dir[1] + C[r][2] * dir[2]); const l = Math.hypot(...v) || 1; dir = v.map((x) => x / l); }
    distAxis = (i) => { const vx = P[i * 3] - p0[0], vy = P[i * 3 + 1] - p0[1], vz = P[i * 3 + 2] - p0[2]; const t = vx * dir[0] + vy * dir[1] + vz * dir[2]; return Math.hypot(vx - t * dir[0], vy - t * dir[1], vz - t * dir[2]); };
    const rads = seeds.map(distAxis).sort((a, b) => a - b);
    rt = rads[rads.length >> 1];
    if (pass < 2) seeds = seeds.filter((i) => distAxis(i) < rt * 2.5);
  }
  // hướng từ tâm lá ra chóp cuống
  let tipT = 0, tipI = seeds[0];
  for (const i of seeds) { const t = (P[i * 3] - cx) * dir[0] + (P[i * 3 + 1] - cy) * dir[1] + P[i * 3 + 2] * dir[2]; if (Math.abs(t) > Math.abs(tipT)) { tipT = t; tipI = i; } }
  if (tipT < 0) dir = dir.map((x) => -x);
  console.log(`  cuống: ${seeds.length} hạt giống, bán kính ${(rt / R).toFixed(3)} R, trục (${dir.map((v) => v.toFixed(2)).join(', ')})`);
  const tAxis = (i) => (P[i * 3] - p0[0]) * dir[0] + (P[i * 3 + 1] - p0[1]) * dir[1] + (P[i * 3 + 2] - p0[2]) * dir[2];
  const tCentre = (cx - p0[0]) * dir[0] + (cy - p0[1]) * dir[1] + (zc0() - p0[2]) * dir[2], tTip = tAxis(tipI);
  // Cuống cong, đường thẳng không ôm hết: chia theo t thành đoạn dài 2·rt, lấy trọng tâm ứng viên (trong
  // ống rộng 4·rt quanh đường thẳng) của từng đoạn → ĐƯỜNG GẤP KHÚC; thành viên = cách đường ấy < 2,5·rt.
  // Trục cũ = ĐA THỨC BẬC 3 theo t khớp bình phương tối thiểu qua mọi ứng viên (trong ống rộng 4·rt quanh
  // đường thẳng). Không chia đốt lấy trọng tâm: đoạn cuống nằm dưới mặt lá có lưới lá sát trục kéo trọng
  // tâm lệch đi, đoạn ngoài thì không → trục gãy đúng chỗ cuống chui ra khỏi mép lá, phủ sang trục mới
  // thành bậc thang. Đa thức thì độ lệch ấy chỉ còn là trôi mượt, mắt không thấy.
  const tLo = tCentre - 2 * rt, tHi = tTip + 2 * rt, tSpan = tHi - tLo || 1;
  const A = Array.from({ length: 4 }, () => [0, 0, 0, 0]), B = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
  for (let i = 0; i < n; i++) {
    if (distAxis(i) >= 4 * rt) continue;
    const t = tAxis(i); if (t < tLo || t > tHi) continue;
    const u = (t - tLo) / tSpan, basis = [1, u, u * u, u * u * u];
    for (let r = 0; r < 4; r++) { for (let c = 0; c < 4; c++) A[r][c] += basis[r] * basis[c]; for (let k = 0; k < 3; k++) B[k][r] += basis[r] * P[i * 3 + k]; }
  }
  const solve = (M, v) => { // Gauss với trụ, 4×4
    const m = M.map((row, r) => [...row, v[r]]);
    for (let c = 0; c < 4; c++) {
      let piv = c; for (let r = c + 1; r < 4; r++) if (Math.abs(m[r][c]) > Math.abs(m[piv][c])) piv = r;
      [m[c], m[piv]] = [m[piv], m[c]];
      for (let r = 0; r < 4; r++) { if (r === c || !m[c][c]) continue; const f = m[r][c] / m[c][c]; for (let k = c; k <= 4; k++) m[r][k] -= f * m[c][k]; }
    }
    return m.map((row, r) => (row[r] ? row[4] / row[r] : 0));
  };
  const coef = [0, 1, 2].map((k) => solve(A, B[k]));
  const evalCubic = (t) => { const u = (t - tLo) / tSpan; return coef.map((c) => c[0] + c[1] * u + c[2] * u * u + c[3] * u * u * u); };
  // lấy mẫu dày thành đường gấp khúc mịn; poly[1] ≈ điểm ở tâm lá (gốc cuống)
  const NS = 48, poly = [];
  for (let k = 0; k <= NS; k++) poly.push(evalCubic(tCentre - rt + ((tTip + rt) - (tCentre - rt)) * (k / NS)));
  const segDist = (q, a, b) => {
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], aq = [q[0] - a[0], q[1] - a[1], q[2] - a[2]];
    const l2 = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2] || 1e-12;
    const u = Math.max(0, Math.min(1, (aq[0] * ab[0] + aq[1] * ab[1] + aq[2] * ab[2]) / l2));
    return Math.hypot(q[0] - a[0] - ab[0] * u, q[1] - a[1] - ab[1] * u, q[2] - a[2] - ab[2] * u);
  };
  // khoảng cách tới đường gấp khúc, và vị trí dọc theo nó (chiều dài tích luỹ) để lấy trọng số xoay
  const segLen = poly.slice(1).map((b, k) => Math.hypot(b[0] - poly[k][0], b[1] - poly[k][1], b[2] - poly[k][2]));
  const cum = [0]; for (const l of segLen) cum.push(cum[cum.length - 1] + l);
  const polyInfo = (i) => {
    const q = [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]]; let m = Infinity, at = 0, seg = 0, near = q;
    for (let b = 0; b < poly.length - 1; b++) {
      const a = poly[b], c = poly[b + 1], ab = [c[0] - a[0], c[1] - a[1], c[2] - a[2]], aq = [q[0] - a[0], q[1] - a[1], q[2] - a[2]];
      const l2 = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2] || 1e-12;
      const u = Math.max(0, Math.min(1, (aq[0] * ab[0] + aq[1] * ab[1] + aq[2] * ab[2]) / l2));
      const dd = Math.hypot(q[0] - a[0] - ab[0] * u, q[1] - a[1] - ab[1] * u, q[2] - a[2] - ab[2] * u);
      if (dd < m) { m = dd; at = cum[b] + segLen[b] * u; seg = b; near = [a[0] + ab[0] * u, a[1] + ab[1] * u, a[2] + ab[2] * u]; }
    }
    return [m, at, seg, near];
  };
  let seg = 0, near = null;
  const distPoly = (i) => polyInfo(i)[0];
  const isStem = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const t = tAxis(i);
    if (t >= tCentre - 2 * rt && t <= tTip + 2 * rt && distPoly(i) < Math.max(2.5 * rt, 0.012)) isStem[i] = 1;
  }
  function zc0() { // z của mặt lá quanh tâm, chưa loại cuống (chỉ để chặn trục)
    const zs = []; for (let i = 0; i < n; i++) if (Math.hypot(P[i * 3] - cx, P[i * 3 + 1] - cy) < R * 0.3) zs.push(P[i * 3 + 2]);
    zs.sort((a, b) => a - b); return zs.length ? zs[zs.length >> 1] : 0;
  }
  // z của cuống so với mặt lá ở tâm: quyết định mặt nào là mặt dưới
  const zBlade = [];
  for (let i = 0; i < n; i++) if (!isStem[i] && Math.hypot(P[i * 3] - cx, P[i * 3 + 1] - cy) < R * 0.3) zBlade.push(P[i * 3 + 2]);
  zBlade.sort((a, b) => a - b);
  const zc = zBlade.length ? zBlade[zBlade.length >> 1] : 0;
  // mặt dưới = phía z có cuống, đo ở đoạn cuống gần gốc (chóp không tin được vì cuống gần nằm ngang)
  let zr = 0, nr = 0;
  for (let i = 0; i < n; i++) if (isStem[i]) { const t = tAxis(i); if (t >= tCentre && t < tCentre + 0.8 * R) { zr += P[i * 3 + 2]; nr++; } }
  const stemSide = nr ? Math.sign(zr / nr - zc) || -1 : Math.sign(P[tipI * 3 + 2] - zc) || -1;
  // độ cong của mặt lá (không tính cuống)
  let zb0 = Infinity, zb1 = -Infinity;
  for (let i = 0; i < n; i++) if (!isStem[i] && Math.hypot(P[i * 3] - cx, P[i * 3 + 1] - cy) <= R) { const z = P[i * 3 + 2]; if (z < zb0) zb0 = z; if (z > zb1) zb1 = z; }

  // 3) ép phẳng mặt lá quanh z ở tâm (gốc cuống đứng yên nên không hở), cuống giữ nguyên
  if (flatten < 1) for (let i = 0; i < n; i++) {
    if (isStem[i]) continue;
    const r = Math.hypot(P[i * 3] - cx, P[i * 3 + 1] - cy);
    const w = r <= R ? 1 : Math.max(0, 1 - (r - R) / (R * 0.25));
    const k = 1 - (1 - flatten) * w;
    P[i * 3 + 2] = zc + (P[i * 3 + 2] - zc) * k;
    const nx = N[i * 3] * k, ny = N[i * 3 + 1] * k, nz = N[i * 3 + 2];
    const l = Math.hypot(nx, ny, nz) || 1;
    N[i * 3] = nx / l; N[i * 3 + 1] = ny / l; N[i * 3 + 2] = nz / l;
  }

  // 3b) Thay cuống: lưới cuống của Tripo méo, dẹt, đứt đoạn — phủ lên trục mới kiểu gì cũng còn gồ ghề.
  //     Nên XOÁ hết tam giác thuộc riêng cuống, chỉ giữ các tam giác tiếp giáp với lá (có đỉnh không phải
  //     cuống); đỉnh cuống còn lại trong các tam giác ấy được ép lên vòng đầu của ống mới. Rồi DỰNG ỐNG TRỤ
  //     MỚI dọc đường trục C(s): gốc giữa mặt dưới lá, đi xuống nghiêng dần từ lean0 tới lean1 về hướng
  //     ngang ban đầu h của cuống, thon 15% về ngọn, đầu bo tròn. Texture = một điểm trên atlas lấy ở giữa
  //     cuống cũ (màu cuống đều), nên các đỉnh ống dùng chung UV.
  let tubeStart = n, tubeCount = 0, navelInfo = null;
  {
    const hl0 = Math.hypot(dir[0], dir[1]) || 1, h = [dir[0] / hl0, dir[1] / hl0, 0];
    const down = [0, 0, stemSide];
    const nrm = [h[1] * stemSide, -h[0] * stemSide, 0];
    const l0 = (lean0Deg * Math.PI) / 180, l1 = (lean1Deg * Math.PI) / 180;
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const unit = (a) => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
    // tam giác: bỏ tam giác chỉ toàn đỉnh cuống; giữ tam giác tiếp giáp (có đỉnh không phải cuống)
    const keep = [];
    for (let k = 0; k < IDX.length; k += 3) {
      const a = IDX[k], b = IDX[k + 1], c = IDX[k + 2];
      if (isStem[a] && isStem[b] && isStem[c]) continue;
      keep.push(a, b, c);
    }
    const used = new Uint8Array(n); for (const i of keep) used[i] = 1;
    // GỐC ỐNG = RỐN LÁ: trong các đỉnh cuống thuộc tam giác tiếp giáp (cổ), lấy những đỉnh ở đầu cuống
    // (t nhỏ nhất, trong 1,5·rt) — đó là chỗ cuống bắt đầu từ mặt dưới lá. Ở lá 1 cuống bám dọc mặt dưới
    // một đoạn dài trước khi thò ra, cổ trải dài theo đoạn ấy: lấy trọng tâm cả cổ thì gốc rơi vào giữa
    // đoạn bám, lệch khỏi rốn; lấy điểm trên trục khớp thì lệch kiểu khác (trục bị lưới lá kéo).
    const collar = [];
    for (let i = 0; i < n; i++) if (isStem[i] && used[i]) collar.push(i);
    let tMin = Infinity;
    for (const i of collar) tMin = Math.min(tMin, tAxis(i));
    // GỐC ỐNG: xy = trọng tâm các ĐỈNH CUỐNG ở đầu cuống (t ≤ tMin + 1,5·rt) — đúng trục cuống tại ổ;
    // z = mép ngoài cùng của VÀNH Ổ (đỉnh lá kề các đỉnh cuống ấy) về phía có cuống — ngay trên mặt dưới lá.
    // Lấy xy theo vành ổ thì lệch sang bên (cuống bám lá một phía nên vành lệch) → lá 2 cuống cắm sai tâm;
    // lấy z theo đỉnh cuống thì gốc nằm dưới mặt lá ~rt → chỗ nối thành cái nón.
    const tCut = tMin + 1.5 * rt, rim = new Set();
    let root = [0, 0, 0], nRoot = 0;
    for (const i of collar) if (tAxis(i) <= tCut) { root[0] += P[i * 3]; root[1] += P[i * 3 + 1]; root[2] += P[i * 3 + 2]; nRoot++; }
    root = nRoot ? root.map((v) => v / nRoot) : [poly[1][0], poly[1][1], poly[1][2]];
    for (let k = 0; k < keep.length; k += 3) {
      const tri = [keep[k], keep[k + 1], keep[k + 2]];
      if (!tri.some((i) => isStem[i])) continue;
      if (tri.some((i) => isStem[i] && tAxis(i) > tCut)) continue;
      for (const i of tri) if (!isStem[i]) rim.add(i);
    }
    // mép vành: phân vị 85% về phía cuống (không lấy cực trị, kẻo một đỉnh lạc kéo gốc xuống dưới lá)
    const rimZ = [...rim].map((i) => P[i * 3 + 2]).sort((a, b) => a - b);
    if (rimZ.length) root[2] = rimZ[Math.round((stemSide > 0 ? 0.85 : 0.15) * (rimZ.length - 1))];
    // Ổ cuống của LƯỚI (tâm vành) — chỉ để đặt đĩa bịt lỗ, KHÔNG dùng làm chỗ cắm cuống nữa.
    let hole = null;
    if (rim.size) { hole = [0, 0, root[2]]; for (const i of rim) { hole[0] += P[i * 3] / rim.size; hole[1] += P[i * 3 + 1] / rim.size; } }
    // RỐN LÁ theo TEXTURE: chỗ các gân lá hội tụ (bỏ phiếu đường thẳng qua các điểm gân tối, findNavel).
    // Ổ cuống của lưới Tripo lệch khỏi rốn tới 0,2–0,5 R (lá 1, lá 2) nên cắm cuống vào ổ là người dùng
    // thấy ngay "cuống gắn vào chỗ không phải tâm". Cuống cắm ở rốn, mặt dưới lá ở đó còn nguyên (không lỗ).
    const navel = await findNavel(d, P, N, UV, isStem, n, stemSide);
    if (navel) {
      const zs = [];
      for (let i = 0; i < n; i++) if (!isStem[i] && Math.hypot(P[i * 3] - navel.x, P[i * 3 + 1] - navel.y) < 0.12 * R) zs.push(P[i * 3 + 2]);
      zs.sort((a, b) => a - b);
      root = [navel.x, navel.y, zs.length >= 5 ? zs[Math.round((stemSide > 0 ? 0.85 : 0.15) * (zs.length - 1))] : root[2]];
      navelInfo = { dx: +((navel.x - cx) / R).toFixed(3), dy: +((navel.y - cy) / R).toFixed(3), strength: +navel.strength.toFixed(1) };
    }
    // chiều dài cuống cũ → mới
    let Lold = 0;
    for (let i = 0; i < n; i++) if (isStem[i]) Lold = Math.max(Lold, polyInfo(i)[1] - cum[1]);
    const Lnew = Math.max(rt * 4, Lold * stemScale), rNew = stemR * R; // bề dày thống nhất cho mọi lá (cuống Tripo dày mỏng mỗi lá một kiểu)
    // đường trục mới
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
    // UV đại diện của cuống: trung vị UV các đỉnh cuống ở nửa giữa (tránh mép atlas)
    const su = [], sv2 = [];
    for (let i = 0; i < n; i++) if (isStem[i]) { su.push(UV[i * 2]); sv2.push(UV[i * 2 + 1]); }
    su.sort((a, b) => a - b); sv2.sort((a, b) => a - b);
    const stemUV = [su[su.length >> 1] ?? 0.5, sv2[sv2.length >> 1] ?? 0.5];

    // Tam giác cổ (nối lá với cuống) chỉ giữ ở GẦN RỐN (mọi đỉnh cuống của nó có t ≤ tMin + 2,5·rt): các đỉnh
    // cuống ấy ép lên vòng đầu ống → thành cái phễu phẳng bịt kín lỗ ổ cuống trên mặt lá quanh ống. Tam
    // giác cổ ở xa hơn (dọc đoạn cuống bám mặt dưới lá, lá 1) thì BỎ: giữ mà ép lên ống thì quạt thành cái
    // nêm = "khuỷu"; ép vào mặt lá thì phễu sụp, lỗ ổ cuống hở ra trời (đã thử cả hai). Mặt lá dưới đoạn
    // bám không thủng vì tam giác mặt lá toàn đỉnh lá, vẫn giữ.
    // Bỏ HẾT tam giác cổ (có đỉnh cuống) — không làm phễu nữa, phễu kiểu gì cũng để lại dấu (nêm, nón,
    // mảng lệch màu — xem CLAUDE.md). Lỗ ổ cuống còn lại trên mặt lá được KHÂU KÍN bên dưới.
    {
      const kept = [];
      for (let k = 0; k < keep.length; k += 3) {
        const a = keep[k], b = keep[k + 1], c = keep[k + 2];
        if (isStem[a] || isStem[b] || isStem[c]) continue;
        kept.push(a, b, c);
      }
      for (let k = 0; k < kept.length; k++) keep[k] = kept[k];
      keep.length = kept.length;
    }
    // VÁ lỗ ổ cuống: sau khi bỏ cuống cũ, mặt lá hở ra một (hoặc hai, nếu cuống xuyên qua) lỗ ở ổ. Cuống Tripo
    // nằm gần như trong mặt phẳng lá nên lỗ là một VẾT CẮT XIÊN DÀI dọc hướng cuống (tới ~10·rt), không phải
    // vòng tròn ~rt — kéo vài đỉnh vành về tâm (thử trước) chỉ bịt được đầu vết, phần còn lại vẫn hở ra trời.
    // Cách đúng: tìm các VÒNG BIÊN thật của lưới quanh ổ (cạnh chỉ thuộc một tam giác, hàn đỉnh theo vị trí
    // để đường nối UV không bị tính là biên) rồi vá quạt từ tâm mỗi vòng, UV = trung bình vòng.
    if (hole) fillSocketHoles(keep, P, N, UV, hole, rt, R);
    tubeStart = P.length / 3; // ống được khoá khi rút gọn

    // ống mới
    const RINGS = Math.max(10, Math.round(Lnew / (0.45 * rNew))), SIDES = 14;
    const ringBase = P.length / 3;
    for (let k = -1; k <= RINGS; k++) {
      // vòng k = −1 lùi vào trong lá 0,3 bán kính ống — chỉ để không hở kẽ chân tóc ở mối nối; phễu cổ mới
      // là thứ bịt lỗ. Lùi sâu hơn thì ở lá mỏng (sau khi ép phẳng) ống thò lên khỏi mặt trên lá.
      const sv = k < 0 ? 0 : (Lnew * k) / RINGS, F = frameAt(sv), r = k < 0 ? radiusAt(0) : radiusAt(sv);
      if (k < 0) { F.C = [F.C[0] - F.T[0] * 0.3 * rNew, F.C[1] - F.T[1] * 0.3 * rNew, F.C[2] - F.T[2] * 0.3 * rNew]; }
      // pháp tuyến có thêm thành phần dọc trục ở chỏm (bán kính giảm nhanh)
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
    tubeCount = P.length / 3 - tubeStart;
    // thứ tự đỉnh: chọn chiều quay sao cho mặt trước hướng ra ngoài (pháp tuyến hình học ≈ pháp tuyến hướng tâm)
    const v = (i) => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]];
    const a0 = ringBase, b0 = ringBase + 1, c0 = ringBase + SIDES;
    const e1 = [v(c0)[0] - v(a0)[0], v(c0)[1] - v(a0)[1], v(c0)[2] - v(a0)[2]], e2 = [v(b0)[0] - v(a0)[0], v(b0)[1] - v(a0)[1], v(b0)[2] - v(a0)[2]];
    const fn = cross(e1, e2), outward = fn[0] * N[a0 * 3] + fn[1] * N[a0 * 3 + 1] + fn[2] * N[a0 * 3 + 2] > 0;
    for (let k = 0; k < RINGS + 1; k++) for (let j = 0; j < SIDES; j++) {
      const a = ringBase + k * SIDES + j, b = ringBase + k * SIDES + ((j + 1) % SIDES), c = a + SIDES, d = b + SIDES;
      if (outward) keep.push(a, c, b, b, c, d); else keep.push(a, b, c, b, d, c);
    }
    prim.getIndices().setArray(Uint32Array.from(keep));
    console.log(`  cuống mới: ${RINGS} vòng × ${SIDES} cạnh, dài ${(Lnew / R).toFixed(2)} R, bán kính ${(rNew / R).toFixed(3)} R; bỏ ${((IDX.length - keep.length + tubeCount * 0) / 3) | 0} tam giác cuống cũ`);
  }

  // 4) đưa tâm về gốc, bán kính = 1, xoay nằm ngang sao cho phía có cuống thành mặt DƯỚI:
  //    f = +1: R_x(−90°) (x, y, z) → (x, z, −y); f = −1: R_x(+90°) (x, y, z) → (x, −z, y). Cả hai det = +1.
  //    Rồi xoay quanh trục đứng cho hướng ngang của cuống về −Z (trên màn hình: xuống dưới).
  const f = flip ? stemSide : -stemSide;
  const hx = dir[0], hz = -dir[1] * f, hl = Math.hypot(hx, hz) || 1;
  const ca = -hz / hl, sa = hx / hl; // R_y: x' = x·ca + z·sa, z' = −x·sa + z·ca; đưa (hx, hz) → (0, −1)
  for (let i = 0; i < P.length / 3; i++) {
    const x = (P[i * 3] - cx) / R, y = (P[i * 3 + 1] - cy) / R, z = (P[i * 3 + 2] - zc) / R;
    const X = x, Y = z * f, Zc = -y * f;
    P[i * 3] = X * ca + Zc * sa; P[i * 3 + 1] = Y; P[i * 3 + 2] = -X * sa + Zc * ca;
    const nx = N[i * 3], ny = N[i * 3 + 1], nz = N[i * 3 + 2];
    const NX = nx, NY = nz * f, NZ = -ny * f;
    N[i * 3] = NX * ca + NZ * sa; N[i * 3 + 1] = NY; N[i * 3 + 2] = -NX * sa + NZ * ca;
  }
  prim.getAttribute('POSITION').setArray(Float32Array.from(P));
  prim.getAttribute('NORMAL')?.setArray(Float32Array.from(N));
  if (prim.getAttribute('TEXCOORD_0')) prim.getAttribute('TEXCOORD_0').setArray(Float32Array.from(UV));
  else prim.setAttribute('TEXCOORD_0', d.createAccessor().setType('VEC2').setArray(Float32Array.from(UV)).setBuffer(d.getRoot().listBuffers()[0]));
  const nAll = P.length / 3;
  let lowest = 0, stemN = 0;
  for (let i = 0; i < nAll; i++) { if (P[i * 3 + 1] < lowest) lowest = P[i * 3 + 1]; if (i < n) stemN += isStem[i]; }
  const tipI2 = tubeStart + tubeCount - 1, tipY = P[tipI2 * 3 + 1], tipH = Math.hypot(P[tipI2 * 3], P[tipI2 * 3 + 2]);
  return {
    bladeR: +R.toFixed(4), bladeCurve: +((zb1 - zb0) / R).toFixed(3), stemVerts: stemN, stemRadius: +(rt / R).toFixed(3),
    stemTip: { y: +tipY.toFixed(3), horiz: +tipH.toFixed(3), angleDeg: +((Math.atan2(-tipY, tipH) * 180) / Math.PI).toFixed(1) },
    lowest: +lowest.toFixed(3), f, locked: [tubeStart, tubeStart + tubeCount], navel: navelInfo,
  };
}

// Tìm RỐN LÁ (chỗ các gân hội tụ) từ texture mặt trên. Rasterize độ sáng texture của các đỉnh mặt trên
// lên lưới G×G trong mặt phẳng XY của model; gân = ô tối hơn nền (lọc thông cao); hướng gân lấy từ tensor
// cấu trúc; mỗi ô gân bỏ phiếu cho cả đường thẳng dọc hướng ấy; đỉnh phiếu = điểm mọi gân cùng chĩa về.
// Trả về null nếu đỉnh phiếu không trội (texture không có gân rõ) — khi đó dùng ổ cuống của lưới.
async function findNavel(d, P, N, UV, isStem, n, stemSide) {
  const tex = d.getRoot().listMaterials()[0]?.getBaseColorTexture();
  if (!tex) return null;
  const { data, info } = await sharp(Buffer.from(tex.getImage())).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const tw = info.width, th = info.height;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < n; i++) if (!isStem[i]) { const x = P[i * 3], y = P[i * 3 + 1]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  const G = 200, cell = Math.max(x1 - x0, y1 - y0) / (G - 2);
  const sum = new Float64Array(G * G), cnt = new Uint32Array(G * G);
  for (let i = 0; i < n; i++) {
    if (isStem[i] || N[i * 3 + 2] * stemSide > -0.2) continue; // chỉ mặt trên (quay lưng với cuống)
    const gx = Math.floor((P[i * 3] - x0) / cell) + 1, gy = Math.floor((P[i * 3 + 1] - y0) / cell) + 1;
    if (gx < 0 || gy < 0 || gx >= G || gy >= G) continue;
    const px = Math.min(tw - 1, Math.max(0, Math.round(UV[i * 2] * (tw - 1)))), py = Math.min(th - 1, Math.max(0, Math.round(UV[i * 2 + 1] * (th - 1))));
    const o = (py * tw + px) * 4;
    sum[gy * G + gx] += 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2];
    cnt[gy * G + gx]++;
  }
  const lum = new Float32Array(G * G), mask = new Uint8Array(G * G);
  for (let i = 0; i < G * G; i++) if (cnt[i]) { lum[i] = sum[i] / cnt[i]; mask[i] = 1; }
  for (let pass = 0; pass < 2; pass++) { // lấp lỗ nhỏ
    const l2 = Float32Array.from(lum), m2 = Uint8Array.from(mask);
    for (let y = 1; y < G - 1; y++) for (let x = 1; x < G - 1; x++) {
      const i = y * G + x; if (mask[i]) continue;
      let s = 0, c = 0;
      for (const j of [i + 1, i - 1, i + G, i - G]) if (mask[j]) { s += lum[j]; c++; }
      if (c >= 3) { l2[i] = s / c; m2[i] = 1; }
    }
    lum.set(l2); mask.set(m2);
  }
  const blur = (src, r) => { // box blur tách chiều, chỉ tính trong mask
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
    const tg = 0.5 * Math.atan2(2 * b, a - c), dx = -Math.sin(tg), dy = Math.cos(tg); // dọc gân = vuông góc gradient
    const w = (thr - hp[i]) * coh;
    for (let t = -G; t <= G; t++) { const xx = Math.round(x + dx * t), yy = Math.round(y + dy * t); if (xx < 0 || yy < 0 || xx >= G || yy >= G) continue; acc[yy * G + xx] += w; }
  }
  const accS = blur(acc, 3);
  let best = -1, bi = -1, am = 0, ac = 0;
  for (let i = 0; i < G * G; i++) if (mask[i]) { am += accS[i]; ac++; if (accS[i] > best) { best = accS[i]; bi = i; } }
  am /= Math.max(1, ac);
  if (bi < 0 || best < 2.5 * am) return null;
  return { x: x0 + ((bi % G) - 1 + 0.5) * cell, y: y0 + (Math.floor(bi / G) - 1 + 0.5) * cell, strength: best / am };
}

// Vá các lỗ hở của lưới quanh ổ cuống (xem chú thích chỗ gọi). keep: mảng chỉ mục tam giác (được nối thêm).
function fillSocketHoles(keep, P, N, UV, hole, rt, R) {
  const n = P.length / 3, q = R * 2e-4;
  const within = (i, r) => Math.hypot(P[i * 3] - hole[0], P[i * 3 + 1] - hole[1]) <= r;
  // hàn theo vị trí: cùng chỗ → cùng đại diện (đường nối UV nhân đôi đỉnh, không hàn thì cạnh nào cũng "biên")
  const repOf = new Map(), rep = new Int32Array(n).fill(-1);
  const repIdx = (i) => {
    if (rep[i] >= 0) return rep[i];
    const k = `${Math.round(P[i * 3] / q)},${Math.round(P[i * 3 + 1] / q)},${Math.round(P[i * 3 + 2] / q)}`;
    let r = repOf.get(k); if (r === undefined) { r = i; repOf.set(k, i); }
    rep[i] = r; return r;
  };
  // đếm cạnh của các tam giác nằm trọn trong 9·rt quanh ổ; cạnh có hướng (a→b theo chiều quay tam giác)
  const count = new Map(), dirEdge = new Map();
  for (let k = 0; k < keep.length; k += 3) {
    const t = [keep[k], keep[k + 1], keep[k + 2]];
    if (!within(t[0], 9 * rt) || !within(t[1], 9 * rt) || !within(t[2], 9 * rt)) continue;
    const r = t.map(repIdx);
    for (let e = 0; e < 3; e++) {
      const a = r[e], b = r[(e + 1) % 3];
      if (a === b) continue;
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      count.set(key, (count.get(key) || 0) + 1);
      dirEdge.set(key, [a, b]);
    }
  }
  // cạnh biên (chỉ một tam giác dùng) nằm trong 8·rt → nối thành vòng
  const next = new Map();
  for (const [key, c] of count) {
    if (c !== 1) continue;
    const [a, b] = dirEdge.get(key);
    if (!within(a, 8 * rt) || !within(b, 8 * rt)) continue;
    if (!next.has(a)) next.set(a, []);
    next.get(a).push(b);
  }
  const used = new Set();
  let loops = 0, tris = 0;
  for (const [start] of next) {
    if (used.has(start)) continue;
    const loop = [start]; used.add(start);
    let cur = start, guard = 0, closed = false;
    while (guard++ < 20000) {
      const outs = (next.get(cur) || []).filter((v) => !used.has(v) || v === start);
      if (!outs.length) break;
      const v = outs[0];
      if (v === start) { closed = true; break; }
      loop.push(v); used.add(v); cur = v;
    }
    if (!closed || loop.length < 3) continue;
    // chỉ vá vòng nằm quanh ổ: tâm vòng cách tâm ổ ≤ 4·rt và vòng không vươn quá 12·rt (loại mép lá, khe lá)
    let cx = 0, cy = 0, cz = 0, maxD = 0;
    for (const i of loop) { cx += P[i * 3] / loop.length; cy += P[i * 3 + 1] / loop.length; cz += P[i * 3 + 2] / loop.length; }
    for (const i of loop) maxD = Math.max(maxD, Math.hypot(P[i * 3] - hole[0], P[i * 3 + 1] - hole[1]));
    if (Math.hypot(cx - hole[0], cy - hole[1]) > 4 * rt || maxD > 12 * rt) continue;
    let nx = 0, ny = 0, nz = 0, u = 0, v = 0;
    for (const i of loop) { nx += N[i * 3]; ny += N[i * 3 + 1]; nz += N[i * 3 + 2]; u += UV[i * 2] / loop.length; v += UV[i * 2 + 1] / loop.length; }
    const nl = Math.hypot(nx, ny, nz) || 1;
    const c = P.length / 3;
    P.push(cx, cy, cz); N.push(nx / nl, ny / nl, nz / nl); UV.push(u, v);
    // chiều quay: quạt (c, v_{i+1}, v_i) ngược với chiều cạnh biên = cùng chiều với tam giác xung quanh;
    // kiểm lại bằng pháp tuyến trung bình, ngược thì lật
    const a0 = loop[0], a1 = loop[1];
    const e1 = [P[a1 * 3] - cx, P[a1 * 3 + 1] - cy, P[a1 * 3 + 2] - cz], e2 = [P[a0 * 3] - cx, P[a0 * 3 + 1] - cy, P[a0 * 3 + 2] - cz];
    const fn = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const flip = fn[0] * nx + fn[1] * ny + fn[2] * nz < 0;
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i], b = loop[(i + 1) % loop.length];
      if (flip) keep.push(c, a, b); else keep.push(c, b, a);
      tris++;
    }
    loops++;
  }
  console.log(`  vá lỗ ổ cuống: ${loops} vòng biên, ${tris} tam giác`);
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

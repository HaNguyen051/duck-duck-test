// Chuẩn bị model vịt cho web. Nguồn là file .glb do Tripo sinh (~1,9 triệu tam giác, 57 MB), đầu ra là
// models/duck.glb nhẹ, đã xoay về HỆ CHUẨN mà js/pond/duck3d.js trông đợi:
//   mũi hướng +X, lưng hướng +Y, hai bên là ±Z, gan bàn chân chạm y = 0, tâm thân ở x = z = 0.
// Hướng mũi được tìm bằng trục chính (PCA) của phần thân, dấu lấy theo phía có đầu — nên không cần
// biết trước model nằm quay đi đâu.
//
// Chạy:  cd tools && npm install && node prepare-duck.mjs "<nguồn.glb>" ../models/duck.glb [--ratio 0.02] [--error 0.01]
// Cuối cùng script in ra các số đo (khớp háng, hai chân, mặt cắt ở từng mực nước) để điền vào DUCK_MODEL
// trong js/pond/config.js. Mọi số đo quy về chiều cao model = 1.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { weld, simplify, dedup, prune, quantize, meshopt, flatten, clearNodeTransform, textureCompress } from '@gltf-transform/functions';
import { MeshoptSimplifier, MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import sharp from 'sharp';

const args = process.argv.slice(2);
const flag = (name, def) => { const i = args.indexOf(name); return i >= 0 ? parseFloat(args[i + 1]) : def; };
const [src, dst] = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
if (!src || !dst) { console.error('Dùng: node prepare-duck.mjs <nguồn.glb> <đích.glb> [--ratio 0.02] [--error 0.01]'); process.exit(1); }
const RATIO = flag('--ratio', 0.02), ERROR = flag('--error', 0.01);

await MeshoptSimplifier.ready; await MeshoptEncoder.ready; await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });

const doc = await io.read(src);
const before = countTris(doc);
// Nướng mọi phép biến đổi của node vào đỉnh TRƯỚC khi đo: model xuất từ nơi khác có thể mang xoay Z-up
// hay tỉ lệ cm→m trên node; đo trên toạ độ thô thì "lên" không còn là Y và mọi số đo đều sai.
await doc.transform(flatten());
for (const node of doc.getRoot().listNodes()) if (node.getMesh()) clearNodeTransform(node);
await doc.transform(weld(), simplify({ simplifier: MeshoptSimplifier, ratio: RATIO, error: ERROR }));
console.log(`Rút gọn lưới: ${before.toLocaleString()} → ${countTris(doc).toLocaleString()} tam giác`);

const stats = reorient(doc);

// Đặt tên cho gọn, bỏ phần thừa rồi nén: lượng tử hoá toạ độ, HÀN LẠI đỉnh (sau lượng tử hoá nhiều đỉnh
// mới trùng nhau — bỏ qua là thừa ~35% đỉnh và chỉ mục phải dùng 32 bit), bỏ tam giác suy biến, rồi
// meshopt (three.js giải nén bằng MeshoptDecoder). Normal map thu về 1024: vịt trên màn chỉ vài trăm px.
for (const m of doc.getRoot().listMeshes()) m.setName('duck');
for (const m of doc.getRoot().listMaterials()) m.setName('duck');
for (const n of doc.getRoot().listNodes()) n.setName('duck');
await doc.transform(dedup(), prune(),
  textureCompress({ encoder: sharp, slots: /normalTexture/, resize: [1024, 1024], targetFormat: 'jpeg', quality: 88 }),
  quantize({ quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 12 }),
  weld(), dropDegenerate(), prune(),
  meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
const vcount = doc.getRoot().listMeshes().flatMap((m) => m.listPrimitives()).reduce((s, p) => s + p.getAttribute('POSITION').getCount(), 0);
console.log(`Sau khi hàn lại: ${vcount.toLocaleString()} đỉnh, ${countTris(doc).toLocaleString()} tam giác`);
await io.write(dst, doc);
const { statSync } = await import('node:fs');
console.log(`Ghi ${dst}: ${(statSync(dst).size / 1e6).toFixed(2)} MB`);
report(stats);

/* ------------------------------------------------------------------ helpers */
// Bỏ tam giác có hai chỉ mục trùng nhau (sinh ra khi hàn đỉnh) — vẽ chúng chỉ tốn công.
function dropDegenerate() {
  return (d) => {
    for (const m of d.getRoot().listMeshes()) for (const p of m.listPrimitives()) {
      const idx = p.getIndices(); if (!idx) continue;
      const a = idx.getArray(), out = [];
      for (let k = 0; k < a.length; k += 3) if (a[k] !== a[k + 1] && a[k + 1] !== a[k + 2] && a[k] !== a[k + 2]) out.push(a[k], a[k + 1], a[k + 2]);
      const n = p.getAttribute('POSITION').getCount();
      idx.setArray(n <= 65535 ? Uint16Array.from(out) : Uint32Array.from(out));
    }
  };
}

function countTris(d) {
  let n = 0;
  for (const m of d.getRoot().listMeshes()) for (const p of m.listPrimitives()) {
    const idx = p.getIndices(); n += (idx ? idx.getCount() : p.getAttribute('POSITION').getCount()) / 3;
  }
  return n;
}

// Xoay toàn bộ đỉnh về hệ chuẩn, ghi đè thẳng vào accessor. Node được đưa về đơn vị.
function reorient(d) {
  const root = d.getRoot();
  const prims = root.listMeshes().flatMap((m) => m.listPrimitives());
  // node đã được clearNodeTransform() đưa về đơn vị, đỉnh đang ở toạ độ thế giới
  const tx = 0, ty = 0, tz = 0;

  // Gom tam giác (toạ độ đã cộng dịch chuyển của node) để đo. Mọi phép đo đều CÂN THEO DIỆN TÍCH
  // tam giác chứ không đếm đỉnh: sau khi rút gọn, đỉnh dồn về chỗ nhiều chi tiết nên đếm đỉnh sẽ lệch.
  const tris = []; // [cx, cy, cz, area]
  let ymin = Infinity, ymax = -Infinity;
  for (const p of prims) {
    const a = p.getAttribute('POSITION').getArray(), idx = p.getIndices()?.getArray();
    const cnt = idx ? idx.length : a.length / 3, at = (k) => (idx ? idx[k] : k) * 3;
    for (let i = 0; i < a.length; i += 3) { const y = a[i + 1] + ty; if (y < ymin) ymin = y; if (y > ymax) ymax = y; }
    for (let k = 0; k < cnt; k += 3) {
      const i0 = at(k), i1 = at(k + 1), i2 = at(k + 2);
      const ux = a[i1] - a[i0], uy = a[i1 + 1] - a[i0 + 1], uz = a[i1 + 2] - a[i0 + 2];
      const vx = a[i2] - a[i0], vy = a[i2 + 1] - a[i0 + 1], vz = a[i2 + 2] - a[i0 + 2];
      const area = 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
      tris.push((a[i0] + a[i1] + a[i2]) / 3 + tx, (a[i0 + 1] + a[i1 + 1] + a[i2 + 1]) / 3 + ty, (a[i0 + 2] + a[i1 + 2] + a[i2 + 2]) / 3 + tz, area);
    }
  }
  const H = ymax - ymin, nt = tris.length / 4;

  // trục chính của phần thân (bỏ chân, bỏ đầu) trong mặt phẳng ngang
  let bx = 0, bz = 0, bw = 0;
  for (let i = 0; i < nt; i++) {
    const y = (tris[i * 4 + 1] - ymin) / H, w = tris[i * 4 + 3];
    if (y > 0.2 && y < 0.66) { bx += tris[i * 4] * w; bz += tris[i * 4 + 2] * w; bw += w; }
  }
  bx /= bw; bz /= bw;
  let sxx = 0, sxz = 0, szz = 0;
  for (let i = 0; i < nt; i++) {
    const y = (tris[i * 4 + 1] - ymin) / H, w = tris[i * 4 + 3];
    if (y > 0.2 && y < 0.66) { const dx = tris[i * 4] - bx, dz = tris[i * 4 + 2] - bz; sxx += dx * dx * w; sxz += dx * dz * w; szz += dz * dz * w; }
  }
  const ang = 0.5 * Math.atan2(2 * sxz, sxx - szz);
  let fx = Math.cos(ang), fz = Math.sin(ang);
  // dấu: đầu (phần cao nhất) nằm về phía trước
  let hx = 0, hz = 0, hw = 0;
  for (let i = 0; i < nt; i++) {
    const w = tris[i * 4 + 3];
    if ((tris[i * 4 + 1] - ymin) / H > 0.8) { hx += tris[i * 4] * w; hz += tris[i * 4 + 2] * w; hw += w; }
  }
  if ((hx / hw - bx) * fx + (hz / hw - bz) * fz < 0) { fx = -fx; fz = -fz; }

  // Phép xoay quanh trục Y (det = +1, KHÔNG lật gương): X' = tiến, Z' = fx·z − fz·x.
  const rot = (x, z) => [x * fx + z * fz, z * fx - x * fz];
  const P = []; // bản sao toạ độ đã xoay, quy về cao = 1, để đo đạc (accessor sau đó sẽ bị lượng tử hoá)
  for (const p of prims) {
    const pos = p.getAttribute('POSITION'), nor = p.getAttribute('NORMAL');
    const a = Float32Array.from(pos.getArray());
    for (let i = 0; i < a.length; i += 3) {
      const [x, z] = rot(a[i] + tx - bx, a[i + 2] + tz - bz);
      a[i] = x; a[i + 1] = a[i + 1] + ty - ymin; a[i + 2] = z;
      P.push(x / H, a[i + 1] / H, z / H);
    }
    pos.setArray(a);
    if (nor) {
      const b = Float32Array.from(nor.getArray());
      for (let i = 0; i < b.length; i += 3) { const [x, z] = rot(b[i], b[i + 2]); b[i] = x; b[i + 2] = z; }
      nor.setArray(b);
    }
  }
  return { H, forward: [fx, fz], P };
}

// In số đo trong hệ chuẩn, quy về chiều cao = 1, để điền vào DUCK_MODEL.
function report({ H, forward, P }) {
  const n = P.length / 3;
  const ext = (y0, y1, pred = () => true) => {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, c = 0;
    for (let i = 0; i < n; i++) {
      const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
      if (y >= y0 && y < y1 && pred(x, z)) { c++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; }
    }
    return { c, x0, x1, z0, z1 };
  };
  const f = (v) => v.toFixed(3).padStart(7);
  console.log(`\nHướng mũi gốc (x,z) = (${forward[0].toFixed(3)}, ${forward[1].toFixed(3)}); chiều cao model = ${H.toFixed(4)} đơn vị gốc.`);
  const w = ext(0, 1.01);
  console.log(`Khung bao (cao = 1): x ${f(w.x0)}..${f(w.x1)} (dài ${(w.x1 - w.x0).toFixed(3)})  z ${f(w.z0)}..${f(w.z1)} (rộng ${(w.z1 - w.z0).toFixed(3)})`);
  console.log('\nLát cắt theo độ cao (tìm khớp háng: chỗ số đỉnh và bề rộng nhảy vọt là bụng bắt đầu):');
  console.log('   y0     y1      đỉnh    xmin    xmax    zmin    zmax');
  for (let s = 0; s < 12; s++) {
    const y0 = s * 0.025, e = ext(y0, y0 + 0.025);
    console.log(` ${y0.toFixed(3)} ${(y0 + 0.025).toFixed(3)} ${String(e.c).padStart(7)} ${f(e.x0)} ${f(e.x1)} ${f(e.z0)} ${f(e.z1)}`);
  }
  // hai cẳng chân: tách theo khoảng trống lớn nhất trên trục z
  const zs = [];
  for (let i = 0; i < n; i++) { const y = P[i * 3 + 1]; if (y >= 0.12 && y < 0.15) zs.push([P[i * 3 + 2], P[i * 3]]); }
  zs.sort((a, b) => a[0] - b[0]);
  let gap = 0, cut = 0;
  for (let i = 1; i < zs.length; i++) if (zs[i][0] - zs[i - 1][0] > gap) { gap = zs[i][0] - zs[i - 1][0]; cut = i; }
  const mean = (arr) => arr.reduce((s, v) => [s[0] + v[0], s[1] + v[1]], [0, 0]).map((v) => v / arr.length);
  const [zA, xA] = mean(zs.slice(0, cut)), [zB, xB] = mean(zs.slice(cut));
  console.log(`\nCẳng chân (y 0.12–0.15): chân A tâm (x ${xA.toFixed(3)}, z ${zA.toFixed(3)}), chân B tâm (x ${xB.toFixed(3)}, z ${zB.toFixed(3)}), khoảng trống giữa hai chân ${gap.toFixed(3)}`);
  console.log('\nMặt cắt ở từng mực nước (nửa trục elip tiếp nước, quy về cao = 1):');
  for (const wf of [0.28, 0.31, 0.34, 0.37, 0.40, 0.44]) {
    const e = ext(wf - 0.008, wf + 0.008);
    console.log(`  water ${wf.toFixed(2)}: dọc thân ±${((e.x1 - e.x0) / 2).toFixed(3)} (tâm ${((e.x1 + e.x0) / 2).toFixed(3)})  ngang ±${((e.z1 - e.z0) / 2).toFixed(3)} (tâm ${((e.z1 + e.z0) / 2).toFixed(3)})`);
  }
}

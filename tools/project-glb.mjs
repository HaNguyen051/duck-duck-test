// Vẽ hình chiếu mật độ đỉnh của một GLB lên ba mặt phẳng (XZ nhìn từ trên, XY và ZY nhìn ngang) ra PGM, kèm
// histogram theo Y và trích texture basecolor — để hiểu bố cục model Tripo trước khi chạy pipeline.
// node project-glb.mjs <file.glb> <thư mục ra> [px=600]
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { writeFileSync, mkdirSync } from 'node:fs';
import { basename, join } from 'node:path';
const [file, outDir, pxArg] = process.argv.slice(2); const PX = +(pxArg || 600);
mkdirSync(outDir, { recursive: true });
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(file); const root = doc.getRoot(); const tag = basename(file, '.glb');
const pts = [];
for (const node of root.listNodes()) {
  const mesh = node.getMesh(); if (!mesh) continue;
  const M = node.getWorldMatrix();
  for (const p of mesh.listPrimitives()) {
    const a = p.getAttribute('POSITION'), v = [0, 0, 0];
    for (let i = 0; i < a.getCount(); i++) {
      a.getElement(i, v);
      const x = M[0] * v[0] + M[4] * v[1] + M[8] * v[2] + M[12], y = M[1] * v[0] + M[5] * v[1] + M[9] * v[2] + M[13], z = M[2] * v[0] + M[6] * v[1] + M[10] * v[2] + M[14];
      pts.push(x, y, z);
    }
  }
}
const n = pts.length / 3; const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) { const v = pts[i * 3 + k]; if (v < mn[k]) mn[k] = v; if (v > mx[k]) mx[k] = v; }
const ext = Math.max(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]) * 1.04;
const c = [(mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2];
console.log(tag, 'verts', n, 'bbox min', mn.map((v) => +v.toFixed(3)), 'max', mx.map((v) => +v.toFixed(3)));
function proj(ia, ib, flipB, name) {
  const img = new Float32Array(PX * PX);
  for (let i = 0; i < n; i++) {
    const u = (pts[i * 3 + ia] - c[ia]) / ext + 0.5, w = (pts[i * 3 + ib] - c[ib]) / ext + 0.5;
    const px = Math.min(PX - 1, Math.max(0, Math.floor(u * PX))), py = Math.min(PX - 1, Math.max(0, Math.floor((flipB ? 1 - w : w) * PX)));
    img[py * PX + px] += 1;
  }
  let m = 0; for (const v of img) if (v > m) m = v;
  const out = new Uint8Array(PX * PX);
  for (let i = 0; i < img.length; i++) out[i] = img[i] ? Math.min(255, 40 + 215 * Math.log1p(img[i]) / Math.log1p(m)) : 0;
  writeFileSync(join(outDir, `${tag}-${name}.pgm`), Buffer.concat([Buffer.from(`P5\n${PX} ${PX}\n255\n`), Buffer.from(out)]));
}
proj(0, 2, false, 'top-XZ');   // nhìn từ +Y xuống: ngang = x, dọc = z
proj(0, 1, true, 'side-XY');   // nhìn từ +Z: ngang = x, dọc = y (y lên trên)
proj(2, 1, true, 'side-ZY');   // nhìn từ +X: ngang = z, dọc = y
// histogram theo Y: số đỉnh và bề rộng XZ của từng lát
const B = 24, hist = new Array(B).fill(0), wx = new Array(B).fill(0).map(() => [Infinity, -Infinity]), wz = new Array(B).fill(0).map(() => [Infinity, -Infinity]);
for (let i = 0; i < n; i++) {
  const y = pts[i * 3 + 1], b = Math.min(B - 1, Math.floor(((y - mn[1]) / (mx[1] - mn[1] + 1e-9)) * B));
  hist[b]++; const x = pts[i * 3], z = pts[i * 3 + 2];
  if (x < wx[b][0]) wx[b][0] = x; if (x > wx[b][1]) wx[b][1] = x; if (z < wz[b][0]) wz[b][0] = z; if (z > wz[b][1]) wz[b][1] = z;
}
console.log('lát theo Y (từ thấp lên cao): y0..y1  đỉnh  rộngX  rộngZ');
for (let b = 0; b < B; b++) {
  const y0 = mn[1] + ((mx[1] - mn[1]) * b) / B, y1 = y0 + (mx[1] - mn[1]) / B;
  console.log(`  ${y0.toFixed(3)}..${y1.toFixed(3)}  ${String(hist[b]).padStart(8)}  ${(wx[b][1] - wx[b][0]).toFixed(3)}  ${(wz[b][1] - wz[b][0]).toFixed(3)}`);
}
for (const t of root.listTextures()) {
  const name = t.getName() || 'tex', ext2 = t.getMimeType() === 'image/png' ? 'png' : 'jpg';
  writeFileSync(join(outDir, `${tag}-${name}.${ext2}`), Buffer.from(t.getImage()));
}
console.log('ghi', outDir);

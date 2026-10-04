// Lá sen là MODEL 3D (models/la_N.glb) do Tripo sinh từ ảnh lá vẽ, đã được tools/prepare-leaf.mjs xoay
// nằm ngang: mặt lá trong mặt phẳng XZ, tâm ở gốc, bán kính mặt lá = 1, cuống bẻ rủ xuống −Y.
// File này nạp 4 mẫu, đưa về px ảnh, đặt mực nước ngay dưới đáy mặt lá, và tạo vật liệu dùng chung
// shader "vật nổi" với vịt (floater.js): mặt lá nổi → nhìn xuyên qua mặt nước nên xỉn và lay theo
// sóng; cuống chìm → rõ nét.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { LEAF_MODEL, LEAVES } from './config.js';
import { unpack } from './duck3d.js';
import { floaterMaterial } from './floater.js';

// Trả về mảng { geometry, map, normalMap, radius, depth, top } — đơn vị px ảnh, gốc toạ độ ở mực nước.
export async function loadLeafModels(urls = LEAF_MODEL.urls) {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const gltfs = await Promise.all(urls.map((u) => loader.loadAsync(u)));
  return gltfs.map((gltf, k) => {
    gltf.scene.updateMatrixWorld(true);
    let mesh = null;
    gltf.scene.traverse((o) => { if (o.isMesh && !mesh) mesh = o; });
    if (!mesh) throw new Error('Model lá không có lưới nào: ' + urls[k]);
    const map = mesh.material.map || null, normalMap = mesh.material.normalMap || null;
    for (const t of [map, normalMap]) if (t) t.anisotropy = 8;
    const geometry = unpack(mesh);
    return { geometry, map, normalMap, ...fit(geometry, LEAF_MODEL.flip[k]) };
  });
}

// Phóng bán kính 1 → LEAVES.radius px, lật nếu cần, rồi dời sao cho đáy mặt lá nằm ở y = +float.
function fit(g, flip) {
  const pos = g.attributes.position, nor = g.attributes.normal, n = pos.count, R = LEAVES.radius;
  const f = flip ? -1 : 1;
  for (let i = 0; i < n; i++) {
    pos.setXYZ(i, pos.getX(i) * R, pos.getY(i) * R * f, pos.getZ(i) * R * (flip ? -1 : 1));
    if (flip) nor.setXYZ(i, nor.getX(i), -nor.getY(i), -nor.getZ(i));
  }
  // đáy mặt lá: phân vị 15% độ cao của các đỉnh trên vành khuyên 0,35–0,8 R, chỉ lấy quanh mặt lá
  // (|y| < 0,6 R) — cuống rủ thẳng xuống ngay dưới tâm nên phải loại, không thì "đáy" rơi vào cuống
  const ys = [];
  for (let i = 0; i < n; i++) {
    const r = Math.hypot(pos.getX(i), pos.getZ(i)), y = pos.getY(i);
    if (r > R * 0.35 && r < R * 0.8 && Math.abs(y) < R * 0.3) ys.push(y); // cuống giờ cắm ở rốn (có thể lệch tâm), lọc chặt hơn để không lẫn ống
  }
  ys.sort((a, b) => a - b);
  const bottom = ys.length ? ys[Math.floor(ys.length * 0.15)] : 0, top = ys.length ? ys[ys.length - 1] : 0;
  const dy = LEAF_MODEL.float - bottom;
  for (let i = 0; i < n; i++) pos.setY(i, pos.getY(i) + dy);
  pos.needsUpdate = true; nor.needsUpdate = true;
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return { radius: R, depth: -g.boundingBox.min.y, top: top + dy };
}

export function leafMaterial(model, ambGain) {
  return floaterMaterial(model, LEAF_MODEL, ambGain);
}

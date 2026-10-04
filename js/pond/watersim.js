// Mô phỏng sóng trên lưới chiều cao (CPU). Sóng lan truyền, chồng lên nhau, dội lại quanh vùng
// tiếp nước của vịt và tắt dần ở mép vùng tương tác. Toạ độ vào/ra là px ảnh.
//
// Lưới nằm trên MẶT PHẲNG NƯỚC nhìn xiên CÓ PHỐI CẢNH (persp.js), không nằm trên màn hình: ô vuông
// đều trên (X, Y) của mặt nước nên phép sóng đẳng hướng (vòng sóng tròn trên mặt nước); lên màn hình
// vòng sóng thành elip dẹt và càng xuống dưới (xa) càng nhỏ — cùng quy luật phối cảnh với vịt và lá.
// Mọi chỗ đổi px ảnh ↔ ô đều qua persp.toPlane / toImage; bán kính truyền vào disturb/stamp là bán kính
// TRÊN MẶT NƯỚC (bằng px ảnh ở chỗ S = 1).
import * as THREE from 'three';
import { SIM } from './config.js';

// Khung bao của vùng `world` (toạ độ ảnh) trên mặt phẳng nước: X rộng nhất ở hàng dưới cùng (S nhỏ nhất).
function planeBox(world, persp) {
  const yb = world.y + world.h;
  const X0 = persp.toPlane(world.x, yb)[0], X1 = persp.toPlane(world.x + world.w, yb)[0];
  const Y0 = persp.toPlane(0, world.y)[1], Y1 = persp.toPlane(0, yb)[1];
  return { X0, X1, Y0, Y1, w: X1 - X0, h: Y1 - Y0 };
}

// Cỡ ô theo độ phóng s (px CSS / px ảnh): ở giữa khung (S ≈ 1) mỗi ô ≈ SIM.screenCell px CSS, không vượt SIM.maxCells ô.
export function cellFor(world, s, persp) {
  const box = planeBox(world, persp);
  let cell = Math.min(SIM.maxCell, Math.max(SIM.minCell, Math.round(SIM.screenCell / s)));
  while (Math.ceil(box.w / cell) * Math.ceil(box.h / cell) > SIM.maxCells) cell++;
  return cell;
}

export class WaterSim {
  constructor(world, cell, persp) {
    const box = planeBox(world, persp);
    this.persp = persp;
    this.sq = persp.sq;
    this.ox = box.X0; // gốc lưới trong toạ độ mặt phẳng nước
    this.oy = box.Y0;
    this.cell = cell; // cạnh ô trên mặt phẳng nước
    this.cols = Math.ceil(box.w / cell);
    this.rows = Math.ceil(box.h / cell);
    // biên độ tính theo ô 4 px: ô to hơn thì nhân lên để độ dốc (thứ tạo ra hình sóng) giữ nguyên
    this.ampScale = cell / 4;
    const n = this.cols * this.rows;
    this.cur = new Float32Array(n);
    this.prev = new Float32Array(n);
    this.base = new Float32Array(n).fill(SIM.damp);
    this.cover = new Float32Array(n).fill(1);
    this.solid = new Uint8Array(n);
    this.half = new Uint16Array(n);
    this.texture = new THREE.DataTexture(this.half, this.cols, this.rows, THREE.RedFormat, THREE.HalfFloatType);
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.wrapS = this.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.texture.needsUpdate = true;
  }

  // Mép vùng tương tác: `path` (Path2D, toạ độ ảnh). Lưới không còn là lưới affine của ảnh nên không vẽ
  // thẳng path lên lưới được: vẽ path vào một canvas ảnh thu nhỏ rồi tra từng ô qua persp.toImage.
  // Trong vùng tắt dần chậm, ngoài tắt rất nhanh; sát mép lưới có lớp hút sóng (SIM.sponge).
  setShore(path, world) {
    const { cols, rows, cell, persp } = this, K = 4; // 1 px canvas = K px ảnh
    const c = document.createElement('canvas');
    c.width = Math.ceil(world.w / K); c.height = Math.ceil(world.h / K);
    const g = c.getContext('2d', { willReadFrequently: true });
    g.setTransform(1 / K, 0, 0, 1 / K, -world.x / K, -world.y / K);
    g.filter = 'blur(2px)';
    g.fillStyle = '#fff';
    g.fill(path);
    const a = g.getImageData(0, 0, c.width, c.height).data;
    const sp = Math.max(1, SIM.sponge / cell); // bề dày lớp hút sóng, theo ô
    for (let gy = 0; gy < rows; gy++) for (let gx = 0; gx < cols; gx++) {
      const i = gy * cols + gx;
      const [x, y] = persp.toImage(this.ox + (gx + 0.5) * cell, this.oy + (gy + 0.5) * cell);
      const px = Math.floor((x - world.x) / K), py = Math.floor((y - world.y) / K);
      const k = px >= 0 && py >= 0 && px < c.width && py < c.height ? a[(py * c.width + px) * 4 + 3] / 255 : 0;
      let d = SIM.dampShore + (SIM.damp - SIM.dampShore) * k * k;
      // càng sát mép lưới càng tắt nhanh, hạ mượt (smoothstep) để chính chỗ đổi hệ số không dội sóng
      const e = Math.min(gx, gy, cols - 1 - gx, rows - 1 - gy) / sp;
      if (e < 1) { const t = e * e * (3 - 2 * e); d *= SIM.dampEdge / SIM.damp + (1 - SIM.dampEdge / SIM.damp) * t; }
      this.base[i] = d;
    }
  }

  /* ---- vật chắn động: vịt bơi nên phải dựng lại mỗi khung hình ---- */
  clearSolid() { this.solid.fill(0); }
  clearCover() { this.cover.fill(1); }

  // Quét một đĩa/elip trên mặt phẳng nước: tâm (ix, iy) px ảnh; a, b nửa trục trên mặt nước; head góc xoay
  // (hướng bơi trên mặt nước). fn(i) được gọi cho từng ô trong hình.
  forEllipse(ix, iy, a, b, head, fn) {
    const { cols, rows, cell } = this;
    const [Xc, Yc] = this.persp.toPlane(ix, iy);
    const ch = Math.cos(head), sh = Math.sin(head), R = Math.max(a, b) + cell;
    const gx0 = Math.max(1, Math.floor((Xc - R - this.ox) / cell)), gx1 = Math.min(cols - 2, Math.ceil((Xc + R - this.ox) / cell));
    const gy0 = Math.max(1, Math.floor((Yc - R - this.oy) / cell)), gy1 = Math.min(rows - 2, Math.ceil((Yc + R - this.oy) / cell));
    for (let gy = gy0; gy <= gy1; gy++) {
      const dY = this.oy + (gy + 0.5) * cell - Yc;
      for (let gx = gx0; gx <= gx1; gx++) {
        const dX = this.ox + (gx + 0.5) * cell - Xc;
        const u = dX * ch + dY * sh, v = -dX * sh + dY * ch;
        if ((u * u) / (a * a) + (v * v) / (b * b) <= 1) fn(gy * cols + gx);
      }
    }
  }

  // Vùng tiếp nước của vịt: mặt cắt thân ở mực nước — elip nằm trên mặt nước, xoay theo hướng bơi.
  stampEllipse(ix, iy, a, b, head) {
    const solid = this.solid;
    this.forEllipse(ix, iy, a, b, head, (i) => { solid[i] = 1; });
  }

  // Mặt lá làm sóng yếu đi bên dưới: đĩa bán kính r trên mặt nước.
  coverDisc(ix, iy, r) {
    const cover = this.cover;
    this.forEllipse(ix, iy, r, r, 0, (i) => { cover[i] = SIM.dampLeaf; });
  }

  // Điểm có nằm trong vùng chắn không (dùng để lá không trôi xuyên qua vịt).
  solidAt(ix, iy) {
    const [fx, fy] = this.toGrid(ix, iy), gx = Math.round(fx), gy = Math.round(fy);
    if (gx < 0 || gy < 0 || gx >= this.cols || gy >= this.rows) return false;
    return this.solid[gy * this.cols + gx] === 1;
  }

  toGrid(ix, iy) {
    const [X, Y] = this.persp.toPlane(ix, iy);
    return [(X - this.ox) / this.cell - 0.5, (Y - this.oy) / this.cell - 0.5];
  }

  // Phương trình sóng với Laplace 9 điểm: vòng sóng tròn đều, không méo vuông như bản 4 điểm.
  step() {
    const { cols, rows, cur, prev, base, cover, solid } = this;
    const C = SIM.waveC; // (vận tốc sóng · dt / ô)², ổn định khi < 0.75
    for (let y = 1; y < rows - 1; y++) {
      let i = y * cols + 1;
      for (let x = 1; x < cols - 1; x++, i++) {
        if (solid[i]) { prev[i] = 0; continue; }
        const c = cur[i];
        const s4 = cur[i - 1] + cur[i + 1] + cur[i - cols] + cur[i + cols];
        const sd = cur[i - cols - 1] + cur[i - cols + 1] + cur[i + cols - 1] + cur[i + cols + 1];
        prev[i] = (2 * c - prev[i] + C * ((4 * s4 + sd - 20 * c) / 6)) * base[i] * cover[i];
      }
    }
    this.cur = prev;
    this.prev = cur;
  }

  // Thả một "cú chạm" hình chuông: tâm (ix, iy) px ảnh, bán kính TRÊN MẶT NƯỚC. Lên màn hình nó tự
  // thành elip dẹt, và ở xa (thấp) thì nhỏ hơn. amount < 0 là lõm xuống, > 0 là nhô lên.
  disturb(ix, iy, radius, amount) {
    const { cols, rows, cur, solid } = this;
    const [gx, gy] = this.toGrid(ix, iy);
    const r = Math.max(1.6, radius / this.cell), R = Math.ceil(r * 2.2);
    const x0 = Math.max(1, Math.floor(gx - R)), x1 = Math.min(cols - 2, Math.ceil(gx + R));
    const y0 = Math.max(1, Math.floor(gy - R)), y1 = Math.min(rows - 2, Math.ceil(gy + R));
    const inv = 1 / (r * r), a = amount * this.ampScale;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const i = y * cols + x;
      if (solid[i]) continue;
      const d2 = ((x - gx) * (x - gx) + (y - gy) * (y - gy)) * inv;
      if (d2 < 4.8) cur[i] += a * Math.exp(-d2);
    }
  }

  // Chiều cao và độ dốc theo px ẢNH (dh/dx, dh/dy màn hình) tại một điểm ảnh.
  sample(ix, iy, out) {
    const { cols, rows, cur, cell } = this;
    let [fx, fy] = this.toGrid(ix, iy);
    fx = Math.min(cols - 2.001, Math.max(1, fx));
    fy = Math.min(rows - 2.001, Math.max(1, fy));
    const x0 = fx | 0, y0 = fy | 0, tx = fx - x0, ty = fy - y0, i = y0 * cols + x0;
    out.h = (cur[i] * (1 - tx) + cur[i + 1] * tx) * (1 - ty) + (cur[i + cols] * (1 - tx) + cur[i + cols + 1] * tx) * ty;
    const j = Math.round(fy) * cols + Math.round(fx);
    const gX = (cur[j + 1] - cur[j - 1]) / (2 * cell), gY = (cur[j + cols] - cur[j - cols]) / (2 * cell);
    [out.gx, out.gy] = this.persp.gradToImage(gX, gY, ix, iy);
    return out;
  }

  upload() {
    const { cur, half } = this, toHalf = THREE.DataUtils.toHalfFloat;
    for (let i = 0; i < cur.length; i++) half[i] = toHalf(cur[i]);
    this.texture.needsUpdate = true;
  }

  dispose() { this.texture.dispose(); }
}

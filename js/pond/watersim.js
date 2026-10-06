// Mô phỏng sóng trên lưới chiều cao (CPU). Sóng lan truyền, chồng lên nhau, dội lại quanh vùng
// tiếp nước của vịt và tắt dần ở mép vùng tương tác. Toạ độ vào/ra là px ảnh.
//
// Lưới nằm trên MẶT PHẲNG NƯỚC nhìn xiên CÓ PHỐI CẢNH (persp.js, bán kính quanh điểm tụ dưới màn hình),
// không nằm trên màn hình: ô vuông đều trên (X, Y) của mặt nước nên phép sóng đẳng hướng (vòng sóng tròn
// trên mặt nước); lên màn hình vòng sóng thành elip dẹt, càng xuống dưới (xa) càng nhỏ và ở hai bên xoay
// theo tia về điểm tụ — cùng quy luật phối cảnh với vịt và lá. Lưới chỉ phủ tới dưới mép mặt nước
// (SURFACE.arc) một quãng, không phủ phần nước sâu (scene.js cắt `world` trước khi dựng).
// Mọi chỗ đổi px ảnh ↔ ô đều qua persp.toPlane / toImage; bán kính truyền vào disturb/stamp là bán kính
// TRÊN MẶT NƯỚC (bằng px ảnh ở chỗ S = 1).
import * as THREE from 'three';
import { SIM } from './config.js';

// Khung bao của vùng `world` (toạ độ ảnh) trên mặt phẳng nước. Phép chiếu bán kính không còn affine với ảnh
// (Y lớn nhất ở GIỮA mép dưới, không phải ở góc) nên quét dọc cả bốn cạnh chứ không chỉ bốn góc.
function planeBox(world, persp) {
  let X0 = Infinity, X1 = -Infinity, Y0 = Infinity, Y1 = -Infinity;
  const take = (x, y) => {
    const [X, Y] = persp.toPlane(x, y);
    if (X < X0) X0 = X; if (X > X1) X1 = X; if (Y < Y0) Y0 = Y; if (Y > Y1) Y1 = Y;
  };
  const n = 64, xe = world.x + world.w, ye = world.y + world.h;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    take(world.x + world.w * t, world.y); take(world.x + world.w * t, ye);
    take(world.x, world.y + world.h * t); take(xe, world.y + world.h * t);
  }
  return { X0, X1, Y0, Y1, w: X1 - X0, h: Y1 - Y0 };
}

// Cỡ ô theo độ phóng s (px CSS / px ảnh): ở giữa khung (S ≈ 1) mỗi ô ≈ SIM.screenCell px CSS, không vượt SIM.maxCells ô.
// prof: { screenCell, maxCells } đè lên SIM (hồ sơ điện thoại).
export function cellFor(world, s, persp, prof = {}) {
  const box = planeBox(world, persp), sc = prof.screenCell ?? SIM.screenCell, mc = prof.maxCells ?? SIM.maxCells;
  let cell = Math.min(SIM.maxCell, Math.max(SIM.minCell, Math.round(sc / s)));
  while (Math.ceil(box.w / cell) * Math.ceil(box.h / cell) > mc) cell++;
  return cell;
}

export class WaterSim {
  // opts: { hz = SIM.hz, speed = SIM.waveSpeed } — số bước mỗi giây và tốc độ lan (đơn vị mặt nước/giây).
  constructor(world, cell, persp, { hz = SIM.hz, speed = SIM.waveSpeed } = {}) {
    const box = planeBox(world, persp);
    // Hằng số theo BƯỚC suy từ hằng số theo giây: C = (v·dt/ô)² (ổn định khi < 0,75); các hệ số tắt dần khai ở
    // 120 Hz → lũy thừa 120/hz để mỗi giây tắt như nhau dù chạy 60 Hz.
    this.hz = hz;
    this.C = Math.min(0.7, (speed / (cell * hz)) ** 2);
    const k = SIM.hz / hz;
    this.damp = SIM.damp ** k; this.dampShore = SIM.dampShore ** k; this.dampEdge = SIM.dampEdge ** k; this.dampLeaf = SIM.dampLeaf ** k;
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
    this.base = new Float32Array(n).fill(this.damp);
    this.cover = new Float32Array(n).fill(1);
    this.solid = new Uint8Array(n);
    this.half = new Uint16Array(n);
    this.texture = new THREE.DataTexture(this.half, this.cols, this.rows, THREE.RedFormat, THREE.HalfFloatType);
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.wrapS = this.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.texture.needsUpdate = true;
  }

  // Mép vùng mặt nước: `inside(x, y)` trả về khoảng cách (px ảnh) từ điểm ảnh tới mép, dương = trong vùng
  // (scene.js đưa `surfaceBottom(x) − y`). Trong `SIM.shoreBand` px cuối trước mép, hệ số tắt dần hạ MƯỢT
  // (smoothstep) từ damp xuống dampShore; ngoài mép giữ dampShore. Đổi đột ngột ở mép (bản trước rasterize
  // path với blur 2 px) là một bức tường: hút một phần, DỘI một phần — vòng sóng đập vào cung phía dưới rồi
  // phản lại. Dải hút rộng ~40 ô thì sóng tắt dần trong dải (0,93 trung bình mỗi bước × ~70 bước) trước khi
  // tới chỗ tắt mạnh, không có mặt phản xạ. Sát mép lưới còn lớp hút sóng riêng (SIM.sponge).
  setShore(inside) {
    const { cols, rows, cell, persp } = this;
    const sp = Math.max(1, SIM.sponge / cell), band = Math.max(1, SIM.shoreBand); // bề dày lớp hút sóng ở mép lưới (ô) và dải hút ở mép vùng (px ảnh)
    for (let gy = 0; gy < rows; gy++) for (let gx = 0; gx < cols; gx++) {
      const i = gy * cols + gx;
      const [x, y] = persp.toImage(this.ox + (gx + 0.5) * cell, this.oy + (gy + 0.5) * cell);
      const t = Math.min(1, Math.max(0, inside(x, y) / band)), k = t * t * (3 - 2 * t);
      let d = this.dampShore + (this.damp - this.dampShore) * k;
      // càng sát mép lưới càng tắt nhanh, hạ mượt (smoothstep) để chính chỗ đổi hệ số không dội sóng
      const e = Math.min(gx, gy, cols - 1 - gx, rows - 1 - gy) / sp;
      if (e < 1) { const t = e * e * (3 - 2 * e); d *= this.dampEdge / this.damp + (1 - this.dampEdge / this.damp) * t; }
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
    this.forEllipse(ix, iy, r, r, 0, (i) => { cover[i] = this.dampLeaf; });
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
    const C = this.C; // (vận tốc sóng · dt / ô)², tính sẵn trong constructor
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

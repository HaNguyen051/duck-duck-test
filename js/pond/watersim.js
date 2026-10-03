// Mô phỏng sóng trên lưới chiều cao (CPU). Sóng lan truyền, chồng lên nhau, dội lại quanh vùng
// tiếp nước của vịt và tắt dần ở mép vùng tương tác. Toạ độ vào/ra là px ảnh; lưới phủ `world`.
import * as THREE from 'three';
import { SIM } from './config.js';

// Cỡ ô theo độ phóng s (px CSS / px ảnh): trên màn hình mỗi ô ≈ SIM.screenCell px, không vượt SIM.maxCells ô.
export function cellFor(world, s) {
  let cell = Math.min(SIM.maxCell, Math.max(SIM.minCell, Math.round(SIM.screenCell / s)));
  while (Math.ceil(world.w / cell) * Math.ceil(world.h / cell) > SIM.maxCells) cell++;
  return cell;
}

export class WaterSim {
  constructor(world, cell) {
    this.ox = world.x;
    this.oy = world.y;
    this.cell = cell;
    this.cols = Math.ceil(world.w / cell);
    this.rows = Math.ceil(world.h / cell);
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

  // Mép vùng tương tác: draw(ctx) vẽ hình vùng nước theo toạ độ lưới. Trong vùng tắt dần chậm, ngoài tắt rất nhanh.
  setShore(draw) {
    const { cols, rows } = this;
    const c = document.createElement('canvas');
    c.width = cols; c.height = rows;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.filter = 'blur(2px)';
    g.fillStyle = '#fff';
    draw(g);
    const a = g.getImageData(0, 0, cols, rows).data;
    for (let i = 0; i < cols * rows; i++) {
      const k = a[i * 4 + 3] / 255;
      this.base[i] = SIM.dampShore + (SIM.damp - SIM.dampShore) * k * k;
    }
  }

  /* ---- vật chắn động: vịt bơi nên phải dựng lại mỗi khung hình ---- */
  clearSolid() { this.solid.fill(0); }

  // mask: { w, h, data, cell, x, y } theo hệ pixel của ảnh khung vịt;
  // (ox, oy) là góc trên trái của ảnh khung đó trong toạ độ ảnh, `scale` là cỡ vẽ của khung.
  stampSolid(mask, ox, oy, scale = 1) {
    if (!mask) return;
    const { cols, rows, cell } = this;
    const mc = mask.cell * scale;                 // một ô mặt nạ chiếm ngần này px ảnh
    const x0 = ox + mask.x * scale, y0 = oy + mask.y * scale;
    const gx0 = Math.max(1, Math.floor((x0 - this.ox) / cell));
    const gx1 = Math.min(cols - 2, Math.ceil((x0 + mask.w * mc - this.ox) / cell));
    const gy0 = Math.max(1, Math.floor((y0 - this.oy) / cell));
    const gy1 = Math.min(rows - 2, Math.ceil((y0 + mask.h * mc - this.oy) / cell));
    for (let gy = gy0; gy <= gy1; gy++) {
      const iy = ((this.oy + (gy + 0.5) * cell - y0) / mc) | 0;
      if (iy < 0 || iy >= mask.h) continue;
      for (let gx = gx0; gx <= gx1; gx++) {
        const ix = ((this.ox + (gx + 0.5) * cell - x0) / mc) | 0;
        if (ix < 0 || ix >= mask.w) continue;
        if (mask.data[iy * mask.w + ix]) this.solid[gy * cols + gx] = 1;
      }
    }
  }

  // Vùng tiếp nước của vịt 3D: mặt cắt thân ở mực nước là một hình elip nằm trên mặt nước,
  // chiếu lên màn hình thì bị ép dẹt theo chiều dọc và xoay theo hướng bơi.
  // (cx, cy) tâm theo toạ độ ảnh; a dọc theo thân, b ngang thân; head = hướng bơi; sq = độ ép dẹt.
  stampEllipse(cx, cy, a, b, head, sq) {
    const { cols, rows, cell } = this;
    const ch = Math.cos(head), sh = Math.sin(head);
    const R = Math.max(a, b) + cell;
    const gx0 = Math.max(1, Math.floor((cx - R - this.ox) / cell));
    const gx1 = Math.min(cols - 2, Math.ceil((cx + R - this.ox) / cell));
    const gy0 = Math.max(1, Math.floor((cy - R * sq - this.oy) / cell));
    const gy1 = Math.min(rows - 2, Math.ceil((cy + R * sq - this.oy) / cell));
    for (let gy = gy0; gy <= gy1; gy++) {
      const dy = (this.oy + (gy + 0.5) * cell - cy) / sq; // bỏ ép dẹt để về mặt phẳng nước
      for (let gx = gx0; gx <= gx1; gx++) {
        const dx = this.ox + (gx + 0.5) * cell - cx;
        const u = dx * ch + dy * sh, v = -dx * sh + dy * ch; // xoay về hệ của con vịt
        if ((u * u) / (a * a) + (v * v) / (b * b) <= 1) this.solid[gy * cols + gx] = 1;
      }
    }
  }

  // Điểm có nằm trong vùng chắn không (dùng để lá không trôi xuyên qua vịt).
  solidAt(ix, iy) {
    const gx = Math.round((ix - this.ox) / this.cell - 0.5), gy = Math.round((iy - this.oy) / this.cell - 0.5);
    if (gx < 0 || gy < 0 || gx >= this.cols || gy >= this.rows) return false;
    return this.solid[gy * this.cols + gx] === 1;
  }

  toGrid(ix, iy) {
    return [(ix - this.ox) / this.cell - 0.5, (iy - this.oy) / this.cell - 0.5];
  }

  // Phương trình sóng với Laplace 9 điểm: vòng sóng tròn đều, không méo vuông như bản 4 điểm.
  step() {
    const { cols, rows, cur, prev, base, cover, solid } = this;
    const C = 0.45; // (vận tốc sóng · dt / ô)², ổn định khi < 0.75
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

  // Thả một "cú chạm" hình chuông (bán kính px ảnh). amount < 0 là lõm xuống, > 0 là nhô lên.
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

  // Chiều cao và độ dốc (chiều cao trên px ảnh) tại một điểm.
  sample(ix, iy, out) {
    const { cols, rows, cur, cell } = this;
    let [fx, fy] = this.toGrid(ix, iy);
    fx = Math.min(cols - 2.001, Math.max(1, fx));
    fy = Math.min(rows - 2.001, Math.max(1, fy));
    const x0 = fx | 0, y0 = fy | 0, tx = fx - x0, ty = fy - y0, i = y0 * cols + x0;
    out.h = (cur[i] * (1 - tx) + cur[i + 1] * tx) * (1 - ty) + (cur[i + cols] * (1 - tx) + cur[i + cols + 1] * tx) * ty;
    const j = Math.round(fy) * cols + Math.round(fx);
    out.gx = (cur[j + 1] - cur[j - 1]) / (2 * cell);
    out.gy = (cur[j + cols] - cur[j - cols]) / (2 * cell);
    return out;
  }

  upload() {
    const { cur, half } = this, toHalf = THREE.DataUtils.toHalfFloat;
    for (let i = 0; i < cur.length; i++) half[i] = toHalf(cur[i]);
    this.texture.needsUpdate = true;
  }

  dispose() { this.texture.dispose(); }
}

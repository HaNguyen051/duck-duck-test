// Phép chiếu xiên của mặt nước: ảnh (x, y) ↔ mặt phẳng nước (X, Y).
//
// Ta nhìn từ dưới hồ lên: vật ở CAO hơn trên màn hình thì gần hơn, phải to hơn. Cỡ co theo y tuyến tính,
// S(y) = near + k·(y − y0) (near ở mép trên khung nhìn, far ở mép dưới; k = (far − near)/h, âm).
// Một đoạn dài L trên mặt nước nằm ngang hiện L·S(y) px ảnh; nằm dọc hiện L·S(y)·sq px ảnh (sq = độ
// ép dẹt của mặt nước nhìn xiên). Vậy:
//   X = (x − cx) / S(y)
//   Y = ∫ dy / (S(y)·sq) = ln(S(y)/near) / (k·sq)
// Lưới sóng chạy đều trên (X, Y) nên phép sóng đẳng hướng; lên màn hình vòng sóng thành elip và càng
// xuống dưới càng nhỏ — cùng quy luật với vịt và lá (depthScale trong config.js dùng đúng S(y) này).
import * as THREE from 'three';

export class Persp {
  constructor(view, sq, near, far) {
    this.cx = view.x + view.w / 2;
    this.y0 = view.y;
    this.near = near;
    this.sq = sq;
    // k = 0 (tắt phối cảnh) làm ln(1)/0; dùng một giá trị rất nhỏ thì công thức tự về giới hạn (y − y0)/(near·sq)
    this.k = Math.abs(far - near) < 1e-6 ? -1e-6 : (far - near) / view.h;
  }

  S(y) { return this.near + this.k * (y - this.y0); }

  toPlane(x, y) {
    const s = this.S(y);
    return [(x - this.cx) / s, Math.log(s / this.near) / (this.k * this.sq)];
  }

  toImage(X, Y) {
    const s = this.near * Math.exp(Y * this.k * this.sq);
    return [this.cx + X * s, this.y0 + (s - this.near) / this.k];
  }

  // Đạo hàm theo mặt phẳng (gX, gY) → đạo hàm theo px ảnh tại điểm ảnh (x, y). Có cả số hạng xô lệch
  // vì X phụ thuộc y (∂X/∂y = −(x − cx)·k / S²).
  gradToImage(gX, gY, x, y) {
    const s = this.S(y);
    return [gX / s, gY / (s * this.sq) - (gX * (x - this.cx) * this.k) / (s * s)];
  }

  // (cx, y0, near, k) cho shader; sq đi riêng (uSquash)
  uniform() { return new THREE.Vector4(this.cx, this.y0, this.near, this.k); }
}

// Mặc định cho các trang soi (không có khung nhìn): không phối cảnh, S = 1.
export const FLAT_PERSP = new THREE.Vector4(0, 0, 1, -1e-6);

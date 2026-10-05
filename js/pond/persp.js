// Phép chiếu của mặt nước: ảnh (x, y) ↔ mặt phẳng nước (X, Y).
//
// Ta nhìn từ dưới hồ lên: vật ở CAO hơn trên màn hình thì gần hơn, phải to hơn; theo file art mới
// ("dimension ref": "to dần về 2 bên, nhỏ dần theo chiều từ trên xuống dưới") còn to dần ra hai bên.
// Cả hai gộp thành PHỐI CẢNH THEO BÁN KÍNH quanh một điểm tụ VP nằm dưới mép dưới màn hình (các tia cam
// trong ảnh hướng dẫn toả ra từ đó):
//   S = c·r,  r = khoảng cách từ điểm ảnh tới VP = (cx, vy)
// Trên đường giữa (x = cx) nó trùng bản cũ S(y) = near + k·(y − y0), k = (far − near)/h (near ở mép trên,
// far ở mép dưới): c = −k, r_top = near/c, vy = y0 + r_top. Ra hai bên r lớn hơn nên S lớn hơn — với
// near 1,25 / far 0,6 thì góc dưới màn hình to hơn giữa mép dưới 39 %, góc trên to hơn giữa mép trên 10 %.
// Một đoạn dài L trên mặt nước nằm theo phương tiếp tuyến (quanh VP) hiện L·S px; theo phương bán kính
// hiện L·S·sq px (sq = độ ép dẹt nhìn xiên). Toạ độ cực (r, θ) quanh VP, θ = 0 thẳng lên, dương sang phải:
//   X = θ / c                      (dX = r·dθ / S)
//   Y = ln(r_top / r) / (c·sq)     (dY = −dr / (S·sq)); Y tăng khi đi xuống màn hình như y ảnh
// Đây là phép log-cực; VP ra xa vô cùng thì về đúng bản cũ. Lưới sóng chạy đều trên (X, Y) nên phép sóng
// đẳng hướng; lên màn hình vòng sóng thành elip, càng xuống dưới càng nhỏ và ở hai bên xoay theo tia về VP
// — cùng quy luật với vịt, lá (root xoay theo lean()) và lưới sóng trắng (water.js lấy mẫu trên mặt phẳng).
// radial = false: bản cũ chỉ co theo y (để so sánh; các trang soi dùng FLAT_PERSP, không phối cảnh).
import * as THREE from 'three';

export class Persp {
  constructor(view, sq, near, far, radial = true) {
    this.cx = view.x + view.w / 2;
    this.y0 = view.y;
    this.near = near;
    this.sq = sq;
    // k = 0 (tắt phối cảnh) làm ln(1)/0; dùng một giá trị rất nhỏ thì công thức tự về giới hạn
    this.k = Math.abs(far - near) < 1e-6 ? -1e-6 : (far - near) / view.h;
    this.radial = radial;
    this.c = -this.k;
    this.rTop = near / this.c;
    this.vy = this.y0 + this.rTop; // điểm tụ (cx, vy), dưới mép dưới khung nhìn
  }

  // toạ độ cực quanh điểm tụ: góc (0 = thẳng lên trên màn hình, dương = sang phải) và khoảng cách
  polar(x, y) {
    const u = x - this.cx, v = this.vy - y;
    return [Math.atan2(u, v), Math.hypot(u, v)];
  }

  // hệ số cỡ tại điểm ảnh (x, y): vịt, lá, vùng bấm, tốc độ trên màn hình đều nhân với số này
  S(x, y) {
    if (!this.radial) return this.near + this.k * (y - this.y0);
    return this.c * Math.hypot(x - this.cx, this.vy - y);
  }

  // góc nghiêng của "phương thẳng đứng" trên màn hình tại điểm ảnh (rad, dương = ngả sang phải):
  // vật nổi xoay root quanh trục nhìn theo góc này cho khớp lưới sóng và các tia phối cảnh
  lean(x, y) { return this.radial ? Math.atan2(x - this.cx, this.vy - y) : 0; }

  toPlane(x, y) {
    if (!this.radial) {
      const s = this.near + this.k * (y - this.y0);
      return [(x - this.cx) / s, Math.log(s / this.near) / (this.k * this.sq)];
    }
    const [th, r] = this.polar(x, y);
    return [th / this.c, Math.log(r / this.rTop) / (this.k * this.sq)];
  }

  toImage(X, Y) {
    if (!this.radial) {
      const s = this.near * Math.exp(Y * this.k * this.sq);
      return [this.cx + X * s, this.y0 + (s - this.near) / this.k];
    }
    const th = X * this.c, r = this.rTop * Math.exp(Y * this.k * this.sq);
    return [this.cx + r * Math.sin(th), this.vy - r * Math.cos(th)];
  }

  // Đạo hàm theo mặt phẳng (gX, gY) → đạo hàm theo px ảnh tại điểm ảnh (x, y) (quy tắc dây chuyền).
  // Bản theo y có số hạng xô lệch vì X phụ thuộc y (∂X/∂y = −(x − cx)·k / S²); bản bán kính thì
  // ∂X/∂x = cosθ/(c·r), ∂X/∂y = sinθ/(c·r), ∂Y/∂x = −sinθ/(c·sq·r), ∂Y/∂y = cosθ/(c·sq·r).
  gradToImage(gX, gY, x, y) {
    if (!this.radial) {
      const s = this.near + this.k * (y - this.y0);
      return [gX / s, gY / (s * this.sq) - (gX * (x - this.cx) * this.k) / (s * s)];
    }
    const [th, r] = this.polar(x, y), s = this.c * r, ct = Math.cos(th), st = Math.sin(th);
    return [(gX * ct - (gY * st) / this.sq) / s, (gX * st + (gY * ct) / this.sq) / s];
  }

  // (cx, y0, near, k) cho shader; sq (uSquash) và radial (uRadial) đi riêng. Shader suy ra VP từ bốn số này.
  uniform() { return new THREE.Vector4(this.cx, this.y0, this.near, this.k); }
}

// Mặc định cho các trang soi (không có khung nhìn): không phối cảnh, S = 1.
export const FLAT_PERSP = new THREE.Vector4(0, 0, 1, -1e-6);

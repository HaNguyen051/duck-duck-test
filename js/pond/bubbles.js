// Bong bóng nổi từ đáy hồ lên (bubble-1..3.svg của gói art). Ta đứng ở đáy nên bóng mới sinh ở GẦN (to, thị
// sai lớn), nổi lên là đi xa dần về phía mặt nước (nhỏ lại) — ngược với vịt lá nổi trên mặt. Chạm "viền tam
// giác" (BUBBLES.pop: đỉnh ở giữa-dưới, hai cạnh nghiêng ~36°) thì nổ thành một tia sáng (spark.svg) rồi tắt.
// Bấm vào mặt nước thì thêm vài bóng nhỏ (BUBBLES.tap) sinh ngay dưới chỗ bấm, nổi một quãng ngắn rồi vỡ và
// gợn nhẹ mặt nước — pool riêng `taps` để bấm dồn dập không giành chỗ của bóng nổi từ đáy.
import * as THREE from 'three';
import { BUBBLES } from './config.js';
import { spriteMaterial, setSpriteColor } from './assets.js';

const rand = (a, b) => a + Math.random() * (b - a);
const TAU = Math.PI * 2;

export class Bubbles {
  constructor({ textures, spark, scene, place, view, reduceMotion, onPop, scale = 1 }) {
    this.k = scale; // objScale: bóng nhỏ lại trên điện thoại dọc
    this.place = place;
    this.onPop = onPop; // (x, y, r) khi bóng của cú bấm vỡ — scene.js gợn mặt nước
    this.V = view;
    this.reduceMotion = reduceMotion;
    this.geo = new THREE.PlaneGeometry(1, 1);
    const sprite = (tex, order) => {
      const m = new THREE.Mesh(this.geo, spriteMaterial(tex));
      m.renderOrder = order; // trên vịt và lá (bóng ở giữa người xem và mặt nước), dưới giọt nước
      m.frustumCulled = false;
      m.visible = false;
      scene.add(m);
      return m;
    };
    this.items = Array.from({ length: BUBBLES.max }, (_, i) => ({ m: sprite(textures[i % textures.length], 18000), live: false }));
    this.taps = Array.from({ length: BUBBLES.tap.max }, (_, i) => ({ m: sprite(textures[i % textures.length], 18000), live: false, tap: true }));
    this.sparks = Array.from({ length: BUBBLES.max + BUBBLES.tap.max }, () => ({ m: sprite(spark, 18500), live: false }));
    this.next = rand(0.2, 1);
  }

  // Mép tam giác tại hoành độ x: bóng nổi tới đây thì nổ.
  popY(x) { const P = BUBBLES.pop; return P.apex[1] - Math.abs(x - P.apex[0]) * P.slope; }

  init(b, o) {
    Object.assign(b, {
      live: true, age: 0, x: o.x0, y: o.y0,
      wobHz: rand(BUBBLES.wobbleHz[0], BUBBLES.wobbleHz[1]), ph: rand(0, TAU),
      rot: rand(0, TAU), spin: rand(-0.25, 0.25),
    }, o);
    b.m.visible = true;
  }

  spawn() {
    const b = this.items.find((q) => !q.live);
    if (!b) return;
    const V = this.V, x = rand(V.x + 40, V.x + V.w - 40);
    this.init(b, {
      x0: x, y0: V.y + V.h + rand(40, 160),
      r0: rand(BUBBLES.r0[0], BUBBLES.r0[1]) * this.k,
      rise: rand(BUBBLES.rise[0], BUBBLES.rise[1]) * (this.reduceMotion ? 0.6 : 1),
      drift: Math.sign(x - (V.x + V.w / 2)) * rand(0.2, 1) * BUBBLES.drift, // dạt ra xa giữa
      wobble: BUBBLES.wobble * this.k, z0: BUBBLES.z[0], z1: BUBBLES.z[1], yEnd: null,
    });
  }

  // Bấm mặt nước tại (x, y) toạ độ ảnh: vài bóng nhỏ sinh ngay dưới chỗ bấm (gần người xem hơn), nổi lên một
  // quãng ngắn về phía mặt nước rồi vỡ. Hết chỗ trong pool thì thôi.
  spawnAt(x, y) {
    const T = BUBBLES.tap, n = Math.round(rand(T.count[0], T.count[1] + 0.99) - 0.49);
    for (let i = 0; i < n; i++) {
      const b = this.taps.find((q) => !q.live);
      if (!b) return;
      const y0 = y + rand(T.below[0], T.below[1]) * this.k;
      this.init(b, {
        x0: x + rand(-12, 12) * this.k, y0, yEnd: y0 - rand(T.travel[0], T.travel[1]) * this.k,
        r0: rand(T.r[0], T.r[1]) * this.k, rise: rand(T.rise[0], T.rise[1]) * this.k, drift: rand(-1, 1) * T.wobble * this.k,
        wobble: T.wobble * this.k, z0: T.z[0], z1: T.z[1], age: -i * 0.07, // so le nhau một chút
      });
      b.m.visible = false; // hiện khi age ≥ 0
    }
  }

  // boost > 1: nổ to hơn (bấm tay)
  pop(b, boost = 1) {
    b.live = false;
    b.m.visible = false;
    if (b.tap) this.onPop?.(b.x, b.y, b.r);
    const s = this.sparks.find((q) => !q.live);
    if (!s) return;
    Object.assign(s, { live: true, t: 0, x: b.x, y: b.y, z: b.z, size: b.r * BUBBLES.spark.size * boost, rot: rand(0, TAU) });
    s.m.visible = true;
  }

  // Bong bóng nào đang dưới con trỏ (toạ độ CSS)? Mỗi bóng ở độ cao z riêng (thị sai) nên quy con trỏ về toạ độ ảnh
  // ở đúng độ cao ấy rồi so với bán kính. Bóng sinh sau (gần hơn) ưu tiên.
  // touch: chạm ngón tay — vùng trúng rộng hơn (bóng co nhỏ dần khi nổi, ngón tay to hơn con trỏ chuột):
  // max(r × 1,6, 26 px CSS) thay cho r × 1,15.
  pickAt(clientX, clientY, pond, touch = false) {
    const minR = touch ? 26 / pond.view.s : 0;
    let hit = null, best = Infinity;
    for (const b of [...this.items, ...this.taps]) {
      if (!b.live || b.age < 0) continue;
      const q = pond.imageAt(clientX, clientY, b.z);
      const d = Math.hypot(q.ix - b.x, q.iy - b.y) / Math.max(b.r * (touch ? 1.6 : 1.15), minR);
      if (d <= 1 && (hit === null || b.z > hit.z || d < best * 0.5)) { hit = b; best = d; }
    }
    return hit;
  }

  update(t, dt) {
    if (dt > 0) {
      this.next -= dt;
      if (this.next <= 0) { this.spawn(); this.next = rand(BUBBLES.every[0], BUBBLES.every[1]) * (this.reduceMotion ? 1.6 : 1); }
    }
    for (const b of [...this.items, ...this.taps]) {
      if (!b.live) continue;
      b.age += dt;
      if (b.age < 0) continue;
      b.y = b.y0 - b.rise * b.age;
      b.x = b.x0 + b.drift * b.age + Math.sin(b.age * b.wobHz * TAU + b.ph) * b.wobble;
      const yPop = b.yEnd ?? this.popY(b.x); // bóng của cú bấm vỡ sau quãng ngắn của nó
      // tiến độ 0 (vừa sinh) → 1 (chạm viền): nhỏ dần và lùi xa dần (độ cao z giảm → thị sai nhỏ đi)
      const k = Math.min(1, Math.max(0, (b.y0 - b.y) / Math.max(40, b.y0 - yPop)));
      b.r = b.r0 * (1 - (1 - BUBBLES.shrink) * k);
      b.z = b.z0 + (b.z1 - b.z0) * k;
      if (b.y <= yPop || b.y < this.V.y - 120) { this.pop(b); continue; }
      b.m.visible = true;
      const d = b.r * 2;
      this.place(b.m, b.x, b.y, b.z, b.rot + b.spin * b.age, d, d);
      setSpriteColor(b.m.material, Math.min(1, b.age / (b.tap ? 0.12 : 0.5)) * BUBBLES.alpha);
    }
    const D = BUBBLES.spark.dur;
    for (const s of this.sparks) {
      if (!s.live) continue;
      s.t += dt;
      const k = s.t / D;
      if (k >= 1) { s.live = false; s.m.visible = false; continue; }
      // loé nhanh rồi tắt dần, nở to ra một chút
      const a = k < 0.2 ? k / 0.2 : 1 - (k - 0.2) / 0.8;
      const sz = s.size * (0.45 + 0.75 * k);
      this.place(s.m, s.x, s.y, s.z, s.rot + k * 0.5, sz, sz);
      setSpriteColor(s.m.material, a);
    }
  }

  dispose() { this.geo.dispose(); }
}

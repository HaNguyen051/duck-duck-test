// Hai chú vịt NỔI TRÊN mặt nước, dựng bằng khối 3D thật (duck3d.js) chứ không còn dùng khung ảnh.
//
// Mặt nước trong tranh bị ép dẹt theo chiều dọc 0,39 lần (đo từ chính các khung turntable cũ).
// Nên cách dựng là: nghiêng cả con vịt đi asin(0,39) ≈ 23° cho khớp mặt nước, rồi xoay quanh trục
// đứng theo hướng bơi. Thế là ra đúng hiệu ứng turntable mà mượt ở mọi góc, không còn khái niệm khung.
//
// Mực nước cắt thân vịt được tính thẳng trong shader theo độ cao của từng đỉnh, nên chính xác tuyệt
// đối — bỏ được toàn bộ đoạn dò mực nước theo cột, cắt ảnh, chừa lề và hoà hai khung của bản cũ.
import * as THREE from 'three';
import { DUCKS, DUCK3D, Z, CAMERA } from './config.js';
import { buildDuckGeometry, duckMaterial } from './duck3d.js';
import { waveAt } from './water.js';

const rand = (a, b) => a + Math.random() * (b - a);
const TAU = Math.PI * 2;
const wrap = (a) => { a %= TAU; return a < 0 ? a + TAU : a; };
const delta = (a, b) => { const d = wrap(a - b); return d > Math.PI ? d - TAU : d; };

export class Ducks {
  constructor({ scene, view, world, sim, ambGain, reduceMotion, squash, centre }) {
    this.V = view;
    this.ambGain = ambGain;
    this.reduceMotion = reduceMotion;
    this.squash = squash || 0.39;
    this.centre = centre; // tâm khung nhìn (toạ độ ảnh) — shader cần để quy về toạ độ ảnh
    this.s = { h: 0, gx: 0, gy: 0 };
    this.w = { h: 0, gx: 0, gy: 0 };
    this.scale = DUCKS.scale;

    // Mặt cắt thân ở mực nước: nửa trục dọc thân và ngang thân của hình elip tiếp nước.
    const D = DUCK3D, kz = Math.max(0, 1 - (D.waterY / (D.bodyHeight * 0.5)) ** 2);
    this.contact = [D.bodyLen * 0.5 * Math.sqrt(kz) * this.scale, D.bodyWidth * 0.5 * Math.sqrt(kz) * this.scale];

    this.geo = buildDuckGeometry();
    this.geo.translate(0, -D.waterY, 0); // gốc toạ độ đặt đúng mực nước cho dễ đặt vị trí

    this.items = [];
    for (let k = 0; k < DUCKS.count; k++) {
      const mat = duckMaterial();
      mat.uniforms.uCentre.value.set(centre[0], centre[1]);
      mat.uniforms.uPaddle.value = reduceMotion ? DUCK3D.paddle * 0.4 : DUCK3D.paddle;
      const mesh = new THREE.Mesh(this.geo, mat);
      const yaw = new THREE.Group(); yaw.add(mesh);
      const tilt = new THREE.Group(); tilt.add(yaw);
      tilt.rotation.x = -Math.asin(this.squash); // nghiêng cho khớp độ ép dẹt của mặt nước
      const root = new THREE.Group(); root.add(tilt);
      root.renderOrder = 10000 + k;
      scene.add(root);

      const it = {
        root, yaw, mat,
        x: view.x + view.w * (k === 0 ? 0.34 : 0.66),
        y: view.y + view.h * (k === 0 ? 0.44 : 0.56),
        vx: 0, vy: 0,
        head: rand(0, TAU),
        goal: null, rest: rand(0.4, 2),
        held: false, tx: 0, ty: 0, grabX: 0, grabY: 0,
        bob: 0, wake: 0,
        phase: rand(0, TAU),
      };
      this.items.push(it);
      this.pickGoal(it);
    }
  }

  /* -------------------------------------------------------------- hướng */
  // Vector di chuyển trên màn hình → hướng trên mặt nước (bù lại độ ép dẹt).
  headingOf(vx, vy) { return Math.atan2(vy / this.squash, vx); }
  dirOf(head) { return [Math.cos(head), Math.sin(head) * this.squash]; }

  pickGoal(it) {
    const V = this.V, m = DUCKS.pickMargin;
    for (let i = 0; i < 24; i++) {
      const gx = rand(V.x + m, V.x + V.w - m), gy = rand(V.y + m, V.y + V.h - m);
      if (Math.hypot(gx - it.x, gy - it.y) >= DUCKS.minTrip) { it.goal = [gx, gy]; return; }
    }
    it.goal = [rand(V.x + m, V.x + V.w - m), rand(V.y + m, V.y + V.h - m)];
  }

  /* -------------------------------------------------------------- vòng lặp */
  update(t, dt, sim) {
    sim.clearSolid();
    for (const it of this.items) {
      if (dt > 0) this.drive(it, t, dt, sim);
      this.draw(it, t, sim);
      sim.stampEllipse(it.x, it.y, this.contact[0], this.contact[1], it.head, this.squash);
    }
  }

  drive(it, t, dt, sim) {
    let wantX = 0, wantY = 0;
    if (it.held) {
      wantX = (it.tx - it.x) * DUCKS.dragFollow;
      wantY = (it.ty - it.y) * DUCKS.dragFollow;
      const sp = Math.hypot(wantX, wantY), cap = DUCKS.speed * 3.4;
      if (sp > cap) { wantX *= cap / sp; wantY *= cap / sp; }
    } else if (it.rest > 0) {
      it.rest -= dt;
      if (Math.random() < dt * 0.4) it.head = wrap(it.head + rand(-0.8, 0.8));
      if (it.rest <= 0) this.pickGoal(it);
    } else if (it.goal) {
      const dx = it.goal[0] - it.x, dy = it.goal[1] - it.y, d = Math.hypot(dx, dy);
      if (d < 46) { it.goal = null; it.rest = rand(DUCKS.restMin, DUCKS.restMax); }
      else {
        const bearing = this.headingOf(dx, dy);
        const turn = delta(bearing, it.head);
        it.head = wrap(it.head + Math.sign(turn) * Math.min(Math.abs(turn), DUCKS.turnRate * dt));
        const [ux, uy] = this.dirOf(it.head);
        const ease = Math.max(0.15, Math.cos(Math.min(Math.abs(turn), Math.PI) * 0.5));
        wantX = ux * DUCKS.speed * ease;
        wantY = uy * DUCKS.speed * ease;
      }
    }

    it.vx += (wantX - it.vx) * Math.min(1, DUCKS.accel * dt);
    it.vy += (wantY - it.vy) * Math.min(1, DUCKS.accel * dt);
    it.x += it.vx * dt;
    it.y += it.vy * dt;

    const sp = Math.hypot(it.vx, it.vy);
    if (it.held && sp > 6) {
      const bearing = this.headingOf(it.vx, it.vy);
      const turn = delta(bearing, it.head);
      it.head = wrap(it.head + Math.sign(turn) * Math.min(Math.abs(turn), DUCKS.turnRate * 1.6 * dt));
    }

    const V = this.V, m = DUCKS.pickMargin * 0.5;
    if (it.x < V.x + m) { it.x = V.x + m; it.vx = Math.abs(it.vx); }
    if (it.x > V.x + V.w - m) { it.x = V.x + V.w - m; it.vx = -Math.abs(it.vx); }
    if (it.y < V.y + m) { it.y = V.y + m; it.vy = Math.abs(it.vy); }
    if (it.y > V.y + V.h - m) { it.y = V.y + V.h - m; it.vy = -Math.abs(it.vy); }

    // Sóng rẽ ra sau đuôi. Vịt bơi gần như liên tục nên đây là nguồn sóng thường trực — mạnh tay
    // một chút là cả mặt ao đầy vòng sóng chồng chéo.
    it.wake -= dt;
    if (sp > DUCKS.wakeMinSpeed && it.wake <= 0 && !this.reduceMotion) {
      it.wake = DUCKS.wakeEvery;
      const r = this.contact[0];
      const ux = it.vx / sp, uy = it.vy / sp;
      const amt = Math.min(1, sp / DUCKS.speed) * DUCKS.wakeGain;
      sim.disturb(it.x - ux * r, it.y - uy * r, r * 0.6, -amt);
    }
  }

  draw(it, t, sim) {
    const S = this.s, W = this.w;
    sim.sample(it.x, it.y, S);
    waveAt(it.x, it.y, t, this.ambGain, W);
    it.bob = S.h * 0.35 + W.h * 0.8 + Math.sin(t * 0.8 + it.phase) * 1.4;

    it.yaw.rotation.y = it.head;
    // nhấp nhô: mực nước trong shader dịch ngược lại nên vịt chìm nông sâu theo sóng
    it.mat.uniforms.uWaterY.value = it.bob * DUCKS.bobGain;
    it.mat.uniforms.uTime.value = t;

    // Đặt gốc con vịt (đúng mực nước) vào toạ độ ảnh, bù thị sai như các lớp khác.
    // Cộng thêm một chút theo chiều sâu màn hình để con ở dưới che con ở trên khi chúng chồng nhau.
    const z = Z.duck + it.y * 0.004;
    const kp = (CAMERA.D - z) / CAMERA.D;
    it.root.position.set((it.x - this.centre[0]) * kp, -(it.y - this.centre[1]) * kp, z);
    it.root.scale.setScalar(this.scale * kp);
  }

  /* -------------------------------------------------------------- con trỏ */
  // Hình bầu dục tiếp nước, để lá không trôi xuyên qua vịt.
  bodies() {
    return this.items.map((it) => {
      const [a, b] = this.contact;
      const ch = Math.abs(Math.cos(it.head)), sh = Math.abs(Math.sin(it.head));
      return { cx: it.x, cy: it.y, rx: a * ch + b * sh, ry: (a * sh + b * ch) * this.squash };
    });
  }

  pick(ix, iy) {
    for (let k = this.items.length - 1; k >= 0; k--) {
      const it = this.items[k];
      const dx = ix - it.x, dy = (iy - it.y) / this.squash;
      const ch = Math.cos(it.head), sh = Math.sin(it.head);
      const u = dx * ch + dy * sh, v = -dx * sh + dy * ch;
      const [a, b] = this.contact;
      // nới rộng một chút theo chiều dọc màn hình vì đầu và cổ nhô lên khỏi mặt nước
      if ((u * u) / (a * a * 1.3) + (v * v) / (b * b * 1.6) <= 1) return k;
    }
    return -1;
  }

  grab(k, ix, iy) {
    const it = this.items[k];
    it.held = true;
    it.goal = null;
    it.rest = 0;
    it.grabX = it.x - ix;
    it.grabY = it.y - iy;
    it.tx = it.x; it.ty = it.y;
  }

  moveHeld(k, ix, iy) {
    const it = this.items[k], V = this.V, m = DUCKS.pickMargin * 0.5;
    it.tx = Math.max(V.x + m, Math.min(V.x + V.w - m, ix + it.grabX));
    it.ty = Math.max(V.y + m, Math.min(V.y + V.h - m, iy + it.grabY));
  }

  release(k) {
    const it = this.items[k];
    it.held = false;
    it.rest = rand(0.3, 1.2);
  }
}

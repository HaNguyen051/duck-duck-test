// Lá sen: 2 model 3D (leaf3d.js) nhân bản với cỡ khác nhau, trôi theo dòng, bị sóng đẩy, va nhau và vòng qua vịt.
// Mỗi lá là một mesh với vật liệu "vật nổi" dùng chung với vịt (floater.js): lá nổi → nhìn xuyên qua mặt
// nước nên xỉn và lay theo sóng. Lá nhấp nhô và nghiêng theo mặt nước. Lá KHÔNG xoay — mọi lá cùng một
// hướng (khe lá chĩa lên phía trên màn hình; đã thử cho mỗi lá một góc ngẫu nhiên: người dùng thấy "xiên xỏ
// đủ hướng", bỏ). Lá mới (sen_1, sen_2) không có cuống — người dùng muốn giữ đúng model gốc.
import * as THREE from 'three';
import { FLOW, LEAVES, Z, CAMERA, PERSPECTIVE, surfaceBottom } from './config.js';
import { leafMaterial } from './leaf3d.js';
import { bindFloater } from './floater.js';
import { waveAt } from './water.js';

const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class Leaves {
  // view: khung nhìn (toạ độ ảnh) — lá trôi trong dải này và vòng lại ở hai mép.
  constructor({ models, scene, view, sim, persp, centre, squash, ambGain, reduceMotion, net }) {
    this.V = view;
    this.persp = persp;
    this.centre = centre;
    this.squash = squash;
    this.ambGain = ambGain;
    this.reduceMotion = reduceMotion;
    this.s = { h: 0, gx: 0, gy: 0 };
    this.w = { h: 0, gx: 0, gy: 0 };
    const count = models.length ? Math.round(clamp((view.w * view.h) / LEAVES.areaPerLeaf, LEAVES.minCount, LEAVES.maxCount)) : 0;

    // Cỡ lá: chia đều dải [scaleMin, scaleMax] thành `count` khoảng, mỗi lá một khoảng (có lệch ngẫu nhiên trong
    // khoảng) rồi xáo — thuần ngẫu nhiên hay cho vài lá cùng cỡ, mà chỉ có 2 mẫu lá nên cỡ phải khác nhau rõ.
    const sizes = Array.from({ length: count }, (_, i) => LEAVES.scaleMin + ((LEAVES.scaleMax - LEAVES.scaleMin) * (i + rand(0.15, 0.85))) / count)
      .sort(() => Math.random() - 0.5);
    this.items = [];
    this.top = 0;
    for (let k = 0; k < count; k++) {
      const m = models[k % models.length];
      const s = sizes[k];
      const mat = leafMaterial(m, ambGain);
      bindFloater(mat, { sim, centre, squash, net, reduceMotion });
      mat.uniforms.uTint.value.set(rand(0.94, 1.04), rand(0.97, 1.03), rand(0.94, 1.02)); // lệch màu rất nhẹ cho đỡ đều tăm tắp
      const mesh = new THREE.Mesh(m.geometry, mat);
      mesh.frustumCulled = false;
      // Mỗi vật tự xoá bộ đệm độ sâu trước khi vẽ: thứ tự chồng lớp giữa các vật do scene.js xếp theo
      // trục y (Y-sort), còn độ sâu chỉ dùng để một lá tự che chính nó (cuống sau mặt lá).
      mesh.onBeforeRender = (renderer) => renderer.clearDepth();
      // root (vị trí, cỡ) → tilt (nghiêng 23° theo mặt nước) → sway (nhấp nhô, nghiêng theo sóng) → mesh
      const sway = new THREE.Group(); sway.add(mesh);
      const tilt = new THREE.Group(); tilt.add(sway);
      tilt.rotation.x = -Math.asin(squash);
      const root = new THREE.Group(); root.add(tilt);
      scene.add(root);
      const p = {
        m, s, mat, mesh, sway, root,
        x: 0, y: 0, vx: 0, vy: 0, ax: 0, ay: 0,
        lift: 0, vz: 0, wasLifted: false,
        r: m.radius * s, // bán kính mặt lá, px trên mặt phẳng nước
        speed: FLOW.speed + rand(-FLOW.jitter, FLOW.jitter),
        phase: rand(0, 100),
        order: this.top++,
        held: false, tx: 0, ty: 0, gx: 0, gy: 0,
        roll: 0, pitch: 0, yaw: 0,
        ps: 1, // hệ số phối cảnh theo y (cập nhật mỗi bước)
      };
      p.R = p.r; // bán kính bao (dùng khi sinh/vòng lại ở mép)
      this.items.push(p);
    }
    this.spawnAll();
  }

  /* -------------------------------------------------------------- spawn */
  clearance(leaf, x, y) {
    let best = Infinity;
    for (const o of this.items) {
      if (o === leaf || !o.placed) continue;
      best = Math.min(best, Math.hypot(o.x - x, (o.y - y) / this.squash) - (o.r + leaf.r));
    }
    return best;
  }

  pickY(leaf, x) {
    let bestY = this.V.y + this.V.h / 2, bestScore = -Infinity;
    for (let i = 0; i < 14; i++) {
      const y = rand(this.V.y + 60, Math.min(this.V.y + this.V.h - 60, surfaceBottom(x) - 70)); // chỉ trên mặt nước
      const sc = this.clearance(leaf, x, y);
      if (sc > bestScore) { bestScore = sc; bestY = y; }
    }
    return bestY;
  }

  spawnAll() {
    if (!this.items.length) return;
    const maxR = Math.max(...this.items.map((p) => p.R));
    const x0 = this.V.x - maxR * 0.5, x1 = this.V.x + this.V.w + maxR * 0.5;
    const order = this.items.map((_, i) => i).sort(() => Math.random() - 0.5);
    order.forEach((idx, k) => {
      const p = this.items[idx];
      p.x = x0 + ((x1 - x0) * (k + rand(0.2, 0.8))) / this.items.length;
      p.y = this.pickY(p, p.x);
      p.vx = FLOW.dir * p.speed;
      p.placed = true;
    });
    for (let i = 0; i < 180; i++) this.integrate(1 / 60, i / 60, null);
  }

  respawn(p) {
    // sinh lại với cỡ mới (khác hẳn cỡ cũ) để bộ lá trên màn hình luôn đổi
    const span = LEAVES.scaleMax - LEAVES.scaleMin;
    let s = rand(LEAVES.scaleMin, LEAVES.scaleMax);
    if (Math.abs(s - p.s) < span * 0.25) s = p.s > (LEAVES.scaleMin + LEAVES.scaleMax) / 2 ? LEAVES.scaleMin + rand(0, span * 0.4) : LEAVES.scaleMax - rand(0, span * 0.4);
    p.s = s; p.r = p.m.radius * s; p.R = p.r;
    p.x = FLOW.dir > 0 ? this.V.x - p.R - rand(0, 40) : this.V.x + this.V.w + p.R + rand(0, 40);
    p.placed = false;
    p.y = this.pickY(p, p.x + FLOW.dir * p.R);
    p.placed = true;
    p.vx = FLOW.dir * p.speed;
    p.vy = 0;
  }

  /* -------------------------------------------------------------- physics */
  update(dt, t, sim) {
    if (dt <= 0) return;
    const sub = 2, h = dt / sub;
    for (let i = 0; i < sub; i++) this.integrate(h, t, sim);
    for (const p of this.items) {
      if (p.held) continue;
      const out = FLOW.dir > 0 ? p.x - p.R > this.V.x + this.V.w + 10 : p.x + p.R < this.V.x - 10;
      if (out) this.respawn(p);
      const back = this.V.x - p.R - 280, fwd = this.V.x + this.V.w + p.R + 280;
      if (FLOW.dir > 0 && p.x < back) { p.x = back; p.vx = Math.max(p.vx, 0); }
      if (FLOW.dir < 0 && p.x > fwd) { p.x = fwd; p.vx = Math.min(p.vx, 0); }
    }
    if (sim) this.wakes(dt, sim);
  }

  integrate(h, t, sim) {
    const L = this.items, S = this.s, sq = this.squash;
    for (const p of L) { p.ax = 0; p.ay = 0; p.ps = this.persp.S(p.x, p.y); }
    for (const p of L) {
      if (p.held) {
        const K = LEAVES.kHold, C = 2 * Math.sqrt(K);
        p.ax += (p.tx - p.x) * K - p.vx * C;
        p.ay += (p.ty - p.y) * K - p.vy * C;
        continue;
      }
      const fx = FLOW.dir * p.speed * p.ps, fy = Math.sin(t * 0.11 + p.phase) * FLOW.meander; // xa thì trôi chậm hơn trên màn hình
      p.ax += (fx - p.vx) * LEAVES.kFlow;
      p.ay += (fy - p.vy) * LEAVES.kFlow;
      if (sim) {
        // sóng đẩy lá theo độ dốc mặt nước, lấy mẫu quanh mặt lá (elip trên màn hình)
        let gx = 0, gy = 0;
        const rr = p.r * p.ps * 0.6;
        for (const [ox, oy] of [[0, 0], [rr, 0], [-rr, 0], [0, rr * sq], [0, -rr * sq]]) {
          sim.sample(p.x + ox, p.y + oy, S);
          gx += S.gx; gy += S.gy;
        }
        p.ax -= (gx / 5) * LEAVES.kWave;
        p.ay -= (gy / 5) * LEAVES.kWave * sq; // độ dốc dọc màn hình đã bị ép dẹt, lực trên mặt nước nhỏ lại tương ứng
      }
      const top = this.V.y + 12, bot = Math.min(this.V.y + this.V.h - 12, surfaceBottom(p.x) - p.r * p.ps * sq - 10); // không trôi xuống nước sâu
      if (p.y < top) p.ay += (top - p.y) * 3;
      if (p.y > bot) p.ay += (bot - p.y) * 3;
    }
    // lá va lá: lò xo mềm + giảm chấn, khoảng cách đo trên mặt phẳng nước (dọc màn hình chia cho squash)
    for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) {
      const a = L[i], b = L[j];
      const dx = b.x - a.x, dy = (b.y - a.y) / sq, d = Math.hypot(dx, dy) || 0.001, min = a.r * a.ps + b.r * b.ps;
      if (d >= min) continue;
      const nx = dx / d, ny = dy / d, pen = min - d;
      const rvx = b.vx - a.vx, rvy = (b.vy - a.vy) / sq, rvn = rvx * nx + rvy * ny;
      const f = pen * LEAVES.kCollide - Math.min(0, rvn) * 4;
      const ma = a.s * a.s, mb = b.s * b.s;
      const wa = a.held ? 0 : b.held ? 1 : mb / (ma + mb), wb = b.held ? 0 : a.held ? 1 : ma / (ma + mb);
      a.ax -= nx * f * wa * 2; a.ay -= ny * f * wa * 2 * sq;
      b.ax += nx * f * wb * 2; b.ay += ny * f * wb * 2 * sq;
    }
    for (const p of L) {
      p.vx += p.ax * h; p.vy += p.ay * h;
      p.x += p.vx * h; p.y += p.vy * h;
      const zt = p.held ? LEAVES.lift : 0;
      p.vz += ((zt - p.lift) * 90 - p.vz * 12) * h;
      p.lift += p.vz * h;
    }
  }

  // Lá không chui qua vùng tiếp nước của vịt: đẩy ra theo hướng thoát gần nhất.
  avoidDucks(ducks) {
    for (const p of this.items) {
      for (const d of ducks) {
        const Rx = d.rx + p.r * p.ps * 0.8, Ry = d.ry + p.r * p.ps * 0.8 * this.squash;
        const qx = (p.x - d.cx) / Rx, qy = (p.y - d.cy) / Ry, f2 = qx * qx + qy * qy;
        if (f2 >= 1 || f2 < 1e-6) continue;
        const f = Math.sqrt(f2);
        p.x = d.cx + (qx / f) * Rx;
        p.y = d.cy + (qy / f) * Ry;
        let nx = qx / Rx, ny = qy / Ry;
        const nl = Math.hypot(nx, ny) || 1; nx /= nl; ny /= nl;
        const vn = p.vx * nx + p.vy * ny;
        if (vn < 0) { p.vx -= vn * nx * 1.2; p.vy -= vn * ny * 1.2; }
      }
    }
  }

  // Sóng do lá tạo ra: lá đi lệch dòng hoặc bị giữ thì rẽ nước; thả xuống thì có vòng sóng.
  wakes(dt, sim) {
    const k60 = dt * 60, sq = this.squash;
    for (const p of this.items) {
      if (p.held && p.lift > LEAVES.lift * 0.6) p.wasLifted = true;
      if (!p.held && p.wasLifted && p.lift < 1) { this.ring(p, sim, -1.8); p.wasLifted = false; }
      const rvx = p.vx - FLOW.dir * p.speed, rvy = p.vy, sp = Math.hypot(rvx, rvy);
      if (sp < 10) continue;
      const nx = rvx / sp, ny = rvy / sp;
      const k = Math.min(sp, 420) * 0.006 * k60 * (p.held ? 1.5 : 1);
      const r = p.r * p.ps;
      sim.disturb(p.x + nx * r * 0.95, p.y + ny * r * 0.95 * sq, 9, k);
      sim.disturb(p.x - nx * r * 0.95, p.y - ny * r * 0.95 * sq, 9, -k * 0.7);
    }
  }

  ring(p, sim, amount) {
    for (let i = 0; i < 14; i++) {
      const th = (i / 14) * Math.PI * 2;
      sim.disturb(p.x + Math.cos(th) * p.r * p.ps, p.y + Math.sin(th) * p.r * p.ps * this.squash, 8, amount);
    }
  }

  // Mặt lá làm sóng yếu đi bên dưới (chỉ mặt lá — cuống không tính): đĩa bán kính p.r trên mặt nước,
  // lưới tự lo phối cảnh và ép dẹt.
  stampCover(sim) {
    sim.clearCover();
    for (const p of this.items) sim.coverDisc(p.x, p.y, p.r);
  }

  /* -------------------------------------------------------------- pointer */
  // Mặt lá trên màn hình là elip (r, r·squash) quanh tâm lá; lá đang nhấc lên thì tính theo chỗ nó đang được vẽ.
  pick(ix, iy) {
    return [...this.items].sort((a, b) => b.order - a.order).find((p) => {
      const rp = p.r * p.ps, dx = (ix - p.x) / rp, dy = (iy - (p.y - p.lift * 0.92)) / (rp * this.squash);
      return dx * dx + dy * dy <= 1.05;
    }) || null;
  }

  grab(p, ix, iy, sim) {
    p.held = true;
    p.gx = p.x - ix; p.gy = p.y - iy;
    p.tx = p.x; p.ty = p.y;
    p.order = ++this.top;
    if (sim) this.ring(p, sim, 0.9);
  }

  moveHeld(p, ix, iy) {
    p.tx = clamp(ix + p.gx, this.V.x - p.R, this.V.x + this.V.w + p.R);
    p.ty = clamp(iy + p.gy, this.V.y - p.r, surfaceBottom(p.tx) - p.r * p.ps * this.squash);
  }

  release(p, vx, vy) {
    p.held = false;
    const sp = Math.hypot(vx, vy), k = sp > LEAVES.maxThrow ? LEAVES.maxThrow / sp : 1;
    p.vx = vx * k; p.vy = vy * k;
  }

  // Cho scene.js xếp lớp theo trục y: { y: toạ độ ảnh của chân vật, mesh, lift: đang nhấc lên khỏi mặt nước }.
  drawables() {
    return this.items.map((p) => ({ y: p.y, mesh: p.mesh, lift: p.held || p.lift > 1 }));
  }

  /* -------------------------------------------------------------- draw */
  sync(t, dt, sim) {
    const S = this.s, W = this.w, sq = this.squash;
    for (const p of this.items) {
      // nổi theo mặt nước: nhấp nhô theo chiều cao, nghiêng theo độ dốc (chiếu lên hệ xoay cố định của lá)
      sim.sample(p.x, p.y, S);
      waveAt(p.x, p.y, t, this.ambGain, W, this.persp);
      const bob = (S.h * 0.5 + W.h) * (this.reduceMotion ? 0.5 : 1);
      const gx = S.gx + W.gx, gy = (S.gy + W.gy) * sq;
      const c = Math.cos(p.yaw), s = Math.sin(p.yaw);
      // trong hệ của lá: trục X' = (c, −s)… cùng quy ước với xoay quanh Y của three
      const sf = gx * c - gy * s, sl = gx * s + gy * c;
      const pT = clamp(Math.atan(sf) * 1.6, -0.12, 0.12), rT = -clamp(Math.atan(sl) * 1.6, -0.12, 0.12);
      const e = dt > 0 ? 1 - Math.exp(-dt * 6) : 1;
      p.pitch += (pT - p.pitch) * e;
      p.roll += (rT - p.roll) * e;
      p.sway.rotation.set(p.roll, p.yaw, p.pitch);
      p.sway.position.y = bob;

      // đặt gốc lá (tâm mặt lá, ngay mực nước) vào toạ độ ảnh, bù thị sai; nhấc lên khi đang kéo
      const z = Z.leaf + p.lift, kp = (CAMERA.D - z) / CAMERA.D;
      p.root.position.set((p.x - this.centre[0]) * kp, -(p.y - this.centre[1]) * kp, z);
      p.ps = this.persp.S(p.x, p.y);
      p.root.scale.setScalar(p.s * kp * p.ps); // phối cảnh: cao hơn trên màn hình / ra hai bên thì to hơn
      p.root.rotation.z = -this.persp.lean(p.x, p.y) * PERSPECTIVE.lean; // cuống ngả theo tia về điểm tụ
      p.mat.uniforms.uKp.value = kp;
      p.mat.uniforms.uTime.value = t;
    }
  }
}

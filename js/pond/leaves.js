// Lá sen nhân bản từ lá mẫu: trôi theo dòng, bị sóng đẩy, va nhau và vòng qua vịt,
// ra khỏi bờ thì vòng lại; có thể giữ / kéo / ném bằng chuột hoặc ngón tay.
import * as THREE from 'three';
import { FLOW, LEAVES, Z, SIM, SUN } from './config.js';
import { textureFrom, spriteMaterial, setSpriteColor } from './assets.js';

const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
// hướng tới mặt trời trong toạ độ ảnh (y xuống) và hướng bóng đổ (ngược lại)
const SUN2 = (() => { const l = Math.hypot(SUN.dir[0], SUN.dir[1]); return [SUN.dir[0] / l, -SUN.dir[1] / l]; })();
const SHADOW_DIR = [-SUN2[0], -SUN2[1]];
const RING_POINTS = 14;

export class Leaves {
  // view: khung nhìn (toạ độ ảnh) — lá trôi trong dải này và vòng lại ở hai mép của nó.
  constructor({ templates, ducks, scene, place, view }) {
    this.place = place;
    this.V = view;
    const count = Math.round(Math.min(LEAVES.maxCount, Math.max(LEAVES.minCount, (view.w * view.h) / LEAVES.areaPerLeaf)));
    this.ducks = ducks.map((d) => ({ cx: d.center.x, cy: d.center.y, rx: d.radii.x, ry: d.radii.y }));
    this.tpl = templates.map((t) => ({
      ...t,
      tex: textureFrom(t.canvas),
      stemTex: textureFrom(t.stem),
      ringTex: textureFrom(t.ring),
      shadowTex: textureFrom(t.shadow),
      geo: new THREE.PlaneGeometry(t.w, t.h),
    }));
    this.items = [];
    this.top = 0;
    this.s = { h: 0, gx: 0, gy: 0 };
    for (let k = 0; k < count; k++) {
      const t = this.tpl[k % this.tpl.length];
      const s = rand(LEAVES.scaleMin, LEAVES.scaleMax);
      const leaf = {
        t, s,
        flip: Math.random() < 0.5 ? -1 : 1,
        a: rand(-Math.PI, Math.PI), va: 0,
        x: 0, y: 0, vx: 0, vy: 0, ax: 0, ay: 0, aa: 0,
        lift: 0, vz: 0, wasLifted: false,
        r: t.padR * s, R: t.boundR * s,
        speed: FLOW.speed + rand(-FLOW.jitter, FLOW.jitter),
        phase: rand(0, 100),
        order: this.top++,
        held: false, tx: 0, ty: 0, gx: 0, gy: 0,
        tint: [rand(0.9, 1.05), rand(0.95, 1.04), rand(0.85, 1.0)],
        bright: 1,
      };
      leaf.stem = this.mesh(t.geo, t.stemTex, 1);
      leaf.shadow = this.mesh(t.geo, t.shadowTex, 2);
      leaf.ring = this.mesh(t.geo, t.ringTex, 3);
      leaf.mesh = this.mesh(t.geo, t.tex, 10);
      [leaf.stem, leaf.shadow, leaf.ring, leaf.mesh].forEach((m) => scene.add(m));
      this.items.push(leaf);
    }
    this.spawnAll();
  }

  mesh(geo, tex, order) {
    const m = new THREE.Mesh(geo, spriteMaterial(tex));
    m.renderOrder = order;
    m.frustumCulled = false;
    return m;
  }

  /* -------------------------------------------------------------- spawn */
  clearance(leaf, x, y) {
    let best = Infinity;
    for (const o of this.items) {
      if (o === leaf || !o.placed) continue;
      best = Math.min(best, Math.hypot(o.x - x, o.y - y) - (o.r + leaf.r));
    }
    for (const d of this.ducks) {
      const q = Math.hypot((x - d.cx) / (d.rx + leaf.r), (y - d.cy) / (d.ry + leaf.r));
      best = Math.min(best, (q - 1) * Math.min(d.rx, d.ry));
    }
    return best;
  }

  pickY(leaf, x) {
    let bestY = this.V.y + this.V.h / 2, bestScore = -Infinity;
    for (let i = 0; i < 14; i++) {
      const y = rand(this.V.y + 50, this.V.y + this.V.h - 50);
      const sc = this.clearance(leaf, x, y);
      if (sc > bestScore) { bestScore = sc; bestY = y; }
    }
    return bestY;
  }

  spawnAll() {
    const maxR = Math.max(...this.items.map((p) => p.R));
    const x0 = this.V.x - maxR * 0.5, x1 = this.V.x + this.V.w + maxR * 0.5;
    const order = this.items.map((_, i) => i).sort(() => Math.random() - 0.5);
    order.forEach((idx, k) => {
      const p = this.items[idx];
      p.x = x0 + (x1 - x0) * (k + rand(0.2, 0.8)) / this.items.length;
      p.y = this.pickY(p, p.x);
      p.vx = FLOW.dir * p.speed;
      p.placed = true;
    });
    // chạy trước vài giây để các lá tự giãn ra, không chồng lên nhau lúc mở trang
    for (let i = 0; i < 240; i++) this.integrate(1 / 60, i / 60, null);
  }

  respawn(p) {
    const enterLeft = FLOW.dir > 0;
    p.x = enterLeft ? this.V.x - p.R - rand(0, 40) : this.V.x + this.V.w + p.R + rand(0, 40);
    p.placed = false;
    p.y = this.pickY(p, p.x + FLOW.dir * p.R);
    p.placed = true;
    p.vx = FLOW.dir * p.speed; p.vy = 0;
    p.a = rand(-Math.PI, Math.PI); p.va = 0;
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
      // bị ném ngược dòng quá xa thì giữ lại ở mép
      const back = this.V.x - p.R - 260, fwd = this.V.x + this.V.w + p.R + 260;
      if (FLOW.dir > 0 && p.x < back) { p.x = back; p.vx = Math.max(p.vx, 0); }
      if (FLOW.dir < 0 && p.x > fwd) { p.x = fwd; p.vx = Math.min(p.vx, 0); }
    }
    if (sim) this.wakes(dt, sim);
  }

  integrate(h, t, sim) {
    const L = this.items, S = this.s;
    for (const p of L) { p.ax = 0; p.ay = 0; p.aa = 0; }
    for (const p of L) {
      if (p.held) {
        const K = LEAVES.kHold, C = 2 * Math.sqrt(K);
        p.ax += (p.tx - p.x) * K - p.vx * C;
        p.ay += (p.ty - p.y) * K - p.vy * C;
        p.aa -= p.va * 3;
        continue;
      }
      const fx = FLOW.dir * p.speed, fy = Math.sin(t * 0.11 + p.phase) * FLOW.meander;
      p.ax += (fx - p.vx) * LEAVES.kFlow;
      p.ay += (fy - p.vy) * LEAVES.kFlow;
      if (sim) {
        // độ dốc trung bình dưới mặt lá: sóng đẩy lá trôi xuôi theo sườn sóng
        let gx = 0, gy = 0, tq = 0;
        const rr = p.r * 0.6;
        for (const [ox, oy] of [[0, 0], [rr, 0], [-rr, 0], [0, rr], [0, -rr]]) {
          sim.sample(p.x + ox, p.y + oy, S);
          gx += S.gx; gy += S.gy;
          tq += ox * S.gy - oy * S.gx; // sóng lệch một bên làm lá xoay
        }
        p.ax -= (gx / 5) * LEAVES.kWave;
        p.ay -= (gy / 5) * LEAVES.kWave;
        p.aa -= tq / (5 * rr || 1) * 6;
      }
      const top = this.V.y + 10, bot = this.V.y + this.V.h - 10;
      if (p.y < top) p.ay += (top - p.y) * 3;
      if (p.y > bot) p.ay += (bot - p.y) * 3;
      p.aa += Math.sin(t * 0.07 + p.phase) * 0.012 - p.va * 0.6;
    }
    // lá va lá: lò xo mềm + giảm chấn
    for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) {
      const a = L[i], b = L[j];
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 0.001, min = a.r + b.r;
      if (d >= min) continue;
      const nx = dx / d, ny = dy / d, pen = min - d;
      const rvx = b.vx - a.vx, rvy = b.vy - a.vy, rvn = rvx * nx + rvy * ny;
      const f = pen * LEAVES.kCollide - Math.min(0, rvn) * 4;
      const ma = a.s * a.s, mb = b.s * b.s;
      const wa = a.held ? 0 : b.held ? 1 : mb / (ma + mb), wb = b.held ? 0 : a.held ? 1 : ma / (ma + mb);
      a.ax -= nx * f * wa * 2; a.ay -= ny * f * wa * 2;
      b.ax += nx * f * wb * 2; b.ay += ny * f * wb * 2;
      const tang = (rvx - rvn * nx) * -ny + (rvy - rvn * ny) * nx;
      a.aa += tang * 0.01 * wa; b.aa += tang * 0.01 * wb;
    }
    for (const p of L) {
      p.vx += p.ax * h; p.vy += p.ay * h;
      p.x += p.vx * h; p.y += p.vy * h;
      p.va = clamp(p.va + p.aa * h, -1.2, 1.2);
      p.a += p.va * h;
      const zt = p.held ? LEAVES.lift : 0;
      p.vz += ((zt - p.lift) * 90 - p.vz * 12) * h;
      p.lift += p.vz * h;
      // lá không chui qua thân vịt: đẩy ra mép elip và bỏ vận tốc hướng vào
      for (const d of this.ducks) {
        const Rx = d.rx + p.r * 0.8, Ry = d.ry + p.r * 0.8;
        const qx = (p.x - d.cx) / Rx, qy = (p.y - d.cy) / Ry, f2 = qx * qx + qy * qy;
        if (f2 >= 1) continue;
        const f = Math.sqrt(f2) || 0.001;
        p.x = d.cx + (qx / f) * Rx; p.y = d.cy + (qy / f) * Ry;
        let nx = qx / Rx, ny = qy / Ry;
        const nl = Math.hypot(nx, ny) || 1; nx /= nl; ny /= nl;
        const vn = p.vx * nx + p.vy * ny;
        if (vn < 0) { p.vx -= vn * nx * 1.2; p.vy -= vn * ny * 1.2; }
        p.va += (p.vx * ny - p.vy * nx) * 0.0008;
      }
    }
  }

  // Sóng do lá tạo ra: lá đi ngược dòng / bị giữ thì rẽ nước; thả xuống thì có vòng sóng.
  wakes(dt, sim) {
    const k60 = dt * 60;
    for (const p of this.items) {
      if (p.held && p.lift > LEAVES.lift * 0.6) p.wasLifted = true;
      if (!p.held && p.wasLifted && p.lift < 1) {
        this.ring(p, sim, -1.8);
        p.wasLifted = false;
      }
      const rvx = p.vx - FLOW.dir * p.speed, rvy = p.vy, sp = Math.hypot(rvx, rvy);
      if (sp < 10) continue;
      const nx = rvx / sp, ny = rvy / sp;
      const k = Math.min(sp, 420) * 0.006 * k60 * (p.held ? 1.5 : 1);
      sim.disturb(p.x + nx * p.r * 0.95, p.y + ny * p.r * 0.95, 9, k);
      sim.disturb(p.x - nx * p.r * 0.95, p.y - ny * p.r * 0.95, 9, -k * 0.7);
    }
  }

  ring(p, sim, amount) {
    for (let i = 0; i < RING_POINTS; i++) {
      const th = (i / RING_POINTS) * Math.PI * 2;
      sim.disturb(p.x + Math.cos(th) * p.r, p.y + Math.sin(th) * p.r, 8, amount);
    }
  }

  // Lá nổi làm sóng yếu đi bên dưới (không chặn hẳn).
  stampCover(sim) {
    const { cols, rows, cell, cover, ox, oy } = sim;
    cover.fill(1);
    for (const p of this.items) {
      const t = p.t, C = t.coarse, ca = Math.cos(p.a), sa = Math.sin(p.a), inv = 1 / p.s;
      const gx0 = Math.max(1, Math.floor((p.x - p.R - ox) / cell)), gx1 = Math.min(cols - 2, Math.ceil((p.x + p.R - ox) / cell));
      const gy0 = Math.max(1, Math.floor((p.y - p.R - oy) / cell)), gy1 = Math.min(rows - 2, Math.ceil((p.y + p.R - oy) / cell));
      for (let gy = gy0; gy <= gy1; gy++) for (let gx = gx0; gx <= gx1; gx++) {
        const dx = ox + (gx + 0.5) * cell - p.x, dy = oy + (gy + 0.5) * cell - p.y;
        const tx = t.pad.x + (dx * ca + dy * sa) * inv * p.flip, ty = t.pad.y + (-dx * sa + dy * ca) * inv;
        const cx = (tx / C.cell) | 0, cy = (ty / C.cell) | 0;
        if (tx >= 0 && ty >= 0 && cx < C.cols && cy < C.rows && C.data[cy * C.cols + cx] > 0.5) cover[gy * cols + gx] = SIM.dampLeaf;
      }
    }
  }

  /* -------------------------------------------------------------- pointer */
  alphaAt(p, ix, iy) {
    const t = p.t, ca = Math.cos(p.a), sa = Math.sin(p.a), inv = 1 / p.s;
    const dx = ix - p.x, dy = iy - p.y;
    const tx = Math.floor(t.pad.x + (dx * ca + dy * sa) * inv * p.flip), ty = Math.floor(t.pad.y + (-dx * sa + dy * ca) * inv);
    if (tx < 0 || ty < 0 || tx >= t.w || ty >= t.h) return 0;
    return t.alpha[ty * t.w + tx];
  }

  pick(ix, iy) {
    const sorted = [...this.items].sort((a, b) => b.order - a.order);
    return sorted.find((p) => this.alphaAt(p, ix, iy) > 60) || null;
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
    p.ty = clamp(iy + p.gy, this.V.y - p.r, this.V.y + this.V.h + p.r);
  }

  release(p, vx, vy) {
    p.held = false;
    const sp = Math.hypot(vx, vy), k = sp > LEAVES.maxThrow ? LEAVES.maxThrow / sp : 1;
    p.vx = vx * k; p.vy = vy * k;
  }

  /* -------------------------------------------------------------- draw */
  sync(sim) {
    const S = this.s;
    for (const p of this.items) {
      const t = p.t;
      if (sim) {
        sim.sample(p.x, p.y, S);
        p.bright += (1 + clamp(-(S.gx * SUN2[0] + S.gy * SUN2[1]) * 1.4, -0.1, 0.1) - p.bright) * 0.3;
      }
      const ca = Math.cos(p.a), sa = Math.sin(p.a);
      const centre = (s) => {
        const ox = (t.w / 2 - t.pad.x) * s * p.flip, oy = (t.h / 2 - t.pad.y) * s;
        return [p.x + ox * ca - oy * sa, p.y + ox * sa + oy * ca];
      };
      const sLift = p.s * (1 + p.lift * 0.008);
      const [cx, cy] = centre(sLift);
      const [rx, ry] = centre(p.s);
      const off = 3 + p.lift * 1.8;
      this.place(p.stem, rx, ry, Z.stem, p.a, p.s * p.flip, p.s);
      setSpriteColor(p.stem.material, 0.78, 0.68, 0.8, 0.92);
      this.place(p.shadow, rx + SHADOW_DIR[0] * off, ry + SHADOW_DIR[1] * off, Z.shadow, p.a, p.s * p.flip, p.s);
      this.place(p.ring, rx, ry, Z.ring, p.a, p.s * p.flip, p.s);
      this.place(p.mesh, cx, cy, Z.leaf + p.lift, p.a, sLift * p.flip, sLift, Z.leaf);
      setSpriteColor(p.shadow.material, clamp(0.3 - p.lift * 0.012, 0.12, 0.3));
      setSpriteColor(p.ring.material, 0.85);
      const b = p.bright;
      setSpriteColor(p.mesh.material, 1, p.tint[0] * b, p.tint[1] * b, p.tint[2] * b);
      p.mesh.renderOrder = 10 + p.order;
    }
  }
}

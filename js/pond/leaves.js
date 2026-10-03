// Lá sen nhân bản từ 4 mẫu lá: trôi theo dòng, bị sóng đẩy, va nhau và vòng qua vịt.
// Lá KHÔNG tự xoay — xoay thì cuống lá chĩa sai hướng.
// Lá vẽ ĐÚNG NHƯ ảnh trong file AI, không tô lại ánh sáng 3D lúc chạy.
import * as THREE from 'three';
import { FLOW, LEAVES, Z, SIM } from './config.js';
import { textureFrom, spriteMaterial, setSpriteColor } from './assets.js';

const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class Leaves {
  // view: khung nhìn (toạ độ ảnh) — lá trôi trong dải này và vòng lại ở hai mép.
  constructor({ templates, scene, place, view }) {
    this.place = place;
    this.V = view;
    this.s = { h: 0, gx: 0, gy: 0 };
    const count = Math.round(clamp((view.w * view.h) / LEAVES.areaPerLeaf, LEAVES.minCount, LEAVES.maxCount));

    this.tpl = templates.map((e) => {
      const L = e.leaf;
      return {
        ...L,
        fit: LEAVES.radius / Math.max(1, L.padR), // đưa mọi mẫu lá về cùng một cỡ

        tex: textureFrom(L.canvas),
        geo: (L.geo ||= new THREE.PlaneGeometry(L.w, L.h)), // dùng lại khi dựng lại cảnh
        // gân lá (vẽ đè lên lá) và cuống (chìm dưới nước, vẽ sau lá) — xem assets.js → splitStem
        parts: ['vein', 'stalk'].map((k) => e[k] && {
          key: k,
          ...e[k],
          tex: textureFrom(e[k].canvas),
          geo: (e[k].geo ||= new THREE.PlaneGeometry(e[k].w, e[k].h)),
          dx: e[k].x - L.x, // vị trí so với góc trên trái của ảnh lá
          dy: e[k].y - L.y,
        }).filter(Boolean),
      };
    });

    this.items = [];
    this.top = 0;
    for (let k = 0; k < count; k++) {
      const t = this.tpl[k % this.tpl.length];
      const s = rand(LEAVES.scaleMin, LEAVES.scaleMax) * t.fit;
      const p = {
        t, s,
        x: 0, y: 0, vx: 0, vy: 0, ax: 0, ay: 0,
        lift: 0, vz: 0, wasLifted: false,
        r: t.padR * s, R: t.boundR * s,
        speed: FLOW.speed + rand(-FLOW.jitter, FLOW.jitter),
        phase: rand(0, 100),
        order: this.top++,
        held: false, tx: 0, ty: 0, gx: 0, gy: 0,
        tint: [rand(0.96, 1.03), rand(0.98, 1.02), rand(0.95, 1.01)], // chỉ lệch màu rất nhẹ cho đỡ đều tăm tắp
      };
      p.mesh = new THREE.Mesh(t.geo, spriteMaterial(t.tex));
      p.mesh.renderOrder = 10;
      p.mesh.frustumCulled = false;
      scene.add(p.mesh);
      p.extra = t.parts.map((part) => {
        const m = new THREE.Mesh(part.geo, spriteMaterial(part.tex));
        m.frustumCulled = false;
        scene.add(m);
        return { part, mesh: m };
      });
      this.items.push(p);
    }
    this.spawnAll();
  }

  /* -------------------------------------------------------------- spawn */
  clearance(leaf, x, y) {
    let best = Infinity;
    for (const o of this.items) {
      if (o === leaf || !o.placed) continue;
      best = Math.min(best, Math.hypot(o.x - x, o.y - y) - (o.r + leaf.r));
    }
    return best;
  }

  pickY(leaf, x) {
    let bestY = this.V.y + this.V.h / 2, bestScore = -Infinity;
    for (let i = 0; i < 14; i++) {
      const y = rand(this.V.y + 60, this.V.y + this.V.h - 60);
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
      p.x = x0 + ((x1 - x0) * (k + rand(0.2, 0.8))) / this.items.length;
      p.y = this.pickY(p, p.x);
      p.vx = FLOW.dir * p.speed;
      p.placed = true;
    });
    for (let i = 0; i < 180; i++) this.integrate(1 / 60, i / 60, null);
  }

  respawn(p) {
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
    const L = this.items, S = this.s;
    for (const p of L) { p.ax = 0; p.ay = 0; }
    for (const p of L) {
      if (p.held) {
        const K = LEAVES.kHold, C = 2 * Math.sqrt(K);
        p.ax += (p.tx - p.x) * K - p.vx * C;
        p.ay += (p.ty - p.y) * K - p.vy * C;
        continue;
      }
      const fx = FLOW.dir * p.speed, fy = Math.sin(t * 0.11 + p.phase) * FLOW.meander;
      p.ax += (fx - p.vx) * LEAVES.kFlow;
      p.ay += (fy - p.vy) * LEAVES.kFlow;
      if (sim) {
        let gx = 0, gy = 0;
        const rr = p.r * 0.6;
        for (const [ox, oy] of [[0, 0], [rr, 0], [-rr, 0], [0, rr], [0, -rr]]) {
          sim.sample(p.x + ox, p.y + oy, S);
          gx += S.gx; gy += S.gy;
        }
        p.ax -= (gx / 5) * LEAVES.kWave;
        p.ay -= (gy / 5) * LEAVES.kWave;
      }
      const top = this.V.y + 12, bot = this.V.y + this.V.h - 12;
      if (p.y < top) p.ay += (top - p.y) * 3;
      if (p.y > bot) p.ay += (bot - p.y) * 3;
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
        const Rx = d.rx + p.r * 0.8, Ry = d.ry + p.r * 0.8;
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
    const k60 = dt * 60;
    for (const p of this.items) {
      if (p.held && p.lift > LEAVES.lift * 0.6) p.wasLifted = true;
      if (!p.held && p.wasLifted && p.lift < 1) { this.ring(p, sim, -1.8); p.wasLifted = false; }
      const rvx = p.vx - FLOW.dir * p.speed, rvy = p.vy, sp = Math.hypot(rvx, rvy);
      if (sp < 10) continue;
      const nx = rvx / sp, ny = rvy / sp;
      const k = Math.min(sp, 420) * 0.006 * k60 * (p.held ? 1.5 : 1);
      sim.disturb(p.x + nx * p.r * 0.95, p.y + ny * p.r * 0.95, 9, k);
      sim.disturb(p.x - nx * p.r * 0.95, p.y - ny * p.r * 0.95, 9, -k * 0.7);
    }
  }

  ring(p, sim, amount) {
    for (let i = 0; i < 14; i++) {
      const th = (i / 14) * Math.PI * 2;
      sim.disturb(p.x + Math.cos(th) * p.r, p.y + Math.sin(th) * p.r, 8, amount);
    }
  }

  // Mặt lá làm sóng yếu đi bên dưới (chỉ mặt lá — cuống không tính).
  stampCover(sim) {
    const { cols, rows, cell, cover, ox, oy } = sim;
    cover.fill(1);
    for (const p of this.items) {
      const t = p.t, C = t.coarse, inv = 1 / p.s;
      const gx0 = Math.max(1, Math.floor((p.x - p.R - ox) / cell)), gx1 = Math.min(cols - 2, Math.ceil((p.x + p.R - ox) / cell));
      const gy0 = Math.max(1, Math.floor((p.y - p.R - oy) / cell)), gy1 = Math.min(rows - 2, Math.ceil((p.y + p.R - oy) / cell));
      for (let gy = gy0; gy <= gy1; gy++) for (let gx = gx0; gx <= gx1; gx++) {
        const tx = t.pad.x + (ox + (gx + 0.5) * cell - p.x) * inv;
        const ty = t.pad.y + (oy + (gy + 0.5) * cell - p.y) * inv;
        const cx = (tx / C.cell) | 0, cy = (ty / C.cell) | 0;
        if (tx >= 0 && ty >= 0 && cx < C.cols && cy < C.rows && C.data[cy * C.cols + cx] > 0.5) cover[gy * cols + gx] = SIM.dampLeaf;
      }
    }
  }

  /* -------------------------------------------------------------- pointer */
  alphaAt(p, ix, iy) {
    const t = p.t, inv = 1 / p.s;
    const tx = Math.floor(t.pad.x + (ix - p.x) * inv), ty = Math.floor(t.pad.y + (iy - p.y) * inv);
    if (tx < 0 || ty < 0 || tx >= t.w || ty >= t.h) return 0;
    return t.alpha[ty * t.w + tx];
  }

  pick(ix, iy) {
    return [...this.items].sort((a, b) => b.order - a.order).find((p) => this.alphaAt(p, ix, iy) > 60) || null;
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
  sync() {
    for (const p of this.items) {
      const t = p.t, s = p.s * (1 + p.lift * 0.008);
      // tâm ảnh lá so với tâm mặt lá
      const cx = p.x + (t.w / 2 - t.pad.x) * s, cy = p.y + (t.h / 2 - t.pad.y) * s;
      this.place(p.mesh, cx, cy, Z.leaf + p.lift, 0, s, s, Z.leaf);
      setSpriteColor(p.mesh.material, 1, p.tint[0], p.tint[1], p.tint[2]);
      p.mesh.renderOrder = 20 + p.order * 2;
      for (const { part, mesh } of p.extra) {
        const vein = part.key === 'vein';
        // Gân phải ở CÙNG độ cao với lá, nếu không thì thị sai làm nó trượt khỏi lá khi camera đảo.
        const z = vein ? Z.leaf + p.lift : Z.stem;
        const ps = vein ? s : p.s;
        const px2 = p.x + (part.dx + part.w / 2 - t.pad.x) * ps;
        const py2 = p.y + (part.dy + part.h / 2 - t.pad.y) * ps;
        this.place(mesh, px2, py2, z, 0, ps, ps, vein ? Z.leaf : Z.stem);
        mesh.renderOrder = vein ? 21 + p.order * 2 : 1;
        if (vein) setSpriteColor(mesh.material, 1, p.tint[0], p.tint[1], p.tint[2]);
        else setSpriteColor(mesh.material, LEAVES.stemFade, 0.74, 0.86, 0.92);
      }
    }
  }
}

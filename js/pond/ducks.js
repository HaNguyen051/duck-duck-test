// Hai chú vịt: đứng yên một chỗ, nhấp nhô và nghiêng theo sóng, quẫy chân; bấm vào thì nhún.
import * as THREE from 'three';
import { Z } from './config.js';
import { textureFrom, spriteMaterial, setSpriteColor } from './assets.js';
import { waveAt } from './water.js';

const rand = (a, b) => a + Math.random() * (b - a);
const ORDER = 10000; // luôn vẽ trên lá

function rot(x, y, a) {
  const c = Math.cos(a), s = Math.sin(a);
  return [x * c - y * s, x * s + y * c];
}

export class Ducks {
  constructor({ ducks, scene, place, ambGain, reduceMotion }) {
    this.place = place;
    this.ambGain = ambGain;
    this.reduceMotion = reduceMotion;
    this.s = { h: 0, gx: 0, gy: 0 };
    this.w = { h: 0, gx: 0, gy: 0 };
    const sprite = (layer, order) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(layer.width, layer.height), spriteMaterial(textureFrom(layer)));
      m.renderOrder = order;
      m.frustumCulled = false;
      scene.add(m);
      return m;
    };
    this.items = ducks.map((d, k) => ({
      d,
      shadow: sprite(d.shadow, 5),
      body: sprite(d.body.canvas, ORDER + k * 10),
      // chân "trong" nhìn xuyên qua thân → vẽ trên thân; chân "ngoài" nằm dưới nước → vẽ dưới lá sen nổi
      feet: d.feet.map((f, j) => ({ ...f, mesh: sprite(f.canvas, f.kind === 'in' ? ORDER + k * 10 + 1 + j : 6 + k), ph: rand(0, 6.28) })),
      sz: 0, sv: 0, sr: 0, srv: 0,
      phase: rand(0, 6.28), ph2: rand(0, 6.28), ph3: rand(0, 6.28),
      nextPaddle: rand(0.4, 1.4), paddleSide: 0,
      dx: 0, dy: 0, rho: 0,
    }));
  }

  update(t, dt, sim) {
    const S = this.s, W = this.w;
    for (const it of this.items) {
      const { d } = it, O = d.center;
      it.sv += (-40 * it.sz - 5.2 * it.sv) * dt; it.sz += it.sv * dt;
      it.srv += (-46 * it.sr - 5.5 * it.srv) * dt; it.sr += it.srv * dt;
      sim.sample(O.x, O.y, S);
      waveAt(O.x, O.y, t, this.ambGain, W);
      const bob = S.h * 0.4 + W.h * 0.8 + it.sz + Math.sin(t * 0.8 + it.phase) * 1.6;
      it.dx = Math.sin(t * 0.31 + it.phase) * 2.2 + Math.sin(t * 0.17 + it.ph2) * 1.2;
      it.dy = Math.cos(t * 0.27 + it.ph2) * 1.6;
      it.rho = Math.sin(t * 0.36 + it.ph3) * 0.014 + it.sr + (S.gy - S.gx) * 0.08;
      const z = Z.duck + bob;
      const sc = 1 + it.sz * 0.004;
      const bright = 1 + Math.max(-0.06, Math.min(0.06, -(S.gx * 0.7 - S.gy * 0.7) * 1.2));

      const r = d.body.rect, C = [r.x + r.w / 2 - O.x, r.y + r.h / 2 - O.y];
      const [bx, by] = rot(C[0], C[1], it.rho);
      this.place(it.body, O.x + bx + it.dx, O.y + by + it.dy, z, it.rho, sc, sc, Z.duck);
      setSpriteColor(it.body.material, 1, bright);

      const sp = d.shadowPad;
      this.place(it.shadow, r.x - sp + d.shadow.width / 2 + it.dx - 4, r.y - sp + d.shadow.height / 2 + it.dy + 5, Z.shadow, it.rho, 1, 1);
      setSpriteColor(it.shadow.material, 0.22);

      it.feet.forEach((f, j) => {
        const amp = f.kind === 'out' ? 0.34 : 0.26;
        const paddle = Math.sin(t * 2.6 + f.ph + j * 2.4) * amp * (0.55 + 0.45 * Math.sin(t * 0.7 + f.ph));
        const [px, py] = rot(f.pivot.x - O.x, f.pivot.y - O.y, it.rho);
        const P = [O.x + px + it.dx, O.y + py + it.dy];
        const phi = it.rho + paddle;
        const fc = [f.rect.x + f.rect.w / 2 - f.pivot.x, f.rect.y + f.rect.h / 2 - f.pivot.y];
        const [cx, cy] = rot(fc[0], fc[1], phi);
        f.tip = [P[0] + cx * 1.6, P[1] + cy * 1.6];
        this.place(f.mesh, P[0] + cx, P[1] + cy, Z.duck * 0.35 + bob * 0.5, phi, 1, 1, Z.duck * 0.35);
      });

      // quẫy chân tạo gợn nhẹ phía sau
      it.nextPaddle -= dt;
      if (it.nextPaddle <= 0 && !this.reduceMotion) {
        it.nextPaddle = rand(0.8, 1.5);
        const outs = it.feet.filter((f) => f.kind === 'out' && f.tip);
        const f = outs[it.paddleSide++ % Math.max(1, outs.length)];
        if (f) sim.disturb(f.tip[0], f.tip[1], 7, -0.7);
      }
    }
  }

  pick(ix, iy) {
    for (let k = this.items.length - 1; k >= 0; k--) {
      const it = this.items[k];
      const x = ix - it.dx, y = iy - it.dy;
      const layers = [it.d.body, ...it.d.feet];
      for (const L of layers) {
        const lx = Math.floor(x - L.rect.x), ly = Math.floor(y - L.rect.y);
        if (lx >= 0 && ly >= 0 && lx < L.rect.w && ly < L.rect.h && L.alpha[ly * L.rect.w + lx] > 40) return k;
      }
    }
    return -1;
  }

  poke(k, ix, sim) {
    const it = this.items[k], { center: O, radii } = it.d;
    it.sv += 60;
    it.srv += (ix < O.x ? 1 : -1) * 1.6;
    const n = 16;
    for (let i = 0; i < n; i++) {
      const th = (i / n) * Math.PI * 2;
      sim.disturb(O.x + Math.cos(th) * radii.x * 1.02, O.y + Math.sin(th) * radii.y * 1.02, 10, -1.6);
    }
  }
}

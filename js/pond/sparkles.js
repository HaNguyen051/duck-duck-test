// Sao lấp lánh (WATER-SPARK.svg): mỗi sao nhấp nháy một lần (phình ra rồi tắt) rồi dời sang chỗ khác.
// Phần lớn nằm trong vùng trời / mặt nước (trên cung SURFACE.arc), vài cái lạc xuống nước sâu như tranh mẫu.
import * as THREE from 'three';
import { SPARKLES, Z, surfaceBottom } from './config.js';
import { spriteMaterial, setSpriteColor } from './assets.js';

const rand = (a, b) => a + Math.random() * (b - a);

export class Sparkles {
  constructor({ texture, scene, place, view, reduceMotion }) {
    this.place = place;
    this.V = view;
    this.reduceMotion = reduceMotion;
    this.geo = new THREE.PlaneGeometry(1, 1);
    const n = reduceMotion ? Math.ceil(SPARKLES.count / 2) : SPARKLES.count;
    this.items = Array.from({ length: n }, () => {
      const m = new THREE.Mesh(this.geo, spriteMaterial(texture));
      m.renderOrder = 15000;
      m.frustumCulled = false;
      m.visible = false;
      scene.add(m);
      return this.reset({ m }, true);
    });
  }

  reset(s, initial = false) {
    const V = this.V, x = rand(V.x + 30, V.x + V.w - 30), yb = surfaceBottom(x);
    const inZone = Math.random() < SPARKLES.zoneBias;
    const y0 = inZone ? V.y + 30 : Math.max(V.y + 30, yb + 30);
    const y1 = inZone ? Math.min(V.y + V.h - 30, yb - 40) : V.y + V.h - 30;
    Object.assign(s, {
      x, y: y1 > y0 ? rand(y0, y1) : rand(V.y + 30, V.y + V.h - 30),
      size: rand(SPARKLES.size[0], SPARKLES.size[1]),
      period: rand(SPARKLES.period[0], SPARKLES.period[1]),
      t: initial ? rand(0, SPARKLES.period[1]) : 0,
      rot: rand(0, Math.PI), spin: rand(-0.4, 0.4),
    });
    return s;
  }

  update(t, dt) {
    for (const s of this.items) {
      s.t += dt;
      if (s.t >= s.period) this.reset(s);
      const k = s.t / SPARKLES.on;
      const vis = k < 1 ? Math.sin(k * Math.PI) : 0;
      s.m.visible = vis > 0.01;
      if (!s.m.visible) continue;
      const sz = s.size * (0.55 + 0.45 * vis);
      this.place(s.m, s.x, s.y, SPARKLES.z ?? Z.spark, s.rot + s.spin * s.t, sz, sz);
      setSpriteColor(s.m.material, vis);
    }
  }

  dispose() { this.geo.dispose(); }
}

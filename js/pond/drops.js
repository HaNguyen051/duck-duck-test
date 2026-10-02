// Giọt nước: lớp giọt lơ lửng (tách từ 05_giot_nuoc.png) và tia nước bắn lên khi chạm mặt ao.
import * as THREE from 'three';
import { Z } from './config.js';
import { textureFrom, spriteMaterial, setSpriteColor } from './assets.js';

const rand = (a, b) => a + Math.random() * (b - a);
const POOL = 32;
const GRAVITY = 1100;

export class Drops {
  constructor({ floating, splash, scene, place, reduceMotion }) {
    this.place = place;
    this.reduceMotion = reduceMotion;
    this.floating = floating.map((d) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(d.rect.w, d.rect.h), spriteMaterial(textureFrom(d.canvas)));
      m.renderOrder = 20000;
      m.frustumCulled = false;
      scene.add(m);
      return { m, x: d.cx, y: d.cy, z: rand(Z.dropMin, Z.dropMax), ph: rand(0, 6.28) };
    });
    const tex = splash.map(textureFrom);
    this.pool = Array.from({ length: POOL }, (_, i) => {
      const t = tex[i % tex.length], img = t.image;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(img.width, img.height), spriteMaterial(t));
      m.renderOrder = 30000;
      m.frustumCulled = false;
      m.visible = false;
      scene.add(m);
      return { m, live: false };
    });
  }

  // spread > 1 khi cảnh bị thu nhỏ (điện thoại): giọt bay xa và to hơn theo toạ độ ảnh để vẫn thấy rõ.
  burst(ix, iy, count, power = 1, spread = 1) {
    if (this.reduceMotion) count = Math.ceil(count / 2);
    for (let i = 0; i < count; i++) {
      const p = this.pool.find((q) => !q.live);
      if (!p) return;
      const th = rand(0, Math.PI * 2), sp = rand(40, 150) * power * spread;
      Object.assign(p, {
        live: true, x: ix, y: iy, z: 2,
        vx: Math.cos(th) * sp, vy: Math.sin(th) * sp, vz: rand(140, 260) * power,
        s: rand(0.55, 1.0) * spread, power, a: rand(0, 6.28),
      });
      p.m.visible = true;
    }
  }

  update(t, dt, sim) {
    for (const d of this.floating) {
      const z = d.z + Math.sin(t * 0.9 + d.ph) * 5;
      const sx = Math.sin(t * 0.6 + d.ph * 3) * 2.2, sy = Math.cos(t * 0.5 + d.ph * 2) * 2.2;
      this.place(d.m, d.x + sx, d.y + sy, z, 0, 1, 1, d.z);
      setSpriteColor(d.m.material, 0.95);
    }
    for (const p of this.pool) {
      if (!p.live) continue;
      p.vz -= GRAVITY * dt;
      p.z += p.vz * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.z <= 0 && p.vz < 0) {
        sim.disturb(p.x, p.y, 5, -0.7 * p.power);
        p.live = false;
        p.m.visible = false;
        continue;
      }
      const s = p.s * (1 + p.z / 80);
      this.place(p.m, p.x, p.y, Z.water + Math.max(0, p.z), p.a, s, s, 0);
      setSpriteColor(p.m.material, Math.min(1, 0.4 + p.z / 25));
    }
  }
}

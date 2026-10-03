// Dựng cảnh ao vịt tràn màn hình: renderer, camera chiếu lệch tâm, vòng lặp.
// Khung nhìn (toạ độ ảnh) phủ kín màn hình theo kiểu cover; đổi cỡ màn hình thì dựng lại cảnh.
import * as THREE from 'three';
import { CAMERA, SIM, Z, AMBIENT_GAIN, LAYOUT, computeView } from './config.js';
import { prepareAssets, buildWater, makeTexture } from './assets.js';
import { WaterSim, cellFor } from './watersim.js';
import { createWater } from './water.js';
import { Leaves } from './leaves.js';
import { Ducks } from './ducks.js';
import { Drops } from './drops.js';

const rand = (a, b) => a + Math.random() * (b - a);

export class Pond {
  static async create(el, canvas, opts = {}) {
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
    const assets = await prepareAssets();
    return new Pond(el, canvas, renderer, assets, opts);
  }

  constructor(el, canvas, renderer, assets, opts) {
    this.el = el;
    this.canvas = canvas;
    this.renderer = renderer;
    this.assets = assets;
    this.opts = opts;
    this.reduceMotion = !!opts.reduceMotion;
    this.frozen = !!opts.freeze;
    this.pathCtx = document.createElement('canvas').getContext('2d');
    this.ambGain = (this.reduceMotion ? 0.35 : 1) * AMBIENT_GAIN;

    renderer.setClearColor(0x1d4e86, 1);
    this.camera = new THREE.PerspectiveCamera();
    this.cam = { x: 0, y: 0, tx: 0, ty: 0 };
    this.lastInput = -100;
    this.t = 0;
    this.acc = 0;
    this.nextDrop = rand(2, 4);
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
    this.perf = { frames: 0, time: 0 };
    this.place = this.place.bind(this);

    this.build();
    new ResizeObserver(() => {
      clearTimeout(this.resizeTimer);
      this.resizeTimer = setTimeout(() => this.rebuildIfNeeded(), 180);
    }).observe(el);
    this.timer = new THREE.Timer();
    this.timer.connect(document);
    this.loop = (time) => this.frame(time);
    this.running = false;
    new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) this.start(); else this.stop();
    }).observe(el);
  }

  /* -------------------------------------------------------------- build */
  build() {
    const cw = this.el.clientWidth, ch = this.el.clientHeight;
    this.size = [cw, ch];
    const view = computeView(cw, ch), M = LAYOUT.worldMargin;
    const world = { x: view.x - M, y: view.y - M, w: view.w + 2 * M, h: view.h + 2 * M };
    this.view = view;
    this.world = world;
    this.CX = view.x + view.w / 2;
    this.CY = view.y + view.h / 2;
    this.scene = new THREE.Scene();

    const sim = (this.sim = new WaterSim(world, cellFor(world, view.s)));
    // mép vùng tương tác lấy từ layer "interactive water" trong file AI
    const ip = this.assets.interactive.path;
    sim.setShore((g) => {
      g.setTransform(1 / sim.cell, 0, 0, 1 / sim.cell, -world.x / sim.cell, -world.y / sim.cell);
      g.fill(ip);
    });

    const water = buildWater(this.assets, world);
    this.waterTex = makeTexture(water.canvas);
    this.water = createWater({ waterTexture: this.waterTex, region: water.region, area: world, sim, reduceMotion: this.reduceMotion });
    this.water.mesh.position.set(world.x + world.w / 2 - this.CX, -(world.y + world.h / 2 - this.CY), 0);
    this.scene.add(this.water.mesh);

    const place = this.place, scene = this.scene;
    this.leaves = new Leaves({ templates: this.assets.leaves, scene, place, view });
    this.ducks = new Ducks({
      scene, view, world, sim, ambGain: this.ambGain, reduceMotion: this.reduceMotion,
      squash: this.assets.duck.squash, centre: [this.CX, this.CY],
    });
    const inWorld = (d) => d.cx > world.x && d.cx < world.x + world.w && d.cy > world.y && d.cy < world.y + world.h;
    const splash = [...this.assets.drops].sort((a, b) => b.area - a.area).slice(0, 10);
    this.drops = new Drops({ floating: this.assets.drops.filter(inWorld), splash, scene, place, reduceMotion: this.reduceMotion });

    if (this.opts.debug) this.setupDebug();
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(cw, ch, false);
  }

  teardown() {
    this.scene.traverse((o) => { if (o.isMesh) o.material.dispose(); });
    this.waterTex.dispose();
    this.sim.dispose();
    if (this.debug) { this.debug.remove(); this.debug = null; }
  }

  rebuildIfNeeded() {
    const cw = this.el.clientWidth, ch = this.el.clientHeight;
    if (!cw || !ch || (cw === this.size[0] && ch === this.size[1])) return;
    this.teardown();
    this.build();
    this.acc = 0;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.timer.reset?.();
    this.renderer.setAnimationLoop(this.loop);
  }

  stop() {
    this.running = false;
    this.renderer.setAnimationLoop(null);
  }

  /* -------------------------------------------------------------- placement */
  // Đặt một sprite theo toạ độ ảnh ở độ cao z. Kích thước bù theo zScale để khi camera ở giữa,
  // mọi lớp khớp đúng ảnh gốc; camera lệch thì lớp càng cao trượt càng nhiều.
  place(mesh, ix, iy, z, angle, sx, sy, zScale = z) {
    const D = CAMERA.D, kp = (D - z) / D, ks = (D - zScale) / D;
    mesh.position.set((ix - this.CX) * kp, -(iy - this.CY) * kp, z);
    mesh.rotation.z = -angle;
    mesh.scale.set(sx * ks, sy * ks, 1);
  }

  // Điểm trên màn hình → toạ độ ảnh trên mặt phẳng độ cao z.
  imageAt(clientX, clientY, z = 0) {
    const r = this.canvas.getBoundingClientRect(), V = this.view;
    const u = (clientX - r.left) / r.width, v = (clientY - r.top) / r.height;
    const f = z / (CAMERA.D - z);
    return { ix: V.x + u * V.w + this.cam.x * f, iy: V.y + v * V.h - this.cam.y * f, u, v };
  }

  inPond(ix, iy) { return this.pathCtx.isPointInPath(this.assets.interactive.path, ix, iy); }

  pick(clientX, clientY) {
    const qd = this.imageAt(clientX, clientY, Z.duck);
    const k = this.ducks.pick(qd.ix, qd.iy);
    if (k >= 0) return { type: 'duck', index: k, ...qd };
    const ql = this.imageAt(clientX, clientY, Z.leaf);
    const leaf = this.leaves.pick(ql.ix, ql.iy);
    if (leaf) return { type: 'leaf', leaf, ...ql };
    return { type: 'water', ...this.imageAt(clientX, clientY, 0) };
  }

  /* -------------------------------------------------------------- actions */
  screenPx(px) { return px / this.view.s; }

  tilt(nx, ny) {
    this.cam.tx = nx * CAMERA.max;
    this.cam.ty = -ny * CAMERA.max;
    this.lastInput = this.t;
  }

  touch() { this.lastInput = this.t; }

  drop(ix, iy) {
    const g = this.reduceMotion ? 0.6 : 1;
    this.sim.disturb(ix, iy, Math.max(14, this.screenPx(17)), -7.5 * g);
    this.drops.burst(ix, iy, 5, g, Math.max(1, Math.sqrt(1 / this.view.s)));
    this.touch();
  }

  // Vuốt trên mặt nước: rẽ nước dọc đường đi, mạnh theo tốc độ (px màn hình / giây).
  stir(a, b, dt) {
    const dx = b.ix - a.ix, dy = b.iy - a.iy, dist = Math.hypot(dx, dy);
    if (dist < 1) return;
    const speed = (dist * this.view.s) / Math.max(dt, 1 / 120);
    const amt = Math.min(2.2, Math.max(0.5, speed * 0.003)) * (this.reduceMotion ? 0.6 : 1);
    const step = this.screenPx(9), n = Math.ceil(dist / step), r = Math.max(9, this.screenPx(11));
    for (let i = 1; i <= n; i++) {
      const x = a.ix + (dx * i) / n, y = a.iy + (dy * i) / n;
      if (this.inPond(x, y)) this.sim.disturb(x, y, r, -amt);
    }
    this.touch();
  }

  /* -------------------------------------------------------------- loop */
  updateCamera(dt) {
    const c = this.cam;
    if (this.t - this.lastInput > 3 && !this.reduceMotion) {
      c.tx = Math.sin(this.t * 0.37) * CAMERA.max * 0.5;
      c.ty = Math.sin(this.t * 0.29 + 1.3) * CAMERA.max * 0.35;
    }
    const e = 1 - Math.exp(-dt * CAMERA.ease);
    c.x += (c.tx - c.x) * e;
    c.y += (c.ty - c.y) * e;
    const D = CAMERA.D, near = 50, far = 4000, W = this.view.w, H = this.view.h;
    this.camera.position.set(c.x, c.y, D);
    this.camera.projectionMatrix.makePerspective(
      ((-W / 2 - c.x) * near) / D, ((W / 2 - c.x) * near) / D,
      ((H / 2 - c.y) * near) / D, ((-H / 2 - c.y) * near) / D, near, far);
    this.camera.projectionMatrixInverse.copy(this.camera.projectionMatrix).invert();
  }

  ambientDrops(dt) {
    if (this.reduceMotion) return;
    this.nextDrop -= dt;
    if (this.nextDrop > 0) return;
    this.nextDrop = rand(1.5, 4);
    const V = this.view;
    for (let i = 0; i < 8; i++) {
      const x = rand(V.x + V.w * 0.05, V.x + V.w * 0.95), y = rand(V.y + V.h * 0.05, V.y + V.h * 0.95);
      if (this.inPond(x, y) && this.ducks.pick(x, y) < 0 && !this.leaves.pick(x, y)) {
        this.sim.disturb(x, y, Math.max(5, this.screenPx(6)), -0.85);
        return;
      }
    }
  }

  frame(time) {
    this.timer.update(time);
    const raw = this.timer.getDelta();
    let dt = Math.min(raw, 1 / 20);
    if (this.frozen) dt = 0;
    this.t += dt;
    const t = this.t;

    if (dt > 0) {
      this.leaves.stampCover(this.sim);
      this.acc += dt;
      let n = 0;
      while (this.acc >= 1 / SIM.hz && n < 6) { this.sim.step(); this.acc -= 1 / SIM.hz; n++; }
      if (n === 6) this.acc = 0;
      this.leaves.update(dt, t, this.sim);
      this.ambientDrops(dt);
    }
    this.ducks.update(t, dt, this.sim);
    this.leaves.avoidDucks(this.ducks.bodies());
    this.drops.update(t, dt, this.sim);
    this.leaves.sync();
    this.sim.upload();
    this.updateCamera(dt);
    this.water.uniforms.uTime.value = t;
    this.renderer.render(this.scene, this.camera);
    if (this.debug) this.drawDebug();

    if (!this.live) {
      this.live = true;
      this.el.classList.add('live');
      this.opts.onLive?.();
    }
    const p = this.perf;
    p.frames++; p.time += raw;
    if (p.frames >= 90) {
      const avg = p.time / p.frames;
      p.frames = 0; p.time = 0;
      if (avg > 0.034 && this.pixelRatio > 0.75) {
        this.pixelRatio = Math.max(0.75, this.pixelRatio * 0.8);
        this.renderer.setPixelRatio(this.pixelRatio);
        this.renderer.setSize(this.size[0], this.size[1], false);
      }
    }
  }

  /* -------------------------------------------------------------- debug (?debug) */
  setupDebug() {
    const c = document.createElement('canvas'), V = this.view, W = this.world;
    c.className = 'pond-debug';
    c.width = this.sim.cols; c.height = this.sim.rows;
    Object.assign(c.style, {
      left: `${((W.x - V.x) / V.w) * 100}%`, top: `${((W.y - V.y) / V.h) * 100}%`,
      width: `${((this.sim.cols * this.sim.cell) / V.w) * 100}%`, height: `${((this.sim.rows * this.sim.cell) / V.h) * 100}%`,
    });
    this.el.appendChild(c);
    this.debug = c;
    this.debugCtx = c.getContext('2d');
    this.debugImg = this.debugCtx.createImageData(c.width, c.height);
  }

  drawDebug() {
    const { cur, cover, solid, base, ampScale } = this.sim, d = this.debugImg.data, k = 40 / ampScale;
    for (let i = 0; i < cur.length; i++) {
      const h = cur[i];
      d[i * 4] = solid[i] ? 255 : Math.min(255, Math.max(0, h * k));
      d[i * 4 + 1] = cover[i] < 1 ? 160 : 0;
      d[i * 4 + 2] = Math.min(255, Math.max(0, -h * k)) + (base[i] < 0.95 ? 90 : 0);
      d[i * 4 + 3] = 255;
    }
    this.debugCtx.putImageData(this.debugImg, 0, 0);
  }
}

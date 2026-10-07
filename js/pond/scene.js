// Dựng cảnh ao vịt tràn màn hình: renderer, camera chiếu lệch tâm, vòng lặp. Nền là tranh vòm cây nhìn từ đáy
// hồ lên (gói art 10/2026): mặt nước là vùng trên cung SURFACE.arc, dưới là nước sâu có bong bóng và sao.
// Khung nhìn (toạ độ ảnh) phủ kín màn hình theo kiểu cover; đổi cỡ màn hình thì dựng lại cảnh.
import * as THREE from 'three';
import { CAMERA, SIM, Z, AMBIENT_GAIN, LAYOUT, PERSPECTIVE, SURFACE, computeView, surfacePath, surfaceBottom, surfaceInside, BUBBLES, DEEP_FLOW, MOBILE, isMobileDevice, DUCKS } from './config.js';
import { Persp } from './persp.js';
import { prepareAssets, dataTexture } from './assets.js';
import { WaterSim, cellFor } from './watersim.js';
import { createWater } from './water.js';
import { Leaves } from './leaves.js';
import { Ducks } from './ducks.js';
import { Bubbles } from './bubbles.js';
import { Sparkles } from './sparkles.js';
import { PondAudio } from './audio.js';

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
    this.audio = new PondAudio(); // tạo một lần (không theo build): nhạc nền chạy xuyên qua các lần dựng lại cảnh

    renderer.setClearColor(0x0b3147, 1);
    this.camera = new THREE.PerspectiveCamera();
    this.cam = { x: 0, y: 0, tx: 0, ty: 0 };
    this.lastInput = -100;
    this.t = 0;
    this.acc = 0;
    this.nextDrop = rand(2, 4);
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
    this.mobile = isMobileDevice(); // hồ sơ hiệu năng điện thoại (config MOBILE)
    this.builds = 0;
    // số vịt người dùng chọn bằng nút + / − (ui.js): giữ qua các lần dựng lại cảnh; trần theo máy
    this.maxDucks = this.mobile ? DUCKS.max.mobile : DUCKS.max.desktop;
    this.duckCount = Math.min(DUCKS.count, this.maxDucks);
    this.onDuckCount = null; // ui.js gắn vào để làm mờ nút khi hết số
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
    this.builds++;
    // Màn hẹp (điện thoại dọc) giữ khung cắt cover nhưng thu nhỏ vật thể (vịt, lá, bóng, sao) — xem MOBILE.
    this.objScale = Math.min(1, Math.max(MOBILE.minScale, view.w / MOBILE.refViewW));
    this.CX = view.x + view.w / 2;
    this.CY = view.y + view.h / 2;
    this.scene = new THREE.Scene();

    const sq = this.assets.duck.squash; // độ ép dẹt của mặt nước nhìn xiên, đo từ tranh
    // phép chiếu ảnh ↔ mặt phẳng nước có phối cảnh (bán kính): lưới sóng, vịt, lá, lưới sóng trắng cùng dùng
    const persp = (this.persp = new Persp(view, sq, PERSPECTIVE.near, PERSPECTIVE.far, PERSPECTIVE.radial));
    // vùng mặt nước = bên trên cung SURFACE.arc (đo từ gói art); phần nước sâu phía dưới không có sóng
    this.zonePath = surfacePath(world);
    // lưới sóng chỉ cần phủ mặt nước + một quãng dưới mép cho lớp hút sóng: cắt bớt phần nước sâu, đỡ tốn ô
    let arcMax = -Infinity;
    for (let i = 0; i <= 32; i++) arcMax = Math.max(arcMax, surfaceBottom(world.x + (world.w * i) / 32));
    const simWorld = { x: world.x, y: world.y, w: world.w, h: Math.min(world.h, arcMax + SIM.sponge + 80 - world.y) };
    const prof = this.mobile ? MOBILE : {};
    const sim = (this.sim = new WaterSim(simWorld, cellFor(simWorld, view.s, persp, prof), persp, {
      hz: prof.hz ?? SIM.hz,
      speed: SIM.waveSpeed * this.objScale, // vật nhỏ lại thì sóng cũng lan chậm theo tỉ lệ, giữ cảm giác như máy tính
    }));
    sim.setShore(surfaceInside); // dải hút sóng mượt phía trong mép (đo vuông góc), không dội

    this.zone = this.makeZone(world);
    this.water = createWater({ bg: this.assets.bg, net: this.assets.net, zone: this.zone, area: world, sim, reduceMotion: this.reduceMotion });
    this.water.mesh.position.set(world.x + world.w / 2 - this.CX, -(world.y + world.h / 2 - this.CY), 0);
    this.scene.add(this.water.mesh);

    const place = this.place, scene = this.scene;
    this.leaves = new Leaves({
      models: this.assets.leaves, scene, view, sim, persp, centre: [this.CX, this.CY], squash: sq,
      ambGain: this.ambGain, reduceMotion: this.reduceMotion, net: this.assets.net, scale: this.objScale,
    });
    this.ducks = new Ducks({
      scene, view, world, sim, persp, ambGain: this.ambGain, reduceMotion: this.reduceMotion, net: this.assets.net,
      squash: this.assets.duck.squash, centre: [this.CX, this.CY], model: this.assets.duck.model, scale: this.objScale, count: this.duckCount,
      // vịt rũ nước: chỉ gợn mặt nước — KHÔNG bắn giọt (giọt nước trông như bong bóng lạ, chủ dự án bỏ 2026-10-06)
      splash: (ix, iy) => { this.sim.disturb(ix, iy, Math.max(14, this.screenPx(16)), -1.4); },
    });
    const A = this.assets;
    this.bubbles = A.bubbles.length && A.spark ? new Bubbles({
      textures: A.bubbles, spark: A.spark, scene, place, view, reduceMotion: this.reduceMotion, scale: this.objScale,
      // bóng của cú bấm vỡ: gợn nhẹ mặt nước ở chỗ vỡ
      onPop: (x, y, r) => { if (this.inPond(x, y)) this.sim.disturb(x, y, Math.max(6, r * 0.6), -BUBBLES.tap.ripple); },
    }) : null;
    this.sparkles = A.spark ? new Sparkles({ texture: A.spark, scene, place, view, reduceMotion: this.reduceMotion, scale: this.objScale }) : null;

    if (this.opts.debug) this.setupDebug();
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(cw, ch, false);
  }

  // Mặt nạ vùng mặt nước cho shader: canvas thu nhỏ phủ `world`, đen ngoài, trắng trong, mép làm mờ cỡ
  // SURFACE.fade px. Vẽ trên nền đen đục rồi đọc kênh r (canvas trong suốt thì r bị nhân sẵn alpha, đọc sai).
  makeZone(world) {
    // Ba kênh: r = vùng mặt nước, mép mềm SURFACE.fade (sóng, khúc xạ tắt dần qua mép);
    // g = cùng vùng nhưng mờ rộng (SURFACE.deepBlur.width) — shader lấy nó để nước sâu nhoè dần qua mép.
    // K = 2: mặt nạ ½ độ phân giải cho mép mịn.
    const K = 2, c = document.createElement('canvas');
    c.width = Math.ceil(world.w / K); c.height = Math.ceil(world.h / K);
    const g = c.getContext('2d');
    g.fillStyle = '#000';
    g.fillRect(0, 0, c.width, c.height);
    const path = new Path2D();
    path.addPath(this.zonePath, new DOMMatrix().scale(1 / K).translate(-world.x, -world.y));
    g.globalCompositeOperation = 'lighter';
    g.filter = `blur(${(SURFACE.fade / K / 2.75).toFixed(2)}px)`;
    g.fillStyle = '#f00';
    g.fill(path);
    g.filter = `blur(${(SURFACE.deepBlur.width / K / 2.75).toFixed(2)}px)`;
    g.fillStyle = '#0f0';
    g.fill(path);
    // b = cùng vùng, mờ rất rộng (DEEP_FLOW.ramp): 1 − b là "độ sâu tính từ mép" cho liquify nước sâu
    g.filter = `blur(${(DEEP_FLOW.ramp / K / 2.75).toFixed(2)}px)`;
    g.fillStyle = '#00f';
    g.fill(path);
    const texture = dataTexture(c);
    // Shader lấy mẫu mặt nạ bằng (ảnh − world)/world.wh với gốc ở MÉP TRÊN; CanvasTexture mặc định flipY = true
    // (hàng 0 của texture = đáy canvas) → mặt nạ bị lật dọc: dải trên màn hình thành "nước sâu", không có sóng
    // (người dùng: "sóng nước không lan đến góc phải trên và trái trên"). Tắt flipY cho khớp.
    texture.flipY = false;
    return { texture, rect: world };
  }

  teardown() {
    this.scene.traverse((o) => { if (o.isMesh) o.material.dispose(); });
    this.water.mesh.geometry.dispose(); // mặt nước dựng mới mỗi lần; các hình học khác dùng lại
    this.zone.texture.dispose();
    this.bubbles?.dispose();
    this.sparkles?.dispose();
    this.sim.dispose();
    if (this.debug) { this.debug.remove(); this.debug = null; }
  }

  rebuildIfNeeded() {
    const cw = this.el.clientWidth, ch = this.el.clientHeight;
    if (!cw || !ch || (cw === this.size[0] && ch === this.size[1])) return;
    // Điện thoại: thanh địa chỉ ẩn/hiện chỉ đổi chiều cao một chút — không dựng lại cả cảnh (giật, mất sóng).
    // Xoay máy hay đổi cỡ thật (bề ngang đổi, hoặc cao đổi > 15 %) mới dựng lại.
    if (this.mobile && cw === this.size[0] && Math.abs(ch - this.size[1]) < this.size[1] * 0.15) return;
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

  inPond(ix, iy) { return this.pathCtx.isPointInPath(this.zonePath, ix, iy); }

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

  // Nút + : một con vịt rơi xuống chỗ trống — vòng sóng lớn, vài bong bóng, tiếng quạc. Trả về false nếu hết số.
  addDuck() {
    if (this.duckCount >= this.maxDucks || !this.assets.duck.model) return false;
    const it = this.ducks.add();
    if (!it) return false;
    this.duckCount++;
    const g = this.reduceMotion ? 0.6 : 1;
    this.sim.disturb(it.x, it.y, Math.max(20, this.screenPx(26)) * this.objScale, -9 * g);
    this.bubbles?.spawnAt(it.x, it.y);
    this.bubbles?.spawnAt(it.x + this.screenPx(20), it.y);
    this.audio?.quack();
    this.touch();
    this.onDuckCount?.(this.duckCount, this.maxDucks);
    return true;
  }

  // Nút − : con mới nhất (không đang bị cầm) lặn xuống, gợn sóng nhẹ. Luôn chừa ít nhất 1 con.
  removeDuck() {
    if (this.duckCount <= 1) return false;
    const it = this.ducks.remove();
    if (!it) return false;
    this.duckCount--;
    this.sim.disturb(it.x, it.y, Math.max(14, this.screenPx(18)) * this.objScale, -3);
    this.audio?.touch();
    this.touch();
    this.onDuckCount?.(this.duckCount, this.maxDucks);
    return true;
  }

  // Con trỏ đang ở đâu trên mặt phẳng của vịt — để vịt ngó theo. Ghi kèm thời điểm để hết hạn.
  pointerAt(clientX, clientY) {
    const q = this.imageAt(clientX, clientY, Z.duck);
    this.pointer = { ix: q.ix, iy: q.iy, t: this.t };
  }

  drop(ix, iy) {
    const g = this.reduceMotion ? 0.6 : 1;
    this.sim.disturb(ix, iy, Math.max(14, this.screenPx(17)), -7.5 * g);
    this.bubbles?.spawnAt(ix, iy); // bấm nước: vài bóng nhỏ nổi lên từ chỗ bấm
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
      const dtSim = 1 / this.sim.hz;
      while (this.acc >= dtSim && n < 6) { this.sim.step(); this.acc -= dtSim; n++; }
      if (n === 6) this.acc = 0;
      this.leaves.update(dt, t, this.sim);
      this.ambientDrops(dt);
    }
    this.ducks.update(t, dt, this.sim, this.pointer);
    this.leaves.avoidDucks(this.ducks.bodies());
    this.bubbles?.update(t, dt);
    this.sparkles?.update(t, dt);
    this.leaves.sync(t, dt, this.sim);
    this.sortLayers();
    this.sim.upload();
    this.updateCamera(dt);
    this.water.update(t);
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

  // Xếp lớp theo trục y như game 2D (Unity Y-sort), tính lại MỖI KHUNG HÌNH. Ta nhìn từ DƯỚI hồ lên,
  // nên ngược với nhìn từ trên xuống: vật ở gần người xem hiện CAO hơn trên màn hình (toạ độ ảnh y nhỏ
  // hơn) → vật có y màn hình cao hơn vẽ sau, đè lên vật thấp hơn — vịt và lá chung một danh sách. Vật
  // đang được nhấc lên khỏi mặt nước luôn ở trên cùng. Giọt nước (renderOrder ≥ 20000) vẫn trên hết.
  sortLayers() {
    const all = [...this.ducks.drawables(), ...this.leaves.drawables()];
    all.sort((a, b) => (a.lift - b.lift) || (b.y - a.y)); // y ảnh lớn (thấp trên màn hình) vẽ trước
    all.forEach((d, i) => { d.mesh.renderOrder = 20 + i; });
  }

  /* -------------------------------------------------------------- debug (?debug) */
  // Lưới sóng nằm trên mặt phẳng phối cảnh, không còn khớp affine với ảnh: lớp debug chỉ là bản đồ lưới
  // (toàn khung), không trùng vị trí trên màn hình.
  setupDebug() {
    const c = document.createElement('canvas');
    c.className = 'pond-debug';
    c.width = this.sim.cols; c.height = this.sim.rows;
    Object.assign(c.style, { left: '0%', top: '0%', width: '100%', height: '100%' });
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

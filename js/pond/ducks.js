// Hai chú vịt NỔI TRÊN mặt nước, là model 3D thật (duck3d.js nạp models/duck.glb) chứ không còn khung ảnh.
//
// Mặt nước trong tranh bị ép dẹt theo chiều dọc 0,39 lần (đo từ chính các khung turntable cũ).
// Nên cách dựng là: nghiêng cả con vịt đi asin(0,39) ≈ 23° cho khớp mặt nước, rồi xoay quanh trục
// đứng theo hướng bơi. Thế là ra đúng hiệu ứng turntable mà mượt ở mọi góc, không còn khái niệm khung.
//
// Mực nước cắt thân vịt được tính thẳng trong shader theo độ cao của từng đỉnh, nên chính xác tuyệt
// đối — bỏ được toàn bộ đoạn dò mực nước theo cột, cắt ảnh, chừa lề và hoà hai khung của bản cũ.
import * as THREE from 'three';
import { DUCKS, DUCK_MODEL, Z, CAMERA, PERSPECTIVE, surfaceBottom } from './config.js';
import { duckMaterial } from './duck3d.js';
import { bindFloater } from './floater.js';
import { waveAt } from './water.js';

const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const TAU = Math.PI * 2;
const wrap = (a) => { a %= TAU; return a < 0 ? a + TAU : a; };
const delta = (a, b) => { const d = wrap(a - b); return d > Math.PI ? d - TAU : d; };

export class Ducks {
  constructor({ scene, view, world, sim, persp, ambGain, reduceMotion, squash, centre, model, splash, net, scale = 1, count = DUCKS.count }) {
    this.scene = scene; this.sim = sim; this.net = net; // giữ lại để thêm vịt sau (add)
    this.V = view;
    this.persp = persp;
    this.splash = splash;
    this.ambGain = ambGain;
    this.reduceMotion = reduceMotion;
    this.squash = squash || 0.39;
    this.centre = centre; // tâm khung nhìn (toạ độ ảnh) — shader cần để quy về toạ độ ảnh
    this.s = { h: 0, gx: 0, gy: 0 };
    this.w = { h: 0, gx: 0, gy: 0 };
    // scale: objScale của cảnh (điện thoại dọc < 1) — cỡ, vùng tiếp nước, biên bơi, tốc độ đều theo nó
    this.scale = DUCKS.scale * scale;
    this.speed = DUCKS.speed * scale; // vịt nhỏ thì bơi chậm theo, không vụt nhanh hơn thân mình
    this.night = 0; // 0 = ngày … 1 = đêm, scene.js đặt mỗi khung (ánh trăng trên thân vịt — floater.js)

    // Mặt cắt thân ở mực nước (đo từ chính model): nửa trục dọc thân và ngang thân của elip tiếp nước.
    // Không có model (tải lỗi) thì ao không có vịt, mọi hàm bên dưới vẫn chạy với danh sách rỗng.
    this.model = model;
    this.contact = model ? [model.contact[0] * this.scale, model.contact[1] * this.scale] : [0, 0];
    this.geo = model?.geometry; // gốc toạ độ đã đặt đúng mực nước (duck3d.js → rig)

    // Biên bơi: đặt sao cho CẢ CON nằm trong khung — đầu nhô cao ~250 px trên mực nước, chân thò
    // xuống ~130 px, thân dài ~340 px — chứ không chỉ tâm elip tiếp nước; không thì vịt bơi sát mép
    // trên là mất đầu. Màn hẹp quá (điện thoại dọc) thì co về giữa.
    const bb = model?.geometry.boundingBox, c = Math.sqrt(1 - this.squash * this.squash), m = DUCKS.pickMargin * 0.5;
    // sát mép trên vịt được phóng to nhất (PERSPECTIVE.near) nên đầu cao hơn ngần ấy
    const up = bb ? bb.max.y * c * this.scale * PERSPECTIVE.near : 0, down = bb ? -bb.min.y * c * this.scale : 0;
    const side = this.contact[0] * 1.1;
    const B = { x0: view.x + m + side, x1: view.x + view.w - m - side, y0: view.y + m + up, y1: view.y + view.h - m - down };
    if (B.x1 < B.x0) B.x0 = B.x1 = view.x + view.w / 2;
    if (B.y1 < B.y0) B.y0 = B.y1 = view.y + view.h / 2;
    this.bounds = B;

    this.items = [];
    for (let k = 0; k < (model ? count : 0); k++) {
      // hai con đầu ở chỗ quen (trái-giữa, phải-giữa); các con thêm tìm chỗ trống
      const [x, y] = k < 2 ? [view.x + view.w * (k === 0 ? 0.34 : 0.66), view.y + view.h * (k === 0 ? 0.44 : 0.56)] : this.freeSpot();
      this.makeItem(x, y);
    }
  }

  // Dựng một con vịt ở (x, y) toạ độ ảnh và thêm vào danh sách.
  makeItem(x, y) {
    const model = this.model, centre = this.centre;
    const mat = duckMaterial(model, this.ambGain);
    bindFloater(mat, { sim: this.sim, centre, squash: this.squash, net: this.net, reduceMotion: this.reduceMotion }); // lưới sóng + khung nhìn + lưới sóng trắng phủ phần nổi
    mat.uniforms.uPhase.value = rand(0, TAU); // các con không quẫy đồng nhịp
    const mesh = new THREE.Mesh(this.geo, mat);
    // Thứ tự vẽ (renderOrder) do scene.js xếp theo trục y chung với lá, đặt trên MESH chứ không trên
    // Group: renderOrder của Group thành groupOrder, xếp trước mọi renderOrder lẻ nên vịt sẽ đè lên cả
    // giọt nước (20000/30000). Mỗi vật tự xoá bộ đệm độ sâu trước khi vẽ: độ sâu chỉ để con vịt tự che
    // chính nó; chồng lớp giữa các vật là theo y, không so độ sâu (đầu vịt nghiêng ra xa, so độ sâu thì
    // lá ở trước che mất đầu).
    mesh.renderOrder = 100 + this.items.length;
    mesh.onBeforeRender = (renderer) => renderer.clearDepth();
    // root (vị trí, cỡ) → tilt (nghiêng 23° theo mặt nước) → yaw (hướng bơi) → lean (nghiêng theo sóng,
    // vào khúc rẽ, lắc khi rũ nước; thở bằng scale) → mesh
    const lean = new THREE.Group(); lean.add(mesh);
    const yaw = new THREE.Group(); yaw.add(lean);
    const tilt = new THREE.Group(); tilt.add(yaw);
    tilt.rotation.x = -Math.asin(this.squash); // nghiêng cho khớp độ ép dẹt của mặt nước
    const root = new THREE.Group(); root.add(tilt);
    this.scene.add(root);

    const it = {
      root, yaw, lean, mat, mesh,
      x, y,
      vx: 0, vy: 0,
      head: rand(0, TAU),
      goal: null, rest: rand(0.4, 2),
      held: false, tx: 0, ty: 0, grabX: 0, grabY: 0,
      bob: 0, wake: 0, paddle: DUCK_MODEL.paddle * 0.3,
      tailNext: rand(...DUCK_MODEL.tail.every), tailT: -1, // lịch vẫy đuôi: đếm ngược tới đợt sau, thời gian trong đợt
      phase: rand(0, TAU),
      // đầu: góc hiện tại, hướng ngó tự nhiên và lịch đổi hướng, góc còn phải rẽ (để quay đầu trước)
      headYaw: 0, headPitch: 0, lookYaw: 0, lookPitch: 0, lookNext: rand(0.5, 2), turnLeft: 0,
      // thân: nghiêng hiện tại, tốc độ rẽ (để nghiêng vào khúc rẽ), hướng khung trước
      roll: 0, pitch: 0, yawRate: 0, prevHead: 0,
      // rũ nước: thời gian trong đợt (−1 = không), đếm ngược tới đợt sau, đếm ngược sau khi được thả
      shakeT: -1, shakeNext: rand(...DUCKS.shake.every), shakeAfter: -1,
      // vào / ra ao (nút + / −): thời gian từ lúc rơi xuống nước, lúc bắt đầu lặn đi (−1 = không); hệ số cỡ
      enterT: -1, leaveT: -1, pop: 1,
      bumpCD: 0, // thời gian hồi sau khi chạm con khác (bump)
    };
    it.prevHead = it.head;
    this.items.push(it);
    this.pickGoal(it);
    return it;
  }

  // Chỗ trống trên mặt nước cho vịt mới: thử nhiều điểm trong biên bơi, lấy điểm xa các con khác nhất (đo trên màn
  // hình như separate()).
  freeSpot() {
    const B = this.bounds, m = DUCKS.pickMargin * 0.5, others = this.items.filter((q) => q.leaveT < 0);
    let best = [(B.x0 + B.x1) / 2, (B.y0 + B.y1) / 2], bestD = -1;
    for (let i = 0; i < 60; i++) {
      const x = rand(B.x0 + m, B.x1 - m), yb = Math.min(B.y1 - m, this.zoneBottom(x) - m);
      if (yb <= B.y0 + m) continue;
      const y = rand(B.y0 + m, yb);
      let d = Infinity;
      for (const q of others) d = Math.min(d, Math.hypot(q.x - x, (q.y - y) * 0.8));
      if (d > bestD) { bestD = d; best = [x, y]; }
    }
    return best;
  }

  // Nút + (scene.addDuck): một con rơi xuống chỗ trống. Trả về con mới (scene.js làm sóng, bóng, tiếng quạc).
  add() {
    if (!this.model) return null;
    const [x, y] = this.freeSpot();
    const it = this.makeItem(x, y);
    it.enterT = 0; it.pop = DUCKS.enter.from; it.rest = DUCKS.enter.dur + rand(0.2, 0.8);
    return it;
  }

  // Nút − (scene.removeDuck): con mới nhất không đang bị cầm lặn xuống rồi biến mất. Trả về con đó.
  remove() {
    for (let k = this.items.length - 1; k >= 0; k--) {
      const it = this.items[k];
      if (!it.held && it.leaveT < 0) { it.leaveT = 0; it.goal = null; it.rest = 99; return it; }
    }
    return null;
  }

  // Số con đang ở lại ao (không tính con đang lặn đi).
  get count() { return this.items.filter((it) => it.leaveT < 0).length; }

  /* -------------------------------------------------------------- hướng */
  // Vector di chuyển trên màn hình → hướng trên mặt nước (bù lại độ ép dẹt).
  headingOf(vx, vy) { return Math.atan2(vy / this.squash, vx); }
  dirOf(head) { return [Math.cos(head), Math.sin(head) * this.squash]; }

  // Mép dưới của mặt nước tại x (cung SURFACE.arc) — vịt không bơi xuống vùng nước sâu.
  zoneBottom(x) { return surfaceBottom(x) - DUCKS.zoneMargin; }

  pickGoal(it) {
    const B = this.bounds, m = DUCKS.pickMargin * 0.5; // đích lùi vào trong biên thêm chút nữa
    const gx0 = Math.min(B.x0 + m, (B.x0 + B.x1) / 2), gx1 = Math.max(B.x1 - m, (B.x0 + B.x1) / 2);
    const gy0 = Math.min(B.y0 + m, (B.y0 + B.y1) / 2), gy1 = Math.max(B.y1 - m, (B.y0 + B.y1) / 2);
    for (let i = 0; i < 40; i++) {
      const gx = rand(gx0, gx1), yb = Math.min(gy1, this.zoneBottom(gx) - m);
      if (yb <= gy0) continue; // chỗ này mặt nước quá hẹp
      const gy = rand(gy0, yb);
      if (Math.hypot(gx - it.x, gy - it.y) >= DUCKS.minTrip) { it.goal = [gx, gy]; return; }
    }
    const gx = rand(gx0, gx1);
    it.goal = [gx, Math.min(rand(gy0, gy1), this.zoneBottom(gx))];
  }

  /* -------------------------------------------------------------- vòng lặp */
  update(t, dt, sim, pointer) {
    sim.clearSolid();
    if (dt > 0) {
      for (const it of this.items) { this.drive(it, t, dt, sim); if (it.bumpCD > 0) it.bumpCD -= dt; }
      this.separate();
      for (const it of this.items) this.animate(it, t, dt, pointer);
      this.enterLeave(dt);
    }
    for (const it of this.items) {
      this.draw(it, t, sim);
      if (it.leaveT < 0) sim.stampEllipse(it.x, it.y, this.contact[0], this.contact[1], it.head); // nửa trục trên mặt nước, phối cảnh do lưới lo
    }
  }

  // Vào / ra ao: rơi xuống thì cỡ bật từ DUCKS.enter.from lên quá 1 một chút rồi về 1 (nhún nước); lặn đi thì co về 0
  // nhanh dần rồi gỡ khỏi cảnh, trả vật liệu.
  enterLeave(dt) {
    const E = DUCKS.enter, L = DUCKS.leave;
    for (let k = this.items.length - 1; k >= 0; k--) {
      const it = this.items[k];
      if (it.enterT >= 0) {
        it.enterT += dt;
        const u = Math.min(1, it.enterT / E.dur), c = 1.70158 * 1.4; // easeOutBack
        it.pop = E.from + (1 - E.from) * (1 + (c + 1) * (u - 1) ** 3 + c * (u - 1) ** 2);
        if (u >= 1) { it.enterT = -1; it.pop = 1; }
      }
      if (it.leaveT >= 0) {
        it.leaveT += dt;
        const u = Math.min(1, it.leaveT / L.dur);
        it.pop = 1 - u * u;
        if (u >= 1) {
          this.scene.remove(it.root);
          it.mat.dispose();
          this.items.splice(k, 1);
        }
      }
    }
  }

  // Hai con không chồng lên nhau: gần quá thì đẩy ra. Khoảng cách đo TRÊN MÀN HÌNH chứ không trên mặt
  // phẳng nước — con vịt cao gần 400 px trên màn hình trong khi elip tiếp nước chỉ dẹt 100 px, nên "không
  // chạm nhau trên mặt nước" vẫn là con này đè kín con kia. Chiều dọc còn tính nhẹ đi (kY < 1) vì vịt
  // cao hơn rộng: xếp trên–dưới phải cách xa hơn xếp ngang. Con đang bị kéo đứng yên, con kia nhường.
  // DUCKS.separation: 1,5 cũ để hai con cách nhau hơn cả thân; 1,05 (−30 %, chủ dự án 2026-10-07 khi cho thêm vịt) cho
  // bơi sát hơn, có thể chồng mép (con cao hơn trên màn hình đè lên — Y-sort) nhưng không con nào che kín con kia.
  separate() {
    const minD0 = (this.contact[0] + this.contact[1]) * DUCKS.separation, kY = 0.8;
    for (let i = 0; i < this.items.length; i++) for (let j = i + 1; j < this.items.length; j++) {
      const p = this.items[i], q = this.items[j];
      if (p.leaveT >= 0 || q.leaveT >= 0) continue;
      const minD = minD0 * (this.persp.S(p.x, p.y) + this.persp.S(q.x, q.y)) * 0.5;
      const dx = q.x - p.x, dy = (q.y - p.y) * kY, d = Math.hypot(dx, dy) || 1;
      if (d >= minD) continue;
      const ux = dx / d, uy = (dy / d) / kY, gap = minD - d;
      const wp = p.held ? 0 : q.held ? 1 : 0.5, wq = q.held ? 0 : p.held ? 1 : 0.5;
      p.x -= ux * gap * wp; p.y -= uy * gap * wp;
      q.x += ux * gap * wq; q.y += uy * gap * wq;
      this.bump(p, q, -ux, -uy);
      this.bump(q, p, ux, uy);
    }
  }

  // Chạm con khác (2026-10-07, chủ dự án: "khi vịt chạm nhau nó sẽ chuyển hướng khác để đi"): nảy lùi nhẹ, chọn đích
  // mới về phía NGƯỢC con kia (lệch ngẫu nhiên ±DUCKS.bump.spread°) — kể cả con đang nghỉ; gợn nhỏ ở chỗ chạm. Có thời
  // gian hồi để hai con đang tách nhau không đổi hướng liên tục. Con đang bị kéo không đổi gì.
  bump(it, other, ax, ay) {
    if (it.held || it.leaveT >= 0 || it.bumpCD > 0) return;
    const Bp = DUCKS.bump, ps = this.persp.S(it.x, it.y);
    it.bumpCD = Bp.cooldown;
    it.vx += ax * Bp.bounce * ps; it.vy += ay * Bp.bounce * ps;
    this.pickGoalAway(it, ax, ay);
    it.rest = 0;
    if (!other.held && other.bumpCD > 0 && other.bumpCD > Bp.cooldown - 0.05) {
      // con kia vừa phản ứng trong cùng khung → gợn một lần ở giữa hai con
      this.sim?.disturb((it.x + other.x) / 2, (it.y + other.y) / 2, this.contact[1] * 0.8, -Bp.ripple);
    }
  }

  // Đích mới lệch không quá ±spread° khỏi hướng (ax, ay) (màn hình), đủ xa; không tìm được thì đi thẳng hướng ấy.
  pickGoalAway(it, ax, ay) {
    const B = this.bounds, m = DUCKS.pickMargin * 0.5, cosMax = Math.cos((DUCKS.bump.spread * Math.PI) / 180);
    const al = Math.hypot(ax, ay) || 1; ax /= al; ay /= al;
    for (let i = 0; i < 50; i++) {
      const gx = rand(B.x0 + m, B.x1 - m), yb = Math.min(B.y1 - m, this.zoneBottom(gx) - m);
      if (yb <= B.y0 + m) continue;
      const gy = rand(B.y0 + m, yb), vx = gx - it.x, vy = gy - it.y, vl = Math.hypot(vx, vy);
      if (vl < DUCKS.minTrip * 0.5) continue;
      if ((vx * ax + vy * ay) / vl >= cosMax) { it.goal = [gx, gy]; return; }
    }
    const L = DUCKS.minTrip * 0.6, gx = Math.max(B.x0, Math.min(B.x1, it.x + ax * L));
    it.goal = [gx, Math.max(B.y0, Math.min(B.y1, this.zoneBottom(gx), it.y + ay * L))];
  }

  drive(it, t, dt, sim) {
    let wantX = 0, wantY = 0;
    it.turnLeft = 0;
    if (it.held) {
      wantX = (it.tx - it.x) * DUCKS.dragFollow;
      wantY = (it.ty - it.y) * DUCKS.dragFollow;
      const sp = Math.hypot(wantX, wantY), cap = this.speed * 3.4;
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
        it.turnLeft = turn;
        it.head = wrap(it.head + Math.sign(turn) * Math.min(Math.abs(turn), DUCKS.turnRate * dt));
        const [ux, uy] = this.dirOf(it.head);
        const ease = Math.max(0.15, Math.cos(Math.min(Math.abs(turn), Math.PI) * 0.5));
        const ps = this.persp.S(it.x, it.y); // xa (thấp trên màn hình) thì bơi chậm hơn trên màn hình
        wantX = ux * this.speed * ease * ps;
        wantY = uy * this.speed * ease * ps;
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
      it.turnLeft = turn;
      it.head = wrap(it.head + Math.sign(turn) * Math.min(Math.abs(turn), DUCKS.turnRate * 1.6 * dt));
    }

    const B = this.bounds;
    if (it.x < B.x0) { it.x = B.x0; it.vx = Math.abs(it.vx); }
    if (it.x > B.x1) { it.x = B.x1; it.vx = -Math.abs(it.vx); }
    if (it.y < B.y0) { it.y = B.y0; it.vy = Math.abs(it.vy); }
    if (it.y > B.y1) { it.y = B.y1; it.vy = -Math.abs(it.vy); }
    const yb = this.zoneBottom(it.x); // không trôi xuống vùng nước sâu dưới cung mặt nước
    if (it.y > yb) { it.y = yb; it.vy = -Math.abs(it.vy); }

    // Quẫy chân mạnh nhẹ theo tốc độ bơi: đứng nghỉ thì chỉ khẽ đạp giữ thăng bằng.
    const wantPaddle = DUCK_MODEL.paddle * (0.3 + 0.7 * Math.min(1, sp / this.speed)) * (this.reduceMotion ? 0.4 : 1);
    it.paddle += (wantPaddle - it.paddle) * Math.min(1, dt * 3);

    // Thỉnh thoảng vẫy đuôi một đợt ngắn.
    const T = DUCK_MODEL.tail;
    if (it.tailT >= 0) { it.tailT += dt; if (it.tailT >= T.dur) it.tailT = -1; }
    else if ((it.tailNext -= dt) <= 0 && !this.reduceMotion) { it.tailT = 0; it.tailNext = rand(T.every[0], T.every[1]); }

    // Rũ nước: theo lịch, hoặc một lúc sau khi được thả ra.
    const SH = DUCKS.shake;
    if (it.shakeT >= 0) {
      const was = it.shakeT;
      it.shakeT += dt;
      // giọt bay chưa tới nửa giây đã rơi, nên bắn thêm một đợt giữa chừng cho tia nước kéo dài bằng cú rũ
      if (was < SH.dur * 0.45 && it.shakeT >= SH.dur * 0.45) this.spray(it);
      if (it.shakeT >= SH.dur) it.shakeT = -1;
    } else if (!it.held && !this.reduceMotion) {
      if (it.shakeAfter > 0 && (it.shakeAfter -= dt) <= 0) this.startShake(it);
      else if ((it.shakeNext -= dt) <= 0) this.startShake(it);
    }

    // Sóng rẽ ra sau đuôi. Vịt bơi gần như liên tục nên đây là nguồn sóng thường trực — mạnh tay
    // một chút là cả mặt ao đầy vòng sóng chồng chéo.
    it.wake -= dt;
    if (sp > DUCKS.wakeMinSpeed && it.wake <= 0 && !this.reduceMotion) {
      it.wake = DUCKS.wakeEvery;
      const r = this.contact[0], ri = r * this.persp.S(it.x, it.y); // ri: lùi sau đuôi theo px ảnh; r: bán kính trên mặt nước
      const ux = it.vx / sp, uy = it.vy / sp;
      const amt = Math.min(1, sp / this.speed) * DUCKS.wakeGain;
      sim.disturb(it.x - ux * ri, it.y - uy * ri, r * 0.6, -amt);
    }
  }

  startShake(it) {
    const SH = DUCKS.shake;
    it.shakeT = 0; it.shakeAfter = -1;
    it.shakeNext = rand(SH.every[0], SH.every[1]);
    it.tailT = 0; // đuôi vẫy cùng lúc
    this.spray(it);
  }

  // giọt bắn từ hai đầu thân chứ không từ một điểm
  spray(it) {
    if (!this.splash) return;
    const SH = DUCKS.shake, [a] = this.contact;
    const ux = Math.cos(it.head) * a * 0.5, uy = Math.sin(it.head) * a * 0.5 * this.squash;
    this.splash(it.x + ux, it.y + uy, Math.ceil(SH.drops / 2));
    this.splash(it.x - ux, it.y - uy, Math.floor(SH.drops / 2));
  }

  /* -------------------------------------------------------------- đầu và thân "sống" */
  // Phần làm con vịt có hồn: đầu luôn có việc để làm (ngó, nhìn theo tay, quay trước khi rẽ, gật theo
  // nhịp đạp), thân nổi thật theo mặt nước (nghiêng theo độ dốc, vào khúc rẽ, chúi theo nhịp đạp, thở),
  // thỉnh thoảng rũ nước. Mọi góc đều bám đích theo hàm mũ nên không bao giờ giật.
  animate(it, t, dt, pointer) {
    const H = DUCKS.head, F = DUCKS.float, SH = DUCKS.shake, S = this.s, W = this.w;
    const paddleK = it.paddle / DUCK_MODEL.paddle;
    const stroke = t * TAU * DUCK_MODEL.paddleHz + it.mat.uniforms.uPhase.value; // cùng pha với chân trong shader
    const shake = it.shakeT >= 0 ? Math.sin((it.shakeT / SH.dur) * Math.PI) * Math.sin(it.shakeT * TAU * SH.hz) : 0;

    /* ---- đầu */
    if ((it.lookNext -= dt) <= 0) {
      it.lookNext = rand(H.lookEvery[0], H.lookEvery[1]);
      it.lookYaw = rand(-1, 1) ** 3 * H.lookRange; // mũ ba: hay ngó gần, thỉnh thoảng ngoái xa
      it.lookPitch = rand(-0.08, 0.05);
    }
    let yawT = it.lookYaw + clamp(it.turnLeft * H.lead, -H.yawMax, H.yawMax); // quay đầu trước khi thân rẽ
    let pitchT = it.lookPitch + Math.sin(stroke) * H.nod * paddleK;
    // nhìn theo con trỏ khi nó lại gần (góc tương đối tính trên mặt phẳng nước, như hướng bơi)
    if (pointer && t - pointer.t < 3) {
      const dx = pointer.ix - it.x, dy = (pointer.iy - it.y) / this.squash, d = Math.hypot(dx, dy);
      if (d < H.lookAt) {
        const k = Math.min(1, (1 - d / H.lookAt) * 2); // mép vùng thì liếc nhẹ, vào sâu thì nhìn hẳn
        const rel = clamp(delta(Math.atan2(dy, dx), it.head), -H.yawMax, H.yawMax);
        yawT += (rel - yawT) * k;
        pitchT += H.peek * k * Math.max(0, 1 - d / (H.lookAt * 0.6));
      }
    }
    yawT += shake * SH.headYaw;
    const eh = 1 - Math.exp(-dt * H.ease);
    it.headYaw += (yawT - it.headYaw) * eh;
    it.headPitch += (pitchT - it.headPitch) * eh;

    /* ---- thân */
    // độ dốc mặt nước chỗ vịt đứng (sóng mô phỏng + sóng nền), đổi từ màn hình về mặt phẳng nước rồi
    // chiếu lên trục dọc/ngang thân. Nước cao hơn phía trước thì ngẩng mũi; cao hơn bên nào thì bên ấy nhô.
    const gx = S.gx + W.gx, gy = (S.gy + W.gy) * this.squash;
    const ch = Math.cos(it.head), sh = Math.sin(it.head);
    const sf = gx * ch + gy * sh, sl = -gx * sh + gy * ch;
    const gain = F.slopeGain * (this.reduceMotion ? 0.5 : 1);
    let pT = clamp(Math.atan(sf) * gain, -F.maxTilt, F.maxTilt) - Math.sin(stroke) * F.surge * paddleK;
    let rT = -clamp(Math.atan(sl) * gain, -F.maxTilt, F.maxTilt);
    // nghiêng vào khúc rẽ: rẽ trái (quay dương quanh trục đứng) thì nghiêng trái
    const rate = delta(it.head, it.prevHead) / dt;
    it.prevHead = it.head;
    it.yawRate += (rate - it.yawRate) * Math.min(1, dt * 6);
    rT += clamp(it.yawRate / DUCKS.turnRate, -1, 1) * F.bank;
    rT += shake * SH.roll;
    const eb = 1 - Math.exp(-dt * F.ease);
    it.roll += (rT - it.roll) * eb;
    it.pitch += (pT - it.pitch) * eb;
  }

  draw(it, t, sim) {
    const S = this.s, W = this.w;
    sim.sample(it.x, it.y, S);
    waveAt(it.x, it.y, t, this.ambGain, W, this.persp);
    it.bob = S.h * 0.35 + W.h * 0.8 + Math.sin(t * 0.8 + it.phase) * 1.4;

    it.yaw.rotation.y = it.head;
    it.lean.rotation.set(it.roll, 0, it.pitch);
    const br = 1 + Math.sin(t * TAU * DUCKS.float.breathHz + it.phase) * DUCKS.float.breath * (this.reduceMotion ? 0.5 : 1);
    it.lean.scale.set(1, br, 1 + (br - 1) * 0.6); // thở: cao và ngang thân phập phồng, không dài ra
    it.mat.uniforms.uHeadYaw.value = it.headYaw;
    it.mat.uniforms.uHeadPitch.value = it.headPitch;
    // nhấp nhô: mực nước trong shader dịch ngược lại nên vịt chìm nông sâu theo sóng
    it.mat.uniforms.uWaterY.value = it.bob * DUCKS.bobGain;
    it.mat.uniforms.uTime.value = t;
    it.mat.uniforms.uNight.value = this.night;
    it.mat.uniforms.uPaddle.value = it.paddle;
    it.mat.uniforms.uAnkle.value = DUCK_MODEL.ankleAmp * (it.paddle / DUCK_MODEL.paddle); // bàn chân gập theo mức quẫy
    // vẫy đuôi: dao động nhanh trong một bao hình sin để vào/ra êm
    const T = DUCK_MODEL.tail;
    it.mat.uniforms.uTail.value = it.tailT >= 0 ? Math.sin((it.tailT / T.dur) * Math.PI) * Math.sin(it.tailT * TAU * T.hz) * T.amp : 0;

    // Đặt gốc con vịt (đúng mực nước) vào toạ độ ảnh, bù thị sai như các lớp khác.
    // Cộng thêm một chút theo chiều sâu màn hình để con ở dưới che con ở trên khi chúng chồng nhau.
    const z = Z.duck + it.y * 0.004;
    const kp = (CAMERA.D - z) / CAMERA.D;
    it.root.position.set((it.x - this.centre[0]) * kp, -(it.y - this.centre[1]) * kp, z);
    it.root.scale.setScalar(this.scale * kp * this.persp.S(it.x, it.y) * it.pop); // phối cảnh: cao hơn / ra hai bên thì to hơn; pop: vào/ra ao
    it.root.rotation.z = -this.persp.lean(it.x, it.y) * PERSPECTIVE.lean; // ngả theo tia về điểm tụ, như vòng sóng quanh nó
    it.mat.uniforms.uKp.value = kp; // shader cần để quy toạ độ thế giới về toạ độ ảnh
  }

  // Cho scene.js xếp lớp theo trục y (cùng danh sách với lá).
  drawables() {
    return this.items.map((it) => ({ y: it.y, mesh: it.mesh, lift: false }));
  }

  /* -------------------------------------------------------------- con trỏ */
  // Hình bầu dục tiếp nước, để lá không trôi xuyên qua vịt.
  bodies() {
    return this.items.filter((it) => it.leaveT < 0).map((it) => {
      const ps = this.persp.S(it.x, it.y), a = this.contact[0] * ps, b = this.contact[1] * ps;
      const ch = Math.abs(Math.cos(it.head)), sh = Math.abs(Math.sin(it.head));
      return { cx: it.x, cy: it.y, rx: a * ch + b * sh, ry: (a * sh + b * ch) * this.squash };
    });
  }

  // Vùng bấm là hộp bao cả con vịt TRÊN MÀN HÌNH: đầu cổ nhô cao trên mực nước, chân thò xuống dưới.
  // Dùng elip tiếp nước thì chỉ là dải hẹp quanh mực nước — bấm vào đầu là hụt, thành cú chạm nước.
  pick(ix, iy) {
    if (!this.model) return -1;
    const bb = this.model.geometry.boundingBox; // gốc ở mực nước: max.y đỉnh đầu, min.y gan chân
    const c = Math.sqrt(1 - this.squash * this.squash); // cos của góc nghiêng 23°
    const [a, b] = this.contact;
    for (let k = this.items.length - 1; k >= 0; k--) {
      const it = this.items[k], ps = this.persp.S(it.x, it.y);
      if (it.leaveT >= 0) continue; // đang lặn đi: không bấm được
      const dx = ix - it.x, dy = iy - it.y;
      const ch = Math.abs(Math.cos(it.head)), sh = Math.abs(Math.sin(it.head));
      const halfW = (a * ch + b * sh) * 1.15 * ps, ry = (a * sh + b * ch) * this.squash * ps;
      const up = (bb.max.y * c * this.scale + ry) * ps, down = (-bb.min.y * c * this.scale + ry) * ps;
      if (Math.abs(dx) <= halfW && dy >= -up && dy <= down) return k;
    }
    return -1;
  }

  // k: chỉ số hoặc chính con vịt (input.js giữ con vịt — thêm/bớt vịt làm xê dịch chỉ số)
  item(k) { return typeof k === 'number' ? this.items[k] : k; }

  grab(k, ix, iy) {
    const it = this.item(k);
    it.held = true;
    it.goal = null;
    it.rest = 0;
    it.grabX = it.x - ix;
    it.grabY = it.y - iy;
    it.tx = it.x; it.ty = it.y;
  }

  moveHeld(k, ix, iy) {
    const it = this.item(k), B = this.bounds;
    it.tx = Math.max(B.x0, Math.min(B.x1, ix + it.grabX));
    it.ty = Math.max(B.y0, Math.min(B.y1, this.zoneBottom(it.tx), iy + it.grabY));
  }

  release(k) {
    const it = this.item(k);
    it.held = false;
    it.rest = rand(0.3, 1.2);
    if (Math.random() < DUCKS.shake.afterDrag) it.shakeAfter = rand(0.4, 0.9); // bị cầm xong thì rũ mình
  }
}

// Chuột / cảm ứng: di chuột để nghiêng cảnh, kéo lá, kéo vịt (vịt quay đầu theo hướng kéo, kêu quạc),
// bấm bong bóng cho nổ, chạm hoặc vuốt mặt nước để tạo sóng. Cử chỉ đầu tiên mở âm thanh (audio.js).
import { Z, LEAVES } from './config.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class PondInput {
  constructor(pond, el) {
    this.pond = pond;
    this.el = el;
    this.active = null; // { id, mode, leaf?|duck?, last, samples }
    this.hoverQueued = false;
    this.hoverEvent = null;

    window.addEventListener('pointermove', (e) => this.onWindowMove(e), { passive: true });
    el.addEventListener('pointerdown', (e) => this.onDown(e));
    el.addEventListener('pointermove', (e) => this.onMove(e));
    el.addEventListener('pointerup', (e) => this.onUp(e));
    el.addEventListener('pointercancel', (e) => this.onUp(e));
    el.addEventListener('lostpointercapture', (e) => this.onUp(e));
    el.addEventListener('pointerleave', () => { if (!this.active) this.setCursor(''); });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    // iPhone: có bản Safari chỉ mở âm thanh trong touchend / click (pointerdown chưa đủ) — gọi thêm ở đó.
    const unlock = () => this.pond.audio?.unlock();
    el.addEventListener('touchend', unlock, { passive: true });
    el.addEventListener('click', unlock);
  }

  setCursor(c) {
    if (this.el.dataset.cursor !== c) this.el.dataset.cursor = c;
  }

  // Nghiêng theo vị trí chuột trên toàn trang, tính tương đối với tâm ao.
  onWindowMove(e) {
    if (e.pointerType !== 'mouse' || this.active) return;
    const r = this.el.getBoundingClientRect();
    const nx = clamp((e.clientX - (r.left + r.width / 2)) / (r.width * 0.75), -1, 1);
    const ny = clamp((e.clientY - (r.top + r.height / 2)) / (r.height * 1.1), -1, 1);
    this.pond.tilt(nx, ny);
    if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
      this.pond.pointerAt(e.clientX, e.clientY);
      this.queueHover(e);
    }
  }

  queueHover(e) {
    this.hoverEvent = e;
    if (this.hoverQueued) return;
    this.hoverQueued = true;
    requestAnimationFrame(() => {
      this.hoverQueued = false;
      const ev = this.hoverEvent;
      if (!ev || this.active) return;
      if (this.pond.bubbles?.pickAt(ev.clientX, ev.clientY, this.pond)) { this.setCursor('pointer'); return; }
      const q = this.pond.imageAt(ev.clientX, ev.clientY, 0);
      if (!this.pond.inPond(q.ix, q.iy)) { this.setCursor(''); return; }
      const hit = this.pond.pick(ev.clientX, ev.clientY);
      this.setCursor(hit.type === 'water' ? '' : 'grab');
    });
  }

  onDown(e) {
    if (this.active || (e.button !== undefined && e.button > 0)) return;
    this.pond.audio?.unlock(); // cử chỉ đầu tiên: mở âm thanh, bật nhạc nền
    // Điện thoại: chạm đầu tiên xin toàn màn hình (ẩn thanh địa chỉ). Android Chrome được; iPhone Safari không hỗ trợ
    // cho trang thường nên lệnh im lặng bỏ qua. Chỉ xin một lần.
    if (e.pointerType === 'touch' && !this.askedFullscreen) {
      this.askedFullscreen = true;
      document.documentElement.requestFullscreen?.({ navigationUI: 'hide' })?.catch?.(() => {});
    }
    // Bong bóng: bấm là nổ (kèm tiếng nổ). Xét trước vùng mặt nước vì bóng nổi cả ở nước sâu phía dưới.
    const bubble = this.pond.bubbles?.pickAt(e.clientX, e.clientY, this.pond, e.pointerType !== 'mouse');
    if (bubble) {
      e.preventDefault();
      this.pond.bubbles.pop(bubble, 1.35);
      this.pond.audio?.pop();
      this.pond.touch();
      return;
    }
    const q0 = this.pond.imageAt(e.clientX, e.clientY, 0);
    if (!this.pond.inPond(q0.ix, q0.iy)) return;
    e.preventDefault();
    try { this.el.setPointerCapture(e.pointerId); } catch { /* bỏ qua */ }
    const hit = this.pond.pick(e.clientX, e.clientY);
    const now = performance.now();
    this.pond.pointerAt(e.clientX, e.clientY);
    if (hit.type === 'duck') {
      this.pond.audio?.quack(); // bấm vịt: quạc
      this.pond.ducks.grab(hit.index, hit.ix, hit.iy);
      this.active = { id: e.pointerId, mode: 'duck', duck: hit.index };
      this.setCursor('grabbing');
    } else if (hit.type === 'leaf') {
      this.pond.leaves.grab(hit.leaf, hit.ix, hit.iy, this.pond.sim);
      this.active = { id: e.pointerId, mode: 'leaf', leaf: hit.leaf, samples: [{ t: now, x: hit.ix, y: hit.iy }] };
      this.setCursor('grabbing');
    } else {
      this.pond.drop(q0.ix, q0.iy);
      this.pond.audio?.touch(); // chạm mặt hồ: tiếng nước
      this.active = { id: e.pointerId, mode: 'stir', last: { ...q0, t: now } };
    }
    this.pond.touch();
  }

  onMove(e) {
    const a = this.active;
    if (!a || a.id !== e.pointerId) return;
    const now = performance.now();
    this.pond.pointerAt(e.clientX, e.clientY);
    if (a.mode === 'duck') {
      const q = this.pond.imageAt(e.clientX, e.clientY, Z.duck);
      this.pond.ducks.moveHeld(a.duck, q.ix, q.iy);
      this.pond.touch();
    } else if (a.mode === 'leaf') {
      const q = this.pond.imageAt(e.clientX, e.clientY, Z.leaf + LEAVES.lift);
      this.pond.leaves.moveHeld(a.leaf, q.ix, q.iy);
      a.samples.push({ t: now, x: q.ix, y: q.iy });
      while (a.samples.length > 2 && now - a.samples[0].t > 90) a.samples.shift();
      this.pond.touch();
    } else if (a.mode === 'stir') {
      const q = this.pond.imageAt(e.clientX, e.clientY, 0);
      this.pond.stir(a.last, q, (now - a.last.t) / 1000);
      a.last = { ...q, t: now };
    }
  }

  onUp(e) {
    const a = this.active;
    if (!a || a.id !== e.pointerId) return;
    this.active = null;
    if (a.mode === 'duck') {
      this.pond.ducks.release(a.duck);
    } else if (a.mode === 'leaf') {
      const s = a.samples, first = s[0], last = s[s.length - 1];
      const dt = (last.t - first.t) / 1000;
      const fresh = performance.now() - last.t < 80;
      const vx = dt > 0.01 && fresh ? (last.x - first.x) / dt : 0;
      const vy = dt > 0.01 && fresh ? (last.y - first.y) / dt : 0;
      this.pond.leaves.release(a.leaf, vx, vy);
    }
    this.setCursor(e.pointerType === 'mouse' && a.mode !== 'stir' ? 'grab' : '');
    try { this.el.releasePointerCapture(e.pointerId); } catch { /* đã nhả */ }
  }
}

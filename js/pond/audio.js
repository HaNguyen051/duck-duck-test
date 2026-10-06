// Âm thanh của ao: nhạc nền lặp (audio/bg.mp3), tiếng nổ khi bấm bong bóng (audio/pop.mp3), tiếng vịt quạc khi
// bấm vịt (audio/quack.mp3), tiếng chạm nước khi bấm mặt hồ tạo sóng (audio/touch.mp3). Dùng Web Audio: file tải và giải mã sẵn lúc mở trang; AudioContext bị trình duyệt
// giữ ở trạng thái "suspended" cho tới cử chỉ đầu tiên của người dùng (chính sách autoplay) nên nhạc nền chỉ
// bắt đầu sau cú bấm/chạm đầu tiên (input.js gọi unlock() ngay trong pointerdown). Nguồn phát start() khi context
// còn suspended vẫn được xếp hàng và kêu ngay khi context chạy, nên tiếng nổ/quạc của chính cú bấm đầu tiên
// không bị nuốt. Ẩn tab thì tạm dừng, hiện lại thì chạy tiếp.
import { AUDIO } from './config.js';

export class PondAudio {
  constructor() {
    this.buffers = {};
    this.started = false;
    this.musicSrc = null;
    this.lastPlay = {};
    this.ctx = null;
    if (!AUDIO.enabled) return;
    try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { this.ctx = null; }
    if (!this.ctx) return;
    const ctx = this.ctx;
    this.master = ctx.createGain(); this.master.gain.value = AUDIO.master; this.master.connect(ctx.destination);
    this.sfx = ctx.createGain(); this.sfx.gain.value = AUDIO.sfx; this.sfx.connect(this.master);
    this.music = ctx.createGain(); this.music.gain.value = 0; this.music.connect(this.master);
    for (const [key, url] of Object.entries(AUDIO.files)) this.load(key, url);
    document.addEventListener('visibilitychange', () => {
      if (!this.started) return;
      if (document.hidden) ctx.suspend(); else ctx.resume();
    });
  }

  async load(key, url) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      this.buffers[key] = await this.ctx.decodeAudioData(await r.arrayBuffer());
      if (key === 'bg' && this.started) this.startMusic(); // người dùng bấm trước khi nhạc tải xong
    } catch (err) {
      console.warn('[Ao Vịt] Không nạp được âm thanh ' + url + ':', err);
    }
  }

  // Gọi trong xử lý cử chỉ (pointerdown, và thêm touchend / click — input.js): mở AudioContext và bật nhạc nền.
  // Gọi lặp được. iPhone (Safari) có bản chỉ cho mở âm thanh trong touchend/click và cần phát một buffer câm ngay
  // trong cử chỉ — thiếu thì tiếng nổ bong bóng, quạc, nhạc nền đều câm.
  // Context có thể ĐÃ chạy sẵn (Chrome cho chạy luôn trên localhost / trang hay mở) — khi đó vẫn phải đánh dấu
  // started và bật nhạc nền; bản trước thoát sớm ở đây nên nhạc nền không bao giờ vào (lỗi 2026-10-06).
  unlock() {
    if (!this.ctx) return;
    if (this.ctx.state === 'running') {
      if (!this.started) { this.started = true; this.startMusic(); }
      return;
    }
    try {
      const s = this.ctx.createBufferSource();
      s.buffer = this.ctx.createBuffer(1, 1, this.ctx.sampleRate);
      s.connect(this.ctx.destination);
      s.start(0);
    } catch { /* bỏ qua */ }
    this.ctx.resume().then(() => { this.started = true; this.startMusic(); }).catch(() => {});
  }

  startMusic() {
    if (!this.ctx || this.musicSrc || !this.buffers.bg) return;
    const s = this.ctx.createBufferSource();
    s.buffer = this.buffers.bg;
    s.loop = true;
    s.connect(this.music);
    s.start();
    this.musicSrc = s;
    const t = this.ctx.currentTime;
    this.music.gain.setValueAtTime(0, t);
    this.music.gain.linearRampToValueAtTime(AUDIO.music, t + AUDIO.fadeIn); // vào êm, không giật
  }

  // Phát một tiếng ngắn. minGap: hai lần phát cùng loại cách nhau ít nhất ngần này giây (bấm liên hồi không chồng tiếng).
  play(key, { volume = 1, rate = 1, minGap = 0 } = {}) {
    const buf = this.buffers[key];
    if (!this.ctx || !buf) return false;
    const now = performance.now() / 1000;
    if (minGap && now - (this.lastPlay[key] || -1e9) < minGap) return false;
    this.lastPlay[key] = now;
    const s = this.ctx.createBufferSource();
    s.buffer = buf;
    s.playbackRate.value = rate;
    const g = this.ctx.createGain();
    g.gain.value = volume;
    s.connect(g); g.connect(this.sfx);
    s.start();
    return true;
  }

  pop() { return this.play('pop', { volume: AUDIO.popVolume, rate: 0.9 + Math.random() * 0.25, minGap: 0.05 }); }
  quack() { return this.play('quack', { volume: AUDIO.quackVolume, rate: 0.95 + Math.random() * 0.1, minGap: AUDIO.quackMinGap }); }
  touch() { return this.play('touch', { volume: AUDIO.touchVolume, rate: 0.92 + Math.random() * 0.16, minGap: AUDIO.touchMinGap }); }
}

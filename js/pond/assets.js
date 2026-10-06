// Nạp asset: nền nướng sẵn (images-bg/bg.webp), các SVG hiệu ứng của gói art (lưới sóng trắng, tia sáng,
// bong bóng) rasterize thành texture, độ ép dẹt `squash` từ file AI cũ (images-duck-v2/manifest.json), model 3D
// cho vịt và lá. prepareAssets chạy một lần lúc mở trang.
import * as THREE from 'three';
import { MANIFEST, BG, NET, BUBBLES, SPARKLES, FOLIAGE } from './config.js';
import { loadDuckModel } from './duck3d.js';
import { loadLeafModels } from './leaf3d.js';

/* ------------------------------------------------------------------ helpers */
function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}
const ctx2d = (c) => c.getContext('2d', { willReadFrequently: true });

function loadImageURL(url) {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.decoding = 'async';
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error('Không tải được ' + url));
    im.src = url;
  });
}

// Rasterize một SVG (chỉ có viewBox, như Illustrator xuất) thành canvas rộng `w` px. Ghi thẳng width/height
// vào thẻ <svg> rồi vẽ qua blob URL để trình duyệt dựng vector đúng cỡ này (không phóng từ cỡ mặc định 300×150).
// square: canvas vuông, hình căn giữa (sprite tròn như bong bóng, sao).
async function rasterSvg(url, w, square = false) {
  const txt = await fetch(url).then((r) => {
    if (!r.ok) throw new Error('Không tải được ' + url);
    return r.text();
  });
  const vb = /viewBox="([^"]+)"/.exec(txt);
  const [, , vw, vh] = vb ? vb[1].trim().split(/[\s,]+/).map(Number) : [0, 0, 1, 1];
  const h = Math.max(1, Math.round((w * vh) / vw));
  const svg = txt.replace(/<svg\b([^>]*)>/, (m, a) => `<svg${a.replace(/\s(width|height)="[^"]*"/g, '')} width="${w}" height="${h}">`);
  const blobUrl = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const img = await loadImageURL(blobUrl).catch(() => { throw new Error('Không vẽ được ' + url); });
    const side = Math.max(w, h);
    const c = makeCanvas(square ? side : w, square ? side : h);
    ctx2d(c).drawImage(img, square ? (side - w) / 2 : 0, square ? (side - h) / 2 : 0, w, h);
    return c;
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}

// Biến một canvas (ảnh trắng + alpha) thành ảnh LẶP ĐƯỢC: trộn với chính nó dịch nửa khổ (ảnh dịch liền mạch
// ở mép, ảnh gốc liền mạch ở giữa), hoà bằng mặt nạ mềm rộng `border` px quanh viền. Lưới sóng trắng lấy mẫu
// trên mặt phẳng nước rộng hơn một bản lưới nên phải lặp; lặp soi gương thì lộ đường nối nửa ô.
function makeTileable(c, border) {
  const w = c.width, h = c.height, g = ctx2d(c);
  const src = g.getImageData(0, 0, w, h), out = g.createImageData(w, h), a = src.data, o = out.data;
  const ramp = (v, n) => { const d = Math.min(v, n - 1 - v); return d >= border ? 0 : 1 - (d / border) * (d / border) * (3 - 2 * (d / border)); };
  const mx = new Float32Array(w), my = new Float32Array(h);
  for (let x = 0; x < w; x++) mx[x] = ramp(x, w);
  for (let y = 0; y < h; y++) my[y] = ramp(y, h);
  for (let y = 0; y < h; y++) {
    const ys = ((y + (h >> 1)) % h) * w;
    for (let x = 0; x < w; x++) {
      const m = Math.max(mx[x], my[y]), i = (y * w + x) * 4, j = (ys + ((x + (w >> 1)) % w)) * 4;
      for (let k = 0; k < 4; k++) o[i + k] = a[i + k] * (1 - m) + a[j + k] * m;
    }
  }
  g.putImageData(out, 0, 0);
  return c;
}

// Texture màu từ canvas (sprite): sRGB, nhân sẵn alpha, có mipmap.
export function makeTexture(canvas) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.premultiplyAlpha = true;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

// Texture màu từ ảnh đục (nền): sRGB, mipmap, kéo dài mép khi lấy mẫu ngoài khổ.
export function imageTexture(img) {
  const t = new THREE.Texture(img);
  t.colorSpace = THREE.SRGBColorSpace;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

// Texture dữ liệu (mặt nạ, pháp tuyến): không phải màu — không chuyển không gian màu.
// Mặt nạ CÂY của nền (cho tán lá đung đưa, water.js): nền là một ảnh nướng sẵn không có lớp cây riêng nên tách
// theo màu — cây xanh lá (g > b, bão hoà), trời xanh lam/trắng. Canvas ¼ cỡ phủ đúng BG.rect.
// r = mặt nạ mờ nhẹ (FOLIAGE.blur) = trường dời, mượt nên ảnh uốn liền không rách mép lá;
// g = mờ rất rộng (FOLIAGE.tipBlur) ~ độ dày khối cây;
// b = VÙNG TRỜI (loang từ tâm khoảng trời FOLIAGE.centre qua các điểm không phải cây mà sáng — nước sâu tối không
//     lọt vào) rồi làm mờ FOLIAGE.skyBlur: cây có b cao là lá viền giáp trời (lớp 3 trong water.js). Dải cây mỏng nên
//     không phân biệt rìa/lõi được bằng độ dày khối — phải biết trời ở đâu.
// Nền đen đục: canvas trong suốt thì kênh bị nhân sẵn alpha, đọc sai. flipY mặc định như texture nền → cùng uv.
function foliageMask(img) {
  const W = 640, H = Math.round((W * BG.rect.h) / BG.rect.w), k = W / BG.rect.w, K = FOLIAGE.key;
  const src = makeCanvas(W, H), sg = ctx2d(src);
  sg.drawImage(img, 0, 0, W, H);
  const id = sg.getImageData(0, 0, W, H), d = id.data;
  const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const N = W * H, leaf = new Float32Array(N), open = new Uint8Array(N);
  for (let i = 0, j = 0; i < d.length; i += 4, j++) {
    const r = d[i], g = d[i + 1], b = d[i + 2], mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    leaf[j] = ss(K.lo, K.hi, (g - b) / 255) * ss(K.sLo, K.sHi, mx > 0 ? (mx - mn) / mx : 0);
    open[j] = leaf[j] < 0.5 && (0.299 * r + 0.587 * g + 0.114 * b) / 255 > FOLIAGE.skyLum ? 1 : 0;
    d[i] = d[i + 1] = d[i + 2] = leaf[j] * 255; d[i + 3] = 255;
  }
  sg.putImageData(id, 0, 0);
  // vùng trời: loang 4 hướng từ tâm khoảng trời qua các điểm "mở" (không phải cây, đủ sáng)
  const sky = makeCanvas(W, H), kg = ctx2d(sky), kd = kg.createImageData(W, H);
  const cx = Math.round((FOLIAGE.centre[0] - BG.rect.x) * k), cy = Math.round((FOLIAGE.centre[1] - BG.rect.y) * k);
  const seen = new Uint8Array(N), stack = [cy * W + cx];
  seen[cy * W + cx] = 1;
  while (stack.length) {
    const j = stack.pop(), x = j % W, y = (j / W) | 0;
    kd.data[j * 4] = kd.data[j * 4 + 1] = kd.data[j * 4 + 2] = 255;
    for (const n of [x > 0 ? j - 1 : -1, x < W - 1 ? j + 1 : -1, y > 0 ? j - W : -1, y < H - 1 ? j + W : -1]) {
      if (n >= 0 && !seen[n] && open[n]) { seen[n] = 1; stack.push(n); }
    }
  }
  for (let j = 0; j < N; j++) kd.data[j * 4 + 3] = 255;
  kg.putImageData(kd, 0, 0);
  const blurred = (from, px) => {
    const c = makeCanvas(W, H), g = ctx2d(c);
    g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
    g.filter = `blur(${(px * k).toFixed(2)}px)`;
    g.drawImage(from, 0, 0);
    return g.getImageData(0, 0, W, H).data;
  };
  const a = blurred(src, FOLIAGE.blur), t = blurred(src, FOLIAGE.tipBlur), sb = blurred(sky, FOLIAGE.skyBlur);
  const out = makeCanvas(W, H), og = ctx2d(out), od = og.createImageData(W, H);
  for (let i = 0; i < od.data.length; i += 4) { od.data[i] = a[i]; od.data[i + 1] = t[i]; od.data[i + 2] = sb[i]; od.data[i + 3] = 255; }
  og.putImageData(od, 0, 0);
  return { texture: dataTexture(out), canvas: out };
}

export function dataTexture(canvas) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.NoColorSpace;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

// Texture đã nhân sẵn alpha nên trộn ONE / ONE_MINUS_SRC_ALPHA để mép không bị viền tối.
export function spriteMaterial(map) {
  const m = new THREE.MeshBasicMaterial({ map, transparent: true, depthTest: false, depthWrite: false });
  m.blending = THREE.CustomBlending;
  m.blendSrc = THREE.OneFactor;
  m.blendDst = THREE.OneMinusSrcAlphaFactor;
  m.blendSrcAlpha = THREE.OneFactor;
  m.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
  return m;
}

export function setSpriteColor(m, alpha, r = 1, g = r, b = r) {
  m.opacity = alpha;
  m.color.setRGB(r * alpha, g * alpha, b * alpha);
}

/* ------------------------------------------------------------------ main */
export async function prepareAssets() {
  const warn = (what, fallback = null) => (err) => { console.warn(`[Ao Vịt] Không nạp được ${what}:`, err); return fallback; };
  // Mọi thứ xin cùng lúc. Nền hỏng thì không còn gì để vẽ → để lỗi lan lên main.js. Model, lưới sóng, bong
  // bóng, sao hỏng thì ao vẫn mở, chỉ thiếu món đó — đừng vì một file mà trắng cả trang.
  const bgImgP = loadImageURL(BG.url);
  const bgP = bgImgP.then(imageTexture);
  const foliageP = bgImgP.then(foliageMask).catch(warn('mặt nạ cây'));
  const modelP = loadDuckModel().catch(warn('model vịt'));
  const leavesP = loadLeafModels().catch(warn('model lá', []));
  const netP = !NET.enabled ? Promise.resolve(null) : rasterSvg(NET.url, NET.texW).then((c) => {
    const t = makeTexture(makeTileable(c, Math.round(c.width * 0.12)));
    t.wrapS = t.wrapT = THREE.RepeatWrapping; // lưới lấy mẫu trên mặt phẳng nước rộng hơn một bản nên lặp
    return { texture: t, aspect: c.width / c.height };
  }).catch(warn('lưới sóng trắng'));
  const bubblesP = Promise.all(BUBBLES.urls.map((u) => rasterSvg(u, 256, true).then(makeTexture))).catch(warn('bong bóng', []));
  const sparkP = rasterSvg(SPARKLES.url, 256, true).then(makeTexture).catch(warn('tia sáng'));

  // Từ file AI cũ chỉ còn dùng `squash` — độ ép dẹt của mặt nước. Giọt nước (giot_nuoc) đã bỏ 2026-10-06: bắn lên
  // khi bấm / vịt rũ trông như bong bóng lạ ngoài bubble-1..3.
  const man = await fetch(MANIFEST).then((r) => {
    if (!r.ok) throw new Error('Không đọc được ' + MANIFEST);
    return r.json();
  });
  const [bg, net, bubbles, spark, model, leaves, foliage] = await Promise.all([bgP, netP, bubblesP, sparkP, modelP, leavesP, foliageP]);

  return {
    bg: { texture: bg, rect: BG.rect, foliage },
    net, bubbles, spark,
    leaves,
    duck: { squash: man.duck.squash, model },
  };
}

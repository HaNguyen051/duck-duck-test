// Nạp asset: nền nướng sẵn (images-bg/bg.webp), các SVG hiệu ứng của gói art (lưới sóng trắng, tia sáng,
// bong bóng) rasterize thành texture, giọt nước từ file AI cũ (images-duck-v2/manifest.json), model 3D cho
// vịt và lá. prepareAssets chạy một lần lúc mở trang.
import * as THREE from 'three';
import { IMG_DIR, MANIFEST, BG, NET, BUBBLES, SPARKLES } from './config.js';
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
const loadImage = (name) => loadImageURL(IMG_DIR + name);

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

// Một lớp đã xuất từ file AI. Canvas giữ nguyên độ phân giải gốc của file, còn w/h và mảng alpha quy về px ảnh.
function layerFrom(img, rec) {
  const sc = rec.scale || 1;
  const c = makeCanvas(rec.w * sc, rec.h * sc);
  ctx2d(c).drawImage(img, 0, 0, c.width, c.height);
  const w = Math.max(1, Math.round(rec.w)), h = Math.max(1, Math.round(rec.h));
  let probe = c;
  if (sc !== 1) {
    probe = makeCanvas(w, h);
    ctx2d(probe).drawImage(c, 0, 0, w, h);
  }
  const d = ctx2d(probe).getImageData(0, 0, w, h).data;
  const alpha = new Uint8Array(w * h);
  for (let i = 0; i < alpha.length; i++) alpha[i] = d[i * 4 + 3];
  return { canvas: c, alpha, w, h, x: rec.x, y: rec.y };
}

const textures = new WeakMap();
export function textureFrom(canvas) {
  const hit = textures.get(canvas);
  if (hit) return hit;
  const t = makeTexture(canvas);
  textures.set(canvas, t);
  return t;
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

/* ------------------------------------------------------------------ drops */
// Tách lớp giọt nước thành từng giọt rời (nhãn liên thông 8 hướng).
function splitDrops(canvas, ox, oy) {
  const g = ctx2d(canvas), { width: w, height: h } = canvas;
  const d = g.getImageData(0, 0, w, h).data;
  const seen = new Uint8Array(w * h), out = [], stack = [];
  for (let i = 0; i < w * h; i++) {
    if (seen[i] || d[i * 4 + 3] < 24) continue;
    let x0 = w, y0 = h, x1 = 0, y1 = 0, area = 0;
    stack.push(i); seen[i] = 1;
    while (stack.length) {
      const j = stack.pop(), x = j % w, y = (j / w) | 0;
      area++;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const k = ny * w + nx;
        if (!seen[k] && d[k * 4 + 3] >= 24) { seen[k] = 1; stack.push(k); }
      }
    }
    if (area < 6) continue;
    const p = 2;
    const rx = Math.max(0, x0 - p), ry = Math.max(0, y0 - p);
    const rw = Math.min(w, x1 + p + 1) - rx, rh = Math.min(h, y1 + p + 1) - ry;
    const c = makeCanvas(rw, rh);
    ctx2d(c).drawImage(canvas, rx, ry, rw, rh, 0, 0, rw, rh);
    out.push({ canvas: c, w: rw, h: rh, area, cx: ox + rx + rw / 2, cy: oy + ry + rh / 2 });
  }
  return out;
}

/* ------------------------------------------------------------------ main */
export async function prepareAssets() {
  const warn = (what, fallback = null) => (err) => { console.warn(`[Ao Vịt] Không nạp được ${what}:`, err); return fallback; };
  // Mọi thứ xin cùng lúc. Nền hỏng thì không còn gì để vẽ → để lỗi lan lên main.js. Model, lưới sóng, bong
  // bóng, sao hỏng thì ao vẫn mở, chỉ thiếu món đó — đừng vì một file mà trắng cả trang.
  const bgP = loadImageURL(BG.url).then(imageTexture);
  const modelP = loadDuckModel().catch(warn('model vịt'));
  const leavesP = loadLeafModels().catch(warn('model lá', []));
  const netP = rasterSvg(NET.url, NET.texW).then((c) => {
    const t = makeTexture(makeTileable(c, Math.round(c.width * 0.12)));
    t.wrapS = t.wrapT = THREE.RepeatWrapping; // lưới lấy mẫu trên mặt phẳng nước rộng hơn một bản nên lặp
    return { texture: t, aspect: c.width / c.height };
  }).catch(warn('lưới sóng trắng'));
  const bubblesP = Promise.all(BUBBLES.urls.map((u) => rasterSvg(u, 256, true).then(makeTexture))).catch(warn('bong bóng', []));
  const sparkP = rasterSvg(SPARKLES.url, 256, true).then(makeTexture).catch(warn('tia sáng'));

  // Từ file AI cũ chỉ còn dùng giọt nước (bắn lên khi chạm / vịt rũ) và `squash` — độ ép dẹt của mặt nước.
  const man = await fetch(MANIFEST).then((r) => {
    if (!r.ok) throw new Error('Không đọc được ' + MANIFEST);
    return r.json();
  });
  const dropsLayer = layerFrom(await loadImage(man.drops.file), man.drops);
  const [bg, net, bubbles, spark, model, leaves] = await Promise.all([bgP, netP, bubblesP, sparkP, modelP, leavesP]);

  return {
    bg: { texture: bg, rect: BG.rect },
    net, bubbles, spark,
    drops: splitDrops(dropsLayer.canvas, dropsLayer.x, dropsLayer.y),
    leaves,
    duck: { squash: man.duck.squash, model },
  };
}

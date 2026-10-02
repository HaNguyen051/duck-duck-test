// Tải các lớp PNG và chuẩn bị texture cho ao. prepareAssets chạy một lần lúc mở trang;
// buildWater dựng mặt nước (nối dài ra ngoài khổ ảnh gốc) cho từng khung nhìn.
import * as THREE from 'three';
import { IMG_DIR, SRC, FILES, LEAF_TEMPLATES } from './config.js';

const GRID = 4; // ô lưới thô (px ảnh) dùng để phân tích hình lá và chia nét sóng
const REFRACT_MARGIN = 48; // lề quanh vùng nước để khúc xạ không lấy mẫu ra ngoài
const SEAM_BLEND = 200; // nước nối dài = lặp lại nền nước, hoà mép nối trong ngần này px
const LEAF_PAD = 36; // lề quanh lá mẫu: chỗ cho nét sóng và bóng mờ
const FREE_STROKE_CELLS = 12; // nét sóng xa mọi vật hơn ngần này ô thì giữ nguyên trên nền nước

/* ------------------------------------------------------------------ helpers */
function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}
function ctx2d(c) { return c.getContext('2d', { willReadFrequently: true }); }

export function loadImage(name) {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.decoding = 'async';
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error('Không tải được ' + name));
    im.src = IMG_DIR + name;
  });
}

function fullData(img) {
  const c = makeCanvas(img.naturalWidth, img.naturalHeight);
  const g = ctx2d(c);
  g.drawImage(img, 0, 0);
  return g.getImageData(0, 0, c.width, c.height);
}

function alphaBBox(d, thr = 8) {
  const { width: w, height: h, data } = d;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w * 4 + 3;
    for (let x = 0; x < w; x++) {
      if (data[row + x * 4] > thr) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

// Cắt một lớp theo bbox: trả về canvas + mảng alpha cùng khổ.
function cropLayer(img) {
  const d = fullData(img);
  const rect = alphaBBox(d);
  if (!rect) return null;
  const c = makeCanvas(rect.w, rect.h);
  const sub = new ImageData(rect.w, rect.h);
  const alpha = new Uint8Array(rect.w * rect.h);
  for (let y = 0; y < rect.h; y++) {
    const src = ((rect.y + y) * d.width + rect.x) * 4;
    sub.data.set(d.data.subarray(src, src + rect.w * 4), y * rect.w * 4);
    for (let x = 0; x < rect.w; x++) alpha[y * rect.w + x] = sub.data[(y * rect.w + x) * 4 + 3];
  }
  ctx2d(c).putImageData(sub, 0, 0);
  return { canvas: c, rect, alpha };
}

function shadowCanvas(src, blur, rgb, pad = 0) {
  const c = makeCanvas(src.width + pad * 2, src.height + pad * 2);
  const g = ctx2d(c);
  g.filter = `blur(${blur}px)`;
  g.drawImage(src, pad, pad);
  g.filter = 'none';
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = rgb;
  g.fillRect(0, 0, c.width, c.height);
  return c;
}

// Mỗi canvas chỉ tạo một texture, dùng lại khi cảnh được dựng lại (đổi cỡ cửa sổ).
const textures = new WeakMap();
export function textureFrom(canvas) {
  const cached = textures.get(canvas);
  if (cached) return cached;
  const t = makeTexture(canvas);
  textures.set(canvas, t);
  return t;
}

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

// Texture đã nhân sẵn alpha (premultiplyAlpha) nên trộn ONE / ONE_MINUS_SRC_ALPHA để mép không bị viền tối.
// Độ trong suốt và màu nhuộm đặt qua setSpriteColor.
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

/* ------------------------------------------------------------------ coarse grids */
// Lưới thô (ô = `cell` px) của một lớp: tỉ lệ phủ alpha trong mỗi ô, 0..1.
function coarseCoverage(alpha, w, h, cell) {
  const cols = Math.ceil(w / cell), rows = Math.ceil(h / cell);
  const cov = new Float32Array(cols * rows);
  for (let y = 0; y < h; y++) {
    const cy = (y / cell) | 0;
    for (let x = 0; x < w; x++) {
      if (alpha[y * w + x] > 127) cov[cy * cols + ((x / cell) | 0)] += 1;
    }
  }
  const n = cell * cell;
  for (let i = 0; i < cov.length; i++) cov[i] /= n;
  return { cols, rows, cell, data: cov };
}

// Khoảng cách (theo ô) từ mỗi ô phủ tới ô trống gần nhất — tìm tâm và bán kính mặt lá.
function insideDistance(cov) {
  const { cols, rows, data } = cov;
  const d = new Float32Array(cols * rows);
  const BIG = 1e6;
  for (let i = 0; i < d.length; i++) d[i] = data[i] > 0.5 ? BIG : 0;
  const D1 = 1, D2 = Math.SQRT2;
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const i = y * cols + x;
    if (!d[i]) continue;
    let v = d[i];
    if (x > 0) v = Math.min(v, d[i - 1] + D1); else v = Math.min(v, D1);
    if (y > 0) v = Math.min(v, d[i - cols] + D1); else v = Math.min(v, D1);
    if (x > 0 && y > 0) v = Math.min(v, d[i - cols - 1] + D2);
    if (x < cols - 1 && y > 0) v = Math.min(v, d[i - cols + 1] + D2);
    d[i] = v;
  }
  for (let y = rows - 1; y >= 0; y--) for (let x = cols - 1; x >= 0; x--) {
    const i = y * cols + x;
    if (!d[i]) continue;
    let v = d[i];
    if (x < cols - 1) v = Math.min(v, d[i + 1] + D1); else v = Math.min(v, D1);
    if (y < rows - 1) v = Math.min(v, d[i + cols] + D1); else v = Math.min(v, D1);
    if (x < cols - 1 && y < rows - 1) v = Math.min(v, d[i + cols + 1] + D2);
    if (x > 0 && y < rows - 1) v = Math.min(v, d[i + cols - 1] + D2);
    d[i] = v;
  }
  return d;
}

// Gán mỗi ô của toàn ảnh cho vật gần nhất (BFS nhiều nguồn) để chia nét sóng.
function nearestOwner(owners, cell) {
  const cols = Math.ceil(SRC.w / cell), rows = Math.ceil(SRC.h / cell);
  const owner = new Int16Array(cols * rows).fill(-1);
  const dist = new Uint16Array(cols * rows).fill(65535);
  const queue = new Int32Array(cols * rows);
  let head = 0, tail = 0;
  owners.forEach((layer, k) => {
    const { rect, alpha } = layer;
    for (let y = 0; y < rect.h; y += 2) for (let x = 0; x < rect.w; x += 2) {
      if (alpha[y * rect.w + x] < 128) continue;
      const cx = ((rect.x + x) / cell) | 0, cy = ((rect.y + y) / cell) | 0;
      const i = cy * cols + cx;
      if (dist[i] !== 0) { dist[i] = 0; owner[i] = k; queue[tail++] = i; }
    }
  });
  while (head < tail) {
    const i = queue[head++], x = i % cols, y = (i / cols) | 0, nd = dist[i] + 1;
    if (x > 0 && dist[i - 1] > nd) { dist[i - 1] = nd; owner[i - 1] = owner[i]; queue[tail++] = i - 1; }
    if (x < cols - 1 && dist[i + 1] > nd) { dist[i + 1] = nd; owner[i + 1] = owner[i]; queue[tail++] = i + 1; }
    if (y > 0 && dist[i - cols] > nd) { dist[i - cols] = nd; owner[i - cols] = owner[i]; queue[tail++] = i - cols; }
    if (y < rows - 1 && dist[i + cols] > nd) { dist[i + cols] = nd; owner[i + cols] = owner[i]; queue[tail++] = i + cols; }
  }
  return { cols, owner, dist };
}

/* ------------------------------------------------------------------ water inpaint */
// Nền nước còn vệt tròn mờ chỗ lá và vịt gốc từng nằm (ảnh tách lớp tự điền chưa khéo). Ao tràn màn hình
// và phần nước soi gương sẽ làm lộ các vệt này, nên tô lấp hẳn: vùng dưới lá/vịt (nới rộng, mép mềm) được
// nội suy mượt từ nước xung quanh bằng thuật toán pull-push (kim tự tháp ảnh có trọng số).
function inpaintWater(water, holes) {
  const W = water.width, H = water.height, n = W * H;
  const mc = makeCanvas(W, H), mg = ctx2d(mc);
  mg.filter = 'blur(12px)';
  for (const h of holes) for (let k = 0; k < 2; k++) mg.drawImage(h.canvas, h.rect.x, h.rect.y);
  const ma = mg.getImageData(0, 0, W, H).data;
  const g = ctx2d(water), img = g.getImageData(0, 0, W, H), px = img.data;
  // tầng 0: trọng số 1 = nước giữ nguyên, 0 = cần tô
  let lv = { W, H, w: new Float32Array(n), c: new Float32Array(n * 3) };
  for (let i = 0; i < n; i++) {
    lv.w[i] = 1 - Math.min(1, (ma[i * 4 + 3] / 255) * 2.6);
    lv.c[i * 3] = px[i * 4]; lv.c[i * 3 + 1] = px[i * 4 + 1]; lv.c[i * 3 + 2] = px[i * 4 + 2];
  }
  const levels = [lv];
  // pull: thu nhỏ dần, mỗi ô = trung bình có trọng số của 2×2 ô con
  while (lv.W > 1 || lv.H > 1) {
    const W2 = Math.ceil(lv.W / 2), H2 = Math.ceil(lv.H / 2);
    const up = { W: W2, H: H2, w: new Float32Array(W2 * H2), c: new Float32Array(W2 * H2 * 3) };
    for (let y = 0; y < H2; y++) for (let x = 0; x < W2; x++) {
      let ws = 0, r = 0, gg = 0, b = 0;
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
        const sx = x * 2 + dx, sy = y * 2 + dy;
        if (sx >= lv.W || sy >= lv.H) continue;
        const i = sy * lv.W + sx, wv = lv.w[i];
        ws += wv; r += lv.c[i * 3] * wv; gg += lv.c[i * 3 + 1] * wv; b += lv.c[i * 3 + 2] * wv;
      }
      const j = y * W2 + x;
      up.w[j] = Math.min(1, ws);
      if (ws > 0) { up.c[j * 3] = r / ws; up.c[j * 3 + 1] = gg / ws; up.c[j * 3 + 2] = b / ws; }
    }
    levels.push(up);
    lv = up;
  }
  // push: từ tầng thô xuống tầng mịn, chỗ thiếu lấy từ tầng trên (nội suy song tuyến)
  for (let k = levels.length - 2; k >= 0; k--) {
    const L = levels[k], U = levels[k + 1];
    for (let y = 0; y < L.H; y++) {
      const fy = Math.min(U.H - 1, Math.max(0, (y + 0.5) / 2 - 0.5)), y0 = fy | 0, y1 = Math.min(U.H - 1, y0 + 1), ty = fy - y0;
      for (let x = 0; x < L.W; x++) {
        const i = y * L.W + x, wv = L.w[i];
        if (wv >= 1) continue;
        const fx = Math.min(U.W - 1, Math.max(0, (x + 0.5) / 2 - 0.5)), x0 = fx | 0, x1 = Math.min(U.W - 1, x0 + 1), tx = fx - x0;
        for (let ch = 0; ch < 3; ch++) {
          const a = U.c[(y0 * U.W + x0) * 3 + ch], bb = U.c[(y0 * U.W + x1) * 3 + ch];
          const c = U.c[(y1 * U.W + x0) * 3 + ch], d = U.c[(y1 * U.W + x1) * 3 + ch];
          const upv = (a * (1 - tx) + bb * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
          L.c[i * 3 + ch] = L.c[i * 3 + ch] * wv + upv * (1 - wv);
        }
      }
    }
  }
  const out = levels[0].c;
  for (let i = 0; i < n; i++) { px[i * 4] = out[i * 3]; px[i * 4 + 1] = out[i * 3 + 1]; px[i * 4 + 2] = out[i * 3 + 2]; }
  g.putImageData(img, 0, 0);
}

/* ------------------------------------------------------------------ feet pivot */
// Khớp chân = đầu hẹp hơn của chân theo trục chính (cẳng hẹp, màng chân rộng).
function footPivot(layer) {
  const { rect, alpha } = layer;
  let n = 0, mx = 0, my = 0;
  for (let y = 0; y < rect.h; y++) for (let x = 0; x < rect.w; x++) if (alpha[y * rect.w + x] > 100) { n++; mx += x; my += y; }
  mx /= n; my /= n;
  let sxx = 0, syy = 0, sxy = 0;
  for (let y = 0; y < rect.h; y++) for (let x = 0; x < rect.w; x++) if (alpha[y * rect.w + x] > 100) {
    const dx = x - mx, dy = y - my; sxx += dx * dx; syy += dy * dy; sxy += dx * dy;
  }
  const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy), ax = Math.cos(ang), ay = Math.sin(ang);
  const pts = [];
  for (let y = 0; y < rect.h; y++) for (let x = 0; x < rect.w; x++) if (alpha[y * rect.w + x] > 100) {
    const dx = x - mx, dy = y - my; pts.push([dx * ax + dy * ay, -dx * ay + dy * ax, x, y]);
  }
  pts.sort((a, b) => a[0] - b[0]);
  const k = Math.max(3, Math.floor(pts.length * 0.12));
  const end = (arr) => {
    let lo = Infinity, hi = -Infinity, px = 0, py = 0;
    for (const p of arr) { lo = Math.min(lo, p[1]); hi = Math.max(hi, p[1]); px += p[2]; py += p[3]; }
    return { width: hi - lo, x: px / arr.length, y: py / arr.length };
  };
  const a = end(pts.slice(0, k)), b = end(pts.slice(-k));
  const j = a.width < b.width ? a : b;
  return { x: rect.x + j.x, y: rect.y + j.y };
}

/* ------------------------------------------------------------------ drops */
function splitDrops(d) {
  const { width: w, height: h, data } = d;
  const seen = new Uint8Array(w * h);
  const out = [];
  const stack = [];
  for (let i = 0; i < w * h; i++) {
    if (seen[i] || data[i * 4 + 3] < 24) continue;
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
        if (!seen[k] && data[k * 4 + 3] >= 24) { seen[k] = 1; stack.push(k); }
      }
    }
    if (area < 4) continue;
    const pad = 2, rect = { x: Math.max(0, x0 - pad), y: Math.max(0, y0 - pad) };
    rect.w = Math.min(w, x1 + pad + 1) - rect.x; rect.h = Math.min(h, y1 + pad + 1) - rect.y;
    const c = makeCanvas(rect.w, rect.h), sub = new ImageData(rect.w, rect.h);
    for (let y = 0; y < rect.h; y++) {
      const s = ((rect.y + y) * w + rect.x) * 4;
      sub.data.set(data.subarray(s, s + rect.w * 4), y * rect.w * 4);
    }
    ctx2d(c).putImageData(sub, 0, 0);
    out.push({ canvas: c, rect, area, cx: rect.x + rect.w / 2, cy: rect.y + rect.h / 2 });
  }
  return out;
}

/* ------------------------------------------------------------------ main */
export async function prepareAssets() {
  const names = new Set([FILES.water, FILES.strokes, FILES.drops, ...FILES.leaves, ...LEAF_TEMPLATES]);
  FILES.ducks.forEach((d) => { names.add(d.body); d.feet.forEach((f) => names.add(f.img)); });
  const list = [...names];
  const imgs = await Promise.all(list.map(loadImage));
  const byName = Object.fromEntries(list.map((n, i) => [n, imgs[i]]));

  // vịt
  const ducks = FILES.ducks.map((spec) => {
    const body = cropLayer(byName[spec.body]);
    const feet = spec.feet.map((f) => {
      const layer = cropLayer(byName[f.img]);
      return { ...layer, kind: f.kind, pivot: footPivot(layer) };
    });
    const r = body.rect;
    return {
      body,
      feet,
      center: { x: r.x + r.w / 2, y: r.y + r.h / 2 },
      radii: { x: r.w * 0.46, y: r.h * 0.44 },
      shadow: shadowCanvas(body.canvas, 8, 'rgb(10,42,88)', 20),
      shadowPad: 20,
    };
  });

  // lá gốc (chỉ để vá nền và chia nét sóng)
  const leaves = FILES.leaves.map((n) => ({ name: n, ...cropLayer(byName[n]) }));

  // nền nước sạch toàn khổ ảnh (chưa có nét sóng) — nguồn để nối dài mặt nước
  const water = makeCanvas(SRC.w, SRC.h);
  ctx2d(water).drawImage(byName[FILES.water], 0, 0);
  inpaintWater(water, [...leaves, ...ducks.flatMap((d) => [d.body, ...d.feet])]);

  // lá mẫu
  const templates = LEAF_TEMPLATES.map((n) => {
    const layer = leaves.find((l) => l.name === n) || cropLayer(byName[n]);
    const B = layer.rect;
    const frame = { x: B.x - LEAF_PAD, y: B.y - LEAF_PAD, w: B.w + LEAF_PAD * 2, h: B.h + LEAF_PAD * 2 };
    const full = makeCanvas(frame.w, frame.h);
    ctx2d(full).drawImage(layer.canvas, LEAF_PAD, LEAF_PAD);
    const alpha = new Uint8Array(frame.w * frame.h);
    for (let y = 0; y < B.h; y++) alpha.set(layer.alpha.subarray(y * B.w, (y + 1) * B.w), (y + LEAF_PAD) * frame.w + LEAF_PAD);
    const coarse = coarseCoverage(alpha, frame.w, frame.h, GRID);
    const dist = insideDistance(coarse);
    let best = 0, bi = 0;
    for (let i = 0; i < dist.length; i++) if (dist[i] > best) { best = dist[i]; bi = i; }
    const pad = { x: ((bi % coarse.cols) + 0.5) * GRID, y: (((bi / coarse.cols) | 0) + 0.5) * GRID };

    // Tách cuống khỏi mặt lá: mặt lá là vùng dày (co lại 2,5 ô rồi nới 3,5 ô), cuống mảnh nên bị loại.
    // Cuống nằm dưới nước nên vẽ riêng, chìm và ngả màu nước.
    const { cols, rows } = coarse;
    const padMask = new Float32Array(cols * rows);
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      let on = 0;
      for (let dy = -4; dy <= 4 && !on; dy++) for (let dx = -4; dx <= 4; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= cols || yy >= rows || dx * dx + dy * dy > 12.25) continue;
        if (dist[yy * cols + xx] >= 2.5) { on = 1; break; }
      }
      padMask[y * cols + x] = on;
    }
    const maskAt = (px, py) => {
      const fx = Math.min(cols - 1.001, Math.max(0, px / GRID - 0.5)), fy = Math.min(rows - 1.001, Math.max(0, py / GRID - 0.5));
      const x0 = fx | 0, y0 = fy | 0, tx = fx - x0, ty = fy - y0, i = y0 * cols + x0;
      const x1 = Math.min(cols - 1, x0 + 1) - x0, y1 = (Math.min(rows - 1, y0 + 1) - y0) * cols;
      return (padMask[i] * (1 - tx) + padMask[i + x1] * tx) * (1 - ty) + (padMask[i + y1] * (1 - tx) + padMask[i + y1 + x1] * tx) * ty;
    };
    const src = ctx2d(full).getImageData(0, 0, frame.w, frame.h);
    const padImg = new ImageData(frame.w, frame.h), stemImg = new ImageData(frame.w, frame.h);
    for (let y = 0; y < frame.h; y++) for (let x = 0; x < frame.w; x++) {
      const p = (y * frame.w + x) * 4, a = src.data[p + 3];
      if (!a) continue;
      const w = maskAt(x + 0.5, y + 0.5);
      padImg.data.set(src.data.subarray(p, p + 3), p); padImg.data[p + 3] = a * w;
      stemImg.data.set(src.data.subarray(p, p + 3), p); stemImg.data[p + 3] = a * (1 - w);
    }
    const canvas = makeCanvas(frame.w, frame.h), stem = makeCanvas(frame.w, frame.h);
    ctx2d(canvas).putImageData(padImg, 0, 0);
    ctx2d(stem).putImageData(stemImg, 0, 0);
    const padCoarse = { ...coarse, data: coarse.data.map((v, i) => v * padMask[i]) };

    let bound = 0;
    for (let i = 0; i < coarse.data.length; i++) if (coarse.data[i] > 0.05) {
      const dx = ((i % coarse.cols) + 0.5) * GRID - pad.x, dy = (((i / coarse.cols) | 0) + 0.5) * GRID - pad.y;
      bound = Math.max(bound, Math.hypot(dx, dy));
    }
    return {
      name: n,
      origin: { x: frame.x, y: frame.y }, // vị trí khung trong ảnh gốc (để lấy nét sóng)
      w: frame.w,
      h: frame.h,
      canvas,
      stem,
      ring: makeCanvas(frame.w, frame.h),
      shadow: shadowCanvas(canvas, 9, 'rgb(8,38,82)'),
      alpha,
      coarse: padCoarse,
      pad,
      padR: best * GRID * 1.1,
      boundR: bound + GRID + LEAF_PAD * 0.5,
    };
  });

  // chia nét sóng: gần vịt hoặc xa mọi vật → vẽ lên nền nước; gần lá mẫu gốc → đi theo lá; gần lá khác → bỏ
  const strokes = makeCanvas(SRC.w, SRC.h);
  {
    const owners = [...ducks.map((d) => d.body), ...leaves];
    const nearest = nearestOwner(owners, GRID);
    const sd = fullData(byName[FILES.strokes]);
    const waterStrokes = new ImageData(sd.width, sd.height);
    const ringData = templates.map((t) => ({ t, img: new ImageData(t.w, t.h), leafIndex: leaves.findIndex((l) => l.name === t.name) }));
    const W = sd.width;
    for (let y = 0; y < sd.height; y++) for (let x = 0; x < W; x++) {
      const p = (y * W + x) * 4;
      if (sd.data[p + 3] === 0) continue;
      const ci = ((y / GRID) | 0) * nearest.cols + ((x / GRID) | 0);
      const o = nearest.owner[ci], dist = nearest.dist[ci];
      const isDuck = o >= 0 && o < ducks.length;
      if (o < 0 || dist > FREE_STROKE_CELLS || isDuck) {
        waterStrokes.data.set(sd.data.subarray(p, p + 4), p);
        continue;
      }
      const li = o - ducks.length;
      for (const r of ringData) {
        if (r.leafIndex !== li) continue;
        const tx = x - r.t.origin.x, ty = y - r.t.origin.y;
        if (tx >= 0 && ty >= 0 && tx < r.t.w && ty < r.t.h) r.img.data.set(sd.data.subarray(p, p + 4), (ty * r.t.w + tx) * 4);
      }
    }
    ctx2d(strokes).putImageData(waterStrokes, 0, 0);
    ringData.forEach((r) => ctx2d(r.t.ring).putImageData(r.img, 0, 0));
  }

  // giọt nước
  const drops = splitDrops(fullData(byName[FILES.drops]));
  const splash = [...drops].sort((a, b) => b.area - a.area).slice(0, 10).map((d) => d.canvas);

  return { water, strokes, ducks, templates, drops, splash };
}

/* ------------------------------------------------------------------ water for a view */
// Dựng texture mặt nước cho vùng `world` (toạ độ ảnh, có thể vượt khổ ảnh gốc).
// Chiều ngang: lặp lại nền nước theo chu kỳ W − SEAM_BLEND; mỗi bản lặp hoà vào bản bên trái trong
// SEAM_BLEND px ở mép trái của nó (kể cả hai mép của ảnh gốc), nên không có đường nối. Bản lặp lẻ
// được lật ngang, mọi bản lặp dịch dọc TILE_SHIFT·k px, nên cùng một mảng mây không hiện hai lần
// và không có hình đối xứng qua chỗ nối.
// Chiều dọc: soi gương ở mép trên/dưới để dải màu sáng–tối theo chiều cao không bị đảo.
// Nét sóng chỉ vẽ trong khổ ảnh gốc.
const TILE_SHIFT = 110;
export function buildWater(assets, world) {
  const W = SRC.w, H = SRC.h, B = SEAM_BLEND, P = W - B;
  const R = {
    x: Math.floor(world.x - REFRACT_MARGIN),
    y: Math.floor(world.y - REFRACT_MARGIN),
    w: Math.ceil(world.w + REFRACT_MARGIN * 2),
    h: Math.ceil(world.h + REFRACT_MARGIN * 2),
  };
  const src = assets.water;
  // bản nền nước (thường / lật ngang) có mép trái mờ dần trong B px
  const ramp = (flip) => {
    const r = makeCanvas(W, H), rg = ctx2d(r);
    if (flip) rg.setTransform(-1, 0, 0, 1, W, 0);
    rg.drawImage(src, 0, 0);
    rg.setTransform(1, 0, 0, 1, 0, 0);
    const gr = rg.createLinearGradient(0, 0, B, 0);
    gr.addColorStop(0, 'rgba(0,0,0,0)');
    gr.addColorStop(1, 'rgba(0,0,0,1)');
    // destination-in xoá mọi điểm ngoài hình được tô, nên tô cả khổ (sau B px gradient giữ alpha = 1)
    rg.globalCompositeOperation = 'destination-in';
    rg.fillStyle = gr;
    rg.fillRect(0, 0, W, H);
    return r;
  };
  assets.waterRamp ||= [ramp(false), ramp(true)];
  // 1) dải ngang: đủ bề rộng R, cao bằng ảnh gốc. Lót trước một lớp lặp thẳng để chỗ hở do dịch dọc không bị trống.
  const strip = makeCanvas(R.w, H), g = ctx2d(strip);
  const k0 = Math.floor(R.x / P) - 1, k1 = Math.ceil((R.x + R.w) / P);
  for (let k = k0; k <= k1; k++) g.drawImage(src, k * P - R.x, 0);
  for (let k = k0; k <= k1; k++) g.drawImage(assets.waterRamp[Math.abs(k) % 2], k * P - R.x, k * TILE_SHIFT);
  g.drawImage(assets.strokes, -R.x, 0);

  // 2) cắt theo R; trên/dưới khổ ảnh thì soi gương dải ngang theo chiều dọc
  const canvas = makeCanvas(R.w, R.h), c = ctx2d(canvas);
  c.drawImage(strip, 0, -R.y);
  const vert = (clipY, clipH, f) => {
    if (clipH <= 0) return;
    c.save();
    c.beginPath(); c.rect(0, clipY, R.w, clipH); c.clip();
    c.setTransform(1, 0, 0, -1, 0, f); c.drawImage(strip, 0, 0);
    c.restore();
  };
  vert(0, -R.y, -R.y); // phía trên: y → −y
  vert(H - R.y, R.y + R.h - H, 2 * H - R.y); // phía dưới: y → 2H − y
  return { canvas, region: R };
}

// Nạp asset đã xuất từ duck-1.ai (images-duck-v2/manifest.json) và chuẩn bị texture.
// prepareAssets chạy một lần lúc mở trang; buildWater dựng mặt nước nối dài cho từng khung nhìn.
import * as THREE from 'three';
import { IMG_DIR, MANIFEST, LEAVES } from './config.js';

const GRID = 6;            // ô lưới thô (px ảnh) để phân tích mặt lá
const REFRACT_MARGIN = 56; // lề quanh vùng nước để khúc xạ không lấy mẫu ra ngoài
const SEAM_BLEND = 220;    // nước nối dài: hoà mép nối trong ngần này px ảnh
const TILE_SHIFT = 130;    // mỗi bản lặp dịch dọc ngần này px ảnh
const STROKE_ALPHA = 0.42; // độ đậm của lớp nét sóng vẽ sẵn (0 = bỏ hẳn)

/* ------------------------------------------------------------------ helpers */
function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}
const ctx2d = (c) => c.getContext('2d', { willReadFrequently: true });

function loadImage(name) {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.decoding = 'async';
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error('Không tải được ' + name));
    im.src = IMG_DIR + name;
  });
}

// Một lớp đã xuất. Canvas giữ nguyên độ phân giải gốc của file (lá xuất ở 2× nên nét hơn khi phóng to),
// còn w/h và mảng alpha quy về px ảnh để mọi phép thử va chạm dùng chung một hệ toạ độ.
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

// Texture pháp tuyến: dữ liệu hình học, không phải màu — không chuyển không gian màu.
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

/* ------------------------------------------------------------------ leaf shape */
// Lưới thô: tỉ lệ phủ alpha trong mỗi ô, 0..1.
function coarseCoverage(alpha, w, h, cell) {
  const cols = Math.ceil(w / cell), rows = Math.ceil(h / cell);
  const cov = new Float32Array(cols * rows);
  for (let y = 0; y < h; y++) {
    const cy = (y / cell) | 0;
    for (let x = 0; x < w; x++) if (alpha[y * w + x] > 127) cov[cy * cols + ((x / cell) | 0)] += 1;
  }
  const n = cell * cell;
  for (let i = 0; i < cov.length; i++) cov[i] /= n;
  return { cols, rows, cell, data: cov };
}

// Khoảng cách (theo ô) từ mỗi điểm phủ tới điểm trống gần nhất — chamfer hai lượt.
function distanceInside(mask, cols, rows) {
  const d = new Float32Array(cols * rows);
  const BIG = 1e6, D1 = 1, D2 = Math.SQRT2;
  for (let i = 0; i < d.length; i++) d[i] = mask[i] ? BIG : 0;
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const i = y * cols + x;
    if (!d[i]) continue;
    let v = d[i];
    v = Math.min(v, x > 0 ? d[i - 1] + D1 : D1);
    v = Math.min(v, y > 0 ? d[i - cols] + D1 : D1);
    if (x > 0 && y > 0) v = Math.min(v, d[i - cols - 1] + D2);
    if (x < cols - 1 && y > 0) v = Math.min(v, d[i - cols + 1] + D2);
    d[i] = v;
  }
  for (let y = rows - 1; y >= 0; y--) for (let x = cols - 1; x >= 0; x--) {
    const i = y * cols + x;
    if (!d[i]) continue;
    let v = d[i];
    v = Math.min(v, x < cols - 1 ? d[i + 1] + D1 : D1);
    v = Math.min(v, y < rows - 1 ? d[i + cols] + D1 : D1);
    if (x < cols - 1 && y < rows - 1) v = Math.min(v, d[i + cols + 1] + D2);
    if (x > 0 && y < rows - 1) v = Math.min(v, d[i + cols - 1] + D2);
    d[i] = v;
  }
  return d;
}

// Layer "cuong la N" trong file AI chứa CẢ gân lá lẫn cuống, và nằm TRÊN lá chứ không phải sau.
// Tách theo hình lá: nét nằm trong lòng lá là gân (vẽ đè lên lá, giữ nguyên màu),
// nét thò ra ngoài là cuống (chìm dưới nước, vẽ sau lá và ngả màu nước).
function splitStem(leaf, stem) {
  const W = stem.canvas.width, H = stem.canvas.height;
  const sc = W / stem.w; // lá xuất ở 2× nên canvas lớn gấp đôi đơn vị px ảnh
  const src = ctx2d(stem.canvas).getImageData(0, 0, W, H);
  const vein = new ImageData(W, H), stalk = new ImageData(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    if (!src.data[i + 3]) continue;
    const lx = Math.floor(stem.x + x / sc - leaf.x), ly = Math.floor(stem.y + y / sc - leaf.y);
    const inLeaf = lx >= 0 && ly >= 0 && lx < leaf.w && ly < leaf.h && leaf.alpha[ly * leaf.w + lx] > 128;
    const dst = inLeaf ? vein : stalk;
    dst.data[i] = src.data[i]; dst.data[i + 1] = src.data[i + 1];
    dst.data[i + 2] = src.data[i + 2]; dst.data[i + 3] = src.data[i + 3];
  }
  const mk = (img) => {
    const c = makeCanvas(W, H);
    ctx2d(c).putImageData(img, 0, 0);
    return { canvas: c, x: stem.x, y: stem.y, w: stem.w, h: stem.h };
  };
  return { vein: mk(vein), stalk: mk(stalk) };
}

function prepareLeaf(layer) {
  const { alpha, w, h } = layer;
  const coarse = coarseCoverage(alpha, w, h, GRID);
  const solid = new Uint8Array(coarse.cols * coarse.rows);
  for (let i = 0; i < solid.length; i++) solid[i] = coarse.data[i] > 0.5 ? 1 : 0;
  const dist = distanceInside(solid, coarse.cols, coarse.rows);
  let best = 0, bi = 0;
  for (let i = 0; i < dist.length; i++) if (dist[i] < 1e5 && dist[i] > best) { best = dist[i]; bi = i; }
  // tâm lá tính theo ô lưới thô, quy về px ảnh trong khung ảnh của lá
  const pad = { x: ((bi % coarse.cols) + 0.5) * GRID, y: (((bi / coarse.cols) | 0) + 0.5) * GRID };
  let bound = 0;
  for (let i = 0; i < coarse.data.length; i++) if (coarse.data[i] > 0.05) {
    const dx = ((i % coarse.cols) + 0.5) * GRID - pad.x, dy = (((i / coarse.cols) | 0) + 0.5) * GRID - pad.y;
    bound = Math.max(bound, Math.hypot(dx, dy));
  }
  return {
    ...layer,
    coarse, pad,
    padR: best * GRID * 1.05,
    boundR: bound + GRID,
  };
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
  const man = await fetch(MANIFEST).then((r) => {
    if (!r.ok) throw new Error('Không đọc được ' + MANIFEST);
    return r.json();
  });

  // Khung ảnh vịt KHÔNG còn được nạp: con vịt giờ dựng bằng khối 3D (duck3d.js). Chỉ còn lấy
  // `squash` trong manifest — độ ép dẹt của mặt nước, đo được từ chính các khung đó.
  const files = [man.water, man.strokes, man.drops];
  man.leaves.forEach((e) => { if (e.leaf) files.push(e.leaf); if (e.stem) files.push(e.stem); });
  const imgs = await Promise.all(files.map((f) => loadImage(f.file)));
  const byFile = new Map(files.map((f, i) => [f.file, imgs[i]]));
  const L = (rec) => layerFrom(byFile.get(rec.file), rec);

  const water = L(man.water);
  const strokes = L(man.strokes);
  const dropsLayer = L(man.drops);

  const leaves = man.leaves.filter((e) => e.leaf).map((e) => {
    const leaf = prepareLeaf(L(e.leaf));
    return { leaf, ...(e.stem ? splitStem(leaf, L(e.stem)) : { vein: null, stalk: null }) };
  });

  return {
    water, strokes,
    drops: splitDrops(dropsLayer.canvas, dropsLayer.x, dropsLayer.y),
    leaves,
    duck: { squash: man.duck.squash },
    interactive: { path: new Path2D(man.interactive.d), bounds: man.interactive.bounds },
  };
}

/* ------------------------------------------------------------------ water for a view */
// Dựng texture mặt nước cho vùng `world` (toạ độ ảnh, có thể vượt khổ artboard).
// Chiều ngang: lặp lại nền nước theo chu kỳ W − SEAM_BLEND, mỗi bản hoà vào bản bên trái trong
// SEAM_BLEND px ở mép trái của nó nên không có đường nối; bản lẻ lật ngang và mọi bản dịch dọc
// TILE_SHIFT·k px để cùng một mảng vân nước không hiện hai lần cạnh nhau.
// Chiều dọc: soi gương ở mép trên/dưới để dải màu sáng–tối theo chiều cao không bị đảo.
// Nét sóng (vien nuoc) chỉ vẽ đúng một lần ở vị trí gốc của nó.
export function buildWater(assets, world) {
  const src = assets.water.canvas;
  const W = src.width, H = src.height, B = SEAM_BLEND, P = W - B;
  const OX = assets.water.x, OY = assets.water.y; // góc trên trái của nền nước, toạ độ ảnh
  const R = {
    x: Math.floor(world.x - REFRACT_MARGIN),
    y: Math.floor(world.y - REFRACT_MARGIN),
    w: Math.ceil(world.w + REFRACT_MARGIN * 2),
    h: Math.ceil(world.h + REFRACT_MARGIN * 2),
  };
  // bản nền nước (thường / lật ngang) có mép trái mờ dần trong B px
  const ramp = (flip) => {
    const r = makeCanvas(W, H), g = ctx2d(r);
    if (flip) g.setTransform(-1, 0, 0, 1, W, 0);
    g.drawImage(src, 0, 0);
    g.setTransform(1, 0, 0, 1, 0, 0);
    const gr = g.createLinearGradient(0, 0, B, 0);
    gr.addColorStop(0, 'rgba(0,0,0,0)');
    gr.addColorStop(1, 'rgba(0,0,0,1)');
    g.globalCompositeOperation = 'destination-in';
    g.fillStyle = gr;
    g.fillRect(0, 0, W, H);
    return r;
  };
  assets.waterRamp ||= [ramp(false), ramp(true)];

  // 1) dải ngang: đủ bề rộng R, cao bằng ảnh nền. Lót một lớp lặp thẳng trước để chỗ hở do dịch dọc không trống.
  const strip = makeCanvas(R.w, H), g = ctx2d(strip);
  const sx = R.x - OX; // toạ độ của mép trái vùng cắt trong hệ pixel của nền nước
  const k0 = Math.floor(sx / P) - 1, k1 = Math.ceil((sx + R.w) / P);
  for (let k = k0; k <= k1; k++) g.drawImage(src, k * P - sx, 0);
  for (let k = k0; k <= k1; k++) g.drawImage(assets.waterRamp[Math.abs(k) % 2], k * P - sx, k * TILE_SHIFT);
  // Nét sóng (vien nuoc) vẽ đúng vị trí gốc, không lặp. Trong tranh gốc chúng là vệt nước quanh
  // chỗ vịt và lá ĐỨNG YÊN; giờ vịt bơi và lá trôi nên để nhạt đi, chỉ còn là vân mặt nước.
  g.globalAlpha = STROKE_ALPHA;
  g.drawImage(assets.strokes.canvas, assets.strokes.x - R.x, assets.strokes.y - OY);
  g.globalAlpha = 1;

  // 2) cắt theo R; ngoài khổ ảnh nền thì soi gương dải ngang theo chiều dọc
  const canvas = makeCanvas(R.w, R.h), c = ctx2d(canvas);
  const top = OY - R.y; // vị trí mép trên của nền nước trong canvas kết quả
  c.drawImage(strip, 0, top);
  const mirror = (clipY, clipH, f) => {
    if (clipH <= 0) return;
    c.save();
    c.beginPath(); c.rect(0, clipY, R.w, clipH); c.clip();
    c.setTransform(1, 0, 0, -1, 0, f); c.drawImage(strip, 0, 0);
    c.restore();
  };
  mirror(0, top, top);                                   // phía trên: y → 2·top − y
  mirror(top + H, R.h - top - H, 2 * (top + H));          // phía dưới
  return { canvas, region: R };
}

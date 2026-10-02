// Mọi hằng số của ao vịt. Toạ độ "ảnh" là pixel của ảnh gốc 1080×1620, trục y hướng xuống.
// Ngoài khổ ảnh gốc, mặt nước được nối thêm (assets.js → buildWater) nên toạ độ có thể âm hoặc > 1080.

export const IMG_DIR = 'images-duck/';

export const SRC = { w: 1080, h: 1620 };

// Bố cục ao tràn màn hình. Hai con vịt là mốc: khối vịt trong ảnh gốc x 61–873, y 530–984, tâm x 467.
// css/style.css (.pond-static) dùng đúng các số này để ảnh tĩnh khớp với cảnh 3D.
export const LAYOUT = {
  ducks: { cx: 467, top: 530, bottom: 984, cy: 757 },
  // màn ngang: khối vịt cao 58% màn hình, đỉnh vịt ở 32% (chừa chỗ cho khung tìm kiếm phía trên)
  landscape: { ducksShare: 0.58, ducksTopAt: 0.32, minWidth: 900, minScale: 0.6, maxScale: 1.5 },
  // màn dọc (điện thoại): bề ngang = 1000 px ảnh (hai con vịt rộng 812 px, chừa lề khỏi viền mờ), tâm vịt ở 58% chiều cao
  portrait: { width: 1000, ducksCentreAt: 0.58 },
  worldMargin: 48, // lề quanh khung nhìn cho thị sai camera
};

// Khung nhìn (toạ độ ảnh) cho một màn hình rộng cw × ch px CSS. s = số px CSS trên mỗi px ảnh.
export function computeView(cw, ch) {
  const L = LAYOUT, d = L.ducks;
  if (ch >= cw) {
    const s = cw / L.portrait.width;
    return { s, portrait: true, x: d.cx - cw / 2 / s, y: d.cy - (L.portrait.ducksCentreAt * ch) / s, w: cw / s, h: ch / s };
  }
  const p = L.landscape;
  const s = Math.min(p.maxScale, Math.max(p.minScale, Math.min((p.ducksShare * ch) / (d.bottom - d.top), cw / p.minWidth)));
  return { s, portrait: false, x: d.cx - cw / 2 / s, y: d.top - (p.ducksTopAt * ch) / s, w: cw / s, h: ch / s };
}

export const FILES = {
  water: '00_nuoc_sach.png',
  strokes: '01_song_nuoc.png',
  leaves: [1, 2, 3, 4, 5, 6, 7].map((n) => `02_la_sen_${n}.png`),
  ducks: [
    { body: '03_vit_1.png', feet: [{ img: '04_chan_vit_1_trong.png', kind: 'in' }, { img: '04_chan_vit_1_ngoai.png', kind: 'out' }] },
    { body: '03_vit_2.png', feet: [{ img: '04_chan_vit_2_trong.png', kind: 'in' }, { img: '04_chan_vit_2_ngoai.png', kind: 'out' }] },
  ],
  drops: '05_giot_nuoc.png',
};

// Lá dùng làm mẫu để nhân bản. Thêm PNG lá nguyên vẹn (cùng khổ 1080×1620) vào đây là code dùng thêm.
export const LEAF_TEMPLATES = ['02_la_sen_2.png'];

// Lá sen trôi. dir = 1: trái → phải, dir = -1: phải → trái.
export const FLOW = { dir: 1, speed: 14, jitter: 3, meander: 4 };

export const LEAVES = {
  areaPerLeaf: 140000, // số lá = diện tích khung nhìn (px ảnh²) / con số này
  minCount: 5,
  maxCount: 14,
  scaleMin: 0.38,
  scaleMax: 0.62,
  kFlow: 0.8, // độ bám theo dòng chảy (1/s)
  kWave: 900, // lực sóng đẩy lá theo độ dốc mặt nước
  kCollide: 40, // độ cứng va chạm (1/s²)
  kHold: 180, // độ cứng lò xo khi giữ lá
  maxThrow: 520, // vận tốc ném tối đa (px/s)
  lift: 12, // độ nhấc lá khi đang kéo
};

// Độ cao z (đơn vị pixel ảnh, hướng về phía người xem).
export const Z = { stem: -10, water: 0, shadow: 0.5, ring: 0.8, leaf: 18, duck: 80, dropMin: 40, dropMax: 140, splash: 150 };

// Camera chiếu lệch tâm: mặt nước z = 0 luôn đứng yên trong khung.
export const CAMERA = { D: 1400, max: 240, ease: 4.5 };

// Lưới mô phỏng sóng. Cỡ ô tính theo độ phóng để trên màn hình mỗi ô ≈ screenCell px CSS.
export const SIM = {
  screenCell: 4.4,
  minCell: 3,
  maxCell: 12,
  maxCells: 110000, // trần số ô để giữ nhẹ CPU
  hz: 120, // số bước mỗi giây (cố định)
  damp: 0.9955, // tắt dần mỗi bước trên mặt nước
  dampLeaf: 0.95, // thêm tắt dần dưới lá
  dampShore: 0.82, // tắt dần ngoài bờ ao
};

// Ánh sáng: mặt trời ở góc trên phải ảnh.
export const SUN = { img: [1040, 60], dir: [0.55, 0.62, 0.56] };

// Sóng nền (hướng rad, bước sóng px, tốc độ px/s, biên độ) — lấy từ artifact, biên độ nhỏ lại.
export const AMBIENT_WAVES = [
  [0.55, 420, 26, 1.8],
  [2.1, 280, 22, 1.4],
  [3.7, 190, 30, 1.1],
  [5.1, 130, 18, 0.8],
  [1.3, 85, 34, 0.5],
];
export const AMBIENT_GAIN = 0.55;

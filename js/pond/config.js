// Mọi hằng số của ao vịt. Toạ độ "ảnh" là pixel của artboard 1920×1080 (duck-1.ai), trục y hướng xuống.
// Góc nhìn của cảnh: đứng DƯỚI mặt hồ nhìn lên, nên vịt và lá là nhìn từ dưới bụng.
// Mặt nước được nối dài ra ngoài khổ artboard (assets.js → buildWater) nên toạ độ có thể âm hoặc > 1920.

export const IMG_DIR = 'images-duck-v2/';
export const MANIFEST = IMG_DIR + 'manifest.json';

export const SRC = { w: 1920, h: 1080 };

// Khung nhìn: phủ kín màn hình, thừa bên nào cắt bên đó (giống background-size: cover).
// Màn dọc trên điện thoại sẽ mất bớt bề ngang — đã chốt như vậy.
export function computeView(cw, ch) {
  const s = Math.max(cw / SRC.w, ch / SRC.h);
  const w = cw / s, h = ch / s;
  return { s, w, h, x: SRC.w / 2 - w / 2, y: SRC.h / 2 - h / 2 };
}

export const LAYOUT = { worldMargin: 64 }; // lề quanh khung nhìn cho thị sai camera

// Lá sen trôi. dir = 1: trái → phải, dir = -1: phải → trái. Lá KHÔNG tự xoay (xoay thì cuống lá sai hướng).
export const FLOW = { dir: 1, speed: 15, jitter: 3.5, meander: 5 };

export const LEAVES = {
  areaPerLeaf: 330000, // số lá = diện tích khung nhìn (px ảnh²) / con số này
  minCount: 4,
  maxCount: 9,
  // Bốn mẫu lá có cỡ gốc rất chênh nhau (lá 2 rộng 672 px, lá 1 chỉ 329 px) nên mỗi mẫu được
  // chuẩn hoá về cùng bán kính mặt lá `radius`, rồi mới nhân thêm tỉ lệ ngẫu nhiên quanh 1.
  radius: 122,
  scaleMin: 0.78,
  scaleMax: 1.26,
  kFlow: 0.8, // độ bám theo dòng chảy (1/s)
  kWave: 900, // lực sóng đẩy lá theo độ dốc mặt nước
  kCollide: 40, // độ cứng va chạm (1/s²)
  kHold: 180, // độ cứng lò xo khi giữ lá
  maxThrow: 520, // vận tốc ném tối đa (px/s)
  lift: 14, // độ nhấc lá khi đang kéo
  stemFade: 0.82, // cuống chìm dưới nước nên nhạt và ngả màu nước
};

// Hai chú vịt. Hướng quay lấy từ 24 khung turntable trong manifest.
export const DUCKS = {
  count: 2,
  scale: 0.66,
  speed: 42, // tốc độ bơi (px ảnh / giây)
  turnRate: 1.25, // tốc độ xoay hướng (rad/s) — chậm lại thì khung đổi thưa, đỡ giật
  accel: 2.2, // độ bám vận tốc mong muốn (1/s)
  restMin: 1.8, // nghỉ giữa hai chặng bơi
  restMax: 5.5,
  pickMargin: 90, // đích bơi cách mép khung nhìn ngần này px ảnh
  minTrip: 260, // quãng đường tối thiểu mỗi chặng
  dragFollow: 7, // độ bám con trỏ khi đang kéo (1/s)
  bobGain: 0.5,

  // Sóng sau đuôi. Vịt bơi gần như liên tục nên đây là nguồn sóng thường trực — để mạnh một chút
  // là cả mặt ao đầy vòng sóng chồng chéo. Giữ rất nhẹ và thưa.
  wakeEvery: 0.20, // giãn cách tạo sóng (giây)
  wakeGain: 0.34,
  wakeMinSpeed: 16, // bơi chậm hơn ngần này thì không rẽ sóng



};

// Con vịt dựng bằng khối 3D (js/pond/duck3d.js). Đơn vị = px ảnh, tỉ lệ đo từ các khung turntable cũ:
// dài : rộng = 520 : 285, chìm khoảng 60% thân. Bảng màu lấy nguyên 7 màu phẳng của tranh gốc.
export const DUCK3D = {
  bodyLen: 520,
  bodyWidth: 285,
  bodyHeight: 300,
  waterY: 6, // mực nước so với tâm thân — số dương thì vịt chìm sâu hơn
  headR: 96,
  headX: 194, // đầu nhô về trước ngần này
  headY: 178, // và cao hơn tâm thân ngần này
  neckLen: 186,
  neckTilt: 0.38,
  beakLen: 92,
  eyeR: 9,
  legR: 15,
  legLen: 82, // vịt đang bơi nên chân thu gọn dưới bụng, không thõng như chim đứng
  footW: 132,
  footPitch: 0.55,
  paddle: 0.52, // biên độ quẫy chân (rad)
  refract: 17, // sóng bẻ lệch phần chìm bao nhiêu px ảnh
  waterEdge: 4, // đường mặt nước hoà mềm trong ngần này đơn vị
  liteStep: 0.34, // ngưỡng tô phẳng: trên ngưỡng thì dùng màu sáng
  colors: {
    above: [217, 226, 222], aboveHi: [240, 248, 246],
    below: [127, 127, 127], belowHi: [151, 152, 151],
    beak: [250, 119, 24], foot: [250, 148, 24], web: [249, 206, 25], eye: [0, 0, 0],
  },
};

// Độ cao z (px ảnh, hướng về phía người xem — ta ở dưới nước nhìn lên).
export const Z = { stem: -12, water: 0, ring: 0.8, leaf: 20, duck: 86, dropMin: 40, dropMax: 140 };

// Camera chiếu lệch tâm: mặt nước z = 0 luôn đứng yên trong khung.
export const CAMERA = { D: 1500, max: 210, ease: 4.5 };

// Lưới mô phỏng sóng. Cỡ ô tính theo độ phóng để trên màn hình mỗi ô ≈ screenCell px CSS.
export const SIM = {
  screenCell: 4.4,
  minCell: 3,
  maxCell: 12,
  maxCells: 110000,
  hz: 120,
  damp: 0.9915, // tắt dần nhanh hơn: vịt bơi liên tục nên sóng cũ phải tan kịp
  dampLeaf: 0.95, // thêm tắt dần dưới lá (chỉ mặt lá, không tính cuống)
  dampShore: 0.82,
};

// Ánh sáng: mặt trời ngoài khung phía trên bên phải — đo từ chỗ sáng nhất của nuoc.png.
// dir là hướng TỚI nguồn sáng; trong toạ độ ảnh y hướng xuống nên y dương nghĩa là nguồn sáng ở phía trên.
export const SUN = { img: [1960, -60], dir: [0.86, 0.51, 0.55] };

// Sóng nền (hướng rad, bước sóng px, tốc độ px/s, biên độ).
// Bước sóng ngắn có độ cong lớn, mà sáng tối giờ tính theo ĐỘ CONG, nên biên độ các thành phần
// ngắn phải nhỏ hẳn lại — không thì mặt nước lấm tấm vằn vện.
export const AMBIENT_WAVES = [
  [0.55, 560, 26, 2.1],
  [2.1, 370, 22, 1.4],
  [3.7, 250, 30, 0.9],
  [5.1, 165, 19, 0.45],
  [1.3, 110, 33, 0.18],
];
export const AMBIENT_GAIN = 0.5;

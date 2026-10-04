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

// Lề quanh khung nhìn: cho thị sai camera, và để lớp hút sóng ở mép lưới (SIM.sponge) nằm ngoài màn hình.
export const LAYOUT = { worldMargin: 150 };

// Phối cảnh theo trục y: nhìn từ dưới hồ lên thì vật ở CAO hơn trên màn hình là vật gần người xem hơn →
// to hơn; càng xuống thấp (xa) càng nhỏ. Hệ số cỡ ở mép trên và mép dưới khung nhìn, nội suy tuyến tính;
// áp cho cỡ vẽ, vùng tiếp nước, vùng bấm, va chạm và tốc độ trên màn hình của vịt lẫn lá.
export const PERSPECTIVE = { near: 1.25, far: 0.6 };
export function depthScale(y, V) {
  const t = Math.min(1, Math.max(0, (y - V.y) / V.h));
  return PERSPECTIVE.near + (PERSPECTIVE.far - PERSPECTIVE.near) * t;
}

// Lá sen trôi. dir = 1: trái → phải, dir = -1: phải → trái. Lá KHÔNG tự xoay (xoay thì cuống lá sai hướng).
export const FLOW = { dir: 1, speed: 15, jitter: 3.5, meander: 5 };

export const LEAVES = {
  areaPerLeaf: 330000, // số lá = diện tích khung nhìn (px ảnh²) / con số này
  minCount: 4,
  maxCount: 9,
  // Bốn mẫu lá có cỡ gốc rất chênh nhau (lá 2 rộng 672 px, lá 1 chỉ 329 px) nên mỗi mẫu được
  // chuẩn hoá về cùng bán kính mặt lá `radius`, rồi mới nhân thêm tỉ lệ ngẫu nhiên quanh 1.
  radius: 84, // người dùng muốn lá nhỏ lại 40% (từ 140)
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

// Hai chú vịt (model 3D, xem DUCK_MODEL bên dưới).
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

  // Đầu "sống": ngó nghiêng, quay đầu TRƯỚC khi thân rẽ, gật theo nhịp đạp, nhìn theo con trỏ.
  head: {
    ease: 6, // độ bám đích (1/s): nhỏ thì lề mề, lớn thì giật
    lookEvery: [1.2, 4], // mỗi ngần này giây đổi hướng ngó
    lookRange: 0.55, // ngó nghiêng tự nhiên tối đa (rad)
    lead: 0.8, // quay đầu trước thân khi rẽ: góc còn phải rẽ × số này
    yawMax: 1.0, // cổ chỉ quay được tới đây (rad)
    nod: 0.05, // gật theo nhịp đạp khi bơi (rad)
    lookAt: 420, // con trỏ cách vịt dưới ngần này px ảnh thì vịt nhìn theo
    peek: -0.22, // và cúi xuống nhìn khi con trỏ sát (rad, âm = cúi)
  },
  // Nổi thật: thân nghiêng theo độ dốc mặt nước chỗ nó đứng, nghiêng vào khúc rẽ, chúi theo nhịp đạp, thở.
  float: {
    slopeGain: 2.2, // độ dốc mặt nước nhân lên ngần này thành góc nghiêng (sóng nền rất thoải)
    maxTilt: 0.14, // nhưng không quá ngần này (rad)
    bank: 0.12, // nghiêng vào khúc rẽ (rad ở tốc độ rẽ tối đa)
    surge: 0.03, // chúi mũi theo nhịp đạp (rad)
    breath: 0.01, // thở: thân phập phồng ±ngần này
    breathHz: 0.45,
    ease: 8, // độ bám (1/s)
  },
  // Rũ nước: thỉnh thoảng, và hay làm sau khi bị kéo thả. Thân lắc nhanh, đuôi vẫy, đầu lúc lắc, bắn giọt.
  shake: {
    every: [18, 45],
    dur: 0.9,
    hz: 13,
    roll: 0.14, // biên độ lắc thân (rad)
    headYaw: 0.35, // biên độ lúc lắc đầu (rad)
    afterDrag: 0.7, // xác suất rũ sau khi được thả
    drops: 6, // số giọt bắn ra mỗi đợt
  },
};

// Con vịt là model 3D (models/duck.glb) do Tripo sinh từ ảnh, đã được tools/prepare-duck.mjs rút gọn
// và xoay về hệ chuẩn: mũi +X, lưng +Y, gan bàn chân chạm y = 0. Các số về hình thể dưới đây tính theo
// CHIỀU CAO MODEL = 1 (script đó in ra sẵn), nên thay model khác chỉ cần chạy lại script rồi điền số.
export const DUCK_MODEL = {
  url: 'models/duck.glb',
  length: 520, // khung bao dọc thân (đuôi tới mỏ) dài ngần này px ảnh, chưa nhân DUCKS.scale
  water: 0.34, // mực nước ở độ cao này (0 = gan bàn chân, 1 = đỉnh đầu) — khoảng 1/3 thân chìm
  hip: 0.167, // khớp háng: chỗ cẳng chân gặp bụng (số đỉnh và bề rộng lát cắt nhảy vọt)
  hipBand: 0.02, // dải hoà mềm quanh khớp, như trọng số da
  hipR0: 0.05, // trong dải ấy, bụng cách trục cẳng chân dưới hipR0 bị kéo theo hẳn, ngoài hipR1 thì đứng yên
  hipR1: 0.10,
  legSpread: 0.12, // model gốc đứng lệch chân; kéo hai chân về cách trục thân mỗi bên ngần này
  spreadBand: 0.09, // việc kéo đó hoà dần trên đoạn cẳng cao ngần này (cao = 1) — ngắn quá thì chân gãy khúc ở háng
  paddle: 0.5, // biên độ quẫy chân (rad) khi bơi hết tốc; bơi chậm thì quẫy nhẹ hơn
  paddleBase: -0.35, // chân duỗi ra sau ngần này (rad) — vịt bơi chứ không đứng
  paddleHz: 0.77, // nhịp quẫy (lần/giây); người dùng muốn chậm hơn 30% so với 1,1 ban đầu
  // Khớp thứ hai ở cổ chân cho nhịp đạp dẻo: bàn chân gập theo sau cẳng chân, trễ pha — như roi quất.
  ankle: 0.115, // cổ chân dự phòng (cao = 1) — bình thường rig() tự dò cho từng chân vì hai chân nhấc cao thấp khác nhau
  ankleBand: 0.015,
  ankleAmp: 0.55, // bàn chân gập tối đa ngần này (rad) khi quẫy hết cỡ
  ankleLag: 1.4, // bàn chân trễ pha so với cẳng chân (rad)
  // Đầu: mọi đỉnh trên gốc cổ `neck` (cao = 1), hoà mềm trong neckBand. Gốc cổ đặt cao hơn đỉnh lưng
  // (0,666) để lưng không bị kéo theo khi đầu quay. Khớp là tâm mặt cắt cổ, rig() tự đo.
  neck: 0.70,
  neckBand: 0.03,
  // Đuôi thỉnh thoảng vẫy ngang: vùng đuôi là phần thân phía sau, trọng số 0 ở x = −base, 1 ở x = −tip
  // (tính từ tâm thân, cao = 1); mỗi every[0..1] giây vẫy một đợt dài dur giây, nhịp hz, biên độ amp (rad).
  tail: { base: 0.30, tip: 0.40, amp: 0.22, hz: 6.5, every: [2.5, 6], dur: 0.8 }, // người dùng muốn vẫy dày hơn: trước là 4–10 s
  refract: 200, // phần NỔI (nhìn xuyên qua mặt nước từ dưới lên) bị bẻ lệch = độ dốc mặt nước × số này (px ảnh)
  refractMax: 14, // nhưng không quá ngần này px — gợn ngay sau cú chạm rất dốc, không chặn thì vịt văng ra
  waterEdge: 4, // đường mặt nước hoà mềm trong ngần này px
  ambient: 0.55, // ánh sáng: texture đã có bóng vẽ sẵn nên chỉ thêm nhẹ cho có khối
  diffuse: 0.6,
  normalScale: 0.6, // độ nổi của vân lông từ normal map (0 = tắt)
  // Góc nhìn từ đáy hồ lên: phần NỔI là phần nhìn xuyên qua mặt nước nên mới xỉn màu; phần chìm rõ nét.
  throughTint: [0.5, 0.56, 0.64], // phần nổi: nhân màu (tuyến tính) ngả xanh xám
  throughDesat: 0.45, // và bớt bão hoà
  // phần chìm ngả màu nước theo độ sâu — vịt rất nhẹ: bụng sát mặt nước gần như giữ nguyên, chân mới ngả
  belowTint: [0.86, 0.93, 0.97],
  belowDepth: 220, // ngả đủ ở độ sâu này (px ảnh)
  belowDesat: 0.1,
};

// Lá sen là 4 model 3D (models/la_1..4.glb) do Tripo sinh từ ảnh lá vẽ, đã qua tools/prepare-leaf.mjs:
// mặt lá nằm ngang trong mặt phẳng XZ, tâm mặt lá ở gốc, BÁN KÍNH MẶT LÁ = 1, cuống bẻ rủ xuống −Y.
// Lúc nạp, leaf3d.js phóng bán kính 1 → LEAVES.radius px và đặt mực nước ngay dưới đáy mặt lá
// (mặt lá nổi hoàn toàn — nhìn xuyên qua mặt nước nên xỉn; cuống chìm, rõ nét).
export const LEAF_MODEL = {
  urls: ['models/la_1.glb', 'models/la_2.glb', 'models/la_3.glb', 'models/la_4.glb'],
  flip: [false, false, false, false], // true: lật lá (mặt +Y thành −Y) nếu model nào có mặt gân ở dưới
  float: 2, // đáy mặt lá cao hơn mực nước ngần này px
  refract: 200, refractMax: 14, // như vịt
  ambient: 0.6, diffuse: 0.55, normalScale: 0.5, waterEdge: 3,
  // texture lá vốn nhạt (pastel) nên màn nước phủ nhẹ tay hơn vịt, không thì lá xám xịt
  throughTint: [0.62, 0.68, 0.74], throughDesat: 0.28,
  // phần chìm (mép lá trĩu xuống, cuống) ngả màu nước rõ: xanh lam, tối hơn, bớt bão hoà, càng sâu càng rõ
  belowTint: [0.55, 0.78, 0.9], belowDepth: 30, belowDesat: 0.35, // mép lá trĩu chỉ chìm vài px nên dải ngắn, vừa chạm nước đã ngả
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
  maxCells: 300000, // lưới nằm trên mặt nước phối cảnh: phần dưới (xa) rộng và dày hơn — cho thêm ô kẻo phần trên (gần, phóng to) thô
  waveC: 0.33, // (vận tốc sóng · dt / ô)², ổn định khi < 0.75; ô to hơn thì hạ số này để sóng lan trên màn hình không nhanh hơn
  hz: 120,
  damp: 0.9915, // tắt dần nhanh hơn: vịt bơi liên tục nên sóng cũ phải tan kịp
  dampLeaf: 0.95, // thêm tắt dần dưới lá (chỉ mặt lá, không tính cuống)
  dampShore: 0.82,
  // Lớp hút sóng ở mép lưới: mép lưới là tường cứng (ô biên luôn = 0) nên sóng dội ngược vào màn hình,
  // ao đầy sóng chồng chéo. Trong `sponge` px cuối, hệ số tắt dần hạ mượt từ `damp` xuống `dampEdge`
  // để sóng tan trước khi chạm tường — và vì lề thế giới (LAYOUT.worldMargin) rộng hơn, dải này nằm ngoài màn hình.
  sponge: 120,
  dampEdge: 0.86,
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

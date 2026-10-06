// Mọi hằng số của ao vịt. Toạ độ "ảnh" là pixel của artboard 1920×1080, trục y hướng xuống.
// Góc nhìn của cảnh: đứng DƯỚI đáy hồ nhìn lên vòm cây và bầu trời (gói art "duck background" 10/2026):
// mặt nước là "cửa sổ" elip ở giữa-trên có lưới sóng trắng, vịt và lá nổi ở đó; phần dưới màn hình là nước
// sâu với bong bóng nổi lên, tia nắng và sao lấp lánh. Khung nhìn có thể vượt khổ artboard (nền kéo dài mép).

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

// Phối cảnh (persp.js): nhìn từ dưới hồ lên thì vật ở CAO hơn trên màn hình là vật gần người xem hơn → to
// hơn, càng xuống thấp (xa) càng nhỏ; theo file art còn "to dần về 2 bên". near/far là hệ số cỡ ở giữa mép
// trên / giữa mép dưới khung nhìn; radial: cỡ theo khoảng cách tới điểm tụ dưới màn hình (to ra hai bên), và
// vật nổi xoay theo tia về điểm tụ nhân `lean` (0 = đứng thẳng). Hệ số áp cho cỡ vẽ, vùng tiếp nước, vùng
// bấm, va chạm, tốc độ trên màn hình của vịt lẫn lá, và cho lưới sóng (persp.S(x, y)).
export const PERSPECTIVE = { near: 1.25, far: 0.6, radial: true, lean: 0.6 };

// Nền: tranh vòm cây + 9 lớp hoà trộn mặt nước đã nướng thành một ảnh (tools/bake-bg.py), phủ đúng khổ artboard.
export const BG = { url: 'images-bg/bg.webp', rect: { x: 0, y: 0, w: 1920, h: 1080 } };

// Vùng MẶT NƯỚC (toạ độ artboard):
// - arc: mép dưới vùng nước loang — bên trên là mặt nước (sóng, vịt, lá, chạm được), bên dưới là nước sâu
//   (bong bóng, tia nắng). Chữ V do chủ dự án khoanh trên ảnh chụp (2026-10-06, "loang full khu highlight"):
//   cạnh trái dốc ~0,88, cạnh phải ~−0,59, đáy cong NẰM DƯỚI khung (y ≈ 1125) nên cả dải giữa tới đáy màn hình
//   là mặt nước. Thay cho cung vàng của gói art (đáy y 722). Ngoài hai đầu kéo dài thẳng.
// - ellipse: elip xanh (mask shape) — vùng vẽ lưới sóng trắng; edge: từ bao nhiêu phần bán kính thì mờ dần.
// - fade: sóng và khúc xạ tắt dần qua mép trong ngần này px — đủ mềm để không thành vạch cắt ngang vòng sóng.
// - deepBlur: nước sâu nhoè Gauss bán kính px (≈ 1–2 px nhìn thấy), chuyển dần trong width px quanh mép. Đây là
//   cách tạo "Gaussian blur ở mép nước cho chân thật" (2026-10-06). KHÔNG vẽ vệt sáng / dải tối dọc mép: đã thử,
//   chủ dự án bác — thành một đường kẻ, mất chân thật.
export const SURFACE = {
  arc: [[0, 395], [240, 607], [480, 819], [720, 1031], [840, 1095], [985, 1125], [1120, 1100], [1300, 965], [1440, 881], [1680, 740], [1920, 599]],
  ellipse: { cx: 1005, cy: 275, rx: 1050, ry: 513, edge: 0.78 },
  fade: 28,
  deepBlur: { px: 2, width: 70 },
};
// Mép dưới của mặt nước tại hoành độ x (nội suy tuyến tính trên cung, kéo dài thẳng ngoài hai đầu).
export function surfaceBottom(x) {
  const a = SURFACE.arc, n = a.length;
  let i = 1;
  while (i < n - 1 && x > a[i][0]) i++;
  const [x0, y0] = a[i - 1], [x1, y1] = a[i];
  return y0 + ((x - x0) * (y1 - y0)) / (x1 - x0);
}
// Khoảng cách VUÔNG GÓC (px ảnh) từ điểm tới mép mặt nước, dương = trong vùng. Cạnh chữ V dốc tới ~40°, đo theo
// phương dọc (surfaceBottom − y) thì dải hút sóng ở cạnh dốc hẹp hơn ở đáy cả phần tư.
export function surfaceInside(x, y) {
  const slope = (surfaceBottom(x + 4) - surfaceBottom(x - 4)) / 8;
  return (surfaceBottom(x) - y) / Math.sqrt(1 + slope * slope);
}
// Đa giác vùng mặt nước phủ bề ngang `world` (Path2D, toạ độ ảnh): từ trên khung xuống tới cung.
export function surfacePath(world) {
  const p = new Path2D(), x0 = world.x, x1 = world.x + world.w, top = world.y - 50, n = 48;
  p.moveTo(x0, top);
  p.lineTo(x1, top);
  for (let i = 0; i <= n; i++) { const x = x1 + ((x0 - x1) * i) / n; p.lineTo(x, surfaceBottom(x)); }
  p.closePath();
  return p;
}

// Lưới sóng trắng (WATER-EFFECT 2.svg — một path dạng mạng, ô là lỗ) phủ trong elip mặt nước. Lấy mẫu TRÊN
// MẶT PHẲNG NƯỚC (persp.js) nên ô lưới to ở trên, nhỏ dần xuống dưới, nghiêng theo tia về điểm tụ như vòng
// sóng; trôi chậm và méo theo gợn sóng để không chết cứng.
export const NET = {
  // TẮT 2026-10-06: chủ dự án thấy lưới trắng phủ lên mặt nước lẫn vịt, lá khá nhiễu. false = không nạp net.svg,
  // mặt nước và vật nổi bỏ qua lưới (netUniforms(null) → độ phủ 0). Bật lại: true.
  enabled: false,
  url: 'images-bg/net.svg',
  texW: 2048, // rasterize SVG ở bề ngang này
  scale: 1400, // một bản lưới rộng ngần này đơn vị mặt nước (= px ảnh ở chỗ S = 1); ô lưới ≈ 8–12 % số này
  aspect: 1.5, // kéo dọc trên mặt nước: ô lưới trong tranh mẫu bớt dẹt hơn phép chiếu 0,39
  opacity: 0.42, // phủ trắng (alpha) — trong tranh mẫu lưới là nét trắng nửa trong suốt, thấy cả trên nền trời
  soft: 0.4, // thêm soft light (thư mục "EFFECTS (soft light)")
  refract: 60, // lưới méo theo độ dốc mặt nước: độ dốc × ngần này px
  drift: [14, 10], driftHz: [0.045, 0.031], // trôi chậm trên mặt nước (đơn vị mặt nước, Hz)
};

// Bong bóng nổi từ đáy lên (bubble-1..3.svg). Ta ở đáy hồ nên lúc mới sinh bóng ở GẦN (to), nổi lên là đi
// xa dần (nhỏ lại) — ngược với vịt lá trên mặt nước. Chạm "viền tam giác" thì nổ ("bóng chạm đến viền tam
// giác thì nổ; hiệu ứng bể: dùng spark kết hợp"): tam giác đỉnh ở giữa-dưới, hai cạnh nghiêng ~36°, nên bóng
// ở giữa nổ sớm (thấp), bóng hai bên nổi cao hơn mới nổ.
export const BUBBLES = {
  urls: ['images-bg/bubble-1.svg', 'images-bg/bubble-2.svg', 'images-bg/bubble-3.svg'],
  max: 7,
  every: [1.3, 2.8], // giãn cách sinh (giây)
  rise: [55, 95], // tốc độ nổi (px ảnh/giây)
  r0: [50, 86], // bán kính lúc sinh (px ảnh)
  shrink: 0.42, // tới lúc nổ còn ngần này phần bán kính
  wobble: 16, wobbleHz: [0.35, 0.7], // lắc ngang
  drift: 12, // trôi dạt ra hai bên (px/giây)
  z: [120, 40], // độ cao lúc sinh → lúc nổ (thị sai: gần thì trượt nhiều theo camera)
  alpha: 0.92,
  pop: { apex: [901, 707], slope: 0.727 }, // viền tam giác: y_nổ(x) = apex.y − |x − apex.x|·slope
  spark: { url: 'images-bg/spark.svg', dur: 0.55, size: 2.0 }, // tia nổ: to bằng bán kính bóng × size, kéo dài dur giây
  // Bấm mặt nước: count bóng nhỏ bán kính r sinh dưới chỗ bấm below px, nổi travel px với tốc độ rise rồi vỡ; z lúc
  // sinh → lúc vỡ (gần người xem rồi lùi về phía mặt nước); max bóng cùng lúc; ripple: gợn khi vỡ (biên độ sim).
  tap: { count: [1, 3], r: [14, 30], below: [25, 70], travel: [70, 150], rise: [100, 150], z: [75, 25], max: 24, wobble: 6, ripple: 0.6 },
};

// Sao lấp lánh (WATER-SPARK.svg): nhấp nháy rồi đổi chỗ; phần lớn trong vùng trời/mặt nước, vài cái dưới nước sâu.
export const SPARKLES = { url: 'images-bg/spark.svg', count: 9, size: [18, 50], period: [2.8, 6], on: 1.3, zoneBias: 0.65, z: 30 };

// Âm thanh (audio.js): nhạc nền lặp bắt đầu sau cử chỉ đầu tiên của người dùng (chính sách autoplay), tiếng nổ
// khi BẤM bong bóng, tiếng vịt quạc khi bấm vịt, tiếng chạm nước khi bấm mặt hồ. Âm lượng theo file: nổ đỉnh 0 dB (ngắn), quạc −2 dB, nhạc −11 dB.
export const AUDIO = {
  enabled: true,
  files: { bg: 'audio/bg.mp3', pop: 'audio/pop.mp3', quack: 'audio/quack.mp3', touch: 'audio/touch.mp3' },
  master: 1,
  music: 0.45, // nhạc nền
  fadeIn: 2.5, // nhạc nền vào êm trong ngần này giây
  sfx: 0.9,
  popVolume: 0.7,
  quackVolume: 0.9,
  quackMinGap: 0.35, // bấm vịt liên hồi thì mỗi ngần này giây mới quạc một tiếng
  touchVolume: 0.8, // tiếng chạm nước khi bấm mặt hồ tạo sóng
  touchMinGap: 0.12,
};

// Tia nắng lung linh trong nước sâu (ngoài vùng mặt nước): hai dải sin trôi theo phương vuông góc với tia
// (tia trong tranh từ góc phải trên xuống trái dưới). amp = 0 là tắt.
// Liquify nước sâu (2026-10-06, "nước chuyển động cho thật hơn"): nền phía dưới mép uốn lượn chậm như nhìn qua khối
// nước đang trôi — domain-warp noise trong water.js. amp px méo tối đa (ở sâu nhất;
// sát mép một nửa, trên mặt nước 0), scale cỡ xoáy px, speed tốc độ trôi (đơn vị nhiễu / giây), curl độ cuộn,
// ramp px từ mép xuống tới chỗ méo đủ.
// Mức nhẹ (3,5 px, 0,05) chủ dự án thấy "chưa thay đổi nhiều" → mức rõ, kèm tia nắng uốn theo dòng (rayBend px) và
// mảng sáng tối loang chậm (patch: amp ±, scale px, speed) như nắng xuyên mặt nước dao động — không có nét.
export const DEEP_FLOW = {
  amp: 12, scale: 240, speed: 0.3, curl: 1.0, ramp: 300,
  rayBend: 45,
  patch: { amp: 0.12, scale: 520, speed: 0.05 },
};

// Cây trong nền chuyển động theo 3 LỚP (bản mô tả của chủ dự án, 2026-10-06; water.js bước 1c). Chỉ CÂY (mặt nạ tách
// theo màu từ bg.webp lúc nạp — không có lớp cây riêng), trời mây đứng yên; mọi chỗ có cây kể cả nước sâu.
// Lớp chia mềm từ mặt nạ: fore = cành dày sát mép khung (trong `edge` px tính từ mép trái/phải/đáy), tip = lá mỏng
// giáp trời, mid = phần còn lại (vòm tán). fore/mid XOAY quanh gốc cành (chỗ tia tâm trời → điểm cắt mép khung) góc
// deg (°, mỗi cụm một mức trong khoảng); mid thêm tịnh tiến shift px; tip chỉ rung tịnh tiến. period: chu kỳ (s).
// cap: trần độ dời mọi lớp (px) — số góc theo bản mô tả (±2,5° ở cành dài ~500 px ≈ 20 px) nhưng chặn ở mức chủ dự
// án đã chỉnh (14) để ảnh không kéo giãn lộ. delay: trễ pha giữa các cụm (s); wind: làn gió lướt ngang (px/s) cho
// trái phải lệch pha. gust: thỉnh thoảng một cơn mạnh hơn. sheen: lá đón nắng nhấp nháy độ sáng min → 1.
// Không làm lá rơi (đã hỏi, chủ dự án bỏ). key/blur/tipBlur: tách cây theo màu — xem foliageMask (assets.js).
export const FOLIAGE = {
  cap: 14,
  centre: [1000, 330], wind: 650,
  delay: [0.5, 2.5],
  gust: { every: 9, amt: 0.6 },
  fore: { deg: [0.5, 1.5], period: 7, edge: 260 },
  mid: { deg: [1, 2.5], shift: [2, 5], period: 5 },
  tip: { shift: [2, 3], period: 2.8 },
  sheen: { min: 0.95 },
  key: { lo: 0.02, hi: 0.12, sLo: 0.15, sHi: 0.35 },
  blur: 12, tipBlur: 120,
  skyLum: 0.5, skyBlur: 90, // vùng trời: không phải cây mà sáng hơn skyLum, nối liền tâm; làm mờ skyBlur px → lá viền
};


export const RAYS = { amp: 0.05, perp: [0.91, 0.42], waves: [[140, 9], [310, -6]] }; // [bước sóng px, tốc độ px/s]

// Lá sen trôi. dir = 1: trái → phải, dir = -1: phải → trái. Lá KHÔNG tự xoay (xoay thì cuống lá sai hướng).
export const FLOW = { dir: 1, speed: 15, jitter: 3.5, meander: 5 };

export const LEAVES = {
  areaPerLeaf: 330000, // số lá = diện tích khung nhìn (px ảnh²) / con số này
  minCount: 4,
  maxCount: 9,
  // Mỗi mẫu lá được chuẩn hoá về cùng bán kính mặt lá `radius`, rồi nhân tỉ lệ ngẫu nhiên. Chỉ có 2 mẫu
  // (sen_1, sen_2) nên tỉ lệ trải RỘNG và chia đều dải (leaves.js → sizes) để không lá nào trông cùng một
  // cỡ; lá trôi ra khỏi màn hình thì sinh lại với cỡ mới.
  radius: 84, // người dùng muốn lá nhỏ lại 40% (từ 140)
  scaleMin: 0.55,
  scaleMax: 1.5,
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
  scale: 0.6,
  speed: 42, // tốc độ bơi (px ảnh / giây)
  turnRate: 1.25, // tốc độ xoay hướng (rad/s) — chậm lại thì khung đổi thưa, đỡ giật
  accel: 2.2, // độ bám vận tốc mong muốn (1/s)
  restMin: 1.8, // nghỉ giữa hai chặng bơi
  restMax: 5.5,
  pickMargin: 90, // đích bơi cách mép khung nhìn ngần này px ảnh
  zoneMargin: 30, // và tâm vịt không xuống thấp hơn mép mặt nước (SURFACE.arc) trừ ngần này
  minTrip: 260, // quãng đường tối thiểu mỗi chặng
  dragFollow: 7, // độ bám con trỏ khi đang kéo (1/s)
  bobGain: 0.5,

  // Sóng sau đuôi. Vịt bơi gần như liên tục nên đây là nguồn sóng thường trực — để mạnh một chút
  // là cả mặt ao đầy vòng sóng chồng chéo. Giữ rất nhẹ và thưa.
  wakeEvery: 0.35, // giãn cách tạo sóng (giây). Khoảng cách giữa các vòng trên mặt nước = tốc độ lan × số này; chủ dự án muốn khoảng cách +20 % khi sóng đã chậm thêm 30 % (đo: 373 × 0,20 ≈ 75 → 257 × 0,35 ≈ 90, 2026-10-06)
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
    drops: 6, // số chỗ gợn mặt nước mỗi đợt rũ (chia hai bên thân; không còn bắn giọt)
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
  waterEdge: 6, // đường mặt nước hoà mềm trong ngần này px
  rim: { width: 2, glow: 0.3, shade: 0.14 }, // mép nước ôm thân: quầng sáng mảnh trên mực nước + dải tối ngay dưới (floater.js)
  ambient: 0.55, // ánh sáng: texture đã có bóng vẽ sẵn nên chỉ thêm nhẹ cho có khối
  diffuse: 0.6,
  normalScale: 0.6, // độ nổi của vân lông từ normal map (0 = tắt)
  // Góc nhìn từ đáy hồ lên: phần NỔI là phần nhìn xuyên qua mặt nước nên mới xỉn màu; phần chìm rõ nét.
  throughTint: [0.84, 0.9, 0.96], // phần nổi: nhân màu (tuyến tính) — nền mới là trời sáng nên chỉ ngả nhẹ, không tối
  throughDesat: 0.3, // và bớt bão hoà
  throughHaze: [0.74, 0.86, 0.97], throughHazeAmt: 0.2, // rồi pha về màu sáng của trời nhìn qua mặt nước
  // phần chìm ngả màu nước theo độ sâu — vịt rất nhẹ: bụng sát mặt nước gần như giữ nguyên, chân mới ngả
  belowTint: [0.86, 0.93, 0.97],
  belowDepth: 220, // ngả đủ ở độ sâu này (px ảnh)
  belowDesat: 0.1,
};

// Lá sen là 2 model 3D (models/sen_1..2.glb) do Tripo sinh từ ảnh lá vẽ, đã qua tools/prepare-leaf.mjs:
// mặt lá nằm ngang trong mặt phẳng XZ, tâm mặt lá ở gốc, BÁN KÍNH MẶT LÁ = 1, cuống bẻ rủ xuống −Y.
// Lúc nạp, leaf3d.js phóng bán kính 1 → LEAVES.radius px và đặt mực nước ngay dưới đáy mặt lá
// (mặt lá nổi hoàn toàn — nhìn xuyên qua mặt nước nên xỉn; cuống chìm, rõ nét).
export const LEAF_MODEL = {
  urls: ['models/sen_1.glb', 'models/sen_2.glb'],
  flip: [false, false], // true: lật lá (mặt +Y thành −Y) nếu model nào có mặt gân ở dưới
  float: 2, // đáy mặt lá cao hơn mực nước ngần này px
  refract: 200, refractMax: 14, // như vịt
  ambient: 0.6, diffuse: 0.55, normalScale: 0.5, waterEdge: 3,
  // không có quầng mép nước (rim): lá chỉ dày ~5 px nên cả mặt lá nằm trong dải ấy và bị phủ trắng
  // texture lá vốn nhạt (pastel) nên màn nước phủ nhẹ tay hơn vịt, không thì lá xám xịt
  throughTint: [0.86, 0.9, 0.94], throughDesat: 0.25, throughHaze: [0.74, 0.86, 0.97], throughHazeAmt: 0.14,
  netGain: 0.45, // lưới sóng trắng phủ lên mặt lá nhẹ thôi — mặt lá phẳng mà phủ đậm như vịt thì thành loang lổ
  // phần chìm (mép lá trĩu xuống, cuống) ngả màu nước rõ: xanh lam, tối hơn, bớt bão hoà, càng sâu càng rõ
  belowTint: [0.55, 0.78, 0.9], belowDepth: 30, belowDesat: 0.35, // mép lá trĩu chỉ chìm vài px nên dải ngắn, vừa chạm nước đã ngả
};

// Độ cao z (px ảnh, hướng về phía người xem — ta ở dưới nước nhìn lên).
export const Z = { stem: -12, water: 0, ring: 0.8, leaf: 20, duck: 86, dropMin: 40, dropMax: 140, spark: 30 };

// Camera chiếu lệch tâm: mặt nước z = 0 luôn đứng yên trong khung.
export const CAMERA = { D: 1500, max: 210, ease: 4.5 };

// Lưới mô phỏng sóng. Cỡ ô tính theo độ phóng để trên màn hình mỗi ô ≈ screenCell px CSS.
// Điện thoại (2026-10-06, "chạy trên điện thoại rất xấu"). Màn dọc giữ khung cắt cover (chủ dự án chọn) nhưng
// THU NHỎ vật thể theo objScale = clamp(view.w / refViewW, minScale, 1): ở 390×844 view.w ≈ 500 px ảnh → ~0,64,
// vịt ≈ 30 % bề ngang màn hình (trước ~45–50 %). Máy tính / màn ngang view.w = 1920 → 1, không đổi.
// Hồ sơ hiệu năng (máy cảm ứng hoặc màn nhỏ): sóng 60 Hz, ô ≈ screenCell px CSS, trần maxCells ô.
export const MOBILE = { refViewW: 780, minScale: 0.55, hz: 60, screenCell: 6, maxCells: 120000 };
export const isMobileDevice = () =>
  (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches) || Math.min(screen.width, screen.height) < 700;

export const SIM = {
  screenCell: 4.4,
  minCell: 3,
  maxCell: 12,
  maxCells: 300000, // lưới nằm trên mặt nước phối cảnh: phần dưới (xa) rộng và dày hơn — cho thêm ô kẻo phần trên (gần, phóng to) thô
  // Tốc độ lan sóng tính theo GIÂY (đơn vị mặt nước/giây), không theo bước: hằng số mỗi bước C = (v·dt/ô)² do
  // WaterSim tự tính từ cỡ ô và hz thật, nên cửa sổ to nhỏ, máy tính hay điện thoại (60 Hz, ô to hơn) đều lan cùng
  // tốc độ (bản trước khai waveC theo bước nên tốc độ đổi theo cỡ ô). 270 = mức chủ dự án chốt 2026-10-06
  // (waveC 0,1035 ở ô 7 px, 120 Hz — đã giảm hai lần: −20 % rồi −30 %). Trên điện thoại nhân thêm objScale.
  waveSpeed: 270,
  hz: 120, // số bước mô phỏng mỗi giây trên máy tính (điện thoại: MOBILE.hz); các hệ số damp* dưới đây là theo bước ở 120 Hz
  damp: 0.9915, // tắt dần nhanh hơn: vịt bơi liên tục nên sóng cũ phải tan kịp
  dampLeaf: 0.95, // thêm tắt dần dưới lá (chỉ mặt lá, không tính cuống)
  // Mép vùng mặt nước (cung SURFACE.arc) không phải tường: trong `shoreBand` px ảnh cuối trước khi tới cung, hệ số
  // tắt dần hạ mượt (smoothstep) từ `damp` xuống `dampShore` nên sóng tắt dần rồi mới chạm mép, không dội lại.
  // Đổi đột ngột (bản trước: chuyển trong ~16 px) là sóng đập vào "thành" giữa phía dưới rồi phản lại — người dùng chê.
  // Dải hẹp (~50 px) để sóng còn rõ tới sát mép vùng đã khoanh; vẫn ~10 ô, sóng tắt hết trước khi chạm mép.
  dampShore: 0.86,
  shoreBand: 50,
  // Lớp hút sóng ở mép lưới: mép lưới là tường cứng (ô biên luôn = 0) nên sóng dội ngược vào màn hình,
  // ao đầy sóng chồng chéo. Trong `sponge` px cuối, hệ số tắt dần hạ mượt từ `damp` xuống `dampEdge`
  // để sóng tan trước khi chạm tường — và vì lề thế giới (LAYOUT.worldMargin) rộng hơn, dải này nằm ngoài màn hình.
  sponge: 120,
  dampEdge: 0.86,
};

// Ánh sáng: mặt trời ngoài khung phía trên bên phải — chùm tia nắng trong tranh nền toả từ góc ấy.
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

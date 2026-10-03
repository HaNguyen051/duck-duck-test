# web-test-duck-duck

Dự án web 3D dùng three.js: **ao sen tương tác nhìn từ DƯỚI mặt nước nhìn lên** (`index.html`), tràn kín màn hình, không có chữ nghĩa gì khác. Hai chú vịt bơi lang thang và tự quay đầu theo hướng bơi; kéo được vịt, kéo được lá sen; chạm hay vuốt mặt nước thì nổi vòng sóng. Sóng nước mô phỏng thật trên lưới CPU.

## Chạy và cấu trúc

- Chạy local: `npx -y serve .` rồi mở `http://localhost:3000`. Mở thẳng file (`file://`) thì trình duyệt chặn ES module, chặn `fetch` manifest và chặn đọc pixel ảnh, nên trang chỉ hiện lời nhắc.
- Cờ URL: `?static` / `?nogl` (không dựng cảnh), `?freeze` (dừng thời gian), `?debug` (vẽ đè lưới sóng), `?test` (lộ `window.__pond`).
- `images-duck-v2/`: asset xuất tự động từ `~/Downloads/duck-1 (2).ai`, **không sửa tay**. `manifest.json` ghi vị trí và cỡ từng ảnh theo toạ độ artboard 1920×1080, kèm 24 khung vịt và đường bao tiếp nước của chúng. Muốn xuất lại thì chạy script JSX điều khiển Illustrator (xem memory `duck-ai-scripting`).
- `images-duck/`: **bộ ảnh cũ** 1080×1620 của bản trang tìm kiếm, giữ lại làm tư liệu, code không còn dùng.

### Toạ độ và bố cục

- "Toạ độ ảnh" = pixel của artboard 1920×1080, trục y hướng xuống. Mặt nước được nối dài ra ngoài khổ nên toạ độ có thể âm hoặc > 1920.
- `computeView` (`js/pond/config.js`) phủ kín màn hình kiểu `cover`: thừa bên nào cắt bên đó. Màn dọc trên điện thoại mất bớt bề ngang — đã chốt như vậy.
- Không còn mặt nạ bờ ao. Vùng tương tác của sóng lấy từ layer `interactive water` trong file AI, đọc qua `manifest.interactive` dưới dạng đường SVG.

### Các module trong `js/pond/`

- `config.js` — mọi hằng số.
- `assets.js` — nạp manifest, dựng texture, **sinh pháp tuyến cho lá từ chính hình lá** (`leafNormalMap`), nối dài mặt nước (`buildWater`), tách giọt nước.
- `watersim.js` — lưới sóng CPU. Vịt bơi nên vật chắn phải dựng lại mỗi khung hình: `clearSolid()` rồi `stampSolid(mask, ...)`.
- `water.js` — shader mặt nước **nhìn từ dưới lên**: sáng tối do ĐỘ CONG (Laplace) quyết định chứ không phải độ dốc, vì mặt nước là thấu kính tụ ánh sáng. Thêm khúc xạ nền và phản xạ toàn phần ở chỗ dốc gắt.
- `leaves.js` — lá trôi, **không bao giờ tự xoay** (xoay thì cuống lá chĩa sai hướng). Lá vẽ **đúng như ảnh trong file AI**, không tô lại ánh sáng 3D lúc chạy — đã thử và bị bác.
- `duck3d.js` — **con vịt dựng bằng khối 3D thật**, thay cho 24 khung ảnh turntable. Mặt nước bị ép dẹt 0,39 lần nên cả con vịt được nghiêng `asin(0,39) ≈ 23°` cho khớp, rồi xoay quanh trục đứng theo hướng bơi — ra đúng hiệu ứng turntable mà mượt ở mọi góc. Mực nước cắt thân tính thẳng theo độ cao từng đỉnh trong shader nên chính xác tuyệt đối. Chân quẫy bằng cách xoay quanh khớp háng trong vertex shader, hai chân lệch pha nửa nhịp.
- `ducks.js` — điều khiển hai con vịt: bơi lang thang, kéo được, rẽ sóng. Hướng bơi trên màn hình phải chia cho `squash` trước khi quy ra hướng trên mặt nước. Vùng tiếp nước là mặt cắt thân ở mực nước — một hình elip, dán vào lưới sóng bằng `sim.stampEllipse`.
- `scene.js` — renderer, camera chiếu lệch tâm, vòng lặp, dựng lại khi đổi cỡ màn hình.
- `input.js`, `drops.js`.

### Những chỗ dễ sai

- Mảng `alpha` của mọi lớp luôn ở **đơn vị px ảnh (1×)**, còn `canvas` giữ độ phân giải gốc của file (lá xuất ở 2×). Đừng lẫn hai hệ này.
- Bốn mẫu lá có cỡ gốc rất chênh nhau, nên mỗi mẫu được chuẩn hoá về cùng `LEAVES.radius` qua hệ số `fit` trước khi nhân tỉ lệ ngẫu nhiên.
- Hình học (`PlaneGeometry`) phải gắn vào object của asset và dùng lại, vì cảnh được dựng lại mỗi lần đổi cỡ cửa sổ.
- Lớp `vien nuoc` là nét sóng vẽ sẵn quanh chỗ vịt **đứng yên** trong tranh gốc. Giờ vịt bơi nên nó chỉ còn là vân mặt nước, để nhạt qua `STROKE_ALPHA` trong `assets.js`.
- **Mực nước của vịt** lấy từ mép TRÊN của đường `DUCK SHADOW` theo từng cột ảnh (`waterlineOf`). Cột nào không có đường bao (chân thò ra ngoài bề ngang thân) thì lan giá trị từ cột gần nhất.
- **Hoà hình hai khung vịt**: khung A phải vẽ **đục hoàn toàn** rồi khung B chồng lên theo tỉ lệ hoà. Vẽ cả hai ở độ đục một nửa thì nền lọt qua cả hai lớp và con vịt thành trong suốt.
- **Canvas phải đục hoàn toàn.** Bản cũ cho `.pond-gl` mờ dần từ `opacity: 0` để chồng lên ảnh tĩnh. Giờ không còn ảnh tĩnh, mà nền `linear-gradient` của `.pond` lại lọt qua canvas bán trong suốt và trộn vào — làm sai màu toàn cảnh (đo được canvas ở 36% độ đục thì lá xanh `(132,191,47)` ra `(76,126,77)`). Đừng đặt lại `opacity` cho canvas.
- **Cắt thân vịt theo mực nước**: nửa chìm phải cắt **cứng** tại mực nước, chỉ nửa nổi mới hoà mềm. Chia alpha tuyến tính cho cả hai rồi chồng lên nhau thì nền vẫn lọt qua `(1−ao)(1−au)`, đỉnh điểm 25% ngay giữa dải.
- **Phần "nhìn qua lớp nước" của vịt nướng sẵn vào ảnh** (`assets.js` → `bake`), không tính trong shader. Lý do: mực nước khác nhau theo từng cột, mà shader chỉ biết mép trên của ảnh đã xén — tức cột nông nhất. Shader chỉ còn lo khúc xạ và vệt sáng, hai thứ thay đổi theo thời gian.
- **Đừng tăng số khung ảnh turntable.** Các khung trong file AI do AI sinh riêng từng cái, mỗi khung lệch khỏi quỹ đạo chuẩn trung bình 11 px (cá biệt 32 px). Sai số đó cố định, không giảm khi thêm khung, trong khi bước dịch thì nhỏ dần: ở 24 khung nhiễu chiếm 26% bước, lên 48 khung là 53%, lên 72 khung là 79% — tức càng thêm khung càng giật. Đó là lý do chuyển sang dựng 3D.
- **Màu nạp vào shader phải đổi sang tuyến tính trước.** Bảng màu trong `config.js` là mã sRGB đọc từ tranh; shader làm việc tuyến tính rồi mã hoá lại khi xuất, nạp thẳng mã sRGB vào là màu bị đẩy sáng hai lần — `(127,127,127)` hoá thành `186` và tương phản nổi/chìm bị nén mất.
- **Thứ làm thân vịt trông "đang ở dưới nước" là CHUYỂN ĐỘNG, không phải màu.** Hoạ sĩ đã vẽ sẵn phần chìm xỉn màu rồi; nhuộm thêm nặng tay thì thân vịt thành quả trứng nhựa, mất sạch nét vẽ. Cái bán được cảm giác chìm là nó phải lay động theo mặt nước, và ngay mép nước thì phần chìm lệch hẳn đi so với phần nổi (như ống hút cắm trong cốc nước). Shader của vịt phải cộng **sóng nền** (`AMBIENT_WAVES`) vào độ dốc, không chỉ lấy từ lưới mô phỏng — lưới chỉ gợn khi có người chạm hoặc vịt bơi, nên lúc ao yên thân vịt sẽ đứng chết cứng.
- **Gân lá nằm trong layer `cuong la N`, không phải `la N`** — và trong file AI layer `cuong` nằm TRÊN layer `la`. `assets.js` → `splitStem` tách theo hình lá: nét trong lòng lá là gân (vẽ đè lên lá, cùng độ cao z để thị sai không làm nó trượt), nét thò ra ngoài là cuống (chìm dưới nước, vẽ sau lá, ngả màu nước).
- **Hoà hình hai khung vịt phải làm TRONG MỘT LƯỢT VẼ** (`ducks.js` → `frameAt` + `mix`). Vẽ thành hai lớp chồng nhau thì viền của khung dưới luôn thò ra ở chỗ khung trên không che, con vịt trông như bị tách làm đôi — rõ nhất ở chân.
- **Không gọi `texture2D` trong nhánh rẽ.** GLSL ES không định nghĩa đạo hàm khi đó, GPU chọn sai mức mipmap và trả về một mảng mờ phủ kín tấm lưới, lộ nguyên khung chữ nhật. Lấy mẫu vô điều kiện rồi nhân với mặt nạ `step()`.
- **Ảnh nửa chìm phải có lề** (`UNDER_PAD`, lớn hơn `DUCKS.underRefract`) và shader phải bỏ điểm lấy mẫu ra ngoài `[0,1]`. Không thì `ClampToEdge` lặp điểm ảnh ngoài rìa thành vệt dài, lộ nguyên khung chữ nhật.
- Vịt bơi gần như liên tục nên sóng sau đuôi là **nguồn sóng thường trực** — để mạnh tay là cả mặt ao đầy vòng sóng chồng chéo. Các số liên quan: `DUCKS.wakeGain/wakeEvery/wakeMinSpeed`, `SIM.damp`, `uFocus` trong `water.js`, và biên độ các bước sóng ngắn trong `AMBIENT_WAVES` (bước sóng càng ngắn thì độ cong càng lớn, mà sáng tối lại tính theo độ cong).

Các skill `.claude/skills/threejs-*` viết theo three r160. Khi code mẫu trong skill khác với file này thì làm theo file này.

## Phiên bản: three r186 (0.186.0)

- Nạp three bằng import map, không dùng `<script src=".../three.min.js">`:

  ```html
  <script type="importmap">
  {
    "imports": {
      "three": "https://cdn.jsdelivr.net/npm/three@0.186.0/build/three.module.js",
      "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.186.0/examples/jsm/"
    }
  }
  </script>
  ```

- Import addon từ `three/addons/...`, không dùng `three/examples/jsm/...`.
- Khi không chắc một API thì xem các link tài liệu trong hướng dẫn chính thức bên dưới và Migration Guide: https://github.com/mrdoob/three.js/wiki/Migration-Guide

## Hướng dẫn chính thức của three.js cho AI

Bản lưu của https://threejs.org/docs/llms.txt (tải ngày 2026-10-02). Muốn cập nhật thì chạy `curl -o docs/threejs-llms.txt https://threejs.org/docs/llms.txt`.

@docs/threejs-llms.txt

## API đã đổi so với skill

| Trong skill (r160) | Dùng thay thế | Đổi từ bản |
|---|---|---|
| `THREE.Clock` | `THREE.Timer` (đã có sẵn trong core, gọi `timer.update(time)` mỗi frame) | r183 |
| `RGBELoader` | `HDRLoader` từ `three/addons/loaders/HDRLoader.js` | r180 |
| `PCFSoftShadowMap` | `PCFShadowMap` (giờ đã mềm sẵn) | r182 (WebGL), bị xóa ở r186 (WebGPU) |
| URL CDN có `three@0.160.0` | `three@0.186.0` | — |

```js
const timer = new THREE.Timer();
renderer.setAnimationLoop((time) => {
  timer.update(time);
  const delta = timer.getDelta();
  // ...
  renderer.render(scene, camera);
});
```

## Renderer

- Mặc định dùng `WebGLRenderer` (`import * as THREE from 'three'`).
- Chỉ dùng `WebGPURenderer` khi cần TSL hoặc compute shader: `import * as THREE from 'three/webgpu'`, gọi `await renderer.init()` trước khi render. Viết shader bằng TSL (`three/tsl`) với NodeMaterial (`MeshStandardNodeMaterial`...), không dùng GLSL `ShaderMaterial`.

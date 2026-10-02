# web-test-duck-duck

Dự án web 3D dùng three.js: trang tìm kiếm "Ao Vịt" (`index.html`). Ao vịt tương tác tràn toàn màn hình (mép mờ ra bốn cạnh), tên trang + ô tìm kiếm nằm trên khung kính mờ phía trên: lá sen trôi trái → phải theo vòng lặp, kéo/ném được; sóng nước mô phỏng lan truyền thật. Điện thoại (màn dọc) dùng khung dọc theo ảnh gốc.

## Chạy và cấu trúc

- Chạy local: `npx -y serve .` rồi mở `http://localhost:3000`. Mở thẳng file (`file://`) thì trình duyệt chặn ES module và đọc pixel ảnh, nên đoạn script cuối `index.html` không nạp `js/main.js` mà chỉ hiện ảnh tĩnh kèm lời nhắc.
- Cờ URL: `?static` (chỉ ảnh tĩnh), `?nogl` (ép không WebGL), `?freeze` (dừng thời gian), `?debug` (vẽ đè lưới sóng / vùng che), `?test` (lộ `window.__pond` để thử tự động).
- `images-duck/`: 16 lớp PNG gốc 1080×1620, không sửa. Thứ tự xếp ghi trong `images-duck/DOC_ME.txt`.
- `js/pond/config.js` chứa mọi hằng số. Khung nhìn tính theo cỡ màn hình ở `computeView` (`LAYOUT`: khối vịt là mốc; màn ngang vịt cao 58% màn hình, màn dọc bề ngang = 1000 px ảnh). `css/style.css` (`.pond-static`, dùng `cqw`/`cqh`) lặp lại đúng công thức này để ảnh tĩnh khớp cảnh 3D — sửa một bên thì sửa cả bên kia.
- Mặt nạ bờ ao là `--pond-mask` trong `css/style.css` (SVG nhúng dạng data URI, bản ngang và bản dọc theo `orientation`); `js/pond/scene.js` đọc lại `path#pond` + `viewBox` từ đó.
- Ao rộng hơn ảnh gốc: `buildWater` (`assets.js`) lặp lại nền nước theo chiều ngang (bản lẻ lật ngang, dịch dọc, mép nối hoà 200 px), soi gương theo chiều dọc. Nền nước đã được tô lấp chỗ lá/vịt gốc (`inpaintWater`, pull-push).
- `js/pond/`: `assets.js` (cắt lớp, tách cuống/mặt lá, chia nét sóng, tô lấp và nối dài nền nước), `watersim.js` (lưới sóng CPU, cỡ ô theo độ phóng), `water.js` (shader nước), `leaves.js`, `ducks.js`, `drops.js`, `scene.js` (renderer, camera chiếu lệch tâm, vòng lặp, dựng lại khi đổi cỡ màn hình), `input.js`.
- Lá trôi là bản nhân của `02_la_sen_2.png` (lá duy nhất còn nguyên); các lá gốc khác bị cắt mép nên chỉ dùng ở ảnh tĩnh. Thêm PNG lá nguyên vẹn vào `LEAF_TEMPLATES` để có thêm mẫu.

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

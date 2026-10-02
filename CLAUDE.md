# web-test-duck-duck

Dự án web 3D dùng three.js.

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
- Khi không chắc một API thì đọc https://threejs.org/docs/llms.txt và Migration Guide: https://github.com/mrdoob/three.js/wiki/Migration-Guide

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

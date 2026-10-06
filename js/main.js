// Khởi động ao vịt tràn màn hình. File này được nạp từ đoạn script cuối index.html,
// chỉ khi trang mở qua http(s) — vì manifest và pixel ảnh đều bị chặn trên file://.

const params = new URLSearchParams(location.search);
const pondEl = document.getElementById('pond');
const canvas = document.getElementById('pond-gl');

function fallback(reason) {
  document.body.classList.add('nogl');
  if (reason) console.warn('[Ao Vịt] Không dựng được cảnh 3D:', reason);
}

async function boot() {
  if (params.has('static') || params.has('nogl')) return fallback('');
  try {
    const [{ Pond }, { PondInput }] = await Promise.all([
      import('./pond/scene.js'),
      import('./pond/input.js'),
    ]);
    // Bản dịu chỉ bật bằng cờ ?calm, KHÔNG theo prefers-reduced-motion: Windows tắt "Animation effects" là Chrome
    // báo reduce, ao mất sóng sau đuôi vịt, vẫy đuôi, rũ nước… — chủ dự án thấy máy mình khác máy người khác.
    const reduceMotion = params.has('calm');
    const pond = await Pond.create(pondEl, canvas, {
      reduceMotion,
      freeze: params.has('freeze'),
      debug: params.has('debug'),
    });
    new PondInput(pond, pondEl);
    if (params.has('debug') || params.has('test')) window.__pond = pond;
  } catch (err) {
    fallback(err);
  }
}

boot();

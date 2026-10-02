// Khởi động trang: phím tắt cho ô tìm kiếm và ao vịt tràn màn hình (nếu máy hỗ trợ WebGL).
// File này được nạp từ đoạn script cuối index.html, chỉ khi trang mở qua http(s).

const params = new URLSearchParams(location.search);
const input = document.getElementById('q');
const pondEl = document.getElementById('pond');
const canvas = document.getElementById('pond-gl');

// "/" đưa con trỏ vào ô tìm kiếm (trừ khi đang gõ ở ô khác)
document.addEventListener('keydown', (e) => {
  if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable) return;
  e.preventDefault();
  input.focus();
  input.select();
});

function fallback(reason) {
  document.body.classList.add('nogl');
  if (reason) console.warn('[Ao Vịt] Hiển thị ảnh tĩnh:', reason);
}

async function boot() {
  if (params.has('static') || params.has('nogl')) return fallback(params.has('nogl') ? 'nogl' : '');
  try {
    const [{ Pond }, { PondInput }] = await Promise.all([
      import('./pond/scene.js'),
      import('./pond/input.js'),
    ]);
    const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
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

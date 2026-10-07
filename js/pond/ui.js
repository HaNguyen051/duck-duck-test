// Nút thêm / bớt vịt (2026-10-07). Trang không có chữ nên nút chỉ là biểu tượng: con vịt kèm dấu + / −, tròn trong
// như bong bóng, ở góc dưới phải (chừa vùng an toàn tai thỏ / thanh home của iPhone). Nhãn cho trình đọc màn hình nằm
// trong aria-label, không hiện ra. Hết số (1 con hoặc tối đa) thì nút mờ đi và không bấm được.
const duck = `<path d="M7 19c0-4.4 3.6-7 8.5-7 1.3 0 2.5.2 3.5.6.5-2.6 2.5-4.6 5-4.6 2.6 0 4.5 2 4.5 4.4 0 1.3-.5 2.4-1.4 3.2
  .9 1 1.4 2.3 1.4 3.6C28.5 23.8 24 27 17.5 27 11.6 27 7 24.2 7 19z" fill="currentColor" opacity=".92"/>
  <circle cx="24.6" cy="11.8" r="1.1" fill="#16384a"/>
  <path d="M28.6 12.4l3 .9-3 1.1z" fill="#f59a3a"/>`;
const badge = (minus) => `<circle cx="9" cy="9" r="7" fill="#f59a3a"/>
  <path d="M5.5 9h7${minus ? '' : 'M9 5.5v7'}" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/>`;
const icon = (minus) => `<svg viewBox="0 0 34 32" width="30" height="28" aria-hidden="true">${duck}${badge(minus)}</svg>`;

export function createDuckControls(pond) {
  const box = document.createElement('div');
  box.className = 'duck-ctl';
  const make = (minus, label, act) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'duck-btn';
    b.setAttribute('aria-label', label);
    b.innerHTML = icon(minus);
    // pointerdown: mở âm thanh ngay trong cử chỉ (như chạm ao); không cho sự kiện lọt xuống ao bên dưới
    b.addEventListener('pointerdown', (e) => { e.stopPropagation(); pond.audio?.unlock(); });
    b.addEventListener('click', (e) => { e.stopPropagation(); act(); });
    box.appendChild(b);
    return b;
  };
  const minus = make(true, 'Bớt một con vịt', () => pond.removeDuck());
  const plus = make(false, 'Thêm một con vịt', () => pond.addDuck());
  const sync = (n, max) => { minus.disabled = n <= 1; plus.disabled = n >= max; };
  pond.onDuckCount = sync;
  sync(pond.duckCount, pond.maxDucks);
  if (!pond.assets.duck.model) box.hidden = true; // không nạp được vịt thì không có gì để thêm
  document.body.appendChild(box);
  return box;
}

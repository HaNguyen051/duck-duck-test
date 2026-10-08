# Ao Vịt — tổng hợp lớp giao diện (bản chốt 2026-10-07)

Tài liệu này gom mọi thay đổi đã làm trên bản sao của repo `duck-duck-test` (gốc: commit `89cc995`), để đưa về repo thật.
Bản chạy thử: artifact "Duck Pond" (cùng nội dung với các file dưới đây).

## 1. Đưa về repo: hai cách

**Cách nhanh — áp patch** (đã thử: áp sạch lên `89cc995`):

```bash
git apply --binary duck-pond-interface.patch
```

**Cách tay — chép file** từ `duck-pond-interface.zip` đè lên gốc repo.

Nếu repo thật đã đi xa hơn `89cc995`, chỗ dễ đụng nhất là `js/main.js` (3 dòng) và `index.html` (phần `<head>`); bốn file còn lại là file mới.

## 2. Danh sách file

| File | Trạng thái | Nội dung |
|---|---|---|
| `js/pond/shell.js` | mới | Toàn bộ giao diện: dựng DOM, nối nút với ao. Export `createShell(pond)`. |
| `css/shell.css` | mới | Toàn bộ style của giao diện, kèm `@font-face` Bootzy. |
| `fonts/Bootzy_TM.otf` | mới | Font tiêu đề (file bạn đưa). |
| `icons/fish.png` | mới | Ảnh cá góc trên trái — **cắt từ ảnh chụp tham chiếu, 160 px, cần thay bằng file gốc**. |
| `index.html` | sửa | `lang="en"`, `<title>` mới, thêm link Google Fonts (Inter) và `css/shell.css`. |
| `js/main.js` | sửa | Nạp `./pond/shell.js` thay `./pond/ui.js`; gọi `createShell(pond)` thay `createDuckControls(pond)`. |
| `CLAUDE.md` | sửa | Thêm một mục mô tả `shell.js`. |
| `js/pond/ui.js` | giữ nguyên | Không còn được nạp. Xoá hay giữ tuỳ bạn. |

Không file nào khác của ao bị đụng: `scene.js`, `water.js`, `ducks.js`, `assets.js`, `config.js`… đều nguyên bản.

## 3. Nguyên tắc dựng

- `.shell` là một lớp `position: fixed; inset: 0; z-index: 3` nằm **trên** `#pond`, đặt `pointer-events: none`; chỉ các điều khiển bật lại `pointer-events: auto`. Nhờ vậy mọi cú chạm không rơi vào nút vẫn xuống ao (kéo vịt, tạo sóng, nổ bóng, nghiêng cảnh theo chuột).
- `shell.js` chỉ gọi API công khai của `Pond`, không sửa shader hay vòng lặp.
- Toàn bộ chữ trên màn hình nằm ở `const COPY` đầu `shell.js`.
- Mọi nút dùng `data-act="..."` (hành động, bảng `ACTS`) hoặc `data-set="..." data-val="..."` (thiết lập, bảng `SETTERS`); một listener `click` và một listener `input` trên `.shell` xử lý hết.

## 4. Bố cục (theo ảnh tham chiếu của bạn)

| Vị trí | Thành phần | Class |
|---|---|---|
| Trên trái | Ảnh cá 40×40, bo 9px | `.mark` |
| Trên giữa | Nút "Customize" (pill) | `.pill-btn[data-act=customize]` |
| Dưới nút Customize | Bảng Customize thả xuống, rộng 380px; điện thoại: tấm trượt đáy | `.panel` |
| Trên phải | Cột 5 nút tròn 36px, cách nhau 16px | `.rail` > `.tool` |
| Dưới trái | Tiêu đề + phụ đề | `.hero` > `h1`, `.hero-sub` |
| Dưới phải | Viên thuốc viền trắng `+ Duck −` | `.shell > .counter` |
| Dưới trái (khi ẩn giao diện) | Nút "Show the interface" | `.restore` |

## 5. Thông số chữ và màu

**Tiêu đề** (`.hero h1`)
- Nội dung mặc định: `Just daily view` / `of a tiny fish` (hai dòng, `\n` trong `COPY.title`, giữ nhờ `white-space: pre-line`).
- Font Bootzy, `line-height: .8`, `letter-spacing: .01em`.
- Cỡ: `clamp(44px, min(8.33vw, 18vh), 120px)` → 120px từ màn 1440px trở lên, co theo bề ngang và theo chiều cao ở cửa sổ thấp.
- Điện thoại (≤640px): `clamp(40px, 13.5vw, 72px)` (≈53px trên máy 390px).
- `pointer-events: none` (cả `.hero`): chữ không chặn thao tác với ao.

**Phụ đề và chữ trên nút** — dùng chung biến `--text: clamp(14px, 1.26vw, 20px)` (18px ở 1440px): `.hero-sub`, `.pill-btn`, `.count-label`. Font Inter 400.
- Phụ đề: "Bottom view looking up. Drag a duck, tap the surface, pop the bubbles or just do anything you want!", `max-width: min(46ch, 100% − 230px)`.

**Màu** (biến ở `:root` trong `shell.css`)
- `--frost: rgba(104,122,128,.52)` — nền mọi nút; `--frost-strong` khi hover; `--frost-panel: rgba(58,78,86,.66)` cho bảng.
- `--blur: blur(14px) saturate(1.15)` (backdrop-filter).
- Chữ trắng; mục đang chọn: nền trắng, chữ `--on-white: #17333c` (bản artifact tên là `--ink`, đè lên `--ink` của `style.css` — đổi tên khi đưa về repo 2026-10-08; `--line` cũng đổi thành `--hairline` vì cùng lý do).
- `--well: rgba(20,40,48,.3)` — rãnh lõm trong bảng (segmented, ô nhập).
- `--pad: clamp(16px, 2vw, 30px)` — lề; có cộng `env(safe-area-inset-*)`.

## 6. Tính năng và cách nối vào ao

**Cột nút công cụ (trên phải)**

| Nút | `data-act` | Làm gì |
|---|---|---|
| Mưa | `rain` | 12 điểm ngẫu nhiên trong vùng mặt nước (`pond.inPond`), mỗi điểm `pond.drop(x, y)` + `pond.audio.touch()`, rải cách nhau ~130ms. |
| Nổ hết bóng | `pop-all` | Duyệt `pond.bubbles.items` + `.taps` đang `live`, gần trước xa sau, mỗi bóng `bubbles.pop(b, 1.35)` + `audio.pop()`, cách nhau 90ms. |
| Tắt/bật tiếng | `sound` | `pond.audio.master.gain` về 0 / `AUDIO.master`; đổi icon và `aria-pressed`. |
| Toàn màn hình | `full` | `requestFullscreen` / `exitFullscreen`; nút tự ẩn nếu trình duyệt không hỗ trợ. |
| Ẩn giao diện | `hide` | Thêm `body.ui-hidden`: ẩn hết, chỉ còn nút "Show the interface". Phím Esc cũng hiện lại. |

**Bộ đếm vịt `+ Duck −`** — `pond.addDuck()` / `pond.removeDuck()`; `pond.onDuckCount` gọi `syncCount` để mờ nút khi chạm 1 con hoặc tối đa. Nhãn "Duck" tĩnh; số con chỉ hiện trong Customize. **Ẩn ở màn ≤640px** (trên điện thoại thêm/bớt vịt trong Customize).

**Bảng Customize** (dựng lại mỗi lần mở, từ `state`)

| Dòng | `data-set` | Cách làm |
|---|---|---|
| Title | `title` | `<textarea>` 2 dòng, tối đa 80 ký tự → ghi vào `h1`. Lưu `localStorage` khoá `ao-vit-title-4` (chỉ trên máy người xem). Để trống = về mặc định. **Đổi `COPY.title` thì tăng số ở khoá** để ai cũng thấy tiêu đề mới. |
| Ducks | — | Bộ đếm thứ hai, có hiện số. |
| Swimming pace | `speed` | Lazy 0.55 / Easy 1 / Zippy 1.9 → `DUCKS.speed = gốc × m` và `pond.ducks.speed = DUCKS.speed × pond.objScale`. |
| Water | `calm` | Lively / Calm → `pond.reduceMotion`, `pond.ambGain = (calm ? .35 : 1) × AMBIENT_GAIN`, rồi `pond.teardown(); pond.build()`. Vịt về vị trí mới sau khi dựng lại. |
| Light | `light` | Noon / Golden hour / Dusk → `body[data-light]`; lớp `.pond-tint` chèn trong `#pond` phủ màu bằng `mix-blend-mode`. Thuần CSS, không đụng ảnh nền hay shader. |
| Music | `music` | Thanh trượt 0–1.6 → `AUDIO.music = gốc × v` và `audio.music.gain`. |
| Quacks, pops and splashes | `sfx` | On / Off → `audio.sfx.gain`. |
| Reset to how it started | `data-act=reset` | Trả mọi thứ ở trên về mặc định, kể cả tiêu đề. |

Các thiết lập (trừ tiêu đề) mất khi tải lại trang.

## 7. Responsive

- **≤640px**: bảng Customize thành tấm trượt đáy (cao tối đa 62%); ẩn `+ Duck −`; tiêu đề + phụ đề nằm sát đáy; ẩn tooltip; khi bảng mở thì ẩn `.hero`.
- **Cửa sổ thấp (≤520px cao, ngang >640px)**: ẩn phụ đề, cột nút xoay thành hàng ngang.
- `prefers-reduced-motion`: tắt chuyển động của giao diện (không ảnh hưởng ao).

## 8. Việc còn mở

1. **Ảnh cá** `icons/fish.png` là bản cắt từ ảnh chụp — thay bằng file gốc (giữ tên, hoặc sửa `COPY.icon`).
2. **Bootzy không có dấu tiếng Việt**: ký tự có dấu gõ vào tiêu đề sẽ rơi về font dự phòng.
3. **Giấy phép Bootzy** cho web: file `.otf` nằm công khai trong repo GitHub Pages — kiểm tra giấy phép có cho nhúng web không.
4. **Năm nút tròn** trong ảnh tham chiếu để trống; bản này đặt icon trắng 18px bên trong.
5. Chưa thử trên máy thật: âm thanh (nghe bằng tai), thao tác chạm trên điện thoại, và Safari iOS. Đã thử bằng Chromium ở 1440×900, 1024×640, 390×844.
6. `index.html` đổi `lang` sang `en` và `<title>` thành "Ao Vịt, a duck pond seen from below" — đổi lại nếu muốn.

## 9. Đã thử rồi bỏ (không có trong bản chốt)

- Thanh tab Pond / Ducks / Water / Bubbles và các bảng thông tin — bỏ theo yêu cầu.
- Tên "Ao Vịt, the duck pond" góc trên trái — bỏ.
- **Ba ảnh nền Morning / Sunset / Night** (đổi `uBg` + `uFoliage` của mặt nước, nhuộm vịt qua `uTint`, thêm `loadBackground()` vào `assets.js`) — đã làm chạy được rồi quay lại bản tint CSS theo yêu cầu. Nếu muốn dùng lại: hai ảnh mới là tranh vòm cây thô, chưa nướng 9 lớp mặt nước như `bg.webp`, nên trông "ít nước" hơn bản Morning.
- Sửa tiêu đề bằng cách bấm thẳng vào chữ (`contenteditable`) — chuyển sang ô Title trong Customize để chữ không chặn thao tác với ao.
- Font Fraunces + Be Vietnam Pro, màu nhấn cam, kính xanh đậm — thay bằng Bootzy + Inter, kính xám.

// Page "Phòng & màn hình": lobby screen, room cards with screen status, and one room's settings with preview.

import { EFFECTS, ORIENTATIONS, EMPTY_DAYS, SKYLINES, S, h, api, toast, fail, dm, today, options, card, field, showErrors, confirmDelete, copyText, displaySummary, route } from './admin-core.js';

// ---------- Phòng & màn hình ----------

async function pageRooms(app) {
  const [rooms, themes, lobby] = await Promise.all([api('GET', '/api/rooms'), api('GET', '/api/themes'), api('GET', '/api/lobbyinfo')]);
  app.replaceChildren(h('div', { class: 'stack' }, lobbyCard(lobby), roomsCard(rooms, themes.items)));
  // Keep the online/offline dots current while the page is open.
  S.timer = setTimeout(() => { if (location.hash === '#/phong') route(); }, 30000);
}

// The lobby screen shows every room with meetings left today, one after another, in the global look.
function lobbyCard(lobby) {
  const st = screenStatus(lobby);
  return h('section', { class: 'card room-card lobby-card' },
    h('div', { class: 'row between' },
      h('div', { class: 'row' }, h('span', { class: 'chip room' }, 'SẢNH'), h('strong', { class: 'room-name' }, 'Màn hình sảnh – tất cả phòng')),
      st.chip),
    h('p', { class: 'card-hint' },
      'Chiếu lần lượt các phòng còn cuộc họp hôm nay (hết các trang của phòng này thì sang phòng khác); phòng không còn lịch được bỏ qua. ',
      'Dùng giao diện chung ở tab Giao diện. Trong app, chọn “Tất cả phòng”.'),
    st.lines.length > 0 && h('div', { class: 'screens' }, st.lines),
    h('div', { class: 'copies' },
      copyRow('Địa chỉ cho app', new URL(lobby.screenUrl).host),
      copyRow('Link Fully Kiosk', lobby.screenUrl)),
    h('div', { class: 'row' }, h('a', { class: 'btn small', href: lobby.screenUrl, target: '_blank', rel: 'noopener' }, 'Mở màn hình sảnh')));
}

function roomsCard(rooms, themes) {
  const online = rooms.reduce((n, r) => n + (r.screens || []).filter(s => s.online).length, 0);
  return card('Phòng họp & màn hình', null,
    h('div', { class: 'row between' },
      h('p', { class: 'card-hint' }, `${rooms.length} phòng · ${online} màn hình đang chạy. Trạng thái tự cập nhật mỗi 30 giây.`),
      h('a', { class: 'btn primary', href: '#/phong/moi' }, '+ Thêm phòng')),
    !rooms.length ? h('p', { class: 'muted' }, 'Chưa có phòng nào.') : h('div', { class: 'room-grid' }, rooms.map(r => roomCard(r, themes))),
    h('p', { class: 'small muted' },
      'App “Lịch họp Xuân Hòa” tự tìm máy chủ trong mạng; nếu không thấy thì nhập “Địa chỉ cho app”. ',
      'Fully Kiosk Browser thì nhập “Link Fully Kiosk” của phòng.'));
}

const hmOf = s => s.slice(11, 16);

// Overall chip plus one line per screen that fetched this room's schedule in the last day.
function screenStatus(r) {
  const list = r.screens || [];
  const on = list.filter(s => s.online).length;
  const chip = on ? h('span', { class: 'chip ok' }, `● ${on} màn hình đang chạy`)
    : list.length ? h('span', { class: 'chip cancelled' }, '● Mất kết nối')
    : h('span', { class: 'chip' }, 'Chưa có màn hình kết nối');
  const lines = list.map(s => h('div', { class: 'screen-line small' },
    h('span', { class: 'dot ' + (s.online ? 'on' : 'off'), 'aria-hidden': 'true' }),
    h('span', { class: 'mono' }, s.ip),
    h('span', { class: 'muted' }, s.client === 'apk' ? 'App Android' : 'Trình duyệt / Fully Kiosk'),
    h('span', { class: s.online ? '' : 'error-text' }, s.online ? 'đang chạy' : `mất kết nối từ ${hmOf(s.lastSeen)} ${dm(s.lastSeen.slice(0, 10))}`)));
  return { chip, lines };
}

function copyRow(label, value) {
  return h('div', { class: 'copy-row' },
    h('span', { class: 'small muted' }, label),
    h('code', { class: 'small' }, value),
    h('button', { class: 'btn small', type: 'button', onclick: () => copyText(value) }, 'Sao chép'));
}

function roomCard(r, themes) {
  const own = displaySummary(r.display, themes);
  const st = screenStatus(r);
  return h('article', { class: 'room-card' },
    h('div', { class: 'row between' },
      h('div', { class: 'row' }, h('span', { class: 'chip room mono' }, r.code), h('strong', { class: 'room-name' }, r.name)),
      st.chip),
    h('div', { class: 'row small' },
      h('span', null, r.todayCount ? `Hôm nay ${r.todayCount} cuộc họp` : 'Hôm nay không có lịch'),
      h('span', { class: 'chip' + (own ? ' room' : '') }, own ? 'Giao diện riêng · ' + own : 'Giao diện theo chung')),
    h('div', { class: 'small muted' }, 'Địa điểm khớp trong Excel: ' + (r.places.join('; ') || '—')),
    st.lines.length > 0 && h('div', { class: 'screens' }, st.lines),
    h('div', { class: 'copies' },
      copyRow('Địa chỉ cho app', new URL(r.screenUrl).host),
      copyRow('Link Fully Kiosk', r.screenUrl)),
    h('div', { class: 'row' },
      h('a', { class: 'btn small', href: '#/phong/' + encodeURIComponent(r.code) }, 'Sửa & xem trước'),
      h('a', { class: 'btn small', href: r.screenUrl, target: '_blank', rel: 'noopener' }, 'Mở màn hình'),
      h('button', { class: 'link danger', type: 'button', style: 'margin-left:auto', onclick: () => deleteRoom(r) }, 'Xoá phòng')));
}

async function deleteRoom(r) {
  if (!confirmDelete(`phòng ${r.code} – ${r.name}. Các cuộc họp vẫn giữ, nhưng không hiện lên màn hình nào cho đến khi địa điểm được gán lại`)) return;
  try { await api('DELETE', '/api/rooms/' + encodeURIComponent(r.code)); toast('Đã xoá phòng.'); location.hash = '#/phong'; route(); } catch (e) { fail(e); }
}

// ---------- Cấu hình một phòng ----------

async function pageRoom(app, code) {
  const [rooms, settings, themes] = await Promise.all([api('GET', '/api/rooms'), api('GET', '/api/settings'), api('GET', '/api/themes')]);
  const isNew = code === 'moi';
  const room = isNew ? { code: '', name: '', places: [], display: {} } : rooms.find(r => r.code === code);
  if (!room) throw new Error(`Không có phòng mã “${code}”.`);
  const g = settings.display;
  const own = room.display || {};

  const codeInput = h('input', { type: 'text', 'data-field': 'code', value: room.code, readOnly: !isNew, maxLength: 32, class: 'mono',
    placeholder: 'Ví dụ: P201', required: true });
  const name = h('input', { type: 'text', 'data-field': 'name', value: room.name, maxLength: 100, required: true, placeholder: 'Ví dụ: Phòng họp tầng 2' });
  const places = h('textarea', { rows: 3, 'data-field': 'places', value: room.places.join('\n'), placeholder: 'Mỗi dòng một tên, ví dụ:\nPhòng họp số 2\nPH tầng 2' });

  // Each override is a select whose first option means "inherit the global value".
  const textOf = (pairs, v) => (pairs.find(p => p[0] === v) || [v, v])[1];
  const onOff = [['true', 'Hiện'], ['false', 'Ẩn']];
  const yesNo = [['true', 'Bật'], ['false', 'Tắt']];
  const themePairs = themes.items.map(t => [t.id, t.name]);
  const defs = [
    ['theme', 'Mẫu giao diện', themePairs, g.theme],
    ['orientation', 'Màn hình đứng hay ngang', ORIENTATIONS, g.orientation],
    ['effect', 'Hiệu ứng chuyển cảnh', EFFECTS, g.effect],
    ['emptyDay', 'Khi hết lịch trong ngày, hiện', EMPTY_DAYS, g.emptyDay],
    ['skyline', 'Hình đường chân trời', SKYLINES, g.skyline || 'normal'],
    ['clock', 'Đồng hồ', onOff, String(g.clock)],
    ['footer', 'Chân trang', onOff, String(g.footer)],
    ['reduceMotion', 'Giảm chuyển động', yesNo, String(g.reduceMotion)],
    ['hideCursor', 'Ẩn con trỏ chuột', yesNo, String(g.hideCursor)],
  ];
  const selects = {};
  const rows = defs.map(([key, label, pairs, global]) => {
    const value = own[key] == null ? '' : String(own[key]);
    const tag = h('span', { class: 'chip' });
    const sel = h('select', { 'data-field': 'display.' + key, 'aria-label': label, style: 'max-width:320px' },
      h('option', { value: '', selected: value === '' }, `Theo cấu hình chung (${textOf(pairs, global)})`),
      options(pairs, value));
    const sync = () => { const mine = sel.value !== ''; tag.textContent = mine ? 'Riêng phòng' : 'Theo chung'; tag.className = 'chip' + (mine ? ' room' : ''); };
    sel.addEventListener('change', sync);
    sync();
    selects[key] = sel;
    return h('div', { class: 'row', style: 'padding:10px 0;border-top:1px solid var(--line)' },
      h('div', { class: 'grow' }, h('strong', null, label), h('div', { class: 'small muted' }, 'Cấu hình chung: ' + textOf(pairs, global))),
      tag, sel);
  });
  // A text override: "use the global text" or this room's own text (which may be empty on purpose).
  const textOverride = (key, label, fieldLabel, placeholder) => {
    const mode = h('select', { 'aria-label': label, style: 'max-width:320px' },
      h('option', { value: '', selected: own[key] == null }, `Theo cấu hình chung (${g[key] || 'không có'})`),
      h('option', { value: 'own', selected: own[key] != null }, 'Dùng nội dung riêng của phòng'));
    const input = h('input', { type: 'text', 'data-field': 'display.' + key, value: own[key] || '', maxLength: 200, placeholder });
    const box = field(fieldLabel, input);
    const sync = () => box.classList.toggle('hidden', mode.value === '');
    mode.addEventListener('change', sync);
    sync();
    return {
      nodes: [h('div', { class: 'row', style: 'padding:10px 0;border-top:1px solid var(--line)' },
        h('div', { class: 'grow' }, h('strong', null, label)), mode), box],
      reset: () => { mode.value = ''; sync(); },
      apply: display => { if (mode.value === 'own') display[key] = input.value.trim(); },
    };
  };
  const texts = [
    textOverride('footerNote', 'Ghi chú ở chân màn hình', 'Ghi chú riêng', 'Để trống để phòng này không hiện ghi chú'),
  ];

  const form = h('form', { class: 'stack' },
    h('div', { class: 'row between' },
      h('div', null, h('a', { class: 'small', href: '#/phong' }, '‹ Danh sách phòng'),
        h('h1', { class: 'page-title' }, isNew ? 'Thêm phòng' : `${room.code} – ${room.name}`),
        h('p', { class: 'card-hint' }, 'Mục nào để “Theo cấu hình chung” sẽ tự đổi khi cấu hình chung thay đổi.')),
      h('div', { class: 'row' },
        !isNew && h('a', { class: 'btn', href: room.screenUrl, target: '_blank', rel: 'noopener' }, 'Mở màn hình'),
        !isNew && h('button', { class: 'btn danger', type: 'button', onclick: () => deleteRoom(room) }, 'Xoá phòng'),
        h('button', { class: 'btn primary', type: 'submit' }, 'Lưu'))),
    h('div', { class: 'cols' },
      h('div', { class: 'main stack' }, ...cards()),
      !isNew && h('aside', { class: 'side stack preview-side' }, previewCard(room, (own.orientation || g.orientation) === 'portrait'))));

  function cards() { return [
    card('Thông tin phòng', null,
      h('div', { class: 'grid' }, field('Mã phòng', codeInput, isNew ? 'Chữ không dấu, số, - hoặc _. Không đổi được sau khi tạo.' : null), field('Tên hiển thị trên màn hình', name)),
      field('Địa điểm khớp trong Excel', places, 'Mỗi dòng một tên. Tên phòng luôn được tính là khớp. Không phân biệt hoa thường, khoảng trắng thừa.')),
    card('Giao diện riêng của phòng', null,
      h('div', { class: 'row between' },
        h('p', { class: 'card-hint' }, `Phòng này đang tuỳ chỉnh ${Object.keys(own).length} mục.`),
        h('button', { class: 'btn', type: 'button', onclick: () => { Object.values(selects).forEach(s => { s.value = ''; s.dispatchEvent(new Event('change')); }); texts.forEach(t => t.reset()); } },
          'Bỏ tuỳ chỉnh, dùng cấu hình chung')),
      rows,
      texts.map(t => t.nodes))]; }

  form.addEventListener('submit', async ev => {
    ev.preventDefault();
    const display = {};
    for (const [key, sel] of Object.entries(selects)) {
      if (sel.value === '') continue;
      display[key] = sel.value === 'true' ? true : sel.value === 'false' ? false : sel.value;
    }
    texts.forEach(t => t.apply(display));
    const body = { code: codeInput.value.trim(), name: name.value, places: places.value.split(/[\n;]/).map(x => x.trim()).filter(Boolean), display };
    try {
      if (isNew) await api('POST', '/api/rooms', body);
      else await api('PUT', '/api/rooms/' + encodeURIComponent(room.code), body);
      toast('Đã lưu phòng.');
      // Stay on the room so the preview shows the saved look.
      if (isNew) location.hash = '#/phong/' + encodeURIComponent(body.code.toUpperCase());
      else route();
    } catch (e) { showErrors(form, e); }
  });
  app.replaceChildren(form);
}

// The real screen page in a frame, scaled like the device. ?preview=1 keeps it out of the screen status list.
function previewCard(room, portrait) {
  const url = new URL(room.screenUrl);
  url.searchParams.set('preview', '1');
  const frame = h('iframe', { src: url.href, title: 'Xem trước màn hình ' + room.code, loading: 'lazy' });
  const st = screenStatus(room);
  return [
    h('section', { class: 'card' },
      h('div', { class: 'row between' }, h('h2', { class: 'card-title' }, 'Xem trước màn hình'),
        h('button', { class: 'btn small', type: 'button', onclick: () => { frame.src = frame.src; } }, 'Tải lại')),
      h('p', { class: 'card-hint' }, 'Đúng như màn hình thật đang hiện. Sau khi bấm Lưu, phần xem trước đổi theo ngay.'),
      h('div', { class: 'preview-frame' + (portrait ? ' portrait' : '') }, frame)),
    h('section', { class: 'card' },
      h('div', { class: 'row between' }, h('h2', { class: 'card-title' }, 'Màn hình đang kết nối'), st.chip),
      st.lines.length ? h('div', { class: 'screens' }, st.lines) : h('p', { class: 'small muted' }, 'Chưa có màn hình nào lấy lịch phòng này trong 24 giờ qua.'),
      h('div', { class: 'copies' }, copyRow('Địa chỉ cho app', new URL(room.screenUrl).host), copyRow('Link Fully Kiosk', room.screenUrl))),
  ];
}

export { pageRooms, pageRoom };
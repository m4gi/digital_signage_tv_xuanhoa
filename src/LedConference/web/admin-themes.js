// Page "mẫu giao diện" (#/mau/{id}): edit theme colors with a live preview and contrast check.

import { S, h, api, toast, fail, card, field, showErrors, confirmDelete, route, act } from './admin-core.js';

// ---------- Chỉnh mẫu giao diện ----------

const TOKEN_GROUPS = [
  ['Nền', [['bg1', 'Nền 1'], ['bg2', 'Nền 2']]],
  ['Chữ', [['ink', 'Chữ chính'], ['muted', 'Chữ phụ'], ['person', 'Tên người, tên đơn vị'], ['label', 'Nhãn (LỊCH HỌP…)'], ['num', 'Giờ và số']]],
  ['Nhấn', [['accent', 'Màu nhấn (ĐANG HỌP)'], ['onAccent', 'Chữ trên nền nhấn']]],
  ['Thẻ', [['card', 'Nền thẻ'], ['cardBorder', 'Viền thẻ']]],
  ['Hoạ tiết', [['dot', 'Màu chấm'], ['skyline', 'Màu hình đường chân trời']]],
];

function contrast(a, b) {
  const lum = hex => {
    const n = parseInt(hex.slice(1), 16);
    const c = [n >> 16 & 255, n >> 8 & 255, n & 255].map(x => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const [x, y] = [lum(a), lum(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

const isHex = v => /^#[0-9a-f]{6}$/i.test(v);
const rgba = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`; };

async function pageThemes(app, id) {
  const [themes, settings] = await Promise.all([api('GET', '/api/themes'), api('GET', '/api/settings')]);
  const current = themes.items.find(t => t.id === id) || themes.items.find(t => t.id === settings.display.theme) || themes.items[0];
  const draft = { ...current.tokens };

  const preview = h('div', { class: 'pv', role: 'img', 'aria-label': 'Xem trước màn hình với mẫu này' },
    h('div', { class: 'pv-sky' }),
    h('div', { class: 'pv-top' },
      h('div', null, h('div', { class: 'pv-org' }, `${settings.org.line1} ${settings.org.line2}`), h('div', { class: 'pv-room' }, 'Phòng họp tầng 1')),
      h('div', { class: 'pv-time' }, '09:47')),
    h('div', { class: 'pv-body' },
      h('div', { class: 'pv-card' }, h('span', { class: 'pv-pill' }, 'ĐANG HỌP'),
        h('div', { class: 'pv-title' }, 'Họp triển khai kế hoạch chuyển đổi số'),
        h('div', { class: 'pv-sub' }, 'Chủ trì: ', h('b', null, 'Phó Chủ tịch UBND'))),
      h('div', { class: 'pv-rows' }, [['10:00', 'Chuyển đổi số'], ['14:00', 'Tiếp công dân'], ['16:00', 'Cải cách hành chính']]
        .map(([t, n]) => h('div', { class: 'pv-row' }, h('b', null, t), n)))));
  const contrastBox = h('div');

  function refresh() {
    const ok = k => isHex(draft[k]) || /^rgba?\(/.test(draft[k] || '');
    for (const k of ['bg1', 'bg2', 'ink', 'muted', 'accent', 'onAccent', 'person', 'label', 'num', 'card', 'cardBorder'])
      if (ok(k)) preview.style.setProperty('--' + k, draft[k]);
    preview.style.setProperty('--angle', (Number(draft.bgAngle) || 0) + 'deg');
    if (isHex(draft.dot)) preview.style.setProperty('--dot', rgba(draft.dot, Number(draft.dotOpacity) || 0));
    if (isHex(draft.skyline)) preview.style.setProperty('--skyline', rgba(draft.skyline, Number(draft.skylineOpacity) || 0));
    if ([draft.ink, draft.bg1, draft.bg2].every(isHex)) {
      const ratio = Math.min(contrast(draft.ink, draft.bg1), contrast(draft.ink, draft.bg2));
      const text = ratio.toFixed(1).replace('.', ',');
      contrastBox.replaceChildren(ratio >= 4.5
        ? h('div', { class: 'alert ok', role: 'status' }, `Độ tương phản chữ chính / nền: ${text}:1 – đạt.`)
        : h('div', { class: 'alert warn', role: 'alert' }, `Chữ chính và nền chênh lệch thấp (${text}:1). Nên từ 4,5:1 trở lên để đọc rõ từ xa.`));
    }
  }

  const colorField = (key, label) => {
    const text = h('input', { type: 'text', 'data-field': key, value: draft[key], class: 'mono', 'aria-label': label + ' – mã màu' });
    const picker = h('input', { type: 'color', value: isHex(draft[key]) ? draft[key] : '#ffffff', 'aria-label': label });
    picker.addEventListener('input', () => { draft[key] = picker.value.toUpperCase(); text.value = draft[key]; refresh(); });
    text.addEventListener('input', () => { draft[key] = text.value.trim(); if (isHex(draft[key])) picker.value = draft[key]; refresh(); });
    return h('label', { class: 'field' }, h('span', null, label), h('div', { class: 'color' }, picker, text));
  };

  const nameInput = h('input', { type: 'text', 'data-field': 'name', value: current.name, maxLength: 50 });
  const angle = h('input', { type: 'number', 'data-field': 'bgAngle', value: draft.bgAngle, min: 0, max: 360, step: 1 });
  const dotOpacity = h('input', { type: 'number', 'data-field': 'dotOpacity', value: draft.dotOpacity, min: 0, max: 0.3, step: 0.01 });
  const skyOpacity = h('input', { type: 'number', 'data-field': 'skylineOpacity', value: draft.skylineOpacity, min: 0, max: 1, step: 0.01 });
  const skyStrong = h('input', { type: 'number', 'data-field': 'skylineStrongOpacity', value: draft.skylineStrongOpacity, min: 0, max: 1, step: 0.01 });
  angle.addEventListener('input', () => { draft.bgAngle = Number(angle.value); refresh(); });
  dotOpacity.addEventListener('input', () => { draft.dotOpacity = Number(dotOpacity.value); refresh(); });
  skyOpacity.addEventListener('input', () => { draft.skylineOpacity = Number(skyOpacity.value); refresh(); });
  skyStrong.addEventListener('input', () => { draft.skylineStrongOpacity = Number(skyStrong.value); });

  const used = [current.usedGlobally && 'cấu hình chung', ...current.usedBy].filter(Boolean);
  const form = h('form', { class: 'card stack', style: 'flex:999 1 420px;min-width:0' },
    field('Tên mẫu', nameInput),
    TOKEN_GROUPS.map(([title, fields]) => h('fieldset', { style: 'border:0;border-top:1px solid var(--line);margin:0;padding:12px 0 0' },
      h('legend', { class: 'card-title', style: 'padding:0 8px 0 0' }, title),
      h('div', { class: 'grid' }, fields.map(([k, label]) => colorField(k, label))))),
    h('fieldset', { style: 'border:0;border-top:1px solid var(--line);margin:0;padding:12px 0 0' },
      h('legend', { class: 'card-title', style: 'padding:0 8px 0 0' }, 'Khác'),
      h('div', { class: 'grid' }, field('Góc gradient nền (độ)', angle, '180 = trên xuống, 135 = chéo'), field('Độ đậm chấm hoạ tiết', dotOpacity, '0 đến 0.3; 0 = tắt'),
        field('Độ đậm đường chân trời – Thường', skyOpacity, '0 đến 1'), field('Độ đậm đường chân trời – Đậm', skyStrong, '0 đến 1'))));

  const save = async () => {
    try {
      await api('PUT', '/api/themes/' + encodeURIComponent(current.id), { ...draft, name: nameInput.value });
      toast('Đã lưu mẫu. Màn hình dùng mẫu này đổi trong vòng 1 phút.');
      route();
    } catch (e) { showErrors(form, e); }
  };
  form.addEventListener('submit', ev => { ev.preventDefault(); save(); });

  const clone = async () => {
    try {
      const t = await api('POST', '/api/themes', { from: current.id, name: current.name + ' (bản sao)' });
      toast('Đã tạo mẫu mới.');
      location.hash = '#/mau/' + encodeURIComponent(t.id);
    } catch (e) { fail(e); }
  };
  const reset = () => window.confirm(`Khôi phục “${current.name}” về màu gốc của phường?`) &&
    act(api('POST', `/api/themes/${encodeURIComponent(current.id)}/reset`), 'Đã khôi phục mẫu gốc.');
  const remove = async () => {
    if (!confirmDelete(`mẫu “${current.name}”`)) return;
    try { await api('DELETE', '/api/themes/' + encodeURIComponent(current.id)); toast('Đã xoá mẫu.'); location.hash = '#/mau'; } catch (e) { fail(e); }
  };

  app.replaceChildren(h('div', { class: 'stack' },
    h('div', { class: 'row between' },
      h('div', null, h('a', { class: 'small', href: '#/giaodien' }, '‹ Quay lại giao diện'),
        h('h1', { class: 'page-title' }, 'Chỉnh mẫu giao diện màn hình'),
        h('p', { class: 'card-hint' }, 'Lưu vào data\\themes.json trên máy chủ. Sửa trực tiếp file đó cũng được, máy chủ tự nạp lại.')),
      h('div', { class: 'row' },
        h('button', { class: 'btn', type: 'button', onclick: clone }, 'Nhân bản thành mẫu mới'),
        current.builtIn && current.modified && h('button', { class: 'btn', type: 'button', onclick: reset }, 'Khôi phục mặc định'),
        !current.builtIn && h('button', { class: 'btn danger', type: 'button', onclick: remove }, 'Xoá mẫu'),
        h('button', { class: 'btn primary', type: 'button', onclick: save }, 'Lưu mẫu'))),
    themes.fileError && h('div', { class: 'alert error' }, h('strong', null, 'File data\\themes.json đang sai: '), themes.fileError),
    h('div', { class: 'cols' },
      h('nav', { class: 'card theme-list', 'aria-label': 'Danh sách mẫu', style: 'flex:1 1 200px;max-width:260px;padding:8px' },
        themes.items.map(t => h('button', { type: 'button', 'aria-pressed': String(t.id === current.id), onclick: () => { location.hash = '#/mau/' + encodeURIComponent(t.id); } },
          h('span', { class: 'swatch', style: `width:28px;height:28px;background:linear-gradient(${t.tokens.bgAngle}deg,${t.tokens.bg1},${t.tokens.bg2})` }),
          h('span', null, h('strong', null, t.name),
            h('div', { class: 'small muted' }, t.builtIn ? (t.modified ? 'Mẫu gốc, đã chỉnh' : 'Mẫu gốc') : 'Mẫu tự tạo'))))),
      form,
      h('aside', { class: 'stack', style: 'flex:1 1 380px;min-width:0' },
        h('section', { class: 'card' }, h('h2', { class: 'card-title' }, 'Xem trước'), preview),
        contrastBox,
        h('p', { class: 'small muted' }, used.length ? 'Đang được dùng bởi: ' + used.join(', ') + '.' : 'Chưa phòng nào dùng mẫu này.')))));
  refresh();
}

export { pageThemes };
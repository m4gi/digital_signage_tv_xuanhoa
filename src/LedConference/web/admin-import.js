// Page "Nhập Excel": weekly file import, places without a room, import history, session hours.

import { XLSX, S, h, api, toast, dmy, dm, card, field, showErrors, route, act } from './admin-core.js';
import { timePicker } from './admin-pickers.js';

// ---------- Nhập Excel ----------

async function pageImport(app) {
  const [rooms, settings, unassigned, imports] = await Promise.all([
    api('GET', '/api/rooms'), api('GET', '/api/settings'), api('GET', '/api/places/unassigned'), api('GET', '/api/imports'),
  ]);
  app.replaceChildren(h('div', { class: 'stack' },
    importCard(),
    unassignedCard(unassigned, rooms, settings),
    h('div', { class: 'cols' },
      h('div', { class: 'main' }, importsCard(imports)),
      h('div', { class: 'side' }, sessionsCard(settings)))));
}

function importCard() {
  const input = h('input', { type: 'file', accept: '.xlsx', class: 'sr-only', id: 'importFile' });
  const drop = h('label', { class: 'drop', for: 'importFile' },
    h('strong', { style: 'font-size:16px' }, 'Kéo thả file lịch tuần vào đây, hoặc bấm để chọn file'),
    h('span', { class: 'muted' }, 'File xuất từ phần mềm quản lý lịch (Lichdonvi_….xlsx). Lịch các ngày trong tuần đó sẽ được thay mới.'));
  input.addEventListener('change', () => input.files[0] && importFile(input.files[0]));
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('over'); if (e.dataTransfer.files[0]) importFile(e.dataTransfer.files[0]); });

  const r = S.importResult;
  let result = null;
  if (r && r.ok) {
    result = h('div', { class: 'alert ok', role: 'status' },
      h('strong', null, `Đã nhập “${r.fileName}”: tuần ${dm(r.data.week.from)} – ${dmy(r.data.week.to)}, ${r.data.total} cuộc họp` +
        (r.data.replaced ? ` (thay ${r.data.replaced} cuộc họp cũ)` : '') + '.'),
      h('div', { class: 'row' },
        r.data.byRoom.map(x => h('span', { class: 'chip room' }, `${x.roomCode} · ${x.count}`)),
        r.data.unassigned.length > 0 && h('span', { class: 'chip unassigned' }, `Chưa gán phòng · ${r.data.unassigned.reduce((n, x) => n + x.count, 0)}`)),
      r.data.estimatedEnds > 0 && h('div', { class: 'small' }, `${r.data.estimatedEnds} cuộc họp không ghi giờ kết thúc, hệ thống đã tự tính (đánh dấu * trong lịch).`));
  } else if (r) {
    result = h('div', { class: 'alert error', role: 'alert' },
      h('strong', null, `“${r.fileName}”: ${r.problem.title || 'Lỗi'}. `), r.problem.detail || '',
      r.problem.rows && r.problem.rows.length > 0 && h('ul', null,
        r.problem.rows.map(x => h('li', null, (x.row ? `Dòng ${x.row}: ` : '') + x.message))));
  }
  return card('Nhập lịch tuần', null,
    h('div', { class: 'row between' }, h('span'), h('a', { href: '/template.xlsx' }, 'Tải file mẫu (.xlsx)')),
    drop, input, result);
}

async function importFile(file, confirmed = false) {
  const headers = { 'Content-Type': XLSX, 'X-File-Name': encodeURIComponent(file.name) };
  try {
    const data = await api('POST', '/api/import' + (confirmed ? '?confirm=true' : ''), file, headers);
    S.importResult = { ok: true, fileName: file.name, data };
    toast('Đã nhập lịch tuần.');
  } catch (e) {
    if (e.status === 409 && e.problem.manual) {
      const list = e.problem.manual.map(m => `• ${dm(m.date)} ${m.start} ${m.title}`).join('\n');
      if (window.confirm(`${e.problem.detail}\n\n${list}\n\nVẫn nhập và thay thế?`)) return importFile(file, true);
      S.importResult = { ok: false, fileName: file.name, problem: { title: 'Đã huỷ nhập', detail: 'Lịch cũ được giữ nguyên.' } };
    } else {
      S.importResult = { ok: false, fileName: file.name, problem: e.problem.title ? e.problem : { title: e.message } };
    }
  }
  route();
}

function unassignedCard(unassigned, rooms, settings) {
  const ignored = settings.ignoredPlaces || [];
  return card('Địa điểm chưa gán phòng',
    'Các địa điểm có cuộc họp từ tuần này trở đi nhưng chưa khớp phòng nào. Gán vào phòng để lịch hiện lên màn hình, hoặc bỏ qua nếu nơi đó không có màn hình.',
    !unassigned.length && h('p', { class: 'muted' }, 'Không có địa điểm nào chưa gán.'),
    unassigned.map(u => {
      const sel = h('select', { style: 'width:auto' }, rooms.map(r => h('option', { value: r.code }, `${r.code} – ${r.name}`)));
      return h('div', { class: 'row', style: 'padding:8px 0;border-top:1px solid var(--line)' },
        h('div', { class: 'grow' }, h('strong', null, u.place), h('div', { class: 'small muted' }, `${u.count} cuộc họp, từ ${dm(u.firstDate)}`)),
        rooms.length > 0 && h('label', { class: 'row' }, h('span', { class: 'muted' }, 'Gán vào'), sel),
        rooms.length > 0 && h('button', { class: 'btn primary', type: 'button', onclick: () => act(api('POST', '/api/places/assign', { place: u.place, roomCode: sel.value }), 'Đã gán địa điểm.') }, 'Gán'),
        h('button', { class: 'btn', type: 'button', onclick: () => act(api('POST', '/api/places/ignore', { place: u.place }), 'Đã bỏ qua địa điểm.') }, 'Bỏ qua'));
    }),
    ignored.length > 0 && h('div', { class: 'small muted' }, 'Đã đánh dấu không có màn hình: ',
      ignored.map(p => h('span', { style: 'margin-right:12px' }, p, ' ',
        h('button', { class: 'link', type: 'button', onclick: () => act(api('DELETE', '/api/places/ignore?place=' + encodeURIComponent(p)), 'Đã bỏ đánh dấu.') }, 'bỏ đánh dấu')))));
}

function sessionsCard(settings) {
  const t = (key, value) => timePicker(value, key);
  const ms = t('morning', settings.morning.start), me = t('morning', settings.morning.end);
  const as = t('afternoon', settings.afternoon.start), ae = t('afternoon', settings.afternoon.end);
  const form = h('form', { class: 'card' },
    h('div', null, h('h2', { class: 'card-title' }, 'Giờ mặc định theo buổi'),
      h('p', { class: 'card-hint' }, 'Dùng khi ô giờ trong Excel để trống hoặc không có giờ kết thúc. Áp dụng cho lần nhập sau.')),
    h('div', { class: 'grid', style: 'grid-template-columns:repeat(2,minmax(0,1fr))' },
      field('Sáng – bắt đầu', ms.el), field('Sáng – kết thúc', me.el), field('Chiều – bắt đầu', as.el), field('Chiều – kết thúc', ae.el)),
    h('div', null, h('button', { class: 'btn primary', type: 'submit' }, 'Lưu')));
  form.addEventListener('submit', async ev => {
    ev.preventDefault();
    const body = { morning: { start: ms.value, end: me.value }, afternoon: { start: as.value, end: ae.value } };
    try { await api('PUT', '/api/settings', body); toast('Đã lưu giờ theo buổi.'); } catch (e) { showErrors(form, e); }
  });
  return form;
}

function importsCard(imports) {
  return card('Các lần nhập Excel', null,
    !imports.length && h('p', { class: 'muted' }, 'Chưa nhập lần nào.'),
    imports.slice(0, 10).map(i => h('div', { class: 'row between', style: 'padding:8px 0;border-top:1px solid var(--line)' },
      h('div', null, h('strong', null, `${dm(i.from)} – ${dmy(i.to)}`),
        h('div', { class: 'small muted' }, `${i.fileName} · ${i.total} cuộc họp · ${i.at.slice(11, 16)} ${dmy(i.at.slice(0, 10))} · ${i.ip}`)),
      h('a', { href: `/api/imports/${encodeURIComponent(i.id)}/file` }, 'Tải file gốc'))));
}

export { pageImport };
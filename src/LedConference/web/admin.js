// Admin UI. Plain JS, hash routes: #/lich, #/nhap, #/phong, #/phong/{code|moi}, #/giaodien, #/mau/{id}, #/hethong.
// All text goes through textContent (h() below), never innerHTML: meeting data comes from Excel files.
'use strict';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const DAYS = ['Chủ nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];
const EFFECTS = [['fadeUp', 'Mờ và trượt lên'], ['zoom', 'Phóng to nhẹ'], ['slideLeft', 'Trượt từ trái'], ['shine', 'Vệt sáng'], ['border', 'Viền chạy quanh']];
const ORIENTATIONS = [['auto', 'Tự nhận theo màn hình'], ['portrait', 'Luôn dọc'], ['landscape', 'Luôn ngang']];
const EMPTY_DAYS = [['nextMeeting', 'Cuộc họp gần nhất sắp tới'], ['free', 'Chỉ chữ “PHÒNG TRỐNG”']];
const SKYLINES = [['normal', 'Thường'], ['strong', 'Đậm'], ['off', 'Tắt']];
const STATUSES = [['normal', 'Bình thường'], ['postponed', 'Hoãn – màn hình hiện “ĐÃ HOÃN”'], ['cancelled', 'Huỷ – ẩn khỏi màn hình']];
const SWITCHES = [['clock', 'Đồng hồ', 'Giờ và ngày ở góc phải'], ['footer', 'Chân trang', 'Tuần lịch, ghi chú, giờ cập nhật'],
  ['reduceMotion', 'Giảm chuyển động', 'Tắt hiệu ứng chuyển cảnh'], ['hideCursor', 'Ẩn con trỏ chuột', 'Khi có chuột cắm vào màn hình']];
const ACTIONS = {
  'meeting.create': 'Thêm cuộc họp', 'meeting.update': 'Sửa cuộc họp', 'meeting.delete': 'Xoá cuộc họp',
  'room.create': 'Thêm phòng', 'room.update': 'Sửa phòng', 'room.delete': 'Xoá phòng', import: 'Nhập Excel',
  'settings.update': 'Sửa cấu hình', 'place.assign': 'Gán địa điểm', 'place.ignore': 'Bỏ qua địa điểm',
  'place.unignore': 'Bỏ đánh dấu địa điểm', 'theme.create': 'Tạo mẫu', 'theme.update': 'Sửa mẫu', 'theme.delete': 'Xoá mẫu',
  'theme.reset': 'Khôi phục mẫu', 'logo.update': 'Đổi logo', 'logo.delete': 'Xoá logo', cleanup: 'Tự xoá dữ liệu cũ',
};

// Page state that survives navigation between routes.
const S = { week: null, room: 'ALL', q: '', edit: null, importResult: null, timer: null };

// ---------- Helpers ----------

const $ = (sel, el = document) => el.querySelector(sel);

function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') el.setAttribute('style', v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'for') el.htmlFor = v;
    else if (k in el && k !== 'list' && k !== 'form') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) el.append(kid instanceof Node ? kid : String(kid));
  return el;
}

async function api(method, url, body, headers = {}) {
  const opt = { method, headers: { ...headers } };
  if (body instanceof Blob) opt.body = body;
  else if (body !== undefined) { opt.body = JSON.stringify(body); opt.headers['Content-Type'] = 'application/json'; }
  const r = await fetch(url, opt);
  const data = (r.headers.get('content-type') || '').includes('json') ? await r.json() : null;
  if (!r.ok) throw Object.assign(new Error((data && (data.detail || data.title)) || 'Lỗi ' + r.status), { status: r.status, problem: data || {} });
  return data;
}

function toast(message, kind = 'ok', ms = 3500) {
  const t = h('div', { class: 'toast ' + kind }, message);
  $('#toasts').append(t);
  setTimeout(() => t.remove(), ms);
}

function fail(e) { toast(e.message, 'error', 6000); }

const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseIso = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parseIso(s); d.setDate(d.getDate() + n); return iso(d); };
const weekStart = s => { const d = parseIso(s); d.setDate(d.getDate() - (d.getDay() + 6) % 7); return iso(d); };
const dmy = s => `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`;
const dm = s => `${s.slice(8, 10)}/${s.slice(5, 7)}`;
const dayLabel = s => `${DAYS[parseIso(s).getDay()]}, ${dmy(s)}`;
const today = () => iso(new Date());
// Case- and accent-insensitive text for search: "chu tich" finds "Chủ tịch".
const fold = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[đĐ]/g, 'd').toLowerCase();
const nowHm = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };

function options(pairs, selected) {
  return pairs.map(([value, text]) => h('option', { value, selected: value === selected }, text));
}

function card(title, hint, ...body) {
  return h('section', { class: 'card' },
    h('div', null, h('h2', { class: 'card-title' }, title), hint && h('p', { class: 'card-hint' }, hint)),
    ...body);
}

function field(label, control, hint) {
  return h('label', { class: 'field' }, h('span', null, label), control, hint && h('span', { class: 'small muted' }, hint));
}

// ---------- Date and time pickers ----------
// Native date/time inputs follow the browser language (mm/dd/yyyy and AM/PM on an English Windows), so the
// admin has its own: dd/mm/yyyy with a Monday-first Vietnamese calendar, and 24-hour times with a 15-minute list.

const prevent = e => e.preventDefault(); // on popup buttons: clicking them must not blur the input
const minutesOf = hm => { const [a, b] = hm.split(':').map(Number); return a * 60 + b; };
const clockOf = n => `${pad(Math.floor(n / 60) % 24)}:${pad(n % 60)}`;
const duration = n => n < 60 ? `${n} phút` : `${Math.floor(n / 60)} giờ${n % 60 ? ' ' + (n % 60) : ''}`;

// "26/10/2026", "26/10", "26-10-26" → "2026-10-26"; anything else → null.
function parseDmy(s) {
  const m = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2}|\d{4}))?$/.exec(s.trim());
  if (!m) return null;
  const y = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : new Date().getFullYear();
  const d = new Date(y, m[2] - 1, Number(m[1]));
  return d.getDate() === Number(m[1]) && d.getMonth() === m[2] - 1 ? iso(d) : null;
}

// "8", "830", "0830", "8h30", "8g30", "8:30", "8.30" → "08:30"; anything else → null.
function parseHm(s) {
  const t = s.trim().toLowerCase().replace(/\s+/g, '');
  const m = /^(\d{1,2})(?:[h:g.](\d{0,2}))?$/.exec(t) || /^(\d{1,2})(\d{2})$/.exec(t);
  if (!m) return null;
  const hh = Number(m[1]), mm = Number(m[2] || 0);
  return hh < 24 && mm < 60 ? `${pad(hh)}:${pad(mm)}` : null;
}

// A text input with a popup below it; the popup opens on focus and closes on blur, Escape or a pick.
function withPopup(input, draw, onKey) {
  const pop = h('div', { class: 'pop', hidden: true, onmousedown: prevent });
  const open = () => { pop.hidden = false; draw(pop); }; // visible first, so draw() can scroll the list
  const close = () => { pop.hidden = true; };
  input.addEventListener('focus', open);
  input.addEventListener('click', () => { if (pop.hidden) open(); });
  input.addEventListener('blur', close);
  input.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !pop.hidden) { e.preventDefault(); close(); }
    else if (onKey && !pop.hidden) onKey(e, pop);
  });
  return { pop, open, close };
}

function datePicker(value, dataField) {
  let cur = value || '';
  const input = h('input', { type: 'text', 'data-field': dataField, inputMode: 'numeric', autocomplete: 'off', placeholder: 'dd/mm/yyyy' });
  const weekday = h('span', { class: 'picker-hint' });
  let month = null;
  const show = () => {
    input.value = cur ? dmy(cur) : '';
    weekday.textContent = cur ? DAYS[parseIso(cur).getDay()] : '';
    input.classList.remove('invalid');
  };
  const pick = d => { cur = d; show(); popup.close(); input.dispatchEvent(new Event('change')); };
  const draw = pop => {
    if (!month) month = (cur || today()).slice(0, 8) + '01';
    const first = parseIso(month), mo = first.getMonth();
    const start = addDays(month, -((first.getDay() + 6) % 7));
    const step = n => { const d = parseIso(month); d.setMonth(d.getMonth() + n); month = iso(d); draw(pop); };
    const cells = [];
    for (let i = 0; i < 42; i++) {
      const d = addDays(start, i);
      cells.push(h('button', {
        type: 'button', 'aria-label': dayLabel(d), 'aria-pressed': String(d === cur),
        class: 'day-btn' + (parseIso(d).getMonth() !== mo ? ' out' : '') + (d === today() ? ' now' : ''),
        onclick: () => pick(d),
      }, String(parseIso(d).getDate())));
    }
    pop.replaceChildren(
      h('div', { class: 'cal-head' },
        h('button', { type: 'button', class: 'btn icon small', 'aria-label': 'Tháng trước', onclick: () => step(-1) }, '‹'),
        h('strong', null, `Tháng ${mo + 1}/${first.getFullYear()}`),
        h('button', { type: 'button', class: 'btn icon small', 'aria-label': 'Tháng sau', onclick: () => step(1) }, '›')),
      h('div', { class: 'cal' }, ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'].map(x => h('span', { class: 'wd' }, x)), cells),
      h('div', { class: 'row' },
        h('button', { type: 'button', class: 'btn small', onclick: () => pick(today()) }, 'Hôm nay'),
        h('button', { type: 'button', class: 'btn small', onclick: () => pick(addDays(today(), 1)) }, 'Ngày mai')));
  };
  const popup = withPopup(input, draw);
  popup.pop.classList.add('pop-cal');
  // Typed dates are read when leaving the box: "26/10" means this year.
  input.addEventListener('blur', () => {
    month = null; // next opening starts at the chosen month
    const d = parseDmy(input.value);
    if (d) { const changed = d !== cur; cur = d; show(); if (changed) input.dispatchEvent(new Event('change')); }
    else if (input.value.trim()) input.classList.add('invalid');
  });
  show();
  return {
    el: h('div', { class: 'picker' }, h('div', { class: 'picker-box' }, input, weekday), popup.pop),
    input,
    get value() { return parseDmy(input.value) || ''; },
  };
}

// after(): for an end time, the start it must follow; the list then shows durations and starts after it.
function timePicker(value, dataField, after) {
  const input = h('input', { type: 'text', 'data-field': dataField, inputMode: 'numeric', autocomplete: 'off', placeholder: 'hh:mm', value: value || '' });
  let active = -1;
  const set = v => { input.value = v; input.classList.remove('invalid'); input.dispatchEvent(new Event('change')); };
  const draw = pop => {
    const from = after ? parseHm(after()) : null;
    const first = from ? minutesOf(from) + 15 : 6 * 60;
    const times = [];
    for (let n = first - first % 15; n <= 22 * 60; n += 15) if (!from || n > minutesOf(from)) times.push(n);
    const cur = parseHm(input.value);
    pop.replaceChildren(...times.map(n => h('button', {
      type: 'button', class: 'time-opt', 'aria-pressed': String(clockOf(n) === cur),
      onclick: () => { set(clockOf(n)); input.blur(); },
    }, clockOf(n), from && h('span', { class: 'muted' }, ' · ' + duration(n - minutesOf(from))))));
    // Scroll to the current time (or the nearest one after it).
    const at = cur ? times.findIndex(n => n >= minutesOf(cur)) : -1;
    active = at;
    const target = pop.children[Math.max(0, at - 2)];
    pop.scrollTop = target ? target.offsetTop : 0;
    if (at >= 0) pop.children[at].classList.add('active');
  };
  const onKey = (e, pop) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Enter') return;
    const items = pop.children;
    // Enter picks the highlighted time (or just confirms what was typed) instead of submitting the form.
    if (e.key === 'Enter') { e.preventDefault(); if (items[active]) items[active].click(); else input.blur(); return; }
    e.preventDefault();
    if (items[active]) items[active].classList.remove('active');
    active = Math.min(items.length - 1, Math.max(0, active + (e.key === 'ArrowDown' ? 1 : -1)));
    items[active].classList.add('active');
    items[active].scrollIntoView({ block: 'nearest' });
    input.value = items[active].firstChild.textContent;
  };
  const popup = withPopup(input, draw, onKey);
  popup.pop.classList.add('pop-time');
  input.addEventListener('blur', () => {
    const t = parseHm(input.value);
    if (t) { if (t !== input.value) set(t); }
    else if (input.value.trim()) input.classList.add('invalid');
  });
  return {
    el: h('div', { class: 'picker' }, input, popup.pop),
    input,
    get value() { return parseHm(input.value) || ''; },
    set value(v) { input.value = v; input.classList.remove('invalid'); },
  };
}

// Shows a ValidationProblem's field errors next to inputs carrying data-field, and returns a summary box.
function showErrors(form, e) {
  form.querySelectorAll('.field-error').forEach(x => x.remove());
  form.querySelectorAll('.invalid').forEach(x => x.classList.remove('invalid'));
  const errors = (e.problem && e.problem.errors) || {};
  const loose = [];
  for (const [key, messages] of Object.entries(errors)) {
    const input = form.querySelector(`[data-field="${key}"]`);
    if (input) {
      input.classList.add('invalid');
      input.closest('.field, .color')?.append(h('span', { class: 'field-error' }, messages.join(' ')));
    } else loose.push(...messages);
  }
  if (!Object.keys(errors).length) loose.push(e.message);
  if (loose.length) toast(loose.join(' '), 'error', 6000);
}

function confirmDelete(what) { return window.confirm(`Xoá ${what}? Không hoàn tác được.`); }

// Clipboard API needs a secure context; plain http on a LAN IP is not one, so fall back to execCommand.
function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text).then(() => toast('Đã sao chép.'));
  const ta = h('textarea', { value: text, style: 'position:fixed;opacity:0' });
  document.body.append(ta);
  ta.select();
  document.execCommand('copy');
  ta.remove();
  toast('Đã sao chép.');
}

function displaySummary(display, themes) {
  const keys = Object.keys(display || {});
  if (!keys.length) return null;
  const parts = [];
  if (display.theme) parts.push((themes.find(t => t.id === display.theme) || {}).name || display.theme);
  if (display.orientation) parts.push((ORIENTATIONS.find(o => o[0] === display.orientation) || [])[1]);
  const rest = keys.length - parts.length;
  if (rest > 0) parts.push(`+${rest} mục`);
  return parts.join(', ');
}

// ---------- Router ----------

const routes = { lich: pageSchedule, nhap: pageImport, phong: pageRooms, giaodien: pageAppearance, mau: pageThemes, hethong: pageSystem };

async function route() {
  clearTimeout(S.timer);
  let [name, arg] = location.hash.replace(/^#\/?/, '').split('/');
  if (name === 'cauhinh') name = 'nhap'; // old bookmark
  const page = name === 'phong' && arg ? pageRoom : routes[name] || pageSchedule;
  const tab = name === 'mau' ? 'giaodien' : routes[name] ? name : 'lich';
  document.querySelectorAll('[data-nav]').forEach(a => {
    a.classList.toggle('active', a.dataset.nav === tab);
    if (a.dataset.nav === tab) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  const app = $('#app');
  app.replaceChildren(h('p', { class: 'muted' }, 'Đang tải…'));
  try {
    await page(app, decodeURIComponent(arg || ''));
  } catch (e) {
    app.replaceChildren(h('div', { class: 'alert error' }, h('strong', null, 'Không tải được trang. '), e.message));
  }
}

async function loadBrand() {
  $('#server').textContent = 'Máy chủ: ' + location.host;
  try {
    const s = await api('GET', '/api/settings');
    $('#brandOrg').textContent = `${s.org.line1} ${s.org.line2}`;
    const logo = $('#brandLogo');
    const img = new Image();
    img.onload = () => { logo.textContent = ''; logo.style.backgroundImage = `url("/logo?v=${s.logoVersion}")`; };
    img.src = `/logo?v=${s.logoVersion}`;
  } catch { /* header stays generic */ }
}

window.addEventListener('hashchange', route);
route();
loadBrand();

// ---------- Lịch họp ----------

async function pageSchedule(app) {
  S.week = S.week || weekStart(today());
  const week = S.week;
  const [rooms, data] = await Promise.all([
    api('GET', '/api/rooms'),
    api('GET', `/api/meetings?from=${week}&to=${addDays(week, 6)}`),
  ]);
  if (S.room !== 'ALL' && !rooms.some(r => r.code === S.room)) S.room = 'ALL';

  const go = weekValue => { S.week = weekValue; S.edit = null; route(); };
  const filter = h('div', { class: 'seg', role: 'group', 'aria-label': 'Chọn phòng' },
    [['ALL', 'Tất cả phòng', ''], ...rooms.map(r => [r.code, r.code, r.name])].map(([code, label, title]) =>
      h('button', { type: 'button', title, 'aria-pressed': String(S.room === code), onclick: () => { S.room = code; route(); } }, label)));

  const toolbar = h('div', { class: 'row between' },
    filter,
    h('div', { class: 'row' },
      h('button', { class: 'btn icon', type: 'button', 'aria-label': 'Tuần trước', onclick: () => go(addDays(week, -7)) }, '‹'),
      h('strong', null, `${dm(week)} – ${dmy(addDays(week, 6))}`),
      h('button', { class: 'btn icon', type: 'button', 'aria-label': 'Tuần sau', onclick: () => go(addDays(week, 7)) }, '›'),
      h('button', { class: 'btn', type: 'button', onclick: () => go(weekStart(today())) }, 'Hôm nay'),
      h('a', { class: 'btn', href: `/api/export?week=${week}` }, 'Xuất Excel tuần này'),
      h('button', { class: 'btn primary', type: 'button', onclick: () => { S.edit = { id: null }; route(); } }, '+ Thêm cuộc họp')));

  const inRoom = data.items.filter(m => S.room === 'ALL' || m.roomCode === S.room);
  const t = today(), hm = nowHm();
  const daysBox = h('div', { class: 'main stack' });
  const summary = h('span', { class: 'small muted' });

  // Re-rendered on every keystroke in the search box, without rebuilding the page (keeps focus in the box).
  function fill() {
    const q = fold(S.q.trim());
    const items = q ? inRoom.filter(m => fold([m.title, m.chair, m.participants, m.note, m.contact, m.place, m.roomCode].join(' ')).includes(q)) : inRoom;
    summary.textContent = q ? `Tìm thấy ${items.length} cuộc họp` : `${items.length} cuộc họp trong tuần`;
    const days = [];
    for (let i = 0; i < 7; i++) {
      const date = addDays(week, i);
      const list = items.filter(m => m.date === date);
      if (q && !list.length) continue;
      // Days without meetings shrink to one line so the busy days stay in view.
      days.push(h('section', { class: 'day' + (date === t ? ' today' : '') + (list.length ? '' : ' empty') },
        h('div', { class: 'day-head' },
          h('h2', null, dayLabel(date) + (date === t ? ' · Hôm nay' : '')),
          h('span', { class: 'small muted' }, list.length ? `${list.length} cuộc họp` : 'Không có lịch')),
        list.map(m => meetingRow(m, date === t && m.status === 'normal' && m.start <= hm && hm < m.end))));
    }
    daysBox.replaceChildren(...(days.length ? days : [h('p', { class: 'muted' }, 'Không có cuộc họp nào khớp.')]));
  }
  fill();

  const search = h('input', { type: 'search', class: 'search', value: S.q, placeholder: 'Tìm theo nội dung, chủ trì, thành phần…', 'aria-label': 'Tìm cuộc họp trong tuần' });
  search.addEventListener('input', () => { S.q = search.value; fill(); });

  const editing = S.edit && (S.edit.id ? data.items.find(m => m.id === S.edit.id) : S.edit);
  app.replaceChildren(h('div', { class: 'stack' }, toolbar,
    h('div', { class: 'row between' }, search, summary),
    h('div', { class: 'cols' },
      daysBox,
      editing && h('div', { class: 'side' }, meetingEditor(editing, rooms, week)))));
}

function meetingRow(m, live) {
  const struck = m.status !== 'normal';
  return h('div', { class: 'meeting' + (live ? ' live' : '') + (struck ? ' struck' : '') + (S.edit && S.edit.id === m.id ? ' selected' : '') },
    h('div', { class: 'time', title: m.endEstimated ? 'Giờ kết thúc do hệ thống tự tính' : null },
      `${m.start} – ${m.end}${m.endEstimated ? '*' : ''}`),
    h('div', { class: 'what' },
      h('div', { class: 'title' }, m.title),
      h('div', { class: 'small muted' }, [m.chair && 'Chủ trì: ' + m.chair, m.participants].filter(Boolean).join(' · '))),
    h('div', { class: 'row' },
      m.roomCode ? h('span', { class: 'chip room' }, m.roomCode) : h('span', { class: 'chip unassigned', title: 'Địa điểm chưa gán phòng' }, m.place),
      h('span', { class: 'chip ' + (m.source === 'manual' ? 'manual' : '') }, m.source === 'manual' ? 'Sửa tay' : 'Excel'),
      m.note && m.showNote === false && h('span', { class: 'chip', title: 'Ghi chú đang ẩn: ' + m.note }, 'Ẩn ghi chú'),
      m.showContact && m.contact && h('span', { class: 'chip', title: 'Liên hệ: ' + m.contact }, 'LH'),
      live && h('span', { class: 'chip live' }, 'Đang họp'),
      m.status === 'postponed' && h('span', { class: 'chip postponed' }, 'Đã hoãn'),
      m.status === 'cancelled' && h('span', { class: 'chip cancelled' }, 'Đã huỷ')),
    h('div', { class: 'row' },
      h('button', { class: 'link', type: 'button', onclick: () => { S.edit = { id: m.id }; route(); } }, 'Sửa'),
      h('button', { class: 'link danger', type: 'button', onclick: () => deleteMeeting(m) }, 'Xoá')));
}

async function deleteMeeting(m) {
  if (!confirmDelete(`cuộc họp “${m.title}” (${dm(m.date)} ${m.start})`)) return;
  try {
    await api('DELETE', '/api/meetings/' + encodeURIComponent(m.id));
    if (S.edit && S.edit.id === m.id) S.edit = null;
    toast('Đã xoá cuộc họp.');
    route();
  } catch (e) { fail(e); }
}

function meetingEditor(m, rooms, week) {
  const isNew = !m.id;
  const date = m.date || (today() >= week && today() <= addDays(week, 6) ? today() : week);
  const roomSel = h('select', { 'data-field': 'roomCode' },
    rooms.map(r => h('option', { value: r.code, selected: r.code === (m.roomCode || (isNew && S.room !== 'ALL' ? S.room : '')) }, `${r.code} – ${r.name}`)),
    h('option', { value: '', selected: !isNew && !m.roomCode }, 'Địa điểm khác (nhập tay)…'));
  const place = h('input', { type: 'text', 'data-field': 'place', value: m.roomCode ? '' : (m.place || ''), placeholder: 'Ví dụ: Hội trường UBND phường' });
  const placeField = field('Địa điểm', place, 'Địa điểm chưa gán phòng sẽ không hiện lên màn hình nào.');
  const syncPlace = () => placeField.classList.toggle('hidden', roomSel.value !== '');
  roomSel.addEventListener('change', syncPlace);
  if (!rooms.length) roomSel.value = '';

  const day = datePicker(date, 'date');
  const start = timePicker(m.start || '08:00', 'start');
  const end = timePicker(m.end || '09:00', 'end', () => start.value);
  // Moving the start keeps the meeting's length; the quick buttons set the length directly.
  let length = minutesOf(end.value) - minutesOf(start.value);
  const setLength = n => { length = n; end.value = clockOf(Math.min(minutesOf(start.value) + n, 23 * 60 + 59)); };
  start.input.addEventListener('change', () => { if (start.value && length > 0) setLength(length); });
  end.input.addEventListener('change', () => { if (start.value && end.value) length = minutesOf(end.value) - minutesOf(start.value); });
  const lengths = h('div', { class: 'row small' }, h('span', { class: 'muted' }, 'Thời lượng:'),
    [30, 60, 90, 120].map(n => h('button', { type: 'button', class: 'btn small', onclick: () => { if (start.value) setLength(n); } }, duration(n))));

  const inputs = {
    title: h('textarea', { rows: 2, 'data-field': 'title', value: m.title || '', required: true, maxLength: 300 }),
    chair: h('input', { type: 'text', 'data-field': 'chair', value: m.chair || '', maxLength: 200 }),
    participants: h('input', { type: 'text', 'data-field': 'participants', value: m.participants || '', maxLength: 500 }),
    note: h('input', { type: 'text', 'data-field': 'note', value: m.note || '', maxLength: 500 }),
    contact: h('input', { type: 'text', 'data-field': 'contact', value: m.contact || '', maxLength: 200, placeholder: 'Ví dụ: Đ/c Lan – Văn phòng UBND, 0909 xxx xxx' }),
    status: h('select', { 'data-field': 'status' }, options(STATUSES, m.status || 'normal')),
  };
  const warnings = h('div');
  const noteSwitch = switchRow('showNote', 'Hiện ghi chú trên màn hình', 'Tắt thì vẫn giữ nội dung, chỉ không hiện lên màn hình.', m.showNote !== false);
  const showNote = noteSwitch.querySelector('input');
  const contactSwitch = switchRow('showContact', 'Hiện dòng liên hệ trên màn hình', 'Tắt thì vẫn giữ nội dung, chỉ không hiện lên màn hình.', !!m.showContact);
  const showContact = contactSwitch.querySelector('input');
  // Typing a contact into an empty box usually means it should show; the switch can still be turned off.
  if (!m.contact) inputs.contact.addEventListener('input', () => { if (!showContact.dataset.touched) showContact.checked = inputs.contact.value.trim() !== ''; });
  showContact.addEventListener('change', () => { showContact.dataset.touched = '1'; });

  const form = h('form', { class: 'card editor', 'aria-label': isNew ? 'Thêm cuộc họp' : 'Sửa cuộc họp' },
    h('div', { class: 'row between' },
      h('h2', { class: 'card-title' }, isNew ? 'Thêm cuộc họp' : 'Sửa cuộc họp'),
      h('button', { class: 'btn icon', type: 'button', 'aria-label': 'Đóng', onclick: () => { S.edit = null; route(); } }, '×')),
    !isNew && h('p', { class: 'card-hint' },
      m.source === 'excel' ? 'Nguồn: Excel. Lưu ở đây sẽ đánh dấu “Sửa tay”; nhập lại Excel tuần này sẽ hỏi trước khi ghi đè.' : 'Nguồn: sửa tay.'),
    field('Phòng', roomSel), placeField,
    field('Ngày', day.el),
    h('div', { class: 'grid', style: 'grid-template-columns:repeat(2,minmax(0,1fr))' },
      field('Bắt đầu', start.el), field('Kết thúc', end.el)),
    lengths,
    field('Nội dung cuộc họp', inputs.title),
    field('Chủ trì', inputs.chair),
    field('Thành phần', inputs.participants),
    field('Ghi chú', inputs.note),
    noteSwitch,
    field('Liên hệ', inputs.contact, 'Hiện là “Liên hệ: …” dưới Ghi chú khi đang họp, và dưới cuộc họp tiếp theo khi phòng trống.'),
    contactSwitch,
    field('Trạng thái', inputs.status),
    warnings,
    h('div', { class: 'row' },
      h('button', { class: 'btn primary', type: 'submit' }, 'Lưu'),
      h('button', { class: 'btn', type: 'button', onclick: () => { S.edit = null; route(); } }, 'Huỷ bỏ'),
      !isNew && h('button', { class: 'btn danger', type: 'button', style: 'margin-left:auto', onclick: () => deleteMeeting(m) }, 'Xoá cuộc họp')),
    h('p', { class: 'small muted' }, 'Màn hình của phòng cập nhật trong vòng 1 phút sau khi lưu.'));
  syncPlace();

  form.addEventListener('submit', async ev => {
    ev.preventDefault();
    const body = {
      date: day.value || null, start: start.value || null, end: end.value || null, title: inputs.title.value,
      chair: inputs.chair.value, participants: inputs.participants.value, note: inputs.note.value, status: inputs.status.value,
      showNote: showNote.checked, contact: inputs.contact.value, showContact: showContact.checked,
      roomCode: roomSel.value || null, place: roomSel.value ? null : place.value,
    };
    try {
      const res = isNew ? await api('POST', '/api/meetings', body) : await api('PUT', '/api/meetings/' + encodeURIComponent(m.id), body);
      S.week = weekStart(res.meeting.date);
      if (res.warnings.length) {
        S.edit = { id: res.meeting.id };
        toast('Đã lưu, nhưng: ' + res.warnings.map(w => w.message).join(' '), 'warn', 8000);
      } else {
        S.edit = null;
        toast('Đã lưu cuộc họp.');
      }
      route();
    } catch (e) { showErrors(form, e); }
  });
  return form;
}

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

// ---------- Phòng & màn hình ----------

async function pageRooms(app) {
  const [rooms, themes] = await Promise.all([api('GET', '/api/rooms'), api('GET', '/api/themes')]);
  app.replaceChildren(h('div', { class: 'stack' }, roomsCard(rooms, themes.items)));
  // Keep the online/offline dots current while the page is open.
  S.timer = setTimeout(() => { if (location.hash === '#/phong') route(); }, 30000);
}

// ---------- Giao diện ----------

async function pageAppearance(app) {
  const [settings, themes] = await Promise.all([api('GET', '/api/settings'), api('GET', '/api/themes')]);
  app.replaceChildren(h('div', { class: 'stack' },
    themes.fileError && h('div', { class: 'alert error' }, h('strong', null, 'File data\\themes.json đang sai, các mẫu cũ vẫn được dùng: '), themes.fileError),
    appearanceCard(settings, themes.items),
    orgCard(settings)));
}

// ---------- Hệ thống ----------

async function pageSystem(app) {
  const [settings, audit] = await Promise.all([api('GET', '/api/settings'), api('GET', '/api/audit?limit=100')]);
  app.replaceChildren(h('div', { class: 'stack' }, systemCard(settings), auditCard(audit)));
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

async function act(promise, message) {
  try { await promise; toast(message); route(); } catch (e) { fail(e); }
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

function themeChoices(themes, selected, name) {
  return h('div', { class: 'choices' }, themes.map(t => h('label', { class: 'choice' },
    h('input', { type: 'radio', name, value: t.id, checked: t.id === selected, 'aria-label': t.name }),
    h('span', { class: 'swatch', style: `background:linear-gradient(${t.tokens.bgAngle}deg,${t.tokens.bg1},${t.tokens.bg2})` }),
    h('span', null, h('strong', null, t.name), h('div', { class: 'small muted' }, t.builtIn ? (t.modified ? 'Mẫu gốc, đã chỉnh' : 'Mẫu gốc') : 'Mẫu tự tạo')))));
}

function switchRow(key, label, hint, checked) {
  return h('label', { class: 'switch' },
    h('span', null, h('strong', null, label), h('div', { class: 'small muted' }, hint)),
    h('input', { type: 'checkbox', role: 'switch', name: key, checked, 'aria-label': label }),
    h('span', { class: 'track', 'aria-hidden': 'true' }));
}

function appearanceCard(settings, themes) {
  const d = settings.display;
  const effect = h('select', { 'data-field': 'display.effect' }, options(EFFECTS, d.effect));
  const orientation = h('select', { 'data-field': 'display.orientation' }, options(ORIENTATIONS, d.orientation));
  const emptyDay = h('select', { 'data-field': 'display.emptyDay' }, options(EMPTY_DAYS, d.emptyDay));
  const skyline = h('select', { 'data-field': 'display.skyline' }, options(SKYLINES, d.skyline || 'normal'));
  const note = h('input', { type: 'text', 'data-field': 'display.footerNote', value: d.footerNote || '', maxLength: 200, placeholder: 'Để trống thì không hiện' });
  const form = h('form', { class: 'card' },
    h('div', { class: 'row between' },
      h('div', null, h('h2', { class: 'card-title' }, 'Giao diện màn hình (cấu hình chung)'),
        h('p', { class: 'card-hint' }, 'Áp dụng cho mọi phòng. Phòng nào cần khác thì sửa ở tab “Phòng & màn hình”. Màn hình đổi trong vòng 1 phút.')),
      h('a', { href: '#/mau' }, 'Chỉnh màu từng mẫu, tạo mẫu mới ›')),
    h('fieldset', { style: 'border:0;margin:0;padding:0' }, h('legend', { style: 'font-weight:600;padding:0;margin-bottom:8px' }, 'Mẫu giao diện'),
      themeChoices(themes, d.theme, 'theme')),
    h('div', { class: 'grid' }, field('Hiệu ứng chuyển cảnh', effect), field('Màn hình đứng hay ngang', orientation),
      field('Khi hết lịch trong ngày, hiện', emptyDay), field('Hình đường chân trời', skyline)),
    field('Dòng ghi chú cố định ở chân màn hình', note),
    h('div', { class: 'grid', style: 'gap:4px 24px' }, SWITCHES.map(([k, label, hint]) => switchRow(k, label, hint, !!d[k]))),
    h('div', null, h('button', { class: 'btn primary', type: 'submit' }, 'Lưu giao diện')));
  form.addEventListener('submit', async ev => {
    ev.preventDefault();
    const display = {
      theme: form.querySelector('input[name=theme]:checked').value, effect: effect.value, orientation: orientation.value,
      emptyDay: emptyDay.value, skyline: skyline.value, footerNote: note.value.trim(),
    };
    for (const [k] of SWITCHES) display[k] = form.querySelector(`input[name=${k}]`).checked;
    try { await api('PUT', '/api/settings', { display }); toast('Đã lưu giao diện.'); route(); } catch (e) { showErrors(form, e); }
  });
  return form;
}

function orgCard(settings) {
  const line1 = h('input', { type: 'text', 'data-field': 'org.line1', value: settings.org.line1, maxLength: 100 });
  const line2 = h('input', { type: 'text', 'data-field': 'org.line2', value: settings.org.line2, maxLength: 100 });
  const preview = h('div', { class: 'brand-logo', style: 'width:72px;height:72px' }, 'LOGO');
  const img = new Image();
  img.onload = () => { preview.textContent = ''; preview.style.backgroundImage = `url("/logo?v=${settings.logoVersion}")`; };
  img.src = `/logo?v=${settings.logoVersion}`;
  const file = h('input', { type: 'file', accept: 'image/webp,image/png,image/jpeg', class: 'sr-only', id: 'logoFile' });
  file.addEventListener('change', () => file.files[0] &&
    act(api('POST', '/api/logo', file.files[0], { 'Content-Type': file.files[0].type || 'application/octet-stream' }), 'Đã đổi logo.').then(loadBrand));
  const form = h('form', { class: 'card' },
    h('h2', { class: 'card-title' }, 'Đơn vị & logo'),
    field('Dòng 1', line1), field('Dòng 2 (tên đơn vị)', line2),
    h('div', { class: 'row' }, preview,
      h('label', { class: 'btn', for: 'logoFile' }, 'Đổi logo (WebP/PNG/JPG, tối đa 2MB)'), file,
      h('button', { class: 'btn', type: 'button', onclick: () => act(api('DELETE', '/api/logo'), 'Đã dùng lại logo mặc định.').then(loadBrand) }, 'Dùng logo mặc định')),
    h('p', { class: 'small muted' }, 'Logo mặc định của phường có sẵn trong phần mềm; chỉ cần đổi khi logo thay đổi.'),
    h('div', null, h('button', { class: 'btn primary', type: 'submit' }, 'Lưu')));
  form.addEventListener('submit', async ev => {
    ev.preventDefault();
    try { await api('PUT', '/api/settings', { org: { line1: line1.value, line2: line2.value } }); toast('Đã lưu.'); loadBrand(); } catch (e) { showErrors(form, e); }
  });
  return form;
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

function systemCard(settings) {
  return card('Thông tin hệ thống', 'Các mục này sửa trong file data\\settings.json trên máy chủ, rồi khởi động lại dịch vụ.',
    h('div', { class: 'small' }, `Cổng màn hình: ${settings.screenPort} · Cổng quản trị: ${settings.adminPort}`),
    h('div', { class: 'small' }, 'Máy được phép quản trị: ' + (settings.adminAllow.includes('0.0.0.0/0') ? 'mọi máy trong mạng'
      : settings.adminAllow.length ? settings.adminAllow.join(', ') : 'chỉ máy chủ')),
    h('div', { class: 'small' }, settings.retentionDays > 0
      ? `Tự xoá dữ liệu cũ hơn ${settings.retentionDays} ngày (cuộc họp, file Excel đã nhập, nhật ký, bản sao lưu).`
      : 'Không tự xoá dữ liệu cũ.'));
}

function auditCard(audit) {
  return card('Nhật ký thao tác', '100 thao tác gần nhất. Toàn bộ nằm trong data\\audit.log.',
    !audit.length ? h('p', { class: 'muted' }, 'Chưa có thao tác nào.') : h('div', { class: 'table-wrap' }, h('table', null,
      h('thead', null, h('tr', null, ['Lúc', 'Máy', 'Thao tác', 'Đối tượng'].map(x => h('th', null, x)))),
      h('tbody', null, audit.map(a => h('tr', null,
        h('td', { style: 'white-space:nowrap' }, `${a.at.slice(11, 16)} ${dmy(a.at.slice(0, 10))}`),
        h('td', { class: 'mono' }, a.ip),
        h('td', null, ACTIONS[a.action] || a.action),
        h('td', { class: 'mono small' }, a.target)))))));
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

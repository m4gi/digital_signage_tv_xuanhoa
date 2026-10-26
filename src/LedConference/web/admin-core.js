// Admin UI building blocks shared by every page: constants, DOM builder h(), API calls, toasts,
// date helpers, form pieces, error display and the hash router.
// All text goes through textContent (h() below), never innerHTML: meeting data comes from Excel files.

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

// name → { list: page(app, arg), item?: page for #/name/arg, tab?: nav item to highlight }. Given by start().
let routes = {};

async function route() {
  clearTimeout(S.timer);
  let [name, arg] = location.hash.replace(/^#\/?/, '').split('/');
  if (name === 'cauhinh') name = 'nhap'; // old bookmark
  const entry = routes[name];
  const page = !entry ? routes.lich.list : arg && entry.item ? entry.item : entry.list;
  const tab = entry ? entry.tab || name : 'lich';
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

// Pages are passed in (admin.js), so adding a page never touches the router.
function start(pages) {
  routes = pages;
  window.addEventListener('hashchange', route);
  route();
  loadBrand();
}

async function act(promise, message) {
  try { await promise; toast(message); route(); } catch (e) { fail(e); }
}

function switchRow(key, label, hint, checked) {
  return h('label', { class: 'switch' },
    h('span', null, h('strong', null, label), h('div', { class: 'small muted' }, hint)),
    h('input', { type: 'checkbox', role: 'switch', name: key, checked, 'aria-label': label }),
    h('span', { class: 'track', 'aria-hidden': 'true' }));
}

export { DAYS, h, pad, iso, parseIso, addDays, dmy, dayLabel, today, field, STATUSES, S, api, toast, fail, weekStart, dm, fold, nowHm, options, showErrors, confirmDelete, route, switchRow, XLSX, card, act, EFFECTS, ORIENTATIONS, EMPTY_DAYS, SKYLINES, copyText, displaySummary, SWITCHES, loadBrand, ACTIONS, start };
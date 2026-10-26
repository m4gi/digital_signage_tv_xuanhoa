// Date and time inputs of the admin page (Vietnamese dd/mm/yyyy calendar, 24-hour times).

import { DAYS, h, pad, iso, parseIso, addDays, dmy, dayLabel, today, field } from './admin-core.js';

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

export { minutesOf, clockOf, duration, datePicker, timePicker };
// Page "Lịch họp": the week, search, and the add / edit meeting form.

import { STATUSES, S, h, api, toast, fail, addDays, weekStart, dmy, dm, dayLabel, today, fold, nowHm, options, field, showErrors, confirmDelete, route, switchRow } from './admin-core.js';
import { minutesOf, clockOf, duration, datePicker, timePicker } from './admin-pickers.js';

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

export { pageSchedule };
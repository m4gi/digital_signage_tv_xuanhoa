// Drawing for the meeting-room screen: theme colors, scaling, the big card, the paged list, the clock and
// the connection line. Knows nothing about where data comes from or when to switch: display.js decides that.
// Plain ES2017 with no optional chaining, no modules: old Android WebViews run it. One global: DisplayRender.
var DisplayRender = (function () {
  'use strict';

  var DAYS = ['Chủ nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];
  var ROW_GAP = 14; // .row margin-bottom in display.css
  var stage = document.getElementById('stage');

  function $(id) { return document.getElementById(id); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function hhmm(d) { return pad(d.getHours()) + ':' + pad(d.getMinutes()); }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function rgb(hex) { var n = parseInt(hex.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
  function rgba(hex, a) { return 'rgba(' + rgb(hex).join(',') + ',' + a + ')'; }
  function luminance(hex) {
    var c = rgb(hex).map(function (x) { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }

  // Theme colors as CSS variables, display switches, org names and logo. server prefixes a relative logo URL.
  function theme(d, server) {
    var s = d.display, t = s.theme, st = stage.style;
    st.setProperty('--angle', t.bgAngle + 'deg');
    st.setProperty('--bg1', t.bg1);
    st.setProperty('--bg2', t.bg2);
    st.setProperty('--ink', t.ink);
    st.setProperty('--muted', t.muted);
    st.setProperty('--accent', t.accent);
    st.setProperty('--onAccent', t.onAccent);
    st.setProperty('--card', t.card);
    st.setProperty('--border', t.cardBorder);
    st.setProperty('--person', t.person);
    st.setProperty('--label', t.label);
    st.setProperty('--num', t.num);
    st.setProperty('--dot', rgba(t.dot, t.dotOpacity));
    st.setProperty('--track', rgba(t.num, 0.15));
    var level = s.skyline === 'strong' ? t.skylineStrongOpacity : s.skyline === 'off' ? 0 : t.skylineOpacity;
    st.setProperty('--skyline', rgba(t.skyline, level));
    // Soft blue shadow on light themes only, per the design spec.
    st.setProperty('--shadow', luminance(t.bg2) > 0.5 ? '0 12px 32px rgba(12,77,162,.12)' : 'none');

    document.body.classList.toggle('nocursor', !!s.hideCursor);
    stage.classList.toggle('nomotion', !!s.reduceMotion);
    $('clock').classList.toggle('hidden', !s.clock);
    $('footer').classList.toggle('hidden', !s.footer);
    $('org1').textContent = d.org.line1;
    $('org2').textContent = d.org.line2;
    var logo = d.org.logoUrl.charAt(0) === '/' ? server + d.org.logoUrl : d.org.logoUrl;
    $('logo').style.backgroundImage = 'url("' + logo + '")';
  }

  // The stage is a fixed 1920x1080 (or 1080x1920) canvas scaled into the window.
  function scale(orientation) {
    var frame = $('screen'), w = frame.clientWidth, h = frame.clientHeight;
    var o = orientation === 'auto' ? (h > w ? 'portrait' : 'landscape') : orientation;
    stage.classList.remove('portrait', 'landscape');
    stage.classList.add(o);
    var sw = o === 'portrait' ? 1080 : 1920, sh = o === 'portrait' ? 1920 : 1080;
    var k = Math.min(w / sw, h / sh);
    stage.style.transform = 'translate(' + (w - sw * k) / 2 + 'px,' + (h - sh * k) / 2 + 'px) scale(' + k + ')';
  }

  function motion() { return !stage.classList.contains('nomotion'); }

  function animate(node, effect) {
    if (!motion()) return;
    node.className = node.className.replace(/\s*enter\b.*$/, '');
    void node.offsetWidth;
    node.className += ' enter ' + effect;
  }

  function dayLabel(iso) {
    var p = iso.split('-');
    return DAYS[new Date(+p[0], p[1] - 1, +p[2]).getDay()] + ' ' + p[2] + '/' + p[1];
  }

  function addMeta(dl, label, value, cls) {
    if (!value) return;
    dl.appendChild(el('dt', null, label));
    dl.appendChild(el('dd', cls || null, value));
  }

  // The big card for a Schedule.pick result. face 0/1 picks the side of the rotating "ĐÃ KẾT THÚC" card;
  // today ('yyyy-mm-dd') tells a next-day meeting apart. Returns a key that changes when the card's content does.
  function status(v, face, today) {
    var box = $('status');
    box.textContent = '';
    var m = v.current;
    if (m) {
      var head = el('div', 'statushead');
      head.appendChild(el('span', 'pill busy', 'ĐANG HỌP'));
      head.appendChild(el('span', 'range', m.start + ' – ' + m.end));
      box.appendChild(head);
      var bar = el('div', 'bar');
      var fill = el('div');
      fill.id = 'fill';
      bar.appendChild(fill);
      box.appendChild(bar);
      var left = el('div', 'left');
      left.id = 'left';
      box.appendChild(left);
      box.appendChild(el('h2', 'title', m.title));
      var dl = el('dl', 'meta');
      addMeta(dl, 'Chủ trì', m.chair, 'chair');
      addMeta(dl, 'Thành phần', m.participants, 'parts');
      addMeta(dl, 'Ghi chú', m.note, 'note');
      addMeta(dl, 'Liên hệ', m.contact, 'contact'); // empty when switched off on the meeting
      if (dl.childNodes.length) box.appendChild(dl);
      return 'busy:' + m.id;
    }

    // Just ended: alternates with the next meeting, or stays alone when nothing follows.
    var e = v.ended;
    if (e && (face === 0 || !v.next)) {
      var endHead = el('div', 'statushead');
      endHead.appendChild(el('span', 'pill ended', 'ĐÃ KẾT THÚC'));
      endHead.appendChild(el('span', 'range', e.start + ' – ' + e.end));
      box.appendChild(endHead);
      box.appendChild(el('h2', 'title', e.title));
      if (e.chair) box.appendChild(el('div', 'sub chair', 'Chủ trì: ' + e.chair));
      return 'ended:' + e.id;
    }

    // v.done: lobby with every room finished for today; v.nextRoom says where the next meeting is.
    box.appendChild(el('span', 'pill free', v.done ? 'HẾT LỊCH HÔM NAY' : 'PHÒNG TRỐNG'));
    var next = v.next;
    if (!next) {
      box.appendChild(el('div', 'sub', v.done ? 'Không còn cuộc họp nào' : 'Không có lịch họp'));
      return 'free';
    }
    box.appendChild(el('div', 'sub', next.date !== today ? 'Cuộc họp tiếp theo ' + dayLabel(next.date) + ' lúc' : 'Cuộc họp tiếp theo lúc'));
    box.appendChild(el('div', 'big', next.start));
    box.appendChild(el('h2', 'title', next.title));
    if (next.chair) box.appendChild(el('div', 'sub chair', 'Chủ trì: ' + next.chair));
    if (next.contact) box.appendChild(el('div', 'sub contact', 'Liên hệ: ' + next.contact));
    if (v.nextRoom) box.appendChild(el('div', 'sub', 'Tại: ' + v.nextRoom.name));
    return 'free:' + next.id;
  }

  // Long titles: shrink the text step by step down to a size still readable from a distance; only then
  // limit lines, least important first (note, participants, then the title). The chair always stays visible.
  function fitStatus() {
    var box = $('status');
    var title = box.querySelector('.title');
    if (!title) return;
    var portrait = stage.classList.contains('portrait');
    var over = function () { return box.scrollHeight > box.clientHeight + 1; };
    var size = portrait ? 60 : 48, minSize = portrait ? 40 : 34;
    while (over() && size > minSize) { size -= 2; title.style.fontSize = size + 'px'; }
    var meta = box.querySelector('.meta');
    var metaSize = portrait ? 30 : 28;
    while (meta && over() && metaSize > 22) { metaSize -= 2; meta.style.fontSize = metaSize + 'px'; }
    ['note', 'parts', 'contact', 'chair'].forEach(function (cls) {
      var dd = box.querySelector('dd.' + cls);
      if (dd && over()) dd.classList.add('clamp1');
    });
    if (over()) title.classList.add('clamp3');
  }

  // Morning/afternoon split at noon, same as the Excel layout (WeekExcelReader.cs).
  function session(m) { return m.start < '12:00' ? 'BUỔI SÁNG' : 'BUỔI CHIỀU'; }

  // Rows are laid out once, measured, and split greedily into pages that fit the list box.
  // A page never mixes sessions: all morning pages come first, then the title switches to the afternoon.
  // Titles are capped at 3 lines in CSS, so one row can never be taller than a page.
  // Returns the pages ([] with the "nothing left" message shown when the list is empty).
  function paginate(list, announcedToday) {
    var rows = $('rows');
    rows.textContent = '';
    if (!list.length) {
      rows.appendChild(el('div', 'empty', announcedToday ? 'Không còn cuộc họp nào khác trong hôm nay' : 'Không còn cuộc họp nào trong hôm nay'));
      $('listTitle').textContent = 'TIẾP THEO HÔM NAY';
      $('page').textContent = '';
      return [];
    }
    var nodes = list.map(function (m) {
      var postponed = m.status === 'postponed';
      var row = el('div', 'row' + (postponed ? ' postponed' : ''));
      row.appendChild(el('div', 't', m.start));
      var body = el('div');
      if (postponed) body.appendChild(el('span', 'tag', 'ĐÃ HOÃN'));
      body.appendChild(el('div', 'n', m.title));
      if (m.chair) body.appendChild(el('div', 'c', 'Chủ trì: ' + m.chair));
      row.appendChild(body);
      rows.appendChild(row);
      return row;
    });
    var pages = [], room = rows.clientHeight + ROW_GAP, used = 0, current = null;
    list.forEach(function (m, i) {
      var h = nodes[i].offsetHeight + ROW_GAP, s = session(m);
      if (current && (current.session !== s || used + h > room)) current = null;
      if (!current) { current = { session: s, items: [] }; pages.push(current); used = 0; }
      current.items.push(nodes[i]);
      used += h;
    });
    rows.textContent = '';
    return pages;
  }

  // Title shows the session; the page count runs within that session ("Trang 2/3" of the morning).
  function showPage(pages, index) {
    var rows = $('rows'), p = pages[index];
    rows.textContent = '';
    p.items.forEach(function (n) { rows.appendChild(n); });
    var same = pages.filter(function (x) { return x.session === p.session; });
    $('listTitle').textContent = 'TIẾP THEO · ' + p.session;
    $('page').textContent = same.length > 1 ? 'Trang ' + (same.indexOf(p) + 1) + '/' + same.length : '';
  }

  // The countdown bar over the list, resumed from `spent` ms so a data refresh does not restart it.
  function bar(on, spent, total) {
    var flipbar = $('flipbar'), fill = flipbar.querySelector('div');
    on = on && motion();
    flipbar.style.visibility = on ? 'visible' : 'hidden';
    if (!on) return;
    spent = Math.min(total, spent);
    fill.style.transition = 'none';
    fill.style.width = spent / total * 100 + '%';
    void fill.offsetWidth;
    fill.style.transition = 'width ' + (total - spent) + 'ms linear';
    fill.style.width = '100%';
  }

  // Time, date and, during a meeting, its progress bar and "Dự kiến còn …".
  function clock(n, current) {
    $('time').textContent = hhmm(n);
    $('date').textContent = DAYS[n.getDay()] + ', ' + pad(n.getDate()) + '/' + pad(n.getMonth() + 1) + '/' + n.getFullYear();
    var fill = $('fill');
    if (current && fill) {
      var t = n.getHours() * 60 + n.getMinutes() + n.getSeconds() / 60;
      var a = Schedule.minutes(current.start), b = Schedule.minutes(current.end);
      fill.style.width = Math.min(100, Math.max(0, (t - a) / (b - a) * 100)) + '%';
      var rest = Math.max(0, Math.ceil(b - t));
      $('left').textContent = 'Dự kiến còn ' + (rest >= 60 ? Math.floor(rest / 60) + ' giờ ' + rest % 60 + ' phút' : rest + ' phút');
    }
  }

  // why: a short reason (HTTP code or error name) so a technician can tell "server down" from "page error".
  function connection(ok, lastOk, why) {
    var c = $('conn');
    c.classList.toggle('off', !ok);
    c.textContent = ok
      ? '● Cập nhật ' + hhmm(lastOk)
      : 'Mất kết nối' + (why ? ' (' + why + ')' : '') + ' – đang hiện lịch lúc ' + (lastOk ? hhmm(lastOk) : '--:--');
  }

  // Room name, the "LỊCH HỌP · PHÒNG 2/5" line, the tab title and the footer note.
  function heading(name, kicker, title, note) {
    $('room').textContent = name;
    $('kicker').textContent = kicker;
    document.title = title;
    $('note').textContent = note;
  }

  function message(text) { $('room').textContent = text; }

  return {
    theme: theme, scale: scale, animate: animate, status: status, fitStatus: fitStatus, paginate: paginate,
    showPage: showPage, bar: bar, clock: clock, connection: connection, heading: heading, message: message,
    node: $,
  };
})();

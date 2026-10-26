// Meeting-room screen. Polls /api/screens/{code} every 60s; clock runs on server time.
// What to show is re-picked every second from the day's list (schedule.js), so it changes on time even offline.
// Plain ES2017 with no optional chaining so old Android WebViews can run it.
(function () {
  'use strict';

  var POLL_MS = 60000;
  var PAGE_MS = 10000;
  var ROW_GAP = 14; // .row margin-bottom in display.css
  var DAYS = ['Chủ nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];

  // Served by the server as /room/{code}, or bundled in the screen app as display.html?server=http://ip:port&room=CODE.
  var params = new URLSearchParams(location.search);
  var server = (params.get('server') || '').replace(/\/+$/, '');
  var code = params.get('room') || decodeURIComponent(location.pathname.split('/').pop() || '');
  // Tells the server who is asking, for the admin's screen status: the APK, a browser/Fully Kiosk, or the admin preview.
  var client = params.get('preview') ? 'preview' : params.get('client') === 'apk' || server ? 'apk' : 'web';
  var stage = document.getElementById('stage');
  var data = null, version = null, offset = 0, lastOk = null, statusKey = null, page = 0, pages = [];
  var view = null, viewKey = null; // Schedule.pick result and what it is made of
  var face = 0, faceStart = Date.now(); // rotating big card after a meeting: 0 = ĐÃ KẾT THÚC, 1 = next meeting
  var flipStart = Date.now(); // when the current page appeared; re-renders keep it, only a flip resets it
  var orientation = 'auto', effect = 'fadeUp', started = Date.now();

  function $(id) { return document.getElementById(id); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function hhmm(d) { return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function now() { return new Date(Date.now() + offset); }
  var minutes = Schedule.minutes;
  function isoDate(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  // "2026-10-22T08:42:15" is server wall-clock time; parse it as local, never as UTC.
  function parseLocal(s) {
    var m = /(\d+)-(\d+)-(\d+)T(\d+):(\d+):(\d+)/.exec(s);
    return new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  }

  function rgb(hex) { var n = parseInt(hex.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
  function rgba(hex, a) { return 'rgba(' + rgb(hex).join(',') + ',' + a + ')'; }
  function luminance(hex) {
    var c = rgb(hex).map(function (x) { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }

  function applyDisplay(d) {
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

    orientation = s.orientation;
    effect = s.effect;
    document.body.classList.toggle('nocursor', !!s.hideCursor);
    stage.classList.toggle('nomotion', !!s.reduceMotion);
    $('clock').classList.toggle('hidden', !s.clock);
    $('footer').classList.toggle('hidden', !s.footer);
    $('org1').textContent = d.org.line1;
    $('org2').textContent = d.org.line2;
    var logo = d.org.logoUrl.charAt(0) === '/' ? server + d.org.logoUrl : d.org.logoUrl;
    $('logo').style.backgroundImage = 'url("' + logo + '")';
    layout();
  }

  function layout() {
    var frame = $('screen'), w = frame.clientWidth, h = frame.clientHeight;
    var o = orientation === 'auto' ? (h > w ? 'portrait' : 'landscape') : orientation;
    stage.classList.remove('portrait', 'landscape');
    stage.classList.add(o);
    var sw = o === 'portrait' ? 1080 : 1920, sh = o === 'portrait' ? 1920 : 1080;
    var k = Math.min(w / sw, h / sh);
    stage.style.transform = 'translate(' + (w - sw * k) / 2 + 'px,' + (h - sh * k) / 2 + 'px) scale(' + k + ')';
    if (data) render(data); // sizes differ between portrait and landscape: fit again
  }

  function animate(node) {
    if (stage.classList.contains('nomotion')) return;
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

  function renderStatus(v) {
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

    // Just ended: alternates with the next meeting every PAGE_MS (see tick), or stays alone when nothing follows.
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

    box.appendChild(el('span', 'pill free', 'PHÒNG TRỐNG'));
    var next = v.next;
    if (!next) {
      box.appendChild(el('div', 'sub', 'Không có lịch họp'));
      return 'free';
    }
    box.appendChild(el('div', 'sub', next.date !== isoDate(now()) ? 'Cuộc họp tiếp theo ' + dayLabel(next.date) + ' lúc' : 'Cuộc họp tiếp theo lúc'));
    box.appendChild(el('div', 'big', next.start));
    box.appendChild(el('h2', 'title', next.title));
    if (next.chair) box.appendChild(el('div', 'sub chair', 'Chủ trì: ' + next.chair));
    if (next.contact) box.appendChild(el('div', 'sub contact', 'Liên hệ: ' + next.contact));
    return 'free:' + next.id;
  }

  // Long titles: shrink the text step by step down to a size still readable from a distance; only then
  // limit lines, least important first (note, participants, then the title). The chair always stays visible.
  function fitStatus(box) {
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

  // Morning/afternoon split at noon, same as the Excel layout (WeekExcel.cs).
  function session(m) { return m.start < '12:00' ? 'BUỔI SÁNG' : 'BUỔI CHIỀU'; }

  // Rows are laid out once, measured, and split greedily into pages that fit the list box.
  // A page never mixes sessions: all morning pages come first, then the title switches to the afternoon.
  // Titles are capped at 3 lines in CSS, so one row can never be taller than a page.
  function renderRows() {
    var rows = $('rows');
    var list = view.rows; // the meeting announced on the big card is left out
    rows.textContent = '';
    pages = [];
    if (!list.length) {
      var announced = view.next && view.next.date === isoDate(now());
      rows.appendChild(el('div', 'empty', announced ? 'Không còn cuộc họp nào khác trong hôm nay' : 'Không còn cuộc họp nào trong hôm nay'));
      $('listTitle').textContent = 'TIẾP THEO HÔM NAY';
      $('page').textContent = '';
      startBar();
      return;
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
    var room = rows.clientHeight + ROW_GAP, used = 0, current = null;
    list.forEach(function (m, i) {
      var h = nodes[i].offsetHeight + ROW_GAP, s = session(m);
      if (current && (current.session !== s || used + h > room)) current = null;
      if (!current) { current = { session: s, items: [] }; pages.push(current); used = 0; }
      current.items.push(nodes[i]);
      used += h;
    });
    rows.textContent = '';
    if (page >= pages.length) page = 0;
    showPage();
  }

  // Title shows the session; the page count runs within that session ("Trang 2/3" of the morning).
  function showPage() {
    var rows = $('rows'), p = pages[page];
    rows.textContent = '';
    p.items.forEach(function (n) { rows.appendChild(n); });
    var same = pages.filter(function (x) { return x.session === p.session; });
    $('listTitle').textContent = 'TIẾP THEO · ' + p.session;
    $('page').textContent = same.length > 1 ? 'Trang ' + (same.indexOf(p) + 1) + '/' + same.length : '';
    startBar();
  }

  function flip() {
    var before = pages[page].session;
    page = (page + 1) % pages.length;
    flipStart = Date.now();
    showPage();
    animate($('rows'));
    if (pages[page].session !== before) animate($('listTitle')); // morning → afternoon: the title moves too
  }

  // The bar resumes from the time already spent on this page, so a data refresh does not restart it.
  function startBar() {
    var bar = $('flipbar'), fill = bar.querySelector('div');
    var on = pages.length > 1 && !stage.classList.contains('nomotion');
    bar.style.visibility = on ? 'visible' : 'hidden';
    if (!on) return;
    var spent = Math.min(PAGE_MS, Date.now() - flipStart);
    fill.style.transition = 'none';
    fill.style.width = spent / PAGE_MS * 100 + '%';
    void fill.offsetWidth;
    fill.style.transition = 'width ' + (PAGE_MS - spent) + 'ms linear';
    fill.style.width = '100%';
  }

  // Picks from the last data at the current server time. Servers older than the `today` field only send
  // the rest of today and `next`; that still works, minus the "ĐÃ KẾT THÚC" card.
  function choose() {
    var n = now();
    var today = data.today || [data.current].concat(data.upcoming).filter(Boolean);
    var nextDay = data.today ? data.nextDay : data.next;
    return Schedule.pick(today, nextDay || null, isoDate(n), n.getHours() * 60 + n.getMinutes() + n.getSeconds() / 60);
  }

  function keyOf(v) {
    var id = function (m) { return m ? m.id : ''; };
    return [id(v.current), id(v.ended), id(v.next), v.rows.map(id).join(',')].join('|');
  }

  // Fill every text that changes a box's height (footer, "Dự kiến còn …") before measuring anything.
  function render(d) {
    $('room').textContent = d.room.name;
    document.title = d.room.name + ' – Lịch họp';
    $('note').textContent = d.display.footerNote || '';
    view = choose();
    var k = keyOf(view);
    if (k !== viewKey) { viewKey = k; face = 0; faceStart = Date.now(); } // a meeting just ended: start on ĐÃ KẾT THÚC
    showStatus();
    renderRows();
  }

  function showStatus() {
    var key = renderStatus(view);
    clock();
    fitStatus($('status'));
    if (key !== statusKey) {
      animate($('status'));
      statusKey = key;
    }
  }

  // why: a short reason (HTTP code or error name) so a technician can tell "server down" from "page error".
  function setConnection(ok, why) {
    var c = $('conn');
    c.classList.toggle('off', !ok);
    c.textContent = ok
      ? '● Cập nhật ' + hhmm(lastOk)
      : 'Mất kết nối' + (why ? ' (' + why + ')' : '') + ' – đang hiện lịch lúc ' + (lastOk ? hhmm(lastOk) : '--:--');
  }

  // Every second: meetings start and end on time without waiting for the next poll, and the
  // "ĐÃ KẾT THÚC" card trades places with the next meeting every PAGE_MS.
  function tick() {
    clock();
    if (!data) return;
    if (keyOf(choose()) !== viewKey) { render(data); return; }
    if (view.ended && view.next && Date.now() - faceStart >= PAGE_MS) {
      face = 1 - face;
      faceStart = Date.now();
      showStatus();
    }
  }

  function clock() {
    var n = now();
    $('time').textContent = hhmm(n);
    $('date').textContent = DAYS[n.getDay()] + ', ' + pad(n.getDate()) + '/' + pad(n.getMonth() + 1) + '/' + n.getFullYear();
    var m = view && view.current, fill = $('fill');
    if (m && fill) {
      var t = n.getHours() * 60 + n.getMinutes() + n.getSeconds() / 60;
      var a = minutes(m.start), b = minutes(m.end);
      fill.style.width = Math.min(100, Math.max(0, (t - a) / (b - a) * 100)) + '%';
      var rest = Math.max(0, Math.ceil(b - t));
      $('left').textContent = 'Dự kiến còn ' + (rest >= 60 ? Math.floor(rest / 60) + ' giờ ' + rest % 60 + ' phút' : rest + ' phút');
    }
    // Reload once a night so a page left running for weeks starts fresh.
    if (n.getHours() === 3 && n.getMinutes() === 0 && Date.now() - started > 3600000) location.reload();
  }

  function load() {
    // No fetch options: old Android WebViews reject cache modes they do not know. The server answers no-store,
    // and the time stamp keeps any proxy from reusing an old answer.
    fetch(server + '/api/screens/' + encodeURIComponent(code) + '?client=' + client + '&t=' + Date.now())
      .then(function (r) {
        if (r.status === 404) throw 404;
        if (!r.ok) throw r.status;
        return r.json();
      })
      .then(function (d) {
        offset = parseLocal(d.serverTime) - Date.now();
        if (d.configVersion !== version) {
          version = d.configVersion;
          applyDisplay(d);
        }
        data = d;
        lastOk = now();
        setConnection(true);
        render(d);
      })
      .catch(function (e) {
        if (e === 404) $('room').textContent = 'Không có phòng “' + code + '”';
        setConnection(false, typeof e === 'number' ? 'mã ' + e : e && e.name);
      });
  }

  window.addEventListener('resize', layout);
  layout();
  tick();
  load();
  setInterval(load, POLL_MS);
  setInterval(tick, 1000);
  setInterval(function () {
    if (pages.length < 2) { flipStart = Date.now(); return; }
    if (Date.now() - flipStart >= PAGE_MS) flip();
  }, 250);
})();

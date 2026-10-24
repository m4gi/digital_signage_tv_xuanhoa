// Demo only: stands in for LedConference.exe so the real display and admin pages run as static files.
// Intercepts fetch('/api/...') and answers from sample data kept in localStorage (shared by the
// display and admin frames, so edits in admin show on the screens at their next 60s poll).
// Mirrors the server's behaviour closely enough to click through; it is not the server.
(function () {
  'use strict';

  var KEY = 'ledConference.demo.v2'; // bumped when the sample data shape changes
  var DEFAULT_DISPLAY = {
    theme: 'official', orientation: 'auto', effect: 'fadeUp', clock: true, footer: true,
    reduceMotion: false, hideCursor: true, footerNote: '', emptyDay: 'nextMeeting', skyline: 'normal',
    contactEnabled: false, contact: '',
  };
  // Same values as Theme.BuiltIn in Models.cs.
  var BUILTIN = [
    { id: 'official', name: 'Chính thức', bgAngle: 180, bg1: '#D0EDFF', bg2: '#8ACAFF', ink: '#0B2545', muted: '#2A4A73',
      accent: '#FFC72C', onAccent: '#0B2545', card: 'rgba(255,255,255,.62)', cardBorder: 'rgba(255,255,255,.95)',
      person: '#0A3D82', label: '#7A5600', num: '#0C4DA2', dot: '#0B2545', dotOpacity: 0.04,
      skyline: '#FFFFFF', skylineOpacity: 0.4, skylineStrongOpacity: 0.7 },
    { id: 'formal', name: 'Trang trọng', bgAngle: 135, bg1: '#6E0A10', bg2: '#B8131A', ink: '#FFF6DC', muted: '#F4D8A0',
      accent: '#FFD04D', onAccent: '#5A0B0F', card: 'rgba(255,208,77,.10)', cardBorder: 'rgba(255,208,77,.40)',
      person: '#FFF6DC', label: '#FFD04D', num: '#FFD04D', dot: '#FFD04D', dotOpacity: 0.08,
      skyline: '#FFD04D', skylineOpacity: 0.12, skylineStrongOpacity: 0.2 },
    { id: 'modern', name: 'Hiện đại', bgAngle: 135, bg1: '#F3F7FC', bg2: '#E3EDF9', ink: '#0B2545', muted: '#566883',
      accent: '#FFC72C', onAccent: '#0B2545', card: '#FFFFFF', cardBorder: '#D5E1F0',
      person: '#0C4DA2', label: '#B88A00', num: '#0C4DA2', dot: '#0C4DA2', dotOpacity: 0.04,
      skyline: '#0C4DA2', skylineOpacity: 0.08, skylineStrongOpacity: 0.14 },
  ];

  // ---------- small helpers ----------

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function iso(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parseIso(s) { var p = s.split('-'); return new Date(+p[0], p[1] - 1, +p[2]); }
  function addDays(s, n) { var d = parseIso(s); d.setDate(d.getDate() + n); return iso(d); }
  function weekStart(s) { var d = parseIso(s); d.setDate(d.getDate() - (d.getDay() + 6) % 7); return iso(d); }
  function hm(m) { m = Math.max(0, Math.min(1439, m)); return pad(Math.floor(m / 60)) + ':' + pad(m % 60); }
  function nowMinutes() { var d = new Date(); return d.getHours() * 60 + d.getMinutes(); }
  function norm(s) { return String(s || '').normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase(); }
  function matches(room, place) {
    var p = norm(place);
    return p.length > 0 && (norm(room.name) === p || room.places.some(function (x) { return norm(x) === p; }));
  }
  function roomOf(st, place) { return st.rooms.find(function (r) { return matches(r, place); }) || null; }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function id(prefix) { return prefix + Math.random().toString(16).slice(2, 12); }
  function hash(s) { var h = 0; for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return (h >>> 0).toString(16); }

  // ---------- sample data, laid out around the current time so "Đang họp" shows ----------

  function seed() {
    var today = iso(new Date()), ws = weekStart(today);
    var s0 = Math.max(0, Math.floor((nowMinutes() - 40) / 30) * 30); // a meeting that started ~40 min ago
    var at = new Date().toISOString().slice(0, 19);
    var meetings = [];
    function add(date, start, end, title, chair, place, extra) {
      meetings.push(Object.assign({
        id: id('m_'), date: date, start: hm(start), end: hm(end), endEstimated: false, title: title, chair: chair || '',
        participants: '', note: '', place: place, status: 'normal', source: 'excel', importId: 'imp_mau',
        updatedAt: at, updatedBy: '192.168.1.20',
      }, extra || {}));
    }
    add(today, s0, s0 + 120, 'Giao ban tuần và triển khai nhiệm vụ trọng tâm', 'Chủ tịch UBND phường', 'Phòng họp tầng 2',
      { participants: 'Lãnh đạo UBND, trưởng các phòng chuyên môn', note: 'Các phòng chuẩn bị báo cáo tuần' });
    add(today, s0 + 150, s0 + 210, 'Họp triển khai kế hoạch chuyển đổi số', 'Phó Chủ tịch UBND phường', 'Phòng họp số 2',
      { source: 'manual', importId: null });
    add(today, s0 + 240, s0 + 300, 'Họp chuẩn bị hội nghị cuối năm', 'Chánh Văn phòng', 'Phòng họp tầng 2', { status: 'postponed' });
    add(today, s0 + 60, s0 + 120, 'Rà soát hồ sơ đất đai tồn đọng', 'Trưởng phòng Kinh tế', 'PH tầng 1', { endEstimated: true });
    add(today, s0, s0 + 120,
      'Hội nghị sơ kết công tác 9 tháng đầu năm và triển khai phương hướng, nhiệm vụ trọng tâm 3 tháng cuối năm của Ủy ban nhân dân phường Xuân Hòa',
      'Chủ tịch Ủy ban nhân dân phường', 'Phòng tiếp công dân',
      { participants: 'Lãnh đạo Đảng ủy, HĐND, UBND, Ủy ban MTTQ phường; trưởng các phòng, ban; trưởng khu phố', note: 'Các đơn vị gửi báo cáo trước 2 ngày' });
    add(today, s0 + 120, s0 + 150, 'Họp Ban chỉ đạo chuyển đổi số về triển khai Đề án 06 và dịch vụ công trực tuyến toàn trình',
      'Phó Chủ tịch UBND phường', 'Phòng tiếp công dân');
    add(today, s0 + 150, s0 + 180, 'Tiếp công dân định kỳ', 'Chủ tịch UBND phường', 'Phòng tiếp công dân');
    add(today, s0 + 180, s0 + 210, 'Làm việc với đoàn kiểm tra liên ngành của Thành phố về công tác phòng cháy chữa cháy tại các cơ sở kinh doanh trên địa bàn phường',
      'Chủ tịch UBND phường', 'Phòng tiếp công dân');
    add(today, s0 + 210, s0 + 240, 'Họp tổ công tác cải cách hành chính', 'Chánh Văn phòng', 'Phòng tiếp công dân');
    add(ws, 480, 570, 'Giao ban đầu tuần', 'Chủ tịch UBND phường', 'Phòng họp tầng 2');
    add(addDays(ws, 2), 840, 930, 'Họp Ban chỉ đạo phòng chống thiên tai', 'Phó Chủ tịch UBND phường', 'Phòng họp tầng 2');
    add(addDays(today, 1), 510, 600, 'Hội nghị tuyên truyền phổ biến pháp luật', 'Trưởng phòng Văn hóa – Xã hội', 'Hội trường UBND phường');
    add(addDays(today, 1), 840, 960, 'Họp liên tịch giải quyết kiến nghị cử tri', 'Chủ tịch UBND phường', 'Phòng họp tầng 1');

    return {
      seededFor: today,
      settings: {
        screenPort: 8080, adminPort: 8081, adminAllow: ['0.0.0.0/0', '::/0'],
        org: { line1: 'ỦY BAN NHÂN DÂN', line2: 'PHƯỜNG XUÂN HÒA' },
        display: Object.assign(clone(DEFAULT_DISPLAY), { contactEnabled: true, contact: 'Văn phòng HĐND – UBND phường' }),
        morning: { start: '07:30', end: '11:30' }, afternoon: { start: '13:30', end: '17:30' },
        ignoredPlaces: [], logoVersion: 0,
      },
      rooms: [
        { code: 'P201', name: 'Phòng họp tầng 2', places: ['Phòng họp số 2'], display: {} },
        { code: 'P101', name: 'Phòng họp tầng 1', places: ['PH tầng 1'],
          display: { theme: 'modern', footerNote: 'Đề nghị tắt chuông điện thoại khi vào phòng họp' } },
        { code: 'PTD', name: 'Phòng tiếp dân', places: ['Phòng tiếp công dân'], display: { theme: 'formal' } },
      ],
      meetings: meetings,
      themes: clone(BUILTIN),
      imports: [{ id: 'imp_mau', at: at, ip: '192.168.1.20', fileName: 'Lichdonvi_mau.xlsx', from: ws, to: addDays(ws, 6), total: meetings.length - 1 }],
      audit: [{ at: at, ip: '192.168.1.20', action: 'import', target: 'imp_mau' }],
    };
  }

  var memory = null;
  function load() {
    var st = memory;
    try { st = JSON.parse(localStorage.getItem(KEY)) || st; } catch (e) { /* storage blocked: keep in memory */ }
    if (!st || st.seededFor !== iso(new Date())) { st = seed(); save(st); }
    return st;
  }
  function save(st) {
    memory = st;
    try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) { /* in-memory only */ }
  }
  window.ledDemoReset = function () { save(seed()); };

  // ---------- responses ----------

  function ok(body) { return { status: 200, body: body }; }
  function none() { return { status: 204, body: null }; }
  function problem(status, title, detail, extra) { return { status: status, body: Object.assign({ status: status, title: title, detail: detail }, extra || {}) }; }
  function invalid(errors) { return { status: 400, body: { status: 400, title: 'Dữ liệu không hợp lệ', errors: errors } }; }
  function audit(st, action, target) {
    st.audit.unshift({ at: new Date().toISOString().slice(0, 19), ip: '192.168.1.20', action: action, target: target });
    st.audit = st.audit.slice(0, 200);
  }
  function globalDisplay(st) { return Object.assign({}, DEFAULT_DISPLAY, st.settings.display); }
  function effective(st, room) {
    var s = globalDisplay(st), own = room.display || {};
    Object.keys(own).forEach(function (k) { if (own[k] != null) s[k] = own[k]; });
    return s;
  }
  function pub(m) {
    return m && { id: m.id, date: m.date, start: m.start, end: m.end, endEstimated: m.endEstimated, title: m.title,
      chair: m.chair, participants: m.participants, note: m.note, status: m.status };
  }
  function adminView(st, m) { var r = roomOf(st, m.place); return Object.assign({}, m, { roomCode: r ? r.code : null }); }
  function byTime(a, b) { return (a.date + a.start).localeCompare(b.date + b.start); }

  function screen(st, code) {
    var room = st.rooms.find(function (r) { return r.code === code.toUpperCase(); });
    if (!room) {
      var q = new URLSearchParams(location.search).get('room');
      room = q && st.rooms.find(function (r) { return r.code === q.toUpperCase(); });
    }
    if (!room) return problem(404, 'Không tìm thấy phòng', "Không có phòng mã '" + code + "'.");
    var s = effective(st, room);
    var theme = st.themes.find(function (t) { return t.id === s.theme; }) || st.themes[0];
    var now = new Date(), today = iso(now), t = hm(nowMinutes()), ws = weekStart(today);
    var list = st.meetings.filter(function (m) { return m.status !== 'cancelled' && matches(room, m.place); }).sort(byTime);
    var todays = list.filter(function (m) { return m.date === today; });
    var current = todays.find(function (m) { return m.status === 'normal' && m.start <= t && t < m.end; }) || null;
    var upcoming = todays.filter(function (m) { return m !== current && m.end > t; });
    var next = !current && !upcoming.length && s.emptyDay === 'nextMeeting' ? list.find(function (m) { return m.date > today; }) || null : null;
    var org = { line1: st.settings.org.line1, line2: st.settings.org.line2, logoUrl: 'logo.webp?v=' + st.settings.logoVersion, customLogo: false };
    var display = Object.assign({}, s, { theme: theme, contact: s.contactEnabled ? s.contact : '' });
    delete display.contactEnabled;
    return ok({
      apiVersion: 1, room: { code: room.code, name: room.name }, org: org,
      serverTime: today + 'T' + pad(now.getHours()) + ':' + pad(now.getMinutes()) + ':' + pad(now.getSeconds()),
      week: { from: ws, to: addDays(ws, 6) }, configVersion: hash(JSON.stringify([display, org])),
      display: display, current: pub(current), upcoming: upcoming.map(pub), next: pub(next),
    });
  }

  function checkMeeting(st, b) {
    var e = {};
    if (!b.date) e.date = ['Thiếu ngày.'];
    if (!b.start) e.start = ['Thiếu giờ bắt đầu.'];
    if (!b.end) e.end = ['Thiếu giờ kết thúc.'];
    else if (b.start && b.end <= b.start) e.end = ['Giờ kết thúc phải sau giờ bắt đầu.'];
    if (!String(b.title || '').trim()) e.title = ['Thiếu nội dung cuộc họp.'];
    var place = String(b.place || '').trim();
    if (b.roomCode) {
      var r = st.rooms.find(function (x) { return x.code === b.roomCode; });
      if (!r) e.roomCode = ["Không có phòng mã '" + b.roomCode + "'."]; else place = r.name;
    } else if (!place) e.place = ['Chọn phòng hoặc nhập địa điểm.'];
    return { errors: e, place: place };
  }
  function warnings(st, m) {
    var room = roomOf(st, m.place);
    if (!room || m.status !== 'normal') return [];
    return st.meetings.filter(function (o) {
      return o.id !== m.id && o.date === m.date && o.status === 'normal' && o.start < m.end && m.start < o.end && matches(room, o.place);
    }).map(function (o) {
      return { code: 'overlap', message: 'Trùng giờ với “' + o.title + '” (' + o.start + ' – ' + o.end + ') tại ' + room.code + '.', meetingId: o.id };
    });
  }
  function contrast(t) {
    function lum(hex) {
      var n = parseInt(hex.slice(1), 16);
      return [n >> 16 & 255, n >> 8 & 255, n & 255].map(function (x) { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); })
        .reduce(function (s, c, i) { return s + c * [0.2126, 0.7152, 0.0722][i]; }, 0);
    }
    function ratio(a, b) { var x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
    return Math.round(Math.min(ratio(t.ink, t.bg1), ratio(t.ink, t.bg2)) * 10) / 10;
  }
  function themeView(st, t) {
    var builtin = BUILTIN.find(function (b) { return b.id === t.id; });
    var global = globalDisplay(st).theme;
    return {
      id: t.id, name: t.name, builtIn: !!builtin, modified: !!builtin && JSON.stringify(builtin) !== JSON.stringify(t),
      usedGlobally: global === t.id,
      usedBy: st.rooms.filter(function (r) { return ((r.display || {}).theme || global) === t.id; }).map(function (r) { return r.code; }),
      contrast: contrast(t), tokens: t,
    };
  }

  function handle(method, path, q, b) {
    var st = load(), m, r, parts = path.split('/').slice(2).map(decodeURIComponent); // ['screens','P201'] ...
    var today = iso(new Date());
    var route = method + ' ' + parts[0] + (parts.length > 1 ? '/:' : '') + (parts.length > 2 ? '/' + parts[2] : '');
    switch (route) {
      case 'GET screens/:': return screen(st, parts[1]);

      case 'GET rooms':
        return ok(st.rooms.map(function (x) {
          return Object.assign({}, x, {
            todayCount: st.meetings.filter(function (mm) { return mm.date === today && mm.status !== 'cancelled' && matches(x, mm.place); }).length,
            screenUrl: 'display.html?room=' + x.code,
          });
        }));
      case 'POST rooms':
      case 'PUT rooms/:': {
        var creating = method === 'POST', code = creating ? String(b.code || '').trim().toUpperCase() : parts[1];
        var e = {};
        if (creating && !/^[A-Z0-9_-]{1,32}$/.test(code)) e.code = ['Mã phòng chỉ gồm chữ không dấu, số, - hoặc _, tối đa 32 ký tự.'];
        if (!String(b.name || '').trim()) e.name = ['Thiếu tên phòng.'];
        if (Object.keys(e).length) return invalid(e);
        var exists = st.rooms.find(function (x) { return x.code === code; });
        if (creating && exists) return problem(409, 'Mã phòng đã có', "Đã có phòng mã '" + code + "'.");
        if (!creating && !exists) return problem(404, 'Không tìm thấy phòng', code);
        var room = { code: code, name: b.name.trim(), places: (b.places || []).filter(Boolean), display: b.display || {} };
        if (creating) st.rooms.push(room); else st.rooms[st.rooms.indexOf(exists)] = room;
        audit(st, creating ? 'room.create' : 'room.update', code); save(st);
        return ok(room);
      }
      case 'DELETE rooms/:':
        st.rooms = st.rooms.filter(function (x) { return x.code !== parts[1]; });
        audit(st, 'room.delete', parts[1]); save(st);
        return none();

      case 'GET meetings': {
        var from = q.get('from') || weekStart(today), to = q.get('to') || addDays(from, 6), rc = q.get('room');
        r = rc && st.rooms.find(function (x) { return x.code === rc; });
        return ok({ from: from, to: to, items: st.meetings
          .filter(function (mm) { return mm.date >= from && mm.date <= to && (!r || matches(r, mm.place)); })
          .sort(byTime).map(function (mm) { return adminView(st, mm); }) });
      }
      case 'POST meetings':
      case 'PUT meetings/:': {
        var c = checkMeeting(st, b);
        if (Object.keys(c.errors).length) return invalid(c.errors);
        var old = method === 'PUT' && st.meetings.find(function (x) { return x.id === parts[1]; });
        if (method === 'PUT' && !old) return problem(404, 'Không tìm thấy cuộc họp', parts[1]);
        m = Object.assign({}, old || { id: id('m_'), importId: null }, {
          date: b.date, start: b.start, end: b.end, endEstimated: false, title: b.title.trim(), chair: (b.chair || '').trim(),
          participants: (b.participants || '').trim(), note: (b.note || '').trim(), place: c.place, status: b.status || 'normal',
          source: 'manual', updatedAt: new Date().toISOString().slice(0, 19), updatedBy: '192.168.1.20',
        });
        if (old) st.meetings[st.meetings.indexOf(old)] = m; else st.meetings.push(m);
        audit(st, old ? 'meeting.update' : 'meeting.create', m.id); save(st);
        return ok({ meeting: adminView(st, m), warnings: warnings(st, m) });
      }
      case 'DELETE meetings/:':
        st.meetings = st.meetings.filter(function (x) { return x.id !== parts[1]; });
        audit(st, 'meeting.delete', parts[1]); save(st);
        return none();

      case 'POST import': {
        // The demo cannot read Excel; it answers as if this week's sample file was imported again.
        var ws = weekStart(today), week = st.meetings.filter(function (x) { return x.date >= ws && x.date <= addDays(ws, 6); });
        var imp = { id: id('imp_'), at: new Date().toISOString().slice(0, 19), ip: '192.168.1.20', fileName: 'Lichdonvi_mau.xlsx', from: ws, to: addDays(ws, 6), total: week.length };
        st.imports.unshift(imp); audit(st, 'import', imp.id); save(st);
        return ok({
          importId: imp.id, week: { from: ws, to: addDays(ws, 6) }, total: week.length, replaced: week.length,
          byRoom: st.rooms.map(function (x) { return { roomCode: x.code, name: x.name, count: week.filter(function (mm) { return matches(x, mm.place); }).length }; })
            .filter(function (x) { return x.count > 0; }),
          unassigned: [], estimatedEnds: week.filter(function (x) { return x.endEstimated; }).length,
        });
      }
      case 'GET imports': return ok(st.imports);

      case 'GET places/:': // /api/places/unassigned
        var since = weekStart(today), ignored = st.settings.ignoredPlaces.map(norm), groups = {};
        st.meetings.forEach(function (x) {
          if (x.date < since || x.status === 'cancelled' || ignored.indexOf(norm(x.place)) >= 0 || roomOf(st, x.place)) return;
          var k = norm(x.place);
          groups[k] = groups[k] || { place: x.place, count: 0, firstDate: x.date };
          groups[k].count++;
          if (x.date < groups[k].firstDate) groups[k].firstDate = x.date;
        });
        return ok(Object.keys(groups).map(function (k) { return groups[k]; }));
      case 'POST places/:': // assign | ignore
        if (parts[1] === 'assign') {
          r = st.rooms.find(function (x) { return x.code === String(b.roomCode || '').toUpperCase(); });
          if (!r) return problem(404, 'Không tìm thấy phòng', b.roomCode);
          var other = roomOf(st, b.place);
          if (other && other !== r) return problem(409, 'Địa điểm đã gán', '“' + b.place + '” đang thuộc phòng ' + other.code + '.');
          if (!other) r.places.push(b.place);
        } else st.settings.ignoredPlaces.push(b.place);
        audit(st, 'place.' + parts[1], b.place); save(st);
        return parts[1] === 'assign' ? ok(r) : none();
      case 'DELETE places/:':
        st.settings.ignoredPlaces = st.settings.ignoredPlaces.filter(function (p) { return norm(p) !== norm(q.get('place')); });
        save(st);
        return none();

      case 'GET settings': return ok(Object.assign({}, st.settings, { display: globalDisplay(st) }));
      case 'PUT settings':
        ['org', 'display', 'morning', 'afternoon'].forEach(function (k) { if (b[k]) st.settings[k] = b[k]; });
        audit(st, 'settings.update', 'settings'); save(st);
        return ok(st.settings);

      case 'GET themes': return ok({ fileError: null, items: st.themes.map(function (t) { return themeView(st, t); }) });
      case 'PUT themes/:': {
        var e2 = {};
        Object.keys(b).forEach(function (k) {
          if (['card', 'cardBorder'].indexOf(k) < 0 && /^(bg1|bg2|ink|muted|accent|onAccent|person|label|num|dot|skyline)$/.test(k) && !/^#[0-9a-f]{6}$/i.test(b[k]))
            e2[k] = ['Màu phải có dạng #RRGGBB.'];
        });
        if (Object.keys(e2).length) return invalid(e2);
        var i = st.themes.findIndex(function (t) { return t.id === parts[1]; });
        st.themes[i] = Object.assign({}, b, { id: parts[1] });
        audit(st, 'theme.update', parts[1]); save(st);
        return ok(themeView(st, st.themes[i]));
      }
      case 'POST themes': {
        var src = st.themes.find(function (t) { return t.id === (b.from || 'official'); });
        var t2 = Object.assign({}, src, { id: id('mau-').slice(0, 10), name: (b.name || src.name + ' (bản sao)').slice(0, 50) });
        st.themes.push(t2); audit(st, 'theme.create', t2.id); save(st);
        return ok(themeView(st, t2));
      }
      case 'DELETE themes/:': {
        var tv = themeView(st, st.themes.find(function (t) { return t.id === parts[1]; }));
        if (tv.builtIn) return problem(400, 'Không xoá được mẫu gốc', 'Mẫu gốc chỉ có thể khôi phục về mặc định.');
        if (tv.usedGlobally || tv.usedBy.length) return problem(409, 'Mẫu đang được dùng', 'Mẫu “' + tv.name + '” đang được dùng.');
        st.themes = st.themes.filter(function (t) { return t.id !== parts[1]; });
        audit(st, 'theme.delete', parts[1]); save(st);
        return none();
      }
      case 'POST themes/:/reset': {
        var orig = BUILTIN.find(function (x) { return x.id === parts[1]; });
        st.themes[st.themes.findIndex(function (t) { return t.id === parts[1]; })] = clone(orig);
        audit(st, 'theme.reset', parts[1]); save(st);
        return ok(themeView(st, orig));
      }

      case 'POST logo':
      case 'DELETE logo':
        audit(st, method === 'POST' ? 'logo.update' : 'logo.delete', 'logo'); save(st);
        return method === 'POST' ? ok({ logoVersion: st.settings.logoVersion }) : none();

      case 'GET audit': return ok(st.audit.slice(0, +(q.get('limit') || 100)));
    }
    return problem(404, 'Không có trong bản mẫu', method + ' ' + path);
  }

  var realFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    var url = new URL(typeof input === 'string' ? input : input.url, location.href);
    var at = url.pathname.indexOf('/api/');
    if (at < 0) return realFetch(input, init);
    var method = ((init && init.method) || 'GET').toUpperCase();
    var body = {};
    if (init && typeof init.body === 'string') { try { body = JSON.parse(init.body); } catch (e) { body = {}; } }
    var res = handle(method, url.pathname.slice(at), url.searchParams, body);
    return Promise.resolve(new Response(res.body == null ? null : JSON.stringify(res.body), {
      status: res.status,
      headers: { 'Content-Type': res.status >= 400 ? 'application/problem+json' : 'application/json' },
    }));
  };

  // The demo host shows no confirm() dialogs; treat every confirmation as accepted.
  window.confirm = function () { return true; };

  // File downloads (template, export, original imports) need the real server.
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href^="/api/"], a[href="/template.xlsx"]');
    if (!a) return;
    e.preventDefault();
    var box = document.getElementById('toasts');
    if (!box) return;
    var t = document.createElement('div');
    t.className = 'toast warn';
    t.textContent = 'Bản mẫu không tải file được. Trên máy chủ thật, nút này tải file Excel.';
    box.appendChild(t);
    setTimeout(function () { t.remove(); }, 3500);
  }, true);
})();

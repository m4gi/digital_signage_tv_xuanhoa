// Meeting-room screen controller. Polls /api/screens/{code} (or /api/lobby) every 60s; clock runs on server time.
// Every second it re-picks what to show from the day's list (schedule.js), so it changes on time even offline;
// it also flips list pages, turns the "ĐÃ KẾT THÚC" card and, in the lobby, moves between rooms.
// Drawing is in display-render.js. Plain ES2017 with no optional chaining so old Android WebViews can run it.
(function () {
  'use strict';

  var POLL_MS = 60000;
  var PAGE_MS = 10000;
  var R = DisplayRender;

  // Served by the server as /room/{code} or /lobby, or bundled in the screen app as display.html?room=CODE.
  var params = new URLSearchParams(location.search);
  var server = (params.get('server') || '').replace(/\/+$/, '');
  var code = params.get('room') || decodeURIComponent(location.pathname.split('/').pop() || '');
  // Tells the server who is asking, for the admin's screen status: the APK, a browser/Fully Kiosk, or the admin preview.
  var client = params.get('preview') ? 'preview' : params.get('client') === 'apk' || server ? 'apk' : 'web';
  // Lobby screen (/lobby, or room "*" in the app): every room with meetings left today, in turn.
  var lobby = code === '*' || code === 'lobby';
  var roomCode = null, shownRoom = null; // lobby: the room to show, and the one on screen
  var data = null, version = null, offset = 0, lastOk = null, statusKey = null, page = 0, pages = [];
  var view = null, viewKey = null; // Schedule.pick result and what it is made of
  var face = 0, faceStart = Date.now(); // rotating big card after a meeting: 0 = ĐÃ KẾT THÚC, 1 = next meeting
  var flipStart = Date.now(); // when the current page appeared; re-renders keep it, only a flip resets it
  var orientation = 'auto', effect = 'fadeUp', started = Date.now();
  // Screen mounted sideways on a device that cannot rotate: ?rotate=90|180|270 (clockwise) turns the page itself.
  var rotate = [90, 180, 270].indexOf(+params.get('rotate')) >= 0 ? +params.get('rotate') : 0;

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function now() { return new Date(Date.now() + offset); }
  function isoDate(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function minutesOf(d) { return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60; }

  // "2026-10-22T08:42:15" is server wall-clock time; parse it as local, never as UTC.
  function parseLocal(s) {
    var m = /(\d+)-(\d+)-(\d+)T(\d+):(\d+):(\d+)/.exec(s);
    return new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  }

  function applyDisplay(d) {
    R.theme(d, server);
    orientation = d.display.orientation;
    effect = d.display.effect;
    layout();
  }

  function layout() {
    R.scale(orientation, rotate);
    if (data) render(data); // sizes differ between portrait and landscape: fit again
  }

  // Picks from the last data at the current server time. Servers older than the `today` field only send
  // the rest of today and `next`; that still works, minus the "ĐÃ KẾT THÚC" card.
  function choose() {
    var n = now();
    if (lobby) return chooseRoom(isoDate(n), minutesOf(n));
    var today = data.today || [data.current].concat(data.upcoming).filter(Boolean);
    var nextDay = data.today ? data.nextDay : data.next;
    return Schedule.pick(today, nextDay || null, isoDate(n), minutesOf(n));
  }

  // Lobby: the room to show (it keeps its place until nextRoom() or until it has nothing left today),
  // or, once every room is done, the building's next meeting with its room.
  function chooseRoom(date, min) {
    var active = Schedule.activeRooms(data.rooms, date, min), cur = null;
    for (var i = 0; i < active.length; i++) if (active[i].room.code === roomCode) cur = active[i];
    if (!cur) cur = Schedule.roomAfter(data.rooms, active, roomCode);
    if (!cur) {
      var first = Schedule.firstNextDay(data.rooms);
      return { current: null, ended: null, next: first && first.meeting, nextRoom: first && first.room, rows: [], done: true, room: null, count: 0 };
    }
    var v = cur.view;
    v.room = cur.room;
    v.index = active.indexOf(cur);
    v.count = active.length;
    return v;
  }

  // After the room's last page: the next room with meetings left today.
  function nextRoom() {
    var n = now();
    var next = Schedule.roomAfter(data.rooms, Schedule.activeRooms(data.rooms, isoDate(n), minutesOf(n)), roomCode);
    roomCode = next ? next.room.code : null;
    render(data);
  }

  function keyOf(v) {
    var id = function (m) { return m ? m.id : ''; };
    var where = v.room ? v.room.code + ' ' + v.index + '/' + v.count : v.done ? 'done' : '';
    return [where, id(v.current), id(v.ended), id(v.next), v.rows.map(id).join(',')].join('|');
  }

  // Fill every text that changes a box's height (footer, "Dự kiến còn …") before measuring anything.
  function render(d) {
    view = choose();
    var name = lobby ? (view.room ? view.room.name : 'Tất cả phòng họp') : d.room.name;
    R.heading(name,
      lobby && view.count > 1 ? 'LỊCH HỌP · PHÒNG ' + (view.index + 1) + '/' + view.count : 'LỊCH HỌP',
      (lobby ? 'Màn hình sảnh' : name) + ' – Lịch họp',
      d.display.footerNote || '');
    var k = keyOf(view);
    if (k !== viewKey) { viewKey = k; face = 0; faceStart = Date.now(); } // a meeting just ended: start on ĐÃ KẾT THÚC
    var room = view.room ? view.room.code : null, moved = lobby && room !== shownRoom;
    if (moved) { shownRoom = roomCode = room; page = 0; flipStart = Date.now(); }
    showStatus();
    renderRows();
    if (moved) { R.animate(R.node('room'), effect); R.animate(R.node('rows'), effect); }
  }

  function showStatus() {
    var key = R.status(view, face, isoDate(now())) + (shownRoom ? '@' + shownRoom : ''); // a new room animates even with the same state
    R.clock(now(), view.current);
    R.fitStatus();
    if (key !== statusKey) {
      R.animate(R.node('status'), effect);
      statusKey = key;
    }
  }

  // The meeting announced on the big card is left out of the list.
  function renderRows() {
    pages = R.paginate(view.rows, !!(view.next && view.next.date === isoDate(now())));
    if (!pages.length) { startBar(); return; }
    if (page >= pages.length) page = 0;
    showPage();
  }

  function showPage() {
    R.showPage(pages, page);
    startBar();
  }

  function flip() {
    var before = pages[page].session;
    page = (page + 1) % pages.length;
    flipStart = Date.now();
    showPage();
    R.animate(R.node('rows'), effect);
    if (pages[page].session !== before) R.animate(R.node('listTitle'), effect); // morning → afternoon: the title moves too
  }

  // In the lobby the bar also counts down to the next room when the room has a single page.
  function startBar() {
    R.bar(pages.length > 1 || (lobby && view && view.count > 1), Date.now() - flipStart, PAGE_MS);
  }

  // Every second: meetings start and end on time without waiting for the next poll, and the
  // "ĐÃ KẾT THÚC" card trades places with the next meeting every PAGE_MS.
  function tick() {
    var n = now();
    R.clock(n, view && view.current);
    // Reload once a night so a page left running for weeks starts fresh.
    if (n.getHours() === 3 && n.getMinutes() === 0 && Date.now() - started > 3600000) location.reload();
    if (!data) return;
    if (keyOf(choose()) !== viewKey) { render(data); return; }
    var rotating = lobby && view.count > 1;
    // In the lobby the card turns once (ĐÃ KẾT THÚC, then the next meeting) and the room moves on after that.
    if (view.ended && view.next && Date.now() - faceStart >= PAGE_MS && !(rotating && face === 1)) {
      face = 1 - face;
      faceStart = Date.now();
      showStatus();
      if (rotating) { flipStart = faceStart; startBar(); }
    }
  }

  function load() {
    // No fetch options: old Android WebViews reject cache modes they do not know. The server answers no-store,
    // and the time stamp keeps any proxy from reusing an old answer.
    fetch(server + (lobby ? '/api/lobby' : '/api/screens/' + encodeURIComponent(code)) + '?client=' + client + '&t=' + Date.now())
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
        R.connection(true, lastOk);
        render(d);
      })
      .catch(function (e) {
        if (e === 404) R.message('Không có phòng “' + code + '”');
        R.connection(false, lastOk, typeof e === 'number' ? 'mã ' + e : e && e.name);
      });
  }

  window.addEventListener('resize', layout);
  layout();
  tick();
  load();
  setInterval(load, POLL_MS);
  setInterval(tick, 1000);
  setInterval(function () {
    if (Date.now() - flipStart < PAGE_MS) return;
    // Lobby: after a room's last page (a single page stays one PAGE_MS), the next room; a room that just
    // finished a meeting first shows both faces of its card.
    if (lobby && view && view.count > 1 && page >= pages.length - 1 && !(view.ended && view.next && face === 0)) { nextRoom(); return; }
    if (pages.length < 2) { flipStart = Date.now(); return; }
    flip();
  }, 250);
})();

// What the meeting-room screen shows at a given moment, picked from the day's schedule on the screen itself,
// so it moves on at the right minute between polls and keeps going when the server is unreachable.
// Plain ES5: runs in old Android WebViews, and in node for tests/schedule.test.js.
var Schedule = (function () {
  'use strict';

  // After a meeting ends the big card rotates "ĐÃ KẾT THÚC" with the next meeting for this long.
  var ENDED_MIN = 5;

  function minutes(s) { var p = s.split(':'); return +p[0] * 60 + +p[1]; }
  function normal(m) { return m.status === 'normal'; }

  // today: the room's meetings of `date` sorted by start (cancelled ones never come from the server).
  // nextDay: the first meeting of a later day, or null when the room shows "PHÒNG TRỐNG" only.
  // date: 'yyyy-mm-dd' and min: minutes since midnight (with seconds as a fraction), both in server time.
  // Returns current (running now), ended (finished under ENDED_MIN ago, only while nothing runs),
  // next (the meeting the big card announces) and rows (the "Tiếp theo" list, without `next`).
  function pick(today, nextDay, date, min) {
    var list = today.filter(function (m) { return m.date === date; });
    // Past midnight without new data: the next-day meeting is today's now, or already history.
    if (nextDay && nextDay.date <= date) {
      if (nextDay.date === date && list.indexOf(nextDay) < 0) list.push(nextDay);
      nextDay = null;
    }

    var current = null, ended = null, i, m;
    for (i = 0; i < list.length; i++) {
      m = list[i];
      if (normal(m) && minutes(m.start) <= min && min < minutes(m.end)) { current = m; break; }
    }
    if (!current) {
      for (i = 0; i < list.length; i++) {
        m = list[i];
        var end = minutes(m.end);
        if (normal(m) && end <= min && min < end + ENDED_MIN && (!ended || end >= minutes(ended.end))) ended = m;
      }
    }

    var upcoming = list.filter(function (x) { return x !== current && minutes(x.end) > min; });
    var next = null;
    if (!current) next = upcoming.filter(normal)[0] || nextDay || null;
    return {
      current: current,
      ended: ended,
      next: next,
      rows: upcoming.filter(function (x) { return x !== next; }),
    };
  }

  // Lobby screen: the rooms worth showing now, in room order. A room counts while something runs, just
  // ended (the ĐÃ KẾT THÚC minutes) or is still to come today; rooms with nothing left today are skipped.
  // rooms: [{ room: { code, name }, today, nextDay }] as sent by /api/lobby.
  function activeRooms(rooms, date, min) {
    var out = [];
    for (var i = 0; i < rooms.length; i++) {
      var v = pick(rooms[i].today, rooms[i].nextDay, date, min);
      if (v.current || v.ended || v.rows.length || (v.next && v.next.date === date)) out.push({ room: rooms[i].room, view: v });
    }
    return out;
  }

  // The active room to show after `code` (null = start): the next one in room order, wrapping around,
  // so the rotation keeps its place when rooms drop in or out between polls.
  function roomAfter(rooms, active, code) {
    if (!active.length) return null;
    var order = rooms.map(function (r) { return r.room.code; });
    var from = order.indexOf(code);
    for (var i = 0; i < active.length; i++) if (order.indexOf(active[i].room.code) > from) return active[i];
    return active[0];
  }

  // When every room is done for today: the earliest next-day meeting of the building, with its room.
  function firstNextDay(rooms) {
    var best = null;
    for (var i = 0; i < rooms.length; i++) {
      var m = rooms[i].nextDay;
      if (m && (!best || m.date + m.start < best.meeting.date + best.meeting.start)) best = { meeting: m, room: rooms[i].room };
    }
    return best;
  }

  return { pick: pick, minutes: minutes, activeRooms: activeRooms, roomAfter: roomAfter, firstNextDay: firstNextDay, ENDED_MIN: ENDED_MIN };
})();

if (typeof module !== 'undefined') module.exports = Schedule;

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

  return { pick: pick, minutes: minutes, ENDED_MIN: ENDED_MIN };
})();

if (typeof module !== 'undefined') module.exports = Schedule;

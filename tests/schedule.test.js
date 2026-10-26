// node tests/schedule.test.js — checks the screen's own schedule picking (src/LedConference/web/schedule.js).
'use strict';
const assert = require('assert');
const { pick } = require('../src/LedConference/web/schedule.js');

const M = (id, start, end, extra) => Object.assign({ id, date: '2026-10-26', start, end, status: 'normal' }, extra);
const at = hm => { const [h, m] = hm.split(':').map(Number); return h * 60 + m; };
const ids = list => list.map(m => m.id).join(',');
const day = '2026-10-26';

const a = M('a', '13:00', '14:00'), b = M('b', '14:30', '15:30'), p = M('p', '15:00', '15:30', { status: 'postponed' });
const tomorrow = M('t', '08:00', '09:00', { date: '2026-10-27' });
const today = [a, b, p];
let v;

v = pick(today, tomorrow, day, at('13:30'));
assert.strictEqual(v.current, a, '13:30 a is running');
assert.strictEqual(v.ended, null);
assert.strictEqual(ids(v.rows), 'b,p', 'list shows the rest of the day, postponed included');

v = pick(today, tomorrow, day, at('14:00'));
assert.strictEqual(v.current, null, '14:00 end is exclusive');
assert.strictEqual(v.ended, a, 'a just ended');
assert.strictEqual(v.next, b, 'big card announces b');
assert.strictEqual(ids(v.rows), 'p', 'b is not repeated in the list');

v = pick(today, tomorrow, day, at('14:04') + 0.9);
assert.strictEqual(v.ended, a, 'still within the 5 minutes at 14:04:54');

v = pick(today, tomorrow, day, at('14:05'));
assert.strictEqual(v.ended, null, '5 minutes after the end: plain PHÒNG TRỐNG');
assert.strictEqual(v.next, b);

const c = M('c', '14:03', '15:00');
v = pick([a, c], null, day, at('14:03'));
assert.strictEqual(v.current, c, 'a new meeting starting early stops the rotation');
assert.strictEqual(v.ended, null);

v = pick([a], tomorrow, day, at('14:02'));
assert.strictEqual(v.ended, a, 'last meeting of the day still shows as ended');
assert.strictEqual(v.next, tomorrow, 'next day meeting announced when today is done');
assert.strictEqual(v.rows.length, 0);

v = pick([a], null, day, at('14:02'));
assert.strictEqual(v.next, null, 'no next meeting: the card only shows the ended one');

v = pick([M('x', '09:00', '10:00', { status: 'postponed' })], null, day, at('10:01'));
assert.strictEqual(v.ended, null, 'a postponed meeting never shows as ended');

v = pick(today, tomorrow, day, at('15:20'));
assert.strictEqual(v.current, b);
assert.strictEqual(ids(v.rows), 'p', 'postponed is listed while its time has not passed, never current');

// Offline past midnight: yesterday's list is stale, the next-day meeting becomes today's.
v = pick(today, tomorrow, '2026-10-27', at('08:30'));
assert.strictEqual(v.current, tomorrow, 'next-day meeting runs on its day even without new data');
v = pick(today, tomorrow, '2026-10-27', at('07:00'));
assert.strictEqual(v.next, tomorrow, 'and is announced before it starts');
assert.strictEqual(v.rows.length, 0, 'not listed twice');

// ---------- Lobby ----------
const { activeRooms, roomAfter, firstNextDay } = require('../src/LedConference/web/schedule.js');
const R = (code, list, nextDay) => ({ room: { code, name: 'Phòng ' + code }, today: list, nextDay: nextDay || null });
const rooms = [
  R('P1', [M('p1a', '08:00', '09:00')]),                                  // done for the day by 09:05
  R('P2', [M('p2a', '13:00', '14:00'), M('p2b', '15:00', '16:00')]),
  R('P3', [], M('p3t', '07:30', '08:00', { date: '2026-10-27' })),         // nothing today
  R('P4', [M('p4a', '14:00', '17:00')]),
];
const codes = list => list.map(x => x.room.code).join(',');

assert.strictEqual(codes(activeRooms(rooms, day, at('08:30'))), 'P1,P2,P4', 'empty rooms are skipped');
assert.strictEqual(codes(activeRooms(rooms, day, at('09:03'))), 'P1,P2,P4', 'a room stays while its meeting just ended');
assert.strictEqual(codes(activeRooms(rooms, day, at('09:05'))), 'P2,P4', 'and drops out 5 minutes later');
assert.strictEqual(codes(activeRooms(rooms, day, at('16:30'))), 'P4');
assert.strictEqual(activeRooms(rooms, day, at('17:10')).length, 0, 'every room done');

let act = activeRooms(rooms, day, at('08:30'));
assert.strictEqual(roomAfter(rooms, act, null).room.code, 'P1', 'starts with the first room');
assert.strictEqual(roomAfter(rooms, act, 'P1').room.code, 'P2');
assert.strictEqual(roomAfter(rooms, act, 'P2').room.code, 'P4', 'skips the empty P3');
assert.strictEqual(roomAfter(rooms, act, 'P4').room.code, 'P1', 'wraps around');
act = activeRooms(rooms, day, at('09:05'));
assert.strictEqual(roomAfter(rooms, act, 'P1').room.code, 'P2', 'a room that dropped out hands over to the next one');
assert.strictEqual(roomAfter(rooms, [], 'P1'), null);

const first = firstNextDay(rooms);
assert.strictEqual(first.meeting.id, 'p3t', 'all done: the earliest next-day meeting of the building');
assert.strictEqual(first.room.code, 'P3');

console.log('schedule.test.js OK');

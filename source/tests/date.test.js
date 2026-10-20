import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayKey, isDayKey, parseDayKey, addDays, diffDays, weekStart, weekDays, weekday, dayKeyFromInstant, dayRange } from '../src/core/date.js';

test('runs in Asia/Dubai (UTC+4)', () => {
  assert.equal(new Date('2026-10-19T00:00:00Z').getTimezoneOffset(), -240, 'npm test must set TZ=Asia/Dubai');
});

test('00:30 local belongs to the local day, not the UTC day', () => {
  const d = new Date(2026, 9, 19, 0, 30); // 19 Oct 00:30 Dubai = 18 Oct 20:30 UTC
  assert.equal(d.toISOString().slice(0, 10), '2026-10-18'); // the legacy bug
  assert.equal(dayKey(d), '2026-10-19');
});

test('03:59 local belongs to the local day; 04:00 is the same day too', () => {
  assert.equal(dayKey(new Date(2026, 9, 19, 3, 59, 59)), '2026-10-19');
  assert.equal(new Date(2026, 9, 19, 3, 59).toISOString().slice(0, 10), '2026-10-18');
  assert.equal(dayKey(new Date(2026, 9, 19, 4, 0)), '2026-10-19');
  assert.equal(dayKey(new Date(2026, 9, 19, 23, 59)), '2026-10-19');
});

test('isDayKey / parseDayKey validate real dates', () => {
  assert.ok(isDayKey('2028-02-29'));
  assert.ok(!isDayKey('2026-02-29'));
  assert.ok(!isDayKey('2026-1-05'));
  assert.ok(!isDayKey(20261019));
  assert.throws(() => parseDayKey('nope'), RangeError);
  const d = parseDayKey('2026-10-19');
  assert.deepEqual([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()], [2026, 9, 19, 0]);
});

test('addDays / diffDays across month and year boundaries', () => {
  assert.equal(addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(diffDays('2026-10-01', '2026-10-19'), 18);
  assert.deepEqual(dayRange('2026-10-30', '2026-11-02'), ['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
});

test('weekStart: Monday default, configurable', () => {
  // 2026-10-19 is a Monday
  assert.equal(weekday('2026-10-19'), 1);
  assert.equal(weekStart('2026-10-19'), '2026-10-19');
  assert.equal(weekStart('2026-10-25'), '2026-10-19'); // Sunday → previous Monday
  assert.equal(weekStart('2026-10-19', 6), '2026-10-17'); // Saturday start
  assert.equal(weekStart('2026-10-19', 0), '2026-10-18'); // Sunday start
  assert.equal(weekDays('2026-10-22').length, 7);
  assert.throws(() => weekStart('2026-10-19', 7), RangeError);
});

test('dayKeyFromInstant converts legacy ISO timestamps to the local day', () => {
  assert.equal(dayKeyFromInstant('2026-10-18T20:30:00.000Z'), '2026-10-19');
  assert.equal(dayKeyFromInstant(Date.UTC(2026, 9, 18, 23, 59)), '2026-10-19');
  assert.equal(dayKeyFromInstant('garbage'), null);
  assert.equal(dayKeyFromInstant(null), null);
});

test('source never uses toISOString for day keys', async () => {
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(new URL('../src/core/date.js', import.meta.url), 'utf8');
  assert.ok(!/toISOString\(\)/.test(src.replace(/\/\/.*$/gm, '')));
});

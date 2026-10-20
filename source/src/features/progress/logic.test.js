import test from 'node:test';
import assert from 'node:assert/strict';
import * as P from './logic.js';

const T = { training: { kcal: 2600, p: 160, c: 330, f: 70 }, rest: { kcal: 2050, p: 160, c: 200, f: 65 } };

test('cleanWeights dedupes per day, drops junk, sorts', () => {
  const w = P.cleanWeights([{ day: '2026-10-02', kg: 78 }, { day: '2026-10-01', kg: 79 }, { day: '2026-10-02', kg: 77.8 }, { day: 'bad', kg: 70 }, { day: '2026-10-03', kg: 5 }]);
  assert.deepEqual(w, [{ day: '2026-10-01', kg: 79 }, { day: '2026-10-02', kg: 77.8 }]);
});

test('movingAvg7 uses the trailing 7 calendar days', () => {
  const a = P.movingAvg7([{ day: '2026-10-01', kg: 80 }, { day: '2026-10-05', kg: 79 }, { day: '2026-10-08', kg: 78 }]);
  assert.equal(a[0].avg7, 80);
  assert.equal(a[1].avg7, 79.5);
  assert.equal(a[2].avg7, 78.5); // 10-01 is outside 10-02..10-08
  assert.equal(a[2].n, 2);
});

test('weeklyTrend needs ≥7 days of span', () => {
  assert.equal(P.weeklyTrend([{ day: '2026-10-01', kg: 80 }, { day: '2026-10-03', kg: 79 }]), null);
  const days = Array.from({ length: 15 }, (_, i) => ({ day: `2026-10-${String(i + 1).padStart(2, '0')}`, kg: 80 - i * 0.1 }));
  const t = P.weeklyTrend(days);
  assert.ok(t.kgPerWeek < 0 && t.kgPerWeek > -1);
});

test('chartGeometry: oldest on the right, newest on the left (RTL time)', () => {
  const g = P.chartGeometry(P.movingAvg7([{ day: '2026-10-01', kg: 80 }, { day: '2026-10-08', kg: 79 }]), { width: 300, height: 100, pad: 10 });
  assert.equal(g.points[0].x, 290);
  assert.equal(g.points[1].x, 10);
  assert.ok(g.points[0].y < g.points[1].y); // heavier is higher on screen
  assert.match(g.kgPath, /^M290 /);
});

test('weekAdherence: sessions vs plan, protein/kcal days only up to today', () => {
  // week of Mon 2026-10-12 .. Sun 10-18; anchor Wed 10-14
  const sessions = [{ id: 's1', day: '2026-10-12' }, { id: 's2', day: '2026-10-13' }, { id: 'x', day: '2026-10-05' }];
  const foodLog = {
    '2026-10-12': [{ kcal: 2600, p: 165 }],          // training, in range, protein hit
    '2026-10-13': [{ kcal: 1800, p: 150 }],          // training, under, protein miss
    '2026-10-14': [{ kcal: 2000, p: 158 }],          // rest (Wed), in range, protein hit (slack 5)
    '2026-10-15': [{ kcal: 9999, p: 999 }],          // future: ignored
  };
  const a = P.weekAdherence({ anchorDay: '2026-10-14', weekStartDow: 1, trainingDays: [1, 2, 4, 5], sessions, foodLog, targets: T });
  assert.equal(a.sessionsDone, 2); assert.equal(a.sessionsPlanned, 4);
  assert.equal(a.daysLogged, 3); assert.equal(a.proteinDaysHit, 2); assert.equal(a.kcalDaysInRange, 2);
  assert.equal(a.avgKcal, 2133);
  assert.equal(a.perDay[2].type, 'rest');
});

test('a session on a scheduled rest day flips it to training targets', () => {
  const a = P.weekAdherence({ anchorDay: '2026-10-18', sessions: [{ id: 's', day: '2026-10-14' }], foodLog: { '2026-10-14': [{ kcal: 2600, p: 160 }] }, targets: T });
  assert.equal(a.perDay[2].type, 'training'); assert.equal(a.perDay[2].inRange, true);
});

test('live / discarded sessions do not count', () => {
  const a = P.weekAdherence({ anchorDay: '2026-10-14', sessions: [{ day: '2026-10-12', status: 'live' }, { day: '2026-10-13', discarded: true }, { day: '2026-10-14' }], targets: T });
  assert.equal(a.sessionsDone, 1);
});

test('weekly report lines are factual and calm', () => {
  const lines = P.weeklyReportLines({ sessionsDone: 3, sessionsPlanned: 4, daysLogged: 5, proteinDaysHit: 4, kcalDaysInRange: 3, avgKcal: 2300 }, { kgPerWeek: -0.3 }, [{ muscle: 'صدر', sets: 12 }]);
  assert.equal(lines[0], 'التمرين: 3 من 4 جلسات الخطة');
  assert.ok(lines.every((l) => !/فشل|عقاب|خسرت/.test(l)));
  assert.match(lines[3], /-0.3/);
  assert.deepEqual(P.weekContext({ sessionsDone: 1, sessionsPlanned: 4, proteinDaysHit: 0, daysLogged: 0, avgKcal: null }, null).weightTrendKgPerWeek, null);
});

test('Heart Day (S2): the program weekday and a logged Heart Day use the 2300 kcal heart target, not lifting', () => {
  const sessions = [{ id: 'h', kind: 'heart', mode: 'heart', day: '2026-10-25', durationS: 1800 }];
  const foodLog = { '2026-10-24': [{ kcal: 2300, p: 160 }], '2026-10-25': [{ kcal: 2300, p: 160 }] };
  const a = P.weekAdherence({ anchorDay: '2026-10-25', weekStartDow: 1, sessions, foodLog, targets: T, heartDow: 6 });
  assert.equal(a.perDay[5].type, 'heart'); assert.equal(a.perDay[5].target.kcal, 2300); assert.equal(a.perDay[5].inRange, true);
  assert.equal(a.perDay[6].type, 'heart'); // Sunday with a logged Heart Day
  assert.equal(a.sessionsDone, 0); // never a lifting session
  assert.equal(P.weekAdherence({ anchorDay: '2026-10-25', sessions: [], foodLog, targets: T }).perDay[5].type, 'rest');
});

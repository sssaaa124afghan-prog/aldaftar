import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from './metrics.js';
import { addDays } from '../../core/date.js';

const bench = (w, r = 5) => ({ lib: 'ex1', name: 'بنش بريس بالبار', muscle: 'صدر', kind: 'compound', sets: [{ w, r, rir: 2, done: true }, { w, r, rir: 2, done: true }, { w, r, rir: 1, done: true }] });
const squat = (w) => ({ lib: 'ex41', name: 'سكوات بالبار', muscle: 'رجل', kind: 'compound', sets: [{ w, r: 5, rir: 2, done: true }] });
const ses = (day, exercises, extra = {}) => ({ id: `s${day}`, day, status: 'done', dayKey: 'upperA', finishedAt: `${day}T19:00:00.000Z`, durationMin: 60, exercises, ...extra });
const start = '2026-08-24'; // Monday
// 8 weekly bench sessions 100 → 110 kg ×1 rep (e1RM = weight)
const eight = Array.from({ length: 8 }, (_, i) => ses(addDays(start, i * 7), [bench(100 + i * (10 / 7), 1)]));

test('e1rmSeries: one point per exposure, oldest first', () => {
  const s = M.e1rmSeries(eight, { lib: 'ex1' });
  assert.equal(s.length, 8);
  assert.equal(s[0].day, start);
  assert.ok(s[7].e1rm > s[0].e1rm);
});

test('progressRate ≈ 1.43 kg/week and rate label', () => {
  const r = M.progressRate(eight, { lib: 'ex1' }, { today: addDays(start, 50), weeks: 12 });
  assert.ok(Math.abs(r - 10 / 7) < 0.05, String(r));
  assert.equal(M.rateLabel(0.1), 'ثابت');
  assert.equal(M.rateLabel(0.84), '+0.8 كجم/أسبوع');
});

test('PR list sorted by date desc and PR timeline excludes the baseline', () => {
  const ss = [...eight, ses(addDays(start, 2), [squat(100)])];
  const list = M.prList(ss);
  assert.equal(list[0].name, 'بنش بريس بالبار');
  assert.ok(list.every((p, i, a) => !i || a[i - 1].day >= p.day));
  const tl = M.prTimelineLocal(ss);
  assert.ok(M.prTimeline(ss).every((p) => p.day && p.e1rm > 0));
  assert.equal(tl.length, 7); // 8 exposures, first is baseline; squat once → none
  assert.ok(tl[0].day > tl[6].day);
});

test('goal 120 kg with 100 → 110 over 5 weeks → predicted date in 5 weeks', () => {
  const p = M.predictDate(110, 2, 120, '2026-10-19');
  assert.equal(p.weeks, 5); assert.equal(p.day, '2026-11-23'); assert.ok(p.estimate);
  assert.equal(M.predictDate(110, 0, 120, '2026-10-19'), null);
  assert.ok(M.projection(110, 2, 12).estimate);
  assert.equal(M.projection(110, 9, 12).value, 140); // clamped to 2.5/w
});

test('readiness score 0-100 and 4 bands', () => {
  assert.equal(M.readinessScore({ sleepH: 8, energy: 5, stress: 1, soreness: 1 }), 100);
  assert.equal(M.readinessScore({ sleepH: 4, energy: 1, stress: 5, soreness: 5 }), 15);
  assert.equal(M.readinessBand(85).advice, 'يوم مناسب تحاول فيه رقم قياسي.');
  assert.equal(M.readinessBand(65).key, 'good');
  assert.equal(M.readinessBand(45).advice, 'خفّف الأوزان 10–15% النهارده.');
  assert.equal(M.readinessBand(10).advice, 'فكّر في راحة أو تمرين خفيف.');
});

test('training load acute:chronic', () => {
  const today = '2026-10-19';
  const steady = [0, 3, 7, 10, 14, 17, 21, 24].map((d) => ses(addDays(today, -d), [bench(100, 5)]));
  const l = M.trainingLoad(steady, today);
  assert.equal(l.level, 'normal');
  const spike = [...steady, ses(today, [bench(100, 5), bench(100, 5), bench(100, 5)])];
  assert.ok(['high', 'very'].includes(M.trainingLoad(spike, today).level));
  assert.equal(M.trainingLoad([], today), null);
});

test('smart summary sentence rules', () => {
  const today = '2026-10-19';
  assert.match(M.smartSummary([], { today }).sentence, /أول جلسة/);
  const old = [ses('2026-10-14', [bench(100)])];
  assert.match(M.smartSummary(old, { today, now: new Date('2026-10-19T10:00:00+04:00') }).sentence, /وقت ترجع/);
  const fresh = [ses('2026-10-19', [bench(100)], { finishedAt: '2026-10-19T05:00:00.000Z' })];
  const r = M.smartSummary(fresh, { today, now: new Date('2026-10-19T12:00:00+04:00'), plannedPerWeek: 4 });
  assert.match(r.sentence, /فاضل 3/);
  assert.equal(r.sessionsWeek, 1);
});

test('strength level vs current body weight + DOTS', () => {
  const l = M.strengthLevelLocal(100, 80, 'bench');
  assert.equal(l.label, 'متوسط'); assert.equal(l.next.label, 'متقدّم'); assert.equal(l.next.kg, 120);
  assert.equal(M.strengthLevelLocal(30, 80, 'bench').label, 'بداية');
  const c = M.strengthLevel(100, 80, 'bench'); assert.ok(c && typeof c.label === 'string' && c.ratio === 1.25);
  const d = M.dots(500, 80);
  assert.ok(d > 330 && d < 360, String(d));
});

test('Navy BF: waist 85 / neck 38 / height 178 ≈ 16-17 %, BMI line', () => {
  const bf = M.navyBF({ waist: 85, neck: 38, heightCm: 178 });
  assert.ok(bf >= 16 && bf <= 17.5, String(bf));
  assert.equal(M.bmi(80, 178), 25.2);
  assert.ok(M.weightPrediction(80, -0.5, 8).estimate);
});

test('volume per week equals the sum of sessionVolume; calendar marks recovery distinctly', () => {
  const today = addDays(start, 52);
  const w = M.volumeByWeek(eight, today, 8);
  const total = w.reduce((a, x) => a + x.v, 0);
  assert.equal(total, eight.reduce((a, s) => a + M.volumeOf(s), 0));
  const cal = M.consistencyCalendar([...eight, { id: 'r', day: addDays(start, 1), kind: 'recovery', status: 'done' }], { today, weeks: 9 });
  const flat = cal.flat();
  assert.equal(flat.find((c) => c.day === addDays(start, 1)).state, 'recovery');
  assert.equal(flat.find((c) => c.day === start).state, 'trained');
  assert.equal(flat.filter((c) => c.state === 'trained').length, 8);
});

test('session compare gives per-exercise deltas', () => {
  const c = M.sessionCompare(eight[0], eight[1]);
  assert.equal(c.rows.length, 1);
  assert.ok(c.rows[0].dW > 1);
});

test('lagging muscle under 60 % of the top muscle', () => {
  const today = '2026-10-19';
  const ss = [0, 3, 6].map((d) => ses(addDays(today, -d), [bench(80, 8), bench(80, 8), squat(100)]));
  const lag = M.laggingMuscle(ss, today);
  assert.equal(lag.top, 'صدر');
  assert.ok(lag.sets < lag.topSets * 0.6);
});

test('eating patterns fallback', () => {
  const log = { '2026-10-18': [{ name: 'فول', time: '23:10', section: 'dinner', kcal: 400, p: 20 }], '2026-10-19': [{ name: 'فول', time: '09:00', section: 'breakfast', kcal: 300, p: 18 }] };
  const p = M.eatingPatternsLocal(log, ['2026-10-18', '2026-10-19'], () => ({ kcal: 2000 }));
  assert.equal(p.days, 2); assert.equal(p.lateDays, 1); assert.equal(p.skippedBreakfast, 1); assert.equal(p.topFoods[0].name, 'فول');
});

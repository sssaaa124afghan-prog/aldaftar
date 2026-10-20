import test from 'node:test';
import assert from 'node:assert/strict';
import * as L from './logic.js';
import { FOODS } from './foods.js';
import { reminderSettings, msUntil } from './reminders.js';

const cat = L.buildCatalog(FOODS, []);
const chicken = cat.find((f) => f.name === 'صدور فراخ مشوية');
const rice = cat.find((f) => f.name === 'أرز أبيض مطبوخ');
const t = { kcal: 2600, p: 160, c: 330, f: 70 };

test('P1 seeded day: protein 60/160 at 15:00 → budget per remaining meal + suggestion from frequent foods within remaining kcal', () => {
  const entries = [
    { name: 'بيض', qty: 2, kcal: 400, p: 25, c: 4, f: 28, section: 'breakfast', time: '08:30' },
    { name: 'رز', qty: 250, kcal: 600, p: 35, c: 110, f: 8, section: 'lunch', time: '14:00' },
  ];
  const intake = L.groupBySection(entries);
  const sum = { kcal: 1000, p: 60, c: 114, f: 36 };
  const b = L.mealBudget(intake, sum, t, 15);
  assert.deepEqual(b.sections, ['dinner']);
  assert.equal(b.mealsLeft, 1); assert.equal(b.kcal, 1600); assert.equal(b.p, 100);
  const b2 = L.mealBudget(L.groupBySection(entries.slice(0, 1)), sum, t, 15);
  assert.deepEqual(b2.sections, ['lunch', 'dinner']); assert.equal(b2.kcal, 800); assert.equal(b2.p, 50);
  const usage = L.computeUsage([{ day: '2026-10-18', entries: [{ foodId: chicken.id, name: chicken.name, qty: 200, section: 'lunch' }, { foodId: chicken.id, name: chicken.name, qty: 200, section: 'dinner' }] }]);
  const s = L.smartSuggestions(cat, usage, sum, t, { dayType: 'training' });
  assert.equal(s.mode, 'p');
  assert.equal(s.items[0].food.id, chicken.id, 'frequent food ranks first');
  for (const it of s.items) assert.ok(it.kcal <= t.kcal - sum.kcal);
  // tight kcal: suggestion shrinks to fit
  const tight = L.smartSuggestions(cat, usage, { kcal: 2450, p: 60, c: 0, f: 0 }, t);
  for (const it of tight.items) assert.ok(it.kcal <= 150, `${it.food.name} ${it.kcal}`);
  // nothing to close
  assert.equal(L.smartSuggestions(cat, usage, { kcal: 2600, p: 160, c: 330, f: 70 }, t).items.length, 0);
});

test('EOD recap only after 20:00 today with ≥ 200 kcal; one fix', () => {
  const R = L.macroRanges(t);
  assert.equal(L.eodRecap({ kcal: 1800, p: 120, c: 0, f: 50 }, t, R, { hour: 19 }), null);
  assert.equal(L.eodRecap({ kcal: 1800, p: 120, c: 0, f: 50 }, t, R, { hour: 21, isToday: false }), null);
  const r = L.eodRecap({ kcal: 1800, p: 120, c: 200, f: 50 }, t, R, { hour: 21, waterMl: 1000, waterGoal: 3000 });
  assert.ok(r.missing[0].includes('بروتين ناقص 35'));
  assert.match(r.fix, /35 جم بروتين/);
  assert.equal(L.eodRecap({ kcal: 2600, p: 165, c: 330, f: 70 }, t, R, { hour: 22, waterMl: 3000, waterGoal: 3000 }).closed, true);
});

test('macro ranges: defaults, custom, status; dayBalance uses custom ranges', () => {
  const R = L.macroRanges(t);
  assert.deepEqual(R.kcal, { min: 2470, max: 2730 });
  assert.equal(R.p.min, 155); assert.equal(R.p.max, null);
  assert.deepEqual(R.c, { min: 281, max: 379 });
  const C = L.macroRanges(t, { kcal: { lo: 300, hi: 100 }, p: { lo: 0, hi: 9999 } });
  assert.equal(C.kcal.min, 2300); assert.equal(C.kcal.max, 2700); assert.equal(C.p.min, 160);
  assert.equal(L.rangeStatus(100, C.kcal), 'low'); assert.equal(L.rangeStatus(2800, C.kcal), 'over'); assert.equal(L.rangeStatus(2400, C.kcal), 'in');
  assert.equal(L.dayBalance({ kcal: 2350, p: 160 }, t).state, 'open');
  assert.equal(L.dayBalance({ kcal: 2350, p: 160 }, t, C).state, 'closed');
  const sp = L.macroSplit({ p: 160, c: 330, f: 70 });
  assert.equal(sp.p + sp.c + sp.f, 100); assert.equal(sp.p, 25);
  assert.equal(L.macroSplit({ p: 0, c: 0, f: 0 }), null);
});

test('tdee (Mifflin + activity per day type), weight impact (تقدير)', () => {
  const pr = { kg: 80, cm: 178, age: 27, sex: 'male' };
  assert.equal(L.bmr(pr), 1783);
  assert.equal(L.tdee(pr, 1.55), Math.round(1783 * 1.55));
  assert.equal(L.tdee(pr, 1.55, 'training'), Math.round(1783 * 1.65));
  assert.equal(L.tdee(pr, 1.55, 'rest'), Math.round(1783 * 1.35));
  assert.equal(L.tdee({ kg: 80 }, 1.55), null);
  assert.equal(L.bmr({ ...pr, sex: 'female' }), 1617);
  const w = L.weightImpact({ kcal: 2100 }, 2870);
  assert.equal(w.direction, 'deficit'); assert.equal(w.balance, -770); assert.equal(w.grams, 100); assert.equal(w.weeklyKg, 0.7);
  assert.equal(L.weightImpact({ kcal: 20 }, 2800), null);
});

test('protein per meal marks (0.4 g/kg) and eating window', () => {
  const es = [{ section: 'breakfast', p: 20, time: '08:15' }, { section: 'lunch', p: 45, time: '14:00' }, { section: 'snack', p: 5, time: '22:45' }];
  const r = L.proteinPerMeal(es, 80);
  assert.equal(r.threshold, 32);
  assert.deepEqual(r.meals.map((m) => [m.key, m.ok]), [['breakfast', false], ['lunch', true], ['snack', true]]);
  assert.equal(r.under, 1);
  assert.equal(L.proteinPerMeal(es).threshold, 25);
  const w = L.eatingWindow(es);
  assert.equal(w.first, '08:15'); assert.equal(w.last, '22:45'); assert.equal(w.hours, 14); assert.equal(w.mins, 30);
  assert.equal(L.eatingWindow([{ time: '09:00' }]), null);
});

test('smart alert: max one, protein low 2 days first', () => {
  const tt = { kcal: 2000, p: 160 };
  const recent = [{ day: '2026-10-18', intake: { p: 100 }, target: tt }, { day: '2026-10-17', intake: { p: 110 }, target: tt }];
  assert.equal(L.smartAlert({ today: '2026-10-19', recent, lastWeighDay: '2026-10-01' }).kind, 'protein');
  assert.equal(L.smartAlert({ today: '2026-10-19', recent: [], lastWeighDay: '2026-10-12' }).kind, 'weigh');
  assert.equal(L.smartAlert({ today: '2026-10-19', recent: [], lastWeighDay: '2026-10-18', waterMl: 500, waterGoal: 3000, hour: 16 }).kind, 'water');
  assert.equal(L.smartAlert({ today: '2026-10-19', recent: [], lastWeighDay: '2026-10-18', waterMl: 500, waterGoal: 3000, hour: 10 }), null);
  assert.equal(L.smartAlert({ today: '2026-10-19', recent, isToday: false }), null);
});

test('diet modes: recomp 80 kg → 2400 kcal / 176 P; keto carbs 25', () => {
  const r = L.dietModeTargets('recomp', 80);
  assert.equal(r.training.kcal, 2400); assert.equal(r.training.p, 176); assert.equal(r.training.f, 72);
  assert.equal(r.training.c, Math.round((2400 - 176 * 4 - 72 * 9) / 4));
  assert.equal(r.rest.kcal, 2150);
  assert.equal(L.dietModeTargets('keto', 80).training.c, 25);
  assert.equal(L.dietModeTargets('nope', 80), null);
  assert.equal(L.dietModeTargets('cut', null), null);
});

test('adaptive engine: −1 kg over 7 days → «زوّد 150 سعرة»; +0.6 → −150; cooldown and snooze', () => {
  const ws = [{ day: '2026-10-12', kg: 81 }, { day: '2026-10-15', kg: 80.5 }, { day: '2026-10-19', kg: 80 }];
  const s = L.adaptiveSuggestion(ws, [], { today: '2026-10-19' });
  assert.equal(s.delta, 150); assert.equal(s.title, 'زوّد 150 سعرة'); assert.equal(s.change, -1);
  const up = L.adaptiveSuggestion([{ day: '2026-10-12', kg: 80 }, { day: '2026-10-15', kg: 80.3 }, { day: '2026-10-19', kg: 80.6 }], [], { today: '2026-10-19' });
  assert.equal(up.delta, -150);
  assert.equal(L.adaptiveSuggestion([{ day: '2026-10-12', kg: 80 }, { day: '2026-10-15', kg: 80.1 }, { day: '2026-10-19', kg: 80 }], [], { today: '2026-10-19' }), null);
  assert.equal(L.adaptiveSuggestion(ws, [{ date: '2026-10-15', change: 150 }], { today: '2026-10-19' }), null);
  assert.equal(L.adaptiveSuggestion(ws, [], { today: '2026-10-19', snoozeUntil: '2026-10-25' }), null);
  assert.equal(L.adaptiveSuggestion(ws.slice(0, 2), [], { today: '2026-10-19' }), null);
  const next = L.applyAdjustment({ training: { kcal: 2600, p: 160, c: 330, f: 70 }, rest: { kcal: 2050, p: 160, c: 200, f: 65 } }, 150);
  assert.equal(next.training.kcal, 2750); assert.equal(next.training.c, 368); assert.equal(next.rest.kcal, 2200); assert.equal(next.rest.p, 160);
});

test('recipe: 500 g rice + 200 g chicken cooked to 900 g → per 100 g; 300 g = 1/3 of totals', () => {
  const items = [L.makeEntry(rice, 500, 'lunch'), L.makeEntry(chicken, 200, 'lunch')].map(({ foodId, name, qty, unit, kcal, p, c, f }) => ({ foodId, name, qty, unit, kcal, p, c, f }));
  const r = L.makeRecipe({ name: 'رز بالفراخ', items, cookedG: 900 });
  assert.equal(r.ok, true); assert.equal(r.rawG, 700);
  const [rec] = L.listRecipes({ [r.recipe.id]: r.recipe });
  assert.equal(rec.totals.kcal, 650 + 330);
  assert.equal(rec.per100.kcal, Math.round((980 / 9) * 10) / 10);
  const food = L.recipeFood(rec);
  const e = L.makeEntry(food, 300, 'dinner');
  assert.ok(Math.abs(e.kcal - 980 / 3) < 0.5, String(e.kcal));
  assert.ok(Math.abs(e.p - rec.totals.p / 3) < 0.2);
  assert.equal(L.makeRecipe({ name: '', items, cookedG: 900 }).ok, false);
  assert.equal(L.makeRecipe({ name: 'x', items, cookedG: 0 }).ok, false);
  // legacy NutriPro shape (servings)
  const [old] = L.listRecipes({ rec_1: { name: '<b>شوربة</b>', servings: 2, ingredients: [{ name: 'عدس', cal: 400, pro: 30, carb: 60, fat: 2 }] } });
  assert.equal(old.perServing.kcal, 200); assert.ok(!/[<>]/.test(old.name));
  assert.equal(L.recipeFood(old).unit, 'حصة');
});

test('water goal from weight: 80 kg → 2.6 L ≈ 11 cups; +500 ml on a training day', () => {
  assert.equal(L.waterGoalMl(80, 'rest'), 2640);
  assert.equal((L.waterGoalMl(80, 'rest') / 1000).toFixed(1), '2.6');
  assert.equal(L.cupsFor(L.waterGoalMl(80, 'rest')), 11);
  assert.equal(L.waterGoalMl(80, 'training'), 3140);
  assert.equal(L.waterGoalMl(null, 'rest'), 2500);
});

test('custom food validation (per 100 g limits, fiber/sodium optional); AI food JSON untrusted', () => {
  const ok = L.validateFood({ name: 'ملوخية بيتي', unit: 'جرام', per: 100, kcal: '60', p: '3', c: '7', f: '2.5', fiber: '3' });
  assert.equal(ok.ok, true); assert.equal(ok.food.fiber, 3); assert.equal(ok.food.src, 'user'); assert.ok(ok.food.id.startsWith('u:'));
  assert.equal(L.validateFood({ name: '', per: 100, kcal: 10 }).errors.name, 'اكتب اسم الأكلة.');
  assert.ok(L.validateFood({ name: 'x', unit: 'جرام', per: 100, kcal: 1200 }).errors.kcal);
  assert.equal(L.validateFood({ name: 'بيتزا', unit: 'حصة', per: 1, kcal: 1200, p: 40 }).ok, true);
  const ai = L.parseAIFood('اهو: {"name":"<img onerror=x>كشري","per":100,"unit":"جرام","kcal":180,"p":5,"c":32,"f":4,"fiber":3}');
  assert.ok(ai && !/[<>]/.test(ai.name)); assert.equal(ai.kcal, 180); assert.equal(ai.src, 'ai');
  assert.equal(L.parseAIFood('مش عارف'), null);
  assert.equal(L.parseAIFood('{"name":"x","kcal":99999}'), null);
  // fiber flows into entries
  const e = L.makeEntry(ok.food, 200, 'lunch');
  assert.equal(e.fib, 6); assert.equal(L.sumFiber([e, { fib: 1.5 }]), 7.5);
});

test('weekStats + compareWeeks + eatingPatterns (exported for analytics)', () => {
  const tt = { kcal: 2000, p: 150, c: 200, f: 60 };
  const mkE = (kcal, p, time = '13:00', name = 'فراخ', section = 'lunch') => ({ name, kcal, p, c: 0, f: 0, time, section });
  const days = [
    { day: '2026-10-13', entries: [mkE(2000, 150)], kg: 80 },
    { day: '2026-10-14', entries: [mkE(1500, 100)], kg: 79.8 },
    { day: '2026-10-15', entries: [] },
  ];
  const w = L.weekStats(days, tt);
  assert.equal(w.days, 2); assert.equal(w.avgKcal, 1750); assert.equal(w.proteinHit, 1); assert.equal(w.closed, 1); assert.equal(w.avgKg, 79.9);
  assert.equal(w.bestDay.day, '2026-10-13');
  assert.equal(L.weekStats([], tt), null);
  const cmp = L.compareWeeks(w, { ...w, avgP: 100, proteinHit: 0 });
  assert.equal(cmp.find((r) => r.key === 'avgP').good, true);
  assert.equal(L.eatingPatterns(days), null);
  const many = Array.from({ length: 8 }, (_, i) => ({ day: `2026-10-${String(10 + i).padStart(2, '0')}`, target: tt,
    entries: [mkE(1500, 80, '14:00', 'صدور فراخ'), mkE(1000, 10, '22:30', 'شيبسي', 'snack')] }));
  const p = L.eatingPatterns(many);
  assert.equal(p.totalDays, 8); assert.equal(p.lateNight.days, 8); assert.equal(p.skipBreakfast, 8); assert.equal(p.overshoot.days, 8);
  assert.equal(p.topFoods[0][1], 8);
  assert.ok(p.notes.some((n) => n.title === 'أكل بالليل متكرر'));
  assert.ok(p.notes.every((n) => !/[\u{1F300}-\u{1FAFF}]/u.test(n.text + n.title)), 'no emoji');
});

test('month grid, share text, added fats, photo history (text only, last 20)', () => {
  const g = L.monthGrid(2026, 9, 1); // Oct 2026, Monday first; Oct 1 is a Thursday
  assert.equal(g[0][3], '2026-10-01'); assert.equal(g[0][0], null);
  assert.ok(g.flat().includes('2026-10-31'));
  const groups = L.groupBySection([{ name: 'فراخ', kcal: 300, p: 50, section: 'lunch' }]);
  const txt = L.dayShareText('الاثنين 19 أكتوبر', groups, { kcal: 300, p: 50, c: 0, f: 5 }, { kcal: 2600, p: 160 });
  assert.match(txt, /غدا: 300 سعرة/); assert.match(txt, /300 من 2600/);
  const fe = L.fatEntry('oil_tbsp', 'lunch');
  assert.equal(fe.kcal, 120); assert.equal(fe.f, 13.5); assert.equal(L.fatEntry('x', 'lunch'), null);
  let h = [];
  for (let i = 0; i < 25; i++) h = L.pushPhotoHistory(h, [{ name: `صنف ${i}`, grams: 100, kcal: 100, p: 1, c: 1, f: 1, image: 'data:...' }]);
  assert.equal(h.length, 20); assert.equal(h[0].items[0].name, 'صنف 24'); assert.equal(h[0].items[0].image, undefined);
});

test('reminders: off by default, at most 2 valid times', () => {
  assert.deepEqual(reminderSettings(undefined), { on: false, times: ['13:30', '20:30'] });
  assert.deepEqual(reminderSettings({ on: true, times: ['21:00', '08:00', '13:00', 'bad'] }), { on: true, times: ['08:00', '13:00'] });
  assert.equal(msUntil('10:00', new Date(2026, 9, 19, 11, 0)), null);
  assert.equal(msUntil('12:00', new Date(2026, 9, 19, 11, 0)), 3600000);
});

test('stemAr strips ال / plural suffixes; search still finds synonyms', () => {
  assert.equal(L.stemAr('البيضات'), L.stemAr('بيض'));
  assert.ok(L.searchFoods(cat, 'الفراخ').some((f) => /فراخ/.test(f.name)));
});

test('smart suggestions respect the meal: no 400 g chicken at breakfast; your own breakfast foods at your usual portion', () => {
  const cat = L.buildCatalog(FOODS, []);
  const by = (n) => cat.find((f) => f.name === n);
  const chicken = by('صدور فراخ مشوية'), egg = by('بيضة كاملة'), whey = by('واي بروتين سكوب');
  const t = { kcal: 2550, p: 160, c: 300, f: 70, type: 'training' };
  const days = Array.from({ length: 6 }, (_, i) => ({ day: `2026-10-${String(10 + i).padStart(2, '0')}`, entries: [
    { foodId: chicken.id, name: chicken.name, qty: 250, section: 'lunch' },
    { foodId: egg.id, name: egg.name, qty: 4, section: 'breakfast' },
    { foodId: whey.id, name: whey.name, qty: 1, section: 'breakfast' }] }));
  const usage = L.computeUsage(days);
  assert.equal(usage.get(egg.id).secQty.breakfast, 4);
  const intake = { kcal: 0, p: 0, c: 0, f: 0 };
  const bf = L.smartSuggestions(cat, usage, intake, t, { dayType: 'training', section: 'breakfast' });
  assert.ok(bf.items.length > 0);
  assert.ok(!bf.items.some((x) => /فراخ|دجاج|لحم|سمك|تونة/.test(x.food.name)), bf.items.map((x) => x.food.name).join(' | '));
  const e = bf.items.find((x) => x.food.id === egg.id);
  assert.ok(e && e.qty === 4, 'eggs at the usual 4');
  for (const x of bf.items) if (!x.inSection && /جرام/.test(x.food.unit)) assert.ok(x.qty <= L.SECTION_CAP.breakfast.g);
  // lunch: chicken at the usual 250 g, ranked first
  const lu = L.smartSuggestions(cat, usage, intake, t, { dayType: 'training', section: 'lunch' });
  assert.equal(lu.items[0].food.id, chicken.id); assert.equal(lu.items[0].qty, 250);
  assert.equal(L.typicalQty(usage, egg, 'breakfast'), 4);
});

// «سجلت» bug: the app, not the model, is the only source of truth for «اتسجل». Run with TZ=Asia/Dubai.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseActions, stripLogClaims, claimsLogged, toNum, dayRef, mealOf, parseLooseJson, streamVisible } from './actions.js';
import { pickFoodLog, prepareLog, commitEntries, undoEntries, replaceEntries, successText, wantsFoodLog, LOG_COPY, actionFromEntries } from './autolog.js';
import { createMemoryDB } from '../../core/db.js';
import { getEntries } from '../nutrition/data.js';
import { buildCatalog } from '../nutrition/logic.js';
import { FOODS } from '../nutrition/foods.js';
import { today as todayKey } from '../../core/date.js';

const cat = buildCatalog(FOODS, []);
const A = (o) => `[[ACTION:${JSON.stringify(o)}]]`;
const ITEM = { name: 'كبدة', grams: 150, meal: 'lunch', kcal: 250, p: 36, c: 4, f: 9 };
const foodOf = (r) => r.actions.find((a) => a.type === 'food.log');

// ───────── malformed model output → still a valid action, or a recorded drop (never silent) ─────────
const MALFORMED = {
  'Arabic-Indic digits as strings': ['[[ACTION:{"type":"food.log","day":"today","items":[{"name":"كبدة","grams":"١٥٠","kcal":"٢٥٠"}]}]]', 150, 250],
  'unquoted Arabic digits': ['[[ACTION:{"type":"food.log","day":"today","items":[{"name":"كبدة","grams":١٥٠,"kcal":٢٥٠}]}]]', 150, 250],
  'unit inside grams «150 جم»': ['[[ACTION:{"type":"food.log","items":[{"name":"كبدة","grams":"150 جم","kcal":"250 kcal"}]}]]', 150, 250],
  'qty + unit «جرام»': [A({ type: 'food.log', items: [{ name: 'كبدة', qty: 150, unit: 'جرام', kcal: 250 }] }), 150, 250],
  'qty + unit «g»': [A({ type: 'food.log', items: [{ name: 'كبدة', qty: '150', unit: 'g', kcal: 250 }] }), 150, 250],
  'qty string with unit «150g»': [A({ type: 'food.log', items: [{ name: 'كبدة', qty: '150g', kcal: 250 }] }), 150, 250],
  'kcal as a string': [A({ type: 'food.log', items: [{ name: 'كبدة', grams: 150, kcal: '250' }] }), 150, 250],
  'trailing comma': ['[[ACTION:{"type":"food.log","items":[{"name":"كبدة","grams":150,"kcal":250,},]}]]', 150, 250],
  'smart quotes': ['[[ACTION:{“type”:“food.log”,“items”:[{“name”:“كبدة”,“grams”:150,“kcal”:250}]}]]', 150, 250],
  'fenced json': ['فهمت.\n```json\n{"type":"food.log","day":"today","items":[{"name":"كبدة","grams":150,"kcal":250}]}\n```', 150, 250],
  'fenced action marker': ['```\n[[ACTION:{"type":"food.log","items":[{"name":"كبدة","grams":150,"kcal":250}]}]]\n```', 150, 250],
  'single bracket marker': [`[ACTION:${JSON.stringify({ type: 'food.log', items: [ITEM] })}]`, 150, 250],
  'lower-case spaced marker': [`[[ action : ${JSON.stringify({ type: 'food.log', items: [ITEM] })} ]]`, 150, 250],
  'day «النهاردة» + meal «الغدا»': [A({ type: 'food.log', day: 'النهاردة', meal: 'الغدا', items: [{ name: 'كبدة', grams: 150, kcal: 250 }] }), 150, 250],
  'calories / protein aliases': [A({ type: 'food.log', items: [{ name: 'كبدة', grams: 150, calories: 250, protein: 36 }] }), 150, 250],
  'trailing prose after the action': [`${A({ type: 'food.log', items: [ITEM] })}\nفهمت: كبدة 150 جم.`, 150, 250],
};
for (const [name, [raw, grams, kcal]] of Object.entries(MALFORMED)) {
  test(`parse tolerant: ${name}`, () => {
    const r = parseActions(raw);
    const a = foodOf(r);
    assert.ok(a, `no food.log from ${raw}`);
    assert.equal(a.items[0].grams, grams); assert.equal(a.items[0].kcal, kcal);
    assert.ok(!/ACTION|\{|```/.test(r.text), `JSON leaked: ${r.text}`);
  });
}

test('truncated / unreadable / incomplete food.log is DROPPED WITH A RECORD (fallback can run), never silently', () => {
  const cases = [
    'فهمت.\n[[ACTION:{"type":"food.log","day":"today","items":[{"name":"كبدة","grams":150,"me', // max_tokens / stream cut
    '[[ACTION:{"type":"food.log","items":[{"name":"كبدة" "grams":150}]}]]', // malformed
    A({ type: 'food.log', items: [{ name: 'كبدة', kcal: 250 }] }), // missing amount
    A({ type: 'food.log', day: 'next week', items: [ITEM] }), // bad day
    'تمام {"type":"food.log","items":[{"name":"كبدة","grams":15', // bare + cut
  ];
  for (const raw of cases) {
    const r = parseActions(raw);
    assert.equal(r.actions.length, 0, raw);
    assert.ok(r.dropped.some((d) => d.type === 'food.log'), `not recorded: ${raw}`);
    assert.ok(!/ACTION|\{/.test(r.text));
  }
});

test('helpers: toNum / dayRef / mealOf / parseLooseJson', () => {
  assert.equal(toNum('١٥٠'), 150); assert.equal(toNum('150 جم'), 150); assert.equal(toNum('≈ 250 kcal'), 250); assert.equal(toNum('٢٫٥'), 2.5);
  assert.equal(toNum('150-200'), null); assert.equal(toNum('كتير'), null); assert.equal(toNum(NaN), null);
  assert.equal(dayRef('النهاردة'), 'today'); assert.equal(dayRef('إمبارح'), 'yesterday'); assert.equal(dayRef('24/10/2026'), '2026-10-24');
  assert.equal(dayRef('٢٠٢٦-١٠-٢٣'), '2026-10-23'); assert.equal(dayRef('بكرة'), null);
  assert.equal(mealOf('الفطار'), 'breakfast'); assert.equal(mealOf('عشاء'), 'dinner'); assert.equal(mealOf('lunch'), 'lunch'); assert.equal(mealOf('x'), null);
  assert.deepEqual(parseLooseJson('{"a":١,}'), { a: 1 }); assert.equal(parseLooseJson('{"a":'), undefined);
  assert.deepEqual(parseLooseJson('{"name":"١٢ حبة"}'), { name: '١٢ حبة' }, 'digits inside strings untouched');
});

// ───────── claim stripping ─────────
test('claim stripping: the model never says it logged anything; negations and plain text untouched', () => {
  const cases = [
    ['سجلت 150 جم كبدة. حوالي 250 سعرة.', 'فهمت 150 جم كبدة. حوالي 250 سعرة.'],
    ['تمام، سجلتلك 150 جم كبدة في الغدا · 250 سعرة.', 'تمام، فهمت 150 جم كبدة في الغدا · 250 سعرة.'],
    ['سجّلتهولك خلاص.', 'فهمت خلاص.'],
    ['ضفتلك الكبدة للغدا.', 'فهمت الكبدة للغدا.'],
    ['اتسجل في الغدا: كبدة. خلي البروتين عالي.', 'خلي البروتين عالي.'],
    ['تم التسجيل ✅', ''],
    ['الأكل اتسجّل.\nفاضلك 900 سعرة.', 'فاضلك 900 سعرة.'],
    ['تمت إضافة الكبدة.', ''],
  ];
  for (const [inp, out] of cases) { assert.equal(stripLogClaims(inp), out, inp); assert.equal(claimsLogged(stripLogClaims(inp)), false, inp); }
  for (const keep of ['ماسجلتش حاجة لسه', 'ما اتسجلش', 'فهمت: كبدة 150 جم · ~250 سعرة', 'سجّل 150 جم كبدة كده: …', 'إيه أحسن وقت للكارديو؟']) assert.equal(stripLogClaims(keep), keep, keep);
});

test('streaming never flashes a «سجلت» claim', () => {
  assert.equal(streamVisible('سجلتلك الكبدة في الغدا'), 'فهمت الكبدة في الغدا');
  assert.equal(streamVisible('اتسجل في الغدا.\n[[ACTION:{"type":"food.log"'), '');
});

// ───────── which food.log applies ─────────
test('pickFoodLog: model action → local parser on the user text → honest failure', () => {
  const user = 'اكلت 150 جم كبدة و290 جم مكرونة';
  assert.ok(wantsFoodLog(user));
  const viaModel = pickFoodLog({ userText: user, actions: parseActions(A({ type: 'food.log', items: [ITEM] })).actions, catalog: cat });
  assert.equal(viaModel.source, 'model'); assert.equal(viaModel.asked, true);
  // prose «سجلت» with no action → local parser on HIS words
  const prose = parseActions('تمام، سجلتلك 150 جم كبدة و290 جم مكرونة.');
  const viaLocal = pickFoodLog({ userText: user, actions: prose.actions, dropped: prose.dropped, catalog: cat });
  assert.equal(viaLocal.source, 'local'); assert.deepEqual(viaLocal.action.items.map((x) => x.grams), [150, 290]);
  // truncated JSON + an unknown dish → nothing valid → honest failure (action null)
  const cut = parseActions('[[ACTION:{"type":"food.log","items":[{"name":"طاجن ورق عنب بالكوارع","gra');
  const none = pickFoodLog({ userText: 'اكلت 200 جم طاجن ورق عنب بالكوارع', actions: cut.actions, dropped: cut.dropped, catalog: cat });
  assert.equal(none.source, 'none'); assert.equal(none.action, null);
  assert.match(LOG_COPY.fail, /ماقدرتش أسجّل — اكتب الصنف والكمية، مثال: 150 جم كبدة/);
  // a plain question: nothing to do
  assert.equal(pickFoodLog({ userText: 'كام بروتين محتاج؟', actions: [], dropped: [], catalog: cat }), null);
  // the model proposes food without being asked (plan chip) → still returned, but asked=false (the chat shows a confirm card)
  const chip = pickFoodLog({ userText: 'اقترح وجبة تكمّل البروتين الباقي النهارده وجهّزها للتسجيل.', actions: parseActions(A({ type: 'food.log', items: [ITEM] })).actions, catalog: cat });
  assert.equal(chip.asked, false);
});

// ───────── day / meal ─────────
test('prepareLog: local Dubai day, yesterday, stated meal, meal by the hour', () => {
  const now = new Date(2026, 9, 24, 8, 30); // 08:30 local
  const today = todayKey(now);
  assert.equal(today, '2026-10-24');
  const a = prepareLog({ type: 'food.log', day: 'today', meal: null, items: [{ name: 'كبدة', grams: 150, meal: null, kcal: 250 }] }, { catalog: cat, now, today });
  assert.equal(a.day, '2026-10-24'); assert.equal(a.entries[0].section, 'breakfast'); assert.equal(a.entries[0].time, '08:30');
  const b = prepareLog({ type: 'food.log', day: 'yesterday', meal: 'dinner', items: [{ name: 'كبدة', grams: 150, meal: 'dinner' }] }, { catalog: cat, now, today });
  assert.equal(b.day, '2026-10-23'); assert.equal(b.entries[0].section, 'dinner');
  // 00:30 Dubai is still 2026-10-23 20:30 UTC: the entry must land on the LOCAL day
  const late = new Date('2026-10-24T00:30:00+04:00');
  assert.equal(todayKey(late), '2026-10-24');
});

// ───────── verified write gating + idempotency ─────────
const entries1 = () => prepareLog({ type: 'food.log', day: 'today', items: [{ name: 'كبدة', grams: 150, meal: 'lunch' }, { name: 'مكرونة', grams: 290, meal: 'lunch' }] }, { catalog: cat, now: new Date(2026, 9, 24, 13), today: '2026-10-24' });

test('commitEntries: writes, reads back, success text built from the verified rows', async () => {
  const db = createMemoryDB();
  const { day, entries } = entries1();
  const res = await commitEntries(db, day, entries, 'c:msg1');
  const rows = await getEntries(db, day);
  assert.equal(rows.length, 2); assert.ok(rows.every((e) => e.ik === 'c:msg1' && e.src === 'coach'));
  assert.equal(res.dup, false);
  const t = successText(res, '2026-10-24');
  assert.match(t, /^✅ اتسجل في الغدا: /); assert.match(t, / سعر · \d+ بروتين$/);
  assert.match(successText(res, '2026-10-25'), /^✅ اتسجل \(امبارح\)/);
});

test('idempotency: the same message key never logs twice (retry / stream replay)', async () => {
  const db = createMemoryDB();
  const { day, entries } = entries1();
  const r1 = await commitEntries(db, day, entries, 'c:msg2');
  const again = entries1(); // a replay builds fresh ids
  const r2 = await commitEntries(db, day, again.entries, 'c:msg2');
  assert.equal(r2.dup, true); assert.deepEqual(r2.entries.map((e) => e.id), r1.entries.map((e) => e.id));
  assert.equal((await getEntries(db, day)).length, 2);
  await commitEntries(db, day, entries1().entries, 'c:msg3'); // another message logs normally
  assert.equal((await getEntries(db, day)).length, 4);
});

test('a failed write throws (no success), a write that does not read back throws, existing rows survive', async () => {
  const bad = createMemoryDB({ failWrites: true });
  await assert.rejects(commitEntries(bad, '2026-10-24', entries1().entries, 'k'));
  // a DB that "accepts" the write but reads back nothing (lost write)
  const db = createMemoryDB();
  const lossy = { ...db, update: async (s, k, fn) => fn(undefined).out, get: db.get.bind(db) };
  await assert.rejects(commitEntries(lossy, '2026-10-24', entries1().entries, 'k'), /not verified/);
  // a read error must not be treated as an empty day and overwrite it
  const real = createMemoryDB();
  await commitEntries(real, '2026-10-24', entries1().entries, 'old');
  const flaky = { kind: 'x', get: async () => { throw new Error('read failed'); }, put: real.put.bind(real), delete: real.delete.bind(real) };
  await assert.rejects(commitEntries(flaky, '2026-10-24', entries1().entries, 'new'));
  assert.equal((await getEntries(real, '2026-10-24')).length, 2);
});

test('undo removes exactly the logged rows (verified); edit swaps them atomically', async () => {
  const db = createMemoryDB();
  const keep = await commitEntries(db, '2026-10-24', entries1().entries, 'a');
  const res = await commitEntries(db, '2026-10-24', entries1().entries, 'b');
  const act = actionFromEntries(res);
  assert.equal(act.items[0].grams, 150); assert.equal(act.items[0].meal, 'lunch');
  const edited = prepareLog({ ...act, items: [{ ...act.items[0], grams: 200 }] }, { catalog: cat, now: new Date(2026, 9, 24, 13), today: '2026-10-24' });
  const r2 = await replaceEntries(db, '2026-10-24', res.entries.map((e) => e.id), edited.entries, 'b:e1');
  let rows = await getEntries(db, '2026-10-24');
  assert.equal(rows.length, 3); assert.ok(rows.some((e) => e.qty === 200 && e.ik === 'b:e1'));
  await undoEntries(db, '2026-10-24', r2.entries.map((e) => e.id));
  rows = await getEntries(db, '2026-10-24');
  assert.deepEqual(rows.map((e) => e.id), keep.entries.map((e) => e.id));
  await assert.rejects(undoEntries(createMemoryDB({ failWrites: true }), '2026-10-24', ['x']));
});

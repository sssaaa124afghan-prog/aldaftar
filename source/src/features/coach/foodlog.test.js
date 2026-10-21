import test from 'node:test';
import assert from 'node:assert/strict';
import { parseActions, validateAction, streamVisible, stripLeftovers } from './actions.js';
import { resolveItems, withAmount, withFood, totals, entriesFor, resolveDay, localFoodLog } from './foodlog.js';
import { SYSTEM, FOOD_PROTOCOL, ACTION_PROTOCOL, INTENTS, detectIntent, blocksFor } from './prompts.js';
import { buildCatalog } from '../nutrition/logic.js';
import { FOODS } from '../nutrition/foods.js';

const cat = buildCatalog(FOODS, []);
const REPLY = 'تمام، فهمت 150 جم كبدة و290 جم مكرونة ≈ 630 سعرة و50 جم بروتين (تقدير).\n'
  + '[[ACTION:{"type":"food.log","day":"today","meal":"lunch","items":[{"name":"كبدة","grams":150,"kcal":250,"p":36,"c":4,"f":9},{"name":"مكرونة","grams":290,"kcal":380,"p":14,"c":73,"f":3}]}]]';

test('food.log: parsed, validated, JSON never visible', () => {
  const r = parseActions(REPLY);
  assert.equal(r.text, 'تمام، فهمت 150 جم كبدة و290 جم مكرونة ≈ 630 سعرة و50 جم بروتين (تقدير).');
  assert.equal(r.actions.length, 1);
  const a = r.actions[0];
  assert.equal(a.type, 'food.log'); assert.equal(a.day, 'today'); assert.equal(a.meal, 'lunch');
  assert.deepEqual(a.items.map((x) => [x.name, x.grams, x.meal]), [['كبدة', 150, 'lunch'], ['مكرونة', 290, 'lunch']]);
});

test('food.log validation: qty+unit, grams unit folded, bad items/days rejected', () => {
  const a = validateAction({ type: 'food.log', day: 'yesterday', items: [{ name: 'بيض', qty: 3, unit: 'حبة', meal: 'breakfast', kcal: 210 }, { name: 'رز', qty: 200, unit: 'جم' }, { name: '', grams: 100 }, { name: 'x', grams: 0 }, { name: 'شاي', grams: 99999 }] });
  assert.equal(a.day, 'yesterday');
  assert.deepEqual(a.items, [{ name: 'بيض', meal: 'breakfast', qty: 3, unit: 'حبة', kcal: 210 }, { name: 'رز', meal: null, grams: 200 }]);
  assert.equal(validateAction({ type: 'food.log', items: [] }), null);
  assert.equal(validateAction({ type: 'food.log', day: 'next week', items: [{ name: 'رز', grams: 100 }] }), null);
  assert.equal(validateAction({ type: 'food.log', items: [{ name: 'رز', grams: 100, kcal: -5 }] }).items[0].kcal, undefined);
  const bad = parseActions('سجلتلك.\n[[ACTION:{"type":"food.log","items":[{"name":"رز"}]}]]');
  assert.equal(bad.actions.length, 0); assert.equal(bad.errors.length, 1); assert.ok(bad.text.length > 0);
});

test('resolve against the food DB; unknown food keeps the model estimate flagged est', () => {
  const rows = resolveItems([{ name: 'مكرونة', grams: 290, meal: 'lunch', kcal: 380, p: 14, c: 73, f: 3 }, { name: 'بيض', qty: 3, unit: 'حبة', kcal: 210, p: 18, c: 1, f: 15 },
    { name: 'طاجن ورق عنب بالكوارع', grams: 200, kcal: 400, p: 20, c: 30, f: 22 }], cat, { hour: 14 });
  assert.equal(rows[0].est, false); assert.match(rows[0].food.name, /مكرونة/); assert.equal(rows[0].kcal, 379.9); // DB: 131/100 g
  assert.equal(rows[1].est, false); assert.match(rows[1].food.name, /بيضة/); assert.equal(rows[1].unit, 'حبة');
  assert.equal(rows[2].est, true); assert.equal(rows[2].food, null); assert.equal(rows[2].kcal, 400); assert.equal(rows[2].meal, 'lunch');
  // editing amounts rescales both kinds
  assert.equal(withAmount(rows[2], 100).kcal, 200);
  assert.equal(withAmount(rows[0], 100).kcal, 131);
  assert.equal(withAmount(rows[0], 0).invalid, true);
  // switch a DB row back to the model's estimate
  assert.equal(withFood(rows[0], null).est, true); assert.equal(withFood(rows[0], null).kcal, 380);
  const t = totals(rows); assert.equal(t.kcal, Math.round((379.9 + rows[1].kcal + 400) * 10) / 10);
  const es = entriesFor(rows, new Date('2026-10-21T14:05:00'));
  assert.equal(es.length, 3);
  assert.equal(es[0].foodId, rows[0].food.id); assert.equal(es[0].section, 'lunch'); assert.equal(es[0].qty, 290);
  assert.equal(es[2].foodId, null); assert.equal(es[2].est, true); assert.equal(es[2].unit, 'جرام'); assert.equal(es[2].time, '14:05');
});

test('day resolution: today / yesterday / date within 30 days; future → today', () => {
  assert.equal(resolveDay('today', '2026-10-21'), '2026-10-21');
  assert.equal(resolveDay('yesterday', '2026-10-21'), '2026-10-20');
  assert.equal(resolveDay('2026-10-18', '2026-10-21'), '2026-10-18');
  assert.equal(resolveDay('2026-10-25', '2026-10-21'), '2026-10-21');
  assert.equal(resolveDay('2025-01-01', '2026-10-21'), '2026-10-21');
});

test('local fast path: «اكلت 150 جم كبدة و290 جم مكرونة» → two items, no API; unknown food → null (model handles it)', () => {
  const a = localFoodLog('اكلت 150 جم كبدة و290 جم مكرونة', cat);
  assert.deepEqual(a.items.map((x) => x.grams), [150, 290]);
  assert.equal(validateAction(a).items.length, 2);
  const b = localFoodLog('اكلت 150 جم كبدة فراخ و 290 جم مكرونة للغدا', cat);
  assert.equal(b.meal, 'lunch'); assert.equal(b.items[0].name, 'كبده فراخ');
  assert.equal(localFoodLog('اكلت 200 جم طاجن ورق عنب بالكوارع', cat), null);
  assert.equal(localFoodLog('إيه أحسن وقت للتمرين؟', cat), null);
});

test('prompt: answer the question first, Egyptian, concise; food.log required when he ate', () => {
  assert.match(SYSTEM, /ANSWER THE USER'S LATEST MESSAGE FIRST/);
  assert.match(SYSTEM, /Egyptian Arabic/);
  assert.match(SYSTEM, /background/);
  for (const p of [FOOD_PROTOCOL, ACTION_PROTOCOL]) { assert.match(p, /food\.log/); assert.match(p, /اكلت 150 جم كبدة و290 جم مكرونة/); assert.match(p, /ALWAYS/); }
  assert.ok(FOOD_PROTOCOL.length < ACTION_PROTOCOL.length / 2, 'Haiku intents get the short protocol');
  assert.equal(INTENTS.food_log.model, 'quick'); assert.equal(INTENTS.food_log.protocol, 'food');
  // a short question gets a small context; an analysis question gets Sonnet
  assert.ok(!blocksFor('quick', 'ينفع أتمرن صايم؟').includes('patterns'));
  assert.ok(blocksFor('quick', 'البنش واقف').includes('strength'));
  assert.equal(INTENTS[detectIntent('حلّل أدائي الأسبوع ده')].model, 'coach');
  assert.ok(Object.values(INTENTS).every((i) => i.maxTokens <= 1600));
});

test('streaming view never shows action JSON or an unclosed fence; leftovers stripped', () => {
  assert.equal(streamVisible('تمام.\n[[ACTION:{"type":"food.log","items":[{"na'), 'تمام.');
  assert.equal(streamVisible('تمام.\n[['), 'تمام.');
  assert.equal(streamVisible(REPLY), parseActions(REPLY).text);
  assert.equal(streamVisible('شوف:\n```json\n{"type":"water"'), 'شوف:');
  assert.equal(stripLeftovers('رد {"items":[{"name":"رز","gr'), 'رد');
  assert.equal(parseActions('[[ACTION:{"type":"food.log","items":[{"name":"x","grams":0}]}]]').text, '');
});

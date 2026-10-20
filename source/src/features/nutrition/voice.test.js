import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFoodUtterance, arabicWordsToDigits, fastPathLog, normalizeArabicNums } from './voice.js';
import { buildCatalog } from './logic.js';
import { FOODS } from './foods.js';

const cat = buildCatalog(FOODS, []);

test('«ميتين وخمسين جرام رز» → 250 g rice', () => {
  const p = parseFoodUtterance('ميتين وخمسين جرام رز');
  assert.equal(p.qty, 250); assert.equal(p.unit, 'g'); assert.equal(p.name, 'رز');
  const fp = fastPathLog('ميتين وخمسين جرام رز', cat);
  assert.ok(fp && /رز|أرز/.test(fp.food.name) && fp.food.unit === 'جرام'); assert.equal(fp.qty, 250);
  assert.equal(arabicWordsToDigits('ميتين وخمسين جرام رز'), '250 جرام رز');
});

test('«ضيف 150 جرام صدر فراخ» → fast path (no API), verb required mode', () => {
  const fp = fastPathLog('ضيف 150 جرام صدر فراخ', cat, { requireVerb: true });
  assert.ok(fp); assert.match(fp.food.name, /صدور فراخ/); assert.equal(fp.qty, 150);
  assert.equal(fastPathLog('150 جرام صدر فراخ', cat, { requireVerb: true }), null);
  assert.equal(parseFoodUtterance('سجّل ٢٠٠ جرام تونة').qty, 200);
});

test('Egyptian + MSA number words, kilo fractions, duals, sections', () => {
  const cases = [
    ['مية وعشرين جرام تونة على الغدا', 120, 'g', 'lunch'],
    ['مئة وخمسين غرام دجاج', 150, 'g', null],
    ['تلات مية جرام لحمة', 300, 'g', null],
    ['خمسة وعشرين جرام شوفان', 25, 'g', null],
    ['نص كيلو فراخ', 500, 'g', null],
    ['ربع كيلو جبنة', 250, 'g', null],
    ['كيلو ونص بطاطس', 1500, 'g', null],
    ['سجل ٣ بيضات للفطار', 3, null, 'breakfast'],
    ['بيضتين', 2, null, null],
    ['سكوب واي', 1, 'piece', null],
    ['ميتين جرام فراخ للعشا', 200, 'g', 'dinner'],
  ];
  for (const [t, q, u, s] of cases) {
    const p = parseFoodUtterance(t);
    assert.equal(p.qty, q, t); assert.equal(p.unit, u, t); assert.equal(p.section, s, t);
  }
  assert.equal(fastPathLog('سجل 3 بيضات للفطار', cat).food.name, 'بيضة كاملة');
  assert.equal(fastPathLog('سجل 3 بيضات للفطار', cat).section, 'breakfast');
});

test('«مية» as water is not a number; unit mismatch / ambiguous → no fast path', () => {
  assert.equal(parseFoodUtterance('كوباية مية').name, 'ميه');
  assert.equal(fastPathLog('كوباية مية', cat), null, 'must not match كريمية');
  assert.equal(fastPathLog('2 فراخ', cat), null);
  assert.equal(fastPathLog('فراخ', cat), null);
  assert.equal(fastPathLog('200 جرام حاجة غريبة جدا', cat), null);
  assert.equal(normalizeArabicNums('١٥٠'), '150');
});

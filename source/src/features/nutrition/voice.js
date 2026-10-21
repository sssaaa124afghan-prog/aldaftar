// Voice / free-text food parser (ar-EG). Ported from NutriPro (arabicWordsToDigits, parseVoiceInput) and rebuilt as a
// tokenizer so «مية» inside other words and «و» joins are handled. Pure functions + a thin SpeechRecognition wrapper.
// Shared with the coach (local fast-path parser, no API call).
import { normalizeAr, searchFoods, scoreFood, stemAr, SECTION_LABEL } from './logic.js';

/** Arabic-Indic digits → Latin, Arabic comma → comma (old normalizeArabicNums). */
export function normalizeArabicNums(text) {
  return String(text ?? '').replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x6F0)).replace(/[٫]/g, '.').replace(/،/g, ',');
}

// Number words in normalizeAr() form (أ→ا, ة→ه, ى→ي, ئ→ي): Egyptian first, then MSA.
const W = new Map(Object.entries({
  'صفر': 0, 'واحد': 1, 'واحده': 1, 'اتنين': 2, 'اثنين': 2, 'اتنان': 2, 'اثنان': 2, 'تلاته': 3, 'ثلاثه': 3, 'تلات': 3, 'ثلاث': 3,
  'اربعه': 4, 'اربع': 4, 'خمسه': 5, 'خمس': 5, 'سته': 6, 'ست': 6, 'سبعه': 7, 'سبع': 7, 'تمانيه': 8, 'تمنيه': 8, 'ثمانيه': 8, 'تمن': 8,
  'تسعه': 9, 'تسع': 9, 'عشره': 10, 'عشر': 10,
  'حداشر': 11, 'احداشر': 11, 'اتناشر': 12, 'تلتاشر': 13, 'تلاتاشر': 13, 'اربعتاشر': 14, 'ارباعتاشر': 14, 'خمستاشر': 15, 'ستاشر': 16,
  'سبعتاشر': 17, 'تمنتاشر': 18, 'تسعتاشر': 19,
  'عشرين': 20, 'تلاتين': 30, 'ثلاثين': 30, 'اربعين': 40, 'خمسين': 50, 'ستين': 60, 'سبعين': 70, 'تمانين': 80, 'ثمانين': 80, 'تسعين': 90,
  'ميه': 100, 'مايه': 100, 'ميتين': 200, 'مايتين': 200, 'تلتميه': 300, 'تلاتميه': 300, 'ثلاثميه': 300, 'ربعميه': 400, 'اربعميه': 400,
  'خمسميه': 500, 'ستميه': 600, 'سبعميه': 700, 'تمنميه': 800, 'ثمانميه': 800, 'تسعميه': 900, 'الف': 1000, 'الفين': 2000,
}));
const FRACTIONS = new Map(Object.entries({ 'نص': 0.5, 'نصف': 0.5, 'ربع': 0.25, 'تلت': 1 / 3, 'ثلث': 1 / 3 }));
const KILO = new Set(['كيلو', 'كيلوجرام', 'كيلوغرام', 'كجم', 'كيلوات']);
const UNITS = new Map([
  ...['جرام', 'غرام', 'جم', 'جرامات', 'غرامات', 'g', 'gm', 'جرامين'].map((w) => [w, 'g']),
  ...['مل', 'ملي', 'ملليلتر', 'مليلتر', 'ml'].map((w) => [w, 'ml']),
  ...['حبه', 'حبات', 'حته', 'حتت', 'قطعه', 'قطع', 'شريحه', 'شرايح', 'شرائح', 'طبق', 'صحن', 'وجبه', 'رغيف', 'ارغفه', 'سكوب', 'كوب', 'كوبايه', 'اكواب', 'كوبايات', 'معلقه', 'ملعقه', 'معالق', 'ملاعق', 'علبه', 'كيس'].map((w) => [w, 'piece']),
]);
// Dual forms → [2, word kept as the food/unit].
const DUALS = new Map(Object.entries({ 'بيضتين': 'بيض', 'رغيفين': 'رغيف', 'سكوبين': 'سكوب', 'كوبايتين': 'كوبايه', 'معلقتين': 'معلقه', 'ملعقتين': 'ملعقه', 'حبتين': 'حبه', 'حتتين': 'حته', 'علبتين': 'علبه', 'شريحتين': 'شريحه', 'موزتين': 'موز', 'تفاحتين': 'تفاح' }));
const VERBS = new Set(['ضيف', 'ضف', 'اضف', 'اضيف', 'سجل', 'سجلي', 'اسجل', 'سجلها', 'كلت', 'اكلت', 'شربت', 'خد', 'حط', 'احسب', 'حسب', 'تسجيل', 'اضافه']);
const FILLERS = new Set(['انا', 'عايز', 'عاوز', 'محتاج', 'لو', 'سمحت', 'من', 'فضلك', 'كمان', 'بقالي', 'عندي', 'النهارده', 'دلوقتي', 'يا', 'ابن', 'لي', 'ليا', 'بس']);
const PREPS = new Set(['في', 'علي', 'ع', 'ل', 'لل', 'مع']);
const PLURALS = new Map(Object.entries({ 'بيضات': 'بيضه', 'بيض': 'بيضه', 'تفاحات': 'تفاح', 'موزات': 'موز', 'رغفان': 'رغيف', 'ارغفه': 'رغيف', 'تمرات': 'تمر' }));
const SECTION_WORDS = new Map(Object.entries({ 'فطار': 'breakfast', 'فطور': 'breakfast', 'افطار': 'breakfast', 'غدا': 'lunch', 'غداء': 'lunch', 'عشا': 'dinner', 'عشاء': 'dinner', 'سناك': 'snack', 'سناكس': 'snack', 'تصبيره': 'snack' }));

const numWord = (t) => {
  if (/^\d+(?:[.,]\d+)?$/.test(t)) return Number(t.replace(',', '.'));
  if (W.has(t)) return W.get(t);
  return null;
};
const sectionWord = (t) => {
  for (const pre of ['', 'ال', 'لل', 'ل', 'بال', 'في']) if (t.startsWith(pre) && SECTION_WORDS.has(t.slice(pre.length))) return SECTION_WORDS.get(t.slice(pre.length));
  return null;
};

/**
 * arabicWordsToDigits(text) → text with number phrases turned into digits («ميتين وخمسين جرام رز» → «250 جرام رز»,
 * «نص كيلو» → «500»). Works on whole words only, so «مية» (water) after a quantity stays a word.
 */
export function arabicWordsToDigits(text) {
  const p = parseFoodUtterance(text);
  return p.tokens.join(' ');
}

/**
 * parseFoodUtterance(text) → {intent:'log'|'search', qty, unit:'g'|'ml'|'piece'|null, name, section, tokens}
 * qty is in grams when a kilo was said.
 */
export function parseFoodUtterance(text) {
  const norm = normalizeAr(normalizeArabicNums(text)).replace(/(\d)([^\d\s.,])/g, '$1 $2').replace(/([^\d\s.,])(\d)/g, '$1 $2');
  const toks = norm.split(' ').filter(Boolean);
  let intent = 'search', qty = null, unit = null, section = null;
  const name = [];
  const outToks = [];
  let i = 0;
  if (toks.length && VERBS.has(toks[0])) { intent = 'log'; i = 1; }
  while (i < toks.length) {
    let t = toks[i];
    // section («للغدا», «في العشا»)
    const sec = sectionWord(t);
    if (sec) { section = section || sec; outToks.push(t); i++; continue; }
    if (VERBS.has(t)) { intent = 'log'; i++; continue; }
    if (DUALS.has(t) && qty === null) {
      qty = 2; const base = DUALS.get(t);
      if (UNITS.has(base)) unit = UNITS.get(base); else name.push(PLURALS.get(base) || base);
      outToks.push('2', base); i++; continue;
    }
    // number phrase
    const startsNum = (x) => numWord(x) !== null || FRACTIONS.has(x) || KILO.has(x) || (x.startsWith('و') && (numWord(x.slice(1)) !== null || FRACTIONS.has(x.slice(1))));
    // «مية» is water when a quantity was already said or it ends the phrase («كوباية مية», «عايز مية»)
    const isWater = t === 'ميه' && (qty !== null || i === toks.length - 1);
    if (qty === null && startsNum(t) && !isWater) {
      let cur = 0, kilo = false, any = false, lastKilo = false;
      while (i < toks.length) {
        t = toks[i];
        let joined = false;
        if (t === 'و' && i + 1 < toks.length && (numWord(toks[i + 1]) !== null || FRACTIONS.has(toks[i + 1]))) { i++; t = toks[i]; joined = true; }
        else if (t.startsWith('و') && t.length > 1 && (numWord(t.slice(1)) !== null || FRACTIONS.has(t.slice(1))) && numWord(t) === null) { t = t.slice(1); joined = true; }
        const n = numWord(t);
        if (n !== null) {
          if (n === 100 && cur > 0 && cur < 10 && !joined) cur *= 100;
          else if (n === 1000 && cur > 0 && cur < 1000 && !joined) cur *= 1000;
          else cur += n;
          any = true; lastKilo = false; i++; continue;
        }
        if (FRACTIONS.has(t)) {
          const fr = FRACTIONS.get(t);
          if (lastKilo) cur += fr * 1000; else if (joined) cur += fr; else cur = (cur || 0) + fr;
          any = true; i++; continue;
        }
        if (KILO.has(t)) { cur = (cur || 1) * 1000; kilo = true; any = true; lastKilo = true; i++; continue; }
        if (joined) i--; // a lone «و» that did not join numbers
        break;
      }
      if (any) {
        qty = Math.round(cur * 100) / 100;
        if (kilo) unit = 'g';
        outToks.push(String(qty));
        continue;
      }
    }
    if (UNITS.has(t)) { if (!unit) unit = UNITS.get(t); outToks.push(t); i++; continue; }
    if (FILLERS.has(t) || PREPS.has(t)) { outToks.push(t); i++; continue; }
    name.push(PLURALS.get(t) || t); outToks.push(t); i++;
  }
  if (qty === null && unit === 'piece') qty = 1;
  return { intent, qty, unit, name: name.join(' ').trim(), section, tokens: outToks };
}

/**
 * fastPathLog(text, catalog, {requireVerb, minScore}) → null | {food, qty, section, score}
 * Local parse of «ضيف 150 جرام صدر فراخ للغدا»: a confident catalog match + a quantity that fits the food's unit.
 * The caller logs it (and shows Undo) without any API call.
 */
export function fastPathLog(text, catalog, { requireVerb = false, minScore = 60 } = {}) {
  const p = parseFoodUtterance(text);
  if (requireVerb && p.intent !== 'log') return null;
  if (!p.name || !(p.qty > 0)) return null;
  const q = normalizeAr(p.name);
  let qty = p.qty;
  const fits = (food) => {
    const grams = /جرام|مل/.test(food.unit || 'جرام');
    if ((p.unit === 'g' || p.unit === 'ml') && !grams) return false;
    if (p.unit === 'piece' && grams) return false;
    if (!p.unit && grams && qty < 10) return false; // «2 فراخ» is ambiguous
    if (!p.unit && !grams && (food.cat === 'وجبة' || /وجبة|حصة|طبق/.test(food.unit || ''))) return false; // a count without a unit is not «2 meals»
    return true;
  };
  // every spoken word must start a word of the food name (or an alias) — «مية» must not match «كريمية»
  const qWords = q.split(' ').filter((w) => w.length > 1);
  const wordsHit = (f) => [f._n || normalizeAr(f.name), ...(f.aliases || []).map(normalizeAr)].some((n) => {
    const fw = n.split(' ');
    return qWords.every((w) => fw.some((x) => x.startsWith(w) || x.startsWith(stemAr(w)) || stemAr(x) === stemAr(w) || x === `ا${w}`));
  });
  const food = searchFoods(catalog, p.name, { limit: 8 }).find((f) => scoreFood(f, q) >= minScore && fits(f) && wordsHit(f));
  if (!food || !(qty > 0 && qty <= 5000)) return null;
  const score = scoreFood(food, q);
  return { food, qty, section: p.section && SECTION_LABEL[p.section] ? p.section : null, score };
}

// ───────── browser speech recognition (ar-EG → ar-SA), shared core/speech.js ─────────
import { speechEnv, speechMessage, listen as listenSpeech } from '../../core/speech.js';

/** True only when in-page recognition can work (false in an iOS home-screen app, where keyboard dictation is the path). */
export const voiceSupported = () => speechEnv().supported;

export const VOICE_ERRORS = Object.freeze(Object.fromEntries(['not-allowed', 'service-not-allowed', 'no-speech', 'network', 'audio-capture'].map((k) => [k, speechMessage(k, { ios: false })])));

/** startVoice({onResult(text, alternatives), onInterim(text), onError(message, code), onState, onEnd}) → stop(). */
export function startVoice({ onResult, onInterim, onError, onState, onEnd } = {}) {
  return listenSpeech({ onInterim, onState, onEnd, onResult: (alts) => onResult?.(alts[0] || '', alts), onError: (code, msg) => onError?.(msg, code) });
}

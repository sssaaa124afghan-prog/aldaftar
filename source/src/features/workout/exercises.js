// Exercise library + default programs for the workout feature.
// Ported from Solo Gym (GLASS) EXERCISE_LIBRARY / MY_DAYS / PROGRAMS_DEF.
// YouTube links, technique blurbs and warm-up pseudo-exercises dropped.
// Program item ids keep the legacy Solo Gym ids so migrated session history lines up.

import { HEART_DOW, UL4C_TRAINING_DAYS, UL4C_LEGACY_TRAINING_DAYS } from '../../core/schema.js';

/** kind: 'compound' | 'isolation' drives the rest rule (150 s / 90 s). */
export const LIBRARY = [
  // صدر
  { id: 'ex1', ar: 'بنش بريس بالبار', en: 'Barbell Bench Press', muscle: 'صدر', kind: 'compound', eq: 'بار' },
  { id: 'ex2', ar: 'ضغط دمبل مائل', en: 'Incline DB Press', muscle: 'صدر', kind: 'compound', eq: 'دمبل' },
  { id: 'ex3', ar: 'بنش سفلي بالبار', en: 'Decline Bench Press', muscle: 'صدر', kind: 'compound', eq: 'بار' },
  { id: 'exFDP', ar: 'ضغط دمبل مسطّح', en: 'Flat DB Press', muscle: 'صدر', kind: 'compound', eq: 'دمبل' },
  { id: 'exMDP', ar: 'ضغط سفلي بالجهاز', en: 'Machine Decline Press', muscle: 'صدر', kind: 'compound', eq: 'جهاز' },
  { id: 'ex4', ar: 'كروس أوفر بالكابل', en: 'Cable Crossover', muscle: 'صدر', kind: 'isolation', eq: 'كابل' },
  { id: 'ex5', ar: 'فتح بالدمبل', en: 'Dumbbell Fly', muscle: 'صدر', kind: 'isolation', eq: 'دمبل' },
  { id: 'ex6', ar: 'ضغط أرضي', en: 'Push-Ups', muscle: 'صدر', kind: 'compound', eq: 'وزن جسم' },
  { id: 'ex7', ar: 'متوازي للصدر', en: 'Chest Dips', muscle: 'صدر', kind: 'compound', eq: 'وزن جسم' },
  { id: 'ex8', ar: 'فراشة بالجهاز', en: 'Pec Deck Fly', muscle: 'صدر', kind: 'isolation', eq: 'جهاز' },
  { id: 'ex9', ar: 'لاندماين بريس', en: 'Landmine Press', muscle: 'صدر', kind: 'compound', eq: 'بار' },
  // ظهر
  { id: 'ex11', ar: 'ديدليفت', en: 'Deadlift', muscle: 'ظهر', kind: 'compound', eq: 'بار' },
  { id: 'ex12', ar: 'عقلة', en: 'Pull-Ups', muscle: 'ظهر', kind: 'compound', eq: 'وزن جسم' },
  { id: 'exWPU', ar: 'عقلة بوزن مضاف', en: 'Weighted Pull-Up', muscle: 'ظهر', kind: 'compound', eq: 'وزن جسم' },
  { id: 'ex13', ar: 'تجديف بالبار', en: 'Barbell Row', muscle: 'ظهر', kind: 'compound', eq: 'بار' },
  { id: 'ex14', ar: 'سحب أمامي بالكابل', en: 'Lat Pulldown', muscle: 'ظهر', kind: 'compound', eq: 'كابل' },
  { id: 'ex15', ar: 'تجديف كابل جالس', en: 'Seated Cable Row', muscle: 'ظهر', kind: 'compound', eq: 'كابل' },
  { id: 'ex16', ar: 'تجديف T-بار', en: 'T-Bar Row', muscle: 'ظهر', kind: 'compound', eq: 'بار' },
  { id: 'exCSTB', ar: 'تجديف T-بار بسند صدر', en: 'Chest-Supported T-Bar Row', muscle: 'ظهر', kind: 'compound', eq: 'جهاز' },
  { id: 'ex17', ar: 'تجديف دمبل بإيد واحدة', en: '1-Arm DB Row', muscle: 'ظهر', kind: 'compound', eq: 'دمبل' },
  { id: 'ex18', ar: 'سحب بذراع مفرود', en: 'Straight Arm Pulldown', muscle: 'ظهر', kind: 'isolation', eq: 'كابل' },
  { id: 'ex20', ar: 'ظهر سفلي (هايبر)', en: 'Hyperextension', muscle: 'ظهر', kind: 'compound', eq: 'جهاز' },
  // أكتاف
  { id: 'ex21', ar: 'ضغط كتف بالبار', en: 'Overhead Press', muscle: 'كتف', kind: 'compound', eq: 'بار' },
  { id: 'ex22', ar: 'ضغط كتف بالدمبل', en: 'DB Shoulder Press', muscle: 'كتف', kind: 'compound', eq: 'دمبل' },
  { id: 'ex26', ar: 'أرنولد بريس', en: 'Arnold Press', muscle: 'كتف', kind: 'compound', eq: 'دمبل' },
  { id: 'ex23', ar: 'رفرفة جانبي بالدمبل', en: 'Lateral Raises', muscle: 'كتف', kind: 'isolation', eq: 'دمبل' },
  { id: 'ex27', ar: 'رفرفة جانبي بالكابل', en: 'Cable Lateral Raise', muscle: 'كتف', kind: 'isolation', eq: 'كابل' },
  { id: 'ex28', ar: 'سحب عمودي بالبار', en: 'Upright Row', muscle: 'كتف', kind: 'compound', eq: 'بار' },
  { id: 'ex24', ar: 'فيس بول', en: 'Face Pull', muscle: 'كتف خلفي', kind: 'isolation', eq: 'كابل' },
  { id: 'ex25', ar: 'رفرفة خلفي بالدمبل', en: 'Rear Delt Fly', muscle: 'كتف خلفي', kind: 'isolation', eq: 'دمبل' },
  { id: 'exRPD', ar: 'فراشة عكسي', en: 'Reverse Pec-Dec', muscle: 'كتف خلفي', kind: 'isolation', eq: 'جهاز' },
  // ذراع
  { id: 'ex29', ar: 'بايسبس بالبار', en: 'Barbell Curl', muscle: 'باي', kind: 'isolation', eq: 'بار' },
  { id: 'ex34b', ar: 'بايسبس بار EZ', en: 'EZ-Bar Curl', muscle: 'باي', kind: 'isolation', eq: 'بار' },
  { id: 'ex30', ar: 'هامر بالدمبل', en: 'Hammer Curl', muscle: 'باي', kind: 'isolation', eq: 'دمبل' },
  { id: 'ex31', ar: 'بايسبس دمبل على بنش مائل', en: 'Incline DB Curl', muscle: 'باي', kind: 'isolation', eq: 'دمبل' },
  { id: 'ex32', ar: 'بايسبس على المسند', en: 'Preacher Curl', muscle: 'باي', kind: 'isolation', eq: 'جهاز' },
  { id: 'ex33', ar: 'بايسبس بالكابل', en: 'Cable Curl', muscle: 'باي', kind: 'isolation', eq: 'كابل' },
  { id: 'ex34', ar: 'بايسبس تركيز', en: 'Concentration Curl', muscle: 'باي', kind: 'isolation', eq: 'دمبل' },
  { id: 'exSPC', ar: 'سبايدر كيرل', en: 'Spider Curl', muscle: 'باي', kind: 'isolation', eq: 'دمبل' },
  { id: 'ex35', ar: 'بنش قبضة ضيقة', en: 'Close Grip Bench Press', muscle: 'تراي', kind: 'compound', eq: 'بار' },
  { id: 'ex36', ar: 'ترايسبس بالحبل', en: 'Rope Pushdown', muscle: 'تراي', kind: 'isolation', eq: 'كابل' },
  { id: 'ex40', ar: 'ترايسبس بالبار على الكابل', en: 'Bar Pushdown', muscle: 'تراي', kind: 'isolation', eq: 'كابل' },
  { id: 'ex37', ar: 'ترايسبس فوق الراس بالدمبل', en: 'Overhead Tricep Extension', muscle: 'تراي', kind: 'isolation', eq: 'دمبل' },
  { id: 'exOCT', ar: 'ترايسبس كابل فوق الراس', en: 'Overhead Cable Triceps Ext', muscle: 'تراي', kind: 'isolation', eq: 'كابل' },
  { id: 'ex38', ar: 'سكل كراشر', en: 'Skull Crushers', muscle: 'تراي', kind: 'isolation', eq: 'بار' },
  { id: 'ex39', ar: 'متوازي للترايسبس', en: 'Tricep Dips', muscle: 'تراي', kind: 'compound', eq: 'وزن جسم' },
  { id: 'ex81', ar: 'ساعد بالبار', en: 'Wrist Curl', muscle: 'ساعد', kind: 'isolation', eq: 'بار' },
  { id: 'ex82', ar: 'بايسبس عكسي', en: 'Reverse Curl', muscle: 'ساعد', kind: 'isolation', eq: 'بار' },
  { id: 'exFW', ar: 'مشية الفلاح', en: 'Farmers Walk', muscle: 'ساعد', kind: 'compound', eq: 'دمبل' },
  { id: 'ex71', ar: 'ترابيس بالبار', en: 'Barbell Shrug', muscle: 'ترابيس', kind: 'isolation', eq: 'بار' },
  { id: 'ex72', ar: 'ترابيس بالدمبل', en: 'DB Shrug', muscle: 'ترابيس', kind: 'isolation', eq: 'دمبل' },
  // رجلين
  { id: 'ex41', ar: 'سكوات بالبار', en: 'Back Squat', muscle: 'رجل', kind: 'compound', eq: 'بار' },
  { id: 'ex41b', ar: 'سكوات أمامي', en: 'Front Squat', muscle: 'رجل', kind: 'compound', eq: 'بار' },
  { id: 'ex45b', ar: 'هاك سكوات', en: 'Hack Squat', muscle: 'رجل', kind: 'compound', eq: 'جهاز' },
  { id: 'ex43', ar: 'دفع رجل بالجهاز', en: 'Leg Press', muscle: 'رجل', kind: 'compound', eq: 'جهاز' },
  { id: 'ex42', ar: 'سكوات بلغاري', en: 'Bulgarian Split Squat', muscle: 'رجل', kind: 'compound', eq: 'دمبل' },
  { id: 'ex44', ar: 'رجل أمامي بالجهاز', en: 'Leg Extension', muscle: 'رجل', kind: 'isolation', eq: 'جهاز' },
  { id: 'ex47', ar: 'ديدليفت روماني', en: 'Romanian Deadlift', muscle: 'رجل خلفي', kind: 'compound', eq: 'بار' },
  { id: 'ex45', ar: 'رجل خلفي نايم', en: 'Lying Leg Curl', muscle: 'رجل خلفي', kind: 'isolation', eq: 'جهاز' },
  { id: 'ex48', ar: 'رجل خلفي جالس', en: 'Seated Leg Curl', muscle: 'رجل خلفي', kind: 'isolation', eq: 'جهاز' },
  { id: 'ex49', ar: 'نورديك', en: 'Nordic Curl', muscle: 'رجل خلفي', kind: 'isolation', eq: 'وزن جسم' },
  { id: 'ex50', ar: 'رفع جلوت هامسترينج', en: 'Glute Ham Raise', muscle: 'رجل خلفي', kind: 'compound', eq: 'جهاز' },
  { id: 'ex46', ar: 'هيب ثرست', en: 'Hip Thrust', muscle: 'مؤخرة', kind: 'compound', eq: 'بار' },
  { id: 'ex46c', ar: 'ديدليفت سومو', en: 'Sumo Deadlift', muscle: 'مؤخرة', kind: 'compound', eq: 'بار' },
  { id: 'ex46b', ar: 'ركلة خلفية بالكابل', en: 'Cable Kickback', muscle: 'مؤخرة', kind: 'isolation', eq: 'كابل' },
  { id: 'ex46d', ar: 'ركلة خلفية على الأرض', en: 'Donkey Kick', muscle: 'مؤخرة', kind: 'isolation', eq: 'وزن جسم' },
  { id: 'ex51', ar: 'سمانة واقف', en: 'Standing Calf Raise', muscle: 'سمانة', kind: 'isolation', eq: 'جهاز' },
  { id: 'ex52', ar: 'سمانة جالس', en: 'Seated Calf Raise', muscle: 'سمانة', kind: 'isolation', eq: 'جهاز' },
  { id: 'ex53', ar: 'سمانة رجل واحدة', en: 'Single Leg Calf Raise', muscle: 'سمانة', kind: 'isolation', eq: 'وزن جسم' },
  // بطن
  { id: 'ex61', ar: 'بلانك', en: 'Plank', muscle: 'بطن', kind: 'isolation', eq: 'وزن جسم' },
  { id: 'exWPL', ar: 'بلانك بوزن', en: 'Weighted Plank', muscle: 'بطن', kind: 'isolation', eq: 'وزن جسم' },
  { id: 'ex62', ar: 'كرانش بالكابل', en: 'Cable Crunch', muscle: 'بطن', kind: 'isolation', eq: 'كابل' },
  { id: 'ex63', ar: 'رفع رجلين', en: 'Leg Raises', muscle: 'بطن', kind: 'isolation', eq: 'وزن جسم' },
  { id: 'ex65', ar: 'رفع رجلين معلّق', en: 'Hanging Leg Raise', muscle: 'بطن', kind: 'isolation', eq: 'وزن جسم' },
  { id: 'ex64', ar: 'عجلة البطن', en: 'Ab Wheel Rollout', muscle: 'بطن', kind: 'isolation', eq: 'أداة' },
  { id: 'ex66', ar: 'لف روسي', en: 'Russian Twist', muscle: 'بطن', kind: 'isolation', eq: 'وزن جسم' },
  { id: 'exWC', ar: 'حطّاب بالكابل', en: 'Cable Woodchopper', muscle: 'بطن', kind: 'isolation', eq: 'كابل' },
  // added for the 4-day upper/lower plan (review.md §3)
  { id: 'exBAY', ar: 'بايسبس كابل باييزيان', en: 'Bayesian Cable Curl', muscle: 'باي', kind: 'isolation', eq: 'كابل' },
  { id: 'exADD', ar: 'جهاز الضامة', en: 'Hip Adduction Machine', muscle: 'ضامة', kind: 'isolation', eq: 'جهاز' },
  { id: 'exWCH', ar: 'وودشوب كابل من فوق لتحت', en: 'High-to-Low Cable Woodchop', muscle: 'بطن', kind: 'isolation', eq: 'كابل' },
  { id: 'exPAL', ar: 'بالوف بريس', en: 'Pallof Press', muscle: 'بطن', kind: 'isolation', eq: 'كابل' },
  { id: 'exRWC', ar: 'ساعد عكسي', en: 'Reverse Wrist Curl', muscle: 'ساعد', kind: 'isolation', eq: 'بار' },
  { id: 'exMHT', ar: 'هيب ثرست سميث/جهاز', en: 'Smith or Machine Hip Thrust', muscle: 'مؤخرة', kind: 'compound', eq: 'جهاز' },
  { id: 'exNECK', ar: 'تمرين رقبة (اختياري)', en: 'Neck Flexion/Extension', muscle: 'رقبة', kind: 'isolation', eq: 'أداة' },
  // exercise-selection audit swaps (plan/exercise-selection.md §3, plan v2)
  { id: 'exLID', ar: 'ضغط دمبل مائل خفيف 15°', en: 'Low-Incline DB Press 15°', muscle: 'صدر', kind: 'compound', eq: 'دمبل' },
  { id: 'exROE', ar: 'ترايسبس حبل فوق الراس واقف', en: 'Standing Rope Overhead Cable Ext', muscle: 'تراي', kind: 'isolation', eq: 'كابل' },
];

/**
 * Fine muscle (the weekly-set unit, hypertrophy.md §3) + synergists (0.5 credit each) per library id.
 * Fine keys: صدر لات «ظهر علوي» «كتف أمامي» «كتف جانبي» «كتف خلفي» باي تراي ساعد كوادز هامسترينج مؤخرة ضامة سمانة بطن جوانب.
 */
const FINE = {
  ex1: ['صدر', ['تراي', 'كتف أمامي']], ex2: ['صدر', ['كتف أمامي', 'تراي']], ex3: ['صدر', ['تراي']], exFDP: ['صدر', ['تراي', 'كتف أمامي']], exLID: ['صدر', ['كتف أمامي', 'تراي']],
  exMDP: ['صدر', ['تراي']], ex4: ['صدر', []], ex5: ['صدر', []], ex6: ['صدر', ['تراي', 'كتف أمامي']], ex7: ['صدر', ['تراي', 'كتف أمامي']],
  ex8: ['صدر', []], ex9: ['صدر', ['كتف أمامي', 'تراي']],
  ex11: ['هامسترينج', ['مؤخرة', 'ظهر علوي']], ex12: ['لات', ['باي', 'ظهر علوي']], exWPU: ['لات', ['باي', 'ظهر علوي']],
  ex13: ['ظهر علوي', ['لات', 'باي', 'كتف خلفي']], ex14: ['لات', ['باي']], ex15: ['ظهر علوي', ['لات', 'باي', 'كتف خلفي']],
  ex16: ['ظهر علوي', ['لات', 'باي', 'كتف خلفي']], exCSTB: ['ظهر علوي', ['لات', 'باي', 'كتف خلفي']], ex17: ['لات', ['ظهر علوي', 'باي']],
  ex18: ['لات', []], ex20: ['مؤخرة', ['هامسترينج']],
  ex21: ['كتف أمامي', ['تراي', 'كتف جانبي']], ex22: ['كتف أمامي', ['تراي', 'كتف جانبي']], ex26: ['كتف أمامي', ['تراي', 'كتف جانبي']],
  ex23: ['كتف جانبي', []], ex27: ['كتف جانبي', []], ex28: ['كتف جانبي', ['ظهر علوي']],
  ex24: ['كتف خلفي', ['ظهر علوي']], ex25: ['كتف خلفي', []], exRPD: ['كتف خلفي', []],
  ex29: ['باي', []], ex34b: ['باي', []], ex30: ['باي', ['ساعد']], ex31: ['باي', []], ex32: ['باي', []], ex33: ['باي', []], ex34: ['باي', []], exSPC: ['باي', []],
  exBAY: ['باي', []],
  ex35: ['تراي', ['صدر']], ex36: ['تراي', []], ex40: ['تراي', []], ex37: ['تراي', []], exOCT: ['تراي', []], exROE: ['تراي', []], ex38: ['تراي', []], ex39: ['تراي', ['صدر']],
  ex81: ['ساعد', []], exRWC: ['ساعد', []], ex82: ['ساعد', ['باي']], exFW: ['ساعد', ['ظهر علوي']],
  ex71: ['ظهر علوي', []], ex72: ['ظهر علوي', []],
  ex41: ['كوادز', ['مؤخرة', 'ضامة']], ex41b: ['كوادز', ['مؤخرة', 'ضامة']], ex45b: ['كوادز', ['مؤخرة', 'ضامة']], ex43: ['كوادز', ['مؤخرة']],
  ex42: ['كوادز', ['مؤخرة', 'ضامة']], ex44: ['كوادز', []],
  ex47: ['هامسترينج', ['مؤخرة']], ex45: ['هامسترينج', []], ex48: ['هامسترينج', []], ex49: ['هامسترينج', []], ex50: ['هامسترينج', ['مؤخرة']],
  ex46: ['مؤخرة', []], exMHT: ['مؤخرة', []], ex46c: ['مؤخرة', ['هامسترينج', 'ضامة']], ex46b: ['مؤخرة', []], ex46d: ['مؤخرة', []],
  exADD: ['ضامة', []],
  ex51: ['سمانة', []], ex52: ['سمانة', []], ex53: ['سمانة', []],
  ex61: ['بطن', []], exWPL: ['بطن', []], ex62: ['بطن', []], ex63: ['بطن', []], ex65: ['بطن', []], ex64: ['بطن', []],
  ex66: ['جوانب', ['بطن']], exWC: ['جوانب', ['بطن']], exWCH: ['جوانب', ['بطن']], exPAL: ['جوانب', ['بطن']],
};
for (const e of LIBRARY) { const f = FINE[e.id]; if (f) { e.prime = f[0]; e.synergists = f[1]; } }

const BY_ID = new Map(LIBRARY.map((e) => [e.id, e]));
const BY_EN = new Map(LIBRARY.map((e) => [e.en.toLowerCase(), e]));
export const libById = (id) => BY_ID.get(id) || null;

/** Normalised English key of a (possibly legacy "English · details") name. */
export function enKey(name) {
  return String(name || '').split('·')[0].replace(/\s+/g, ' ').trim().toLowerCase();
}

// legacy name prefixes that differ from the library English names
const ALIAS = {
  'flat barbell bench press': 'ex1', 'bench press': 'ex1', 'incline db press 30°': 'ex2', 'incline db press': 'ex2',
  'weighted pull-up': 'exWPU', 'chest-supported t-bar row': 'exCSTB', 'reverse pec-dec': 'exRPD',
  'overhead cable triceps ext': 'exOCT', 'overhead extension': 'ex37', 'spider curl': 'exSPC', 'farmers walk': 'exFW',
  'back squat high-bar': 'ex41', 'barbell row bent-over': 'ex13', 'standing barbell overhead press': 'ex21',
  'standing barbell ohp': 'ex21', 'overhead press (ohp)': 'ex21', 'deadlift conventional': 'ex11',
  'barbell hip thrust': 'ex46', 'seated db shoulder press': 'ex22', 'ez skull crusher': 'ex38', 'machine decline press': 'exMDP',
  'cable woodchopper': 'exWC', 'weighted plank': 'exWPL', 'flat db press': 'exFDP', 'incline barbell press': 'ex2',
  'pull-ups': 'ex12', 'lateral raises': 'ex23', 't-bar row': 'ex16', 'low-incline db press': 'exLID', 'rope overhead cable ext': 'exROE',
};

/** Find the library entry for any exercise name (Arabic, English, legacy "English · details"). */
export function findLib(name) {
  const k = enKey(name);
  if (!k) return null;
  if (BY_EN.has(k)) return BY_EN.get(k);
  if (ALIAS[k]) return BY_ID.get(ALIAS[k]);
  const ar = String(name).trim();
  return LIBRARY.find((e) => e.ar === ar) || null;
}

// ── default programs ─────────────────────────────────────────
// [legacyId, libId, sets, reps, ss?, restS?, rir?, fill?]
// ss = superset tag (A1/A2 share 'A'; a tri-set shares one tag). restS = rest after the full round.
// fill = done inside the anchor's rest, one filler at a time (e.g. wrist curls on calf sets 1–3, then reverse wrist curls).
// x = extras: {note} (shown under the exercise in the plan and the session), {r1} (rep range for the first 6-week block only).
const P = (rows) => rows.map(([id, lib, sets, reps, ss, restS, rir, fill, x]) => {
  const L = BY_ID.get(lib);
  const it = { id, lib, ar: L.ar, en: L.en, muscle: L.muscle, kind: L.kind, sets, reps };
  if (ss) it.ss = ss;
  if (restS) it.restS = restS;
  if (rir) it.rir = rir;
  if (fill) it.fill = true;
  if (x && x.note) it.note = x.note;
  if (x && x.r1) it.r1 = x.r1;
  return it;
});

export const PROGRAMS = {
  ul4: {
    id: 'ul4', name: 'Upper / Lower', perWeek: 4, note: 'كل عضلة مرتين في الأسبوع',
    order: ['upperA', 'lowerA', 'upperB', 'lowerB'],
    days: {
      upperA: { name: 'Upper A', items: P([
        ['uaFB', 'ex1', 4, '5-8'], ['ub1', 'exWPU', 4, '6-8'], ['uaID', 'ex2', 3, '8-12'], ['uaTBR', 'exCSTB', 3, '8-10'],
        ['ua5a', 'ex27', 4, '12-20'], ['ua5b', 'exRPD', 3, '12-15'], ['ua6a', 'exOCT', 3, '10-12'], ['ua6b', 'ex31', 3, '8-12']]) },
      lowerA: { name: 'Lower A', items: P([
        ['la1', 'ex41', 4, '5-8'], ['la2', 'ex47', 3, '6-8'], ['la3', 'ex46', 3, '8-10'], ['la7b', 'ex48', 3, '10-12'],
        ['la7a', 'ex44', 3, '12-15'], ['la5a', 'ex51', 3, '10-15'], ['la6a', 'ex65', 3, '12-15']]) },
      upperB: { name: 'Upper B', items: P([
        ['ubOHP', 'ex21', 4, '6-8'], ['ub2', 'ex13', 4, '6-8'], ['ub3', 'exFDP', 3, '8-12'], ['ua4', 'ex14', 3, '9-12'],
        ['ub5a', 'ex27', 4, '12-20'], ['ub5b', 'ex24', 3, '12-15'], ['ub6a', 'ex34b', 3, '8-10'], ['ub6b', 'ex36', 3, '10-12']]) },
      lowerB: { name: 'Lower B', items: P([
        ['lb1', 'ex11', 3, '3-5'], ['lbHACK', 'ex45b', 3, '8-12'], ['la4', 'ex45', 3, '10-12'], ['lb2', 'ex42', 3, '8-10'],
        ['lb5a', 'ex52', 3, '12-20'], ['lb7a', 'ex62', 3, '12-15']]) },
    },
  },
  ppl6: {
    id: 'ppl6', name: 'Push / Pull / Legs', perWeek: 6, note: 'جلسات أقصر، كل عضلة مرتين',
    order: ['pushA', 'pullA', 'legsA', 'pushB', 'pullB', 'legsB'],
    days: {
      pushA: { name: 'Push A', items: P([
        ['pp_fbb', 'ex1', 4, '5-8'], ['pp_ohpA', 'ex21', 3, '6-8'], ['pp_idp', 'ex2', 3, '8-12'], ['pp_a5a', 'ex27', 4, '12-20'],
        ['pp_a5b', 'exOCT', 3, '10-12'], ['pp_a5c', 'ex36', 3, '10-12']]) },
      pullA: { name: 'Pull A', items: P([
        ['pp_pu', 'exWPU', 4, '6-8'], ['pp_bbr', 'ex13', 4, '6-8'], ['pp_tbar', 'exCSTB', 3, '8-10'], ['pp_rpdc', 'exRPD', 4, '12-15'],
        ['pp_c6a', 'ex34b', 3, '8-10'], ['pp_c6b', 'ex31', 3, '8-12']]) },
      legsA: { name: 'Legs A', items: P([
        ['pp_sq', 'ex41', 4, '5-8'], ['pp_lpr', 'ex43', 3, '8-12'], ['pp_rdl', 'ex47', 3, '6-8'], ['pp_slc', 'ex48', 3, '10-12'],
        ['pp_e5a', 'ex51', 4, '10-15'], ['pp_e7a', 'ex65', 3, '12-15']]) },
      pushB: { name: 'Push B', items: P([
        ['pp_fdp', 'exFDP', 4, '8-12'], ['pp_dbsp', 'ex22', 3, '8-10'], ['pp_mdp', 'exMDP', 3, '8-12'], ['pp_b5a', 'ex27', 4, '12-20'],
        ['pp_b5b', 'ex4', 3, '12-15'], ['pp_b5c', 'ex38', 3, '8-10']]) },
      pullB: { name: 'Pull B', items: P([
        ['pp_dl', 'ex11', 3, '3-5'], ['pp_lpd', 'ex14', 3, '9-12'], ['pp_scr', 'ex15', 3, '8-10'], ['pp_fp', 'ex24', 4, '12-15'],
        ['pp_d6a', 'ex30', 3, '10-12'], ['pp_d6b', 'ex33', 3, '12-15']]) },
      legsB: { name: 'Legs B', items: P([
        ['pp_hack', 'ex45b', 4, '8-12'], ['pp_bss', 'ex42', 3, '8-10'], ['pp_llc', 'ex45', 3, '10-12'], ['pp_ht', 'ex46', 3, '8-10'],
        ['pp_f5a', 'ex52', 4, '12-20'], ['pp_f7a', 'ex62', 3, '12-15']]) },
    },
  },
};

PROGRAMS.fb3 = {
  id: 'fb3', name: 'Full Body', perWeek: 3, note: 'الجسم كله كل جلسة · 3 أيام',
  order: ['fbA', 'fbB', 'fbC'],
  days: {
    fbA: { name: 'Full Body A', items: P([
      ['fb_sq', 'ex41', 3, '8-10'], ['fb_bp', 'ex1', 3, '8-10'], ['fb_dl', 'ex47', 3, '10-12'], ['fb_ohp', 'ex21', 3, '10-12'],
      ['fb_lat', 'ex14', 3, '10-12'], ['fb_calf', 'ex51', 3, '15-20']]) },
    fbB: { name: 'Full Body B', items: P([
      ['fb_rdl', 'ex11', 3, '6-8'], ['fb_ibp', 'ex2', 3, '10-12'], ['fb_lp', 'ex43', 3, '10-12'], ['fb_row', 'ex13', 3, '8-10'],
      ['fb_lat2', 'ex23', 3, '12-15'], ['fb_ab', 'ex62', 3, '15-20']]) },
    fbC: { name: 'Full Body C', items: P([
      ['fb_bss', 'ex42', 3, '8-10/رجل'], ['fb_pul', 'ex12', 3, '6-10'], ['fb_ht', 'ex46', 3, '10-12'], ['fb_dbsp', 'ex22', 3, '10-12'],
      ['fb_tri', 'ex36', 3, '12-15'], ['fb_cur', 'ex29', 3, '10-12'], ['fb_plk', 'ex61', 3, '45-60s']]) },
  },
};

/**
 * «أعلى/أسفل · 4 أيام»: the owner-approved compact plan (review.md §3.2–3.5, M1–M3 + S1). Lifting ≈ 46–48 min,
 * then 10–12 min Zone 2 on the bike (≤ 60 min visit). From v3: Sat UA · Sun LA · Mon rest · Tue UB · Wed LB · Thu Boxing Day
 * (replaces the Saturday Heart Day, boxing.js) · Fri rest. v1–v2 ran Mon UA · Tue LA · Thu UB · Fri LB · Sat Heart Day.
 * Legacy item ids are kept where the exercise is the same, so session history lines up.
 */
export const PULLUP_NOTE = 'لما تعمل 3×8 عقلة بوزن جسمك عند RIR 2 ارجع للعقلة';
PROGRAMS.ul4c = {
  id: 'ul4c', name: 'أعلى/أسفل', version: 3, perWeek: 4, note: 'كل عضلة مرتين · سوبر سِت · رفع ~48 د + Zone 2 · أقل من 60 دقيقة · الخميس ملاكمة',
  order: ['upperA', 'lowerA', 'upperB', 'lowerB'],
  schedule: { 6: 'upperA', 0: 'lowerA', 2: 'upperB', 3: 'lowerB' }, heartDow: HEART_DOW.ul4c, z2: true, meso: true,
  trainingDays: UL4C_TRAINING_DAYS, boxing: true,
  // boxing loads the side delts: −1 set on these lateral-raise slots (−2 weekly sets, logic.js boxingAdjust)
  boxDeltCut: ['laLR', 'lbLR'],
  days: {
    upperA: { name: 'Upper A', warm: [[0, 8], [60, 5], [80, 2]], warmNote: 'دقيقة تسخين عام + مجموعات البنش التمهيدية + سحب أمامي خفيف ×8',
      items: P([
        ['uaFB', 'ex1', 4, '5-8', 'A', 110, '1-2', false, { r1: '6-10', note: 'سيفتي البار في كل جلسة' }], ['uaLPD', 'ex14', 4, '6-10', 'A', 110, '1-2', false, { note: PULLUP_NOTE }],
        ['uaID', 'ex2', 3, '8-12', 'B', 90, '1-2'], ['uaTBR', 'exCSTB', 3, '8-12', 'B', 90, '1-2'],
        ['ua5a', 'ex27', 3, '12-20', 'C', 45, '0-1'], ['ua6a', 'exOCT', 3, '10-15', 'C', 45, '0-1'],
        ['ua6b', 'ex31', 3, '10-15', 'D', 60, '0-1'], ['ua5b', 'exRPD', 3, '12-20', 'D', 60, '0-1'], ['uaAW', 'ex64', 3, '8-15', 'D', 60, '1-2']]) },
    lowerA: { name: 'Lower A', warm: [[0, 8], [50, 5], [70, 3], [85, 1]], warmNote: 'دقيقة تسخين عام + مجموعات السكوات التمهيدية',
      items: P([
        ['la1', 'ex41', 4, '5-8', 'A', 110, '1-2', false, { r1: '6-10' }], ['laLR', 'ex23', 4, '12-20', 'A', 110, '0-1'],
        ['la7b', 'ex48', 4, '8-12', 'B', 60, '0-1'], ['la7a', 'ex44', 4, '10-15', 'B', 60, '0-1'],
        ['la3', 'exMHT', 3, '8-12', 'C', 75, '1-2'], ['la6a', 'ex65', 3, '10-15', 'C', 75, '1-2'],
        ['la5a', 'ex51', 5, '8-15', 'D', 60, '0-1'], ['laWC', 'ex81', 3, '15-20', 'D', 60, '0-1', true], ['laRWC', 'exRWC', 2, '15-20', 'D', 60, '0-1', true]]) },
    upperB: { name: 'Upper B', warm: [[50, 8], [75, 4]], warmNote: 'دقيقة تسخين عام + مجموعات تمهيدية للدمبل والسحب',
      items: P([
        ['ubLID', 'exLID', 4, '6-10', 'A', 90, '1-2', false, { note: 'نفس البنش، زاوية 15° بس (أول ثقب أو اتنين)' }], ['ua4', 'ex14', 4, '8-12', 'A', 90, '1-2'],
        ['ubSP', 'ex22', 3, '8-12', 'B', 75, '1-2'], ['ubCR', 'ex15', 3, '8-12', 'B', 75, '1-2'],
        ['ub5a', 'ex27', 3, '12-20', 'C', 45, '0-1'], ['ub5b', 'ex24', 3, '12-20', 'C', 45, '0-1'], ['ubWC', 'exWCH', 3, '10-12/جنب', 'C', 45, '1-2'],
        ['ubPRC', 'ex32', 3, '10-15', 'D', 45, '0-1', false, { note: 'جهاز أو بار EZ على المسند · ركّز على النص اللي تحت' }],
        ['ubOCT', 'exROE', 3, '10-15', 'D', 45, '0-1', false, { note: 'لو كوعك وجعك تاني يوم ارجع لترايسبس بالحبل (pushdown)' }]]) },
    lowerB: { name: 'Lower B', warm: [[0, 8], [50, 5], [75, 3]], warmNote: 'دقيقة تسخين عام + مجموعات الروماني التمهيدية',
      items: P([
        ['la2', 'ex47', 3, '6-10', 'A', 120, '1-2'], ['lbLR', 'ex27', 3, '12-20', 'A', 120, '0-1'],
        ['lbHACK', 'ex45b', 3, '8-12', 'B', 90, '1-2'], ['lbSLC', 'ex48', 3, '10-15', 'B', 90, '0-1', false, { note: 'مِيل بجسمك لقدّام علشان الشدّ على الخلفية' }],
        ['lb2', 'ex42', 3, '8-12/رجل', 'C', 75, '1-2'], ['lb7a', 'ex62', 3, '10-15', 'C', 75, '1-2'],
        ['lbSC', 'ex51', 5, '10-20', 'D', 60, '0-1', false, { note: 'ركبة مفرودة: سميث على سلّمة أو جهاز واقف أو سمانة على دفع الرجل · وقفة 2 ث تحت' }], ['lbADD', 'exADD', 3, '12-20', 'D', 60, '0-1', true], ['lbSH', 'ex72', 2, '10-15', 'D', 60, '0-1', true]]) },
  },
};
PROGRAMS.ul4.name = 'Upper / Lower (القديمة)';

/**
 * Template updates for users already on a template (programs.current.tv < template version). Each change names the plan
 * item it replaces (`from`, by item id) and the new template item (`to`); `set` patches fields of an item in place.
 * A change whose `from` item is gone (the user edited the day) is skipped. Shown as the «تحديث الخطة» card (plan.js).
 */
export const PLAN_UPDATES = Object.freeze({
  ul4c: {
    2: {
      title: 'تمارين أحسن لنفس العضلات · نفس الوقت',
      changes: [
        { day: 'lowerB', from: 'lb5a', to: 'lbSC', why: 'الواقف بيكبّر السمانة، الجالس تقريبًا لأ (Kinoshita 2023)' },
        { day: 'lowerB', from: 'la4', to: 'lbSLC', why: 'الجالس ضعف نمو الخلفية الطويلة (Maeo 2021)' },
        { day: 'upperA', from: 'ub1', to: 'uaLPD', why: 'تحميل أدق لحد ما تعمل 3×8 عقلة بوزن جسمك' },
        { day: 'upperB', from: 'ubBAY', to: 'ubPRC', why: 'بيغطي الجزء السفلي للباي (Kassiano 2025)' },
        { day: 'upperB', from: 'ub6b', to: 'ubOCT', why: 'فوق الراس بيكبّر التراي كله أكتر (Maeo 2023)' },
        { day: 'upperB', from: 'ub3', to: 'ubLID', why: 'صدر علوي أكتر، والبنش المسطّح موجود في Upper A' },
        { day: 'upperA', id: 'uaFB', set: { r1: '6-10' }, why: 'أول 6 أسابيع: 6–10 عدّات للتكنيك، بعدها 5–8' },
        { day: 'lowerA', id: 'la1', set: { r1: '6-10' }, why: 'أول 6 أسابيع: 6–10 عدّات للتكنيك، بعدها 5–8' },
      ],
      warmNote: { upperA: true },
    },
    3: {
      title: 'الخميس يوم الملاكمة بدل يوم القلب · جدول جديد',
      changes: [],
      // weekday → day; applied only when his schedule is still the old one (he never moved a day himself)
      schedule: { from: { 1: 'upperA', 2: 'lowerA', 4: 'upperB', 5: 'lowerB' }, to: { 6: 'upperA', 0: 'lowerA', 2: 'upperB', 3: 'lowerB' },
        trainingDays: { from: UL4C_LEGACY_TRAINING_DAYS, to: UL4C_TRAINING_DAYS },
        why: 'الملاكمة بعد يوم رجل بـ 24 ساعة، ويوم راحة قبل Upper A' },
      boxing: { why: 'جولات شوال + تكنيك 35 د، ومعاها بلوك الضغط الثابت وقاع الحوض زي يوم القلب' },
    },
  },
});

/** New installs start on the compact plan; existing users switch only after the overview confirm card. */
export const DEFAULT_PROGRAM = 'ul4c';
export const NEW_PROGRAM = 'ul4c';

/** Custom exercises (kv.training.customExercises) join the library at runtime: [{id:'cx…', ar, en, muscle, kind, eq}]. */
export function registerCustom(list) {
  for (const c of Array.isArray(list) ? list : []) {
    if (!c || !c.id || !c.ar || BY_ID.has(c.id)) continue;
    const e = { id: String(c.id).slice(0, 40), ar: String(c.ar).slice(0, 60), en: String(c.en || c.ar).slice(0, 60), muscle: String(c.muscle || 'صدر').slice(0, 20),
      kind: c.kind === 'compound' ? 'compound' : 'isolation', eq: String(c.eq || 'مخصّص').slice(0, 20), custom: true };
    LIBRARY.push(e); BY_ID.set(e.id, e); if (!BY_EN.has(e.en.toLowerCase())) BY_EN.set(e.en.toLowerCase(), e);
  }
}
export const MUSCLES = Object.freeze(['صدر', 'ظهر', 'كتف', 'كتف خلفي', 'باي', 'تراي', 'ساعد', 'ترابيس', 'رجل', 'رجل خلفي', 'مؤخرة', 'ضامة', 'سمانة', 'بطن', 'رقبة']);

/**
 * Per-muscle weekly hard-set landmarks (hypertrophy.md §3, RP-style starting values [opinion] bounded by the 10–20 evidence).
 * mav = top of the MAV band (above it → 'high'); mavLo = bottom (the weekly target the balance engine aims at).
 * Obliques (جوانب) have no row in §3: 0 / 4–8 / 16 [opinion].
 */
export const MUSCLE_LM = Object.freeze({
  'صدر': { mev: 8, mavLo: 12, mav: 18, mrv: 22 },
  'لات': { mev: 8, mavLo: 10, mav: 16, mrv: 22 },
  'ظهر علوي': { mev: 8, mavLo: 12, mav: 18, mrv: 25 },
  'كتف أمامي': { mev: 0, mavLo: 6, mav: 10, mrv: 14 },
  'كتف جانبي': { mev: 8, mavLo: 14, mav: 20, mrv: 26 },
  'كتف خلفي': { mev: 6, mavLo: 10, mav: 16, mrv: 22 },
  'باي': { mev: 6, mavLo: 12, mav: 18, mrv: 22 },
  'تراي': { mev: 6, mavLo: 10, mav: 16, mrv: 20 },
  'ساعد': { mev: 2, mavLo: 6, mav: 10, mrv: 16 },
  'كوادز': { mev: 8, mavLo: 12, mav: 18, mrv: 20 },
  'هامسترينج': { mev: 6, mavLo: 10, mav: 16, mrv: 20 },
  'مؤخرة': { mev: 4, mavLo: 10, mav: 14, mrv: 20 },
  'ضامة': { mev: 0, mavLo: 6, mav: 10, mrv: 16 },
  'سمانة': { mev: 8, mavLo: 10, mav: 16, mrv: 20 },
  'بطن': { mev: 4, mavLo: 8, mav: 14, mrv: 20 },
  'جوانب': { mev: 0, mavLo: 4, mav: 8, mrv: 16 },
});
export const FINE_MUSCLES = Object.freeze(Object.keys(MUSCLE_LM));
const LOWER_FINE = new Set(['كوادز', 'هامسترينج', 'مؤخرة', 'ضامة', 'سمانة']);
export const isLowerMuscle = (m) => LOWER_FINE.has(m);

const COARSE_FINE = { 'صدر': 'صدر', 'ظهر': 'ظهر علوي', 'لات': 'لات', 'ترابيس': 'ظهر علوي', 'كتف': 'كتف جانبي', 'أكتاف': 'كتف جانبي', 'كتف خلفي': 'كتف خلفي',
  'كتف أمامي': 'كتف أمامي', 'كتف جانبي': 'كتف جانبي', 'باي': 'باي', 'تراي': 'تراي', 'ساعد': 'ساعد', 'رجل': 'كوادز', 'كوادز': 'كوادز', 'رجلين': 'كوادز',
  'رجل خلفي': 'هامسترينج', 'هامسترينج': 'هامسترينج', 'مؤخرة': 'مؤخرة', 'ضامة': 'ضامة', 'سمانة': 'سمانة', 'بطن': 'بطن', 'كور': 'بطن', 'جوانب': 'جوانب', 'ظهر علوي': 'ظهر علوي' };
/** {prime, synergists} for an exercise-like object (library entry first, then its coarse muscle label). */
export function fineOf(ex) {
  const L = ex && ((ex.lib && BY_ID.get(ex.lib)) || findLib(ex.en || ex.name || ex.ar));
  if (L && L.prime) return { prime: L.prime, synergists: L.synergists || [] };
  const m = String((ex && ex.muscle) || (L && L.muscle) || '').trim();
  let prime = COARSE_FINE[m] || null;
  if (prime === 'كتف جانبي' && ((ex && ex.kind) || (L && L.kind)) === 'compound') prime = 'كتف أمامي';
  return { prime, synergists: [] };
}

/** Weekly hard-set landmarks per muscle group (Solo Gym VOL_LM, RP-style MEV/MAV/MRV). */
export const VOL_LM = {
  'صدر': { mev: 8, mav: 12, mrv: 20 },
  'ظهر': { mev: 10, mav: 15, mrv: 25 },
  'أكتاف': { mev: 8, mav: 14, mrv: 22 },
  'رجلين': { mev: 8, mav: 16, mrv: 24 },
  'باي': { mev: 6, mav: 12, mrv: 20 },
  'تراي': { mev: 6, mav: 12, mrv: 18 },
  'بطن': { mev: 6, mav: 12, mrv: 25 },
};

/** Detailed muscle label → landmark group (null = not tracked). */
export function muscleGroup(label) {
  const m = String(label || '').trim();
  if (!m) return null;
  if (m.startsWith('صدر')) return 'صدر';
  if (m.startsWith('ظهر') || m === 'ترابيس' || m === 'لات') return 'ظهر';
  if (m.startsWith('كتف') || m === 'أكتاف') return 'أكتاف';
  if (m.startsWith('رجل') || m === 'مؤخرة' || m === 'سمانة' || m === 'رجلين' || m === 'كوادز' || m === 'هامسترينج' || m === 'ضامة') return 'رجلين';
  if (m.startsWith('باي') || m === 'ثنائي') return 'باي';
  if (m.startsWith('تراي') || m === 'ثلاثي') return 'تراي';
  if (m.startsWith('بطن') || m === 'كور' || m === 'جوانب') return 'بطن';
  return null;
}

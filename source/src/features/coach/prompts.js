// Coach copy, quick prompts (all 10 from Solo Gym + NutriPro), intents → context blocks + model. Pure.
import { MODELS } from '../../core/ai.js';

export const ALL_BLOCKS = ['body', 'today', 'readiness', 'training', 'strength', 'volume', 'program', 'boxing', 'injuries', 'goals', 'nutrition', 'weight', 'patterns', 'attached'];

/**
 * intent → {blocks, model, maxTokens, writes, protocol}
 * model: 'quick' (Haiku: logging, short questions) | 'coach' (Sonnet: plans, analysis). protocol: which action list is sent
 * ('food' = the short food/water/targets list, 'full' = + training plan). max_tokens are caps, not targets: replies are short.
 */
export const INTENTS = Object.freeze({
  chat: { blocks: ['body', 'today', 'readiness', 'training', 'boxing', 'nutrition', 'injuries', 'attached'], model: 'coach', maxTokens: 900, writes: true, protocol: 'full' },
  quick: { blocks: ['body', 'today', 'readiness', 'injuries', 'attached'], model: 'quick', maxTokens: 500, writes: true, protocol: 'food' },
  food_log: { blocks: ['today', 'attached'], model: 'quick', maxTokens: 1400, writes: true, protocol: 'food' },
  training: { blocks: ['body', 'today', 'readiness', 'training', 'strength', 'volume', 'program', 'boxing', 'injuries', 'goals', 'attached'], model: 'coach', maxTokens: 1100, writes: true, protocol: 'full' },
  // plan edits from the chat chips: program + performance, proposals allowed (always behind a confirm card)
  plan_edit: { blocks: ['body', 'today', 'readiness', 'training', 'strength', 'volume', 'program', 'injuries', 'attached'], model: 'coach', maxTokens: 1600, writes: true, protocol: 'full' },
  nutrition: { blocks: ['body', 'today', 'readiness', 'nutrition', 'weight', 'patterns', 'attached'], model: 'coach', maxTokens: 900, writes: true, protocol: 'food' },
  advice: { blocks: ['body', 'today', 'readiness', 'training', 'strength', 'nutrition', 'weight', 'injuries'], model: 'quick', maxTokens: 400, writes: false },
  weekly: { blocks: ALL_BLOCKS, model: 'coach', maxTokens: 1200, writes: false },
  full: { blocks: ALL_BLOCKS, model: 'coach', maxTokens: 1500, writes: false },
  patterns: { blocks: ['body', 'training', 'nutrition', 'patterns', 'weight'], model: 'coach', maxTokens: 1000, writes: false },
  session: { blocks: ['body', 'readiness', 'strength', 'training', 'injuries', 'attached'], model: 'coach', maxTokens: 900, writes: false },
  plan: { blocks: ['body', 'training', 'strength', 'volume', 'program', 'injuries', 'goals', 'attached'], model: 'coach', maxTokens: 1600, writes: false },
  form: { blocks: ['body', 'boxing', 'injuries', 'attached'], model: 'coach', maxTokens: 800, writes: false },
  food: { blocks: ['today', 'attached'], model: 'quick', maxTokens: 600, writes: true, protocol: 'food' },
  food_lookup: { blocks: ['attached'], model: 'quick', maxTokens: 600, writes: false },
  set_tip: { blocks: ['strength', 'attached'], model: 'quick', maxTokens: 300, writes: false },
});
/** Unknown intents (from other packages) get the full context but never write. */
export const intentOf = (k) => INTENTS[k] || { ...INTENTS.chat, blocks: ALL_BLOCKS, writes: false };
export const modelFor = (k) => MODELS[intentOf(k).model] || MODELS.coach;

const norm = (t) => String(t || '').toLowerCase().replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/[\u064B-\u0652]/g, '');
/** «I ate / log this»: a past-tense eating verb or a log command, with a food-ish quantity or meal word. */
export const FOOD_LOG_RE = /(^|\s)(اكلت|كلت|فطرت|اتغديت|تغديت|اتعشيت|تعشيت|شربت|سجل(لي|ي)?|ضيف(لي)?|ضف|احسبلي|سجلي)(\s|$)/;
const PLAN_RE = /حلل|تحليل|خطه|خطة|برنامج|جدول|اسبوع|أسبوع|تقييم|قيم|راجع|ديلود|deload|plateau|ثبات|عدل|غير|اقترح|نظام|تقدم|مقارنه|ليه|ازاي اكسر|periodiz/;
const FOOD_RE = /غدا|عشا|فطار|اكل|بروتين|كارب|دهون|سعر|وجبه|ماكرو|مي[هة]|سجل|ضيف|رجيم|دايت|صايم|صيام/;
const BOX_RE = /ملاكم|بوكس|boxing|كومبو|combo|جاب|كروس|هوك|ابركت|أبركت|سليب|رول|شوال|شادو|جوانتي|رباط|بيفوت|كاونتر/;
const GYM_RE = /ملاكم|بوكس|كومبو|شوال|تمرين|اتمرن|جلسه|عضله|بنش|سكوات|ديدليفت|ثبات|plateau|تعب|fatigue|deload|ديلود|برنامج|خطه التمرين|مجموعات|سيت|كارديو|وجع|بيوجع/;

/**
 * Free-text chat → intent. Logging → food_log (Haiku); planning / analysis → Sonnet with the right domain;
 * short simple questions → quick (Haiku, small context). The question always decides, never the data.
 */
export function detectIntent(text) {
  const t = norm(text);
  if (FOOD_LOG_RE.test(t) && /\d|[٠-٩]|جرام|جم|كيلو|حبه|بيض|رغيف|طبق|كوب|معلق|سكوب|نص|ربع|ميه|ميتين|غدا|عشا|فطار/.test(t)) return 'food_log';
  const food = FOOD_RE.test(t); const gym = GYM_RE.test(t);
  const plan = PLAN_RE.test(t);
  if (!plan && t.length <= 90 && !t.includes('\n')) return 'quick';
  if (food && !gym) return 'nutrition';
  if (gym && !food) return 'training';
  return 'chat';
}

/** Context blocks for a free-text message: quick questions get the domain they touch, nothing more. */
export function blocksFor(intent, text) {
  const spec = intentOf(intent);
  if (intent !== 'quick') return spec.blocks;
  const t = norm(text); const extra = [];
  if (GYM_RE.test(t)) extra.push('training', 'strength', 'program');
  if (BOX_RE.test(t)) extra.push('boxing');
  if (FOOD_RE.test(t)) extra.push('nutrition');
  return [...new Set([...spec.blocks, ...extra])];
}

/** The ten quick prompts of the old apps, calm wording, no emoji. */
export const QUICK = Object.freeze({
  training: [
    { label: 'حلّل أدائي الأسبوعي', prompt: 'حلّل أدائي في التمرين الأسبوع ده: الحجم، الأرقام القياسية، والعضلات اللي محتاجة شغل.', intent: 'training' },
    { label: 'التعب ومرحلة التدريب', prompt: 'إيه حالة حمل التدريب والتعب عندي دلوقتي؟ محتاج ديلود ولا أكمّل؟', intent: 'training' },
    { label: 'أكسر الثبات', prompt: 'فيه تمارين واقفة عندي؟ إزاي أكسر الثبات في الأوزان؟', intent: 'training' },
    { label: 'أكل قبل التمرين', prompt: 'اقترح أكل قبل التمرين النهارده يناسب الباقي من هدفي.', intent: 'nutrition' },
    { label: 'جهّزلي أوزان الحصة الجاية', prompt: 'جهّزلي أوزان الحصة الجاية لكل تمرين حسب آخر أداء ليا (double progression)، واقترحها للتطبيق.', intent: 'plan_edit' },
    { label: 'عدّل خطتي حسب أدائي', prompt: 'راجع خطتي حسب أدائي الأخير والحجم لكل عضلة، واقترح تعديلات صغيرة لو محتاجة (تبديل، مجموعات، إضافة أو شيل تمرين).', intent: 'plan_edit' },
    { label: 'عضلة متأخرة؟ زوّدها', prompt: 'فيه عضلة متأخرة عندي؟ لو آه اقترح إزاي أزوّد حجمها من غير ما أعدّي الحد الأقصى ولا الـ 60 دقيقة.', intent: 'plan_edit' },
    { label: 'أعمل ديلود؟', prompt: 'محتاج أعمل ديلود دلوقتي ولا بعدين؟ لو آه اقترح إمتى.', intent: 'plan_edit' },
  ],
  nutrition: [
    { label: 'تقييم اليوم', prompt: 'قيّم أكلي النهارده وقولّي رأيك باختصار.', intent: 'nutrition' },
    { label: 'كمّل البروتين وسجّله', prompt: 'اقترح وجبة تكمّل البروتين الباقي النهارده وجهّزها للتسجيل.', intent: 'nutrition' },
    { label: 'ضيف أكلة لأكلاتي', prompt: 'إيه القيم الغذائية لشوفان بالموز لكل 100 جرام؟ وجهّزه أضيفه لأكلاتي.', intent: 'nutrition' },
    { label: 'تقدّمي', prompt: 'إيه تقدّمي الأسبوع ده في الأكل والوزن والتمرين؟', intent: 'weekly' },
    { label: 'خطة يوم تمرين', prompt: 'اعملّي خطة أكل كاملة ليوم تمرين على أهدافي وجهّزها للتسجيل.', intent: 'nutrition' },
    { label: 'أنا فين؟', prompt: 'أنا أكلت إيه النهارده وفاضل كام على الهدف؟', intent: 'nutrition' },
  ],
});

export const PROMPTS = Object.freeze({
  advice: 'اكتب نصيحة النهارده في 3 سطور بالكتير: حاجة واحدة للتمرين، حاجة واحدة للأكل، وحاجة واحدة للتعافي. خليها مبنية على الأرقام.',
  weekly: 'اكتب تقرير أسبوعي: إيه اللي اشتغل كويس، إيه اللي محتاج يتغيّر، وتركيز واحد للأسبوع الجاي (سطر يبدأ بـ «تركيز الأسبوع:»). من غير لوم.',
  full: 'اعمل تحليل شامل من 5 لـ 8 نقاط على كل البيانات: القوة، الحجم، التعافي، الأكل، الوزن. كل نقطة سطر واحد فيه رقم وتوصية.',
  patterns: 'دوّر على أنماط في أيام وأوقات التمرين، الحجم، وأوقات الأكل (أكل بالليل، فطار متساب، أيام زيادة). اكتب 3 لـ 5 أنماط مع اقتراح لكل واحد.',
  session: 'حلّل الجلسة المرفقة: مقارنة بالمرة اللي فاتت، إيه اللي اتحسّن، وإيه الأوزان المقترحة للمرة الجاية.',
});

export const SYSTEM = [
  'You are a personal strength and nutrition coach inside a private fitness app. The user is Egyptian.',
  'ANSWER THE USER\'S LATEST MESSAGE FIRST: the first sentence directly answers exactly what he asked (yes/no, the number, the advice). Then at most a few short lines of why/how. Do not review unrelated data, do not start with a summary of his day, do not change the subject.',
  'Reply in Egyptian Arabic (عامية مصرية), short, practical and calm: usually 2–6 short lines, longer only when he asks for a plan or analysis. Use Latin digits; no emoji; no gamification words (XP, levels, ranks).',
  'The data summary is background: use only the parts that matter for this question; if the question is general (not about his data), just answer it from your knowledge. Say when needed data is missing. Label projections as «تقدير».',
  'If the message is unclear, answer the most likely meaning and ask one short clarifying question at the end.',
  'No medical diagnosis; for pain, advise seeing a professional. Never ask for or mention personal identifiers.',
].join(' ');

const FOOD_ACTIONS = [
  'Actions: when a change is wanted, write your normal short reply, then one line per proposal, exactly [[ACTION:{json}]] on ONE line: valid JSON, Latin digits, plain numbers (no units inside numbers), no code fences, never show JSON any other way.',
  'YOU CANNOT WRITE ANYTHING. The app applies or confirms the action and shows its own «اتسجل» line only after it really saved it. So NEVER say or imply it is done: no «سجلت», «سجلتلك», «اتسجل», «ضفت», «تم التسجيل», no ✅. Say what you understood instead («فهمت: …»).',
  'FOOD LOGGING (required): whenever the user says he ate or drank something («اكلت 150 جم كبدة و290 جم مكرونة», «فطرت 3 بيض ورغيف», «شربت بروتين شيك») or asks to log/add food, ALWAYS put ONE food.log action listing EVERY item he said as the FIRST line of your reply (before any text, so it is never cut off), even when he also asks something else:',
  '[[ACTION:{"type":"food.log","day":"today","meal":"lunch","items":[{"name":"كبدة","grams":150,"meal":"lunch","kcal":250,"p":36,"c":4,"f":9},{"name":"بيض","qty":3,"unit":"حبة","meal":"breakfast","kcal":210,"p":18,"c":1,"f":15}]}]]',
  'food.log rules: name = short Arabic food name as he said it (cooked state if known); grams when he gave a weight, else qty + unit (حبة/رغيف/كوب/معلقة/سكوب/طبق); meal = breakfast|lunch|dinner|snack from his words, else from the current time; day = "today", "yesterday" or YYYY-MM-DD when he named a day; kcal/p/c/f = your best estimate for that exact portion (numbers). If an amount is missing, estimate a normal portion as qty 1 + unit. After the action line: one short line «فهمت: <items> · ~<kcal> سعرة · <protein> بروتين (تقدير)», never a claim that it was logged.',
  '[[ACTION:{"type":"adddb","food":{"name":"<Arabic>","per":100,"unit":"جم","kcal":0,"p":0,"c":0,"f":0,"fiber":0}}]]  add a food to his foods list (only when asked)',
  '[[ACTION:{"type":"targets.set","dayType":"training|rest|heart","kcal":2500,"p":170,"c":280,"f":70,"reason":"<Arabic>"}]]  (kcal must ≈ 4P+4C+9F)',
  '[[ACTION:{"type":"delete","entryId":"<id from Today entries>"}]]',
  '[[ACTION:{"type":"water","ml":500}]]',
].join('\n');

const TRAINING_ACTIONS = [
  'Training plan (day = day id from Program; exId = item id from Program, e.g. "uaFB"; library ids like "ex2" only for toExId/addExercise):',
  '[[ACTION:{"type":"workout.prefill","day":"lowerA","items":[{"exId":"la1","sets":[{"w":100,"r":6},{"w":100,"r":6}],"note":"<Arabic, short>"}],"reason":"<Arabic>"}]]  next-session weights, one entry per set',
  '[[ACTION:{"type":"workout.swap","day":"upperA","fromExId":"uaID","toExId":"exFDP","reason":"<Arabic>"}]]  same primary muscle; keeps sets/reps/rest/superset',
  '[[ACTION:{"type":"workout.sets","day":"upperA","exId":"ua5a","sets":4,"reps":"12-20","reason":"<Arabic>"}]]',
  '[[ACTION:{"type":"workout.addExercise","day":"upperB","exId":"ex30","sets":2,"reps":"10-15","pairWith":"ub6b","reason":"<Arabic>"}]]',
  '[[ACTION:{"type":"workout.removeExercise","day":"lowerB","exId":"lbSH","reason":"<Arabic>"}]]',
  '[[ACTION:{"type":"workout.deload","now":true,"reason":"<Arabic>"}]]  or "startWeek":1 (weeks from now) — 7 days, half the sets, ~10% lighter',
  'Plan rules: every lift day stays ≤ 60 min including ~10 min Zone 2 after lifting (keep lifting ≈ 46–50 min). Weekly hard sets per muscle: evidence-based 10–20 for major muscles; never above the muscle\'s MRV, avoid dropping below MEV (both listed under Program). Reps 3–30, sets 1–10 per exercise. Prefer small changes (±1–2 sets, one swap) and progress by reps/load first.',
  'Supersets: never pair two axially loaded lifts (squat, deadlift, RDL, barbell row, standing press, hack/leg press) or two grip-limited lifts (deadlift, rows, pull-ups, shrugs, farmer walk, wrist curls); max 3 per group; seated leg curl + leg extension may be one combo machine.',
  'Prefill: base it on the last sets of that day (Next session block): all sets hit the top of the rep range → add the smallest step (2.5 kg, 1 kg under 20 kg); otherwise same weight and aim for +1 rep. Respect readiness and injuries; never prescribe to failure on heavy compounds.',
  'Deload: suggest it after ~6 weeks of hard training, ≥ 2 stalled compound lifts, very low RIR for 2 weeks, or poor readiness; in the 6-week block week 6 is already a deload.',
  'Never change the Heart Day, isometrics (wall sit) or their blood-pressure gate, and never give medical advice; for pain or injury suggest a professional and a lighter swap.',
  'Boxing Day (Boxing block): he trains alone on a heavy bag with gloves + wraps, no coach. For technique questions answer from that week\'s cues/mistakes in Egyptian Arabic (max 3 bullets), name the matching video in the app (يوم الملاكمة › ▶ فيديو الأداء), suggest filming a round for self-review; never change the boxing day, its technique-only safety rule or the wall sit; wraps every time; stop on chest pain or dizziness. Boxing is cardio, never lifting volume.',
  'Only propose plan changes when he asks for a change or a plan; a plain question gets a plain answer.',
].join('\n');

/** The short food protocol (Haiku intents) and the full one (with training plan actions). */
export const FOOD_PROTOCOL = FOOD_ACTIONS;
export const ACTION_PROTOCOL = `${FOOD_ACTIONS}\n${TRAINING_ACTIONS}`;
export const protocolFor = (spec) => (spec && spec.protocol === 'food' ? FOOD_PROTOCOL : ACTION_PROTOCOL);

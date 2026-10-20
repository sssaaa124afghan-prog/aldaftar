// Coach copy, quick prompts (all 10 from Solo Gym + NutriPro), intents → context blocks + model. Pure.
import { MODELS } from '../../core/ai.js';

export const ALL_BLOCKS = ['body', 'today', 'readiness', 'training', 'strength', 'volume', 'program', 'injuries', 'goals', 'nutrition', 'weight', 'patterns', 'attached'];

/** intent → {blocks, model, maxTokens, writes} — writes: the reply may carry [[ACTION]] proposals. */
export const INTENTS = Object.freeze({
  chat: { blocks: ALL_BLOCKS, model: 'coach', maxTokens: 1200, writes: true },
  training: { blocks: ['body', 'today', 'readiness', 'training', 'strength', 'volume', 'program', 'injuries', 'goals', 'nutrition', 'attached'], model: 'coach', maxTokens: 1500, writes: true },
  // plan edits from the chat chips: program + performance, proposals allowed (always behind a confirm card)
  plan_edit: { blocks: ['body', 'today', 'readiness', 'training', 'strength', 'volume', 'program', 'injuries', 'attached'], model: 'coach', maxTokens: 1600, writes: true },
  nutrition: { blocks: ['body', 'today', 'readiness', 'training', 'nutrition', 'weight', 'patterns', 'attached'], model: 'coach', maxTokens: 1200, writes: true },
  advice: { blocks: ['body', 'today', 'readiness', 'training', 'strength', 'nutrition', 'weight', 'injuries'], model: 'quick', maxTokens: 400, writes: false },
  weekly: { blocks: ALL_BLOCKS, model: 'coach', maxTokens: 1400, writes: false },
  full: { blocks: ALL_BLOCKS, model: 'coach', maxTokens: 1800, writes: false },
  patterns: { blocks: ['body', 'training', 'nutrition', 'patterns', 'weight'], model: 'coach', maxTokens: 1200, writes: false },
  session: { blocks: ['body', 'readiness', 'strength', 'training', 'injuries', 'attached'], model: 'coach', maxTokens: 1000, writes: false },
  plan: { blocks: ['body', 'training', 'strength', 'volume', 'program', 'injuries', 'goals', 'attached'], model: 'coach', maxTokens: 1800, writes: false },
  form: { blocks: ['body', 'injuries', 'attached'], model: 'coach', maxTokens: 900, writes: false },
  food: { blocks: ['today', 'attached'], model: 'quick', maxTokens: 600, writes: true },
  food_lookup: { blocks: ['attached'], model: 'quick', maxTokens: 600, writes: false },
  set_tip: { blocks: ['strength', 'attached'], model: 'quick', maxTokens: 300, writes: false },
});
/** Unknown intents (from other packages) get the full context but never write. */
export const intentOf = (k) => INTENTS[k] || { ...INTENTS.chat, writes: false };
export const modelFor = (k) => MODELS[intentOf(k).model] || MODELS.coach;

/** Free-text chat: pick a narrower block set when the question is clearly one domain (old detectIntent). */
export function detectIntent(text) {
  const t = String(text || '').toLowerCase();
  const food = /غدا|عشا|فطار|أكل|اكل|بروتين|كارب|دهون|سعر|وجبة|ماكرو|مية|سجّل|سجل|ضيف/.test(t);
  const gym = /تمرين|جلسة|عضلة|بنش|سكوات|ديدليفت|ثبات|plateau|تعب|fatigue|deload|ديلود|برنامج|خطة التمرين|مجموعات|سيت/.test(t);
  if (food && !gym) return 'nutrition';
  if (gym && !food) return 'training';
  return 'chat';
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
  'You are a personal strength and nutrition coach inside a private fitness app.',
  'Reply in Egyptian Arabic, short, practical and calm; use Latin digits; no emoji; no gamification words (XP, levels, ranks).',
  'Base every point on the data summary below and say when data is missing. Label projections as «تقدير». No medical diagnosis; for pain, advise seeing a professional.',
  'Never ask for or mention personal identifiers.',
].join(' ');

export const ACTION_PROTOCOL = [
  'When the user asks you to log food, add a food, change targets, delete a logged entry, log water, or change the training plan, write your normal reply and then, at the very end, one line per proposal (several proposals = several lines; each is confirmed separately):',
  '[[ACTION:{"type":"log","section":"breakfast|lunch|dinner|snack","items":[{"name":"<Arabic>","grams":150,"kcal":250,"p":40,"c":0,"f":8}]}]]',
  '[[ACTION:{"type":"adddb","food":{"name":"<Arabic>","per":100,"unit":"جم","kcal":0,"p":0,"c":0,"f":0,"fiber":0}}]]',
  '[[ACTION:{"type":"targets.set","dayType":"training|rest|heart","kcal":2500,"p":170,"c":280,"f":70,"reason":"<Arabic>"}]]  (kcal must ≈ 4P+4C+9F)',
  '[[ACTION:{"type":"delete","entryId":"<id from Today entries>"}]]',
  '[[ACTION:{"type":"water","ml":500}]]',
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
  'The app asks the user to confirm each proposal; never say it is already done.',
].join('\n');

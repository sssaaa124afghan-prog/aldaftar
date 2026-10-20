// Coach copy, quick prompts (all 10 from Solo Gym + NutriPro), intents → context blocks + model. Pure.
import { MODELS } from '../../core/ai.js';

export const ALL_BLOCKS = ['body', 'today', 'readiness', 'training', 'strength', 'volume', 'injuries', 'goals', 'nutrition', 'weight', 'patterns', 'attached'];

/** intent → {blocks, model, maxTokens, writes} — writes: the reply may carry [[ACTION]] proposals. */
export const INTENTS = Object.freeze({
  chat: { blocks: ALL_BLOCKS, model: 'coach', maxTokens: 1200, writes: true },
  training: { blocks: ['body', 'today', 'readiness', 'training', 'strength', 'volume', 'injuries', 'goals', 'nutrition', 'attached'], model: 'coach', maxTokens: 1200, writes: false },
  nutrition: { blocks: ['body', 'today', 'readiness', 'training', 'nutrition', 'weight', 'patterns', 'attached'], model: 'coach', maxTokens: 1200, writes: true },
  advice: { blocks: ['body', 'today', 'readiness', 'training', 'strength', 'nutrition', 'weight', 'injuries'], model: 'quick', maxTokens: 400, writes: false },
  weekly: { blocks: ALL_BLOCKS, model: 'coach', maxTokens: 1400, writes: false },
  full: { blocks: ALL_BLOCKS, model: 'coach', maxTokens: 1800, writes: false },
  patterns: { blocks: ['body', 'training', 'nutrition', 'patterns', 'weight'], model: 'coach', maxTokens: 1200, writes: false },
  session: { blocks: ['body', 'readiness', 'strength', 'training', 'injuries', 'attached'], model: 'coach', maxTokens: 1000, writes: false },
  plan: { blocks: ['body', 'training', 'strength', 'volume', 'injuries', 'goals', 'attached'], model: 'coach', maxTokens: 1800, writes: false },
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
  'When the user asks you to log food, add a food, change targets, delete a logged entry or log water, write your normal reply and then, at the very end, one line per proposal:',
  '[[ACTION:{"type":"log","section":"breakfast|lunch|dinner|snack","items":[{"name":"<Arabic>","grams":150,"kcal":250,"p":40,"c":0,"f":8}]}]]',
  '[[ACTION:{"type":"adddb","food":{"name":"<Arabic>","per":100,"unit":"جم","kcal":0,"p":0,"c":0,"f":0,"fiber":0}}]]',
  '[[ACTION:{"type":"goal","dayType":"training|rest","kcal":2500,"p":170,"c":280,"f":70}]]',
  '[[ACTION:{"type":"delete","entryId":"<id from Today entries>"}]]',
  '[[ACTION:{"type":"water","ml":500}]]',
  'The app asks the user to confirm each proposal; never say it is already done.',
].join('\n');

// Boxing Day (Thursday on the 4-day plan from template v3; replaces the Saturday Heart Day). Pure and node-safe:
// the 12-week curriculum as data, the timed session template (30–40 min), the BP gate, the session record and weekly stats.
// Tested in boxing.test.js; the screen is boxing.js. Health block kept from the Heart Day (plan/cardio-health.md §1:
// isometric wall sit, Edwards 2023; pelvic floor + slow breathing, mens-health §2.3). Solo training: technique comes from
// the curated videos (boxing-videos.js); cues are Egyptian Arabic, 3 bullets max.
import { diffDays, weekStart, dayKey } from '../../core/date.js';
import { bpGate, latestBP } from './bp.js';
import { mesoWeek, blockStart, deloadActive } from './logic.js';

const clampN = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// ══ 12-week mastery curriculum ════════════════════════════════════
/**
 * Each week: phase, title, «كومبو الأسبوع» ({code, ar}), shadow focus, cues (≤ 3, Egyptian Arabic), common mistakes,
 * the defense/footwork drill, and the technique video keys (boxing-videos.js) in watch order.
 * Weeks 6 and 12 fall on the lifting block's deload week (6-week block): technique-only there.
 */
const W = (week, phase, title, combo, shadow, cues, mistakes, drill, videos) => Object.freeze({
  week, phase, title, combo: Object.freeze(combo), shadow, cues: Object.freeze(cues), mistakes: Object.freeze(mistakes), drill: Object.freeze(drill), videos: Object.freeze(videos) });
export const PHASES = Object.freeze({ base: 'الأساسيات', power: 'الضربات القوية', defense: 'الدفاع والكاونتر', master: 'إتقان' });
export const CURRICULUM = Object.freeze([
  W(1, 'base', 'الوقفة والجارد والجاب', { code: '1 · 1-1', ar: 'جاب · جاب جاب' },
    'وقفة وجارد ثابتين، جاب واحد وارجع، وبعدين جاب جاب',
    ['رجلك الشمال قدّام بعرض كتفك، والكعب اللي ورا مرفوع شوية', 'إيدك اليمين لازقة في خدك، والكوع لتحت بيحمي الضلوع', 'الجاب يطلع على خط مستقيم ويرجع لنفس المكان بنفس السرعة'],
    ['الرجلين على خط واحد فتقع بسهولة', 'تنزّل الإيد اللي مش بتضرب', 'ترفع كتفك وتشدّه قبل الضربة'],
    { label: 'ستيب دراج قدّام وورا', sub: 'الرجل اللي في ناحية الحركة تتحرك الأول، والتانية تحصّلها نفس المسافة', video: 'box.stepdrag' },
    ['box.stance', 'box.guard', 'box.jab']),
  W(2, 'base', 'الكروس والـ 1-2', { code: '1-2', ar: 'جاب · كروس' },
    'جاب، كروس، ورجوع للجارد بعد كل ضربة',
    ['الكروس بيبدأ من رجلك اللي ورا: لف الكعب والوسط مع بعض', 'دقنك ورا كتفك، والإيد الشمال ترجع للجارد وإنت بتضرب', 'قف على مسافة دراع مفرود من الشوال، متزقّوش'],
    ['تميل لقدّام بزيادة وتخرج برّه توازنك', 'تضرب بالدراع بس من غير ما تلف وسطك', 'الإيد ترجع واطية بعد الضربة'],
    { label: 'ستيب دراج في 4 اتجاهات + جاب', sub: 'خطوة، جاب، خطوة · متقرّبش الرجلين من بعض', video: 'box.stepdrag' },
    ['box.cross', 'box.c12', 'box.crossFix']),
  W(3, 'base', 'الحركة: ستيب دراج وبيفوت', { code: '1-1-2', ar: 'جاب · جاب · كروس + بيفوت' },
    'جاب جاب كروس، وبعدها بيفوت ربع لفة وطلعة بزاوية',
    ['البيفوت على مشط رجلك اللي قدّام، ولف 45 درجة بعد الكومبو', 'متعدّيش رجل على التانية ومتقرّبهمش من بعض', 'عينك على الهدف، مش على رجلك'],
    ['تنط بدل ما تزحلق رجلك', 'تفضل واقف قدام الشوال بعد الكومبو', 'البيفوت على الكعب'],
    { label: 'تمرين حركة: ستيب دراج + بيفوت', sub: 'خطوتين قدّام، بيفوت، خطوتين جنب · ببطء ونضافة', video: 'box.footDrill' },
    ['box.pivot', 'box.footDrill', 'box.jabFix']),
  W(4, 'power', 'الهوك الأمامي', { code: '1-2-3', ar: 'جاب · كروس · هوك شمال' },
    '1-2-3 بهدوء: الهوك قصير ومن الوسط',
    ['الكوع في مستوى القبضة، والدراع زاوية 90 درجة', 'اللف من رجلك اللي قدّام ووسطك، مش من الدراع', 'إيدك اليمين لازقة في دقنك طول الهوك'],
    ['تفتح الهوك واسع فيبان من بعيد', 'تلف من غير ما تحرّك رجلك اللي قدّام', 'تنزّل الإيد اللي ورا'],
    { label: 'بيفوت بعد الـ 3', sub: '1-2-3 وبعدها بيفوت لبرّه · جارد فوق', video: 'box.pivot' },
    ['box.leadHook', 'box.c123']),
  W(5, 'power', 'الأبركت والهوك الخلفي', { code: '1-2-3-2', ar: 'جاب · كروس · هوك · كروس' },
    'أبركت قصير من الركبة، وبعدين 1-2-3-2',
    ['انزل بركبك شوية والضربة تطلع من رجلك لفوق، مش من الدراع', 'القبضة قريبة من جسمك والمسافة قصيرة', 'الهوك اليمين: لف الكعب اللي ورا زي الكروس بالظبط'],
    ['تنزّل إيدك لتحت قبل الأبركت فتنكشف', 'تميل لورا وإنت بتضرب', 'تضرب أبركت من مسافة بعيدة'],
    { label: 'ستيب دراج + بيفوت بين الكومبوهات', sub: 'كومبو، اطلع بزاوية، كومبو', video: 'box.pivot' },
    ['box.uppercut', 'box.rearHook', 'box.c1232']),
  W(6, 'power', 'مراجعة نضيفة (أسبوع تخفيف)', { code: '1-2 · 1-2-3 · 1-2-3-2', ar: 'مراجعة الكومبوهات' },
    'كل كومبو اتعلمته، بسرعة متوسطة وشكل نضيف',
    ['الأسبوع ده تكنيك بس: سرعة متوسطة وشكل نضيف', 'نفَس قصير من بُقّك مع كل ضربة، متكتمش نفسك', 'كل إيد ترجع للجارد قبل اللي بعدها'],
    ['تستعجل فالشكل يبوظ', 'تكتم نفسك وإنت بتضرب', 'تنسى رجلك وتقف مكانك'],
    { label: 'حركة خفيفة حوالين الشوال', sub: 'ستيب دراج وبيفوت من غير ضرب قوي', video: 'box.footDrill' },
    ['box.shadow', 'box.c1232']),
  W(7, 'defense', 'السليب', { code: '1-2 ← سليب ← 2', ar: 'جاب · كروس · سليب · كروس' },
    'تخيّل جاب جاي عليك: سليب صغير وارد بكروس',
    ['السليب حركة صغيرة: لف وسطك وانزل شوية، راسك تطلع برّه خط الضربة بس', 'عينك على الهدف طول الوقت', 'بعد السليب ارجع بضربة على طول'],
    ['تميل براسك بس من غير وسطك', 'سليب كبير بيبعدك عن الضربة الجاية', 'تقفل عينك'],
    { label: 'سليب يمين وشمال', sub: 'حبل أو خط وهمي في مستوى راسك · سليب وارجع للوقفة', video: 'box.slip' },
    ['box.slip', 'box.counter']),
  W(8, 'defense', 'الرول والبلوك', { code: '1-2-3 ← رول ← 3-2', ar: 'جاب · كروس · هوك · رول · هوك · كروس' },
    'رول تحت هوك وهمي، وبلوك قبل ما ترد',
    ['الرول على شكل حرف U تحت الهوك، بركبك مش بضهرك', 'البلوك: الإيد على جبهتك والكوع لازق، متقابلش الضربة بإيدك', 'بعد الدفاع ضربتين على طول'],
    ['تنحني بضهرك لقدّام', 'تبص في الأرض وإنت بتعمل رول', 'البلوك بعيد عن وشك'],
    { label: 'رول + بلوك', sub: 'رول يمين، رول شمال، بلوك عالي، وارد بـ 3-2', video: 'box.roll' },
    ['box.roll', 'box.block']),
  W(9, 'defense', 'الباري والكاونتر', { code: 'باري ← 2-3-2', ar: 'باري للجاب · كروس · هوك · كروس' },
    'باري للجاب الوهمي، ورد في نفس اللحظة',
    ['الباري حركة صغيرة بإيدك اليمين تبعد الجاب، متمدّش دراعك', 'رد في نفس اللحظة اللي الضربة بتخلص فيها', 'الكاونتر كومبو قصير، وبعده اطلع بزاوية'],
    ['تعمل باري بدري أو بحركة واسعة', 'تفضل واقف مكانك بعد الكاونتر', 'تنسى الجارد وإنت بترد'],
    { label: 'دفاع + كاونتر', sub: 'سليب أو باري أو رول، وبعدها كاونتر من 2–3 ضربات', video: 'box.counterDrill' },
    ['box.parry', 'box.counter', 'box.counterDrill']),
  W(10, 'master', 'كومبوهات أطول', { code: '1-2-3-2 ← سليب ← 3-2', ar: 'جاب · كروس · هوك · كروس · سليب · هوك · كروس' },
    'كومبو طويل بتوازن: كل ضربة بتجهّز اللي بعدها',
    ['التوازن أهم من السرعة: كل ضربة بتجهّز اللي بعدها', 'وزنك في النص، متتقلش على رجل واحدة', 'آخر ضربة بقوة أول ضربة'],
    ['تتمايل لقدّام في آخر الكومبو', 'تضرب الشوال وتستناه يرجعلك', 'تنسى رجلك وإنت بتضرب'],
    { label: 'دفاع + حركة بعد الكومبو', sub: 'كومبو، سليب أو رول، اطلع بزاوية', video: 'box.longCombo' },
    ['box.longCombo', 'box.bagFix']),
  W(11, 'master', 'الزوايا وجولات أقوى', { code: '1-2-3 ← بيفوت ← 2-3-2', ar: 'جاب · كروس · هوك · بيفوت · كروس · هوك · كروس' },
    'كومبو، بيفوت لزاوية جديدة، وكومبو تاني على طول',
    ['بعد الكومبو اطلع ببيفوت أو خطوة جنب، متطلعش لورا على خط مستقيم', 'الزاوية الجديدة يعني ضربة جديدة على طول', 'الشوال بيتحرك: اتحرك معاه'],
    ['ترجع لورا على خط مستقيم', 'البيفوت على الكعب', 'تبطّل تضرب بعد ما تغيّر الزاوية'],
    { label: 'زوايا حوالين الشوال', sub: 'بيفوت شمال، خطوة يمين، وكومبو من كل زاوية', video: 'box.angles' },
    ['box.angles', 'box.bag']),
  W(12, 'master', 'صوّر نفسك وراجع (أسبوع تخفيف)', { code: 'كومبو من اختيارك', ar: 'أصعب كومبو من الأسابيع اللي فاتت' },
    'جولة شادو متصوّرة: اختار كومبو وكرّره بشكل نضيف',
    ['حط الموبايل على الأرض بزاوية جنب، وصوّر جولة شادو وجولة شوال', 'قارن بالفيديو: الجارد، دقنك، ورجوع الإيد', 'اكتب أهم غلطة واحدة وركّز عليها الأسبوع الجاي'],
    ['تصوّر من قدّام بس فرجلك مش باينة', 'تحاول تصلّح كل حاجة مرة واحدة', 'تقيّم نفسك من غير ما تقارن بفيديو'],
    { label: 'حركة + دفاع خفيف', sub: 'نفس الجولة المتصوّرة من غير ضرب قوي', video: 'box.footDrill' },
    ['box.selfReview', 'box.shadow']),
]);
/** Always-on videos: wraps (every session) and the jump-rope basics. */
export const GEAR_VIDEOS = Object.freeze(['box.wraps', 'box.rope']);

/**
 * Curriculum week for a date. n = program week counted from the 6-week block start (blockStart(startDay, reentry)), 1-based;
 * weeks 13+ cycle through 7–12 (defense + mastery) so the deload weeks stay on 6 / 12.
 * Re-entry weeks: week = the re-entry week (1–2), technique-only. Deload: block week 6 or an active deload → technique-only.
 * → {week, n, deload, reentry, tech, why}
 */
export function boxingWeek({ startDay = null, today, reentry = null, deload = null } = {}) {
  const re = reentry && reentry.active ? reentry : null;
  if (re) return { week: clampN(+re.week || 1, 1, 2), n: 0, deload: false, reentry: true, tech: true, why: 'reentry' };
  const start = blockStart(startDay, reentry);
  let n = 1;
  if (start && today) { try { const d = diffDays(start, today); n = d >= 0 ? Math.floor(d / 7) + 1 : 1; } catch { n = 1; } }
  const week = n <= 12 ? n : 7 + ((n - 13) % 6);
  const mw = start && today ? mesoWeek(start, today) : null;
  const dl = mw === 6 || (deload ? deloadActive(deload, today) : false);
  return { week, n, deload: dl, reentry: false, tech: dl, why: dl ? 'deload' : null };
}
export const curriculumFor = (week) => CURRICULUM[clampN(Math.round(+week || 1), 1, 12) - 1];

// ══ BP gate (same gate as the Heart Day, bp.js) ═══════════════════
/**
 * → {state, tech, iso, stop, why}: tech = shadow + light bag at RPE ≤ 6 (no hard rounds); iso = wall sit allowed.
 * stop  latest > 180/110 → no session today.
 * tech  latest ≥ 160/100 (or any reading ≥ 160/100 in 30 days), or the 3-day baseline not done yet, or average 140/90+;
 *       the isometric block is skipped in all of these, exactly as on the Heart Day.
 */
export function boxingGate(log, today) {
  const g = bpGate(log, today);
  const last = latestBP((log || []).filter((r) => r && r.cuff === 'arm'));
  const high = !!last && (+last.sys >= 160 || +last.dia >= 100);
  if (g.state === 'stop') return { state: 'stop', tech: true, iso: false, stop: true, why: GATE_WHY.stop, gate: g };
  const state = high ? 'block' : g.state;
  if (state === 'ok') return { state, tech: false, iso: true, stop: false, why: '', gate: g };
  return { state, tech: true, iso: false, stop: false, why: GATE_WHY[state] || GATE_WHY.baseline, gate: g };
}
export const GATE_WHY = Object.freeze({
  baseline: 'لسه محتاجين قراءات ضغط 3 أيام (قراءتين كل يوم من جهاز دراع). لحد كده الجلسة تكنيك: شادو وشوال خفيف بمجهود 6 من 10 أو أقل، ومن غير جلوس على الحيطة.',
  gp: 'متوسط ضغطك 140/90 أو أكتر شوية. لحد ما دكتور يطمّنك: تكنيك بس، شادو وشوال خفيف بمجهود 6 من 10 أو أقل، ومن غير جلوس على الحيطة.',
  block: 'فيه قراءة ضغط 160/100 أو أكتر. النهارده تكنيك بس: شادو وشوال خفيف بمجهود 6 من 10 أو أقل، ومن غير جلوس على الحيطة. اكشف عند دكتور قبل الجولات القوية.',
  stop: 'آخر قراءة ضغط أعلى من 180/110. مفيش تمرين النهارده: ارتاح وقيس تاني بعد 5 دقايق، وكلّم دكتور النهارده. لو فيه ألم صدر أو ضيق نفس أو زغللة أو صداع شديد: طوارئ 998 / 999.',
});
export const TECH_WHY = Object.freeze({
  deload: 'أسبوع تخفيف في دورة الحديد: الملاكمة تكنيك بس، شوال خفيف بمجهود 6 من 10 أو أقل ومن غير جولات قوية.',
  reentry: 'أسبوع رجوع بعد انقطاع: تكنيك وشوال خفيف بمجهود 6 من 10 أو أقل لحد ما الدورة تبدأ.',
});
export const SAFETY = Object.freeze([
  'لف رباط الإيد كل مرة قبل الجوانتي، حتى في الجولات الخفيفة.',
  'وقّف فوراً لو ألم أو ضغط في الصدر، أو دوخة، أو نَفَس مقطوع مش طبيعي.',
  'اتنفس مع كل ضربة (نفَس قصير من بُقّك). ممنوع تكتم نفسك، خصوصاً في الجلوس على الحيطة.',
]);

// ══ session template ══════════════════════════════════════════════
export const BOX_MIN = 30, BOX_DEFAULT = 35, BOX_MAX = 40;
/** «معاك كام دقيقة؟» pick → boxing minutes: 30 → 30, 45+ → 40 (cap), nothing picked (60) → 35. */
export function boxingBudget(pick) {
  const m = +pick;
  if (m === 30) return 30;
  if (m === 35 || m === 40) return m;
  if (m === 45) return 40;
  return BOX_DEFAULT;
}
const P = (id, kind, dur, label, sub, extra = {}) => ({ id, kind, dur, label, sub, ...extra });
/** Kinds that count as cardio minutes (weekly aerobic total): rope, shadow, bag, drill and the rests between them. */
export const CARDIO_PHASES = Object.freeze(new Set(['rope', 'shadow', 'srest', 'gloves', 'bag', 'brest', 'drill', 'drest']));
const RPE = { base: '6–7', power: '7', defense: '7', master: '7–8', tech: '6 أو أقل' };

/**
 * boxingPlan({week, budgetMin, tech, iso}) → {phases, total, rounds:{shadow, bag, bagLen, drill}, rpe, mode, budget}
 * Phases, in order (each timed, seconds):
 *   rope + joint prep 5:00 · shadow 3 × 2:00 with 0:30 rests (the last «rest» is gloves on) ·
 *   heavy bag: weeks 1–3 4 × 2:00 on / 1:00 off, weeks 4+ 5 × 3:00 / 1:00, trimmed to fit · defense/footwork 1–2 × 2:00 ·
 *   core (anti-rotation / rotation) 3:00 · health: wall sit 2 × 2:00 + 1:00 rest (the Heart Day block) + pelvic floor 1:30.
 * tech (BP gate, deload, re-entry): bag rounds become light technique rounds (4 × 2:00, RPE ≤ 6). iso:false skips the wall sit
 * (pelvic floor + slow breathing 2:30 instead). Trims, in order, until the total fits the budget: second drill round,
 * bag rounds down to 3, shadow down to 2, bag down to 2, 3-min rounds → 2-min. Total is always ≤ budget ≤ 40:00.
 */
export function boxingPlan({ week = 1, budgetMin = BOX_DEFAULT, tech = false, iso = true } = {}) {
  const budget = clampN(Math.round(+budgetMin || BOX_DEFAULT), BOX_MIN, BOX_MAX) * 60;
  const cw = curriculumFor(week);
  const early = cw.week <= 3 || tech;
  const cfg = { shadow: 3, bag: early ? 4 : 5, bagLen: early ? 120 : 180, drill: 2 };
  const build = () => {
    const out = [];
    out.push(P('rope', 'rope', 300, 'نط حبل + تحضير مفاصل', 'دقيقتين حبل خفيف · لف رقبة وكتف ووسط وكاحل · وبعدين حبل تاني', { video: 'box.rope' }));
    for (let i = 1; i <= cfg.shadow; i++) {
      out.push(P(`sh${i}`, 'shadow', 120, `شادو ${i} من ${cfg.shadow}`, cw.shadow, { round: i, of: cfg.shadow, video: 'box.shadow' }));
      out.push(i < cfg.shadow ? P(`shr${i}`, 'srest', 30, 'راحة', 'نفَس هادي واتمشى')
        : P('gloves', 'gloves', 30, 'البس الجوانتي', 'الرباط ملفوف؟ قرّب من الشوال على مسافة دراع'));
    }
    for (let i = 1; i <= cfg.bag; i++) {
      out.push(P(`bag${i}`, 'bag', cfg.bagLen, `شوال ${i} من ${cfg.bag}`, tech ? 'شوال خفيف: الشكل قبل القوة · مجهود 6 من 10 أو أقل'
        : `كومبو الأسبوع وجاب كتير · مجهود ${RPE[cw.phase]} من 10`, { round: i, of: cfg.bag, combo: cw.combo, light: !!tech }));
      if (i < cfg.bag) out.push(P(`br${i}`, 'brest', 60, 'راحة بين الجولات', 'اتمشى واتنفس من مناخيرك · سجّل المجهود'));
    }
    for (let i = 1; i <= cfg.drill; i++) {
      out.push(P(`dr${i}`, 'drill', 120, cfg.drill > 1 ? `${cw.drill.label} ${i} من ${cfg.drill}` : cw.drill.label, cw.drill.sub, { video: cw.drill.video }));
      if (i < cfg.drill) out.push(P(`drr${i}`, 'drest', 30, 'راحة', 'نفَس هادي'));
    }
    out.push(P('core', 'core', 180, 'بطن: ضد اللف واللف', 'بالوف بريس 45 ث كل ناحية · وودشوب بطيء 45 ث كل ناحية · من غير ما تكتم نفسك', { video: 'box.pallof' }));
    if (iso) {
      out.push(P('wall1', 'wall', 120, 'جلوس على الحيطة 1 من 2', 'اتنفس طبيعي · ممنوع تكتم نفسك · مجهود 7 من 10 في الآخر', { video: 'wallsit' }));
      out.push(P('wrest', 'rest', 60, 'راحة', 'قوم وامشي خطوتين'));
      out.push(P('wall2', 'wall', 120, 'جلوس على الحيطة 2 من 2', 'اتنفس طبيعي · ممنوع تكتم نفسك', { video: 'wallsit' }));
      out.push(P('pelvic', 'pelvic', 90, 'قاع الحوض + تنفس بطيء', 'شهيق 4 ثواني · زفير 6 ثواني · شد مع الزفير', { video: 'kegel' }));
    } else out.push(P('pelvic', 'pelvic', 150, 'قاع الحوض + تنفس بطيء', 'شهيق 4 ثواني · زفير 6 ثواني · شد مع الزفير · الجلوس على الحيطة مقفول النهارده', { video: 'kegel' }));
    return out;
  };
  const steps = [() => cfg.drill > 1 && (cfg.drill = 1), () => cfg.bag > 3 && (cfg.bag -= 1), () => cfg.shadow > 2 && (cfg.shadow = 2),
    () => cfg.bag > 2 && (cfg.bag -= 1), () => cfg.bagLen > 120 && (cfg.bagLen = 120)];
  let phases = build();
  for (let i = 0; totalSecs(phases) > budget && i < steps.length;) { if (steps[i]()) phases = build(); else i++; }
  return { phases, total: totalSecs(phases), budget: budget / 60, rounds: { shadow: cfg.shadow, bag: cfg.bag, bagLen: cfg.bagLen, drill: cfg.drill },
    rpe: tech ? RPE.tech : RPE[cw.phase], rpeMax: tech ? 6 : 10, mode: tech ? 'tech' : 'full', iso: !!iso, week: cw.week, combo: cw.combo };
}
export const totalSecs = (phases) => (phases || []).reduce((a, p) => a + (+p.dur || 0), 0);

/** Today's boxing in one call (screen, Today card, coach). → {week, cw, gate, plan, tech, why} */
export function boxingToday({ startDay = null, today, reentry = null, deload = null, bp = [], budgetMin = BOX_DEFAULT } = {}) {
  const wk = boxingWeek({ startDay, today, reentry, deload });
  const gate = boxingGate(bp, today);
  const tech = wk.tech || gate.tech;
  const plan = gate.stop ? null : boxingPlan({ week: wk.week, budgetMin, tech, iso: gate.iso });
  const why = gate.tech ? gate.why : wk.why ? TECH_WHY[wk.why] : '';
  return { ...wk, cw: curriculumFor(wk.week), gate, plan, tech, why };
}

// ══ records + stats ═══════════════════════════════════════════════
/**
 * Session record for the sessions store: kind 'boxing' (never a lifting session: no exercises array, so finished(),
 * volume, PRs and lifting-day counts skip it). rounds: [{id, kind:'shadow'|'bag', n, of, dur, doneS, rpe|null}].
 */
export function boxingRecord({ now = new Date(), week = 1, mode = 'full', phases = [], rpe = {}, combo = null, gate = 'ok', budget = BOX_DEFAULT } = {}) {
  const durationS = phases.reduce((a, p) => a + (+p.doneS || 0), 0);
  const rounds = phases.filter((p) => p.kind === 'bag' || p.kind === 'shadow').map((p) => ({ id: p.id, kind: p.kind, n: p.round, of: p.of, dur: p.dur,
    doneS: Math.round(+p.doneS || 0), rpe: Number.isInteger(rpe[p.id]) && rpe[p.id] >= 1 && rpe[p.id] <= 10 ? rpe[p.id] : null }));
  return { id: `b:${now.getTime().toString(36)}`, kind: 'boxing', mode, day: dayKey(now), week, budget,
    startedAt: new Date(now.getTime() - durationS * 1000).toISOString(), finishedAt: now.toISOString(),
    durationS, durationMin: Math.max(1, Math.round(durationS / 60)), status: 'done', gate, combo: combo ? combo.code : null,
    phases: phases.map((p) => ({ id: p.id, kind: p.kind, dur: p.dur, doneS: Math.round(+p.doneS || 0) })), rounds };
}
/** A round counts as done when at least half of it ran. */
export const roundDone = (r) => !!r && (+r.doneS || 0) >= (+r.dur || 0) * 0.5;
/** Cardio seconds of a boxing record (rope, shadow, bag, drill and the rests between them). */
export const boxingCardioSecs = (rec) => (rec && Array.isArray(rec.phases) ? rec.phases.filter((p) => CARDIO_PHASES.has(p.kind)).reduce((a, p) => a + (+p.doneS || 0), 0) : 0);
/** This week's boxing: {sessions, rounds (bag rounds done), shadow, minutes (clock), cardioMin, avgRpe}. */
export function boxingWeekStats(sessions, today, startDow = 1) {
  let ws; try { ws = weekStart(today, startDow); } catch { return { sessions: 0, rounds: 0, shadow: 0, minutes: 0, cardioMin: 0, avgRpe: null }; }
  const rows = (sessions || []).filter((s) => s && s.kind === 'boxing' && !s.discarded && s.status !== 'active' && s.day && s.day >= ws && s.day <= today);
  const rs = rows.flatMap((s) => (Array.isArray(s.rounds) ? s.rounds : []));
  const bag = rs.filter((r) => r.kind === 'bag' && roundDone(r));
  const rpes = rs.map((r) => r.rpe).filter((x) => Number.isInteger(x));
  return { sessions: rows.length, rounds: bag.length, shadow: rs.filter((r) => r.kind === 'shadow' && roundDone(r)).length,
    minutes: Math.round(rows.reduce((a, s) => a + (+s.durationS || 0), 0) / 60), cardioMin: Math.round(rows.reduce((a, s) => a + boxingCardioSecs(s), 0) / 60),
    avgRpe: rpes.length ? Math.round((rpes.reduce((a, b) => a + b, 0) / rpes.length) * 10) / 10 : null };
}

/** Plain-text lines for the coach context (English frame, Arabic content). */
export function boxingContextLines({ startDay = null, today, reentry = null, deload = null, bp = [], sessions = [], dow = 4, startDow = 1 } = {}) {
  const t = boxingToday({ startDay, today, reentry, deload, bp });
  const st = boxingWeekStats(sessions, today, startDow);
  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const out = [`Boxing Day: ${DOW[dow] || dow} (replaces the Heart Day; solo, heavy bag, gloves + wraps, no coach; 30–40 min; not a lifting session; nutrition = heart day type)`,
    `Boxing curriculum week ${t.week} of 12 (${PHASES[t.cw.phase]}): ${t.cw.title}; combo of the week ${t.cw.combo.code} (${t.cw.combo.ar})`,
    `Cues: ${t.cw.cues.join(' | ')}`, `Common mistakes: ${t.cw.mistakes.join(' | ')}`,
    `Today's mode: ${t.gate.stop ? 'no exercise (BP > 180/110)' : t.tech ? `technique-only, RPE ≤ 6 (${t.gate.tech ? 'home-reading safety gate' : t.deload ? 'deload week' : 're-entry'})` : `full: bag ${t.plan.rounds.bag} × ${t.plan.rounds.bagLen / 60} min, RPE ${t.plan.rpe}`}; wall sit ${t.gate.iso ? 'on' : 'skipped (safety gate)'}`,
    `Boxing this week: ${st.sessions} sessions, ${st.rounds} bag rounds, ${st.minutes} min${st.avgRpe ? `, avg RPE ${st.avgRpe}` : ''}`];
  return out;
}

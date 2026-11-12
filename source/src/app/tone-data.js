// Pure: which colour the day wears in the «ألوان اليوم» design. Unit-tested.
export const TONES = Object.freeze(['sunrise', 'mint', 'sky', 'berry', 'fire', 'gold']);
export const TONE_LABEL = Object.freeze({ sunrise: 'شروق', mint: 'نعناع', sky: 'سماوي', berry: 'توتي', fire: 'ناري', gold: 'ذهبي' });
/** ground colour per tone (status bar / first paint) */
export const TONE_BG = Object.freeze({ sunrise: '#FFF7EE', mint: '#F1FBF6', sky: '#F2F6FF', berry: '#FBF4FF', fire: '#FFF4F1', gold: '#FFFBEC' });
const BY_DAY = { upperA: 'sunrise', lowerA: 'mint', upperB: 'sky', lowerB: 'berry' };
const CYCLE = ['sunrise', 'mint', 'sky', 'berry'];

/**
 * toneFor(plan, order) → tone.
 * plan = today-plan.js planForDay: {kind:'training'|'active'|'done'|'heart'|'rest', dayId, cardio, live, doneToday}.
 * A lifting day keeps its colour all day (before, during and after the session); boxing / cardio = fire; rest = gold.
 * Custom programs: the day's position in the program order picks the colour.
 */
export function toneFor(plan, order = []) {
  if (!plan) return 'gold';
  const id = plan.kind === 'active' ? (plan.live && plan.live.dayKey) || plan.dayId
    : plan.kind === 'done' ? (plan.doneToday && plan.doneToday.dayKey) || plan.dayId
      : plan.kind === 'training' ? plan.dayId : null;
  if (id) {
    if (BY_DAY[id]) return BY_DAY[id];
    const i = Array.isArray(order) ? order.indexOf(id) : -1;
    return CYCLE[(i < 0 ? 0 : i) % CYCLE.length];
  }
  if (plan.kind === 'active' || plan.kind === 'done' || plan.kind === 'training') return 'sunrise';
  if (plan.kind === 'heart') return 'fire';
  return 'gold';
}

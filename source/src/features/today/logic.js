// Today pure logic: water goal, meals done, «أهداف النهارده» auto-ticks. No DOM.
import { sumEntries } from '../../core/targets.js';
import { sectionOf, targetRange } from '../nutrition/logic.js';

export const MAIN_MEALS = ['breakfast', 'lunch', 'dinner'];

/** Water goal in ml: nutrition's own goal if set, else 33 ml/kg (+500 on training days), else 2500. */
export function waterGoalMl({ nutrition = {}, settings = {}, kg = null, training = false } = {}) {
  const own = +nutrition.waterGoalMl || (+nutrition.waterGoalL ? nutrition.waterGoalL * 1000 : 0) || (+settings.waterGoalCups ? settings.waterGoalCups * 250 : 0);
  if (own >= 500) return Math.round(own);
  if (kg > 0) return Math.round((kg * 33 + (training ? 500 : 0)) / 50) * 50;
  return 2500;
}

export function mealsDone(entries) {
  const has = new Set(entries.map(sectionOf));
  const done = MAIN_MEALS.filter((k) => has.has(k));
  return { done: done.length, total: MAIN_MEALS.length, next: MAIN_MEALS.find((k) => !has.has(k)) || null };
}

export const AUTO_ITEMS = Object.freeze([
  { id: 'workout', label: 'التمرين', when: 'training' },
  { id: 'recovery', label: 'تعافي أو إطالة', when: 'rest' },
  { id: 'protein', label: 'هدف البروتين' },
  { id: 'water', label: 'هدف المية' },
  { id: 'weigh', label: 'الوزن الصبح' },
  { id: 'supps', label: 'المكمّلات', needs: 'supps' },
]);
export const DEFAULT_PREGYM = Object.freeze([
  { id: 'pg1', label: 'أكلت وجبة قبلها بساعة لساعتين' },
  { id: 'pg2', label: 'إزازة مية معايا' },
  { id: 'pg3', label: 'الجزمة والسماعات' },
]);

/**
 * Checklist rows for a day.
 * input: {type, entries, target, waterMl, waterGoal, weighed, sessionDone, recoveryDone, supplements, hasSupps, config, ticks}
 * → [{id, label, auto, done, group:'day'|'pregym'}]
 */
export function checklist(i) {
  const cfg = i.config || {};
  const hidden = new Set(cfg.hidden || []);
  const ticks = i.ticks || {};
  const intake = sumEntries(i.entries || []);
  const pMin = i.target ? targetRange(i.target).pMin : Infinity;
  const supps = i.supplements;
  const suppDone = Array.isArray(supps) ? supps.length > 0 && supps.every((x) => x && (x.done || x.taken || x === true))
    : supps && typeof supps === 'object' ? Object.values(supps).length > 0 && Object.values(supps).every(Boolean) : false;
  const auto = {
    workout: !!i.sessionDone, recovery: !!i.recoveryDone, protein: intake.p >= pMin,
    water: i.waterGoal > 0 && (+i.waterMl || 0) >= i.waterGoal, weigh: !!i.weighed, supps: suppDone,
  };
  const rows = [];
  for (const a of AUTO_ITEMS) {
    if (hidden.has(a.id)) continue;
    if (a.when && a.when !== i.type) continue;
    if (a.needs === 'supps' && !i.hasSupps) continue;
    rows.push({ id: a.id, label: a.label, auto: true, done: auto[a.id] || !!ticks[a.id], group: 'day' });
  }
  for (const c of cfg.custom || []) if (c && c.id && c.label) rows.push({ id: c.id, label: String(c.label).slice(0, 60), auto: false, done: !!ticks[c.id], group: 'day' });
  if (i.type === 'training' && !i.sessionDone) {
    for (const c of (Array.isArray(cfg.pregym) ? cfg.pregym : DEFAULT_PREGYM)) if (c && c.id && c.label) rows.push({ id: c.id, label: String(c.label).slice(0, 60), auto: false, done: !!ticks[c.id], group: 'pregym' });
  }
  return rows;
}

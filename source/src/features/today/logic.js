// Today pure logic: water goal, meals done, «أهداف النهارده» auto-ticks, usual meal, due cards. No DOM.
import { sumEntries } from '../../core/targets.js';
import { sectionOf, targetRange, foodKey, newId, sectionForHour } from '../nutrition/logic.js';

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

// ───────── «وجبتك المعتادة»: one-tap usual meal by time of day ─────────

/** Default breakfast before any history (owner's standard): 4 eggs, 250 ml milk, 60 g oats, 1 scoop whey. Ids = foods.js. */
export const SEED_BREAKFAST = Object.freeze([
  { foodId: 'd:f9', name: 'بيضة كاملة', qty: 4, unit: 'حبة', per: 1, kcal: 72, p: 6.3, c: 0.4, f: 4.8 },
  { foodId: 'd:f36', name: 'حليب كامل الدسم', qty: 250, unit: 'مل', per: 100, kcal: 61, p: 3.2, c: 4.8, f: 3.3 },
  { foodId: 'd:f19', name: 'شوفان جاف', qty: 60, unit: 'جرام', per: 100, kcal: 389, p: 16.9, c: 66.3, f: 6.9 },
  { foodId: 'd:f11', name: 'واي بروتين سكوب', qty: 1, unit: 'سكوب', per: 1, kcal: 120, p: 24, c: 3, f: 2 },
].map(Object.freeze));
const r1 = (x) => Math.round(x * 10) / 10;
const seedEntries = () => SEED_BREAKFAST.map(({ per, ...s }) => ({ ...s, kcal: r1((s.kcal * s.qty) / per), p: r1((s.p * s.qty) / per), c: r1((s.c * s.qty) / per), f: r1((s.f * s.qty) / per) }));

/**
 * Most frequent combo of foods you logged in one meal over the given days (order-free), ties → most recent.
 * days: [{day, entries}] → {count, day, entries} | null (entries = that meal on the latest day with the combo)
 */
export function usualCombo(days = [], section) {
  const by = new Map();
  for (const d of days) {
    const es = ((d && d.entries) || []).filter((e) => sectionOf(e) === section);
    if (!es.length) continue;
    const key = [...new Set(es.map(foodKey))].sort().join('|');
    const cur = by.get(key) || { count: 0, day: '', entries: [] };
    cur.count++;
    if (d.day > cur.day) { cur.day = d.day; cur.entries = es; }
    by.set(key, cur);
  }
  let best = null;
  for (const v of by.values()) if (!best || v.count > best.count || (v.count === best.count && v.day > best.day)) best = v;
  return best;
}

const BF_NAME = /فطار|فطور|افطار|إفطار|breakfast/i;

/**
 * The one-tap meal card for this hour, or null.
 * input: {hour, todayEntries, days (recent, excluding today), yesterday:{entries}, savedMeals:[{name, items}]}
 * → {section, kind:'usual'|'yesterday', label, entries, kcal, p, source:'history'|'saved'|'last'|'seed'}
 * Breakfast before 11:00 (usual: combo seen ≥ 2× → saved «فطار» meal → last breakfast → seed);
 * lunch 11–16 and dinner 16–20: «زي امبارح» when yesterday had that meal. Hidden once that meal is logged today.
 */
export function quickMeal({ hour, todayEntries = [], days = [], yesterday = null, savedMeals = [] } = {}) {
  const section = sectionForHour(hour);
  if (section === 'snack') return null;
  if ((todayEntries || []).some((e) => sectionOf(e) === section)) return null;
  let entries = null, kind = 'usual', source = null;
  if (section === 'breakfast') {
    const combo = usualCombo(days, 'breakfast');
    const saved = (savedMeals || []).find((m) => m && BF_NAME.test(String(m.name || '')) && Array.isArray(m.items) && m.items.length);
    if (combo && combo.count >= 2) { entries = combo.entries; source = 'history'; }
    else if (saved) { entries = saved.items; source = 'saved'; }
    else if (combo) { entries = combo.entries; source = 'last'; }
    else { entries = seedEntries(); source = 'seed'; }
  } else {
    const y = ((yesterday && yesterday.entries) || []).filter((e) => sectionOf(e) === section);
    if (!y.length) return null;
    entries = y; kind = 'yesterday'; source = 'history';
  }
  const tot = sumEntries(entries);
  return { section, kind, source, entries, kcal: Math.round(tot.kcal), p: Math.round(tot.p) };
}

/** Fresh log entries from a quickMeal template (new ids, this meal, now). */
export function entriesForLog(meal, now = new Date()) {
  const t = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  return meal.entries.map((e) => ({ foodId: e.foodId || null, name: e.name, qty: e.qty, unit: e.unit, kcal: +e.kcal || 0, p: +e.p || 0, c: +e.c || 0, f: +e.f || 0,
    ...(e.fib ? { fib: e.fib } : {}), ...(e.na ? { na: e.na } : {}),
    id: newId('e', now.getTime()), section: meal.section, time: t, src: meal.source === 'seed' ? 'db' : meal.source === 'saved' ? 'meal' : 'repeat' }));
}

/** Short Arabic line for the card: «4 بيضة كاملة · حليب كامل الدسم 250 مل · …» (first 4 items). */
export function mealLine(entries = []) {
  const one = (e) => (/حبة|سكوب|رغيف|شريحة|كوب|ملعقة|قطعة/.test(e.unit || '') ? `${e.qty} ${String(e.name).split(' (')[0]}` : `${String(e.name).split(' (')[0]} ${e.qty}${/مل/.test(e.unit || '') ? ' مل' : /جرام|جم/.test(e.unit || '') ? ' جم' : ''}`);
  const s = entries.slice(0, 4).map(one).join(' · ');
  return entries.length > 4 ? `${s} · +${entries.length - 4}` : s;
}

// ───────── due cards: morning weight, BP baseline, pelvic floor ─────────
export const WEIGH_UNTIL = 12;
/** Inline morning weight row: before noon, not weighed today. */
export const weightDue = ({ hour, weighed }) => hour < WEIGH_UNTIL && !weighed;

/** BP reading needed today while the 3-day baseline is incomplete (2 readings a day). → {need, today} | null */
export function bpDue({ gateState, bp = [], day }) {
  if (gateState !== 'baseline') return null;
  const n = (bp || []).filter((r) => r && r.day === day).length;
  return n >= 2 ? null : { need: 2, today: n };
}

/** Pelvic-floor sessions left today (2 a day for weeks 1–12, then 1). → {done, perDay} | null */
export function kegelDue({ kegel = {}, day, week = 1 }) {
  const perDay = week >= 13 ? 1 : 2;
  const done = ((kegel && kegel.log) || []).filter((r) => r && r.day === day).length;
  return done >= perDay ? null : { done, perDay };
}

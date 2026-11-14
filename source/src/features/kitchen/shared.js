// Shared by the kitchen screens: storage key, Arabic counts, and the log entry that carries its own macro snapshot.
import { h } from '../../ui/dom.js';
import { fmt } from '../../ui/num.js';
import { sectionForHour, newId } from '../nutrition/logic.js';
import { n0 } from '../nutrition/ui.js';
import { RECIPES } from './recipes.js';

export const KV = 'kitchen';
export const byId = (id) => RECIPES.find((r) => r.id === id) || null;
const hhmm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
export const macroLine = (m) => h('span', { class: 'kt-macros' }, n0(m.kcal), ' سعرة · ', n0(m.p), ' بروتين · ', n0(m.c), ' كارب · ', n0(m.f), ' دهون');
const PLURAL = { 'علبة': 'علب', 'كرة': 'كرات', 'كوب': 'أكواب', 'قطعة': 'قطع', 'مربع': 'مربعات', 'طبق': 'أطباق', 'حصة': 'حصص', 'يوم': 'أيام', 'وجبة': 'وجبات' };
/** «3 علب» / «1 علبة» / «12 علبة» (Arabic counts 3-10 take the plural). */
export const count = (n, unit) => `${fmt(n)} ${n >= 3 && n <= 10 && PLURAL[unit] ? PLURAL[unit] : unit}`;
export const timeText = (r) => (r.wait ? `${fmt(r.active)} د شغل + ${fmt(r.wait)} د انتظار` : `${fmt(r.active)} د`);

/** One log entry carrying its own macro snapshot (editing an ingredient later never rewrites the past). */
export function entryOf(name, unit, m, qty = 1, section = null) {
  const now = new Date();
  return { id: newId('e', now.getTime()), foodId: null, name: String(name).slice(0, 120), qty, unit, kcal: Math.round(m.kcal * qty), p: Math.round(m.p * qty * 10) / 10,
    c: Math.round(m.c * qty * 10) / 10, f: Math.round(m.f * qty * 10) / 10, section: section || sectionForHour(now.getHours()), time: hhmm(now), src: 'kitchen' };
}

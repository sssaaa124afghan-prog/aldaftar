// Food logging from the coach chat. The APP, never the model, is the only source of truth for «اتسجل»:
//   pickFoodLog  → which food.log to apply for one user message (model action → local parser fallback → honest failure)
//   prepareLog   → resolve items against the foods DB into foodLog entries (right local day + meal)
//   commitEntries / undoEntries / replaceEntries → atomic write, then READ BACK from the DB; throws unless verified
//   idempotency: every entry carries ik = the user message id, so a retry / stream replay never logs twice.
// No DOM here (unit-tested with the memory DB).
import { resolveItems, entriesFor, resolveDay, localFoodLog } from './foodlog.js';
import { parseLogCommand, isFoodAction } from './actions.js';
import { detectIntent } from './prompts.js';
import { searchFoods, SECTION_LABEL } from '../nutrition/logic.js';
import { portion, sumEntries } from '../../core/targets.js';
import { updateEntries, getEntriesStrict } from '../nutrition/data.js';
import { addDays } from '../../core/date.js';

export const LOG_COPY = Object.freeze({
  fail: 'ماقدرتش أسجّل — اكتب الصنف والكمية، مثال: 150 جم كبدة',
  writeFail: 'ماقدرتش أحفظ الأكل على الجهاز، فماتسجّلش حاجة. جرّب تاني.',
  undoFail: 'ماقدرتش أشيل التسجيل. جرّب تاني.',
  undone: 'اتشال التسجيل',
});
/** Settings key of «أكّد قبل تسجيل الأكل» (default off: valid food.log applies at once). */
export const CONFIRM_KEY = 'coach.confirmFood';

/** The user's own message is a «log this food» request (same rule that routes it to the food_log intent). */
export const wantsFoodLog = (text) => detectIntent(String(text || '')) === 'food_log';

/** Legacy {type:'log', section, items} → food.log. */
export function toFoodLog(a) {
  if (!a) return null;
  if (a.type === 'food.log') return a;
  if (a.type === 'log') return { type: 'food.log', day: 'today', meal: a.section || null, items: a.items.map((it) => ({ ...it, meal: it.meal || a.section || null })) };
  return null;
}
/** Several food.log actions in one reply → one (first day wins; each item keeps its meal). */
export function mergeFoodLogs(list) {
  const xs = list.map(toFoodLog).filter(Boolean);
  if (!xs.length) return null;
  if (xs.length === 1) return xs[0];
  return { type: 'food.log', day: xs[0].day, meal: xs[0].meal, items: xs.flatMap((a) => a.items.map((it) => ({ ...it, meal: it.meal || a.meal || null }))).slice(0, 15) };
}

/** Local parser on the user's own words (no API): multi-item phrase, else «ضيف 150 جرام صدر فراخ». → food.log | null */
export function localAction(text, catalog = [], usage = null) {
  const multi = localFoodLog(text, catalog, { usage });
  if (multi) return multi;
  const cmd = parseLogCommand(text);
  if (!cmd) return null;
  const food = searchFoods(catalog, cmd.query, { usage, limit: 1 })[0];
  if (!food) return null;
  let m; try { m = portion(food, cmd.grams); } catch { return null; }
  return { type: 'food.log', day: 'today', meal: cmd.section, items: [{ name: food.name, grams: cmd.grams, meal: cmd.section, ...m }] };
}

/**
 * pickFoodLog({userText, actions, dropped, catalog, usage}) →
 *   null                                    nothing about food to do
 *   {action, source:'model'|'local', asked} a food.log to apply (asked = the user asked to log → auto-apply allowed)
 *   {action:null, source:'none', asked}     he asked (or the model tried) but nothing valid: show LOG_COPY.fail
 */
export function pickFoodLog({ userText = '', actions = [], dropped = [], catalog = [], usage = null } = {}) {
  const asked = wantsFoodLog(userText);
  const model = mergeFoodLogs(actions.filter(isFoodAction));
  if (model) return { action: model, source: 'model', asked };
  const tried = dropped.some((d) => d && (d.type === 'food.log' || d.type === 'log'));
  if (!asked && !tried) return null;
  const local = asked ? localAction(userText, catalog, usage) : null;
  if (local) return { action: local, source: 'local', asked };
  return { action: null, source: 'none', asked };
}

/** food.log → {day, rows, entries}: local day key (today / yesterday / ≤ 30 days back) and meal (stated, else by the hour). */
export function prepareLog(action, { catalog = [], usage = null, now = new Date(), today }) {
  const day = resolveDay(action.day, today);
  const rows = resolveItems(action.items, catalog, { usage, hour: now.getHours(), meal: action.meal || null });
  const entries = entriesFor(rows, now).map((e) => ({ ...e, src: 'coach' }));
  return { day, rows, entries };
}

const verifyErr = () => Object.assign(new Error('foodLog write not verified'), { code: 'verify' });

/**
 * Append entries to foodLog[day] once per key (atomic), then read the day back and check every id is there.
 * → {day, entries, totals, dup}. dup = this key was already logged (a retry): nothing new written, the earlier rows returned.
 * Throws (StorageError / code 'verify') when the write failed or cannot be verified.
 */
export async function commitEntries(db, day, entries, key) {
  if (!entries || !entries.length) throw Object.assign(new Error('nothing to log'), { code: 'empty' });
  const stamped = entries.map((e) => ({ ...e, ...(key ? { ik: key } : {}) }));
  const res = await updateEntries(db, day, (cur) => {
    const prior = key ? cur.filter((e) => e && e.ik === key) : [];
    if (prior.length) return { next: undefined, out: { dup: true, entries: prior } };
    return { next: [...cur, ...stamped], out: { dup: false, entries: stamped } };
  });
  const back = await getEntriesStrict(db, day);
  const have = new Set(back.map((e) => e && e.id));
  if (!res.entries.every((e) => have.has(e.id))) throw verifyErr();
  return { day, entries: res.entries, totals: sumEntries(res.entries), dup: res.dup };
}

/** Remove the given entry ids from foodLog[day] (atomic), verify they are gone. */
export async function undoEntries(db, day, ids) {
  const set = new Set(ids);
  await updateEntries(db, day, (cur) => ({ next: cur.filter((e) => !set.has(e && e.id)), out: null }));
  const back = await getEntriesStrict(db, day);
  if (back.some((e) => set.has(e && e.id))) throw verifyErr();
  return true;
}

/** «عدّل»: swap the rows logged earlier (ids) for the edited ones in one transaction, verified. */
export async function replaceEntries(db, day, ids, entries, key) {
  const set = new Set(ids);
  const stamped = entries.map((e) => ({ ...e, ...(key ? { ik: key } : {}) }));
  await updateEntries(db, day, (cur) => ({ next: [...cur.filter((e) => !set.has(e && e.id)), ...stamped], out: null }));
  const back = await getEntriesStrict(db, day);
  const have = new Set(back.map((e) => e && e.id));
  if (!stamped.every((e) => have.has(e.id)) || [...set].some((id) => have.has(id) && !stamped.some((e) => e.id === id))) throw verifyErr();
  return { day, entries: stamped, totals: sumEntries(stamped), dup: false };
}

const r0 = (x) => Math.round(Number(x) || 0);
const amountText = (e) => (/جرام|جم|^g$/i.test(e.unit || '') ? `${r0(e.qty)} جم` : /مل|ml/i.test(e.unit || '') ? `${r0(e.qty)} مل` : `${Math.round((Number(e.qty) || 0) * 10) / 10} ${e.unit || 'حبة'}`);
/** Day suffix for the success line: '' today, « (امبارح)» or « (YYYY-MM-DD)». */
export const daySuffix = (day, today) => (day === today ? '' : day === addDays(today, -1) ? ' (امبارح)' : ` (${day})`);

/** «✅ اتسجل في الفطار: كبدة 150 جم · 721 سعر · 57 بروتين» — built ONLY from verified rows. */
export function successText(result, today) {
  const groups = new Map();
  for (const e of result.entries) { const k = e.section || 'snack'; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(`${e.name} ${amountText(e)}`); }
  const where = [...groups].map(([k, xs]) => `في ال${SECTION_LABEL[k] || 'سناك'}: ${xs.join('، ')}`).join(' · ');
  const t = result.totals || sumEntries(result.entries);
  return `✅ اتسجل${daySuffix(result.day, today)} ${where} · ${r0(t.kcal)} سعر · ${r0(t.p)} بروتين`;
}

/** Logged entries → a food.log action for the «عدّل» card (amount, unit, meal and values kept). */
export function actionFromEntries(result) {
  return { type: 'food.log', day: result.day, meal: null, items: result.entries.map((e) => {
    const g = /جرام|جم|مل/.test(e.unit || '');
    return { name: e.name, ...(g ? { grams: Number(e.qty) } : { qty: Number(e.qty), unit: e.unit || 'حبة' }), meal: e.section, kcal: e.kcal, p: e.p, c: e.c, f: e.f };
  }) };
}

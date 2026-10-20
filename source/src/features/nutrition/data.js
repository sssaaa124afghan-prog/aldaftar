// Nutrition db access (IndexedDB via ctx.db) + shared view helpers. All reads are wrapped; a failed read never writes defaults.
import { parseDayKey, addDays, isDayKey } from '../../core/date.js';
import { sumEntries, targetsForDay } from '../../core/targets.js';
import { createAIClient, AIError, AI_MESSAGES } from '../../core/ai.js';
import { getSecret } from '../../core/db.js';
import { FOODS } from './foods.js';
import { buildCatalog, computeUsage, newId, listRecipes, recipeFood, tdee, macroRanges, waterGoalMl, AI_FOOD_PROMPT, parseAIFood } from './logic.js';
import { loadTargets, dayOpts, DAY_TYPE_LABEL } from '../../app/day.js';
import { targetsForDay as tfd } from '../../core/targets.js';

export async function kvGet(db, key) {
  try { const r = await db.get('kv', key); return r && r.value && typeof r.value === 'object' ? r.value : {}; } catch { return {}; }
}
/** Read-modify-write of a kv record (fn gets a copy, returns the next value). */
export async function kvPatch(db, key, fn) {
  const cur = await kvGet(db, key);
  const next = fn(structuredClone(cur));
  await db.put('kv', { key, value: next });
  return next;
}

export async function getEntries(db, day) {
  try { const r = await db.get('foodLog', day); return r && Array.isArray(r.entries) ? r.entries : []; } catch { return []; }
}
export async function putEntries(db, day, entries) {
  if (entries.length) await db.put('foodLog', { day, entries });
  else await db.delete('foodLog', day);
}

/** Last `n` days of food log (for usage / suggestions). */
export async function recentDays(db, anchor, n = 60) {
  const from = addDays(anchor, -n);
  try { return (await db.getAll('foodLog')).filter((r) => r && isDayKey(r.day) && r.day >= from && r.day <= anchor); } catch { return []; }
}

let catalogCache = null;
export const invalidateCatalog = () => { catalogCache = null; };
export async function loadCatalog(db) {
  if (catalogCache) return catalogCache;
  let user = [];
  try { user = await db.getAll('foods'); } catch { user = []; }
  const recipes = listRecipes((await kvGet(db, 'nutrition')).recipes).map(recipeFood).filter(Boolean);
  catalogCache = { list: buildCatalog(FOODS, [...user, ...recipes]), user };
  return catalogCache;
}
export async function loadUsage(db, day) { return computeUsage(await recentDays(db, day)); }

export async function saveFood(db, food) {
  const { _n, ...clean } = food;
  await db.put('foods', clean);
  invalidateCatalog();
}

/** Day targets with day type from settings + overrides + logged sessions. */
export async function dayTarget(ctx, day) {
  if (typeof ctx.dayInfo === 'function') {
    try { const i = await ctx.dayInfo(day); return { type: i.type, ...i.target, overridden: !!i.overridden }; } catch { /* fall back */ }
  }
  const o = await dayOpts(ctx.db, ctx.settings);
  return { ...targetsForDay(day, o), overridden: !!o.overrides[day] };
}

/**
 * Add entries to a day, emit food:changed, toast with Undo. Returns true on success.
 */
export async function addEntries(ctx, day, entries, label) {
  try {
    const cur = await getEntries(ctx.db, day);
    await putEntries(ctx.db, day, [...cur, ...entries]);
  } catch {
    ctx.toast('ماقدرناش نحفظ دلوقتي. جرّب تاني.');
    return false;
  }
  const ids = new Set(entries.map((e) => e.id));
  ctx.emit('food:changed', { day });
  const kcal = Math.round(sumEntries(entries).kcal);
  ctx.toast(label || `اتسجّل · ${kcal} سعرة`, { action: { label: 'تراجع', run: async () => {
    const now = await getEntries(ctx.db, day);
    await putEntries(ctx.db, day, now.filter((e) => !ids.has(e.id)));
    ctx.emit('food:changed', { day });
  } } });
  return true;
}

/** Remember the last quantity per food (kv nutrition.lastQty). */
export async function rememberQty(db, foodId, qty) {
  if (!foodId) return;
  try { await kvPatch(db, 'nutrition', (n) => ({ ...n, lastQty: { ...(n.lastQty || {}), [foodId]: qty } })); } catch { /* not critical */ }
}

// ───────── AI ─────────
export function aiClient(ctx) {
  return createAIClient({ getKey: async () => (ctx.settings.get('anthropicKey') || (await getSecret(ctx.db, 'anthropicKey'))) });
}
export const aiErrorText = (e) => (e instanceof AIError ? e.message : AI_MESSAGES.server);

/** Whitelisted context for the coach (no name / identifiers): body metrics, today, last session, week. */
export async function coachContext(ctx, extra = {}) {
  const day = ctx.today();
  const out = {};
  try {
    const p = (await ctx.db.get('profile', 'me')) || {};
    const ws = (await ctx.db.getAll('bodyweight')).filter((w) => w && w.day).sort((a, b) => a.day.localeCompare(b.day));
    const age = p.age || (p.birthYear ? new Date().getFullYear() - p.birthYear : null);
    out.profile = { age, sex: p.sex, heightCm: p.heightCm, weightKg: ws.length ? ws[ws.length - 1].kg : null };
  } catch { /* skip */ }
  try {
    const t = await dayTarget(ctx, day);
    const entries = await getEntries(ctx.db, day);
    const daily = await ctx.db.get('daily', day).catch(() => null);
    out.today = { day, type: t.type, targets: { kcal: t.kcal, p: t.p, c: t.c, f: t.f }, intake: sumEntries(entries), waterMl: daily && daily.waterMl };
  } catch { /* skip */ }
  try {
    const ss = (await ctx.db.getAll('sessions')).filter((s) => s && s.day && s.status !== 'live' && !s.discarded && !s.seed).sort((a, b) => String(a.day).localeCompare(String(b.day)));
    if (ss.length) out.lastSession = ss[ss.length - 1];
  } catch { /* skip */ }
  return { ...out, ...extra };
}

// ───────── chat store ─────────
export async function loadChat(db) {
  try { return (await db.getAll('chat')).filter((m) => m && typeof m.content === 'string').sort((a, b) => String(a.at).localeCompare(String(b.at))); } catch { return []; }
}
export async function addChat(db, role, content, extra = {}) {
  const m = { id: newId('c'), role, content: String(content).slice(0, 8000), at: new Date().toISOString(), domain: 'coach', ...extra };
  try { await db.put('chat', m); } catch { /* shown anyway */ }
  return m;
}

// ───────── formatting ─────────
const dayFmt = new Intl.DateTimeFormat('ar-EG-u-nu-latn', { weekday: 'long', day: 'numeric', month: 'long' });
const shortFmt = new Intl.DateTimeFormat('ar-EG-u-nu-latn', { day: 'numeric', month: 'short' });
export const dayLabel = (key) => dayFmt.format(parseDayKey(key)).replace('،', '').replace('الاثنين', 'الاتنين');
export const shortDay = (key) => shortFmt.format(parseDayKey(key));
export function relDay(key, today) {
  if (key === today) return 'النهارده';
  if (key === addDays(today, -1)) return 'امبارح';
  return '';
}
export { DAY_TYPE_LABEL };

/** Downscale an image file to a JPEG data URL (≤ maxSide px) so it stays under the 5 MB API cap. */
export async function fileToJpeg(file, maxSide = 1280, quality = 0.85) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('img')); i.src = url; });
    const s = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.naturalWidth * s)); c.height = Math.max(1, Math.round(img.naturalHeight * s));
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', quality);
  } finally { URL.revokeObjectURL(url); }
}

// ───────── profile, weights, targets (WP-Nutrition) ─────────

export async function loadWeights(db) {
  try { return (await db.getAll('bodyweight')).filter((w) => w && isDayKey(w.day) && Number(w.kg) > 0).sort((a, b) => a.day.localeCompare(b.day)); } catch { return []; }
}

/** {kg, cm, age, sex, activity} — kg from the last weigh-in, activity from settings 'nu.activity' (default 1.55). */
export async function loadProfile(ctx) {
  let p = {};
  try { p = (await ctx.db.get('profile', 'me')) || {}; } catch { p = {}; }
  const ws = await loadWeights(ctx.db);
  const age = p.age || (p.birthYear ? new Date().getFullYear() - p.birthYear : null);
  const act = Number(ctx.settings.get('nu.activity')) || Number(p.activityFactor) || 1.55;
  return { kg: ws.length ? ws[ws.length - 1].kg : null, cm: p.heightCm || null, age, sex: p.sex || null, activity: act, lastWeighDay: ws.length ? ws[ws.length - 1].day : null, weights: ws };
}

export { loadTargets };

export async function saveTargets(ctx, targets) {
  await ctx.db.put('kv', { key: 'targets', value: targets });
  ctx.emit('settings:changed', { key: 'targets' });
  ctx.emit('food:changed', {});
}

/** Custom ranges from kv.nutrition.ranges applied to a day target. */
export async function rangesFor(db, t) { return macroRanges(t, (await kvGet(db, 'nutrition')).ranges || {}); }

/** Targets for many days at once (one read of targets / overrides / sessions). → Map(day → {type,kcal,p,c,f}) */
export async function dayTargetsBulk(ctx, days) {
  const o = await dayOpts(ctx.db, ctx.settings);
  const m = new Map();
  for (const d of days) m.set(d, tfd(d, o));
  return m;
}

/** All food log days in [from, to] → [{day, entries}] */
export async function logRange(db, from, to) {
  try { return (await db.getAll('foodLog')).filter((r) => r && isDayKey(r.day) && r.day >= from && r.day <= to && Array.isArray(r.entries)); } catch { return []; }
}

/** Estimated burn for a day type (TDEE), or null without weight/height. */
export const burnFor = (profile, type) => tdee(profile, profile.activity, type);
export const waterGoalFor = (profile, type, ctx) => {
  const custom = Number(ctx && ctx.settings.get('nu.waterGoalMl'));
  return custom >= 500 && custom <= 8000 ? custom : waterGoalMl(profile.kg, type);
};

// ───────── daily record (WP-Nutrition owns waterMl + supplements) ─────────
export async function dailyGet(db, day) { try { return (await db.get('daily', day)) || { day }; } catch { return { day }; } }
export async function dailyPatch(db, day, fn) {
  const cur = await dailyGet(db, day);
  const next = { ...fn({ ...cur }), day };
  await db.put('daily', next);
  return next;
}

export async function deleteFood(db, id) { await db.delete('foods', id); invalidateCatalog(); }

// ───────── AI availability + food lookup (through the coach api when it is implemented) ─────────
let coachMod;
export async function coachApi() {
  if (coachMod !== undefined) return coachMod;
  try { coachMod = await import('../coach/api.js'); } catch { coachMod = null; }
  return coachMod;
}
export const hasAIKey = (ctx) => !!String(ctx.settings.get('anthropicKey') || '').trim();
export const isOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false;

/** Ask the AI for one food's values → validated food (NOT saved). Throws AIError on API errors; null when unparsable. */
export async function foodFromAI(ctx, name) {
  const prompt = AI_FOOD_PROMPT(name);
  const api = await coachApi();
  if (api && typeof api.askCoach === 'function') {
    try { const r = await api.askCoach(ctx, { intent: 'food_lookup', prompt }); if (r && typeof r.text === 'string') return parseAIFood(r.text); }
    catch (e) { if (e instanceof AIError) throw e; /* stub / not implemented → local client */ }
  }
  const r = await aiClient(ctx).chat([{ role: 'user', content: prompt }], {});
  return parseAIFood(r.text);
}

/**
 * The one weight-based target suggestion for the ledger alert and the targets screen:
 * the parked custom-target suggestion from the v2 migration (kv nutrition.targetSuggestion) first, else the
 * lean-gain step (core gainSuggestion, re-entry aware). → null | {delta, title, reason, from?, to?, targets?, kind?}
 */
export async function weightSuggestion(ctx, profile, nkv, today) {
  const ts = nkv && nkv.targetSuggestion;
  if (ts && ts.targets && !ts.dismissed && !(nkv.adaptiveSnoozeUntil && today < nkv.adaptiveSnoozeUntil)) return { ...ts, kind: ts.kind || 'body' };
  const { gainSuggestion } = await import('../../core/targets.js');
  const re = ctx.settings.get('wk.reentry');
  return gainSuggestion(profile.weights, (nkv && nkv.adjustmentHistory) || [], { today, reentryStart: re && re.startDay ? re.startDay : null, snoozeUntil: (nkv && nkv.adaptiveSnoozeUntil) || null });
}

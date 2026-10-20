// Legacy → schema v1. Pure transform (migrateLegacy) + one-time boot runner (runMigrationOnce).
// Sources are UNTRUSTED raw localStorage strings. Read raw JSON (Solo Gym's loadD drops fields).
// Nothing is ever deleted: a redacted raw copy goes to meta.legacyRaw and the old keys stay in place.

import { emptyData, clone, isObj, num, str, redactRaw, DEFAULT_TRAINING_DAYS } from './schema.js';
import { dayKeyFromInstant, isDayKey } from './date.js';
import { safeParseJSON, readStorageKey, loadData, saveData } from './db.js';
import { mergeData } from './merge.js';

export const LEGACY_KEYS = Object.freeze({
  nutri: 'nutriProAI_v3',
  nutriGroqKey: 'nutripro_groq_key',      // obsolete (Groq removed) — read never, copied never
  gym: 'gymProAI_v12_fixed',
  gymLastBackup: 'soloGym_lastBackup',
  gymCollapsed: 'sgs_collapsed_cards',
});

// Fields consumed by the map below (anything else is reported as `unknown`, still safe in legacyRaw).
const NUTRI_MAPPED = ['foods', '_dbVersion', 'log', 'archive', 'water', 'weightLog', 'profile', 'goals', 'adjustmentHistory',
  'lastAdaptiveRun', 'dayTypes', 'savedMeals', 'recipes', 'favorites', 'templates', 'lastQty', 'photoHistory', 'notifications', 'waterGoal'];
const NUTRI_DROPPED = ['xp', 'achievements', 'personalRecords', 'claimedChallenges', 'freezes', 'frozenDays', 'lastActiveDay',
  'profiles', 'activeProfile', 'goalsInitialized', 'viewDate', '_voiceUsed', 'dietMode'];
const GYM_MAPPED = ['ses', 'days', 'activeProgram', 'schedule', 'currentSets', 'doneExs', 'completedDays', 'templates', 'goals', 'smartGoals',
  'rpeHistory', 'nextSessionPlan', 'poJournal', 'swapHistory', 'injuries', 'supplements', 'deloadStart', 'isDeloadWeek', '_deloadSuggested',
  '_lastDeloadNotif', 'homeMode', 'bw', 'measurements', 'profile', 'wellness', 'wellnessLog', 'recoveryLog', 'chatHistory', 'notifications',
  'sysSoundOff', 'pinnedNote', 'uiCollapsed', 'uiShowAllDays', 'uiWarmupCollapsed', 'uiStatusDefaultSet', 'uiCompact'];
const GYM_DROPPED = ['xp', 'xpLevel', 'lastRank', 'earnedBadges', 'unlockedTitles', 'activeTitle', 'activeStatTitle', 'clearedVolumeGates',
  'shadowArmy', 'jcCompleted', 'weeklyChallenge', 'dailyQuest', 'dailyQuestTemplate', 'penaltyActive', 'penaltyDate', 'penaltyGap',
  '_lastMilestone', '_setXPThisSession', 'streak', 'lastWo', 'sysLog', 'theme', '_themeManualOverride', 'aiKey', 'claudeKey'];

const DEFAULT_FOOD_ID = /^(df_)?f\d+$/;

function emptyReport() {
  return {
    ok: true,
    sources: { nutri: { present: false, parsed: false, error: null, bytes: 0 }, gym: { present: false, parsed: false, error: null, bytes: 0 } },
    counts: { meals: 0, foodDays: 0, sessions: 0, sets: 0, foods: 0, customFoods: 0, weights: 0, measurements: 0, savedMeals: 0, waterDays: 0, chatMessages: 0 },
    conflicts: [], notes: [], skipped: [], dropped: { nutri: [], gym: [] }, unknown: { nutri: [], gym: [] },
  };
}

function parseSource(name, raw, report) {
  const src = report.sources[name];
  if (raw === null || raw === undefined || raw === '') return null;
  src.present = true;
  src.bytes = String(raw).length;
  const p = safeParseJSON(raw);
  if (!p.ok) { src.error = `invalid_json: ${p.error}`; report.ok = false; return null; }
  if (!isObj(p.value)) { src.error = 'not_an_object'; report.ok = false; return null; }
  src.parsed = true;
  return p.value;
}

const macros = (e) => ({ kcal: num(e.cal ?? e.kcal, 0, 100000) ?? 0, p: num(e.pro ?? e.p, 0, 10000) ?? 0, c: num(e.carb ?? e.c, 0, 10000) ?? 0, f: num(e.fat ?? e.f, 0, 10000) ?? 0 });

/** Legacy NutriPro log/saved-meal item → v1 entry (no id). */
export function legacyEntry(e) {
  return { name: str(e.name, 120) || 'وجبة', qty: num(e.qty, 0, 100000), unit: str(e.unit, 20) || null, ...macros(e),
    section: str(e.section, 40) || null, time: str(e.time, 20) || null };
}

function mapNutri(d, data, report, opts) {
  const isDefault = opts.defaultFoodIds
    ? (id) => opts.defaultFoodIds.has(id) || (id.startsWith('df_') && opts.defaultFoodIds.has(id.slice(3)))
    : (id) => DEFAULT_FOOD_ID.test(id);

  if (isObj(d.foods)) {
    for (const [id, f] of Object.entries(d.foods)) {
      if (!isObj(f) || !str(f.name).trim()) { report.skipped.push({ source: 'nutri', what: 'food', id }); continue; }
      const src = isDefault(id) ? 'default' : 'custom';
      data.foods.push({ id: String(id), name: str(f.name, 120).trim(), ...macros(f), per: num(f.per, 0.001, 100000) ?? 100,
        unit: str(f.unit, 20) || 'جرام', cat: str(f.cat, 40) || null, src });
      report.counts.foods++;
      if (src === 'custom') report.counts.customFoods++;
    }
  }
  if (d._dbVersion !== undefined) data.nutrition.foodsDbVersion = d._dbVersion;

  if (isObj(d.log)) {
    let utc = 0;
    for (const [day, entries] of Object.entries(d.log)) {
      if (!isDayKey(day) || !Array.isArray(entries)) { report.skipped.push({ source: 'nutri', what: 'log day', id: day }); continue; }
      const out = [];
      entries.forEach((e, i) => {
        if (!isObj(e)) { report.skipped.push({ source: 'nutri', what: 'meal', id: `${day}#${i}` }); return; }
        out.push({ id: `n:${day}:${i}`, ...legacyEntry(e), src: 'nutri' });
      });
      if (out.length) { data.foodLog[day] = out; report.counts.foodDays++; report.counts.meals += out.length; utc++; }
    }
    if (utc) report.notes.push(`NutriPro day keys (${utc} days) were UTC dates; kept as-is (meals logged 00:00-03:59 UAE may sit on the previous day; not recoverable).`);
  }
  if (isObj(d.archive)) data.nutrition.archive = clone(d.archive);

  if (isObj(d.water)) {
    for (const [day, cups] of Object.entries(d.water)) {
      const c = num(cups, 0, 100);
      if (!isDayKey(day) || c === null) continue;
      data.daily[day] = { ...(data.daily[day] || {}), waterMl: Math.round(c * 250) };
    }
  }
  if (isObj(d.weightLog)) {
    for (const [day, kg] of Object.entries(d.weightLog)) {
      const w = num(kg, 20, 400);
      if (!isDayKey(day) || w === null) { report.skipped.push({ source: 'nutri', what: 'weight', id: day }); continue; }
      data.bodyweight.push({ day, kg: w, src: 'nutri', at: null });
    }
  }
  if (isObj(d.profile)) {
    const p = d.profile;
    data.profile._nutri = { age: num(p.age, 10, 100), heightCm: num(p.height, 100, 250), sex: ['male', 'female'].includes(p.gender) ? p.gender : null,
      activityFactor: num(p.activityFactor, 1, 2.5), weightKg: num(p.weight, 20, 400) };
  }
  if (d.goals !== undefined) data.nutrition.legacyGoals = clone(d.goals); // A's "today" goals; targets now come from defaults/engine
  if (Array.isArray(d.adjustmentHistory) || d.lastAdaptiveRun !== undefined) {
    data.nutrition.adaptive = { history: clone(d.adjustmentHistory || []), lastRun: d.lastAdaptiveRun ?? null };
  }
  if (isObj(d.dayTypes)) {
    data.nutrition.dayTypeOverrides = {};
    for (const [day, t] of Object.entries(d.dayTypes)) if (isDayKey(day) && (t === 'training' || t === 'rest')) data.nutrition.dayTypeOverrides[day] = t;
  }
  if (isObj(d.savedMeals)) {
    data.nutrition.savedMeals = {};
    for (const [id, m] of Object.entries(d.savedMeals)) {
      if (!isObj(m)) continue;
      data.nutrition.savedMeals[id] = { name: str(m.name, 120), section: str(m.section, 40) || null, savedAt: m.savedAt ?? null,
        items: Array.isArray(m.items) ? m.items.filter(isObj).map(legacyEntry) : [] };
      report.counts.savedMeals++;
    }
  }
  if (isObj(d.templates)) {
    data.nutrition.templates = {};
    for (const [id, t] of Object.entries(d.templates)) {
      if (!isObj(t)) continue;
      data.nutrition.templates[id] = { name: str(t.name, 120), createdAt: t.createdAt ?? null, meals: Array.isArray(t.meals) ? t.meals.filter(isObj).map(legacyEntry) : [] };
    }
  }
  for (const k of ['recipes', 'favorites', 'lastQty', 'photoHistory']) if (d[k] !== undefined) data.nutrition[k] = clone(d[k]);
  if (isObj(d.notifications)) {
    const { water, ...meals } = d.notifications;
    data.settings.notifications.meals = clone(meals);
    if (water !== undefined) data.settings.notifications.water = clone(water);
  }
  const wg = num(d.waterGoal, 1, 40);
  if (wg !== null) data.settings.waterGoalCups = wg;

  report.dropped.nutri = NUTRI_DROPPED.filter((k) => k in d);
  report.unknown.nutri = Object.keys(d).filter((k) => !NUTRI_MAPPED.includes(k) && !NUTRI_DROPPED.includes(k));
}

function mapSession(s, i, usedIds) {
  let id = `g:${s.id ?? `idx${i}`}`;
  while (usedIds.has(id)) id += '_';
  usedIds.add(id);
  const exercises = [];
  let sets = 0;
  if (isObj(s.exs)) {
    for (const [exId, e] of Object.entries(s.exs)) {
      if (!isObj(e)) continue;
      const ss = Array.isArray(e.sets) ? e.sets.filter(isObj).map((t) => ({ w: num(t.w, 0, 2000) ?? 0, r: num(t.r, 0, 1000) ?? 0,
        rpe: num(t.rpe, 0, 10), done: !!t.done })) : [];
      sets += ss.filter((t) => t.w > 0 || t.r > 0).length;
      exercises.push({ exId: String(exId), name: str(e.name, 160), muscle: str(e.muscle, 60) || null, sets: ss,
        topW: num(e.w, 0, 2000), vol: num(e.vol, 0, 1e7), avgRPE: num(e.avgRPE, 0, 10) });
    }
  }
  return {
    session: { id, day: dayKeyFromInstant(s.date), startedAt: typeof s.date === 'string' ? s.date : null, dayKey: s.dk ?? null,
      dayName: str(s.dn, 120) || null, durationMin: num(s.duration, 0, 1440), mood: s.mood ?? null, note: str(s.note, 2000) || null,
      fatigueScore: num(s.fatigueScore, 0, 1000), legacyDs: str(s.ds, 60) || null, exercises },
    sets,
  };
}

function mapGym(d, data, report, extras) {
  if (Array.isArray(d.ses)) {
    const used = new Set();
    d.ses.forEach((s, i) => {
      if (!isObj(s)) { report.skipped.push({ source: 'gym', what: 'session', id: i }); return; }
      const { session, sets } = mapSession(s, i, used);
      if (!session.day) report.notes.push(`Session ${session.id} has no valid date; kept without a day.`);
      data.sessions.push(session);
      report.counts.sessions++;
      report.counts.sets += sets;
    });
  }
  data.programs = { activeProgram: d.activeProgram ?? null, days: isObj(d.days) ? clone(d.days) : null, schedule: d.schedule ? clone(d.schedule) : null };
  if (isObj(d.schedule)) {
    const train = [0, 1, 2, 3, 4, 5, 6].filter((i) => isObj(d.schedule[i]) && d.schedule[i].type === 'train');
    const valid = [0, 1, 2, 3, 4, 5, 6].every((i) => isObj(d.schedule[i]) && typeof d.schedule[i].type === 'string');
    if (valid) data.settings.trainingDays = train;
    else report.notes.push('Solo Gym schedule incomplete; default training days kept.');
  }
  for (const k of ['currentSets', 'doneExs', 'completedDays', 'templates', 'goals', 'smartGoals', 'rpeHistory', 'nextSessionPlan',
    'poJournal', 'swapHistory', 'injuries', 'supplements']) if (d[k] !== undefined) data.training[k] = clone(d[k]);
  if (d.homeMode !== undefined) data.training.homeMode = !!d.homeMode;
  if (['deloadStart', 'isDeloadWeek', '_deloadSuggested', '_lastDeloadNotif'].some((k) => d[k] !== undefined)) {
    data.training.deload = { active: !!d.isDeloadWeek, start: d.deloadStart ?? null, suggested: d._deloadSuggested ?? null, lastNotif: d._lastDeloadNotif ?? null };
  }

  if (Array.isArray(d.bw)) {
    for (const b of d.bw) {
      const kg = num(b && b.w, 20, 400);
      const day = b && dayKeyFromInstant(b.date);
      if (kg === null || !day) { report.skipped.push({ source: 'gym', what: 'weight', id: b && b.date }); continue; }
      extras.gymWeights.push({ day, kg, src: 'gym', at: typeof b.date === 'string' ? b.date : new Date(b.date).toISOString() });
    }
  }
  if (Array.isArray(d.measurements)) {
    d.measurements.forEach((m, i) => {
      if (!isObj(m)) return;
      const out = { id: `g:m:${m.date ?? i}`, day: dayKeyFromInstant(m.date), at: m.date ?? null };
      for (const k of ['chest', 'waist', 'arm', 'thigh', 'shoulder', 'calf', 'neck', 'hips', 'bodyFat']) { const v = num(m[k], 0, 500); if (v !== null) out[k] = v; }
      data.measurements.push(out);
      report.counts.measurements++;
    });
  }
  if (isObj(d.profile)) {
    data.profile._gym = { age: num(d.profile.age, 10, 100) };
    const droppedProfile = ['name', 'job', 'location', 'nationality'].filter((k) => d.profile[k]);
    if (droppedProfile.length) report.notes.push(`Profile fields not carried over for privacy (kept only in legacy raw copy): ${droppedProfile.join(', ')}.`);
  }
  if (isObj(d.wellness)) {
    let n = 0;
    for (const [day, w] of Object.entries(d.wellness)) {
      if (!isDayKey(day) || !isObj(w)) continue;
      const cur = data.daily[day] || {};
      const well = {};
      for (const k of ['sleep', 'energy', 'stress']) { const v = num(w[k], 0, 24); if (v !== null) well[k] = v; }
      const next = { ...cur };
      if (Object.keys(well).length) next.wellness = well;
      const L = num(w.water, 0, 20);
      if (L !== null) next.waterMl = Math.max(cur.waterMl || 0, Math.round(L * 1000));
      data.daily[day] = next; n++;
    }
    if (n) report.notes.push(`Solo Gym wellness day keys (${n} days) were UTC dates; kept as-is.`);
  }
  if (Array.isArray(d.wellnessLog)) data.wellness.log = clone(d.wellnessLog);
  if (Array.isArray(d.recoveryLog)) data.wellness.recoveryLog = clone(d.recoveryLog);
  if (Array.isArray(d.chatHistory)) {
    d.chatHistory.forEach((m, i) => {
      if (!isObj(m) || typeof m.content !== 'string') return;
      data.chat.push({ id: `g:c:${String(i).padStart(5, '0')}`, role: m.role === 'user' ? 'user' : 'assistant', content: str(m.content, 20000), at: null, domain: 'training' });
      report.counts.chatMessages++;
    });
  }
  if (d.notifications !== undefined) data.settings.notifications.workout = !!d.notifications;
  if (d.sysSoundOff !== undefined) data.settings.soundOff = !!d.sysSoundOff;
  if (typeof d.pinnedNote === 'string') data.settings.pinnedNote = str(d.pinnedNote, 2000);
  for (const k of ['uiCollapsed', 'uiShowAllDays', 'uiWarmupCollapsed', 'uiStatusDefaultSet', 'uiCompact']) {
    if (d[k] !== undefined) data.settings.ui[k.replace(/^ui/, '').replace(/^./, (c) => c.toLowerCase())] = clone(d[k]);
  }
  report.dropped.gym = GYM_DROPPED.filter((k) => k in d);
  report.unknown.gym = Object.keys(d).filter((k) => !GYM_MAPPED.includes(k) && !GYM_DROPPED.includes(k));
}

function resolveProfile(data, report, now) {
  const n = data.profile._nutri || {};
  const g = data.profile._gym || {};
  delete data.profile._nutri; delete data.profile._gym;
  let age = n.age ?? g.age ?? null;
  if (n.age != null && g.age != null && n.age !== g.age) {
    report.conflicts.push({ field: 'age', nutri: n.age, gym: g.age, chosen: n.age, reason: 'NutriPro value is user-entered; confirm on the migration screen' });
  }
  Object.assign(data.profile, {
    age, birthYear: age != null ? now.getFullYear() - age : null,
    sex: n.sex ?? null, heightCm: n.heightCm ?? null, activityFactor: n.activityFactor ?? null,
  });
  if (n.weightKg != null) data.profile.lastKnownWeightKg = n.weightKg;
}

/**
 * migrateLegacy({nutri, gym}) → {data, report}
 * nutri / gym: raw localStorage strings (or null). Never throws for bad input.
 * opts.now (Date) for deterministic tests; opts.defaultFoodIds (Set) to tell custom foods from defaults.
 * extra raw keys (opts.gymLastBackup, opts.gymCollapsed) are optional.
 */
export function migrateLegacy({ nutri = null, gym = null, gymLastBackup = null, gymCollapsed = null } = {}, opts = {}) {
  const now = opts.now || new Date();
  const data = emptyData(now);
  const report = emptyReport();
  const extras = { gymWeights: [] };

  // 1) raw copies first (redacted of obsolete API keys), even when the JSON is corrupt
  if (nutri) data.meta.legacyRaw[LEGACY_KEYS.nutri] = redactRaw(String(nutri));
  if (gym) data.meta.legacyRaw[LEGACY_KEYS.gym] = redactRaw(String(gym));
  if (gymLastBackup) data.meta.legacyRaw[LEGACY_KEYS.gymLastBackup] = String(gymLastBackup);
  if (gymCollapsed) data.meta.legacyRaw[LEGACY_KEYS.gymCollapsed] = String(gymCollapsed);

  const dn = parseSource('nutri', nutri, report);
  const dg = parseSource('gym', gym, report);
  if (dn) { mapNutri(dn, data, report, opts); data.meta.migratedFrom.nutri = LEGACY_KEYS.nutri; }
  if (dg) { mapGym(dg, data, report, extras); data.meta.migratedFrom.gym = LEGACY_KEYS.gym; }
  resolveProfile(data, report, now);

  // weights: one per day. Gym entries carry a timestamp → latest gym entry of the day wins over NutriPro.
  const byDay = new Map(data.bodyweight.map((w) => [w.day, w]));
  for (const w of extras.gymWeights) {
    const cur = byDay.get(w.day);
    if (!cur || cur.src === 'nutri' || (cur.at && w.at > cur.at)) byDay.set(w.day, w);
  }
  data.bodyweight = [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
  report.counts.weights = data.bodyweight.length;
  report.counts.waterDays = Object.values(data.daily).filter((v) => v.waterMl > 0).length;

  if (gymLastBackup) { const t = num(Number(gymLastBackup), 0, 1e14); if (t) data.meta.legacyLastBackupAt = new Date(t).toISOString(); }
  if (gymCollapsed) { const p = safeParseJSON(gymCollapsed); if (p.ok) data.settings.ui.collapsedCards = p.value; }

  for (const s of ['nutri', 'gym']) if (report.sources[s].error) data.meta.issues.push({ at: now.toISOString(), source: s, error: report.sources[s].error });
  return { data, report };
}

/**
 * Boot-time runner. Reads legacy localStorage keys (never deletes them), migrates, MERGES into what the DB already
 * holds, and sets meta.migratedAt. Corrupt sources are reported (raw copy kept), the readable source still migrates.
 * Returns {status:'already'|'none'|'migrated'|'partial'|'error', report?, error?}
 */
export async function runMigrationOnce(storage, db, opts = {}) {
  const now = opts.now || new Date();
  let existing;
  try { existing = await loadData(db); }
  catch (e) { return { status: 'error', error: e.code || e.message }; }
  if (existing.data.meta.migratedAt) return { status: 'already' };

  const read = (k) => readStorageKey(storage, k);
  const raws = { nutri: read(LEGACY_KEYS.nutri), gym: read(LEGACY_KEYS.gym), gymLastBackup: read(LEGACY_KEYS.gymLastBackup), gymCollapsed: read(LEGACY_KEYS.gymCollapsed) };
  const input = Object.fromEntries(Object.entries(raws).map(([k, v]) => [k, v.raw]));
  const readErrors = Object.entries(raws).filter(([, v]) => v.error).map(([k, v]) => ({ key: k, error: v.error }));

  const { data, report } = migrateLegacy(input, { ...opts, now });
  report.readErrors = readErrors;
  const anyPresent = report.sources.nutri.present || report.sources.gym.present;
  const { data: merged } = mergeData(existing.empty ? null : existing.data, data);
  merged.meta.migratedAt = now.toISOString();
  if (!anyPresent) merged.meta.migratedFrom = { nutri: null, gym: null };
  try {
    // legacy raw copy is in merged.meta.legacyRaw → written in the same atomic batch as the data
    await saveData(db, merged);
  } catch (e) {
    return { status: 'error', error: e.code || e.message, report };
  }
  if (!anyPresent) return { status: 'none', report };
  return { status: report.ok ? 'migrated' : 'partial', report };
}

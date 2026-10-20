// Non-destructive merge of two schema-v1 data objects (existing ← incoming).
// Rule: nothing that exists is deleted or blanked. Same id/day → existing record kept,
// except where the incoming one is provably newer (bodyweight `at`) or only fills gaps.

import { clone, isObj, emptyData } from './schema.js';

const blank = (v) => v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0) || (isObj(v) && Object.keys(v).length === 0);

/** Fill only the missing/blank fields of `a` from `b` (shallow). */
function fillGaps(a, b) {
  const out = { ...(a || {}) };
  for (const [k, v] of Object.entries(b || {})) if (blank(out[k]) && !blank(v)) out[k] = clone(v);
  return out;
}

/** Deep fill: objects are merged recursively, existing scalars/arrays win. */
function deepFill(a, b) {
  if (!isObj(a)) return blank(a) ? clone(b) : a;
  const out = { ...a };
  for (const [k, v] of Object.entries(b || {})) {
    if (isObj(out[k]) && isObj(v)) out[k] = deepFill(out[k], v);
    else if (blank(out[k]) && !blank(v)) out[k] = clone(v);
  }
  return out;
}

/** Union of two arrays of plain values/objects, de-duplicated by JSON identity, order kept. */
function unionJSON(x = [], y = []) {
  const seen = new Set((x || []).map((v) => JSON.stringify(v)));
  const out = [...(x || [])];
  for (const v of y || []) { const k = JSON.stringify(v); if (!seen.has(k)) { seen.add(k); out.push(clone(v)); } }
  return out;
}

function byId(existing, incoming, key, stats, name) {
  const map = new Map((existing || []).map((r) => [r[key], r]));
  for (const r of incoming || []) {
    if (!r || r[key] === undefined || r[key] === null) { stats.skipped[name] = (stats.skipped[name] || 0) + 1; continue; }
    if (map.has(r[key])) stats.duplicates[name] = (stats.duplicates[name] || 0) + 1;
    else { map.set(r[key], clone(r)); stats.added[name] = (stats.added[name] || 0) + 1; }
  }
  return [...map.values()];
}

/**
 * merge(existing, incoming) → {data, stats}
 * stats = {added:{collection:n}, duplicates:{...}, updated:{...}, skipped:{...}}
 */
export function mergeData(existing, incoming) {
  const b = incoming || {};
  let a;
  if (existing) a = clone(existing);
  else {
    // empty target: singleton sections come from incoming as-is (defaults must not block them);
    // collections start empty so the stats below count everything as "added".
    a = emptyData();
    for (const k of ['meta', 'settings', 'profile', 'targets', 'programs', 'training', 'nutrition', 'wellness']) if (b[k] !== undefined) a[k] = clone(b[k]);
  }
  const stats = { added: {}, duplicates: {}, updated: {}, skipped: {} };
  const inc = (o, k, n = 1) => { o[k] = (o[k] || 0) + n; };

  // meta: keep existing identity; union legacy raw copies and issues
  a.meta = { ...a.meta };
  a.meta.legacyRaw = { ...(b.meta && b.meta.legacyRaw), ...(a.meta.legacyRaw || {}) };
  a.meta.issues = unionJSON(a.meta.issues, b.meta && b.meta.issues);
  if (b.meta) {
    a.meta.migratedFrom = fillGaps(a.meta.migratedFrom, b.meta.migratedFrom);
    if (!a.meta.legacyLastBackupAt && b.meta.legacyLastBackupAt) a.meta.legacyLastBackupAt = b.meta.legacyLastBackupAt;
  }

  a.settings = deepFill(a.settings, b.settings);
  a.profile = fillGaps(a.profile, b.profile);
  // targets: user-edited existing targets win; defaults are replaced by incoming non-default ones
  if (b.targets && (a.targets?.isDefault !== false) && b.targets.isDefault === false) { a.targets = clone(b.targets); inc(stats.updated, 'targets'); }
  a.programs = (a.programs && a.programs.days) ? a.programs : (b.programs ? clone(b.programs) : a.programs);
  a.training = deepFill(a.training, b.training);
  a.nutrition = deepFill(a.nutrition, b.nutrition);
  a.wellness = {
    ...(a.wellness || {}),
    log: unionJSON(a.wellness?.log, b.wellness?.log),
    recoveryLog: unionJSON(a.wellness?.recoveryLog, b.wellness?.recoveryLog),
  };

  a.foods = byId(a.foods, b.foods, 'id', stats, 'foods');
  a.sessions = byId(a.sessions, b.sessions, 'id', stats, 'sessions');
  a.measurements = byId(a.measurements, b.measurements, 'id', stats, 'measurements');
  a.chat = byId(a.chat, b.chat, 'id', stats, 'chat');

  // food log: per day, union of entries by entry id
  a.foodLog = { ...(a.foodLog || {}) };
  for (const [day, entries] of Object.entries(b.foodLog || {})) {
    const cur = a.foodLog[day] ? [...a.foodLog[day]] : [];
    const ids = new Set(cur.map((e) => e.id));
    for (const e of entries || []) {
      if (!e || !e.id) { inc(stats.skipped, 'meals'); continue; }
      if (ids.has(e.id)) { inc(stats.duplicates, 'meals'); continue; }
      cur.push(clone(e)); ids.add(e.id); inc(stats.added, 'meals');
    }
    if (!a.foodLog[day] && cur.length) inc(stats.added, 'foodDays');
    a.foodLog[day] = cur;
  }

  // body weight: one per day; incoming wins only if it has a newer timestamp
  const bw = new Map((a.bodyweight || []).map((w) => [w.day, w]));
  for (const w of b.bodyweight || []) {
    if (!w || !w.day) { inc(stats.skipped, 'weights'); continue; }
    const cur = bw.get(w.day);
    if (!cur) { bw.set(w.day, clone(w)); inc(stats.added, 'weights'); }
    else if (w.at && (!cur.at || w.at > cur.at)) { bw.set(w.day, clone(w)); inc(stats.updated, 'weights'); }
    else inc(stats.duplicates, 'weights');
  }
  a.bodyweight = [...bw.values()].sort((x, y) => x.day.localeCompare(y.day));

  // daily: water = max, wellness = existing or incoming
  a.daily = { ...(a.daily || {}) };
  for (const [day, v] of Object.entries(b.daily || {})) {
    const cur = a.daily[day] || {};
    const next = { ...cur };
    if (typeof v.waterMl === 'number' && !(cur.waterMl >= v.waterMl)) next.waterMl = v.waterMl;
    if (v.wellness && !cur.wellness) next.wellness = clone(v.wellness);
    if (v.dayType && !cur.dayType) next.dayType = v.dayType;
    if (!a.daily[day]) inc(stats.added, 'daily'); else if (JSON.stringify(next) !== JSON.stringify(cur)) inc(stats.updated, 'daily');
    a.daily[day] = next;
  }
  return { data: a, stats };
}

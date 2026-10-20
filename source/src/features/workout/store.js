// Persistence for the workout feature (via ctx.db; never touches localStorage).
// sessions store: finished sessions + at most one running session {status:'active'} (read by Today).
// programs store 'current': {key:'current', v:2, activeProgram, order, days, legacy?}
// kv 'training': {..legacy Solo Gym fields, deload:{active,start,dismissed}}
import { normalizeProgram, isActive, finished } from './logic.js';

export async function loadSessions(db) {
  try { return (await db.getAll('sessions')).filter((s) => s && typeof s === 'object'); }
  catch (e) { console.warn('[workout] sessions read failed', e && e.code); return []; }
}

export async function loadAll(db) {
  const all = await loadSessions(db);
  const live = all.filter(isActive).sort((a, b) => (b.startedMs || 0) - (a.startedMs || 0))[0] || null;
  return { all, live, done: finished(all) };
}

export async function loadProgram(db) {
  let rec = null;
  try { rec = await db.get('programs', 'current'); } catch { /* defaults */ }
  return { program: normalizeProgram(rec), rec };
}

export async function saveProgram(db, program, prevRec) {
  const value = { key: 'current', v: 2, activeProgram: program.activeProgram, order: program.order, days: program.days };
  if (program.schedule && Object.keys(program.schedule).length) value.schedule = program.schedule;
  if (program.startDay) value.startDay = program.startDay;
  // «برنامجي القديم»: the plan the user had before switching to the new default (null clears it)
  if (program.previous !== undefined) { if (program.previous) value.previous = program.previous; }
  else if (prevRec && prevRec.previous) value.previous = prevRec.previous;
  // keep the migrated Solo Gym plan once, so nothing the user had is lost
  if (prevRec && prevRec.v !== 2 && prevRec.days) value.legacy = { activeProgram: prevRec.activeProgram ?? null, days: prevRec.days, schedule: prevRec.schedule ?? null };
  else if (prevRec && prevRec.legacy) value.legacy = prevRec.legacy;
  await db.put('programs', value);
  return value;
}

export async function loadTraining(db) {
  try { const r = await db.get('kv', 'training'); return (r && r.value && typeof r.value === 'object') ? r.value : {}; }
  catch { return {}; }
}

export async function patchTraining(db, patch) {
  const cur = await loadTraining(db);
  const value = { ...cur, ...patch };
  await db.put('kv', { key: 'training', value });
  return value;
}

export const putSession = (db, s) => db.put('sessions', s);

/** Context for prescribe() gates: today's readiness (daily store) and the body-weight drop (bodyweight store). */
export async function loadGateInputs(db, today) {
  let daily = null, bw = [];
  try { daily = await db.get('daily', today); } catch { /* none */ }
  try { bw = (await db.getAll('bodyweight')).map((r) => ({ day: r.day, kg: +r.kg || +r.w || 0 })); } catch { /* none */ }
  return { daily, bw };
}
export const deleteSession = (db, id) => db.delete('sessions', id);

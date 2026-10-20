// Day facts shared by the shell: day type + targets for a day key, sessions per day, meal slots.
import { targetsForDay, withDayTypes, heartDowOf, heartDaysOf } from '../core/targets.js';

// Meal slots / sections live in features/nutrition/logic.js (SECTIONS, sectionOf) — single source.
export const DAY_TYPE_LABEL = { training: 'يوم تمرين', rest: 'يوم راحة', heart: 'يوم القلب' };

/** Session state as Today reads it: 'active' | 'done'. Contract with B: status:'active' while running. */
export function sessionState(s) {
  if (!s) return null;
  if (s.status === 'active' || s.status === 'running') return 'active';
  return 'done';
}

async function kv(db, key) {
  try { const r = await db.get('kv', key); return r ? r.value : undefined; } catch { return undefined; }
}

export async function loadTargets(db) {
  return withDayTypes(await kv(db, 'targets'));
}

const liftDays = (sessions) => new Set(sessions.filter((s) => s && s.day && s.kind !== 'recovery' && s.kind !== 'heart' && s.mode !== 'iso' && sessionState(s) === 'done').map((s) => s.day));
async function allSessions(db) { try { return (await db.getAll('sessions')) || []; } catch { return []; } }

export async function sessionDays(db) { return liftDays(await allSessions(db)); }

/**
 * Everything dayType() needs, in one read: {targets, trainingDays, overrides, sessionDays, heartDays, heartDow}.
 * Spread it into targetsForDay(day, opts) — Nutrition, Today, Progress and the coach all use this same source.
 */
export async function dayOpts(db, settings) {
  const [targets, nutrition, sessions, prog] = await Promise.all([loadTargets(db), kv(db, 'nutrition'), allSessions(db),
    (async () => { try { return await db.get('programs', 'current'); } catch { return null; } })()]);
  return { targets, trainingDays: settings ? settings.get('trainingDays') : undefined, overrides: (nutrition && nutrition.dayTypeOverrides) || {},
    sessionDays: liftDays(sessions), heartDays: heartDaysOf(sessions), heartDow: heartDowOf(prog) };
}

/** dayInfo(db, day, settings) → {day, type, target:{kcal,p,c,f}, overridden} */
export async function dayInfo(db, day, settings) {
  const o = await dayOpts(db, settings);
  const overrides = o.overrides;
  const t = targetsForDay(day, o);
  return { day, type: t.type, target: { kcal: t.kcal, p: t.p, c: t.c, f: t.f }, overridden: !!overrides[day] };
}

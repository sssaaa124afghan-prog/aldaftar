// Pure: hard sets per muscle over the last 7 days (the exercise's own «muscle» label). Unit-tested.
import { addDays } from '../../core/date.js';

/** A full week's work for one muscle (sets): the map is fully lit from here. */
export const FULL_SETS = 12;

/** muscleSets(sessions, today) → {[muscle]: sets} for done lifting sessions in the last 7 days (today included). */
export function muscleSets(sessions, today) {
  const from = addDays(today, -6);
  const out = {};
  for (const s of Array.isArray(sessions) ? sessions : []) {
    if (!s || s.status !== 'done' || s.kind === 'boxing' || !s.day || s.day < from || s.day > today) continue;
    for (const e of Array.isArray(s.exercises) ? s.exercises : []) {
      if (!e || e.skipped || !e.muscle) continue;
      const n = (Array.isArray(e.sets) ? e.sets : []).filter((t) => t && t.done && !t.warm).length;
      if (n) out[e.muscle] = (out[e.muscle] || 0) + n;
    }
  }
  return out;
}

/** 0..1 light level for a muscle. */
export const level = (sets) => Math.max(0, Math.min(1, (Number(sets) || 0) / FULL_SETS));

/** Muscles sorted by sets (most first) + the ones on the map that got nothing this week. */
export function muscleRank(sets, all) {
  const done = Object.entries(sets).sort((a, b) => b[1] - a[1]).map(([m, n]) => ({ m, n }));
  const missed = all.filter((m) => !sets[m]);
  return { done, missed };
}

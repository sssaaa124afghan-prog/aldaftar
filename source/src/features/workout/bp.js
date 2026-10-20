// Home blood-pressure gate (review M8), pure and node-safe. Used by heart.js (Heart Day screen) and Today.
import { diffDays } from '../../core/date.js';

/** Latest BP reading from the log (by `at`). */
export function latestBP(log) {
  return (log || []).filter((r) => r && Number.isFinite(+r.sys) && Number.isFinite(+r.dia)).sort((a, b) => String(b.at).localeCompare(String(a.at)))[0] || null;
}
/**
 * BP gate before isometrics AND intervals (review M8). Only readings from a validated upper-arm cuff count.
 * → {state, days, need, avg, last} with state:
 *   'stop'     latest reading > 180/110: no exercise today
 *   'block'    any reading ≥ 160/100: locked, see a doctor
 *   'baseline' fewer than 3 days with ≥ 2 readings: walking + Zone 2 until the baseline exists
 *   'gp'       average 140–159 / 90–99: book a GP, walking + Zone 2 only
 *   'ok'       average < 140/90 and no reading ≥ 160/100
 */
export function bpGate(log, today, { windowDays = 30 } = {}) {
  const rows = (log || []).filter((r) => r && r.cuff === 'arm' && Number.isFinite(+r.sys) && Number.isFinite(+r.dia) && r.day
    && (!today || (() => { try { const d = diffDays(r.day, today); return d >= 0 && d < windowDays; } catch { return false; } })()));
  const last = latestBP(rows);
  const perDay = new Map(); for (const r of rows) perDay.set(r.day, (perDay.get(r.day) || 0) + 1);
  const days = [...perDay.values()].filter((n) => n >= 2).length;
  const avg = rows.length ? { sys: Math.round(rows.reduce((a, r) => a + +r.sys, 0) / rows.length), dia: Math.round(rows.reduce((a, r) => a + +r.dia, 0) / rows.length) } : null;
  const base = { days, need: 3, avg, last, n: rows.length };
  if (last && (+last.sys > 180 || +last.dia > 110)) return { ...base, state: 'stop' };
  if (rows.some((r) => +r.sys >= 160 || +r.dia >= 100)) return { ...base, state: 'block' };
  if (days < 3) return { ...base, state: 'baseline' };
  if (avg.sys >= 140 || avg.dia >= 90) return { ...base, state: 'gp' };
  return { ...base, state: 'ok' };
}

// Pure: cleans what the shortcut sends (units vary by iOS language / Shortcuts version).
const fin = (x) => (Number.isFinite(+x) ? +x : null);

/** Sleep may arrive in hours, minutes or seconds → hours. */
export function sleepHours(v) {
  const n = fin(v);
  if (n === null || n <= 0) return null;
  const h = n > 2000 ? n / 3600 : n > 24 ? n / 60 : n;
  return h > 0 && h <= 24 ? Math.round(h * 10) / 10 : null;
}

export function normalizeHealth(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const bpm = (x) => { const n = fin(x); return n && n >= 25 && n <= 240 ? Math.round(n) : null; };
  const out = {
    at: fin(raw.at) || Date.now(),
    steps: fin(raw.steps) !== null && raw.steps >= 0 && raw.steps < 200000 ? Math.round(raw.steps) : null,
    activeKcal: fin(raw.kcal) !== null && raw.kcal >= 0 && raw.kcal < 20000 ? Math.round(raw.kcal) : null,
    restingHr: bpm(raw.rhr),
    hr: bpm(raw.hr),
    hrAvg: bpm(raw.hravg),
    hrMax: bpm(raw.hrmax),
    sleepH: sleepHours(raw.sleep),
  };
  return Object.values(out).filter((v) => v !== null).length > 1 ? out : null;
}

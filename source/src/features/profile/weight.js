// Body-weight entry sheet (used by Today and Profile). One record per day in 'bodyweight' (keyPath day).
import { h } from '../../ui/dom.js';
import { fmt, parseNum } from '../../ui/num.js';

export const KG_MIN = 25; export const KG_MAX = 300;

export async function latestWeight(db) {
  try { const all = await db.getAll('bodyweight'); all.sort((a, b) => a.day.localeCompare(b.day)); return all[all.length - 1] || null; }
  catch { return null; }
}

export function validKg(v) {
  const n = parseNum(v);
  if (!Number.isFinite(n)) return { ok: false, message: 'اكتب الوزن رقم، مثلاً 78.4' };
  if (n < KG_MIN || n > KG_MAX) return { ok: false, message: `الوزن لازم يكون بين ${KG_MIN} و ${KG_MAX} كجم` };
  return { ok: true, kg: Math.round(n * 10) / 10 };
}

/** Saves {day,kg,src:'manual',at}; toast with Undo; emits weight:changed. */
export async function saveWeight(ctx, kg, day = ctx.today()) {
  const db = ctx.db;
  const prev = await db.get('bodyweight', day).catch(() => undefined);
  await db.put('bodyweight', { ...(prev || {}), day, kg, src: 'manual', at: new Date().toISOString() });
  ctx.emit('weight:changed', { day, kg });
  ctx.toast(`اتسجل الوزن ${fmt(kg, { dp: 1 })} كجم`, { action: { label: 'تراجع', run: async () => {
    if (prev) await db.put('bodyweight', prev); else await db.delete('bodyweight', day);
    ctx.emit('weight:changed', { day });
  } } });
}

export async function openWeightSheet(ctx) {
  const last = await latestWeight(ctx.db);
  const input = h('input', { id: 'wkg', type: 'text', inputmode: 'decimal', autocomplete: 'off', class: 'num', value: last ? String(last.kg) : '', 'aria-describedby': 'wkg-hint' });
  const err = h('p', { class: 'err', id: 'wkg-err', 'aria-live': 'polite' });
  const hint = h('p', { class: 'hint', id: 'wkg-hint' }, last ? `آخر وزن ${fmt(last.kg, { dp: 1 })} كجم` : 'بالكيلو، على الريق لو تقدر');
  input.addEventListener('input', () => { err.textContent = ''; input.removeAttribute('aria-invalid'); });
  input.addEventListener('blur', () => { if (input.value && !validKg(input.value).ok) { err.textContent = validKg(input.value).message; input.setAttribute('aria-invalid', 'true'); } });
  const body = h('div', {}, h('div', { class: 'field' }, h('label', { for: 'wkg' }, 'الوزن النهارده (كجم)'), input, hint, err));
  const s = ctx.sheet({ title: 'سجّل الوزن', body, actions: [{ label: 'احفظ الوزن', run: async () => {
    const v = validKg(input.value);
    if (!v.ok) { err.textContent = v.message; input.setAttribute('aria-invalid', 'true'); input.focus(); return true; }
    try { await saveWeight(ctx, v.kg); } catch { err.textContent = 'ماقدرناش نحفظ دلوقتي — جرّب تاني.'; return true; }
    return false;
  } }] });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') s.el.querySelector('.acts .btn').click(); });
  return s;
}

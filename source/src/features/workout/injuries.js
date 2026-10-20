// #/workout/injuries — injury log (parity R11): log (muscle/joint, severity 1-3, note), heal, list migrated ones.
// Stored in kv.training.injuries with the Solo Gym shape {id, muscle, severity, note, date, active}.
// Active injuries drive the in-session warning (W38) and are sent to the coach as context.
import { h, N, ico, band, safeWrite, dateLabel } from './view.js';
import { loadTraining, patchTraining } from './store.js';
import { dayKeyFromInstant } from '../../core/date.js';

const AREAS = ['كتف', 'صدر', 'ظهر', 'ظهر سفلي', 'رقبة', 'كوع', 'رسغ', 'ركبة', 'رجل خلفي', 'رجل', 'كاحل', 'مؤخرة', 'بطن'];
const SEV = { 1: 'خفيفة', 2: 'متوسطة', 3: 'شديدة' };

export async function renderInjuries(el, ctx) {
  let tr = await loadTraining(ctx.db);
  const root = h('div', { class: 'wk-inj' });
  el.append(band({ title: 'الإصابات', sub: 'بنحذّرك في الجلسة لو تمرين بيضغط على مكان مصاب', back: () => ctx.go('workout') }), root);
  const list = () => (Array.isArray(tr.injuries) ? tr.injuries.filter((i) => i && i.muscle) : []);
  const dayOf = (i) => { try { return dayKeyFromInstant(i.date); } catch { return null; } };

  function draw() {
    root.textContent = '';
    const act = list().filter((i) => i.active !== false), healed = list().filter((i) => i.active === false);
    root.appendChild(h('button', { type: 'button', class: 'btn', onclick: add }, ico('plus'), 'سجّل إصابة'));
    const sec = h('section', { class: 'sec', 'aria-labelledby': 'wk-inj-a' }, h('h3', { id: 'wk-inj-a' }, 'نشطة ', h('small', {}, N(String(act.length)))));
    if (!act.length) sec.appendChild(h('div', { class: 'empty-state' }, h('h2', {}, 'مفيش إصابات نشطة'), h('p', {}, 'لو حسّيت بألم في مكان، سجّله هنا علشان نحذّرك في التمارين اللي بتضغط عليه.')));
    for (const i of act) sec.appendChild(row(i, true));
    root.appendChild(sec);
    if (healed.length) root.appendChild(h('details', { class: 'wk-fold' }, h('summary', {}, 'اتعالجت', h('small', {}, N(String(healed.length)))), ...healed.map((i) => row(i, false))));
  }
  function row(i, active) {
    const d = dayOf(i);
    return h('div', { class: `glass wk-injrow sev${i.severity || 1}` },
      h('span', { class: 'grow' }, h('b', {}, i.muscle, ' ', h('small', { class: 'wk-tag' }, SEV[i.severity] || SEV[1])),
        i.note ? h('p', {}, i.note) : null, d ? h('small', {}, ...dateLabel(d)) : null),
      active ? h('button', { type: 'button', class: 'btn ghost sm', onclick: () => heal(i) }, ico('check'), 'اتعالجت') : null);
  }
  async function heal(i) {
    const ok = await ctx.confirm({ title: `${i.muscle} اتعالج؟`, text: 'هنوقف التحذير في التمارين. تقدر ترجّعها بتسجيل جديد.', confirmLabel: 'اتعالجت' });
    if (!ok) return;
    const injuries = list().map((x) => (x.id === i.id ? { ...x, active: false, healedAt: new Date().toISOString() } : x));
    if (await safeWrite(ctx, async () => { tr = await patchTraining(ctx.db, { injuries }); })) { ctx.toast('الحمد لله على السلامة.'); draw(); }
  }
  function add() {
    let area = '', sev = 1;
    const aChips = h('div', { class: 'chips', role: 'radiogroup', 'aria-labelledby': 'wk-inj-m' });
    const sChips = h('div', { class: 'chips', role: 'radiogroup', 'aria-labelledby': 'wk-inj-s' });
    const err = h('p', { class: 'err', hidden: true }, 'اختار المكان.');
    const paint = () => {
      aChips.textContent = ''; for (const a of AREAS) aChips.appendChild(h('button', { type: 'button', class: 'chip', role: 'radio', 'aria-checked': String(a === area), onclick: () => { area = a; err.hidden = true; paint(); } }, a));
      sChips.textContent = ''; for (const s of [1, 2, 3]) sChips.appendChild(h('button', { type: 'button', class: 'chip', role: 'radio', 'aria-checked': String(s === sev), onclick: () => { sev = s; paint(); } }, SEV[s]));
    };
    paint();
    const note = h('textarea', { id: 'wk-inj-n', rows: 2, maxlength: 300 });
    ctx.sheet({ title: 'سجّل إصابة', body: h('div', {},
      h('div', { class: 'field' }, h('span', { class: 'lbl', id: 'wk-inj-m' }, 'المكان'), aChips, err),
      h('div', { class: 'field' }, h('span', { class: 'lbl', id: 'wk-inj-s' }, 'الشدّة'), sChips),
      h('div', { class: 'field' }, h('label', { for: 'wk-inj-n' }, 'ملاحظة (اختياري)'), note)),
    actions: [{ label: 'احفظ الإصابة', run: async () => {
      if (!area) { err.hidden = false; return true; }
      const inj = { id: `inj${Date.now()}`, muscle: area, severity: sev, note: note.value.trim().slice(0, 300), date: new Date().toISOString(), active: true };
      if (await safeWrite(ctx, async () => { tr = await patchTraining(ctx.db, { injuries: [...list(), inj] }); })) { draw(); ctx.toast(`اتسجّلت: ${area}`); }
    } }] });
  }
  draw();
}

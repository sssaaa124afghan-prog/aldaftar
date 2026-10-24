// #/workout/library — exercise library (parity P5, P6, P9, W31-W34): browse / filter / search, detail sheet with
// progress card, technique tips, form phases, breathing cue, external "how to" link, decision journal, coach help,
// add to a plan day, and custom exercises (kv.training.customExercises).
import { h, N, ico, band, safeWrite } from './view.js';
import * as L from './logic.js';
import { LIBRARY, MUSCLES, registerCustom } from './exercises.js';
import { loadAll, loadProgram, saveProgram, loadTraining, patchTraining } from './store.js';
import { spark, coachingFor, loadCoach } from './kit.js';
import { libGroupMatch, GROUPS, norm } from './picker.js';
import { exerciseThumb, exerciseFigure, creditLine } from './exercise-images.js';
import { videoLink } from './exercise-videos.js';

export async function renderLibrary(el, ctx, params = {}) {
  const [{ done }, training, coach] = await Promise.all([loadAll(ctx.db), loadTraining(ctx.db), loadCoach(ctx)]);
  el.appendChild(band({ title: 'مكتبة التمارين', sub: [N(String(LIBRARY.length)), ' تمرين · الفورم والنصايح وتقدّمك'], back: () => ctx.go('workout'),
    actions: [h('button', { type: 'button', class: 'ibtn', 'aria-label': 'ضيف تمرين جديد', onclick: () => addCustom(ctx) }, ico('plus'))] }));
  let group = GROUPS.includes(params.m) ? params.m : 'الكل', q = '';
  const input = h('input', { type: 'search', id: 'wk-lib-q', autocomplete: 'off', enterkeyhint: 'search' });
  const chips = h('div', { class: 'chips wk-chips-scroll', role: 'group', 'aria-label': 'العضلة' });
  const count = h('p', { class: 'wk-pick-count', 'aria-live': 'polite' });
  const list = h('div', { class: 'wk-lib-list', role: 'list' });
  const usage = new Map();
  for (const s of done) for (const e of s.exercises) { const k = L.exKey(e); usage.set(k, (usage.get(k) || 0) + 1); }
  for (const g of GROUPS) chips.appendChild(h('button', { type: 'button', class: 'chip', dataset: { g }, onclick: () => { group = g; draw(); } }, g));
  input.addEventListener('input', () => { q = input.value; draw(); });
  el.appendChild(h('div', { class: 'wk-lib' }, h('div', { class: 'field' }, h('label', { for: 'wk-lib-q' }, 'دوّر بالعربي أو الإنجليزي'), input), chips, count, list,
    h('button', { type: 'button', class: 'btn ghost wk-mt', onclick: () => addCustom(ctx) }, ico('plus'), 'ضيف تمرين مش موجود'), creditLine('wk-excredit wk-lib-credit')));

  function draw() {
    for (const c of chips.children) c.setAttribute('aria-pressed', String(c.dataset.g === group));
    const nq = norm(q);
    const rows = LIBRARY.filter((e) => libGroupMatch(e, group) && (!nq || norm(e.ar).includes(nq) || norm(e.en).includes(nq)))
      .sort((a, b) => (usage.get(`lib:${b.id}`) || 0) - (usage.get(`lib:${a.id}`) || 0));
    list.textContent = '';
    count.textContent = ''; count.append(N(String(rows.length)), ' تمرين');
    for (const e of rows) {
      const n = usage.get(`lib:${e.id}`) || 0;
      list.appendChild(h('button', { type: 'button', class: 'list-row', role: 'listitem', onclick: () => detail(ctx, e, { done, training, coach }) },
        exerciseThumb(e.id),
        h('span', { class: 'grow' }, h('b', {}, e.ar, e.custom ? h('small', { class: 'wk-tag' }, 'مخصّص') : null), h('small', {}, `${e.en} · ${e.muscle} · ${e.eq}`)),
        n ? h('small', { class: 'wk-kind' }, N(String(n)), ' جلسة') : h('small', { class: 'wk-kind' }, e.kind === 'compound' ? 'مركّب' : 'عزل')));
    }
    if (!rows.length) list.appendChild(h('p', { class: 'wk-muted' }, 'مفيش تمرين بالاسم ده. جرّب كلمة تانية أو ضيفه كتمرين جديد.'));
  }
  draw();
  if (params.ex) { const e = LIBRARY.find((x) => x.id === params.ex); if (e) detail(ctx, e, { done, training, coach }); }
}

let openDetail = null;
export function detail(ctx, e, { done, training, coach }) {
  const item = { id: e.id, lib: e.id, ar: e.ar, en: e.en, muscle: e.muscle, kind: e.kind };
  const series = L.e1rmSeries(done, item);
  const rate = L.progressRate(done, item);
  const rec = L.recommend(done, item);
  const best = series.reduce((b, p) => (p.e1rm > b.e1rm ? p : b), { e1rm: 0, w: 0, r: 0 });
  const c = coachingFor(item);
  const journal = L.journalFor(training.poJournal, item);
  const body = h('div', { class: 'wk-detail' },
    h('p', { class: 'wk-meta' }, e.en, ' · ', e.muscle, ' · ', e.eq, ' · ', e.kind === 'compound' ? 'مركّب · راحة 2:30' : 'عزل · راحة 1:30'),
    h('div', { class: 'wk-vidrow' }, videoLink(e, { name: e.ar })),
    exerciseFigure(e.id, e.ar),
    series.length ? h('section', { class: 'glass wk-card wk-prog' },
      h('div', { class: 'wk-prog-top' },
        h('div', {}, h('small', {}, 'أفضل مجموعة'), h('b', {}, N(`${L.fmtW(best.w)} × ${best.r}`))),
        h('div', {}, h('small', {}, 'أفضل e1RM'), h('b', {}, N(L.fmtW(Math.round(best.e1rm))), h('small', {}, ' كجم'))),
        h('div', {}, h('small', {}, 'المعدّل · تقدير'), h('b', {}, rate === null ? '—' : N(`${rate > 0 ? '+' : rate < 0 ? '−' : ''}${L.fmtW(Math.abs(rate))}`), rate === null ? null : h('small', {}, ' كجم/أسبوع')))),
      spark(series.slice(-12).map((p) => p.e1rm), { w: 300, h: 56, label: 'e1RM في آخر الجلسات' }),
      h('p', { class: `wk-hint${rec.status === 'progressing' ? '' : ' quiet'}` }, h('span', { class: `wk-pill s-${rec.status}` }, L.REC_LABEL[rec.status]), ' ', rec.msg))
      : h('p', { class: 'wk-muted' }, 'لسه ماتمرّنتش عليه. أول جلسة هتظهر هنا مع أرقامك.'),
    c.tips.length ? h('section', {}, h('h4', {}, 'نصايح التكنيك'), h('ul', { class: 'wk-bul' }, ...c.tips.map((t) => h('li', {}, t)))) : null,
    c.form ? h('section', {}, h('h4', {}, 'مراحل الحركة'),
      c.form.start ? h('p', { class: 'wk-muted' }, h('b', {}, 'البداية: '), c.form.start) : null,
      h('ol', { class: 'wk-phases' }, ...(c.form.exec || []).map((p) => h('li', {}, h('b', {}, p.phase), h('span', {}, p.cue)))),
      (c.form.cues || []).length ? h('p', { class: 'wk-cues' }, c.form.cues.join(' · ')) : null) : null,
    c.breathing ? h('section', {}, h('h4', {}, 'التنفّس'), h('p', {}, c.breathing.slice(0, 3).join(' ← '))) : null,
    journal.length ? h('section', {}, h('h4', {}, 'قراراتك اللي فاتت'), h('ol', { class: 'wk-an-journal' }, ...journal.map((j) => h('li', {}, N(String(j.date || '').slice(5).replace('-', '/')), ' · ', j.msg || '')))) : null);
  const actions = [{ label: 'ضيفه ليوم في الخطة', run: () => addToDay(ctx, e) }];
  if (coach) actions.push({ label: 'عندك مشكلة في الأداء؟ اسأل المدرب', ghost: true, run: () => { try { coach.openCoachSheet(ctx, { intent: 'exercise-help', attach: { exercise: { ar: e.ar, en: e.en, muscle: e.muscle }, series: series.slice(-8) } }); } catch { ctx.toast('المدرب مش متاح دلوقتي.'); } } });
  // one detail sheet at a time (a deep link re-render must not stack a second one)
  if (openDetail) openDetail.close();
  const s = ctx.sheet({ title: e.ar, body, actions, onClose: () => { if (openDetail === s) openDetail = null; } });
  openDetail = s;
}

async function addToDay(ctx, e) {
  const { program, rec } = await loadProgram(ctx.db);
  const body = h('div', { role: 'list' }, ...program.order.map((id) => h('button', { type: 'button', class: 'list-row', role: 'listitem', onclick: async () => {
    const it = L.itemFromLib(e.id);
    const items = program.days[id].items;
    if (items.some((x) => x.lib === e.id)) { ctx.toast('التمرين موجود في اليوم ده بالفعل.'); return; }
    if (items.some((x) => x.id === it.id)) it.id = `${it.id}_${Date.now().toString(36)}`;
    items.push(it);
    if (await safeWrite(ctx, () => saveProgram(ctx.db, program, rec))) { ctx.emit('session:changed', { state: 'plan' }); ctx.toast(`اتضاف لـ ${program.days[id].name}`); }
    api.close();
  } }, h('span', { class: 'grow' }, h('b', {}, program.days[id].name), h('small', {}, N(String(program.days[id].items.length)), ' تمرين')), ico('plus'))));
  const api = ctx.sheet({ title: `ضيف ${e.ar} لـ`, body });
}

/** P6: custom exercise form (name AR/EN, muscle, compound/isolation). Blur validation on the Arabic name. */
export function addCustom(ctx, { onAdded } = {}) {
  const ar = h('input', { id: 'wk-cx-ar', type: 'text', maxlength: 60, autocomplete: 'off', 'aria-describedby': 'wk-cx-e' });
  const en = h('input', { id: 'wk-cx-en', type: 'text', maxlength: 60, autocomplete: 'off', dir: 'ltr' });
  const err = h('p', { class: 'err', id: 'wk-cx-e', hidden: true }, 'اكتب اسم التمرين بالعربي.');
  let muscle = 'صدر', kind = 'compound';
  const mChips = h('div', { class: 'chips', role: 'radiogroup', 'aria-labelledby': 'wk-cx-m' });
  const paintM = () => { mChips.textContent = ''; for (const m of MUSCLES) mChips.appendChild(h('button', { type: 'button', class: 'chip', role: 'radio', 'aria-checked': String(m === muscle), onclick: () => { muscle = m; paintM(); } }, m)); };
  const kChips = h('div', { class: 'chips', role: 'radiogroup', 'aria-labelledby': 'wk-cx-k' });
  const paintK = () => { kChips.textContent = ''; for (const [k, lbl] of [['compound', 'مركّب'], ['isolation', 'عزل']]) kChips.appendChild(h('button', { type: 'button', class: 'chip', role: 'radio', 'aria-checked': String(k === kind), onclick: () => { kind = k; paintK(); } }, lbl)); };
  paintM(); paintK();
  ar.addEventListener('blur', () => { const ok = ar.value.trim().length >= 2; ar.setAttribute('aria-invalid', String(!ok)); err.hidden = ok; });
  ar.addEventListener('input', () => { ar.removeAttribute('aria-invalid'); err.hidden = true; });
  ctx.sheet({ title: 'ضيف تمرين جديد', body: h('div', {},
    h('div', { class: 'field' }, h('label', { for: 'wk-cx-ar' }, 'الاسم بالعربي'), ar, err),
    h('div', { class: 'field' }, h('label', { for: 'wk-cx-en' }, 'الاسم بالإنجليزي (اختياري)'), en),
    h('div', { class: 'field' }, h('span', { class: 'lbl', id: 'wk-cx-m' }, 'العضلة'), mChips),
    h('div', { class: 'field' }, h('span', { class: 'lbl', id: 'wk-cx-k' }, 'النوع'), kChips)),
  actions: [{ label: 'احفظ التمرين', run: async () => {
    const name = ar.value.trim();
    if (name.length < 2) { ar.setAttribute('aria-invalid', 'true'); err.hidden = false; ar.focus(); return true; }
    const tr = await loadTraining(ctx.db);
    const list = Array.isArray(tr.customExercises) ? tr.customExercises : [];
    const c = { id: `cx${Date.now().toString(36)}`, ar: name.slice(0, 60), en: en.value.trim().slice(0, 60) || name.slice(0, 60), muscle, kind, eq: 'مخصّص' };
    if (!(await safeWrite(ctx, () => patchTraining(ctx.db, { customExercises: [...list, c] })))) return true;
    registerCustom([c]);
    ctx.toast(`اتضاف ${c.ar} للمكتبة.`);
    if (onAdded) onAdded(c); else if (location.hash.startsWith('#/workout/library')) ctx.go('workout/library', { ex: c.id });
  } }] });
}

// #/workout/import — «استورد أوزانك القديمة»: pick the old GymPro Elite backup (.json), review the working weights per plan day,
// then «طبّق» writes one baseline (seed) session per day. Parsing is on the device only; only ses / days / bw / profile weight
// are read (oldweights.js pickSafe) and the file text is dropped right after.
import './import.css';
import { h, N, ico, band, safeWrite, dateLabel } from './view.js';
import * as O from './oldweights.js';
import { loadProgram, patchTraining, putSession, deleteSession, loadSessions } from './store.js';
import { fmtW, isSeed, reentryInfo } from './logic.js';

const fw = (w) => fmtW(w);
const setTxt = (t) => (t ? `${fw(t.w)}×${t.r}` : '—');

async function existingSeeds(db) { return (await loadSessions(db)).filter(isSeed); }

export async function renderImport(el, ctx) {
  const today = ctx.today();
  let model = null, applied = null;
  const root = h('div', { class: 'oi' });
  el.appendChild(root);

  const back = () => (history.length > 1 ? history.back() : ctx.go('profile'));

  async function pickScreen(msg = '') {
    root.textContent = '';
    const seeds = await existingSeeds(ctx.db).catch(() => []);
    const input = h('input', { type: 'file', id: 'oi-file', accept: '.json,application/json', class: 'vh' });
    const status = h('p', { class: 'status', role: 'status', 'aria-live': 'polite' }, msg);
    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      input.value = '';
      if (!file) return;
      if (file.size > 25 * 1024 * 1024) { status.textContent = 'الملف كبير أوي. اختار ملف النسخة الاحتياطية بتاعة GymPro.'; return; }
      status.textContent = 'بنقرا الملف…';
      let text = '';
      try { text = await file.text(); } catch { status.textContent = 'الملف ماتقراش. جرّب تختاره تاني.'; return; }
      const r = O.pickSafe(text);
      text = '';
      if (!r.ok) { status.textContent = 'ده مش ملف نسخة احتياطية من GymPro. اختار ملف .json تاني.'; return; }
      const { program } = await loadProgram(ctx.db).catch(() => ({ program: null }));
      model = O.buildImport(r.data, { program, today });
      if (!model.rows.length) { status.textContent = 'مالقيناش تمارين في الملف تنفع للخطة. اختار ملف تاني.'; return; }
      reviewScreen();
    });
    root.append(
      band({ title: 'استورد أوزانك القديمة', sub: 'من نسخة GymPro Elite الاحتياطية', back }),
      h('div', { class: 'sheet-card oi-intro' },
        h('p', {}, 'هنقرا آخر 3 جلسات لكل تمرين ونطلع منها وزن الشغل، وبعدين تراجعه قبل ما يتحفظ.'),
        h('p', { class: 'hint' }, ico('check'), 'الملف بيتقري على الجهاز ده بس. بنقرا الجلسات والخطة والوزن بس، ومش بنقرا أي مفتاح ولا بنحفظه.'),
        h('label', { class: 'btn oi-pick', for: 'oi-file' }, ico('upload'), 'اختار ملف ‎.json'), input, status),
    );
    if (seeds.length) {
      const del = h('button', { type: 'button', class: 'btn ghost danger sm' }, 'امسح الأوزان المستوردة');
      del.addEventListener('click', async () => {
        const ok = await ctx.confirm({ title: 'تمسح الأوزان المستوردة؟', text: `${seeds.length} جلسة أساس هتتمسح. جلساتك الحقيقية مش هتتلمس.`, confirmLabel: 'امسح الأوزان المستوردة', danger: true });
        if (!ok) return;
        if (await removeImport(ctx, seeds.map((s) => s.id))) { ctx.toast('اتمسحت الأوزان المستوردة'); pickScreen(); }
      });
      root.appendChild(h('div', { class: 'sheet-card oi-have' },
        h('p', {}, 'عندك أوزان مستوردة', ' · ', N(String(seeds.length)), ' أيام'), del));
    }
  }

  function reviewScreen() {
    root.textContent = '';
    const nReview = model.rows.filter((r) => r.review).length;
    const reOn = model.gap !== null && model.gap >= 14 && !reentryInfo(ctx.settings, today)?.active;
    const reSw = h('input', { type: 'checkbox', id: 'oi-re', role: 'switch', checked: reOn || null });
    const reWrap = h('label', { class: 'oi-switch', for: 'oi-re' },
      h('span', {}, h('b', {}, 'ابدأ بأسبوعين رجوع'),
        h('small', {}, model.gap !== null ? ['آخر تمرين من ', N(String(model.gap)), ' يوم · أسبوع 1 حوالي 80% وأسبوع 2 حوالي 90%'] : 'أسبوع 1 حوالي 80% وأسبوع 2 حوالي 90%')),
      reSw, h('i', { 'aria-hidden': 'true' }));
    if (reentryInfo(ctx.settings, today)?.active) { reSw.checked = true; reSw.disabled = true; }
    const bwLine = model.bodyweight ? h('p', { class: 'hint' }, 'وزن الجسم ', N(fw(model.bodyweight.kg)), ' كجم من ', ...dateLabel(model.bodyweight.day), ' هيتسجّل لو اليوم ده فاضي.') : null;
    root.append(
      band({ title: 'راجع أوزانك', sub: `${model.rows.length} تمرين · ${nReview ? `${nReview} محتاج مراجعة` : 'كله واضح'}`, back: () => pickScreen() }),
      h('div', { class: 'sheet-card oi-intro' },
        h('p', {}, 'وزن الشغل هو آخر وزن اشتغلت بيه. غيّره لو مش مظبوط، وأسبوع 1 و2 بيتحسبوا لوحدهم.'),
        nReview ? h('p', { class: 'hint' }, h('span', { class: 'oi-flag' }, 'راجع'), ' يعني فيه رقم اتفسّر أو اتشال.') : null,
        bwLine, reWrap),
    );
    for (const d of model.days) root.appendChild(dayTable(d));
    const apply = h('button', { type: 'button', class: 'btn' }, ico('check'), 'طبّق');
    const cancel = h('button', { type: 'button', class: 'btn ghost' }, 'إلغاء');
    cancel.addEventListener('click', () => { model = null; ctx.go('profile'); });
    apply.addEventListener('click', async () => {
      apply.disabled = true;
      const res = await applyImport(ctx, model, { reentry: reSw.checked && !reSw.disabled, today });
      apply.disabled = false;
      if (!res) return;
      applied = res;
      model = null;
      ctx.emit('session:changed', { state: 'plan' });
      if (res.bw) ctx.emit('weight:changed', {});
      ctx.toast(`اتطبّقت أوزان ${res.ids.length} أيام · أول جلسة هتفتح جاهزة`, { action: { label: 'تراجع', run: () => undoApply(ctx, applied) } });
      ctx.go('workout');
    });
    root.append(h('div', { class: 'oi-spacer', 'aria-hidden': 'true' }), h('div', { class: 'dock oi-dock' }, h('div', { class: 'btn-row' }, cancel, apply)));
  }

  function dayTable(d) {
    const id = `oi-d-${d.id}`;
    const tbody = h('tbody', {});
    for (const r of d.rows) tbody.appendChild(rowEl(r));
    return h('section', { class: 'oi-day', 'aria-labelledby': id },
      h('h2', { id }, d.name, d.date ? h('small', {}, 'آخر مرة ', ...dateLabel(d.date)) : null),
      h('table', { class: 'oi-t' },
        h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'التمرين'), h('th', { scope: 'col' }, 'القديم'), h('th', { scope: 'col' }, 'وزن الشغل'),
          h('th', { scope: 'col' }, 'أسبوع 1'), h('th', { scope: 'col' }, 'أسبوع 2'))),
        tbody));
  }

  function rowEl(r) {
    const w1 = h('td', { class: 'oi-w oi-w1', 'data-l': 'أسبوع 1' }), w2 = h('td', { class: 'oi-w oi-w2', 'data-l': 'أسبوع 2' });
    const paintW = () => {
      w1.textContent = ''; w2.textContent = '';
      if (r.body) { w1.append(h('span', { class: 'num' }, '—')); w2.append(h('span', { class: 'num' }, '—')); return; }
      w1.append(N(fw(r.w1)), h('small', {}, ' كجم')); w2.append(N(fw(r.w2)), h('small', {}, ' كجم'));
    };
    paintW();
    const flags = r.flags.filter((f) => f !== 'cross');
    const name = h('th', { scope: 'row', class: 'oi-n' }, h('b', {}, r.ar),
      r.review ? h('span', { class: 'oi-flag' }, 'راجع') : null,
      flags.length ? h('small', { class: 'oi-why' }, flags.map((f) => O.FLAG_TEXT[f]).filter(Boolean).join(' · ')) : null,
      r.crossNote ? h('small', { class: 'oi-src' }, 'من ', h('bdi', { dir: 'ltr' }, r.crossNote)) : null,
      r.extra ? h('small', { class: 'oi-src' }, 'للعقلة لما ترجعلها · الخطة فيها سحب أمامي دلوقتي') : null);
    const old = h('td', { class: 'oi-old', 'data-l': 'القديم' },
      r.from === 'plan' ? h('span', {}, 'الخطة: ', N(fw(r.chosen))) : [
        h('span', {}, 'أحسن ', h('bdi', { class: 'num', dir: 'ltr' }, r.body ? `${r.best?.r ?? '—'} عدّة` : setTxt(r.best))),
        h('span', {}, 'آخر ', h('bdi', { class: 'num', dir: 'ltr' }, r.body ? `${r.last?.r ?? '—'} عدّة` : setTxt(r.last)))]);
    let cell;
    if (r.body) cell = h('td', { class: 'oi-c', 'data-l': 'وزن الشغل' }, h('span', { class: 'oi-bw' }, 'وزن جسمك'));
    else {
      const inp = h('input', { type: 'text', inputmode: 'decimal', autocomplete: 'off', class: 'num', value: fw(r.chosen), 'aria-label': `وزن الشغل · ${r.ar} بالكيلو` });
      const commit = () => {
        const v = Number(String(inp.value).replace(/[٠-٩]/g, (c) => '٠١٢٣٤٥٦٧٨٩'.indexOf(c)).replace(/[٫,]/g, '.'));
        if (!Number.isFinite(v) || v < 0 || v > 500) { inp.setAttribute('aria-invalid', 'true'); return; }
        inp.removeAttribute('aria-invalid');
        O.setChosen(r, v); inp.value = fw(r.chosen); paintW();
      };
      inp.addEventListener('change', commit);
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); inp.blur(); } });
      const bump = (dir) => { O.setChosen(r, Math.max(0, (r.chosen || 0) + dir * O.stepOf(r))); inp.value = fw(r.chosen); inp.removeAttribute('aria-invalid'); paintW(); };
      cell = h('td', { class: 'oi-c', 'data-l': 'وزن الشغل' }, h('div', { class: 'step oi-step' },
        h('button', { type: 'button', 'aria-label': `زوّد ${r.ar}`, onclick: () => bump(1) }, ico('plus')),
        h('div', {}, inp),
        h('button', { type: 'button', 'aria-label': `قلّل ${r.ar}`, onclick: () => bump(-1) }, ico('minus'))));
    }
    return h('tr', { class: r.review ? 'rv' : '' }, name, old, cell, w1, w2);
  }

  await pickScreen();
}

/** Write the seeds (+ latest body weight when that day is empty, + re-entry when asked). → {ids, prev, bw, reentryPrev} | null */
export async function applyImport(ctx, model, { reentry = false, today } = {}) {
  const seeds = O.seedSessions(model, { now: new Date() });
  if (!seeds.length) { ctx.toast('مفيش أوزان تتحفظ.'); return null; }
  const prev = [];
  for (const s of seeds) { try { const p = await ctx.db.get('sessions', s.id); if (p) prev.push(p); } catch { /* none */ } }
  // re-import: baselines of days not in this file are removed too, so only one import is ever active
  const old = (await existingSeeds(ctx.db).catch(() => [])).filter((s) => !seeds.some((x) => x.id === s.id));
  prev.push(...old);
  let bw = null;
  if (model.bodyweight) {
    let cur = null; try { cur = await ctx.db.get('bodyweight', model.bodyweight.day); } catch { /* none */ }
    if (!cur) bw = { day: model.bodyweight.day, kg: model.bodyweight.kg, src: 'gym', at: new Date().toISOString() };
  }
  const reentryPrev = ctx.settings.get('wk.reentry') ?? null;
  const ok = await safeWrite(ctx, async () => {
    for (const s of seeds) await putSession(ctx.db, s);
    for (const s of old) await deleteSession(ctx.db, s.id);
    if (bw) await ctx.db.put('bodyweight', bw);
  });
  if (!ok) return null;
  if (reentry) await ctx.settings.set('wk.reentry', { startDay: today, weeks: 2 });
  const res = { ids: seeds.map((s) => s.id), prev, bw: bw ? bw.day : null, reentry, reentryPrev };
  await patchTraining(ctx.db, { importBaseline: { at: new Date().toISOString(), ids: res.ids, bwDay: res.bw, reentry } }).catch(() => null);
  return res;
}

/** Undo right after apply: remove the seeds, put back what they replaced, drop the imported weight, restore re-entry. */
export async function undoApply(ctx, res) {
  if (!res) return;
  const ok = await safeWrite(ctx, async () => {
    for (const id of res.ids) await deleteSession(ctx.db, id);
    for (const p of res.prev) await putSession(ctx.db, p);
    if (res.bw) await ctx.db.delete('bodyweight', res.bw);
  });
  if (!ok) return;
  if (res.reentry) await ctx.settings.set('wk.reentry', res.reentryPrev);
  await patchTraining(ctx.db, { importBaseline: null }).catch(() => null);
  ctx.emit('session:changed', { state: 'plan' });
  if (res.bw) ctx.emit('weight:changed', {});
  ctx.toast('رجّعنا زي ما كان');
}

/** «امسح الأوزان المستوردة»: removes every baseline (re-entry stays as set in Profile; real sessions are never touched). */
async function removeImport(ctx, ids) {
  const ok = await safeWrite(ctx, async () => { for (const id of ids) await deleteSession(ctx.db, id); });
  if (!ok) return false;
  await patchTraining(ctx.db, { importBaseline: null }).catch(() => null);
  ctx.emit('session:changed', { state: 'plan' });
  return true;
}

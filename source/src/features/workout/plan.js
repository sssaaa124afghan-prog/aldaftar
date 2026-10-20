// #/workout/plan — plan editor: program template, training days, per-day exercises (sets, reps, order).
import { h, N, ico, band, safeWrite, DAY_NAMES, setsReps } from './view.js';
import { countWord } from '../../ui/num.js';
import * as L from './logic.js';
import { loadProgram, saveProgram, loadAll } from './store.js';
import { pickExercise } from './picker.js';
import { programLabel } from './overview.js';
import { loadCoach } from './kit.js';
import { findLib, NEW_PROGRAM, PROGRAMS as TPL } from './exercises.js';

const DMY = (d) => { try { const [y, m, dd] = d.split('-'); return `${+dd}/${+m}`; } catch { return d; } };

/**
 * «تحديث الخطة»: a pending template update (programs.current.tv older than the template) as a diff card with apply / keep,
 * both with Undo. Pure diff + apply live in logic.js (planUpdate / applyPlanUpdate). Mountable from the overview too.
 */
export function planUpdateCard(ctx, { program, rec, onDone }) {
  const u = L.planUpdate(program);
  if (!u) return null;
  const save = async (next, msg) => {
    const before = { ...program };
    let r1 = rec;
    if (!(await safeWrite(ctx, async () => { r1 = await saveProgram(ctx.db, next, rec); }))) return;
    ctx.emit('session:changed', { state: 'plan' });
    ctx.toast(msg, { action: { label: 'تراجع', run: async () => {
      if (await safeWrite(ctx, () => saveProgram(ctx.db, { ...before, tv: before.tv }, r1))) { ctx.emit('session:changed', { state: 'plan' }); onDone(); }
    } } });
    onDone();
  };
  return h('section', { class: 'sheet-card wk-newplan wk-planup', 'aria-labelledby': 'wk-pu-h', dataset: { fk: 'planup' } },
    h('h3', { id: 'wk-pu-h' }, 'تحديث الخطة', h('small', {}, u.title)),
    h('ul', { class: 'wk-np-list' }, ...u.changes.map((c) => h('li', { class: c.ok ? null : 'wk-muted' },
      h('b', {}, c.text), c.ok ? null : ' (اتغيّر عندك، هنسيبه)', c.why ? h('small', { class: 'wk-muted' }, ' · ', c.why) : null))),
    h('p', { class: 'wk-muted' }, 'نفس المجموعات والراحة والوقت. سجلّك القديم محفوظ.'),
    h('div', { class: 'btn-row' },
      h('button', { type: 'button', class: 'btn sm', dataset: { fk: 'pu-on' }, disabled: u.applicable ? null : true,
        onclick: () => { const r = L.applyPlanUpdate(program); return save(r.program, `اتحدّثت الخطة · ${r.applied.length} تعديل`); } }, 'طبّق التحديث'),
      h('button', { type: 'button', class: 'btn ghost sm', dataset: { fk: 'pu-keep' },
        onclick: () => save({ ...program, tv: TPL[program.activeProgram].version }, 'خطتك زي ما هي') }, 'خلّيها زي ما هي')));
}

export async function renderPlan(el, ctx, params = {}) {
  let { program, rec } = await loadProgram(ctx.db);
  const { done: doneSessions } = await loadAll(ctx.db);
  let dayId = program.days[params.day] ? params.day : program.order[0];
  const coach = await loadCoach(ctx);
  const root = h('div', { class: 'wk-planed' });
  el.append(band({ title: 'الخطة', sub: 'التعديل بيتحفظ لوحده', back: () => ctx.go('workout') }), root);

  const persist = async () => {
    const ok = await safeWrite(ctx, async () => { rec = await saveProgram(ctx.db, program, rec); });
    if (ok) ctx.emit('session:changed', { state: 'plan' });
    return ok;
  };

  function draw(focusSel) {
    root.textContent = '';
    const today = ctx.today();
    const re = L.reentryInfo(ctx.settings, today);
    const block = L.programFlags(program).meso && !re?.active ? L.mesoBlock(L.blockStart(program.startDay, re), today) : null;
    const firstBlock = L.programFlags(program).meso && (re?.active || block === null || block === 1);
    const pu = planUpdateCard(ctx, { program, rec, onDone: async () => { ({ program, rec } = await loadProgram(ctx.db)); draw('[data-fk="add"]'); } });
    if (pu) root.appendChild(pu);
    // pull-up gate (exercise-selection #3): pulldown until 3×8 body-weight pull-ups at RIR 2
    if (program.days.upperA?.items.some((x) => x.id === 'uaLPD') && L.pullupReady(doneSessions).ready) {
      root.appendChild(h('section', { class: 'sheet-card wk-newplan', 'aria-labelledby': 'wk-pg-h' },
        h('h3', { id: 'wk-pg-h' }, 'جاهز للعقلة بوزن', h('small', {}, 'عملت 3×8 عقلة بوزن جسمك')),
        h('p', { class: 'wk-muted' }, 'في Upper A: سحب أمامي ← عقلة بوزن مضاف، نفس السوبر سِت والراحة.'),
        h('div', { class: 'btn-row' }, h('button', { type: 'button', class: 'btn sm', onclick: async () => {
          const before = program; program = L.backToPullup(program);
          if (!(await persist())) { program = before; return; }
          ctx.toast('رجعت العقلة بوزن في Upper A', { action: { label: 'تراجع', run: async () => { program = before; await persist(); draw(); } } });
          draw();
        } }, 'ارجع للعقلة بوزن'))));
    }
    // program templates
    const tpl = h('section', { class: 'sec', 'aria-labelledby': 'wk-tpl-h' },
      h('h3', { id: 'wk-tpl-h' }, 'نوع الخطة'),
      h('div', { class: 'chips wk-gap' },
        ...Object.values(L.PROGRAMS).sort((a, b) => (b.id === NEW_PROGRAM) - (a.id === NEW_PROGRAM)).map((t) => h('button', { type: 'button', class: 'chip', 'aria-pressed': String(program.activeProgram === t.id),
          onclick: () => switchTo(t.id) }, ...programLabel({ activeProgram: t.id }))),
        !L.PROGRAMS[program.activeProgram] ? h('button', { type: 'button', class: 'chip', 'aria-pressed': 'true' }, program.activeProgram === 'imported' ? 'خطتك من Solo Gym' : 'خطة مخصّصة') : null,
        rec?.previous?.program ? h('button', { type: 'button', class: 'chip', 'aria-pressed': 'false', onclick: restorePrevious }, rec.previous.name || 'برنامجي القديم') : null),
      h('p', {}, L.PROGRAMS[program.activeProgram]?.note || 'خطتك بتعديلاتك.'));
    root.appendChild(tpl);

    // training days
    const ws = ctx.settings.get('weekStart') ?? 1;
    const td = new Set(ctx.settings.get('trainingDays') || []);
    const days = Array.from({ length: 7 }, (_, i) => (ws + i) % 7);
    root.appendChild(h('section', { class: 'sec', 'aria-labelledby': 'wk-td-h' },
      h('h3', { id: 'wk-td-h' }, 'أيام التمرين'),
      h('div', { class: 'chips wk-gap', role: 'group', 'aria-labelledby': 'wk-td-h' },
        ...days.map((d) => h('button', { type: 'button', class: 'chip', 'aria-pressed': String(td.has(d)), dataset: { fk: `td${d}` },
          onclick: async () => {
            const next = new Set(ctx.settings.get('trainingDays') || []);
            if (next.has(d)) next.delete(d); else next.add(d);
            await ctx.settings.set('trainingDays', [...next].sort((a, b) => a - b));
            draw(`[data-fk="td${d}"]`);
          } }, DAY_NAMES[d]))),
      h('p', {}, N(String(td.size)), ` ${countWord(td.size, 'day')} في الأسبوع · أيام التمرين بتحدد هدف الأكل كمان`)));

    // weekday → plan day (P3, optional): empty = rotation
    if (td.size) {
      const sched = program.schedule || {};
      root.appendChild(h('section', { class: 'sec', 'aria-labelledby': 'wk-sc-h' },
        h('h3', { id: 'wk-sc-h' }, 'كل يوم بيتمرّن إيه؟', h('small', {}, 'اختياري · الافتراضي بالدور')),
        ...days.filter((d) => td.has(d)).map((d) => h('div', { class: 'wk-schedrow' },
          h('label', { for: `wk-sc-${d}` }, DAY_NAMES[d]),
          h('select', { id: `wk-sc-${d}`, onchange: async (ev) => {
            const v = ev.target.value; const next = { ...(program.schedule || {}) };
            if (v) next[String(d)] = v; else delete next[String(d)];
            program.schedule = next; await persist();
          } }, h('option', { value: '' }, 'بالدور'), ...program.order.map((id) => h('option', { value: id, selected: sched[String(d)] === id }, program.days[id].name)))))));
    }

    // re-entry after a break (growth-assessment §0.4): 2 lighter weeks, then the 6-week block starts by itself
    root.appendChild(h('section', { class: 'sec', 'aria-labelledby': 'wk-re-h' },
      h('h3', { id: 'wk-re-h' }, 'راجع بعد انقطاع', h('small', {}, ' · أسبوعين أخف قبل الدورة')),
      h('label', { class: 'wk-switch', for: 'wk-re' }, h('span', {}, 'الأسبوع الأول نص المجموعات تقريبًا ووزن 80% · التاني 75% ووزن 90% · من غير فشل ولا إنترفال'),
        h('input', { type: 'checkbox', id: 'wk-re', role: 'switch', checked: re?.active ? true : null, onchange: (ev) => toggleReentry(ev.target.checked) }), h('i', { 'aria-hidden': 'true' })),
      re?.active ? h('p', { class: 'wk-hint quiet', role: 'status' }, ico('trend'), h('span', {}, L.reentryHeader(re), ' · الدورة بتبدأ ', N(DMY(re.endDay)))) : null));

    // 6-week block built into the new plan (replaces the opt-in 4-week wave)
    const mw = L.programFlags(program).meso && !re?.active ? L.mesoWeek(L.blockStart(program.startDay, re), ctx.today()) : null;
    if (L.programFlags(program).meso) root.appendChild(h('section', { class: 'sec', 'aria-labelledby': 'wk-meso-h' },
      h('h3', { id: 'wk-meso-h' }, 'دورة ٦ أسابيع', h('small', {}, ' · RIR بيقرب من الفشل أسبوع ورا أسبوع')),
      h('p', {}, mw ? ['دلوقتي: أسبوع ', N(String(mw)), ' من ', N('6'), block > 1 ? [' · الدورة ', N(String(block))] : '', ' · ', L.MESO_LABEL[mw], mw === 6 ? ' · نص المجموعات ووزن أقل 10%' : ''] : re?.active ? ['بتبدأ ', N(DMY(re.endDay)), ' بعد أسبوعين الرجوع.'] : 'بتبدأ مع أول جلسة.')));
    // periodization (W70, opt-in)
    const per = ctx.settings.get('wk.periodization') === true;
    const ph = per ? L.phaseOf(program.startDay, ctx.today()) : null;
    if (!L.programFlags(program).meso) root.appendChild(h('section', { class: 'sec', 'aria-labelledby': 'wk-per-h' },
      h('h3', { id: 'wk-per-h' }, 'مراحل الدورة', h('small', {}, 'حجم ← شدّة ← ذروة ← تخفيف')),
      h('label', { class: 'wk-switch', for: 'wk-per' }, h('span', {}, 'موجة 4 أسابيع: أسبوع التخفيف بيقلّل الوزن 10% لوحده'),
        h('input', { type: 'checkbox', id: 'wk-per', role: 'switch', checked: per ? true : null, onchange: async (ev) => {
          await ctx.settings.set('wk.periodization', ev.target.checked);
          if (ev.target.checked && !program.startDay) { program.startDay = ctx.today(); await persist(); }
          draw('#wk-per');
        } }), h('i', { 'aria-hidden': 'true' })),
      ph ? h('p', {}, 'دلوقتي: أسبوع ', N(String(ph.week)), ' من ', N('4'), ' · ', L.PHASES[ph.type]) : null));

    if (coach) root.appendChild(h('button', { type: 'button', class: 'btn violet', onclick: aiDraft }, ico('spark'), 'اقترح خطة من المدرب'));

    // day selector + items
    const day = program.days[dayId];
    const card = h('section', { class: 'sheet-card wk-plan', 'aria-labelledby': 'wk-day-h' },
      h('h3', { id: 'wk-day-h' }, day.name, h('small', {}, N(String(day.items.length)), ` ${countWord(day.items.length, 'exercise')} · حوالي `, N(String(L.estimateMinutes(day.items))), ' دقيقة')),
      h('div', { class: 'chips wk-days', role: 'group', 'aria-label': 'اليوم' },
        ...program.order.map((id) => h('button', { type: 'button', class: 'chip', 'aria-pressed': String(id === dayId), onclick: () => { dayId = id; draw(); } }, program.days[id].name))));
    if (!day.items.length) card.appendChild(h('p', { class: 'wk-muted wk-pad' }, 'اليوم ده فاضي. ضيف أول تمرين.'));
    day.items.forEach((it, i) => {
      card.appendChild(h('button', { type: 'button', class: 'list-row wk-item', dataset: { fk: `it${i}` }, onclick: () => editItem(i) },
        h('span', { class: 'grow' }, h('b', {}, it.ar, it.ss ? h('small', { class: 'wk-tag' }, `سوبر ${it.ss}`) : null),
          h('small', {}, it.muscle, ' · ', it.kind === 'compound' ? 'مركّب' : 'عزل', ' · راحة ', N(L.fmtClock(it.ss ? L.restFor(it, { superset: true }) : L.restFor(it))),
            firstBlock && it.r1 ? [' · أول 6 أسابيع ', N(it.r1)] : null),
          it.note ? h('small', { class: 'wk-muted' }, it.note) : null),
        setsReps(it.sets, firstBlock && it.r1 ? it.r1 : it.reps), ico('edit')));
    });
    card.appendChild(h('button', { type: 'button', class: 'btn ghost wk-add', dataset: { fk: 'add' }, onclick: addItem }, ico('plus'), 'ضيف تمرين'));
    root.appendChild(card);
    if (focusSel) root.querySelector(focusSel)?.focus({ preventScroll: true });
  }

  /** «راجع بعد انقطاع»: wk.reentry = {startDay: today, weeks: 2}; the 6-week block moves to start right after it. */
  async function toggleReentry(on) {
    const today = ctx.today();
    const prevSetting = ctx.settings.get('wk.reentry') ?? null;
    const prevStart = program.startDay || null;
    if (on) {
      await ctx.settings.set('wk.reentry', { startDay: today, weeks: 2 });
      if (L.programFlags(program).meso) { program.startDay = L.reentryInfo(ctx.settings, today).endDay; await persist(); }
    } else {
      const cur = L.reentryInfo(ctx.settings, today);
      await ctx.settings.set('wk.reentry', null);
      if (L.programFlags(program).meso && cur && program.startDay === cur.endDay) { program.startDay = today; await persist(); }
    }
    ctx.toast(on ? 'تمام · أسبوعين رجوع وبعدهم الدورة' : 'رجعنا للخطة العادية', { action: { label: 'تراجع', run: async () => {
      await ctx.settings.set('wk.reentry', prevSetting);
      if (prevStart) program.startDay = prevStart; else delete program.startDay;
      await persist(); draw('#wk-re');
    } } });
    draw('#wk-re');
  }

  /** «برنامجي القديم»: swap the saved previous plan back in; the current one becomes the saved one. */
  async function restorePrevious() {
    const prev = rec?.previous;
    if (!prev?.program) return;
    const ok = await ctx.confirm({ title: `نرجع لـ «${prev.name || 'برنامجي القديم'}»؟`, text: 'الخطة الحالية هتتحفظ وتقدر ترجعلها من هنا.', confirmLabel: 'ارجع للخطة دي' });
    if (!ok) return;
    const cur = { activeProgram: program.activeProgram, order: program.order, days: program.days, ...(program.schedule ? { schedule: program.schedule } : {}), ...(program.startDay ? { startDay: program.startDay } : {}) };
    const next = L.normalizeProgram({ v: 2, ...prev.program });
    if (!prev.program.schedule) delete next.schedule;
    next.previous = { name: L.PROGRAMS[cur.activeProgram]?.name || 'الخطة الجديدة', savedAt: ctx.today(), program: cur };
    program = next; dayId = program.order[0];
    await persist(); draw();
  }

  async function switchTo(id) {
    if (program.activeProgram === id) return;
    const ok = await ctx.confirm({ title: 'نبدّل الخطة؟', text: 'سجلّك وأرقامك محفوظين. تعديلاتك على الخطة الحالية هتتبدّل.', confirmLabel: 'بدّل الخطة' });
    if (!ok) return;
    const keep = rec?.previous;
    program = L.fromTemplate(id, { startDay: L.PROGRAMS[id]?.meso ? ctx.today() : null }); dayId = program.order[0];
    if (keep) program.previous = keep;
    await persist(); draw();
  }

  async function addItem() {
    const id = await pickExercise(ctx, { exclude: program.days[dayId].items.map((x) => x.lib).filter(Boolean) });
    if (!id) return;
    const it = L.itemFromLib(id);
    const items = program.days[dayId].items;
    if (items.some((x) => x.id === it.id)) it.id = `${it.id}_${Date.now().toString(36)}`;
    items.push(it);
    await persist(); draw('[data-fk="add"]');
  }

  function editItem(i) {
    const items = program.days[dayId].items;
    const it = items[i];
    const setsN = N(String(it.sets));
    const reps = h('input', { id: 'wk-reps', type: 'text', inputmode: 'text', value: it.reps, autocomplete: 'off', 'aria-describedby': 'wk-reps-h' });
    const err = h('p', { class: 'err', id: 'wk-reps-e', hidden: true }, 'اكتب العدّات زي 8-12 أو 10.');
    const restChips = h('div', { class: 'chips', role: 'radiogroup', 'aria-labelledby': 'wk-rest-l' });
    const paintRest = () => {
      restChips.textContent = '';
      for (const v of [0, 60, 90, 120, 150, 180]) restChips.appendChild(h('button', { type: 'button', class: 'chip', role: 'radio', 'aria-checked': String((it.restS || 0) === v),
        onclick: () => { if (v) it.restS = v; else delete it.restS; paintRest(); } }, v ? N(L.fmtClock(v)) : 'تلقائي'));
    };
    paintRest();
    reps.addEventListener('blur', () => { const ok = !!L.parseReps(reps.value) || /ثانية/.test(reps.value); reps.setAttribute('aria-invalid', String(!ok)); err.hidden = ok; });
    reps.addEventListener('input', () => { reps.removeAttribute('aria-invalid'); err.hidden = true; });
    const body = h('div', {},
      h('div', { class: 'field' }, h('span', { class: 'lbl', id: 'wk-sets-l' }, 'المجموعات'),
        h('div', { class: 'step wk-step-sm', role: 'group', 'aria-labelledby': 'wk-sets-l' },
          h('button', { type: 'button', 'aria-label': 'زوّد مجموعة', onclick: () => { it.sets = Math.min(10, it.sets + 1); setsN.textContent = String(it.sets); } }, ico('plus')),
          h('div', {}, setsN),
          h('button', { type: 'button', 'aria-label': 'قلّل مجموعة', onclick: () => { it.sets = Math.max(1, it.sets - 1); setsN.textContent = String(it.sets); } }, ico('minus')))),
      h('div', { class: 'field' }, h('label', { for: 'wk-reps' }, 'العدّات'), reps, h('p', { class: 'hint', id: 'wk-reps-h' }, 'مدى زي 8-12: لما كل المجموعات توصل 12 نقترح تزوّد الوزن.'), err),
      h('div', { class: 'field' }, h('span', { class: 'lbl', id: 'wk-rest-l' }, 'الراحة'),
        restChips),
      h('div', { class: 'btn-row' },
        h('button', { type: 'button', class: 'btn ghost sm', onclick: () => { linkSs(i); api.close(); } }, it.ss ? 'فك السوبر سِت' : (i < items.length - 1 ? 'اربطه سوبر سِت مع اللي بعده' : 'اربطه سوبر سِت مع اللي قبله'))),
      h('div', { class: 'btn-row' },
        h('button', { type: 'button', class: 'btn ghost sm', disabled: i === 0, onclick: () => { move(i, -1); api.close(); } }, 'طلّعه لفوق'),
        h('button', { type: 'button', class: 'btn ghost sm', disabled: i === items.length - 1, onclick: () => { move(i, 1); api.close(); } }, 'نزّله لتحت')));
    const api = ctx.sheet({ title: it.ar, body, actions: [
      { label: 'احفظ', run: async () => {
        const v = reps.value.trim();
        if (!L.parseReps(v) && !/ثانية/.test(v)) { reps.setAttribute('aria-invalid', 'true'); err.hidden = false; reps.focus(); return true; }
        it.reps = v.slice(0, 20); await persist(); draw(`[data-fk="it${i}"]`);
      } },
      { label: 'شيل التمرين من اليوم ده', ghost: true, danger: true, run: async () => {
        const ok = await ctx.confirm({ title: `نشيل ${it.ar}؟`, text: 'سجلّه القديم هيفضل محفوظ.', confirmLabel: 'شيل التمرين', danger: true });
        if (!ok) return;
        items.splice(i, 1); await persist(); draw('[data-fk="add"]');
      } },
    ], onClose: () => { persist(); draw(); } });
  }

  async function linkSs(i) {
    const items = program.days[dayId].items; const it = items[i];
    if (it.ss) { const t = it.ss; items.forEach((x) => { if (x.ss === t) delete x.ss; }); }
    else {
      const j = i < items.length - 1 ? i + 1 : i - 1; if (j < 0) return;
      const tag = items[j].ss || L.nextSsTag(items);
      it.ss = tag; items[j].ss = tag;
    }
    await persist(); draw(`[data-fk="it${i}"]`);
  }

  /** P7: coach drafts a plan → diff → applied only on confirm. Expects an action {type:'workout.plan', days:{id:{name, items:[{en|ar|lib, sets, reps}]}}}. */
  async function aiDraft() {
    // Plan edits now go through the coach's validated, confirm-card actions (workout.swap/sets/add/remove/prefill).
    try { coach.openCoachSheet(ctx, { intent: 'plan_edit', prompt: 'راجع خطتي حسب أدائي الأخير والحجم لكل عضلة، واقترح تعديلات صغيرة لو محتاجة (تبديل، مجموعات، إضافة أو شيل تمرين).' }); }
    catch { ctx.toast('المدرب مش متاح دلوقتي — جرّب تاني.'); }
  }


  async function move(i, d) {
    const items = program.days[dayId].items; const j = i + d;
    if (j < 0 || j >= items.length) return;
    [items[i], items[j]] = [items[j], items[i]];
    await persist(); draw(`[data-fk="it${j}"]`);
  }

  draw();
}

// Confirm cards for coach proposals. Nothing is written until the user presses the confirm button.
import { h, fill } from '../../ui/dom.js';
import { fmt } from '../../ui/num.js';
import { pop } from '../../ui/anim.js';
import { sumEntries, setTargets, validateTargets, withDayTypes, kcalFromMacros } from '../../core/targets.js';
import { SECTIONS, SECTION_LABEL, sectionForHour, entryFromAIItem, newId } from '../nutrition/logic.js';
import { addEntries, getEntries, putEntries, loadCatalog, saveFood } from '../nutrition/data.js';
import { loadTargets } from '../../app/day.js';
import { planChange, applyChange } from '../workout/coach-bridge.js';
import { loadProgram, loadTraining } from '../workout/store.js';
import { isWorkoutAction } from './actions.js';
import { resolveItems, withAmount, withFood, totals, entriesFor, resolveDay } from './foodlog.js';
import { commitEntries, undoEntries, replaceEntries, successText, actionFromEntries, LOG_COPY } from './autolog.js';
import { loadUsage } from '../nutrition/data.js';

const n0 = (v) => h('span', { class: 'num' }, fmt(v));
const TYPE_TITLE = { 'food.log': 'تسجّل الأكل ده؟', log: 'تسجّل الأكل ده؟', adddb: 'تضيف الأكلة دي لأكلاتي؟', goal: 'تغيّر الأهداف؟', delete: 'تمسح التسجيل ده؟', water: 'تسجّل المية؟' };

function shell(action, bodyNodes, confirmLabel, run, { danger = false } = {}) {
  const ok = h('button', { type: 'button', class: `btn sm co-ok${danger ? ' danger' : ''}` }, confirmLabel);
  const no = h('button', { type: 'button', class: 'btn sm ghost' }, 'مش دلوقتي');
  const card = h('div', { class: 'co-card', role: 'group', 'aria-label': TYPE_TITLE[action.type] },
    h('h4', {}, TYPE_TITLE[action.type], h('small', {}, 'مفيش حاجة بتتغيّر من غير موافقتك')), ...bodyNodes, h('div', { class: 'co-acts' }, ok, no));
  const done = (msg, okState = true) => { fill(card, h('p', { class: `co-done${okState ? ' ok' : ''}` }, h('i', { 'aria-hidden': 'true' }), msg)); pop(card); };
  ok.addEventListener('click', async () => {
    ok.disabled = true; no.disabled = true;
    try { const msg = await run(); done(msg); } catch (e) { ok.disabled = false; no.disabled = false; done(e && e.userMessage ? e.userMessage : 'ماقدرناش نحفظ. جرّب تاني.', false); }
  });
  no.addEventListener('click', () => done('ماتغيّرش حاجة', false));
  return card;
}
const fail = (m) => Object.assign(new Error(m), { userMessage: m });

/** actionCard(ctx, action, {said}) → element. */
export function actionCard(ctx, action, { said = '', key = null, onLogged = null, onChange = null } = {}) {
  const day = ctx.today();
  if (action.type === 'food.log') return foodLogCard(ctx, action, { said, key, onLogged, onChange });
  if (action.type === 'log') {
    // legacy proposal shape → the same editable card
    const named = SECTIONS.find((x) => said.includes(x.label));
    const meal = action.section || (named ? named.key : null);
    return foodLogCard(ctx, { type: 'food.log', day: 'today', meal, items: action.items.map((it) => ({ ...it, meal })) }, { said, key, onLogged, onChange });
  }
  if (action.type === 'adddb') {
    const f = action.food;
    return shell(action, [h('div', { class: 'co-row' }, h('span', {}, h('b', {}, f.name), ' ', h('em', {}, 'لكل ', n0(f.per), ` ${f.unit}`)),
      h('span', {}, n0(f.kcal), h('small', {}, ' سعرة · '), n0(f.p), h('small', {}, ' ب · '), n0(f.c), h('small', {}, ' ك · '), n0(f.f), h('small', {}, ' د')))],
    'ضيفها لأكلاتي', async () => {
      await saveFood(ctx.db, { id: newId('f'), name: f.name, kcal: f.kcal, p: f.p, c: f.c, f: f.f, fiber: f.fiber || undefined, per: f.per, unit: f.unit, cat: 'custom', src: 'coach' });
      ctx.emit('food:changed', { day, foods: true });
      return `«${f.name}» اتضافت لأكلاتي`;
    });
  }
  if (action.type === 'goal') return goalCard(ctx, action);
  if (isWorkoutAction(action)) return workoutCard(ctx, action);
  if (action.type === 'delete') {
    const box = h('div', {}, h('p', { class: 'co-hint' }, 'بندوّر على التسجيل…'));
    let entry = null;
    const card = shell(action, [box], 'امسح التسجيل', async () => {
      const cur = await getEntries(ctx.db, day);
      const e = cur.find((x) => x.id === action.entryId);
      if (!e) throw fail('التسجيل ده مش موجود النهارده.');
      await putEntries(ctx.db, day, cur.filter((x) => x.id !== action.entryId));
      ctx.emit('food:changed', { day });
      ctx.toast(`اتمسح «${e.name}»`, { action: { label: 'تراجع', run: async () => { const now = await getEntries(ctx.db, day); await putEntries(ctx.db, day, [...now, e]); ctx.emit('food:changed', { day }); } } });
      return `اتمسح «${e.name}»`;
    }, { danger: true });
    getEntries(ctx.db, day).then((cur) => {
      entry = cur.find((x) => x.id === action.entryId);
      if (!entry) { fill(box, h('p', { class: 'co-hint' }, 'التسجيل ده مش موجود النهارده.')); card.querySelector('.co-ok').disabled = true; return; }
      fill(box, h('div', { class: 'co-row' }, h('span', {}, h('b', {}, entry.name), ' ', h('em', {}, SECTION_LABEL[entry.section] || '')), h('span', {}, n0(entry.kcal), h('small', {}, ' سعرة'))));
      card.querySelector('.co-ok').textContent = `امسح «${entry.name}»`;
    });
    return card;
  }
  if (action.type === 'water') {
    return shell(action, [h('div', { class: 'co-row' }, h('span', {}, 'مية'), h('span', {}, '+', n0(action.ml), h('small', {}, ' مل')))], `سجّل ${fmt(action.ml)} مل`, async () => {
      const cur = (await ctx.db.get('daily', day).catch(() => null)) || { day };
      await ctx.db.put('daily', { ...cur, day, waterMl: Math.max(0, (+cur.waterMl || 0) + action.ml) });
      ctx.emit('food:changed', { day, water: true });
      return `اتسجّل ${fmt(action.ml)} مل مية`;
    });
  }
  return h('p', { class: 'co-hint' }, 'اقتراح مش مفهوم.');
}

// ───────── food.log: editable list (food from the DB or «تقدير», amount, meal), totals, «سجّل» → foodLog, undo ─────────
const dayLabelOf = (d, today) => (d === today ? 'النهارده' : d === addDaysLocal(today, -1) ? 'امبارح' : d);
function addDaysLocal(day, n) { const t = new Date(`${day}T12:00:00`); t.setDate(t.getDate() + n); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`; }

/**
 * Editable food.log card (confirm mode «أكّد قبل تسجيل الأكل», a proposal the user did not ask to log, or «عدّل»).
 * key: idempotency key (user message id). replace: {ids} → «عدّل» swaps those rows. onLogged(result): after a VERIFIED write.
 * onCancel: «مش دلوقتي» handler (the «عدّل» card restores the logged line).
 */
export function foodLogCard(ctx, action, { said = '', key = null, replace = null, onLogged = null, onCancel = null, onChange = null } = {}) {
  const today = ctx.today();
  const day = resolveDay(action.day, today);
  const named = SECTIONS.find((x) => said.includes(x.label));
  const meal0 = action.meal || (named ? named.key : null);
  let rows = [];
  const listBox = h('div', { class: 'co-flist' }, h('p', { class: 'co-hint' }, 'بندوّر في أكلاتك…'));
  const totalBox = h('div', { class: 'co-row co-total', 'aria-live': 'polite' });
  const ok = h('button', { type: 'button', class: 'btn sm co-ok', disabled: true }, 'سجّل');
  const no = h('button', { type: 'button', class: 'btn sm ghost' }, 'مش دلوقتي');
  const card = h('div', { class: 'co-card co-fl', role: 'group', 'aria-label': 'تسجيل أكل', dataset: { type: 'food.log' } },
    h('h4', {}, replace ? `عدّل التسجيل${day === today ? '' : ` (${dayLabelOf(day, today)})`}` : `تسجّل الأكل ده${day === today ? '' : ` (${dayLabelOf(day, today)})`}؟`, h('small', {}, 'عدّل الكميات أو الوجبة قبل التسجيل')), listBox, totalBox, h('div', { class: 'co-acts' }, ok, no));
  const uid = Math.random().toString(36).slice(2, 7);
  const drawTotal = () => {
    const t = totals(rows); const est = rows.some((r) => r.est && !r.invalid);
    fill(totalBox, h('span', {}, 'المجموع', est ? h('i', { class: 'co-est' }, 'تقدير') : null), h('span', {}, n0(t.kcal), h('small', {}, ' سعرة · '), n0(t.p), h('small', {}, ' بروتين · '), n0(t.c), h('small', {}, ' كارب · '), n0(t.f), h('small', {}, ' دهون')));
    const live = rows.filter((r) => !r.invalid && r.amount > 0);
    ok.disabled = !live.length;
    ok.textContent = replace ? 'احفظ التعديل' : live.length ? `سجّل ${live.length > 1 ? `${live.length} أكلات` : ''}`.trim() : 'سجّل';
  };
  const draw = () => {
    listBox.textContent = '';
    if (!rows.length) { listBox.append(h('p', { class: 'co-hint' }, 'مفيش أكلات في القائمة.')); drawTotal(); return; }
    rows.forEach((r, i) => {
      const mac = h('p', { class: 'co-fmac' });
      const setMac = () => fill(mac, r.invalid ? h('span', { class: 'co-err' }, 'الكمية من 1 لـ 5000') : [n0(r.kcal), ' سعرة · ', n0(r.p), ' ب · ', n0(r.c), ' ك · ', n0(r.f), ' د', r.est ? h('i', { class: 'co-est' }, 'تقدير') : null]);
      setMac();
      const amt = h('input', { type: 'number', inputmode: 'decimal', min: '1', max: '5000', step: 'any', value: String(r.amount), id: `co-fa-${uid}-${i}`, 'aria-label': `كمية ${r.name} (${r.unit})` });
      amt.addEventListener('input', () => { rows[i] = withAmount(rows[i], amt.value); r = rows[i]; setMac(); drawTotal(); });
      const meal = h('select', { 'aria-label': `وجبة ${r.name}` }, ...SECTIONS.map((x) => h('option', { value: x.key, selected: x.key === r.meal }, x.label)));
      meal.addEventListener('change', () => { rows[i] = { ...rows[i], meal: meal.value }; });
      const opts = [...(r.alts || []).map((f, k) => h('option', { value: String(k), selected: r.food === f }, f.name)), ...(r.hasEst || !(r.alts || []).length ? [h('option', { value: 'est', selected: !r.food }, `${r.name} (تقدير المدرب)`)] : [])];
      const pick = opts.length > 1 ? h('select', { class: 'co-fpick', 'aria-label': `نوع ${r.name}` }, ...opts) : null;
      if (pick) pick.addEventListener('change', () => { rows[i] = withFood(rows[i], pick.value === 'est' ? null : rows[i].alts[+pick.value]); draw(); });
      const rm = h('button', { type: 'button', class: 'co-x', 'aria-label': `شيل ${r.name}` }, '×');
      rm.addEventListener('click', () => { rows.splice(i, 1); draw(); });
      listBox.append(h('div', { class: 'co-frow' },
        h('div', { class: 'co-fname' }, h('b', {}, r.food ? r.food.name : r.name), pick || h('small', {}, r.food ? 'من أكلاتك' : 'مش في أكلاتك'), ),
        h('label', { class: 'co-famt' }, amt, h('small', {}, ` ${r.unit}`)), meal, rm, mac));
    });
    drawTotal();
  };
  (async () => {
    try {
      const [{ list }, usage] = await Promise.all([loadCatalog(ctx.db), loadUsage(ctx.db, today).catch(() => null)]);
      rows = resolveItems(action.items, list, { usage, meal: meal0 });
    } catch { rows = resolveItems(action.items, [], { meal: meal0 }); }
    draw();
  })();
  const finish = (nodes, good) => { fill(card, h('div', { class: `co-done${good ? ' ok' : ''}` }, h('i', { 'aria-hidden': 'true' }), ...nodes)); pop(card); };
  const errBox = h('p', { class: 'co-err co-wfail', role: 'alert', hidden: true });
  card.insertBefore(errBox, card.querySelector('.co-acts'));
  ok.addEventListener('click', async () => {
    ok.disabled = true; no.disabled = true; errBox.hidden = true;
    const entries = entriesFor(rows).map((e) => ({ ...e, src: 'coach' }));
    if (!entries.length) { ok.disabled = false; no.disabled = false; return; }
    let res;
    try { res = replace ? await replaceEntries(ctx.db, day, replace.ids, entries, key) : await commitEntries(ctx.db, day, entries, key); }
    catch { ok.disabled = false; no.disabled = false; errBox.textContent = LOG_COPY.writeFail; errBox.hidden = false; ok.textContent = 'حاول تاني'; return; }
    ctx.emit('food:changed', { day });
    const line = loggedLine(ctx, res, { key, said, onChange });
    card.replaceWith(line);
    if (onLogged) onLogged(res, line);
  });
  no.addEventListener('click', () => (onCancel ? onCancel(card) : finish([h('span', {}, 'ماتغيّرش حاجة')], false)));
  return card;
}

/**
 * The app's own success line, shown ONLY for a verified write: «✅ اتسجل في الفطار: … · 721 سعر · 57 بروتين» + «تراجع» + «عدّل».
 * Undo / edit are verified the same way; a failure is shown with a retry, never as success.
 */
/** onChange(kind 'undo' | 'edit', result): lets the chat keep its saved note in step with the DB. */
export function loggedLine(ctx, res, { key = null, said = '', onChange = null } = {}) {
  const today = ctx.today();
  const msg = h('span', { class: 'grow co-logtxt' }, successText(res, today));
  const err = h('span', { class: 'co-err', role: 'alert', hidden: true });
  const undoB = h('button', { type: 'button', class: 'btn sm ghost co-undo' }, 'تراجع');
  const editB = h('button', { type: 'button', class: 'btn sm ghost co-edit' }, 'عدّل');
  const box = h('div', { class: 'co-logged co-done ok', role: 'status', dataset: { day: res.day, ids: res.entries.map((e) => e.id).join(' '), ik: key || '' } },
    h('i', { 'aria-hidden': 'true' }), msg, h('span', { class: 'co-acts' }, undoB, editB), err);
  let busy = false; let edits = 0;
  undoB.addEventListener('click', async () => {
    if (busy) return; busy = true; err.hidden = true;
    try { await undoEntries(ctx.db, res.day, res.entries.map((e) => e.id)); }
    catch { busy = false; err.textContent = LOG_COPY.undoFail; err.hidden = false; return; }
    ctx.emit('food:changed', { day: res.day });
    fill(box, h('i', { 'aria-hidden': 'true' }), h('span', { class: 'grow' }, LOG_COPY.undone));
    box.classList.remove('ok'); box.classList.add('co-undone'); box.dataset.ids = '';
    if (onChange) onChange('undo', res);
  });
  editB.addEventListener('click', () => {
    if (busy) return;
    edits += 1;
    const card = foodLogCard(ctx, actionFromEntries(res), { said, key: key ? `${key}:e${edits}` : null, replace: { ids: res.entries.map((e) => e.id) },
      onCancel: (c) => c.replaceWith(box), onChange, onLogged: (r2) => { if (onChange) onChange('edit', r2); } });
    box.replaceWith(card);
  });
  return box;
}

// ───────── plan / targets proposals: before → after diff, «طبّق» / «لا», Undo with the exact snapshot ─────────
const DAY_LABEL = { training: 'يوم التمرين', rest: 'يوم الراحة', heart: 'يوم القلب' };
const W_TITLE = { 'workout.prefill': 'أوزان الحصة الجاية؟', 'workout.swap': 'تبدّل التمرين؟', 'workout.sets': 'تغيّر المجموعات؟',
  'workout.addExercise': 'تضيف تمرين؟', 'workout.removeExercise': 'تشيل تمرين؟', 'workout.deload': 'تعمل أسبوع ديلود؟', goal: 'تغيّر الأهداف؟' };
const STATUS = { under: 'أقل من الأدنى', in: 'في المدى', high: 'عالي', over: 'فوق الأقصى' };
const fmtN = (v) => h('bdi', { dir: typeof v === 'number' || /^[\d.,×·\s\-—]+$/.test(String(v ?? '')) ? 'ltr' : 'auto' }, typeof v === 'number' ? fmt(v) : String(v ?? ''));

function diffRow(r) {
  const before = r.before === '' || r.before === undefined ? null : h('s', { class: 'co-b' }, fmtN(r.before));
  return h('div', { class: 'co-row co-diff' }, h('span', { class: 'co-l' }, h('b', {}, r.label), r.note ? h('em', {}, ` ${r.note}`) : null),
    h('span', { class: 'co-ba', dir: 'rtl' }, before, before ? h('small', { 'aria-hidden': 'true' }, ' ← ') : null, before ? h('span', { class: 'vh' }, ' بقى ') : null, h('b', { class: 'co-a' }, fmtN(r.after))));
}
function musclesTable(rows) {
  if (!rows.length) return null;
  return h('div', { class: 'co-mus', role: 'table', 'aria-label': 'المجموعات في الأسبوع لكل عضلة' },
    h('div', { class: 'co-mus-h', role: 'row' }, h('span', { role: 'columnheader' }, 'العضلة'), h('span', { role: 'columnheader' }, 'في الأسبوع'), h('span', { role: 'columnheader' }, 'المدى')),
    ...rows.map((m) => h('div', { class: `co-mus-r s-${m.status}`, role: 'row' },
      h('span', { role: 'cell' }, m.muscle),
      h('span', { role: 'cell' }, n0(m.before), h('small', { 'aria-hidden': 'true' }, ' ← '), h('b', {}, n0(m.after))),
      h('span', { role: 'cell' }, h('bdi', { dir: 'ltr' }, n0(m.mev), '–', n0(m.mrv)), ' ', h('i', { class: 'co-pill' }, STATUS[m.status])))));
}

/**
 * proposalCard(ctx, {type, title, load, apply}): load() → preview {ok, error?, sub?, rows, muscles, warnings, ack, reason};
 * apply(ack) → {ok, message, undo} | {ok:false, error}. Nothing is written before the «طبّق» tap.
 */
function proposalCard(ctx, { type, load, apply, reason = '' }) {
  const ok = h('button', { type: 'button', class: 'btn sm co-ok', disabled: true }, 'طبّق');
  const no = h('button', { type: 'button', class: 'btn sm ghost' }, 'لا');
  const body = h('div', { class: 'co-pbody' }, h('p', { class: 'co-hint' }, 'بنجهّز المقارنة…'));
  const card = h('div', { class: 'co-card co-prop', role: 'group', 'aria-label': W_TITLE[type], dataset: { type } },
    h('h4', {}, W_TITLE[type], h('small', {}, 'مفيش حاجة بتتغيّر من غير موافقتك')), body, h('div', { class: 'co-acts' }, ok, no));
  let needAck = false; let ackBox = null;
  const done = (nodes, good) => { fill(card, h('div', { class: `co-done${good ? ' ok' : ''}` }, h('i', { 'aria-hidden': 'true' }), ...nodes)); pop(card); };
  (async () => {
    let pv; try { pv = await load(); } catch { pv = { ok: false, error: 'ماقدرناش نقرا خطتك. جرّب تاني.' }; }
    const why = pv.reason || reason;
    if (!pv.ok) { fill(body, h('p', { class: 'co-err', role: 'alert' }, pv.error), why ? h('p', { class: 'co-why' }, h('b', {}, 'سبب المدرب: '), why) : null); ok.disabled = true; ok.hidden = true; no.textContent = 'تمام'; return; }
    needAck = !!pv.ack;
    ackBox = needAck ? h('input', { type: 'checkbox', id: `co-ack-${Math.random().toString(36).slice(2, 8)}` }) : null;
    fill(body, pv.sub ? h('p', { class: 'co-sub' }, pv.sub) : null, ...pv.rows.map(diffRow), musclesTable(pv.muscles || []),
      why ? h('p', { class: 'co-why' }, h('b', {}, 'سبب المدرب: '), why) : null,
      ...(pv.warnings || []).map((w) => h('p', { class: 'co-warn', role: 'note' }, w)),
      needAck ? h('label', { class: 'co-ackl', for: ackBox.id }, ackBox, h('span', {}, pv.ack)) : null);
    ok.disabled = needAck;
    if (ackBox) ackBox.addEventListener('change', () => { ok.disabled = !ackBox.checked; });
  })();
  ok.addEventListener('click', async () => {
    if (needAck && !(ackBox && ackBox.checked)) return;
    ok.disabled = true; no.disabled = true;
    let r; try { r = await apply(needAck && ackBox.checked); } catch { r = { ok: false, error: 'ماقدرناش نحفظ. جرّب تاني.' }; }
    if (!r.ok) { ok.disabled = false; no.disabled = false; const p = body.querySelector('.co-err.apply') || body.appendChild(h('p', { class: 'co-err apply', role: 'alert' })); p.textContent = r.error; return; }
    let undone = false;
    const undo = async () => {
      if (undone) return; undone = true;
      try { await r.undo(); done([h('span', {}, 'رجّعنا زي ما كان')], false); } catch { undone = false; ctx.toast('ماقدرناش نرجّع. جرّب تاني.'); }
    };
    done([h('span', { class: 'grow' }, r.message), h('button', { type: 'button', class: 'btn sm ghost co-undo', onclick: undo }, 'تراجع')], true);
    ctx.toast(r.message, { action: { label: 'تراجع', run: undo } });
  });
  no.addEventListener('click', () => done([h('span', {}, 'ماتغيّرش حاجة')], false));
  return card;
}

/** workout.* proposals: diff from workout/coach-bridge planChange, write via applyChange. */
export function workoutCard(ctx, action) {
  return proposalCard(ctx, {
    type: action.type, reason: action.reason || '',
    load: async () => {
      const [{ program }, training] = await Promise.all([loadProgram(ctx.db), loadTraining(ctx.db)]);
      const pv = planChange(program, action, { training, today: ctx.today(), weekStartDow: ctx.settings.get('weekStart') ?? 1 });
      if (pv.ok) {
        const mins = pv.minutes && pv.minutes.before !== pv.minutes.after ? ` · حوالي ${pv.minutes.before} ← ${pv.minutes.after} دقيقة` : '';
        pv.sub = pv.dayName ? `${pv.dayName}${mins}` : '';
      }
      return pv;
    },
    apply: (ack) => applyChange(ctx, action, { ack }),
  });
}

const MACRO = { kcal: 'سعرات', p: 'بروتين', c: 'كارب', f: 'دهون' };
/** targets.set / goal for training | rest | heart, with the kcal ≈ 4P+4C+9F mismatch warning. */
export function goalCard(ctx, action) {
  const merged = (cur) => ({ ...cur[action.dayType], ...action.values });
  return proposalCard(ctx, {
    type: 'goal', reason: action.reason || '',
    load: async () => {
      const cur = withDayTypes(await loadTargets(ctx.db));
      const next = merged(cur); const v = validateTargets(next);
      if (v.issues.some((i) => i.code !== 'kcal_mismatch')) return { ok: false, error: 'الأرقام دي برّه المدى المسموح. ماتغيّرش حاجة.' };
      const old = cur[action.dayType];
      const warnings = v.issues.some((i) => i.code === 'kcal_mismatch')
        ? [[`السعرات (${fmt(next.kcal)}) مش متوافقة مع الماكروز: `, h('bdi', { dir: 'ltr', class: 'co-eq' }, `4×${fmt(next.p)} + 4×${fmt(next.c)} + 9×${fmt(next.f)} = ${fmt(kcalFromMacros(next))}`)]] : [];
      return { ok: true, sub: DAY_LABEL[action.dayType], rows: ['kcal', 'p', 'c', 'f'].filter((k) => k in action.values).map((k) => ({ label: MACRO[k], before: old[k], after: next[k] })), muscles: [], warnings, ack: null };
    },
    apply: async () => {
      const prevRec = await ctx.db.get('kv', 'targets').catch(() => null);
      const cur = withDayTypes(prevRec && prevRec.value && prevRec.value.training ? prevRec.value : null);
      const res = setTargets(cur, action.dayType, merged(cur));
      if (!res.saved) return { ok: false, error: 'الأرقام دي برّه المدى المسموح. ماتغيّرش حاجة.' };
      const snap = prevRec ? JSON.parse(JSON.stringify(prevRec)) : null;
      await ctx.db.put('kv', { key: 'targets', value: { ...((prevRec && prevRec.value) || {}), training: res.targets.training, rest: res.targets.rest, heart: res.targets.heart, isDefault: false } });
      ctx.emit('settings:changed', { key: 'targets' });
      return { ok: true, message: `أهداف ${DAY_LABEL[action.dayType]} اتغيّرت`,
        undo: async () => { if (snap) await ctx.db.put('kv', snap); else await ctx.db.delete('kv', 'targets'); ctx.emit('settings:changed', { key: 'targets' }); } };
    },
  });
}

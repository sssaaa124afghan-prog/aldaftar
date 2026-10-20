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

const n0 = (v) => h('span', { class: 'num' }, fmt(v));
const TYPE_TITLE = { log: 'تسجّل الأكل ده؟', adddb: 'تضيف الأكلة دي لأكلاتي؟', goal: 'تغيّر الأهداف؟', delete: 'تمسح التسجيل ده؟', water: 'تسجّل المية؟' };

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
export function actionCard(ctx, action, { said = '' } = {}) {
  const day = ctx.today();
  if (action.type === 'log') {
    const named = SECTIONS.find((x) => said.includes(x.label));
    let section = action.section || (named ? named.key : sectionForHour(new Date().getHours()));
    const tot = sumEntries(action.items);
    const chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'الوجبة' });
    let card;
    const draw = () => { chips.textContent = ''; for (const s of SECTIONS) chips.appendChild(h('button', { type: 'button', class: 'chip', 'aria-pressed': String(s.key === section), onclick: () => { section = s.key; draw(); const b = card.querySelector('.co-ok'); if (b) b.textContent = `سجّل في ${SECTION_LABEL[section]}`; } }, s.label)); };
    draw();
    card = shell(action, [
      ...action.items.map((it) => h('div', { class: 'co-row' }, h('span', {}, h('b', {}, it.name), ' ', h('em', {}, n0(it.grams), ' جم')), h('span', {}, n0(it.kcal), h('small', {}, ' سعرة · '), n0(it.p), h('small', {}, ' بروتين')))),
      h('div', { class: 'co-row co-total' }, h('span', {}, 'المجموع'), h('span', {}, n0(tot.kcal), h('small', {}, ' سعرة · '), n0(tot.p), h('small', {}, ' بروتين'))),
      chips], `سجّل في ${SECTION_LABEL[section]}`, async () => {
      const { list } = await loadCatalog(ctx.db);
      const entries = action.items.map((it) => entryFromAIItem(it, section, list)).map(({ matched, ...e }) => ({ ...e, src: 'coach' }));
      if (!(await addEntries(ctx, day, entries, `اتسجّل في ${SECTION_LABEL[section]}`))) throw fail('ماقدرناش نسجّل. جرّب تاني.');
      return `اتسجّل في ${SECTION_LABEL[section]} · ${fmt(tot.kcal)} سعرة`;
    });
    return card;
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

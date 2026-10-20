// Confirm cards for coach proposals. Nothing is written until the user presses the confirm button.
import { h, fill } from '../../ui/dom.js';
import { fmt } from '../../ui/num.js';
import { pop } from '../../ui/anim.js';
import { sumEntries, setTargets } from '../../core/targets.js';
import { SECTIONS, SECTION_LABEL, sectionForHour, entryFromAIItem, newId } from '../nutrition/logic.js';
import { addEntries, getEntries, putEntries, loadCatalog, saveFood } from '../nutrition/data.js';
import { loadTargets } from '../../app/day.js';

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
  if (action.type === 'goal') {
    const box = h('div', { class: 'co-goal' }, h('p', { class: 'co-hint' }, 'بنجيب أهدافك الحالية…'));
    const card = shell(action, [box], 'غيّر الأهداف', async () => {
      const cur = await loadTargets(ctx.db);
      const res = setTargets({ training: cur.training, rest: cur.rest }, action.dayType, { ...cur[action.dayType], ...action.values });
      if (!res.saved) throw fail('الأرقام دي برّه المدى المسموح. ماتغيّرش حاجة.');
      const prevKv = await ctx.db.get('kv', 'targets').catch(() => null);
      await ctx.db.put('kv', { key: 'targets', value: { ...((prevKv && prevKv.value) || {}), training: res.targets.training, rest: res.targets.rest, isDefault: false } });
      ctx.emit('settings:changed', { key: 'targets' });
      return `أهداف ${action.dayType === 'training' ? 'يوم التمرين' : 'يوم الراحة'} اتغيّرت`;
    });
    loadTargets(ctx.db).then((cur) => {
      const old = cur[action.dayType];
      const L = { kcal: 'سعرات', p: 'بروتين', c: 'كارب', f: 'دهون' };
      fill(box, h('p', { class: 'co-hint' }, action.dayType === 'training' ? 'يوم التمرين' : 'يوم الراحة'),
        ...Object.keys(action.values).map((k) => h('div', { class: 'co-row' }, h('span', {}, L[k]), h('span', {}, n0(old[k]), h('small', {}, ' ← '), h('b', {}, n0(action.values[k]))))));
    }).catch(() => {});
    return card;
  }
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

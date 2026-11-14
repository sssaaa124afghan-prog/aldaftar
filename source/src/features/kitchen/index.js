// «المطبخ»: recipe library filtered by what is in the house, fitted to macros in cookable quantities, a step-by-step
// cooking mode, and «طبخت» → containers that log in one tap. Numbers come only from ingredients.js (logic.js › macros).
// State lives in kv 'kitchen': {pantry: [ids], seen: {recipeId: {cooked, liked}}, last: {recipeId: {...}}, boxes: [...]}.
import '../nutrition/nutrition.css';
import './kitchen.css';
import { h, fill } from '../../ui/dom.js';
import { fmt } from '../../ui/num.js';
import { addDays } from '../../core/date.js';
import { sumEntries } from '../../core/targets.js';
import { keepAwake } from '../../core/alerts.js';
import { newId } from '../nutrition/logic.js';
import { kvGet, kvPatch, getEntries, addEntries, dayTarget, shortDay } from '../nutrition/data.js';
import { I, n0, topBar, card, field, segChips } from '../nutrition/ui.js';
import { INGREDIENTS, ING, ING_GROUPS } from './ingredients.js';
import { RECIPES, CATS, TOOL_LABEL } from './recipes.js';
import { fit, servingMacros, lines, matchPantry, remainingTarget, isFixed, isQuick, isCheap, totalMin, FRIDGE_DAYS } from './logic.js';
import { KV, byId, macroLine, count, timeText, entryOf } from './shared.js';
import { weekScreen, todayPlanCard } from './week-ui.js';


// ═════════════════════════ #/kitchen ═════════════════════════
async function homeScreen(el, ctx, params) {
  let st = await kvGet(ctx.db, KV);
  let cat = CATS.some((c) => c.value === params.c) ? params.c : 'all';
  const on = { quick: false, cheap: false, prep: false };
  const list = h('div', { class: 'kt-list' });
  const boxesHost = h('div', {});
  const planHost = h('div', {});
  const pantryBtn = h('button', { type: 'button', class: 'kt-tool', onclick: pantrySheet });

  function paintPantryBtn() {
    const n = (st.pantry || []).length;
    pantryBtn.textContent = '';
    fill(pantryBtn, I('check'), h('span', {}, h('b', {}, 'عندي إيه؟'), h('small', {}, n ? `${fmt(n)} مكوّن متعلّم عليهم` : 'علّم على اللي في البيت')));
  }

  function paintBoxes() {
    boxesHost.textContent = '';
    const boxes = (st.boxes || []).filter((b) => b && b.left > 0);
    if (!boxes.length) return;
    const today = ctx.today();
    const c = card({ title: 'علبك الجاهزة', cls: 'kt-boxes' });
    for (const b of boxes) {
      const late = !b.frozen && today > b.useBy;
      c.appendChild(h('div', { class: 'kt-box' },
        h('div', { class: 'grow' }, h('b', {}, b.name), h('small', {}, `باقي ${count(b.left, b.unit)} · `, n0(b.per.kcal), ' سعرة · ', n0(b.per.p), ' بروتين'),
          h('small', { class: late ? 'kt-late' : '' }, b.frozen ? 'في الفريزر' : late ? `عدّت ${fmt(FRIDGE_DAYS)} أيام في التلاجة: ماتاكلهاش لو مش متجمدة` : `في التلاجة لحد ${shortDay(b.useBy)}`)),
        h('button', { type: 'button', class: 'btn sm', disabled: late, onclick: () => eatBox(b) }, 'أكلتها'),
        h('button', { type: 'button', class: 'nu-ib', 'aria-label': `خيارات ${b.name}`, onclick: () => boxMenu(b) }, I('more'))));
    }
    boxesHost.appendChild(c);
  }
  async function eatBox(b) {
    const ok = await addEntries(ctx, ctx.today(), [entryOf(b.name, b.unit, b.per)], `اتسجّلت ${b.unit} «${b.name}» · ${fmt(b.per.kcal)} سعرة`);
    if (!ok) return;
    st = await kvPatch(ctx.db, KV, (k) => ({ ...k, boxes: (k.boxes || []).map((x) => (x.id === b.id ? { ...x, left: x.left - 1 } : x)).filter((x) => x.left > 0) }));
    paintBoxes();
  }
  function boxMenu(b) {
    const set = async (fn) => { st = await kvPatch(ctx.db, KV, (k) => ({ ...k, boxes: fn(k.boxes || []) })); api.close(); paintBoxes(); };
    const body = h('div', { class: 'kt-sheet' },
      h('button', { type: 'button', class: 'btn ghost', onclick: () => set((bs) => bs.map((x) => (x.id === b.id ? { ...x, frozen: !x.frozen, useBy: x.frozen ? addDays(ctx.today(), 1) : x.useBy } : x))) }, b.frozen ? 'طلّعتها من الفريزر (تتاكل خلال يوم)' : 'حطيتها في الفريزر'),
      h('button', { type: 'button', class: 'btn ghost', onclick: () => set((bs) => bs.map((x) => (x.id === b.id ? { ...x, left: x.left - 1 } : x)).filter((x) => x.left > 0)) }, `${b.unit} راحت من غير تسجيل`),
      h('button', { type: 'button', class: 'btn ghost danger', onclick: () => set((bs) => bs.filter((x) => x.id !== b.id)) }, 'شيلها كلها من القائمة'));
    const api = ctx.sheet({ title: b.name, body });
  }

  function pantrySheet() {
    const have = new Set(st.pantry || []);
    const body = h('div', { class: 'kt-pantry' }, h('p', { class: 'nu-fine' }, 'علّم على اللي موجود في البيت. الوصفات هتترتب بالأقرب، وهيتكتب على كل وصفة الناقص منها. التوابل مش محسوبة.'));
    for (const g of ING_GROUPS) {
      body.appendChild(h('h3', {}, g));
      const row = h('div', { class: 'chips' });
      for (const ing of INGREDIENTS.filter((x) => x.group === g)) {
        const b = h('button', { type: 'button', class: 'chip', 'aria-pressed': String(have.has(ing.id)), onclick: () => { if (have.has(ing.id)) have.delete(ing.id); else have.add(ing.id); b.setAttribute('aria-pressed', String(have.has(ing.id))); } }, ing.name);
        row.appendChild(b);
      }
      body.appendChild(row);
    }
    const api = ctx.sheet({ title: 'عندي إيه؟', body, actions: [{ label: 'رتّب الوصفات', run: async () => {
      st = await kvPatch(ctx.db, KV, (k) => ({ ...k, pantry: [...have] }));
      api.close(); paintPantryBtn(); paint();
    } }] });
  }

  function paint() {
    list.textContent = '';
    const pool = RECIPES.filter((r) => (cat === 'all' || r.cat === cat) && (!on.quick || isQuick(r)) && (!on.cheap || isCheap(r)) && (!on.prep || r.prep));
    const rows = matchPantry(pool, st.pantry || []);
    if (!rows.length) { list.appendChild(h('p', { class: 'placeholder' }, 'مفيش وصفة بالشروط دي. شيل فلتر.')); return; }
    const hasPantry = (st.pantry || []).length > 0;
    for (const { recipe: r, missing } of rows) {
      const m = servingMacros(r);
      const seen = (st.seen || {})[r.id] || {};
      list.appendChild(h('a', { class: 'kt-card', href: `#/kitchen/r?${new URLSearchParams({ id: r.id })}` },
        h('div', { class: 'kt-card-h' }, h('b', {}, r.name), seen.liked ? h('span', { class: 'kt-liked', 'aria-label': 'عجبتني' }, I('heart', { size: 16 })) : null),
        h('small', { class: 'kt-meta' }, I('timer', { size: 14 }), ` ${timeText(r)} · ${TOOL_LABEL[r.tool]}`),
        h('small', {}, isFixed(r) ? `${r.unit}: ` : 'الحصة: ', macroLine(m)),
        h('div', { class: 'kt-tags' },
          isCheap(r) ? h('span', { class: 'kt-tag' }, 'رخيصة') : null,
          r.prep ? h('span', { class: 'kt-tag' }, 'تنفع تحضير') : null,
          seen.cooked ? null : h('span', { class: 'kt-tag is-new' }, 'لسه ماجربتهاش'),
          hasPantry ? h('span', { class: `kt-tag ${missing.length ? 'is-miss' : 'is-ok'}` }, missing.length ? `ناقصك: ${missing.slice(0, 3).join('، ')}${missing.length > 3 ? ` و${fmt(missing.length - 3)} كمان` : ''}` : 'كل المكوّنات عندك') : null)));
    }
  }

  const toggle = (key, label) => { const b = h('button', { type: 'button', class: 'chip', 'aria-pressed': 'false', onclick: () => { on[key] = !on[key]; b.setAttribute('aria-pressed', String(on[key])); paint(); } }, label); return b; };
  el.append(
    topBar(ctx, { title: 'المطبخ', sub: 'وصفات على قد ماكروزك، بسخان عين واحدة وايرفراير', backTo: ['nutrition'] }),
    h('div', { class: 'kt-wrap' },
      planHost,
      boxesHost,
      h('a', { class: 'nu-kitchen kt-weeklink', href: '#/kitchen/week' }, I('calendar'), h('span', { class: 'grow' }, h('b', {}, 'خطة الأسبوع'), h('small', {}, st.week ? 'الأيام، المشتريات، وورقة التحضير' : 'اختار وصفتين ويطلعلك الأسبوع والمشتريات')), I('chevron')),
      h('div', { class: 'kt-tools' }, pantryBtn,
        h('a', { class: 'kt-tool', href: '#/nutrition/recipes' }, I('edit'), h('span', {}, h('b', {}, 'وصفاتي'), h('small', {}, 'اكتب وصفتك من مكوّناتك')))),
      segChips(CATS, cat, (v) => { cat = v; paint(); }, 'نوع الوصفة'),
      h('div', { class: 'chips', role: 'group', 'aria-label': 'فلاتر' }, toggle('quick', 'سريعة'), toggle('cheap', 'رخيصة'), toggle('prep', 'تحضير أسبوعي')),
      list));
  paintPantryBtn(); paintBoxes(); paint();
  todayPlanCard(ctx, planHost).catch(() => {});
}

// ═════════════════════════ #/kitchen/r?id= ═════════════════════════
async function recipeScreen(el, ctx, params) {
  const r = byId(params.id);
  if (!r) { el.append(topBar(ctx, { title: 'المطبخ', backTo: ['kitchen'] }), h('p', { class: 'placeholder' }, 'الوصفة دي مش موجودة.')); return; }
  const fixed = isFixed(r);
  const today = ctx.today();
  const [st, t, entries] = await Promise.all([kvGet(ctx.db, KV), dayTarget(ctx, today), getEntries(ctx.db, today)]);
  const intake = sumEntries(entries);
  const saved = (st.last || {})[r.id] || {};
  let mode = ['asis', 'left', 'custom'].includes(saved.mode) ? saved.mode : 'asis';
  let meals = saved.meals || Math.max(1, Math.min(4, Math.round(Math.max(0, t.kcal - intake.kcal) / 750))); // a full day left → 3-4 meals, not one giant plate
  let times = Math.max(1, Math.min(10, saved.times || 1)); // plates (scalable) or batches (fixed)
  let custom = saved.custom || { kcal: '', p: '', c: '', f: '' };
  let res = fit(r, null);

  const targetNow = () => (mode === 'left' ? remainingTarget(t, intake, meals) : mode === 'custom' ? Object.fromEntries(Object.entries(custom).map(([k, v]) => [k, Number(v) || 0])) : null);
  const persist = () => kvPatch(ctx.db, KV, (k) => ({ ...k, last: { ...(k.last || {}), [r.id]: { mode, meals, times, custom, qty: res.qty, pieces: res.pieces } } })).catch(() => {});

  const fitHost = h('div', { class: 'kt-fit' });
  const out = h('div', {});
  const ingHost = h('div', {});

  function stepper(label, get, set, min, max) {
    const v = h('b', { class: 'num' }, fmt(get()));
    const mk = (d, ic, al) => h('button', { type: 'button', class: 'nu-ib', 'aria-label': al, onclick: () => { const n = Math.max(min, Math.min(max, get() + d)); if (n === get()) return; set(n); v.textContent = fmt(n); compute(); } }, I(ic));
    return h('div', { class: 'kt-step' }, h('span', {}, label), mk(-1, 'minus', `قلّل ${label}`), v, mk(1, 'plus', `زوّد ${label}`));
  }

  function paintFit() {
    fitHost.textContent = '';
    fitHost.appendChild(segChips([{ value: 'asis', label: 'زي ما هي' }, { value: 'left', label: 'الباقي من يومي' }, { value: 'custom', label: 'ماكروز أكتبها' }], mode, (v) => { mode = v; paintFit(); compute(); }, 'ظبط الوصفة على'));
    if (mode === 'left') {
      const left = remainingTarget(t, intake, 1);
      fitHost.appendChild(h('p', { class: 'nu-fine' }, 'باقي النهارده: ', n0(left.kcal), ' سعرة و', n0(left.p), ' جم بروتين.'));
      fitHost.appendChild(stepper('هتاكل كام وجبة كمان؟', () => meals, (n) => { meals = n; }, 1, 4));
    }
    if (mode === 'custom') {
      const row = h('div', { class: 'kt-custom' });
      for (const [k, label] of [['kcal', 'سعرات'], ['p', 'بروتين'], ['c', 'كارب'], ['f', 'دهون']]) {
        const fl = field(`kt-${k}`, label, { type: 'text', inputmode: 'numeric', value: custom[k] || '', placeholder: '—', oninput: (e) => { custom[k] = e.target.value.replace(/[^\d]/g, '').slice(0, 4); compute(); } });
        row.appendChild(fl.el);
      }
      fitHost.appendChild(row);
      fitHost.appendChild(h('p', { class: 'nu-fine' }, 'اكتب اللي يهمك بس (مثلاً السعرات والبروتين) وسيب الباقي فاضي. الأرقام للحصة الواحدة.'));
    }
  }

  function compute() {
    const target = targetNow();
    res = fit(r, target);
    out.textContent = '';
    const m = res.macros;
    const n = fixed ? res.pieces : 1;
    out.appendChild(h('div', { class: 'kt-result' },
      h('small', {}, fixed ? [`هتاكل ${count(n, r.unit)} من ${fmt(r.yield * times)}`] : times > 1 ? 'الحصة الواحدة' : 'الطبق'),
      h('div', { class: 'kt-nums' },
        ...[['kcal', 'سعرة'], ['p', 'بروتين'], ['c', 'كارب'], ['f', 'دهون']].map(([k, label]) => h('div', { class: `kt-num is-${k}` }, h('b', { class: 'num' }, fmt(m[k], { dp: 0 })), h('small', {}, label))))));
    if (target && !res.ok) {
      const why = Math.abs(res.off.kcal) > 0.1 ? `السعرات ${res.off.kcal > 0 ? 'أعلى' : 'أقل'} من المطلوب بـ ${fmt(Math.round(Math.abs(res.off.kcal) * 100))}%` : `البروتين أقل من المطلوب بـ ${fmt(Math.round(Math.abs(res.off.p) * 100))}%`;
      out.appendChild(h('p', { class: 'kt-warn', role: 'status' }, 'الوصفة دي مش بتقفل على الهدف ده: ', why, '. دي أقرب كميات تتطبخ، أو جرّب وصفة تانية.'));
    } else if (target) {
      out.appendChild(h('p', { class: 'kt-good', role: 'status' }, I('check', { size: 14 }), ' مظبوطة على الهدف بكميات تتوزن.'));
    }
    paintIng();
    persist();
  }

  function paintIng() {
    ingHost.textContent = '';
    const ul = h('ul', { class: 'kt-ing' });
    for (const l of lines(r, res.qty, times)) {
      const changed = !fixed && res.qty[l.id] !== r.ing.find((x) => x[0] === l.id)[1];
      ul.appendChild(h('li', { class: changed ? 'is-changed' : '' }, h('span', { class: 'grow' }, l.name, l.state ? h('i', { class: 'kt-state' }, l.state) : null, l.note ? h('small', {}, l.note) : null), h('b', { class: 'num' }, l.text)));
    }
    ingHost.appendChild(ul);
    ingHost.appendChild(h('p', { class: 'nu-fine' }, 'كل الأوزان قبل الطبخ. الزيت محسوب: لو زوّدته، الأرقام هتتغير.'));
    ingHost.appendChild(h('h3', { class: 'kt-h3' }, 'التتبيلة'));
    ingHost.appendChild(h('ul', { class: 'kt-spices' }, ...r.spices.map((s) => h('li', {}, s))));
    if (times > 1) ingHost.appendChild(h('p', { class: 'nu-fine' }, `التتبيلة مكتوبة ${fixed ? 'للكمية الواحدة' : 'لحصة واحدة'}: اضربها في ${fmt(times)}.`));
  }

  async function logNow() {
    const n = fixed ? res.pieces : 1;
    const m = fixed ? servingMacros(r) : res.macros;
    await addEntries(ctx, today, [entryOf(r.name, fixed ? r.unit : 'حصة', m, n)]);
  }

  function cookedSheet() {
    const total = fixed ? r.yield * times : times;
    let n = total;
    let frozen = false;
    const per = () => (fixed ? servingMacros(r) : { kcal: Math.round(res.macros.kcal * times / n), p: Math.round(res.macros.p * times / n * 10) / 10, c: Math.round(res.macros.c * times / n * 10) / 10, f: Math.round(res.macros.f * times / n * 10) / 10 });
    const info = h('p', { class: 'nu-fine' });
    const nEl = h('b', { class: 'num' }, fmt(n));
    const upd = () => { nEl.textContent = fmt(n); const p = per(); info.textContent = `كل ${fixed ? r.unit : 'علبة'}: ${fmt(p.kcal)} سعرة · ${fmt(p.p)} جم بروتين`; };
    const mk = (d, ic, al) => h('button', { type: 'button', class: 'nu-ib', 'aria-label': al, onclick: () => { n = Math.max(1, Math.min(14, n + d)); upd(); } }, I(ic));
    const fz = h('button', { type: 'button', class: 'chip', 'aria-pressed': 'false', onclick: () => { frozen = !frozen; fz.setAttribute('aria-pressed', String(frozen)); } }, 'هحطها في الفريزر');
    const body = h('div', { class: 'kt-sheet' },
      fixed ? h('p', { class: 'lead' }, `طلعت ${count(total, r.unit)}. كل واحدة تتسجل بضغطة.`)
        : [h('p', { class: 'lead' }, `طبخت ${count(times, 'حصة')}. هتقسّمها على كام علبة؟`), h('div', { class: 'kt-step' }, h('span', {}, 'عدد العلب'), mk(-1, 'minus', 'قلّل العلب'), nEl, mk(1, 'plus', 'زوّد العلب'))],
      info,
      fixed ? null : h('p', { class: 'nu-fine' }, 'وزّع البروتين (الفراخ أو اللحمة) على العلب بالميزان أولاً، وبعدين الرز أو المكرونة. لو قسّمت كله بالعين، البروتين مش هيطلع متساوي.'),
      fz,
      h('p', { class: 'nu-fine' }, `في التلاجة ${fmt(FRIDGE_DAYS)} أيام بس. اللي هتاكله بعد كده حطه في الفريزر من أول يوم.`));
    upd();
    const api = ctx.sheet({ title: 'طبخت', body, actions: [{ label: 'احفظ العلب', run: async () => {
      const p = per();
      const unit = fixed ? r.unit : 'علبة';
      const box = { id: newId('b'), rid: r.id, name: r.name, unit, left: fixed ? total : n, per: p, day: today, useBy: addDays(today, FRIDGE_DAYS), frozen };
      try {
        await kvPatch(ctx.db, KV, (k) => ({ ...k, boxes: [...(k.boxes || []).filter((x) => x.left > 0), box], seen: { ...(k.seen || {}), [r.id]: { ...((k.seen || {})[r.id] || {}), cooked: (((k.seen || {})[r.id] || {}).cooked || 0) + 1 } } }));
        // also a saved meal, so «وجباتي» and the home-screen widget log it in one tap
        const mid = `m:kt-${r.id}`;
        await kvPatch(ctx.db, 'nutrition', (nu) => ({ ...nu, savedMeals: { ...(nu.savedMeals || {}), [mid]: { id: mid, name: `${r.name} (${unit})`, section: null, items: [{ foodId: null, name: r.name, qty: 1, unit, ...p }], createdAt: new Date().toISOString() } } }));
      } catch { ctx.toast('ماقدرناش نحفظ دلوقتي. جرّب تاني.'); return; }
      api.close(); ctx.emit('food:changed', {});
      ctx.toast(`اتحفظت ${count(box.left, unit)}. هتلاقيها فوق في المطبخ وفي «وجباتي».`);
      ctx.go('kitchen');
    } }] });
  }

  const seen = (st.seen || {})[r.id] || {};
  const likeBtn = h('button', { type: 'button', class: 'chip', 'aria-pressed': String(!!seen.liked), onclick: async () => {
    const v = likeBtn.getAttribute('aria-pressed') !== 'true';
    likeBtn.setAttribute('aria-pressed', String(v));
    await kvPatch(ctx.db, KV, (k) => ({ ...k, seen: { ...(k.seen || {}), [r.id]: { ...((k.seen || {})[r.id] || {}), liked: v } } })).catch(() => {});
  } }, I('heart', { size: 16 }), 'عجبتني');

  el.append(
    topBar(ctx, { title: r.name, sub: `${timeText(r)} · ${TOOL_LABEL[r.tool]}`, backTo: ['kitchen'] }),
    h('div', { class: 'kt-wrap' },
      h('div', { class: 'kt-tags' }, isCheap(r) ? h('span', { class: 'kt-tag' }, 'رخيصة') : null, isQuick(r) ? h('span', { class: 'kt-tag' }, 'سريعة') : null, r.prep ? h('span', { class: 'kt-tag' }, 'تنفع تحضير') : null,
        seen.cooked ? h('span', { class: 'kt-tag is-ok' }, seen.cooked === 1 ? 'طبختها مرة' : `طبختها ${fmt(seen.cooked)} مرات`) : h('span', { class: 'kt-tag is-new' }, 'لسه ماجربتهاش'), likeBtn),
      card({ title: 'ظبطها', cls: 'kt-fitcard' }, fitHost, out),
      card({ title: 'المكوّنات', aside: null },
        stepper(fixed ? `كام مرة؟ (المرة = ${fmt(r.yield)} ${r.unit})` : 'هتطبخ كام حصة؟', () => times, (n) => { times = n; }, 1, 10), ingHost),
      card({ title: 'الطريقة' }, h('ol', { class: 'kt-steps' }, ...r.steps.map((s) => h('li', {}, s))),
        h('a', { class: 'btn', href: `#/kitchen/cook?${new URLSearchParams({ id: r.id })}` }, I('play'), 'ابدأ الطبخ خطوة خطوة')),
      h('div', { class: 'kt-actions' },
        h('button', { type: 'button', class: 'btn ghost', onclick: logNow }, I('plus'), fixed ? 'سجّل اللي هاكله دلوقتي' : 'سجّل حصة دلوقتي'),
        h('button', { type: 'button', class: 'btn ghost', onclick: cookedSheet }, I('check'), 'طبخت: احفظ العلب'))));
  paintFit(); compute();
}

// ═════════════════════════ #/kitchen/cook?id= (one step per screen, screen stays awake) ═════════════════════════
async function cookScreen(el, ctx, params) {
  const r = byId(params.id);
  if (!r) { ctx.go('kitchen'); return; }
  const st = await kvGet(ctx.db, KV);
  const saved = (st.last || {})[r.id] || {};
  const times = Math.max(1, saved.times || 1);
  const qty = saved.qty && r.ing.every(([id]) => Number(saved.qty[id]) > 0 || saved.qty[id] === 0) ? saved.qty : Object.fromEntries(r.ing.map(([id, q]) => [id, q]));
  const pages = [{ kind: 'prep' }, ...r.steps.map((text, i) => ({ kind: 'step', text, i }))];
  let at = 0;
  const stage = h('div', { class: 'kt-stage', 'aria-live': 'polite' });
  const prev = h('button', { type: 'button', class: 'btn ghost', onclick: () => { if (at > 0) { at--; paint(); } } }, 'السابق');
  const next = h('button', { type: 'button', class: 'btn', onclick: () => { if (at < pages.length - 1) { at++; paint(); } else ctx.go('kitchen/r', { id: r.id }); } });
  const prog = h('p', { class: 'kt-prog' });

  function paint() {
    const pg = pages[at];
    stage.textContent = '';
    if (pg.kind === 'prep') {
      stage.append(h('h2', {}, 'جهّز دول قدامك'),
        h('ul', { class: 'kt-ing is-big' }, ...lines(r, qty, times).map((l) => h('li', {}, h('span', { class: 'grow' }, l.name, l.state ? h('i', { class: 'kt-state' }, l.state) : null), h('b', { class: 'num' }, l.text)))),
        h('ul', { class: 'kt-spices' }, ...r.spices.map((s) => h('li', {}, s))));
    } else {
      stage.append(h('small', { class: 'kt-stepn' }, `خطوة ${fmt(pg.i + 1)} من ${fmt(r.steps.length)}`), h('p', { class: 'kt-bigstep' }, pg.text));
    }
    prog.textContent = `${fmt(at + 1)} / ${fmt(pages.length)}`;
    prev.disabled = at === 0;
    next.textContent = at === pages.length - 1 ? 'خلصت' : 'التالي';
    stage.scrollTop = 0;
  }

  el.append(h('div', { class: 'kt-cook' },
    h('header', { class: 'kt-cook-h' }, h('button', { type: 'button', class: 'nu-ib', 'aria-label': 'اقفل وضع الطبخ', onclick: () => ctx.go('kitchen/r', { id: r.id }) }, I('x')), h('b', { class: 'grow' }, r.name), prog),
    stage,
    h('footer', { class: 'kt-cook-f' }, prev, next)));
  paint();
  keepAwake(true, 'kitchen');
  return () => { keepAwake(false, 'kitchen'); };
}

export const routes = { kitchen: homeScreen, 'kitchen/week': weekScreen, 'kitchen/r': recipeScreen, 'kitchen/cook': cookScreen };

// «أكلاتي» (food DB: browse/search, custom food form with fiber/sodium, edit/delete custom, favorites, AI add by name),
// «وجباتي» (saved meals + editor), «وصفاتي» (recipe builder: cooked weight → per 100 g, log by grams).
import { h } from '../../../ui/dom.js';
import { fmt, parseNum } from '../../../ui/num.js';
import { pop, haptic } from '../../../ui/anim.js';
import { isDayKey } from '../../../core/date.js';
import { sumEntries } from '../../../core/targets.js';
import {
  SECTION_LABEL, sectionForHour, searchFoods, makeEntry, listMeals, entriesFromMeal, validateFood, listRecipes, makeRecipe, recipeFood, newId,
} from '../logic.js';
import { kvGet, kvPatch, loadCatalog, loadUsage, saveFood, deleteFood, addEntries, rememberQty, invalidateCatalog, dayLabel, relDay, hasAIKey, isOnline } from '../data.js';
import { I, n0, topBar, foodRow, qtySheet, field, segChips, itemsLine, card } from '../ui.js';

const secOf = (s) => (SECTION_LABEL[s] ? s : sectionForHour(new Date().getHours()));
const dayFrom = (ctx, d) => (isDayKey(d) && d <= ctx.today() ? d : ctx.today());
const ledgerParams = (ctx, day) => (day === ctx.today() ? {} : { d: day });
const UNITS = ['جرام', 'مل', 'حبة', 'حصة', 'رغيف', 'كوب', 'ملعقة', 'سكوب'];
const CATS = ['بروتين', 'كارب', 'دهون', 'خضار', 'فاكهة', 'ألبان', 'سناك', 'مشروبات', 'وجبات'];

// ═════════════════════════ «أكلاتي» (#/nutrition/foods) ═════════════════════════

export async function foodsScreen(el, ctx, params) {
  let tab = params.tab === 'mine' ? 'mine' : params.tab === 'fav' ? 'fav' : 'all';
  let query = '';
  let timer = null;
  const q = h('input', { id: 'nu-fq', type: 'search', autocomplete: 'off', placeholder: 'دوّر في كل الأكلات' });
  const list = h('div', { class: 'nu-results', 'aria-live': 'polite' });
  const count = h('p', { class: 'nu-fine' });

  async function draw() {
    const [{ list: cat, user }, nkv, usage] = await Promise.all([loadCatalog(ctx.db), kvGet(ctx.db, 'nutrition'), loadUsage(ctx.db, ctx.today())]);
    const favs = nkv.favorites || {};
    const userIds = new Set(user.map((f) => f.id));
    let rows = cat;
    if (tab === 'mine') rows = cat.filter((f) => userIds.has(f.id) || f.src === 'recipe');
    if (tab === 'fav') rows = cat.filter((f) => favs[f.id]);
    rows = query.trim() ? searchFoods(rows, query, { usage, limit: 80 }) : [...rows].sort((a, b) => (favs[b.id] ? 1 : 0) - (favs[a.id] ? 1 : 0) || a.name.localeCompare(b.name, 'ar')).slice(0, 120);
    count.textContent = `${fmt(cat.length)} أكلة · ${fmt(user.filter((f) => f.src === 'user' || f.src === 'ai').length)} أكلتك · ${fmt(user.filter((f) => f.src === 'off').length)} باركود · ${fmt(Object.keys(favs).length)} مفضّلة`;
    list.textContent = '';
    if (!rows.length) {
      list.append(h('div', { class: 'empty-state' }, h('h3', {}, tab === 'fav' ? 'لسه مفيش مفضّلة' : query ? `مالقيناش «${query.trim().slice(0, 40)}»` : 'لسه مفيش أكلات خاصة بيك'),
        h('p', {}, tab === 'fav' ? 'افتح أي أكلة واضغط «ضيف للمفضّلة». هتظهر أول حاجة في التسجيل.' : 'ضيف أكلة بالقيم بتاعتها، أو اسأل عن قيمها.'),
        h('button', { type: 'button', class: 'btn ghost', onclick: () => editFood(null, query.trim()) }, I('plus'), 'أكلة جديدة')));
      return;
    }
    for (const f of rows) list.appendChild(foodRow(f, { fav: !!favs[f.id], onPick: (x) => foodSheet(x, userIds.has(x.id), !!favs[x.id]) }));
  }

  function foodSheet(f, isUser, isFav) {
    const rowsM = [['سعرات', f.kcal, ''], ['بروتين', f.p, 'جم'], ['كارب', f.c, 'جم'], ['دهون', f.f, 'جم']];
    if (f.fiber) rowsM.push(['ألياف', f.fiber, 'جم']);
    if (f.sodium) rowsM.push(['صوديوم', f.sodium, 'مجم']);
    const body = h('div', {}, h('p', { class: 'lead' }, `لكل ${fmt(f.per)} ${f.unit || 'جرام'}${f.src === 'default' ? ' · من القاعدة الجاهزة' : f.src === 'off' ? ' · OpenFoodFacts' : f.src === 'recipe' ? ' · وصفة' : ' · أكلتك'}`),
      h('dl', { class: 'nu-dl' }, ...rowsM.flatMap(([k, v, u]) => [h('dt', {}, k), h('dd', {}, n0(v, 1), u ? ` ${u}` : '')])));
    const actions = [
      { label: isFav ? 'شيلها من المفضّلة' : 'ضيف للمفضّلة', ghost: true, run: async () => { await kvPatch(ctx.db, 'nutrition', (n) => { const x = { ...(n.favorites || {}) }; if (isFav) delete x[f.id]; else x[f.id] = true; return { ...n, favorites: x }; }); haptic(); draw(); } },
    ];
    if (f.src === 'recipe') actions.unshift({ label: 'افتح الوصفة', run: () => ctx.go('nutrition/recipes', { edit: f.id.slice(2) }) });
    else if (isUser) {
      actions.unshift({ label: 'عدّل الأكلة', run: (api) => { api.close(); editFood(f); } });
      actions.push({ label: 'احذف الأكلة', ghost: true, danger: true, run: async (api) => {
        api.close();
        if (!(await ctx.confirm({ title: `تحذف «${f.name}»؟`, text: 'هتتشال من أكلاتي. اللي اتسجّل قبل كده في أيامك مش هيتغيّر.', confirmLabel: 'احذف الأكلة', danger: true }))) return;
        try { await deleteFood(ctx.db, f.id); ctx.toast(`اتحذفت «${f.name}»`); } catch { ctx.toast('ماقدرناش نحذف. جرّب تاني.'); }
        draw();
      } });
    } else actions.unshift({ label: 'اعمل نسخة بقيمك', run: (api) => { api.close(); editFood({ ...f, id: null, src: 'user' }, null, true); } });
    ctx.sheet({ title: f.name, body, actions });
  }

  function editFood(food, name = '', override = false) {
    const box = h('div', {});
    const s = ctx.sheet({ title: food && food.id ? 'عدّل الأكلة' : override ? 'نسخة بقيمك' : 'أكلة جديدة', body: box });
    if (override) box.append(h('p', { class: 'lead' }, 'القيم الجديدة هتحل محل الأكلة الجاهزة اللي بنفس الاسم في البحث.'));
    box.append(foodForm(ctx, { food: food || { name }, onSaved: () => { s.close(); draw(); } }));
  }

  const aiBtn = hasAIKey(ctx) && isOnline() ? h('button', { type: 'button', class: 'nu-ghost', onclick: async () => {
    const name = q.value.trim();
    if (!name) { q.focus(); ctx.toast('اكتب اسم الأكلة في البحث الأول'); return; }
    const { aiFoodSheet } = await import('./add.js');
    aiFoodSheet(ctx, name, { onFood: () => draw() });
  } }, I('spark'), 'اسأل عن قيمها') : null;

  q.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { query = q.value; draw(); }, 150); });
  el.textContent = '';
  el.append(topBar(ctx, { title: 'أكلاتي', sub: 'كل الأكلات · أكلاتك · المفضّلة', backTo: ['nutrition'] }),
    h('div', { class: 'nu-body' },
      h('div', { class: 'nu-pad' }, segChips([{ value: 'all', label: 'الكل' }, { value: 'mine', label: 'أكلاتي' }, { value: 'fav', label: 'المفضّلة' }], tab, (v) => { tab = v; draw(); }, 'تصفية')),
      h('div', { class: 'field nu-search nu-pad' }, h('label', { for: 'nu-fq' }, 'دوّر'), h('div', { class: 'nu-search-box' }, I('search', { size: 18 }), q)),
      h('div', { class: 'nu-cta-row nu-pad' }, h('button', { type: 'button', class: 'btn nu-cta', onclick: () => editFood(null, q.value.trim()) }, I('plus'), 'أكلة جديدة'), aiBtn),
      h('div', { class: 'nu-pad' }, count, list)));
  await draw();
  return () => clearTimeout(timer);
}

/** Full custom food form. food: existing (edit) or partial (new / AI proposal). onSaved(food). Nothing is saved before «احفظ». */
export function foodForm(ctx, { food = {}, onSaved, submitLabel = 'احفظ الأكلة' }) {
  const isGrams = (u) => /جرام|مل/.test(u);
  let unit = UNITS.includes(food.unit) ? food.unit : 'جرام';
  let catV = CATS.includes(food.cat) ? food.cat : null;
  const nm = field('nu-ff-name', 'الاسم', { type: 'text', maxlength: '80', value: food.name || '' });
  const per = field('nu-ff-per', 'الكمية المرجعية', { type: 'text', inputmode: 'decimal', class: 'num', value: String(food.per || (isGrams(unit) ? 100 : 1)) }, 'القيم تحت لكل الكمية دي');
  const f = (k, label, v, hint = '') => field(`nu-ff-${k}`, label, { type: 'text', inputmode: 'decimal', class: 'num', value: v === undefined || v === null ? '' : String(v) }, hint);
  const kcal = f('kcal', 'السعرات', food.kcal), p = f('p', 'بروتين (جم)', food.p), c = f('c', 'كارب (جم)', food.c), fa = f('f', 'دهون (جم)', food.f);
  const fib = f('fiber', 'ألياف (جم) · اختياري', food.fiber), na = f('sodium', 'صوديوم (مجم) · اختياري', food.sodium);
  const unitChips = segChips(UNITS.map((u) => ({ value: u, label: u })), unit, (v) => { const was = isGrams(unit); unit = v; if (was !== isGrams(v)) per.input.value = isGrams(v) ? '100' : '1'; }, 'الوحدة');
  const catChips = segChips(CATS.map((x) => ({ value: x, label: x })), catV, (v) => { catV = v; }, 'النوع');
  const err = h('p', { class: 'err', 'aria-live': 'polite' });
  const all = { name: nm, per, kcal, p, c, f: fa, fiber: fib, sodium: na };
  const read = () => validateFood({ name: nm.input.value, unit, per: parseNum(per.input.value), kcal: kcal.input.value === '' ? '' : parseNum(kcal.input.value), p: p.input.value === '' ? '' : parseNum(p.input.value),
    c: c.input.value === '' ? '' : parseNum(c.input.value), f: fa.input.value === '' ? '' : parseNum(fa.input.value), fiber: fib.input.value === '' ? '' : parseNum(fib.input.value),
    sodium: na.input.value === '' ? '' : parseNum(na.input.value), cat: catV }, { id: food.id || null });
  for (const [k, fl] of Object.entries(all)) {
    fl.input.addEventListener('blur', () => { if (fl.input.value !== '') fl.set(read().errors[k]); });
    fl.input.addEventListener('input', () => fl.set(''));
  }
  const save = h('button', { type: 'button', class: 'btn nu-cta' }, submitLabel);
  save.addEventListener('click', async () => {
    const r = read();
    for (const [k, fl] of Object.entries(all)) fl.set(r.errors[k]);
    if (!r.ok) { const first = Object.keys(r.errors)[0]; all[first]?.input.focus(); return; }
    const out = { ...r.food, src: food.src === 'ai' ? 'ai' : 'user' };
    save.disabled = true;
    try { await saveFood(ctx.db, out); pop(save); ctx.toast(`اتحفظت «${out.name}» في أكلاتي`); onSaved && onSaved(out); }
    catch { err.textContent = 'ماقدرناش نحفظ دلوقتي. جرّب تاني.'; save.disabled = false; }
  });
  return h('div', { class: 'nu-form' }, nm.el, h('p', { class: 'nu-fl' }, 'الوحدة'), unitChips, per.el,
    h('div', { class: 'nu-two' }, kcal.el, p.el), h('div', { class: 'nu-two' }, c.el, fa.el), h('div', { class: 'nu-two' }, fib.el, na.el),
    h('p', { class: 'nu-fl' }, 'النوع (اختياري)'), catChips, err, save);
}

/** Sheet to pick a food + quantity → item {foodId,name,qty,unit,kcal,p,c,f}. */
async function pickItem(ctx, onItem, title = 'ضيف مكوّن') {
  const [{ list: cat }, usage] = await Promise.all([loadCatalog(ctx.db), loadUsage(ctx.db, ctx.today())]);
  const q = h('input', { id: 'nu-pi-q', type: 'search', autocomplete: 'off', placeholder: 'مثلاً: رز، فراخ' });
  const res = h('div', { class: 'nu-results nu-pi' });
  let t = null;
  const draw = () => {
    res.textContent = '';
    const rows = q.value.trim() ? searchFoods(cat.filter((f) => f.src !== 'recipe'), q.value, { usage, limit: 20 }) : searchFoods(cat, '', { usage, limit: 10 });
    for (const f of rows) res.appendChild(foodRow(f, { onPick: (food) => {
      s.close();
      const unit = food.unit || 'جرام';
      qtySheet(ctx, { title: food.name, unit, qty: /جرام|مل/.test(unit) ? 100 : 1, saveLabel: 'ضيف',
        preview: (qq) => { try { return { ok: true, entry: makeEntry(food, qq, 'lunch') }; } catch (e) { return { ok: false, message: e.message }; } },
        onSave: async (qq) => { try { const e = makeEntry(food, qq, 'lunch'); onItem({ foodId: food.id || null, name: food.name, qty: qq, unit, kcal: e.kcal, p: e.p, c: e.c, f: e.f }); return null; } catch (x) { return x.message; } } });
    } }));
    if (!rows.length) res.appendChild(h('p', { class: 'nu-hint' }, q.value.trim() ? 'مالقيناش. جرّب اسم أقصر.' : 'اكتب اسم المكوّن.'));
  };
  q.addEventListener('input', () => { clearTimeout(t); t = setTimeout(draw, 120); });
  const s = ctx.sheet({ title, body: h('div', {}, h('div', { class: 'field' }, h('label', { for: 'nu-pi-q' }, 'دوّر'), q), res), onClose: () => clearTimeout(t) });
  draw();
}

/** Editable item list (meal editor / recipe builder). */
function itemsEditor(ctx, items, onChange) {
  const wrap = h('div', { class: 'nu-items' });
  const draw = () => {
    wrap.textContent = '';
    if (!items.length) wrap.appendChild(h('p', { class: 'nu-hint' }, 'لسه مفيش مكوّنات.'));
    items.forEach((it, i) => {
      const qtyIn = h('input', { type: 'text', inputmode: 'decimal', class: 'num', value: String(it.qty), 'aria-label': `كمية ${it.name}` });
      qtyIn.addEventListener('change', () => {
        const v = parseNum(qtyIn.value);
        if (!(v > 0 && v <= 5000)) { qtyIn.value = String(it.qty); ctx.toast('الكمية رقم بين 1 و 5000'); return; }
        const k = v / (it.qty || 1);
        items[i] = { ...it, qty: v, kcal: Math.round(it.kcal * k * 10) / 10, p: Math.round(it.p * k * 10) / 10, c: Math.round(it.c * k * 10) / 10, f: Math.round(it.f * k * 10) / 10 };
        draw(); onChange();
      });
      wrap.appendChild(h('div', { class: 'nu-item' },
        h('div', { class: 'grow' }, h('b', {}, it.name), h('small', {}, n0(it.kcal), ' سعرة · ', n0(it.p), ' بروتين')),
        h('div', { class: 'nu-item-q' }, qtyIn, h('small', {}, it.unit || '')),
        h('button', { type: 'button', class: 'nu-ib', 'aria-label': `شيل ${it.name}`, onclick: () => { items.splice(i, 1); draw(); onChange(); } }, I('x', { size: 18 }))));
    });
  };
  draw();
  return { el: wrap, draw };
}

// ═════════════════════════ «وجباتي» (#/nutrition/meals) ═════════════════════════

export async function mealsScreen(el, ctx, params) {
  const day = dayFrom(ctx, params.d);
  const section = secOf(params.s);
  async function render() {
    const meals = listMeals((await kvGet(ctx.db, 'nutrition')).savedMeals);
    el.textContent = '';
    el.append(topBar(ctx, { title: 'وجباتي', sub: `بتتسجّل في ${SECTION_LABEL[section]} · ${relDay(day, ctx.today()) || dayLabel(day)}`, backTo: ['nutrition', ledgerParams(ctx, day)],
      trailing: [h('button', { type: 'button', class: 'nu-ib', 'aria-label': 'وجبة جديدة', onclick: () => editor(null) }, I('plus'))] }));
    if (!meals.length) {
      el.append(h('div', { class: 'empty-state' }, h('h2', {}, 'لسه مفيش وجبات محفوظة'),
        h('p', {}, 'اعمل وجبة من المكوّنات، أو من حساب اليوم افتح أي وجبة واضغط «احفظها في وجباتي».'),
        h('button', { type: 'button', class: 'btn nu-cta', onclick: () => editor(null) }, I('plus'), 'وجبة جديدة')));
      return;
    }
    const c = card({ cls: 'nu-list-card', title: 'الوجبات المحفوظة', aside: h('small', {}, 'اضغط «+» للتسجيل بضغطة') });
    for (const m of meals) {
      const add = h('button', { type: 'button', class: 'nu-quick', 'aria-label': `سجّل ${m.name} في ${SECTION_LABEL[section]}` }, I('plus'));
      add.addEventListener('click', async () => { add.disabled = true; pop(add); haptic(); await addEntries(ctx, day, entriesFromMeal(m, section), `اتسجّلت «${m.name}» في ${SECTION_LABEL[section]}`); add.disabled = false; });
      c.appendChild(h('div', { class: 'nu-frow' },
        h('button', { type: 'button', class: 'nu-frow-main', onclick: () => mealSheet(m) }, h('div', { class: 'grow' }, h('b', {}, m.name), h('small', {}, itemsLine(m.items))),
          h('span', { class: 'nu-fig' }, n0(m.totals.kcal), h('small', {}, 'سعرة')), h('span', { class: 'nu-fig nu-c-p' }, n0(m.totals.p), h('small', {}, 'بروتين'))), add));
    }
    el.append(h('div', { class: 'nu-body' }, c));
  }
  function mealSheet(m) {
    const list = h('div', { class: 'nu-list' }, ...m.items.map((it) => h('div', { class: 'list-row' },
      h('div', { class: 'grow' }, h('b', {}, it.name), h('small', {}, h('span', { class: 'num' }, fmt(it.qty, { dp: 1 })), ` ${it.unit}`)),
      h('span', { class: 'nu-fig' }, n0(it.kcal), h('small', {}, 'سعرة')), h('span', { class: 'nu-fig nu-c-p' }, n0(it.p), h('small', {}, 'بروتين')))));
    ctx.sheet({ title: m.name, body: list, actions: [
      { label: `سجّلها في ${SECTION_LABEL[section]}`, run: async () => { if (await addEntries(ctx, day, entriesFromMeal(m, section), `اتسجّلت «${m.name}»`)) ctx.go('nutrition', ledgerParams(ctx, day)); } },
      { label: 'عدّل الوجبة', ghost: true, run: (api) => { api.close(); editor(m); } },
      { label: 'احذف الوجبة', ghost: true, danger: true, run: async (api) => {
        api.close();
        const ok = await ctx.confirm({ title: `تحذف «${m.name}»؟`, text: 'الوجبة هتتشال من وجباتي. اللي اتسجّل قبل كده في أيامك مش هيتغيّر.', confirmLabel: 'احذف الوجبة', danger: true });
        if (!ok) return;
        await kvPatch(ctx.db, 'nutrition', (n) => { const sm = { ...(n.savedMeals || {}) }; for (const [k, v] of Object.entries(sm)) if (k === m.id || (v && v.id === m.id)) delete sm[k]; return { ...n, savedMeals: sm }; });
        ctx.toast(`اتحذفت «${m.name}»`);
        render();
      } },
    ] });
  }
  function editor(m) {
    const items = m ? m.items.map((x) => ({ ...x })) : [];
    const nm = field('nu-me-name', 'اسم الوجبة', { type: 'text', maxlength: '60', value: m ? m.name : '' });
    const tot = h('p', { class: 'nu-split' });
    const sumUp = () => { const t = sumEntries(items); tot.textContent = ''; tot.append('المجموع ', n0(t.kcal), ' سعرة · ', n0(t.p), ' بروتين · ', n0(t.c), ' كارب · ', n0(t.f), ' دهون'); };
    const ed = itemsEditor(ctx, items, sumUp);
    sumUp();
    const addBtn = h('button', { type: 'button', class: 'btn ghost', onclick: () => pickItem(ctx, (it) => { items.push(it); ed.draw(); sumUp(); }) }, I('plus'), 'ضيف صنف');
    ctx.sheet({ title: m ? 'عدّل الوجبة' : 'وجبة جديدة', body: h('div', {}, nm.el, ed.el, addBtn, tot), actions: [{ label: 'احفظ الوجبة', run: async () => {
      const name = nm.input.value.trim().slice(0, 60);
      if (!name) { nm.set('اكتب اسم للوجبة.'); nm.input.focus(); return true; }
      if (!items.length) { ctx.toast('ضيف صنف واحد على الأقل'); return true; }
      const id = m ? m.id : newId('m');
      const rec = { id, name, section: m ? m.section : null, items: items.map(({ foodId = null, name: n, qty, unit, kcal, p, c, f }) => ({ foodId, name: n, qty, unit, kcal, p, c, f })), createdAt: m && m.createdAt ? m.createdAt : new Date().toISOString() };
      try {
        await kvPatch(ctx.db, 'nutrition', (n) => { const sm = { ...(n.savedMeals || {}) }; for (const [k, v] of Object.entries(sm)) if (k === id || (v && v.id === id)) delete sm[k]; sm[id] = rec; return { ...n, savedMeals: sm }; });
        ctx.toast(`اتحفظت «${name}»`); render();
      } catch { ctx.toast('ماقدرناش نحفظ. جرّب تاني.'); return true; }
      return false;
    } }, { label: 'إلغاء', ghost: true }] });
  }
  await render();
}

// ═════════════════════════ «وصفاتي» (#/nutrition/recipes) ═════════════════════════

export async function recipesScreen(el, ctx, params) {
  const day = dayFrom(ctx, params.d);
  const section = secOf(params.s);
  async function render() {
    const recipes = listRecipes((await kvGet(ctx.db, 'nutrition')).recipes);
    el.textContent = '';
    el.append(topBar(ctx, { title: 'وصفاتي', sub: 'أكل البيت: المكوّنات + الوزن بعد الطبخ', backTo: ['nutrition', ledgerParams(ctx, day)],
      trailing: [h('button', { type: 'button', class: 'nu-ib', 'aria-label': 'وصفة جديدة', onclick: () => builder(null) }, I('plus'))] }));
    if (!recipes.length) {
      el.append(h('div', { class: 'empty-state' }, h('h2', {}, 'لسه مفيش وصفات'),
        h('p', {}, 'اكتب مكوّنات الطبخة (ملوخية، كشري، محشي…) ووزن الحلة بعد الطبخ، وبعدها سجّل اللي أكلته بالجرام.'),
        h('button', { type: 'button', class: 'btn nu-cta', onclick: () => builder(null) }, I('plus'), 'وصفة جديدة')));
      return;
    }
    const c = card({ cls: 'nu-list-card', title: 'الوصفات', aside: h('small', {}, 'لكل 100 جم مطبوخ') });
    for (const r of recipes) {
      const per = r.per100 || r.perServing;
      c.appendChild(h('div', { class: 'nu-frow' }, h('button', { type: 'button', class: 'nu-frow-main', onclick: () => logRecipe(r) },
        h('div', { class: 'grow' }, h('b', {}, r.name), h('small', {}, r.cookedG ? `${fmt(r.cookedG)} جم مطبوخ · ${r.items.length} مكوّن` : `${fmt(r.servings)} حصة · ${r.items.length} مكوّن`)),
        h('span', { class: 'nu-fig' }, n0(per.kcal), h('small', {}, r.per100 ? 'سعرة/100' : 'سعرة/حصة')), h('span', { class: 'nu-fig nu-c-p' }, n0(per.p), h('small', {}, 'بروتين'))),
      h('button', { type: 'button', class: 'nu-ib', 'aria-label': `عدّل ${r.name}`, onclick: () => builder(r) }, I('edit', { size: 18 }))));
    }
    el.append(h('div', { class: 'nu-body' }, c));
  }
  function logRecipe(r) {
    const food = recipeFood(r);
    if (!food) return;
    const unit = food.unit;
    qtySheet(ctx, { title: r.name, sub: r.per100 ? `لكل 100 جم: ${fmt(food.kcal)} سعرة · ${fmt(food.p)} بروتين` : `للحصة: ${fmt(food.kcal)} سعرة`, unit, qty: unit === 'جرام' ? 300 : 1,
      preview: (qq) => { try { return { ok: true, entry: makeEntry(food, qq, section) }; } catch (e) { return { ok: false, message: e.message }; } },
      saveLabel: `سجّل في ${SECTION_LABEL[section]}`,
      onSave: async (qq) => {
        let e; try { e = makeEntry(food, qq, section, new Date(), 'recipe'); } catch (x) { return x.message; }
        if (!(await addEntries(ctx, day, [e]))) return 'ماقدرناش نحفظ دلوقتي. جرّب تاني.';
        rememberQty(ctx.db, food.id, qq);
        return null;
      } });
  }
  function builder(r) {
    const items = r ? r.items.map((x) => ({ ...x })) : [];
    const nm = field('nu-rb-name', 'اسم الوصفة', { type: 'text', maxlength: '60', value: r ? r.name : '' });
    const cooked = field('nu-rb-cooked', 'الوزن بعد الطبخ (جم)', { type: 'text', inputmode: 'decimal', class: 'num', value: r && r.cookedG ? String(r.cookedG) : '' }, 'وزّن الحلة فاضية وبعد الطبخ، واطرح.');
    const out = h('div', { class: 'nu-rb-out', 'aria-live': 'polite' });
    const calc = () => {
      const t = sumEntries(items);
      const raw = items.reduce((s, x) => s + (/جرام|مل/.test(x.unit || '') ? Number(x.qty) || 0 : 0), 0);
      const g = parseNum(cooked.input.value);
      out.textContent = '';
      out.append(h('p', { class: 'nu-split' }, 'الحلة كلها ', n0(t.kcal), ' سعرة · ', n0(t.p), ' بروتين', raw ? [' · نيّ ', n0(raw), ' جم'] : null));
      if (g >= 10) out.append(h('p', { class: 'nu-rb-per' }, 'لكل 100 جم مطبوخ: ', h('b', {}, n0(t.kcal * 100 / g)), ' سعرة · ', n0(t.p * 100 / g, 1), ' بروتين · ', n0(t.c * 100 / g, 1), ' كارب · ', n0(t.f * 100 / g, 1), ' دهون'));
    };
    cooked.input.addEventListener('input', () => { cooked.set(''); calc(); });
    const ed = itemsEditor(ctx, items, calc);
    calc();
    const addBtn = h('button', { type: 'button', class: 'btn ghost', onclick: () => pickItem(ctx, (it) => { items.push(it); ed.draw(); calc(); }) }, I('plus'), 'ضيف مكوّن');
    const actions = [{ label: 'احفظ الوصفة', run: async () => {
      const res = makeRecipe({ id: r ? r.id : null, name: nm.input.value, items, cookedG: parseNum(cooked.input.value) });
      if (!res.ok) { if (/اسم/.test(res.message)) { nm.set(res.message); nm.input.focus(); } else if (/وزن/.test(res.message)) { cooked.set(res.message); cooked.input.focus(); } else ctx.toast(res.message); return true; }
      try {
        await kvPatch(ctx.db, 'nutrition', (n) => ({ ...n, recipes: { ...(n.recipes || {}), [res.recipe.id]: { ...res.recipe, createdAt: r && r.createdAt ? r.createdAt : res.recipe.createdAt } } }));
        invalidateCatalog(); ctx.toast(`اتحفظت «${res.recipe.name}»`); render();
      } catch { ctx.toast('ماقدرناش نحفظ. جرّب تاني.'); return true; }
      return false;
    } }];
    if (r) actions.push({ label: 'احذف الوصفة', ghost: true, danger: true, run: async (api) => {
      api.close();
      if (!(await ctx.confirm({ title: `تحذف «${r.name}»؟`, text: 'الوصفة هتتشال. اللي اتسجّل منها قبل كده مش هيتغيّر.', confirmLabel: 'احذف الوصفة', danger: true }))) return;
      await kvPatch(ctx.db, 'nutrition', (n) => { const x = { ...(n.recipes || {}) }; for (const [k, v] of Object.entries(x)) if (k === r.id || (v && v.id === r.id)) delete x[k]; return { ...n, recipes: x }; });
      invalidateCatalog(); ctx.toast(`اتحذفت «${r.name}»`); render();
    } });
    else actions.push({ label: 'إلغاء', ghost: true });
    ctx.sheet({ title: r ? 'عدّل الوصفة' : 'وصفة جديدة', body: h('div', { class: 'nu-form' }, nm.el, h('p', { class: 'nu-fl' }, 'المكوّنات (نيّة)'), ed.el, addBtn, cooked.el, out), actions });
  }
  await render();
  if (params.edit) { const r = listRecipes((await kvGet(ctx.db, 'nutrition')).recipes).find((x) => x.id === params.edit); if (r) builder(r); }
}


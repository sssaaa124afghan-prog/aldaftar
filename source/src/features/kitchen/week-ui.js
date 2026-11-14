// #/kitchen/week — «خطة الأسبوع»: pick a breakfast, 1-3 prep recipes and (optionally) a dessert; get every day's plate,
// the shopping list and the prep sheet. Only the CHOICES are stored (kv kitchen.week); the plan is recomputed from them
// and the current day targets on every render, so a changed target or a moved training day can never leave a stale plan.
import { h } from '../../ui/dom.js';
import { fmt } from '../../ui/num.js';
import { addDays, weekday } from '../../core/date.js';
import { kvGet, kvPatch, addEntries, dayTargetsBulk, dayLabel, shortDay, DAY_TYPE_LABEL } from '../nutrition/data.js';
import { I, n0, topBar, card, segChips } from '../nutrition/ui.js';
import { RECIPES } from './recipes.js';
import { isFixed, servingMacros, FRIDGE_DAYS } from './logic.js';
import { planWeek } from './week.js';
import { KV, byId, count, entryOf } from './shared.js';

const SLOT_LABEL = { breakfast: 'الفطار', meal: 'وجبة', dessert: 'الحلو' };
const SLOT_SECTION = { b: 'breakfast', m0: 'lunch', m1: 'dinner', m2: 'snack', d: 'snack' };
const DEFAULTS = { breakfast: 'std-breakfast', meals: ['chicken-rice'], dessert: null, perDay: 2, offDows: [5], span: 7 };
const pct = (v) => `${v > 0 ? '+' : ''}${fmt(Math.round(v * 100))}%`;

/** Day keys of the plan: `span` days from `start`, minus the weekdays he eats off-plan. */
export function planDays(start, choices) {
  const off = new Set(choices.offDows || []);
  const out = [];
  for (let i = 0; i < (choices.span || 7); i++) { const d = addDays(start, i); if (!off.has(weekday(d))) out.push(d); }
  return out;
}

async function compute(ctx, wk) {
  const days = planDays(wk.start, wk.choices);
  const tm = await dayTargetsBulk(ctx, days);
  return planWeek({ ...wk.choices, days: days.map((d) => { const t = tm.get(d); return { day: d, type: t.type, target: { kcal: t.kcal, p: t.p, c: t.c, f: t.f } }; }) });
}

async function logSlot(ctx, day, slot) {
  const ok = await addEntries(ctx, day, [entryOf(slot.name, slot.unit, slot.n > 1 ? { kcal: slot.macros.kcal / slot.n, p: slot.macros.p / slot.n, c: slot.macros.c / slot.n, f: slot.macros.f / slot.n } : slot.macros, slot.n, SLOT_SECTION[slot.key] || null)],
    `اتسجّل «${slot.name}» · ${fmt(slot.macros.kcal)} سعرة`);
  if (ok) await kvPatch(ctx.db, KV, (k) => (k.week ? { ...k, week: { ...k.week, done: { ...(k.week.done || {}), [day]: [...new Set([...((k.week.done || {})[day] || []), slot.key])] } } } : k));
  return ok;
}

function slotRow(ctx, day, slot, done, after) {
  const btn = done ? h('span', { class: 'kt-done' }, I('check', { size: 16 }), 'اتسجّلت') : h('button', { type: 'button', class: 'btn sm', onclick: async () => { btn.disabled = true; if (await logSlot(ctx, day, slot)) after(); else btn.disabled = false; } }, 'أكلتها');
  return h('div', { class: 'kt-box' },
    h('div', { class: 'grow' }, h('b', {}, slot.name), h('small', {}, `${SLOT_LABEL[slot.kind]}${slot.n > 1 ? ` · ${count(slot.n, slot.unit)}` : ''} · `, n0(slot.macros.kcal), ' سعرة · ', n0(slot.macros.p), ' بروتين')),
    btn);
}

/** Kitchen home: today's planned plates, each logged with one tap. Renders nothing without a plan for today. */
export async function todayPlanCard(ctx, host) {
  const st = await kvGet(ctx.db, KV);
  host.textContent = '';
  if (!st.week || !st.week.choices) return;
  const today = ctx.today();
  const plan = await compute(ctx, st.week);
  const d = plan.days.find((x) => x.day === today);
  if (!d || !d.slots.length) return;
  const done = new Set(((st.week.done || {})[today]) || []);
  const c = card({ title: 'خطة النهارده', aside: h('small', {}, DAY_TYPE_LABEL[d.type] || '') });
  for (const s of d.slots) c.appendChild(slotRow(ctx, today, s, done.has(s.key), () => todayPlanCard(ctx, host)));
  host.appendChild(c);
}

export async function weekScreen(el, ctx, params) {
  let st = await kvGet(ctx.db, KV);
  const today = ctx.today();
  const body = h('div', { class: 'kt-wrap' });
  el.append(topBar(ctx, { title: 'خطة الأسبوع', sub: 'كل يوم على هدفه، بمشتريات وتحضير مرة واحدة', backTo: ['kitchen'] }), body);

  // ───── setup ─────
  function setup(prev) {
    const ch = structuredClone({ ...DEFAULTS, ...(prev || {}) });
    ch.meals = (ch.meals || []).filter((id) => byId(id));
    body.textContent = '';
    const multi = (list, isOn, toggle, label) => {
      const row = h('div', { class: 'chips', role: 'group', 'aria-label': label });
      const pairs = list.map((o) => [h('button', { type: 'button', class: 'chip', 'aria-pressed': String(isOn(o.value)), onclick: () => { toggle(o.value); for (const [x, oo] of pairs) x.setAttribute('aria-pressed', String(isOn(oo.value))); } }, o.label), o]);
      for (const [x] of pairs) row.appendChild(x);
      return row;
    };
    const mealOpts = RECIPES.filter((r) => r.cat === 'meal' && !isFixed(r)).sort((a, b) => Number(!!b.prep) - Number(!!a.prep)).map((r) => ({ value: r.id, label: r.prep ? r.name : `${r.name} (تتعمل في وقتها)` }));
    const err = h('p', { class: 'kt-warn', hidden: true, role: 'alert' });
    const perVal = h('b', { class: 'num' }, fmt(ch.perDay));
    const perBtn = (d, ic, al) => h('button', { type: 'button', class: 'nu-ib', 'aria-label': al, onclick: () => { ch.perDay = Math.max(1, Math.min(3, ch.perDay + d)); perVal.textContent = fmt(ch.perDay); } }, I(ic));
    const DOW = [[6, 'السبت'], [0, 'الأحد'], [1, 'الاتنين'], [2, 'التلات'], [3, 'الأربع'], [4, 'الخميس'], [5, 'الجمعة']];
    body.append(
      card({ title: 'الفطار' }, segChips([...RECIPES.filter((r) => r.cat === 'breakfast').map((r) => ({ value: r.id, label: r.name.replace('فطارك الثابت: ', 'الثابت: ') })), { value: null, label: 'من غير فطار في الخطة' }], ch.breakfast, (v) => { ch.breakfast = v; }, 'الفطار')),
      card({ title: 'وصفات التحضير', aside: h('small', {}, 'من 1 لـ 3') },
        multi(mealOpts, (v) => ch.meals.includes(v), (v) => { if (ch.meals.includes(v)) ch.meals = ch.meals.filter((x) => x !== v); else if (ch.meals.length < 3) ch.meals.push(v); else ctx.toast('3 وصفات كفاية للأسبوع. شيل واحدة الأول.'); }, 'وصفات التحضير'),
        h('p', { class: 'nu-fine' }, 'الوصفات بتتبادل على الوجبات: وصفتين مع وجبتين في اليوم معناها واحدة من كل وصفة يومياً.'),
        h('div', { class: 'kt-step' }, h('span', {}, 'كام وجبة محضّرة في اليوم؟'), perBtn(-1, 'minus', 'قلّل الوجبات'), perVal, perBtn(1, 'plus', 'زوّد الوجبات'))),
      card({ title: 'حلو كل يوم' }, segChips([{ value: null, label: 'من غير' }, ...RECIPES.filter((r) => r.cat === 'dessert' && r.prep).map((r) => ({ value: r.id, label: `${r.name} (${fmt(servingMacros(r).kcal)} سعرة)` }))], ch.dessert, (v) => { ch.dessert = v; }, 'الحلو')),
      card({ title: 'أيام برّه الخطة' }, multi(DOW.map(([value, label]) => ({ value, label })), (v) => ch.offDows.includes(v), (v) => { ch.offDows = ch.offDows.includes(v) ? ch.offDows.filter((x) => x !== v) : [...ch.offDows, v]; }, 'أيام برّه الخطة'),
        h('p', { class: 'nu-fine' }, 'اليوم اللي بتاكل فيه برّه أو أكل مختلف. مش هيتحسب في المشتريات.')),
      err,
      h('button', { type: 'button', class: 'btn', onclick: async () => {
        if (!ch.meals.length) { err.hidden = false; err.textContent = 'اختار وصفة تحضير واحدة على الأقل.'; return; }
        if (ch.offDows.length >= 7) { err.hidden = false; err.textContent = 'سيب يوم واحد على الأقل جوه الخطة.'; return; }
        try { st = await kvPatch(ctx.db, KV, (k) => ({ ...k, week: { choices: ch, start: today, done: (k.week && k.week.start === today && k.week.done) || {}, bought: [], madeAt: new Date().toISOString() } })); }
        catch { ctx.toast('ماقدرناش نحفظ دلوقتي. جرّب تاني.'); return; }
        result();
      } }, I('check'), 'احسب الخطة'));
    window.scrollTo(0, 0);
  }

  // ───── result ─────
  async function result() {
    const wk = st.week;
    const plan = await compute(ctx, wk);
    let tab = ['days', 'shop', 'prep'].includes(params.tab) ? params.tab : 'days';
    const pane = h('div', { class: 'kt-pane' });
    body.textContent = '';
    const stale = !plan.days.some((d) => d.day >= today);

    function days() {
      const done = wk.done || {};
      if (!plan.ok) pane.appendChild(h('p', { class: 'kt-warn' }, 'فيه أيام مش بتقفل على هدفها بالاختيارات دي. جرّب تزوّد وجبة محضّرة أو تضيف حلو، أو وصفة فيها نشا أكتر.'));
      for (const d of plan.days) {
        const offK = Math.abs(d.off.kcal) > 0.1; const offP = d.off.p < -0.1;
        const c = card({ title: dayLabel(d.day), aside: h('small', {}, DAY_TYPE_LABEL[d.type] || ''), cls: d.day === today ? 'kt-today' : '' });
        const dn = new Set(done[d.day] || []);
        for (const s of d.slots) {
          c.appendChild(d.day === today ? slotRow(ctx, d.day, s, dn.has(s.key), async () => { st = await kvGet(ctx.db, KV); result(); })
            : h('div', { class: 'kt-box' }, h('div', { class: 'grow' }, h('b', {}, s.name), h('small', {}, `${SLOT_LABEL[s.kind]}${s.n > 1 ? ` · ${count(s.n, s.unit)}` : ''} · `, n0(s.macros.kcal), ' سعرة · ', n0(s.macros.p), ' بروتين'))));
        }
        c.appendChild(h('p', { class: `kt-daytotal${offK || offP ? ' is-off' : ''}` }, 'المجموع ', n0(d.total.kcal), ' من ', n0(d.target.kcal), ' سعرة', offK ? ` (${pct(d.off.kcal)})` : '', ' · بروتين ', n0(d.total.p), ' من ', n0(d.target.p), offP ? ` (${pct(d.off.p)})` : ''));
        pane.appendChild(c);
      }
    }

    function shop() {
      const bought = new Set(wk.bought || []);
      const c = card({ title: 'المشتريات', aside: h('small', {}, `${count(plan.days.length, 'يوم')} · أوزان قبل الطبخ`) });
      let group = '';
      for (const it of plan.shopping) {
        if (it.group !== group) { group = it.group; c.appendChild(h('h3', { class: 'kt-h3' }, group)); }
        const id = `kt-buy-${it.id}`;
        const cb = h('input', { type: 'checkbox', id, checked: bought.has(it.id), onchange: async () => {
          if (cb.checked) bought.add(it.id); else bought.delete(it.id);
          st = await kvPatch(ctx.db, KV, (k) => (k.week ? { ...k, week: { ...k.week, bought: [...bought] } } : k)).catch(() => st);
        } });
        c.appendChild(h('label', { class: 'kt-buy', for: id }, cb, h('span', { class: 'grow' }, it.name, it.state ? h('i', { class: 'kt-state' }, it.state) : null,
          it.packs ? h('small', {}, `${count(it.packs, 'عبوة')} من ${it.pack >= 1000 ? `${fmt(it.pack / 1000)} كجم` : `${fmt(it.pack)} جم`}`) : null), h('b', { class: 'num' }, it.text)));
      }
      c.appendChild(h('p', { class: 'nu-fine' }, 'أحجام العبوات تقريبية. التوابل والليمون مش في القائمة: راجعهم في ورقة التحضير. اللي عندك منه في البيت علّم عليه.'));
      pane.appendChild(c);
    }

    function prep() {
      const n = plan.days.length;
      pane.appendChild(h('p', { class: 'kt-good' }, I('clock', { size: 16 }), h('span', {}, n > FRIDGE_DAYS ? `المطبوخ بيقعد ${fmt(FRIDGE_DAYS)} أيام في التلاجة. يا إما تطبخ مرتين في الأسبوع، يا إما علب اليوم الرابع وما بعده تتحط في الفريزر من أول يوم.` : `الخطة ${count(n, 'يوم')}: كل العلب تقعد في التلاجة عادي.`)));
      for (const p of plan.prep) {
        const c = card({ title: p.name, aside: h('small', {}, p.fixed ? `${count(p.batches, 'مرة')} = ${count(p.boxes, p.unit)}` : count(p.boxes, 'علبة')) });
        c.appendChild(h('h3', { class: 'kt-h3' }, 'تطبخ إجمالي'));
        c.appendChild(h('ul', { class: 'kt-ing' }, ...p.total.map((l) => h('li', {}, h('span', { class: 'grow' }, l.name, l.state ? h('i', { class: 'kt-state' }, l.state) : null), h('b', { class: 'num' }, l.text)))));
        for (const z of p.sizes) {
          c.appendChild(h('h3', { class: 'kt-h3' }, `علبة ${DAY_TYPE_LABEL[z.type] || z.type} × ${fmt(z.count)}`));
          c.appendChild(h('p', { class: 'nu-fine' }, 'في كل علبة (وزن قبل الطبخ): ', z.lines.filter((l) => !['oil', 'onion', 'paste', 'tomato', 'pepper', 'veg', 'cucumber'].includes(l.id)).map((l) => `${l.name} ${l.text}`).join(' + '), ' · ', n0(z.macros.kcal), ' سعرة، ', n0(z.macros.p), ' بروتين'));
        }
        if (p.sizes.length > 1) c.appendChild(h('p', { class: 'nu-fine' }, 'اطبخ الكمية كلها مرة واحدة، ووزّع البروتين على العلب بالتساوي، وبعدين زوّد النشا في علب يوم التمرين. اكتب نوع اليوم على الغطا.'));
        c.appendChild(h('h3', { class: 'kt-h3' }, 'التتبيلة (للحصة الواحدة)'));
        c.appendChild(h('ul', { class: 'kt-spices' }, ...p.spices.map((s) => h('li', {}, s))));
        c.appendChild(h('a', { class: 'btn ghost', href: `#/kitchen/r?${new URLSearchParams({ id: p.rid })}` }, 'افتح الوصفة والطريقة'));
        pane.appendChild(c);
      }
    }

    const draw = () => { pane.textContent = ''; ({ days, shop, prep })[tab](); };
    if (stale) body.appendChild(h('p', { class: 'kt-warn' }, 'الخطة دي أيامها عدّت. اضغط «ابدأ من النهارده» عشان تتحسب للأيام الجاية.'));
    body.append(
      segChips([{ value: 'days', label: 'الأيام' }, { value: 'shop', label: 'المشتريات' }, { value: 'prep', label: 'التحضير' }], tab, (v) => { tab = v; draw(); }, 'أقسام الخطة'),
      pane,
      h('div', { class: 'kt-actions' },
        h('button', { type: 'button', class: 'btn ghost', onclick: async () => {
          st = await kvPatch(ctx.db, KV, (k) => ({ ...k, week: { ...k.week, start: today, bought: [] } }));
          ctx.toast('اتحسبت من النهارده بنفس الاختيارات.'); result();
        } }, I('repeat'), 'ابدأ من النهارده (عيد الحساب)'),
        h('button', { type: 'button', class: 'btn ghost', onclick: () => setup(wk.choices) }, I('edit'), 'غيّر الاختيارات')));
    draw();
    window.scrollTo(0, 0);
  }

  if (st.week && st.week.choices && !params.edit) await result(); else setup(st.week && st.week.choices);
}

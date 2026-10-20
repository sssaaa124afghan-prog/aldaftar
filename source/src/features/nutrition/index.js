// Nutrition: day ledger with intelligence (gauge, macro rings + ranges, meal budget, smart suggestion, weight impact,
// protein per meal, eating window, one alert, end-of-day recap), water + supplements, date tools. Other screens are lazy.
import './nutrition.css';
import { h } from '../../ui/dom.js';
import { fmt } from '../../ui/num.js';
import { pop, haptic } from '../../ui/anim.js';
import { isDayKey, addDays } from '../../core/date.js';
import { sumEntries } from '../../core/targets.js';
import { buildContextSummary } from '../../core/ai.js';
import {
  SECTIONS, SECTION_LABEL, sectionForHour, sectionOf, groupBySection, makeEntry, rescaleEntry, repeatSection, dayBalance, mealFromEntries,
  macroRanges, rangeStatus, macroSplit, sumFiber, mealBudget, weightImpact, proteinPerMeal, eatingWindow, smartAlert, eodRecap,
  smartSuggestions, cupsFor, dayShareText, monthGrid, dayQuality,
} from './logic.js';
import {
  kvGet, kvPatch, getEntries, putEntries, loadCatalog, loadUsage, dayTarget, addEntries, rememberQty, coachContext, dayLabel, relDay,
  DAY_TYPE_LABEL, loadProfile, burnFor, waterGoalFor, dailyPatch, dailyGet, dayTargetsBulk, logRange, weightSuggestion,
} from './data.js';
import { I, n0, card, macroTile, calorieGauge, qtySheet, itemsLine } from './ui.js';
import { startReminders } from './reminders.js';

const secOf = (s, now = new Date()) => (SECTION_LABEL[s] ? s : sectionForHour(now.getHours()));
const dayOf = (ctx, d) => (isDayKey(d) && d <= ctx.today() ? d : ctx.today());
const dayParams = (ctx, d) => (d === ctx.today() ? {} : { d });
const shortFmt = new Intl.DateTimeFormat('ar-EG-u-nu-latn', { weekday: 'short' });
const dnum = (key) => Number(key.slice(8));

export const SUPPLEMENT_CHIPS = Object.freeze(['كرياتين', 'واي بروتين', 'أوميجا 3', 'فيتامين د', 'ماغنسيوم', 'مالتي فيتامين']);

// ═════════════════════════ ledger (#/nutrition) ═════════════════════════

async function ledger(el, ctx, params) {
  const today = ctx.today();
  const day = dayOf(ctx, params.d);
  const isToday = day === today;
  let alive = true;
  startReminders(ctx);

  async function render() {
    const [t, entries, yEntries, daily, nkv, profile] = await Promise.all([
      dayTarget(ctx, day), getEntries(ctx.db, day), getEntries(ctx.db, addDays(day, -1)), dailyGet(ctx.db, day), kvGet(ctx.db, 'nutrition'), loadProfile(ctx),
    ]);
    if (!alive) return;
    const hour = new Date().getHours();
    const groups = groupBySection(entries);
    const yGroups = groupBySection(yEntries);
    const intake = sumEntries(entries);
    const fiber = sumFiber(entries);
    const R = macroRanges(t, nkv.ranges || {});
    const bal = dayBalance(intake, t, R);
    const burn = burnFor(profile, t.type);
    const rel = relDay(day, today);
    const waterMl = Number(daily.waterMl) || 0;
    const waterGoal = waterGoalFor(profile, t.type, ctx);

    // ── header ──
    const prevBtn = h('button', { type: 'button', class: 'nu-ib nu-flip', 'aria-label': 'اليوم اللي قبله', onclick: () => ctx.go('nutrition', { d: addDays(day, -1) }) }, I('chevron'));
    const nextBtn = h('button', { type: 'button', class: 'nu-ib', 'aria-label': 'اليوم اللي بعده', disabled: day >= today, onclick: () => ctx.go('nutrition', dayParams(ctx, addDays(day, 1))) }, I('chevron'));
    const top = h('header', { class: 'nu-top nu-top-day' },
      prevBtn,
      h('div', { class: 'grow' },
        h('p', { class: 'nu-kicker' }, rel || 'حساب اليوم', ' · ',
          h('button', { type: 'button', class: `nu-pill is-${t.type}`, 'aria-label': `نوع اليوم: ${DAY_TYPE_LABEL[t.type]}. غيّره`, onclick: () => dayTypeSheet(ctx, day, t) }, DAY_TYPE_LABEL[t.type])),
        h('h1', {}, dayLabel(day))),
      nextBtn,
      h('button', { type: 'button', class: 'nu-ib', 'aria-label': 'أدوات اليوم', onclick: () => dayMenu(ctx, day, { entries, yEntries, groups, intake, t }) }, I('more')));

    // ── last-7 chips + calendar ──
    const chips = h('nav', { class: 'nu-days', 'aria-label': 'آخر 7 أيام' });
    for (let i = 6; i >= 0; i--) {
      const d = addDays(today, -i);
      chips.appendChild(h('a', { class: 'nu-dchip', href: `#/nutrition${d === today ? '' : `?d=${d}`}`, 'aria-current': d === day ? 'date' : null, 'aria-label': dayLabel(d) },
        h('small', {}, d === today ? 'النهارده' : shortFmt.format(new Date(`${d}T12:00:00`))), h('b', { class: 'num' }, String(dnum(d)))));
    }
    chips.appendChild(h('button', { type: 'button', class: 'nu-dchip nu-cal-btn', 'aria-label': 'افتح التقويم', onclick: () => calendarSheet(ctx, day) }, I('calendar', { size: 18 })));

    // ── hero: gauge + macro rings ──
    const over = intake.kcal > t.kcal;
    const hero = card({ cls: 'nu-hero', aria: 'السعرات والماكروز' },
      calorieGauge({ eaten: intake.kcal, target: t.kcal, burn, remaining: t.kcal - intake.kcal, over }),
      h('p', { class: `nu-status is-${bal.state}`, role: 'status' }, h('i', { 'aria-hidden': 'true' }), bal.message));
    const split = macroSplit(intake);
    const tiles = h('div', { class: 'nu-mgrid' },
      macroTile('p', intake.p, t.p, R.p, { status: rangeStatus(intake.p, R.p) }),
      macroTile('c', intake.c, t.c, R.c, { status: rangeStatus(intake.c, R.c) }),
      macroTile('f', intake.f, t.f, R.f, { status: rangeStatus(intake.f, R.f) }),
      macroTile('kcal', intake.kcal, t.kcal, R.kcal, { status: rangeStatus(intake.kcal, R.kcal) }));
    const splitLine = h('p', { class: 'nu-split' },
      split ? ['بروتين ', n0(split.p), '% · كارب ', n0(split.c), '% · دهون ', n0(split.f), '%'] : 'الماكروز هتظهر هنا أول ما تسجّل',
      fiber > 0 ? [' · ألياف ', n0(fiber, 1), ' جم'] : null);

    const cta = h('div', { class: 'nu-cta-row' },
      h('a', { class: 'btn nu-cta', href: `#/nutrition/add?${new URLSearchParams({ d: day, s: secOf(null) })}` }, I('plus'), 'سجّل أكل'),
      h('a', { class: 'nu-ghost', href: `#/nutrition/meals?${new URLSearchParams({ d: day })}`, 'aria-label': 'وجباتي' }, I('food'), 'وجباتي'),
      h('a', { class: 'nu-ghost', href: '#/nutrition/targets', 'aria-label': 'الأهداف' }, I('target'), 'الأهداف'));

    const blocks = [chips, hero, tiles, splitLine, cta];

    // ── one alert (adaptive suggestion first) ──
    let alert = null;
    if (isToday) {
      const adapt = await weightSuggestion(ctx, profile, nkv, today);
      if (adapt) alert = h('a', { class: 'nu-alert is-adapt', href: '#/nutrition/targets' }, I('trend'), h('div', { class: 'grow' }, h('b', {}, `اقتراح للأهداف: ${adapt.title}`), h('span', {}, adapt.reason)), I('chevron', { size: 16 }));
      else {
        const prevDays = [addDays(day, -1), addDays(day, -2)];
        const [tm, logs] = await Promise.all([dayTargetsBulk(ctx, prevDays), Promise.all(prevDays.map((d) => getEntries(ctx.db, d)))]);
        const a = smartAlert({ today: day, recent: prevDays.map((d, i) => ({ day: d, intake: sumEntries(logs[i]), target: tm.get(d) })), lastWeighDay: profile.lastWeighDay, waterMl, waterGoal, hour, isToday });
        if (a) alert = h('div', { class: `nu-alert is-${a.kind}`, role: 'note' }, I(a.kind === 'water' ? 'droplet' : a.kind === 'weigh' ? 'scale' : 'bolt'), h('div', { class: 'grow' }, h('span', {}, a.text)),
          a.kind === 'weigh' ? h('a', { class: 'nu-alert-act', href: '#/progress' }, 'سجّل وزن') : null);
      }
    }
    if (!alive) return;
    if (alert) blocks.push(alert);

    // ── close the gap: meal budget + local suggestions (today only) ──
    if (isToday && bal.state !== 'closed' && bal.state !== 'over') {
      const [{ list: catalog }, usage] = await Promise.all([loadCatalog(ctx.db), loadUsage(ctx.db, day)]);
      if (!alive) return;
      const budget = entries.length ? mealBudget(groups, intake, t, hour) : null;
      const sec = secOf(null);
      const sug = smartSuggestions(catalog, usage, intake, t, { dayType: t.type, favorites: nkv.favorites || {}, section: sec });
      if (budget || sug.items.length) {
        const list = h('div', { class: 'nu-sug' });
        for (const s of sug.items) {
          const add = h('button', { type: 'button', class: 'nu-quick', 'aria-label': `سجّل ${s.food.name} ${fmt(s.qty)} ${s.food.unit || 'جرام'} في ${SECTION_LABEL[sec]}` }, I('plus'));
          add.addEventListener('click', async () => {
            add.disabled = true; pop(add); haptic();
            let e; try { e = makeEntry(s.food, s.qty, sec); } catch { add.disabled = false; return; }
            if (await addEntries(ctx, day, [e], `اتسجّل ${s.food.name} · ${fmt(e.kcal)} سعرة`)) rememberQty(ctx.db, s.food.id, s.qty); else add.disabled = false;
          });
          list.appendChild(h('div', { class: 'nu-sug-row' },
            h('div', { class: 'grow' }, h('b', {}, s.food.name), h('small', {}, h('span', { class: 'num' }, fmt(s.qty)), ` ${s.food.unit || 'جرام'}`, s.count ? ` · سجّلتها ${fmt(s.count)} مرة` : s.fav ? ' · مفضّلة' : '')),
            h('span', { class: 'nu-fig' }, n0(s.kcal), h('small', {}, 'سعرة')), h('span', { class: 'nu-fig nu-c-p' }, n0(s.p), h('small', {}, 'بروتين')),
            h('span', { class: 'nu-cov num' }, `${fmt(s.coverage)}%`), add));
        }
        const head = sug.mode === 'p' ? ['فاضل ', n0(sug.gap), ' جم بروتين'] : sug.mode === 'kcal' ? ['فاضل ', n0(sug.gap), ' سعرة'] : sug.mode === 'c' ? ['فاضل ', n0(sug.gap), ' جم كارب ليوم التمرين'] : 'خطة باقي اليوم';
        blocks.push(card({ cls: 'nu-gap', title: h('span', {}, ...[head].flat()), aria: 'يقفّل الفجوة', aside: h('small', {}, 'من أكلك أنت · من غير ذكاء اصطناعي') },
          budget ? h('p', { class: 'nu-budget' }, I('target', { size: 16 }), budget.mealsLeft > 1 ? `لكل وجبة باقية (${budget.mealsLeft}): ` : `للـ${SECTION_LABEL[budget.sections[0]]}: `, '~', n0(budget.kcal), ' سعرة · ', n0(budget.p), ' جم بروتين') : null,
          sug.items.length ? list : null));
      }
    }

    // ── meals ──
    const ppm = proteinPerMeal(entries, profile.kg);
    const ppmBy = Object.fromEntries(ppm.meals.map((m) => [m.key, m]));
    const meals = card({ cls: 'nu-meals-card', title: 'وجبات اليوم', aside: entries.length ? h('small', {}, 'بروتين الوجبة ≥ ', n0(ppm.threshold), ' جم') : null });
    for (const s of SECTIONS) {
      const g = groups[s.key];
      if (g.entries.length) {
        const m = ppmBy[s.key];
        meals.appendChild(h('button', { type: 'button', class: 'nu-meal', 'aria-label': `${s.label}: ${fmt(g.totals.kcal)} سعرة، ${fmt(g.totals.p)} جم بروتين${m && !m.ok ? '، البروتين أقل من المطلوب' : ''}. افتح التفاصيل`, onclick: () => sectionSheet(ctx, day, s.key) },
          h('span', { class: `nu-meal-dot is-${s.key}`, 'aria-hidden': 'true' }),
          h('div', { class: 'grow' }, h('b', {}, s.label, m && !m.ok ? h('span', { class: 'nu-under' }, 'بروتين قليل') : null), h('small', {}, itemsLine(g.entries))),
          h('span', { class: 'nu-fig' }, n0(g.totals.kcal), h('small', {}, 'سعرة')),
          h('span', { class: `nu-fig nu-c-p${m && !m.ok ? ' is-low' : ''}` }, n0(g.totals.p), h('small', {}, 'بروتين'))));
      } else {
        const y = yGroups[s.key];
        const row = h('div', { class: 'nu-meal is-empty' },
          h('span', { class: `nu-meal-dot is-${s.key}`, 'aria-hidden': 'true' }),
          h('a', { class: 'grow nu-meal-add', href: `#/nutrition/add?${new URLSearchParams({ d: day, s: s.key })}` }, h('b', {}, s.label), h('small', {}, 'سجّل')));
        if (y.entries.length) {
          row.appendChild(h('button', { type: 'button', class: 'nu-repeat', onclick: async () => { await addEntries(ctx, day, repeatSection(yEntries, s.key), `اتسجّل ${s.label} زي امبارح`); } },
            I('repeat', { size: 16 }), 'زي امبارح · ', n0(y.totals.kcal)));
        }
        meals.appendChild(row);
      }
    }
    blocks.push(meals);

    // ── insights: weight impact, eating window, quality ──
    // Weight impact: a closed day (past, or today after 20:00) uses what was eaten; earlier today it projects «on target».
    const final = !isToday || hour >= 20;
    const imp = final ? weightImpact(intake, burn) : entries.length ? weightImpact({ kcal: Math.max(intake.kcal, t.kcal) }, burn) : null;
    const ins = [];
    if (imp) {
      const word = imp.direction === 'surplus' ? 'فائض' : imp.direction === 'deficit' ? 'عجز' : 'متعادل';
      ins.push(h('div', { class: `nu-ins is-${imp.direction}` }, I('scale', { size: 18 }), h('div', { class: 'grow' },
        h('b', {}, final ? '' : 'لو قفلت على الهدف: ', imp.direction === 'even' ? 'قريب من الحرق' : [word, ' ', n0(Math.abs(imp.balance)), ' سعرة عن الحرق'], h('em', { class: 'nu-est' }, 'تقدير')),
        h('small', {}, imp.direction === 'even' ? 'الوزن ثابت تقريبًا على المعدل ده.' : [imp.direction === 'surplus' ? '+' : '−', n0(imp.grams), ' جم وزن · على المعدل ده: ', n0(imp.weeklyKg, 2), ' كجم في الأسبوع'],
          ' · الحرق ', n0(burn), ' (', DAY_TYPE_LABEL[t.type], ')'))));
    } else if (!burn && entries.length) {
      ins.push(h('a', { class: 'nu-ins', href: '#/profile' }, I('scale', { size: 18 }), h('div', { class: 'grow' }, h('b', {}, 'تأثير اليوم على الوزن'), h('small', {}, 'ضيف طولك ووزنك في الملف عشان نحسب الحرق (تقدير).'))));
    }
    const win = eatingWindow(entries);
    if (win) ins.push(h('div', { class: 'nu-ins' }, I('clock', { size: 18 }), h('div', { class: 'grow' }, h('b', {}, 'نافذة الأكل ', n0(win.hours), ' س', win.mins ? [' ', n0(win.mins), ' د'] : ''), h('small', {}, `أول أكلة ${win.first} · آخر أكلة ${win.last}`))));
    if (ppm.meals.length && ppm.under) ins.push(h('div', { class: 'nu-ins' }, I('bolt', { size: 18 }), h('div', { class: 'grow' }, h('b', {}, 'توزيع البروتين'),
      h('small', {}, `${ppm.meals.filter((m) => m.key !== 'snack').map((m) => `${m.label} ${m.p}`).join(' · ')} جم. الوجبة محتاجة ${ppm.threshold} جم على الأقل (حوالي 0.4 جم لكل كيلو).`))));
    if (ins.length) blocks.push(card({ cls: 'nu-ins-card', title: 'قراءة اليوم' }, ...ins));

    // ── end of day recap ──
    const eod = eodRecap(intake, t, R, { hour, isToday, waterMl, waterGoal });
    if (eod) {
      const q = dayQuality(intake, t, R, fiber);
      blocks.push(card({ cls: `nu-eod${eod.closed ? ' is-closed' : ''}`, title: 'ملخص آخر اليوم' },
        h('ul', { class: 'nu-checks' }, ...q.map((c) => h('li', { class: c.ok ? 'ok' : '' }, I(c.ok ? 'check' : 'x', { size: 16 }), c.label))),
        eod.missing.length ? h('p', { class: 'nu-eod-miss' }, eod.missing.join(' · ')) : null,
        h('p', { class: 'nu-eod-fix' }, eod.fix)));
    }

    // ── water + supplements ──
    blocks.push(waterCard(ctx, day, waterMl, waterGoal), supplementsCard(ctx, day, daily, nkv));

    el.textContent = '';
    el.append(top, h('div', { class: 'nu-body' }, ...blocks));
    el.querySelectorAll('.nu-card, .nu-mgrid, .nu-alert').forEach((c, i) => c.style.setProperty('--i', String(i)));
  }

  const off = ctx.on('food:changed', (d) => { if (d && d.supplements) return; if (!d || !d.day || d.day === day) render(); });
  const off2 = ctx.on('settings:changed', (d) => { if (d && (d.key === 'targets' || String(d.key).startsWith('nu.'))) render(); });
  const unswipe = swipe(el, (dir) => {
    if (dir > 0 && day < today) ctx.go('nutrition', dayParams(ctx, addDays(day, 1)));
    if (dir < 0) ctx.go('nutrition', { d: addDays(day, -1) });
  });
  await render();
  const cleanup = () => { alive = false; off(); off2(); unswipe(); };
  // Deep link from Today: #/nutrition?section=lunch → open that meal (or add to it when empty).
  const sec = params.section;
  if (SECTION_LABEL[sec]) {
    const has = (await getEntries(ctx.db, day)).some((e) => groupBySection([e])[sec].entries.length);
    if (has) sectionSheet(ctx, day, sec); else location.replace(`#/nutrition/add?${new URLSearchParams({ d: day, s: sec })}`);
  }
  return cleanup;
}

/** Horizontal swipe on the ledger. RTL: swiping right → newer day, left → older. Ignores sheets, inputs, chips row. */
function swipe(el, cb) {
  let x0 = null, y0 = null;
  const start = (e) => {
    if (e.touches.length !== 1 || e.target.closest('.nu-days, input, textarea, .nu-sug')) { x0 = null; return; }
    x0 = e.touches[0].clientX; y0 = e.touches[0].clientY;
  };
  const end = (e) => {
    if (x0 === null) return;
    const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0;
    x0 = null;
    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.6) cb(dx > 0 ? 1 : -1);
  };
  el.addEventListener('touchstart', start, { passive: true });
  el.addEventListener('touchend', end, { passive: true });
  return () => { el.removeEventListener('touchstart', start); el.removeEventListener('touchend', end); };
}

// ── water + supplements ──
function waterCard(ctx, day, waterMl, goalMl) {
  const cups = Math.round(waterMl / 250);
  const goalCups = cupsFor(goalMl);
  const set = async (c) => {
    try { await dailyPatch(ctx.db, day, (d) => ({ ...d, waterMl: Math.max(0, Math.min(40, c)) * 250 })); haptic(8); ctx.emit('food:changed', { day, water: true }); }
    catch { ctx.toast('ماقدرناش نحفظ المية. جرّب تاني.'); }
  };
  const pct = Math.min(100, Math.round((waterMl / goalMl) * 100));
  const dots = h('div', { class: 'nu-cups', 'aria-hidden': 'true' }, ...Array.from({ length: Math.min(goalCups, 16) }, (_, i) => h('i', { class: i < cups ? 'on' : '' })));
  return card({ cls: 'nu-water', title: h('span', {}, I('droplet', { size: 18 }), ' المية'), aria: 'المية', aside: h('small', {}, 'الهدف ', n0(goalMl / 1000, 1), ' لتر ≈ ', n0(goalCups), ' كوباية') },
    h('div', { class: 'nu-water-row' },
      h('div', { class: 'grow' }, h('b', { class: 'nu-water-v' }, n0(waterMl / 1000, 2), h('small', {}, ' لتر')), dots,
        h('div', { class: 'nu-bar', 'aria-hidden': 'true' }, h('i', { style: { width: `${pct}%` } }))),
      h('div', { class: 'step nu-step-sm' },
        h('button', { type: 'button', 'aria-label': 'زوّد كوباية', onclick: () => set(cups + 1) }, I('plus')),
        h('div', {}, h('span', { class: 'num', 'aria-live': 'polite' }, fmt(cups)), h('small', {}, 'كوباية')),
        h('button', { type: 'button', 'aria-label': 'قلّل كوباية', disabled: cups <= 0, onclick: () => set(cups - 1) }, I('minus')))),
    h('p', { class: 'nu-fine' }, 'الهدف من وزنك: 33 مل لكل كيلو، و500 مل زيادة يوم التمرين. تقدر تغيّره من الأهداف.'));
}

function supplementsCard(ctx, day, daily, nkv) {
  const list = Array.isArray(nkv.supplements) && nkv.supplements.length ? nkv.supplements : [];
  const taken = new Set(Array.isArray(daily.supplements) ? daily.supplements : daily.supplements && typeof daily.supplements === 'object' ? Object.keys(daily.supplements).filter((k) => daily.supplements[k]) : []);
  const toggle = async (name, btn) => {
    const on = !taken.has(name);
    if (on) taken.add(name); else taken.delete(name);
    btn.setAttribute('aria-pressed', String(on)); pop(btn); haptic(8);
    try { await dailyPatch(ctx.db, day, (d) => ({ ...d, supplements: [...taken] })); ctx.emit('food:changed', { day, supplements: true }); }
    catch { ctx.toast('ماقدرناش نحفظ. جرّب تاني.'); }
  };
  const body = list.length
    ? h('div', { class: 'chips nu-supps' }, ...list.map((n) => { const b = h('button', { type: 'button', class: 'chip', 'aria-pressed': String(taken.has(n)) }, I('check', { size: 14 }), n); b.addEventListener('click', () => toggle(n, b)); return b; }))
    : h('p', { class: 'nu-fine' }, 'لو بتاخد مكملات، اختارها مرة واحدة وبعدها علّم عليها كل يوم.');
  return card({ cls: 'nu-supp', title: h('span', {}, I('pill', { size: 18 }), ' المكملات'), aria: 'المكملات', aside: h('button', { type: 'button', class: 'nu-link', onclick: () => supplementsSheet(ctx, list) }, list.length ? 'عدّل' : 'اختار') },
    body, list.length ? h('p', { class: 'nu-fine' }, n0(taken.size), ' من ', n0(list.length), ' النهارده') : null);
}

function supplementsSheet(ctx, current) {
  const chosen = new Set(current);
  const custom = h('input', { id: 'nu-supp-new', type: 'text', maxlength: '40', autocomplete: 'off' });
  const wrap = h('div', { class: 'chips' });
  const draw = () => {
    wrap.textContent = '';
    for (const n of [...new Set([...SUPPLEMENT_CHIPS, ...chosen])]) {
      wrap.appendChild(h('button', { type: 'button', class: 'chip', 'aria-pressed': String(chosen.has(n)), onclick: () => { if (chosen.has(n)) chosen.delete(n); else chosen.add(n); draw(); } }, n));
    }
  };
  draw();
  const addBtn = h('button', { type: 'button', class: 'btn ghost', onclick: () => { const v = custom.value.replace(/[<>]/g, '').trim().slice(0, 40); if (v) { chosen.add(v); custom.value = ''; draw(); } } }, 'ضيف');
  ctx.sheet({ title: 'مكملاتك', body: h('div', {}, h('p', { class: 'lead' }, 'اختار اللي بتاخده. هيظهر كل يوم في صفحة الأكل.'), wrap,
    h('div', { class: 'field nu-inline' }, h('label', { for: 'nu-supp-new' }, 'مكمل تاني'), h('div', { class: 'nu-row' }, custom, addBtn))),
  actions: [{ label: 'احفظ', run: async () => {
    try { await kvPatch(ctx.db, 'nutrition', (n) => ({ ...n, supplements: [...chosen] })); ctx.emit('food:changed', {}); } catch { ctx.toast('ماقدرناش نحفظ.'); }
  } }, { label: 'إلغاء', ghost: true }] });
}

// ── day type + menu + calendar ──
function dayTypeSheet(ctx, day, t) {
  const set = async (v) => {
    await kvPatch(ctx.db, 'nutrition', (n) => {
      const o = { ...(n.dayTypeOverrides || {}) };
      if (v) o[day] = v; else delete o[day];
      return { ...n, dayTypeOverrides: o };
    }).catch(() => ctx.toast('ماقدرناش نحفظ. جرّب تاني.'));
    ctx.emit('food:changed', { day });
  };
  const item = (label, v) => h('button', { type: 'button', class: 'menu-item', 'aria-pressed': String((v || null) === (t.overridden ? t.type : null)), onclick: () => { s.close(); set(v); } }, label);
  const body = h('div', {}, h('p', { class: 'lead' }, 'الهدف بيتغيّر حسب نوع اليوم. لو سجّلت تمرين، اليوم بيتحسب يوم تمرين تلقائي.'),
    item('يوم تمرين', 'training'), item('يوم القلب', 'heart'), item('يوم راحة', 'rest'), item('حسب جدول التمرين', null));
  const s = ctx.sheet({ title: 'نوع اليوم', body });
}

function dayMenu(ctx, day, { entries, yEntries, groups, intake, t }) {
  const go = (r, p) => () => { s.close(); ctx.go(r, p); };
  const item = (ic, label, run, disabled = false) => h('button', { type: 'button', class: 'menu-item nu-mi', disabled, onclick: run }, I(ic, { size: 18 }), label);
  const body = h('div', { class: 'nu-menu' },
    item('repeat', yEntries.length ? `كرّر يوم امبارح كله (${fmt(Math.round(sumEntries(yEntries).kcal))} سعرة)` : 'كرّر يوم امبارح كله · امبارح فاضي', async () => {
      s.close();
      if (entries.length && !(await ctx.confirm({ title: 'تكرّر امبارح كله؟', text: `هيتضاف ${yEntries.length} صنف على اللي متسجّل النهارده.`, confirmLabel: 'كرّر اليوم' }))) return;
      const all = SECTIONS.flatMap((sec) => repeatSection(yEntries, sec.key));
      await addEntries(ctx, day, all, `اتكرّر امبارح · ${fmt(Math.round(sumEntries(all).kcal))} سعرة`);
    }, !yEntries.length),
    item('food', 'احفظ اليوم كله في وجباتي', () => { s.close(); saveMealSheet(ctx, entries, null, 'يوم كامل'); }, !entries.length),
    item('share', 'شارك اليوم (نص)', async () => {
      s.close();
      const text = dayShareText(dayLabel(day), groups, intake, t);
      try {
        if (navigator.share) await navigator.share({ title: 'حساب اليوم', text });
        else { await navigator.clipboard.writeText(text); ctx.toast('اتنسخ ملخص اليوم'); }
      } catch (e) { if (!(e && e.name === 'AbortError')) ctx.toast('ماقدرناش نشارك. جرّب تاني.'); }
    }, !entries.length),
    item('calendar', 'التقويم', () => { s.close(); calendarSheet(ctx, day); }),
    item('target', 'الأهداف والمدى', go('nutrition/targets')),
    item('list', 'أكلاتي', go('nutrition/foods')),
    item('book', 'وصفاتي', go('nutrition/recipes', { d: day })),
    item('chart', 'تحليل الأكل', go('nutrition/insights')));
  const s = ctx.sheet({ title: 'أدوات اليوم', body });
}

async function calendarSheet(ctx, day) {
  let y = Number(day.slice(0, 4)), m = Number(day.slice(5, 7)) - 1;
  const today = ctx.today();
  const box = h('div', { class: 'nu-calendar' });
  const s = ctx.sheet({ title: 'التقويم', body: box });
  const fmtMonth = new Intl.DateTimeFormat('ar-EG-u-nu-latn', { month: 'long', year: 'numeric' });
  async function draw() {
    const weeks = monthGrid(y, m, Number(ctx.settings.get('weekStart')) || 1);
    const days = weeks.flat().filter(Boolean);
    const [logs, tm] = await Promise.all([logRange(ctx.db, days[0], days[days.length - 1]), dayTargetsBulk(ctx, days)]);
    const byDay = new Map(logs.map((r) => [r.day, r.entries]));
    const dows = weeks[0].map((_, i) => new Intl.DateTimeFormat('ar-EG', { weekday: 'narrow' }).format(new Date(2026, 0, 4 + ((Number(ctx.settings.get('weekStart')) || 1) + i) % 7)));
    const prevM = h('button', { type: 'button', class: 'nu-ib nu-flip', 'aria-label': 'الشهر اللي قبله', onclick: () => { m--; if (m < 0) { m = 11; y--; } draw(); } }, I('chevron'));
    const nextDisabled = `${y}-${String(m + 1).padStart(2, '0')}` >= today.slice(0, 7);
    const nextM = h('button', { type: 'button', class: 'nu-ib', 'aria-label': 'الشهر اللي بعده', disabled: nextDisabled, onclick: () => { m++; if (m > 11) { m = 0; y++; } draw(); } }, I('chevron'));
    let logged = 0, closed = 0;
    const grid = h('div', { class: 'nu-cal-grid', role: 'grid' }, ...dows.map((d) => h('span', { class: 'nu-cal-dow', role: 'columnheader' }, d)));
    for (const w of weeks) for (const d of w) {
      if (!d) { grid.appendChild(h('span', { class: 'nu-cal-cell is-blank' })); continue; }
      const es = byDay.get(d) || [];
      const st = es.length ? dayBalance(sumEntries(es), tm.get(d)).state : 'none';
      if (es.length) logged++;
      if (st === 'closed') closed++;
      const future = d > today;
      grid.appendChild(h('button', { type: 'button', role: 'gridcell', class: `nu-cal-cell is-${st}${d === day ? ' is-cur' : ''}${d === today ? ' is-today' : ''}`, disabled: future,
        'aria-label': `${dayLabel(d)}${st === 'closed' ? ' · الحساب مقفول' : es.length ? ' · متسجّل' : ''}`, onclick: () => { s.close(); ctx.go('nutrition', d === today ? {} : { d }); } },
      h('span', { class: 'num' }, String(dnum(d)))));
    }
    box.textContent = '';
    box.append(h('div', { class: 'nu-cal-h' }, prevM, h('b', {}, fmtMonth.format(new Date(y, m, 15))), nextM), grid,
      h('p', { class: 'nu-fine' }, h('i', { class: 'nu-lg is-open' }), ' متسجّل ', n0(logged), '   ', h('i', { class: 'nu-lg is-closed' }), ' مقفول ', n0(closed), ' يوم'));
  }
  await draw();
}

// ── section detail ──
async function sectionSheet(ctx, day, section) {
  const entries = (await getEntries(ctx.db, day)).filter((e) => groupBySection([e])[section].entries.length);
  const tot = sumEntries(entries);
  const list = h('div', { class: 'nu-list' });
  for (const e of entries) {
    list.appendChild(h('button', { type: 'button', class: 'list-row', onclick: () => { s.close(); editEntrySheet(ctx, day, e); } },
      h('div', { class: 'grow' }, h('b', {}, e.name), h('small', {}, h('span', { class: 'num' }, fmt(e.qty, { dp: 1 })), ` ${e.unit || ''}`, e.time ? ` · ${e.time}` : '')),
      h('span', { class: 'nu-fig' }, n0(e.kcal), h('small', {}, 'سعرة')), h('span', { class: 'nu-fig nu-c-p' }, n0(e.p), h('small', {}, 'بروتين'))));
  }
  const body = h('div', {}, list,
    h('p', { class: 'nu-split' }, 'المجموع ', n0(tot.kcal), ' سعرة · ', n0(tot.p), ' بروتين · ', n0(tot.c), ' كارب · ', n0(tot.f), ' دهون'));
  const s = ctx.sheet({ title: SECTION_LABEL[section], body, actions: [
    { label: `ضيف للـ${SECTION_LABEL[section]}`, run: () => ctx.go('nutrition/add', { d: day, s: section }) },
    { label: 'احفظها في وجباتي', ghost: true, run: (api) => { api.close(); saveMealSheet(ctx, entries, section); } },
  ] });
}

export function saveMealSheet(ctx, entries, section, defName) {
  const input = h('input', { id: 'nu-meal-name', type: 'text', maxlength: '60', autocomplete: 'off', value: defName || `${SECTION_LABEL[section] || 'وجبة'} المعتاد` });
  const err = h('p', { class: 'err', id: 'nu-meal-err', 'aria-live': 'polite' });
  const body = h('div', {}, h('div', { class: 'field' }, h('label', { for: 'nu-meal-name' }, 'اسم الوجبة'), input, err));
  ctx.sheet({ title: 'احفظ في وجباتي', body, actions: [{ label: 'احفظ الوجبة', run: async () => {
    const r = mealFromEntries(input.value, entries, section);
    if (!r.ok) { err.textContent = r.message; input.setAttribute('aria-invalid', 'true'); return true; }
    try {
      await kvPatch(ctx.db, 'nutrition', (n) => ({ ...n, savedMeals: { ...(n.savedMeals || {}), [r.meal.id]: r.meal } }));
      ctx.toast(`اتحفظت «${r.meal.name}» في وجباتي`);
    } catch { ctx.toast('ماقدرناش نحفظ الوجبة. جرّب تاني.'); }
    return false;
  } }, { label: 'إلغاء', ghost: true }] });
}

/** Edit a logged entry: quantity, meal (section) and time; delete with Undo. */
function editEntrySheet(ctx, day, entry) {
  let section = sectionOf(entry);
  const secWrap = h('div', { class: 'chips nu-seg', role: 'group', 'aria-label': 'الوجبة' });
  const drawSec = () => { secWrap.textContent = ''; for (const s of SECTIONS) secWrap.appendChild(h('button', { type: 'button', class: 'chip', 'aria-pressed': String(s.key === section), onclick: () => { section = s.key; drawSec(); } }, s.label)); };
  drawSec();
  const time = h('input', { id: 'nu-e-time', type: 'time', value: /^\d{2}:\d{2}$/.test(entry.time || '') ? entry.time : '', class: 'num' });
  const extra = h('div', { class: 'nu-edit-extra' }, h('p', { class: 'nu-fl' }, 'الوجبة'), secWrap,
    h('div', { class: 'field' }, h('label', { for: 'nu-e-time' }, 'الوقت'), time));
  qtySheet(ctx, {
    title: entry.name, unit: entry.unit || 'جرام', qty: entry.qty || 1, extra,
    preview: (q) => rescaleEntry(entry, q),
    saveLabel: 'احفظ التعديل',
    onSave: async (q) => {
      const r = rescaleEntry(entry, q);
      if (!r.ok) return r.message;
      const next = { ...r.entry, section, time: /^\d{2}:\d{2}$/.test(time.value) ? time.value : entry.time };
      const all = await getEntries(ctx.db, day);
      await putEntries(ctx.db, day, all.map((e) => (e.id === entry.id ? next : e)));
      ctx.emit('food:changed', { day });
      ctx.toast('اتعدّل');
      return null;
    },
    onDelete: async () => {
      const all = await getEntries(ctx.db, day);
      const idx = all.findIndex((e) => e.id === entry.id);
      if (idx < 0) return;
      await putEntries(ctx.db, day, all.filter((e) => e.id !== entry.id));
      ctx.emit('food:changed', { day });
      ctx.toast(`اتشال «${entry.name}»`, { action: { label: 'تراجع', run: async () => {
        const now = await getEntries(ctx.db, day);
        now.splice(Math.min(idx, now.length), 0, entry);
        await putEntries(ctx.db, day, now);
        ctx.emit('food:changed', { day });
      } } });
    },
  });
}

// ═════════════════════════ coach route ═════════════════════════
// The coach UI is moving to features/coach (#/coach). Once that module renders its own screen (it no longer redirects
// back here), #/nutrition/coach redirects to #/coach. Until then the legacy screen in ./coach.js stays (not extended).
async function coachRoute(el, ctx, params) {
  try {
    const m = await import('../coach/index.js');
    const r = m && m.routes && m.routes.coach;
    if (typeof r === 'function' && !String(r).includes('nutrition/coach')) { location.replace('#/coach'); return undefined; }
  } catch { /* stay */ }
  return (await import('./coach.js')).coachScreen(el, ctx, params);
}

/** Exported for debugging / Today: the exact context text the coach would receive. */
export async function coachContextText(ctx) { return buildContextSummary(await coachContext(ctx)); }

const SCREENS = {
  add: () => import('./screens/add.js'),
  library: () => import('./screens/library.js'),
  targets: () => import('./screens/targets.js'),
  insights: () => import('./screens/insights.js'),
};
const lazy = (file, fn) => async (el, ctx, params) => (await SCREENS[file]())[fn](el, ctx, params);

export const routes = {
  nutrition: ledger,
  'nutrition/add': lazy('add', 'addScreen'),
  'nutrition/meals': lazy('library', 'mealsScreen'),
  'nutrition/foods': lazy('library', 'foodsScreen'),
  'nutrition/recipes': lazy('library', 'recipesScreen'),
  'nutrition/targets': lazy('targets', 'targetsScreen'),
  'nutrition/insights': lazy('insights', 'insightsScreen'),
  'nutrition/coach': coachRoute,
};


// #/nutrition/targets — adaptive engine suggestion (apply on confirm, snooze, history), TDEE (Mifflin + activity, تقدير),
// diet-mode presets, per-day-type targets, custom min–max ranges, water goal, meal reminders (opt-in, ≤ 2 a day).
import { h } from '../../../ui/dom.js';
import { fmt, parseNum } from '../../../ui/num.js';
import { pop, haptic } from '../../../ui/anim.js';
import { addDays } from '../../../core/date.js';
import { setTargets, validateTargets, kcalFromMacros } from '../../../core/targets.js';
import { DEFAULT_TARGETS } from '../../../core/schema.js';
import { DIET_MODES, dietModeTargets, adaptiveSuggestion, applyAdjustment, bmr, tdee, ACTIVITY_LEVELS, macroRanges, waterGoalMl } from '../logic.js';
import { kvGet, kvPatch, loadProfile, loadTargets, saveTargets, DAY_TYPE_LABEL } from '../data.js';
import { reminderSettings, MAX_REMINDERS } from '../reminders.js';
import { I, n0, topBar, card, field, segChips } from '../ui.js';

const fmtD = new Intl.DateTimeFormat('ar-EG-u-nu-latn', { day: 'numeric', month: 'short' });
const dShort = (d) => fmtD.format(new Date(`${d}T12:00:00`));

export async function targetsScreen(el, ctx) {
  let alive = true;
  async function render() {
    const [profile, targets, nkv] = await Promise.all([loadProfile(ctx), loadTargets(ctx.db), kvGet(ctx.db, 'nutrition')]);
    if (!alive) return;
    const today = ctx.today();
    const blocks = [];

    // ── adaptive engine ──
    const sug = adaptiveSuggestion(profile.weights, nkv.adjustmentHistory || [], { today, snoozeUntil: nkv.adaptiveSnoozeUntil || null });
    const hist = (nkv.adjustmentHistory || []).filter((x) => x && x.date).sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 6);
    if (sug) {
      const next = applyAdjustment(targets, sug.delta);
      const apply = h('button', { type: 'button', class: 'btn nu-cta' }, I('check'), 'طبّق التعديل');
      apply.addEventListener('click', async () => {
        const ok = await ctx.confirm({ title: sug.title, text: `يوم التمرين ${fmt(targets.training.kcal)} → ${fmt(next.training.kcal)} · يوم الراحة ${fmt(targets.rest.kcal)} → ${fmt(next.rest.kcal)} سعرة. الكارب بيتعدّل بالفرق والبروتين زي ما هو.`, confirmLabel: 'طبّق التعديل' });
        if (!ok) return;
        try {
          await saveTargets(ctx, next);
          await kvPatch(ctx.db, 'nutrition', (n) => ({ ...n, adjustmentHistory: [...(n.adjustmentHistory || []), { date: today, change: sug.delta, reason: sug.reason, weeklyChange: sug.change, newCal: next.training.kcal, newCalRest: next.rest.kcal }], lastAdaptiveRun: today }));
          haptic(); ctx.toast(`اتعدّلت الأهداف: ${sug.delta > 0 ? '+' : '−'}${Math.abs(sug.delta)} سعرة`);
        } catch { ctx.toast('ماقدرناش نحفظ الأهداف. جرّب تاني.'); }
        render();
      });
      const later = h('button', { type: 'button', class: 'btn ghost', onclick: async () => {
        await kvPatch(ctx.db, 'nutrition', (n) => ({ ...n, adaptiveSnoozeUntil: addDays(today, 7) })).catch(() => {});
        ctx.toast('تمام. هنراجع تاني بعد أسبوع.'); render();
      } }, 'مش دلوقتي');
      blocks.push(card({ cls: 'nu-adapt', title: h('span', {}, I('trend', { size: 18 }), ' اقتراح من وزنك'), aside: h('small', {}, 'مراجعة أسبوعية') },
        h('p', { class: 'nu-adapt-big' }, sug.title),
        h('p', {}, sug.reason),
        h('p', { class: 'nu-fine' }, 'الوزن ', n0(sug.from, 1), ' → ', n0(sug.to, 1), ' كجم · يوم التمرين ', n0(targets.training.kcal), ' → ', n0(next.training.kcal), ' · يوم الراحة ', n0(targets.rest.kcal), ' → ', n0(next.rest.kcal)),
        h('div', { class: 'nu-row' }, apply, later)));
    } else {
      blocks.push(card({ cls: 'nu-adapt is-quiet', title: h('span', {}, I('trend', { size: 18 }), ' المراجعة الأسبوعية') },
        h('p', { class: 'nu-fine' }, profile.weights.length < 3 ? 'سجّل وزنك 3 مرات على الأقل في أسبوع، والتطبيق هيقترح تعديل السعرات لو النزول أو الزيادة أسرع من اللازم.'
          : nkv.adaptiveSnoozeUntil && today < nkv.adaptiveSnoozeUntil ? `مأجّلة لحد ${dShort(nkv.adaptiveSnoozeUntil)}.` : 'وزنك ماشي في المعدل. مفيش تعديل مطلوب دلوقتي. القاعدة: نزول أكتر من 0.7 كجم في الأسبوع → +150، زيادة أكتر من 0.4 → −150.')));
    }
    if (hist.length) blocks.push(card({ cls: 'nu-hist', title: 'تعديلات سابقة' },
      ...hist.map((x) => h('div', { class: 'nu-hrow' }, h('span', { class: 'num nu-hdate' }, dShort(x.date)), h('div', { class: 'grow' }, h('b', { class: Number(x.change) > 0 ? 'nu-c-ok' : 'nu-c-f' }, `${Number(x.change) > 0 ? '+' : '−'}${fmt(Math.abs(Number(x.change) || 0))} سعرة`),
        h('small', {}, String(x.reason || '').replace(/[^\p{L}\p{N}\s.،,%+\-—()/]/gu, '').slice(0, 140))), x.newCal ? h('span', { class: 'nu-fig' }, n0(x.newCal), h('small', {}, 'جديد')) : null))));

    // ── TDEE ──
    const b = bmr(profile);
    const act = ACTIVITY_LEVELS.reduce((best, a) => (Math.abs(a.v - profile.activity) < Math.abs(best.v - profile.activity) ? a : best), ACTIVITY_LEVELS[2]);
    blocks.push(card({ cls: 'nu-tdee', title: 'الحرق اليومي', aside: h('em', { class: 'nu-est' }, 'تقدير') },
      b === null
        ? h('p', {}, 'محتاجين وزنك وطولك (وسنك) عشان نحسب الحرق. ', h('a', { href: '#/profile' }, 'افتح الملف'))
        : h('div', { class: 'nu-g3' },
          h('div', {}, h('b', { class: 'num' }, fmt(b)), h('span', {}, 'الحرق وانت مرتاح')),
          h('div', {}, h('b', { class: 'num nu-c-cal' }, fmt(tdee(profile, profile.activity, 'training'))), h('span', {}, 'يوم تمرين')),
          h('div', {}, h('b', { class: 'num nu-c-p' }, fmt(tdee(profile, profile.activity, 'rest'))), h('span', {}, 'يوم راحة'))),
      h('p', { class: 'nu-fl' }, 'مستوى النشاط'),
      segChips(ACTIVITY_LEVELS.map((a) => ({ value: a.v, label: a.label })), act.v, async (v) => { await ctx.settings.set('nu.activity', v); render(); }, 'مستوى النشاط'),
      h('p', { class: 'nu-fine' }, 'معادلة Mifflin-St Jeor. يوم التمرين = النشاط + 0.1، يوم الراحة = النشاط − 0.2. ', profile.kg ? ['وزنك ', n0(profile.kg, 1), ' كجم'] : '', profile.cm ? [' · طولك ', n0(profile.cm), ' سم'] : '')));

    // ── diet modes + targets form ──
    const TYPES = ['training', 'heart', 'rest'];
    const form = { training: { ...targets.training }, heart: { ...(targets.heart || DEFAULT_TARGETS.heart) }, rest: { ...targets.rest } };
    const inputs = {};
    const msgs = {};
    const fillForm = () => { for (const t of TYPES) for (const k of ['kcal', 'p', 'c', 'f']) inputs[t][k].input.value = String(form[t][k]); check(); };
    const check = () => {
      for (const t of TYPES) {
        const v = Object.fromEntries(['kcal', 'p', 'c', 'f'].map((k) => [k, parseNum(inputs[t][k].input.value)]));
        const r = validateTargets(v);
        msgs[t].textContent = '';
        if (r.issues.some((i) => i.code !== 'kcal_mismatch')) msgs[t].textContent = 'فيه رقم ناقص أو برّه الحدود (السعرات 800–7000).';
        else if (!r.ok) msgs[t].append('السعرات من الماكروز ', n0(kcalFromMacros(v)), ' والمكتوب ', n0(v.kcal), '. هيتحفظ، بس راجعهم.');
        else msgs[t].append('من الماكروز: ', n0(kcalFromMacros(v)), ' سعرة');
      }
    };
    const modeSel = nkv.dietMode && DIET_MODES[nkv.dietMode] ? nkv.dietMode : null;
    const modeChips = profile.kg
      ? segChips(Object.entries(DIET_MODES).map(([k, m]) => ({ value: k, label: m.label })), modeSel, (k) => {
        const r = dietModeTargets(k, profile.kg);
        if (!r) return;
        form.training = r.training; form.heart = r.heart; form.rest = r.rest; fillForm();
        modeDesc.textContent = `${DIET_MODES[k].desc} · من وزنك ${fmt(profile.kg, { dp: 1 })} كجم. راجع الأرقام واضغط «احفظ الأهداف».`;
        chosenMode = k;
      }, 'الهدف')
      : h('p', { class: 'nu-fine' }, 'سجّل وزنك الأول عشان الأهداف الجاهزة تتحسب منه.');
    let chosenMode = null;
    const modeDesc = h('p', { class: 'nu-fine', 'aria-live': 'polite' }, modeSel ? `الحالي: ${DIET_MODES[modeSel].label} · ${DIET_MODES[modeSel].desc}` : 'اختار هدف يملا الأرقام تحت من وزنك. تقدر تعدّلها.');
    const dayBlock = (t) => {
      inputs[t] = {};
      for (const [k, label] of [['kcal', 'سعرات'], ['p', 'بروتين جم'], ['c', 'كارب جم'], ['f', 'دهون جم']]) {
        inputs[t][k] = field(`nu-t-${t}-${k}`, label, { type: 'text', inputmode: 'numeric', class: 'num', value: String(form[t][k]) });
        inputs[t][k].input.addEventListener('input', check);
      }
      msgs[t] = h('p', { class: 'nu-fine', 'aria-live': 'polite' });
      return h('div', { class: `nu-tday is-${t}` }, h('h3', {}, h('span', { class: `nu-pill is-${t}` }, DAY_TYPE_LABEL[t])),
        h('div', { class: 'nu-four' }, ...['kcal', 'p', 'c', 'f'].map((k) => inputs[t][k].el)), msgs[t]);
    };
    const saveBtn = h('button', { type: 'button', class: 'btn nu-cta' }, 'احفظ الأهداف');
    saveBtn.addEventListener('click', async () => {
      let cur = await loadTargets(ctx.db);
      for (const t of TYPES) {
        const v = Object.fromEntries(['kcal', 'p', 'c', 'f'].map((k) => [k, parseNum(inputs[t][k].input.value)]));
        const r = setTargets(cur, t, v);
        if (!r.saved) { inputs[t].kcal.input.focus(); ctx.toast(`راجع أرقام ${DAY_TYPE_LABEL[t]}`); return; }
        cur = r.targets;
      }
      try {
        await saveTargets(ctx, cur);
        if (chosenMode) await kvPatch(ctx.db, 'nutrition', (n) => ({ ...n, dietMode: chosenMode }));
        pop(saveBtn); haptic(); ctx.toast('اتحفظت الأهداف');
      } catch { ctx.toast('ماقدرناش نحفظ الأهداف. جرّب تاني.'); }
    });
    blocks.push(card({ cls: 'nu-tform', title: 'الأهداف' }, h('p', { class: 'nu-fl' }, 'هدف جاهز'), modeChips, modeDesc, dayBlock('training'), dayBlock('heart'), dayBlock('rest'), saveBtn));
    check();

    // ── ranges ──
    const ranges = nkv.ranges || {};
    const R = macroRanges(targets.training, ranges);
    const rIn = {};
    const rangeRow = (k, label, defLo, defHi) => {
      const c = ranges[k];
      rIn[k] = {
        lo: h('input', { type: 'text', inputmode: 'numeric', class: 'num', value: c ? String(c.lo) : String(defLo), 'aria-label': `${label}: المسموح تحت الهدف` }),
        hi: h('input', { type: 'text', inputmode: 'numeric', class: 'num', value: c ? String(c.hi) : defHi === null ? '' : String(defHi), placeholder: 'من غير حد', 'aria-label': `${label}: المسموح فوق الهدف` }),
      };
      return h('div', { class: 'nu-range-row' }, h('b', {}, label), h('span', {}, '−'), rIn[k].lo, h('span', {}, '+'), rIn[k].hi);
    };
    const t0 = targets.training;
    const rangeBox = card({ cls: 'nu-ranges', title: 'المدى المسموح', aside: h('small', {}, Object.keys(ranges).length ? 'مخصص' : 'افتراضي') },
      h('p', { class: 'nu-fine' }, 'اليوم «بيتقفل» لما البروتين يوصل والسعرات تبقى جوّه المدى. الأرقام دي المسموح تحت/فوق هدف اليوم.'),
      rangeRow('kcal', 'سعرات', t0.kcal - R.kcal.min, R.kcal.max - t0.kcal), rangeRow('p', 'بروتين', t0.p - R.p.min, null),
      rangeRow('c', 'كارب', t0.c - R.c.min, R.c.max - t0.c), rangeRow('f', 'دهون', t0.f - R.f.min, R.f.max - t0.f),
      h('div', { class: 'nu-row' },
        h('button', { type: 'button', class: 'btn ghost', onclick: async () => {
          const out = {};
          for (const k of ['kcal', 'p', 'c', 'f']) {
            const lo = parseNum(rIn[k].lo.value), hiRaw = rIn[k].hi.value.trim(), hi = hiRaw === '' ? 9999 : parseNum(hiRaw);
            if (!(lo >= 0 && lo <= 2000 && hi >= 0 && hi <= 9999)) { rIn[k].lo.focus(); ctx.toast('الأرقام لازم تكون بين 0 و 2000'); return; }
            out[k] = { lo, hi };
          }
          await kvPatch(ctx.db, 'nutrition', (n) => ({ ...n, ranges: out })); ctx.emit('food:changed', {}); ctx.toast('اتحفظ المدى'); render();
        } }, 'احفظ المدى'),
        Object.keys(ranges).length ? h('button', { type: 'button', class: 'btn ghost', onclick: async () => { await kvPatch(ctx.db, 'nutrition', (n) => { const x = { ...n }; delete x.ranges; return x; }); ctx.emit('food:changed', {}); ctx.toast('رجع المدى الافتراضي'); render(); } }, 'رجّع الافتراضي') : null));
    blocks.push(rangeBox);

    // ── water + reminders ──
    const wCustom = Number(ctx.settings.get('nu.waterGoalMl')) || 0;
    const wIn = h('input', { id: 'nu-wg', type: 'text', inputmode: 'numeric', class: 'num', value: wCustom ? String(wCustom) : '', placeholder: String(waterGoalMl(profile.kg, 'rest')) });
    const rem = reminderSettings(ctx.settings.get('nu.reminders'));
    const times = rem.times.map((t, i) => h('input', { type: 'time', class: 'num', value: t, 'aria-label': `تذكير ${i + 1}` }));
    const remToggle = h('button', { type: 'button', class: 'nu-switch', role: 'switch', 'aria-checked': String(rem.on), 'aria-label': 'تذكيرات الأكل' }, h('i'));
    remToggle.addEventListener('click', async () => {
      const on = remToggle.getAttribute('aria-checked') !== 'true';
      if (on && typeof Notification !== 'undefined' && Notification.permission === 'default') { try { await Notification.requestPermission(); } catch { /* toast fallback */ } }
      remToggle.setAttribute('aria-checked', String(on));
      await ctx.settings.set('nu.reminders', reminderSettings({ on, times: times.map((x) => x.value) }));
      ctx.toast(on ? 'التذكيرات اشتغلت (والتطبيق مفتوح أو في الخلفية)' : 'التذكيرات اتقفلت');
    });
    for (const t of times) t.addEventListener('change', () => ctx.settings.set('nu.reminders', reminderSettings({ on: remToggle.getAttribute('aria-checked') === 'true', times: times.map((x) => x.value) })));
    blocks.push(card({ cls: 'nu-settings', title: 'المية والتذكيرات' },
      h('div', { class: 'field' }, h('label', { for: 'nu-wg' }, 'هدف المية (مل)'), wIn,
        h('small', { class: 'nu-fhint' }, 'فاضي = تلقائي من وزنك: ', n0(waterGoalMl(profile.kg, 'rest')), ' مل يوم الراحة و', n0(waterGoalMl(profile.kg, 'training')), ' يوم التمرين')),
      h('button', { type: 'button', class: 'btn ghost', onclick: async () => {
        const v = wIn.value.trim() === '' ? null : parseNum(wIn.value);
        if (v !== null && !(v >= 500 && v <= 8000)) { ctx.toast('اكتب رقم بين 500 و 8000 مل'); wIn.focus(); return; }
        await ctx.settings.set('nu.waterGoalMl', v); ctx.toast(v ? 'اتحفظ هدف المية' : 'هدف المية رجع تلقائي');
      } }, 'احفظ هدف المية'),
      h('div', { class: 'nu-switch-row' }, h('div', { class: 'grow' }, h('b', {}, 'تذكيرات الأكل'), h('small', {}, `مقفولة افتراضيًا · ${MAX_REMINDERS} في اليوم بالكتير`)), remToggle),
      h('div', { class: 'nu-row nu-times' }, ...times),
      h('p', { class: 'nu-fine' }, 'التذكير بيوصل والتطبيق مفتوح أو في الخلفية بس (مفيش سيرفر إشعارات).')));

    el.textContent = '';
    el.append(topBar(ctx, { title: 'الأهداف', sub: 'السعرات والماكروز والمدى', backTo: ['nutrition'] }), h('div', { class: 'nu-body' }, ...blocks));
  }
  const off = ctx.on('settings:changed', (d) => { if (d && d.key === 'targets') render(); });
  await render();
  return () => { alive = false; off(); };
}

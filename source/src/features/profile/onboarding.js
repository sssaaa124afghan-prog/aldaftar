// First run (#/profile/welcome): 3 short steps, one question each, every value prefilled, skippable.
// 1 weight (+ height)  2 training days  3 «راجع بعد انقطاع 3 شهور أو أكتر؟» → settings 'wk.reentry' = {startDay, weeks:2}.
// Defaults = the owner: 72 kg, 175 cm, Sat/Sun/Tue/Wed lifting + Thursday Boxing Day (plan v3). With the defaults it is 3 taps.
// Shown once: the gate (app/onboarding-gate.js) marks 'ob.seen' when it opens, so it never comes back; all of it is editable in Profile.
import { h, raw, fill } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { parseNum } from '../../ui/num.js';
import { validKg, latestWeight } from './weight.js';

export const OB_DEFAULTS = Object.freeze({ kg: 72, heightCm: 175, age: 27, trainingDays: Object.freeze([0, 2, 3, 6]), heartDow: 4 });
const DAYS = [[6, 'السبت'], [0, 'الأحد'], [1, 'الاتنين'], [2, 'التلات'], [3, 'الأربع'], [4, 'الخميس'], [5, 'الجمعة']];
const I = (n, o) => raw(icon(n, o));

/** Pure: what finishing writes. → {weight:{kg}|null, profile patch, settings:{key:value}} */
export function onboardingResult({ kg, heightCm, days, returning, today, profile = {} }) {
  const v = validKg(kg);
  const hcm = parseNum(heightCm);
  const settings = { trainingDays: [...new Set(days)].filter((d) => Number.isInteger(d) && d >= 0 && d <= 6).sort(), onboarded: today };
  if (returning) settings['wk.reentry'] = { startDay: today, weeks: 2 };
  const patch = { ...(Number.isFinite(hcm) && hcm >= 120 && hcm <= 230 ? { heightCm: Math.round(hcm) } : {}), ...(profile.age ? {} : { age: OB_DEFAULTS.age }) };
  return { weight: v.ok ? { kg: v.kg } : null, profile: patch, settings };
}

export async function renderWelcome(el, ctx, params = {}) {
  document.documentElement.classList.add('ob-on');
  const last = await latestWeight(ctx.db);
  let prof = {}; try { prof = (await ctx.db.get('profile', 'me')) || {}; } catch { /* new */ }
  const stored = ctx.settings.get('trainingDays');
  const st = {
    step: params.from === 'migrate' ? 2 : 1,
    kg: String(last ? last.kg : OB_DEFAULTS.kg),
    heightCm: String(prof.heightCm || OB_DEFAULTS.heightCm),
    days: new Set(Array.isArray(stored) && stored.length ? stored : OB_DEFAULTS.trainingDays),
  };
  const root = h('div', { class: 'ob' });
  el.appendChild(root);

  const finish = async (returning) => {
    const today = ctx.today();
    const r = onboardingResult({ kg: st.kg, heightCm: st.heightCm, days: [...st.days], returning, today, profile: prof });
    try {
      if (r.weight && !(last && last.day === today)) await ctx.db.put('bodyweight', { day: today, kg: r.weight.kg, src: 'onboarding', at: new Date().toISOString() });
      if (Object.keys(r.profile).length) await ctx.db.put('profile', { ...prof, key: 'me', ...r.profile });
      for (const [k, v] of Object.entries(r.settings)) await ctx.settings.set(k, v);
    } catch { ctx.toast('ماقدرناش نحفظ دلوقتي — جرّب تاني.'); return; }
    ctx.emit('weight:changed', { day: today });
    ctx.toast(returning ? 'جاهز. أول أسبوعين «أسبوع رجوع»: أوزان أخف وسيب 3–4 عدّات.' : 'جاهز. تقدر تغيّر أي حاجة من الملف.');
    ctx.go('today');
  };
  const skip = async () => { try { await ctx.settings.set('onboarded', 'skipped'); } catch { /* best effort */ } ctx.go('today'); };

  const frame = (n, title, sub, body, next) => fill(root,
    h('header', { class: 'ob-top' },
      h('p', { class: 'ob-dots', role: 'img', 'aria-label': `خطوة ${n} من 3` }, ...[1, 2, 3].map((i) => h('i', { class: i <= n ? 'on' : '', 'aria-hidden': 'true' }))),
      h('button', { type: 'button', class: 'ob-skip', onclick: skip }, 'تخطّي')),
    h('h1', { class: 'ob-h', tabindex: '-1' }, title), sub ? h('p', { class: 'ob-sub' }, sub) : null,
    h('div', { class: 'ob-body' }, ...[body].flat().filter(Boolean)),
    next ? h('div', { class: 'ob-acts' }, next) : null);

  const draw = () => {
    if (st.step === 1) {
      const kg = h('input', { id: 'ob-kg', type: 'text', inputmode: 'decimal', autocomplete: 'off', class: 'num', value: st.kg, 'aria-describedby': 'ob-kg-err' });
      const hc = h('input', { id: 'ob-h', type: 'text', inputmode: 'numeric', autocomplete: 'off', class: 'num', value: st.heightCm });
      const err = h('p', { class: 'err', id: 'ob-kg-err', 'aria-live': 'polite' });
      kg.addEventListener('input', () => { st.kg = kg.value; err.textContent = ''; kg.removeAttribute('aria-invalid'); });
      hc.addEventListener('input', () => { st.heightCm = hc.value; });
      const next = h('button', { type: 'button', class: 'btn' }, 'التالي');
      next.addEventListener('click', () => {
        const v = validKg(kg.value);
        if (!v.ok) { err.textContent = v.message; kg.setAttribute('aria-invalid', 'true'); kg.focus(); return; }
        st.kg = String(v.kg); st.step = 2; draw();
      });
      kg.addEventListener('keydown', (e) => { if (e.key === 'Enter') next.click(); });
      frame(1, 'وزنك كام النهارده؟', 'بيحدد أهداف الأكل والمية. على الريق لو تقدر.',
        [h('div', { class: 'field ob-big' }, h('label', { for: 'ob-kg' }, 'الوزن (كجم)'), kg, err),
          h('div', { class: 'field' }, h('label', { for: 'ob-h' }, 'الطول (سم)'), hc)], next);
    } else if (st.step === 2) {
      const chips = h('div', { class: 'chips ob-days', role: 'group', 'aria-labelledby': 'ob-days-l' });
      for (const [d, name] of DAYS) {
        const b = h('button', { type: 'button', class: 'chip', 'aria-pressed': String(st.days.has(d)) }, name);
        b.addEventListener('click', () => { if (st.days.has(d)) st.days.delete(d); else st.days.add(d); b.setAttribute('aria-pressed', String(st.days.has(d))); });
        chips.appendChild(b);
      }
      const next = h('button', { type: 'button', class: 'btn', onclick: () => { st.step = 3; draw(); } }, 'التالي');
      frame(2, 'بتتمرن حديد أنهي أيام؟', 'الأيام دي بتحدد هدف الأكل لكل يوم.',
        [h('p', { class: 'vh', id: 'ob-days-l' }, 'أيام الحديد'), chips,
          h('p', { class: 'ob-note' }, I('heart', { size: 16 }), 'الخميس يوم الملاكمة: 35 دقيقة شوال وتكنيك، مش جلسة حديد.')], next);
    } else {
      const yes = h('button', { type: 'button', class: 'btn', dataset: { ob: 'yes' }, onclick: () => finish(true) }, 'أيوه، راجع بعد انقطاع');
      const no = h('button', { type: 'button', class: 'btn ghost', dataset: { ob: 'no' }, onclick: () => finish(false) }, 'لا، أنا مكمّل');
      frame(3, 'راجع بعد انقطاع 3 شهور أو أكتر؟', 'لو أيوه: أول أسبوعين أوزان أخف ومجموعات أقل، وبعدها الخطة العادية. العضل بيرجع أسرع من أول مرة.',
        h('div', { class: 'ob-choice' }, yes, no), null);
    }
    requestAnimationFrame(() => { const t = root.querySelector('.ob-h'); t && t.focus({ preventScroll: true }); });
  };
  draw();
  return () => document.documentElement.classList.remove('ob-on');
}

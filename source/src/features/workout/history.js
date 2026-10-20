// #/workout/history — weekly hard sets per muscle vs MEV/MAV/MRV, per-exercise progress, sessions list.
import { h, N, ico, band, relDay, dateLabel, safeWrite } from './view.js';
import * as L from './logic.js';
import { loadAll, deleteSession } from './store.js';
import { MUSCLE_LM } from './exercises.js';
import { weekStart, addDays } from '../../core/date.js';
import { countWord } from '../../ui/num.js';

const STATUS = { under: 'تحت الحد الأدنى', in: 'في المدى', high: 'فوق المثالي', over: 'فوق المتحمَّل' };

export async function renderHistory(el, ctx, params = {}) {
  const today = ctx.today();
  const { done } = await loadAll(ctx.db);
  el.appendChild(band({ title: 'السجل والتقدّم', sub: [N(String(done.length)), ' ' + countWord(done.length, 'session') + ' متسجّلة'], back: () => ctx.go('workout') }));
  if (!done.length) {
    el.appendChild(h('div', { class: 'empty-state' },
      h('h2', {}, 'لسه مفيش جلسات'),
      h('p', {}, 'أول جلسة تقفلها هتظهر هنا مع أرقامك.'),
      h('button', { type: 'button', class: 'btn', onclick: () => ctx.go('workout') }, 'ابدأ أول تمرين')));
    return;
  }

  // weekly hard sets
  const ws = weekStart(today, ctx.settings.get('weekStart') ?? 1);
  const vol = L.hardSetsByMuscle(done, ws, addDays(ws, 6), { by: 'muscle' });
  const volCard = h('section', { class: 'sheet-card wk-mt', 'aria-labelledby': 'wk-vol-h' },
    h('h3', { id: 'wk-vol-h' }, 'سيتات صعبة لكل عضلة', h('small', {}, 'الأسبوع ده · RIR ≤ 3 · المساعدة بنص مجموعة')),
    h('div', { class: 'wk-row4 wk-head' }, h('span', {}, 'العضلة'), h('span', {}, 'سيتات'), h('span', {}, 'المدى'), h('span', {}, 'الحالة')));
  for (const [g, lm] of Object.entries(MUSCLE_LM)) {
    const st = L.landmarkStatus(vol[g], lm);
    volCard.appendChild(h('div', { class: 'wk-row4' }, h('span', {}, g), N(String(Math.round(vol[g] * 10) / 10)), N(`${lm.mev}–${lm.mav}`),
      h('span', { class: `wk-st wk-st-${st}${st === 'over' ? ' over' : ''}` }, STATUS[st])));
  }
  volCard.appendChild(h('p', { class: 'wk-muted wk-pad' }, 'MEV أقل حجم بيجيب نتيجة، MAV المثالي، MRV أقصى حجم تقدر تتعافى منه.'));
  el.appendChild(volCard);

  // per-exercise progress
  const byKey = new Map();
  for (const s of done) for (const e of s.exercises) {
    if (!L.doneSets(e).length) continue;
    const k = L.exKey(e);
    const cur = byKey.get(k) || { k, name: L.displayName(e), n: 0, kind: L.kindOf(e), sample: e };
    cur.n++; byKey.set(k, cur);
  }
  const opts = [...byKey.values()].sort((a, b) => (b.kind === 'compound') - (a.kind === 'compound') || b.n - a.n);
  let sel = byKey.has(params.ex) ? params.ex : opts[0]?.k;
  const select = h('select', { id: 'wk-ex-sel', onchange: (ev) => { sel = ev.target.value; drawProg(); } },
    ...opts.map((o) => h('option', { value: o.k, selected: o.k === sel }, `${o.name} (${o.n})`)));
  const progBody = h('div');
  const prog = h('section', { class: 'sheet-card wk-mt', 'aria-labelledby': 'wk-prog-h' },
    h('h3', { id: 'wk-prog-h' }, 'تقدّم تمرين', h('small', {}, 'e1RM بمعادلة Epley')),
    h('div', { class: 'field' }, h('label', { for: 'wk-ex-sel' }, 'التمرين'), select), progBody);
  function drawProg() {
    progBody.textContent = '';
    const o = byKey.get(sel); if (!o) return;
    const rows = L.exposures(done, o.sample).slice(0, 12);
    const best = Math.max(...rows.map((r) => L.bestE1rmOf(r.ex)));
    progBody.appendChild(h('div', { class: 'wk-row wk-head' }, h('span', {}, 'اليوم'), h('span', {}, 'أعلى مجموعة'), h('span', {}, 'e1RM')));
    for (const { session, ex } of rows) {
      const top = L.doneSets(ex).reduce((b, t) => (L.e1rm(t.w, t.r) > L.e1rm(b.w, b.r) ? t : b));
      const e = L.bestE1rmOf(ex);
      progBody.appendChild(h('div', { class: 'wk-row' }, h('span', {}, ...relDay(session.day, today)), N(`${L.fmtW(top.w)} × ${top.r}`),
        N(L.fmtW(Math.round(e)), undefined, e === best ? 'pr' : '')));
    }
    if (rows.length >= 2) {
      const d = Math.round(L.bestE1rmOf(rows[0].ex) - L.bestE1rmOf(rows[rows.length - 1].ex));
      progBody.appendChild(h('div', { class: 'wk-tot grand rule-open' }, h('span', {}, `التغيّر في آخر ${rows.length} مرات`), N(`${d > 0 ? '+' : d < 0 ? '−' : ''}${Math.abs(d)} كجم`)));
    }
  }
  drawProg();
  el.appendChild(prog);

  // sessions list
  const list = h('section', { class: 'sec wk-ses', 'aria-labelledby': 'wk-ses-h' }, h('h3', { id: 'wk-ses-h' }, 'الجلسات'));
  const rev = [...done].reverse();
  let shown = 0;
  const box = h('div');
  const more = h('button', { type: 'button', class: 'btn ghost wk-mt', onclick: () => page() }, 'اعرض أقدم');
  function page() {
    for (const s of rev.slice(shown, shown + 20)) {
      box.appendChild(h('button', { type: 'button', class: 'list-row', onclick: () => detail(s) },
        h('span', { class: 'grow' }, h('b', {}, s.dayName || 'جلسة'),
          h('small', {}, ...dateLabel(s.day), ' · ', N(String(L.sessionSetCount(s))), ` ${countWord(L.sessionSetCount(s), 'set')}`, s.durationMin ? [' · ', N(String(s.durationMin)), ' دقيقة'] : null,
            s.exercises.some((e) => e.pr) ? [' · ', h('span', { class: 'pr' }, 'رقم شخصي')] : null)),
        h('span', {}, N(L.fmtInt(L.sessionVolume(s))), h('small', {}, 'كجم'))));
    }
    shown += 20;
    more.hidden = shown >= rev.length;
  }
  page();
  list.append(box, more);
  el.appendChild(list);

  function detail(s) {
    const body = h('div', { class: 'wk-detail' });
    for (const e of s.exercises) {
      const sets = L.doneSets(e);
      if (!sets.length) continue;
      body.appendChild(h('div', { class: 'wk-dex' }, h('b', {}, L.displayName(e)),
        h('p', {}, ...sets.flatMap((t, i) => [i ? '  ·  ' : '', N(`${L.fmtW(t.w)} × ${t.r}`)]), e.pr ? h('span', { class: 'pr' }, '  رقم شخصي') : null)));
    }
    body.appendChild(h('div', { class: 'wk-tot grand rule-open rule-closed' }, h('span', {}, 'الحجم'), h('span', {}, N(L.fmtInt(L.sessionVolume(s))), ' كجم')));
    ctx.sheet({ title: s.dayName || 'جلسة', body, actions: [{ label: 'امسح الجلسة دي', ghost: true, danger: true, run: async () => {
      const ok = await ctx.confirm({ title: 'نمسح الجلسة؟', text: 'الجلسة دي ومجموعاتها هتتمسح من السجل.', confirmLabel: 'امسح الجلسة', danger: true });
      if (!ok) return;
      if (await safeWrite(ctx, () => deleteSession(ctx.db, s.id))) { ctx.emit('session:changed', { id: s.id, state: 'deleted' }); ctx.go('workout/history'); }
    } }] });
  }
}

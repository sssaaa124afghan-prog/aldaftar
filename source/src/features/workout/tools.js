// #/workout/tools — calculators and timers (parity T1-T3, T7, T8): 1RM (Epley + Brzycki), %1RM load table from a
// logged best or a typed 1RM, plate calculator (bar setting wk.bar), standalone rest timer, interval / Tabata timer.
import { h, N, ico, band } from './view.js';
import * as L from './logic.js';
import { loadAll } from './store.js';
import { parseNum } from '../../ui/num.js';
import { ring } from '../../ui/ring.js';
import { tone, speak } from './kit.js';
import { canVibrate } from './view.js';

export async function renderTools(el, ctx, params = {}) {
  const { done } = await loadAll(ctx.db);
  el.appendChild(band({ title: 'الأدوات', sub: '1RM · نسب الحمل · الأقراص · المؤقّتات', back: () => ctx.go(params.from === 'session' ? 'workout/session' : 'workout') }));
  const root = h('div', { class: 'wk-tools' });
  el.appendChild(root);
  let closed = false;
  const num = (id, label, value, hint) => {
    const i = h('input', { id, type: 'text', inputmode: 'decimal', class: 'num', value: value ?? '', autocomplete: 'off' });
    return [i, h('div', { class: 'field' }, h('label', { for: id }, label), i, hint ? h('p', { class: 'hint' }, hint) : null)];
  };

  // ── 1RM (T1) ──
  const [w1, w1f] = num('wk-t-w', 'الوزن (كجم)', '100');
  const [r1, r1f] = num('wk-t-r', 'العدّات', '5');
  const out1 = h('div', { class: 'wk-calc-out', 'aria-live': 'polite' });
  const calc1 = () => {
    const w = parseNum(w1.value), r = parseNum(r1.value);
    out1.textContent = '';
    if (!(w > 0) || !(r > 0) || r > 15) { out1.append(h('p', { class: 'wk-muted' }, 'اكتب وزن وعدّات من 1 لـ 15.')); return; }
    const e = L.e1rm(w, r), b = L.brzycki(w, r);
    out1.append(h('div', { class: 'wk-big' }, N(L.fmtW(e)), h('small', {}, ' كجم · Epley · تقدير')), h('p', { class: 'wk-muted' }, 'Brzycki: ', N(L.fmtW(b)), ' كجم'));
    fillTable(e);
  };
  w1.addEventListener('input', calc1); r1.addEventListener('input', calc1);
  root.appendChild(h('section', { class: 'glass wk-card', 'aria-labelledby': 'wk-t1' }, h('h3', { id: 'wk-t1' }, 'حاسبة 1RM'), h('div', { class: 'wk-two' }, w1f, r1f), out1));

  // ── %1RM table (T2) ──
  const byKey = new Map();
  for (const s of done) for (const e of s.exercises) { const k = L.exKey(e); const b = L.bestE1rmOf(e); if (b > (byKey.get(k)?.b || 0)) byKey.set(k, { k, b, name: L.displayName(e) }); }
  const opts = [...byKey.values()].sort((a, b) => b.b - a.b);
  const sel = h('select', { id: 'wk-t-ex', onchange: () => { const o = byKey.get(sel.value); if (o) { oneRm.value = L.fmtW(Math.round(o.b)); fillTable(o.b); } } },
    h('option', { value: '' }, 'من الحاسبة فوق أو اكتب 1RM'), ...opts.map((o) => h('option', { value: o.k }, `${o.name} · ${L.fmtW(Math.round(o.b))}`)));
  const [oneRm, oneRmF] = num('wk-t-1rm', '1RM (كجم)', '');
  oneRm.addEventListener('input', () => fillTable(parseNum(oneRm.value)));
  const table = h('div', { class: 'wk-ltable' });
  function fillTable(v) {
    table.textContent = '';
    const rows = L.loadTable(v);
    if (!rows.length) return;
    table.appendChild(h('div', { class: 'wk-lrow head' }, h('span', {}, '%'), h('span', {}, 'الوزن'), h('span', {}, 'عدّات')));
    for (const r of rows) table.appendChild(h('div', { class: 'wk-lrow' }, N(`${r.pct}%`), N(`${L.fmtW(r.w)} كجم`), N(String(r.r))));
  }
  root.appendChild(h('section', { class: 'glass wk-card', 'aria-labelledby': 'wk-t2' }, h('h3', { id: 'wk-t2' }, 'جدول نسب الحمل (%1RM)'),
    opts.length ? h('div', { class: 'field' }, h('label', { for: 'wk-t-ex' }, 'من أفضل أرقامك'), sel) : null, oneRmF, table));

  // ── plates (T3) ──
  const bar = () => +(ctx.settings.get('wk.bar') || 20);
  const [pw, pwf] = num('wk-t-pw', 'الوزن الكلي على البار (كجم)', params.w || '100');
  const barChips = h('div', { class: 'chips', role: 'radiogroup', 'aria-labelledby': 'wk-t-bar' });
  const plateOut = h('div', { class: 'wk-plates-out', 'aria-live': 'polite' });
  const paintBar = () => { barChips.textContent = ''; for (const b of [20, 15, 10]) barChips.appendChild(h('button', { type: 'button', class: 'chip', role: 'radio', 'aria-checked': String(bar() === b), onclick: async () => { await ctx.settings.set('wk.bar', b); paintBar(); calcPlates(); } }, N(String(b)), ' كجم')); };
  function calcPlates() {
    const p = L.platesFor(parseNum(pw.value), bar());
    plateOut.textContent = '';
    if (!p.perSide.length) { plateOut.append(h('p', { class: 'wk-muted' }, 'الوزن ده البار لوحده أو أقل.')); return; }
    plateOut.append(h('div', { class: 'wk-platevis', 'aria-hidden': 'true' }, ...p.perSide.map((x) => h('i', { class: `p${String(x).replace('.', '_')}` }))),
      h('p', { class: 'wk-big' }, N(p.perSide.map(L.fmtW).join(' + ')), h('small', {}, ' لكل جنب')),
      p.rest > 0 ? h('p', { class: 'wk-muted' }, 'فاضل ', N(L.fmtW(p.rest)), ' كجم مش بتتركب بالأقراص العادية') : '');
  }
  pw.addEventListener('input', calcPlates);
  paintBar();
  root.appendChild(h('section', { class: 'glass wk-card', 'aria-labelledby': 'wk-t3' }, h('h3', { id: 'wk-t3' }, 'حاسبة الأقراص'), pwf,
    h('div', { class: 'field' }, h('span', { class: 'lbl', id: 'wk-t-bar' }, 'وزن البار'), barChips), plateOut));

  // ── rest timer (T8) + interval timer (T7) ──
  const T = { mode: null, endsAt: 0, total: 0, phases: [], idx: 0 };
  const tWrap = h('div', { class: 'wk-ttimer' });
  const tLbl = h('p', { class: 'wk-muted', 'aria-live': 'polite' });
  const stopBtn = h('button', { type: 'button', class: 'btn ghost sm', hidden: true, onclick: stop }, ico('x'), 'وقّف');
  function startRest(sec) { T.mode = 'rest'; T.phases = [{ label: 'راحة', sec }]; T.idx = 0; T.endsAt = Date.now() + sec * 1000; paintT(true); }
  function startHiit(work, rest, rounds) {
    T.mode = 'hiit'; T.phases = [];
    for (let i = 1; i <= rounds; i++) { T.phases.push({ label: `شغل · جولة ${i} من ${rounds}`, sec: work, work: true }); if (i < rounds) T.phases.push({ label: 'راحة', sec: rest }); }
    T.idx = 0; T.endsAt = Date.now() + work * 1000; paintT(true);
  }
  function stop() { T.mode = null; paintT(true); }
  let tNum = null, tArc = null;
  function paintT(full) {
    stopBtn.hidden = !T.mode;
    if (!T.mode) { tWrap.textContent = ''; tLbl.textContent = 'اختار مؤقّت.'; tNum = tArc = null; return; }
    const ph = T.phases[T.idx];
    const left = Math.max(0, Math.ceil((T.endsAt - Date.now()) / 1000));
    if (full || !tNum) {
      tWrap.textContent = '';
      const svg = ring({ value: left, max: ph.sec, size: 140, stroke: 10, color: ph.work ? 'var(--orange, #FB923C)' : 'var(--pro, #BAE6FD)', label: ph.label });
      tArc = svg.querySelector('.ring-arc');
      tNum = h('b', { class: 'num' }, L.fmtClock(left));
      tWrap.appendChild(h('div', { class: 'wk-ring', role: 'timer' }, svg, h('div', { class: 'c' }, tNum, h('span', {}, ph.label))));
      tLbl.textContent = ph.label;
    }
    tNum.textContent = L.fmtClock(left);
    const c = 2 * Math.PI * 65;
    if (tArc && !full) { tArc.style.transition = 'none'; tArc.setAttribute('stroke-dasharray', `${c * (left / ph.sec)} ${c}`); }
  }
  function tick() {
    if (closed || !T.mode) return;
    if (Date.now() >= T.endsAt) {
      if (canVibrate()) try { navigator.vibrate([120, 80, 120]); } catch { /* optional */ }
      tone(ctx);
      if (T.idx >= T.phases.length - 1) { speak(ctx, T.mode === 'hiit' ? 'خلص التمرين' : 'الراحة خلصت'); ctx.toast(T.mode === 'hiit' ? 'خلص الإنترفال.' : 'الراحة خلصت.'); T.mode = null; paintT(true); return; }
      T.idx++; T.endsAt += T.phases[T.idx].sec * 1000; speak(ctx, T.phases[T.idx].work ? 'شغل' : 'راحة'); paintT(true); return;
    }
    paintT(false);
  }
  const iv = setInterval(tick, 250);
  const [hw, hwf] = num('wk-t-hw', 'شغل (ثانية)', '20');
  const [hr, hrf] = num('wk-t-hr', 'راحة (ثانية)', '10');
  const [hn, hnf] = num('wk-t-hn', 'جولات', '8');
  root.appendChild(h('section', { class: 'glass wk-card', 'aria-labelledby': 'wk-t4' }, h('h3', { id: 'wk-t4' }, 'المؤقّتات'),
    h('p', { class: 'lbl' }, 'راحة سريعة'),
    h('div', { class: 'chips' }, ...[30, 60, 90, 120, 180].map((s) => h('button', { type: 'button', class: 'chip', onclick: () => startRest(s) }, N(L.fmtClock(s))))),
    h('p', { class: 'lbl wk-mt' }, 'إنترفال / تاباتا'),
    h('div', { class: 'wk-three' }, hwf, hrf, hnf),
    h('div', { class: 'btn-row' },
      h('button', { type: 'button', class: 'btn sm', onclick: () => { const w = parseNum(hw.value), r = parseNum(hr.value), n = parseNum(hn.value); if (w >= 5 && w <= 600 && r >= 0 && r <= 600 && n >= 1 && n <= 50) startHiit(Math.round(w), Math.round(r), Math.round(n)); else ctx.toast('اكتب شغل 5-600 ث، راحة 0-600 ث، وجولات 1-50.'); } }, ico('play'), 'ابدأ الإنترفال'),
      h('button', { type: 'button', class: 'btn ghost sm', onclick: () => startHiit(20, 10, 8) }, 'تاباتا 20/10 × 8')),
    tWrap, tLbl, stopBtn));
  paintT(true);
  calc1(); calcPlates();
  return () => { closed = true; clearInterval(iv); };
}

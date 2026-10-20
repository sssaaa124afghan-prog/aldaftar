// #/nutrition/insights — this week vs last week, 14-day kcal bars against the target band, 30-day eating patterns.
// Local only (no AI). The same pure helpers are exported from logic.js for WP-Analytics.
import { h } from '../../../ui/dom.js';
import { fmt } from '../../../ui/num.js';
import { addDays, dayRange } from '../../../core/date.js';
import { sumEntries } from '../../../core/targets.js';
import { weekStats, compareWeeks, eatingPatterns, dayBalance } from '../logic.js';
import { logRange, dayTargetsBulk, loadWeights, dayLabel } from '../data.js';
import { I, n0, topBar, card } from '../ui.js';

const shortFmt = new Intl.DateTimeFormat('ar-EG-u-nu-latn', { weekday: 'short' });

export async function insightsScreen(el, ctx) {
  const today = ctx.today();
  const from = addDays(today, -29);
  const days = dayRange(from, today);
  const [logs, tm, ws] = await Promise.all([logRange(ctx.db, from, today), dayTargetsBulk(ctx, days), loadWeights(ctx.db)]);
  const byDay = new Map(logs.map((r) => [r.day, r.entries]));
  const kgBy = new Map(ws.map((w) => [w.day, w.kg]));
  const mk = (list) => list.map((d) => ({ day: d, entries: byDay.get(d) || [], kg: kgBy.get(d), target: tm.get(d) }));
  const thisW = mk(dayRange(addDays(today, -6), today));
  const lastW = mk(dayRange(addDays(today, -13), addDays(today, -7)));
  const cur = weekStats(thisW, (d) => tm.get(d));
  const prev = weekStats(lastW, (d) => tm.get(d));
  const blocks = [];

  if (cur) {
    const rows = compareWeeks(cur, prev);
    blocks.push(card({ cls: 'nu-cmp', title: 'الأسبوع ده مقابل اللي قبله', aside: h('small', {}, 'آخر 7 أيام') },
      h('div', { class: 'nu-cmp-grid' }, h('span', {}), h('small', {}, 'دلوقتي'), h('small', {}, 'قبلها'), h('small', {}, 'الفرق'),
        ...rows.flatMap((r) => [h('span', {}, r.label), h('b', { class: 'num' }, r.cur === null ? '—' : fmt(r.cur, { dp: r.key === 'avgKg' ? 1 : 0 })), h('span', { class: 'num nu-mu' }, r.prev === null || r.prev === undefined ? '—' : fmt(r.prev, { dp: r.key === 'avgKg' ? 1 : 0 })),
          h('span', { class: `num${r.good === true ? ' nu-c-ok' : r.good === false ? ' nu-c-bad' : ''}` }, r.diff === null ? '—' : fmt(r.diff, { dp: r.key === 'avgKg' ? 1 : 0, sign: true }))])),
      cur.bestDay ? h('p', { class: 'nu-fine' }, I('check', { size: 14 }), ' أحسن يوم: ', dayLabel(cur.bestDay.day), ' · ', n0(cur.bestDay.kcal), ' سعرة · ', n0(cur.bestDay.p), ' جم بروتين') : null));
  }

  // 14-day kcal bars vs the target band
  const last14 = dayRange(addDays(today, -13), today);
  const maxK = Math.max(1, ...last14.map((d) => sumEntries(byDay.get(d) || []).kcal), ...last14.map((d) => tm.get(d).kcal * 1.15));
  const bars = h('div', { class: 'nu-bars', role: 'img', 'aria-label': 'السعرات آخر 14 يوم مقابل مدى الهدف' });
  let logged = 0, closed = 0;
  for (const d of last14) {
    const es = byDay.get(d) || [];
    const it = sumEntries(es); const t = tm.get(d);
    const b = es.length ? dayBalance(it, t) : null;
    if (es.length) logged++;
    if (b && b.state === 'closed') closed++;
    const pct = (x) => `${Math.min(100, (x / maxK) * 100)}%`;
    bars.appendChild(h('div', { class: `nu-bar-col${b ? ` is-${b.state}` : ''}` },
      h('div', { class: 'nu-bar-track' }, h('i', { class: 'band', style: { bottom: pct(b ? b.range.kcalMin : t.kcal * 0.95), height: `calc(${pct(b ? b.range.kcalMax : t.kcal * 1.05)} - ${pct(b ? b.range.kcalMin : t.kcal * 0.95)})` } }),
        h('i', { class: 'fill', style: { height: pct(it.kcal) } })),
      h('small', {}, d === today ? 'النهارده' : shortFmt.format(new Date(`${d}T12:00:00`)))));
  }
  blocks.push(card({ cls: 'nu-bars-card', title: 'السعرات آخر 14 يوم', aside: h('small', {}, n0(logged), ' متسجّل · ', n0(closed), ' مقفول') }, bars,
    h('p', { class: 'nu-fine' }, h('i', { class: 'nu-lg is-band' }), ' مدى الهدف   ', h('i', { class: 'nu-lg is-closed' }), ' يوم مقفول')));

  // patterns
  const pat = eatingPatterns(mk(days));
  if (pat) {
    const hours = h('div', { class: 'nu-hours', role: 'img', 'aria-label': 'توزيع الأكل على ساعات اليوم' });
    const mh = Math.max(1, ...pat.hours);
    pat.hours.forEach((c, i) => hours.appendChild(h('i', { style: { height: `${Math.max(4, (c / mh) * 100)}%` }, class: c ? 'on' : '', title: `${i}:00` })));
    blocks.push(card({ cls: 'nu-pat', title: 'أنماط أكلك', aside: h('small', {}, `آخر ${fmt(pat.totalDays)} يوم`) },
      hours, h('div', { class: 'nu-hours-axis', 'aria-hidden': 'true' }, h('small', {}, '0'), h('small', {}, '6'), h('small', {}, '12'), h('small', {}, '18'), h('small', {}, '23')),
      ...(pat.notes.length ? pat.notes : [{ kind: 'good', title: 'مفيش أنماط مقلقة', text: `مالقيناش حاجة متكررة تقلق في آخر ${pat.totalDays} يوم.` }]).map((n) =>
        h('div', { class: `nu-ins is-${n.kind}` }, I(n.kind === 'warn' ? 'bolt' : n.kind === 'good' ? 'check' : 'clock', { size: 18 }), h('div', { class: 'grow' }, h('b', {}, n.title), h('small', {}, n.text)))),
      pat.topFoods.length ? h('p', { class: 'nu-fine' }, 'الأكتر تكرارًا: ', pat.topFoods.slice(0, 5).map(([n, c]) => `${n} (${c})`).join(' · ')) : null));
  } else blocks.push(card({ title: 'أنماط أكلك' }, h('p', { class: 'nu-fine' }, 'محتاجين 5 أيام متسجلة على الأقل في آخر 30 يوم عشان نطلع أنماط.')));

  el.textContent = '';
  el.append(topBar(ctx, { title: 'تحليل الأكل', sub: 'من سجلك، من غير ذكاء اصطناعي', backTo: ['nutrition'] }), h('div', { class: 'nu-body' }, ...blocks));
}

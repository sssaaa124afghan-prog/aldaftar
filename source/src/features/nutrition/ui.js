// Shared nutrition view helpers (DOM). Text always goes through h() text nodes.
import { h, raw } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { fmt, parseNum } from '../../ui/num.js';
import { ring } from '../../ui/ring.js';
import { countUp, pop, haptic } from '../../ui/anim.js';
import { validateQty, QTY_MAX } from '../../core/targets.js';
import { stepFor, ADDED_FATS } from './logic.js';

// Icons missing from src/ui/icons.js (Lucide, ISC) — kept local to this feature.
const LOCAL = {
  star: '<path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"/>',
  calendar: '<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/>',
  share: '<path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><path d="m16 6-4-4-4 4"/><path d="M12 2v13"/>',
  book: '<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20"/>',
  target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  pill: '<path d="m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z"/><path d="m8.5 8.5 7 7"/>',
  image: '<rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
  list: '<path d="M3 12h.01"/><path d="M3 18h.01"/><path d="M3 6h.01"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M8 6h13"/>',
  wifioff: '<path d="M12 20h.01"/><path d="M8.5 16.429a5 5 0 0 1 7 0"/><path d="M5 12.859a10 10 0 0 1 5.17-2.69"/><path d="M19 12.859a10 10 0 0 0-2.007-1.523"/><path d="M2 8.82a15 15 0 0 1 4.177-2.643"/><path d="M22 8.82a15 15 0 0 0-11.288-3.764"/><path d="m2 2 20 20"/>',
};
const localIcon = (name, { size = 20 } = {}) => `<svg class="i" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${LOCAL[name]}</svg>`;
export const I = (name, o) => raw(LOCAL[name] ? localIcon(name, o) : icon(name, o));
export const n0 = (v, dp = 0) => h('span', { class: 'num' }, fmt(v, { dp }));
export const MACRO = Object.freeze({
  kcal: { label: 'سعرات', unit: '', color: 'var(--cal, #FDE68A)' },
  p: { label: 'بروتين', unit: 'جم', color: 'var(--pro, #BAE6FD)' },
  c: { label: 'كارب', unit: 'جم', color: 'var(--carb, #86EFAC)' },
  f: { label: 'دهون', unit: 'جم', color: 'var(--fat, #FBCFE8)' },
});

export const back = (ctx, route, params) => h('button', { type: 'button', class: 'nu-ib', 'aria-label': 'رجوع', onclick: () => ctx.go(route, params) }, I('back'));

/** Screen header: back + title + sub + optional trailing buttons. */
export function topBar(ctx, { title, sub = '', backTo = null, trailing = [] }) {
  return h('header', { class: 'nu-top' },
    backTo ? back(ctx, backTo[0], backTo[1] || {}) : null,
    h('div', { class: 'grow' }, h('h1', {}, title), sub ? h('p', {}, sub) : null),
    ...trailing);
}

export const itemsLine = (entries, max = 3) => {
  const names = entries.slice(0, max).map((e) => (e.unit && /جرام|مل/.test(e.unit) && e.qty ? `${e.name} ${fmt(e.qty)} ${e.unit === 'مل' ? 'مل' : 'جم'}` : e.name));
  return names.join(' · ') + (entries.length > max ? ` · و${entries.length - max} كمان` : '');
};

/** Glass card section with optional title row. */
export function card(title, ...kids) {
  const opts = title && typeof title === 'object' && !(title instanceof Node) ? title : { title };
  return h('section', { class: `nu-card${opts.cls ? ` ${opts.cls}` : ''}`, 'aria-label': opts.aria || (typeof opts.title === 'string' ? opts.title : null) },
    opts.title ? h('div', { class: 'nu-card-h' }, h('h2', {}, opts.title), opts.aside || null) : null, ...kids);
}

/** Mini macro ring tile: value / target with range sub-line. */
export function macroTile(key, value, target, range, { status = 'in' } = {}) {
  const m = MACRO[key];
  const num = h('b', { class: 'num' }, '0');
  const tile = h('div', { class: `nu-mtile is-${status}`, style: { '--k': m.color } },
    h('div', { class: 'nu-mring' }, ring({ value, max: target || 1, color: m.color, size: 64, stroke: 6, label: `${m.label}: ${fmt(value)} من ${fmt(target)}` }), num),
    h('span', { class: 'nu-mname' }, m.label),
    h('span', { class: 'nu-msub' }, 'من ', n0(target), m.unit ? ` ${m.unit}` : ''),
    range ? h('span', { class: 'nu-mrange', dir: 'ltr', 'aria-label': `المدى ${fmt(range.min)} إلى ${range.max === null || range.max === undefined ? 'من غير حد' : fmt(range.max)}` }, n0(range.min), '–', range.max === null || range.max === undefined ? '∞' : n0(range.max)) : null);
  countUp(num, Math.round(value), { ms: 800 });
  return tile;
}

/** Semicircle calorie gauge: remaining in the middle, eaten / target / burned below. */
export function calorieGauge({ eaten, target, burn, remaining, over }) {
  const mid = h('b', { class: 'num' }, '0');
  const g = h('div', { class: 'nu-gauge' },
    h('div', { class: 'nu-gauge-arc' }, ring({ value: eaten, max: target || 1, color: over ? 'var(--danger, #FB7185)' : 'url(#nu-cta-grad)', size: 232, stroke: 16, gauge: true, label: `أكلت ${fmt(eaten)} من ${fmt(target)} سعرة` }),
      h('div', { class: 'nu-gauge-mid' }, mid, h('span', {}, over ? 'سعرة فوق الهدف' : 'سعرة فاضلة'))),
    h('div', { class: 'nu-g3' },
      h('div', {}, h('b', { class: 'num nu-c-cal' }, fmt(eaten)), h('span', {}, 'أكلت')),
      h('div', {}, h('b', { class: 'num' }, fmt(target)), h('span', {}, 'الهدف')),
      h('div', {}, h('b', { class: 'num nu-c-ok' }, burn ? fmt(burn) : '—'), h('span', {}, burn ? 'الحرق · تقدير' : 'الحرق (ضيف طولك)'))));
  // gradient for the arc (amber → orange), defined once inside the svg
  const svg = g.querySelector('svg');
  if (svg) {
    const NS = 'http://www.w3.org/2000/svg';
    const defs = document.createElementNS(NS, 'defs');
    const lg = document.createElementNS(NS, 'linearGradient');
    lg.setAttribute('id', 'nu-cta-grad'); lg.setAttribute('x1', '0'); lg.setAttribute('x2', '1'); lg.setAttribute('y1', '0'); lg.setAttribute('y2', '0');
    for (const [o, c] of [['0', '#FCD34D'], ['1', '#FB923C']]) { const st = document.createElementNS(NS, 'stop'); st.setAttribute('offset', o); st.setAttribute('stop-color', c); lg.appendChild(st); }
    defs.appendChild(lg); svg.insertBefore(defs, svg.firstChild);
  }
  countUp(mid, Math.abs(Math.round(remaining)), { ms: 900 });
  return g;
}

/** Thin progress bar with an optional min–max band. */
export function rangeBar(value, target, range, color) {
  const max = Math.max(target * 1.3, value, range && range.max ? range.max * 1.05 : 0) || 1;
  const pct = (x) => `${Math.max(0, Math.min(100, (x / max) * 100))}%`;
  return h('div', { class: 'nu-rbar', style: { '--k': color }, 'aria-hidden': 'true' },
    range ? h('i', { class: 'band', style: { insetInlineStart: pct(range.min), width: `calc(${pct(range.max ?? max)} - ${pct(range.min)})` } }) : null,
    h('i', { class: 'fill', style: { width: pct(value) } }));
}

/** Food row (search results, أكلاتي): name/sub + kcal + protein + optional quick-add «+». */
export function foodRow(f, { onPick, onQuick, quickLabel, fav = false, sub = null }) {
  const main = h('button', { type: 'button', class: 'nu-frow-main', onclick: () => onPick(f) },
    h('div', { class: 'grow' }, h('b', {}, fav ? h('span', { class: 'nu-star', 'aria-label': 'مفضّلة' }, I('star', { size: 14 })) : null, f.name),
      h('small', {}, sub || `لكل ${fmt(f.per)} ${f.unit || 'جرام'}${f.brand ? ` · ${f.brand}` : ''}${f.src === 'user' ? ' · أكلتك' : f.src === 'recipe' ? ' · وصفة' : ''}`)),
    h('span', { class: 'nu-fig' }, n0(f.kcal), h('small', {}, 'سعرة')), h('span', { class: 'nu-fig' }, n0(f.p), h('small', {}, 'بروتين')));
  const row = h('div', { class: 'nu-frow' }, main);
  if (onQuick) {
    const b = h('button', { type: 'button', class: 'nu-quick', 'aria-label': quickLabel || `سجّل ${f.name} بآخر كمية` }, I('plus'));
    b.addEventListener('click', async () => { b.disabled = true; pop(b); haptic(); try { await onQuick(f); } finally { b.disabled = false; } });
    row.appendChild(b);
  }
  return row;
}

/**
 * Quantity sheet: stepper, quick chips, live macros, validation (1..5000), optional favorite toggle and added-fat chips.
 * preview(q) → {ok, entry|message}; onSave(q, {fats:[key]}) → error string | null.
 */
export function qtySheet(ctx, { title, sub = '', unit, qty, preview, saveLabel, onSave, onDelete, favorite = null, fats = false, extra = null }) {
  const grams = /جرام|مل/.test(unit);
  const input = h('input', { class: 'num', id: 'nu-qty', type: 'text', inputmode: 'decimal', value: String(qty), 'aria-describedby': 'nu-qty-err nu-qty-prev', autocomplete: 'off' });
  const err = h('p', { class: 'err', id: 'nu-qty-err', 'aria-live': 'polite' });
  const prev = h('div', { class: 'nu-preview', id: 'nu-qty-prev', 'aria-live': 'polite' });
  const saveBtn = h('button', { type: 'button', class: 'btn nu-cta' }, saveLabel);
  const chosenFats = new Set();
  const read = () => parseNum(input.value);
  const update = (fromUser = true) => {
    const v = validateQty(read());
    if (!v.ok) { if (fromUser && input.value !== '') { err.textContent = v.message; input.setAttribute('aria-invalid', 'true'); } prev.textContent = ''; saveBtn.disabled = true; return; }
    err.textContent = ''; input.removeAttribute('aria-invalid'); saveBtn.disabled = false;
    const r = preview(v.qty);
    if (r.ok) {
      const e = r.entry;
      const fatK = [...chosenFats].reduce((s, k) => s + (ADDED_FATS.find((a) => a.key === k)?.kcal || 0), 0);
      const fatF = [...chosenFats].reduce((s, k) => s + (ADDED_FATS.find((a) => a.key === k)?.f || 0), 0);
      prev.textContent = '';
      for (const [k, val] of [['kcal', e.kcal + fatK], ['p', e.p], ['c', e.c], ['f', e.f + fatF]]) {
        prev.appendChild(h('span', { class: `nu-pv nu-c-${k}` }, h('b', { class: 'num' }, fmt(val)), h('small', {}, MACRO[k].label)));
      }
    }
  };
  const bump = (dir) => {
    const q = Number.isFinite(read()) ? read() : 0;
    const st = stepFor(unit, dir > 0 ? q : q - 1);
    const next = Math.min(QTY_MAX, Math.max(st, Math.round((q + dir * st) / st) * st));
    input.value = String(next); update(); haptic(8);
  };
  const chips = (grams ? [50, 100, 150, 200, 250] : [1, 2, 3]).map((v) => h('button', { type: 'button', class: 'chip', onclick: () => { input.value = String(v); update(); } }, h('span', { class: 'num' }, fmt(v)), grams ? ' جم' : ''));
  input.addEventListener('input', () => update(false));
  input.addEventListener('blur', () => update(true));
  saveBtn.addEventListener('click', async () => {
    const v = validateQty(read());
    if (!v.ok) { err.textContent = v.message; input.setAttribute('aria-invalid', 'true'); input.focus(); return; }
    saveBtn.disabled = true;
    let msg = null;
    try { msg = await onSave(v.qty, { fats: [...chosenFats] }); } catch { msg = 'ماقدرناش نحفظ دلوقتي. جرّب تاني.'; }
    if (msg) { err.textContent = msg; saveBtn.disabled = false; return; }
    haptic(); s.close();
  });
  let favBtn = null;
  if (favorite) {
    let on = !!favorite.on;
    favBtn = h('button', { type: 'button', class: 'chip nu-fav', 'aria-pressed': String(on) }, I('star', { size: 16 }), on ? 'في المفضّلة' : 'ضيف للمفضّلة');
    favBtn.addEventListener('click', async () => {
      on = !on; favBtn.setAttribute('aria-pressed', String(on)); favBtn.lastChild.textContent = on ? 'في المفضّلة' : 'ضيف للمفضّلة'; pop(favBtn);
      try { await favorite.toggle(on); } catch { ctx.toast('ماقدرناش نحفظ المفضّلة.'); }
    });
  }
  const fatRow = fats ? h('div', { class: 'nu-fats', role: 'group', 'aria-label': 'زيت أو سمنة مضافة' },
    h('span', { class: 'nu-fats-l' }, 'زيت/سمنة مضافة؟'),
    ...ADDED_FATS.map((a) => h('button', { type: 'button', class: 'chip', 'aria-pressed': 'false', onclick: (e) => {
      const b = e.currentTarget; if (chosenFats.has(a.key)) chosenFats.delete(a.key); else chosenFats.add(a.key);
      b.setAttribute('aria-pressed', String(chosenFats.has(a.key))); update();
    } }, a.label, ' · ', h('span', { class: 'num' }, fmt(a.kcal))))) : null;
  const body = h('div', { class: 'nu-qty' },
    sub ? h('p', { class: 'lead' }, sub) : null,
    favBtn,
    h('label', { class: 'vh', for: 'nu-qty' }, `الكمية بالـ${unit}`),
    h('div', { class: 'step nu-step' },
      h('button', { type: 'button', 'aria-label': 'زوّد الكمية', onclick: () => bump(1) }, I('plus')),
      h('div', {}, input, h('small', {}, unit)),
      h('button', { type: 'button', 'aria-label': 'قلّل الكمية', onclick: () => bump(-1) }, I('minus'))),
    err, h('div', { class: 'chips nu-chips' }, ...chips), prev, fatRow, extra, saveBtn,
    onDelete ? h('button', { type: 'button', class: 'btn ghost danger nu-del', onclick: async () => { s.close(); try { await onDelete(); } catch { ctx.toast('ماقدرناش نشيلها. جرّب تاني.'); } } }, I('trash'), 'شيل من اليوم') : null);
  const s = ctx.sheet({ title, body });
  update(false);
  return s;
}

/** Labelled input field with error line. */
export function field(id, label, attrs = {}, hint = '') {
  const input = h(attrs.tag || 'input', { id, autocomplete: 'off', ...attrs, tag: null });
  const err = h('p', { class: 'err', id: `${id}-err`, 'aria-live': 'polite' });
  input.setAttribute('aria-describedby', `${id}-err`);
  const el = h('div', { class: 'field' }, h('label', { for: id }, label), input, hint ? h('small', { class: 'nu-fhint' }, hint) : null, err);
  return { input, err, el, set(msg) { err.textContent = msg || ''; if (msg) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid'); } };
}

/** Segmented chips (single choice). */
export function segChips(options, value, onChange, label) {
  const wrap = h('div', { class: 'chips nu-seg', role: 'group', 'aria-label': label });
  const draw = (v) => {
    wrap.textContent = '';
    for (const o of options) wrap.appendChild(h('button', { type: 'button', class: 'chip', 'aria-pressed': String(o.value === v), onclick: () => { draw(o.value); onChange(o.value); } }, o.label));
  };
  draw(value);
  return wrap;
}

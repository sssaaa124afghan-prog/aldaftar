// Exercise picker sheet: search (Arabic or English) + muscle filter. Resolves to a library id or null.
import { h, N } from './view.js';
import { LIBRARY } from './exercises.js';

export const GROUPS = ['الكل', 'صدر', 'ظهر', 'كتف', 'باي', 'تراي', 'رجل', 'مؤخرة', 'سمانة', 'بطن', 'ساعد'];
export const libGroupMatch = (e, group) => group === 'الكل' || e.muscle === group || (group === 'كتف' && e.muscle.startsWith('كتف')) || (group === 'رجل' && e.muscle.startsWith('رجل'))
  || (group === 'ظهر' && e.muscle === 'ترابيس');
export const norm = (s) => String(s || '').toLowerCase().replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/\s+/g, ' ').trim();

export function pickExercise(ctx, { title = 'ضيف تمرين', exclude = [] } = {}) {
  return new Promise((resolve) => {
    let done = false; let group = 'الكل'; let q = '';
    const skip = new Set(exclude);
    const input = h('input', { type: 'search', id: 'wk-pick-q', autocomplete: 'off', enterkeyhint: 'search' });
    const list = h('div', { class: 'wk-pick-list', role: 'list' });
    const chips = h('div', { class: 'chips wk-pick-chips', role: 'group', 'aria-label': 'العضلة' });
    const count = h('p', { class: 'wk-pick-count', 'aria-live': 'polite' });
    const draw = () => {
      for (const c of chips.children) c.setAttribute('aria-pressed', String(c.dataset.g === group));
      const nq = norm(q);
      const rows = LIBRARY.filter((e) => !skip.has(e.id)
        && libGroupMatch(e, group)
        && (!nq || norm(e.ar).includes(nq) || norm(e.en).includes(nq)));
      list.textContent = '';
      for (const e of rows) {
        list.appendChild(h('button', { type: 'button', class: 'list-row', role: 'listitem', onclick: () => { done = true; resolve(e.id); api.close(); } },
          h('span', { class: 'grow' }, h('b', {}, e.ar), h('small', {}, `${e.en} · ${e.muscle} · ${e.eq}`)),
          h('small', { class: 'wk-kind' }, e.kind === 'compound' ? 'مركّب' : 'عزل')));
      }
      count.textContent = '';
      count.append(N(String(rows.length)), ' تمرين');
      if (!rows.length) list.appendChild(h('p', { class: 'wk-muted' }, 'مفيش تمرين بالاسم ده. جرّب كلمة تانية أو الاسم بالإنجليزي.'));
      list.appendChild(h('button', { type: 'button', class: 'btn ghost sm wk-mt', onclick: () => {
        done = true; api.close();
        import('./library.js').then((m) => m.addCustom(ctx, { onAdded: (c) => resolve(c.id) })).catch(() => resolve(null));
      } }, 'ضيف تمرين جديد مش في القايمة'));
    };
    for (const g of GROUPS) chips.appendChild(h('button', { type: 'button', class: 'chip', dataset: { g }, onclick: () => { group = g; draw(); } }, g));
    input.addEventListener('input', () => { q = input.value; draw(); });
    // chips first: the sheet focuses the first control, and the keyboard should open only on an explicit tap
    const body = h('div', {},
      chips,
      h('div', { class: 'field wk-mt' }, h('label', { for: 'wk-pick-q' }, 'دوّر على تمرين'), input),
      count, list);
    const api = ctx.sheet({ title, body, onClose: () => { if (!done) resolve(null); } });
    draw();
  });
}

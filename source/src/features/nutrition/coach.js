// Legacy coach chat (moved out of index.js unchanged; not extended). The unified coach lives in features/coach —
// #/nutrition/coach redirects there as soon as that module renders its own screen.
import { h, fill } from '../../ui/dom.js';
import { fmt } from '../../ui/num.js';
import { sumEntries } from '../../core/targets.js';
import { SECTIONS, SECTION_LABEL, sectionForHour, entryFromAIItem, splitCoachReply, COACH_LOG_HINT, richTextNodes, normalizeAr } from './logic.js';
import { loadCatalog, addEntries, aiClient, aiErrorText, coachContext, loadChat, addChat } from './data.js';
import { I, n0, back } from './ui.js';

const STARTERS = ['فاضل كام بروتين النهارده؟', 'اقترح عشا يقفل البروتين', 'سجّل 150 جرام صدر فراخ مشوي للغدا'];

export async function coachScreen(el, ctx) {
  const history = await loadChat(ctx.db);
  const ai = aiClient(ctx);
  let busy = false;
  const list = h('div', { class: 'nu-chat', role: 'log', 'aria-live': 'polite', 'aria-label': 'المحادثة' });
  const ta = h('textarea', { id: 'nu-msg', rows: '2', maxlength: '2000', placeholder: 'اكتب سؤالك…', 'aria-label': 'رسالتك للمدرب' });
  const send = h('button', { type: 'button', class: 'btn nu-send', 'aria-label': 'ابعت' }, 'ابعت');
  const note = h('p', { class: 'err', 'aria-live': 'assertive' });

  const bubble = (m) => {
    const b = h('div', { class: `nu-msg ${m.role === 'user' ? 'me' : 'coach'}` });
    b.appendChild(h('span', { class: 'vh' }, m.role === 'user' ? 'إنت: ' : 'المدرب: '));
    b.appendChild(richTextNodes(document, m.content));
    return b;
  };
  const drawAll = () => {
    list.textContent = '';
    if (!history.length) {
      list.append(h('div', { class: 'nu-starters' }, h('p', { class: 'nu-hint' }, 'المدرب بيشوف أرقام يومك وآخر تمرين. أي تسجيل أكل بيحتاج موافقتك الأول.'),
        h('div', { class: 'chips' }, ...STARTERS.map((t) => h('button', { type: 'button', class: 'chip', onclick: () => { ta.value = t; submit(); } }, t)))));
    }
    history.forEach((m) => list.appendChild(bubble(m)));
  };

  function proposal(items, said = '') {
    const named = SECTIONS.find((x) => normalizeAr(said).includes(normalizeAr(x.label)));
    let section = named ? named.key : sectionForHour(new Date().getHours());
    const card = h('div', { class: 'nu-card nu-proposal', role: 'group', 'aria-label': 'تسجيل مقترح' });
    const chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'الوجبة' });
    const drawChips = () => { chips.textContent = ''; for (const s2 of SECTIONS) chips.appendChild(h('button', { type: 'button', class: 'chip', 'aria-pressed': String(s2.key === section), onclick: () => { section = s2.key; drawChips(); ok.textContent = `سجّل في ${SECTION_LABEL[section]}`; } }, s2.label)); };
    const ok = h('button', { type: 'button', class: 'btn nu-cta' }, `سجّل في ${SECTION_LABEL[section]}`);
    const no = h('button', { type: 'button', class: 'btn ghost' }, 'مش دلوقتي');
    const tot = sumEntries(items);
    card.append(h('div', { class: 'nu-card-h' }, h('h2', {}, 'تسجّل ده؟'), h('small', {}, 'مفيش حاجة بتتسجّل من غير موافقتك')),
      ...items.map((it) => h('div', { class: 'nu-meal' }, h('div', { class: 'grow' }, h('b', {}, it.name), h('small', {}, h('span', { class: 'num' }, fmt(it.grams)), ' جم')), h('span', { class: 'nu-fig' }, n0(it.kcal), h('small', {}, 'سعرة')), h('span', { class: 'nu-fig nu-c-p' }, n0(it.p), h('small', {}, 'بروتين')))),
      h('p', { class: 'nu-split' }, 'المجموع ', n0(tot.kcal), ' سعرة · ', n0(tot.p), ' بروتين'),
      chips, h('div', { class: 'btn-row nu-prop-acts' }, ok, no));
    drawChips();
    ok.addEventListener('click', async () => {
      ok.disabled = true; no.disabled = true;
      const { list: cat } = await loadCatalog(ctx.db);
      const entries = items.map((it) => entryFromAIItem(it, section, cat)).map(({ matched, ...e }) => ({ ...e, src: 'coach' }));
      const done = await addEntries(ctx, ctx.today(), entries, `اتسجّل في ${SECTION_LABEL[section]}`);
      fill(card, h('p', { class: 'nu-status is-closed' }, h('i', { 'aria-hidden': 'true' }), done ? `اتسجّل في ${SECTION_LABEL[section]} · ${fmt(tot.kcal)} سعرة` : 'ماقدرناش نحفظ. جرّب تاني.'));
    });
    no.addEventListener('click', () => fill(card, h('p', { class: 'nu-status' }, h('i', { 'aria-hidden': 'true' }), 'ماتسجّلش حاجة')));
    return card;
  }

  async function submit() {
    const text = ta.value.trim();
    note.textContent = '';
    if (!text) { note.textContent = 'اكتب رسالتك الأول.'; ta.focus(); return; }
    if (busy) return;
    busy = true; send.disabled = true;
    const um = await addChat(ctx.db, 'user', text);
    history.push(um);
    ta.value = '';
    if (list.querySelector('.nu-starters')) drawAll(); else list.appendChild(bubble(um));
    const wait = h('p', { class: 'nu-hint nu-wait', role: 'status' }, 'المدرب بيكتب…');
    list.appendChild(wait); wait.scrollIntoView({ block: 'nearest' });
    try {
      const msgs = history.slice(-10).map((m, i, arr) => ({ role: m.role, content: i === arr.length - 1 ? m.content + COACH_LOG_HINT : m.content }));
      const context = await coachContext(ctx);
      const r = await ai.chat(msgs, context);
      const { text: visible, items } = splitCoachReply(r.text);
      const am = await addChat(ctx.db, 'assistant', visible);
      history.push(am);
      wait.remove();
      list.appendChild(bubble(am));
      if (items) list.appendChild(proposal(items, text));
      list.lastChild.scrollIntoView({ block: 'nearest' });
    } catch (e) {
      wait.remove();
      note.textContent = aiErrorText(e);
      if (e && e.code === 'no_key') note.append(' ', h('a', { href: '#/profile' }, 'افتح الإعدادات'));
      ta.value = text; history.pop();
      try { await ctx.db.delete('chat', um.id); } catch { /* ignore */ }
      drawAll();
    } finally { busy = false; send.disabled = false; }
  }
  send.addEventListener('click', submit);
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit(); });

  const clear = h('button', { type: 'button', class: 'nu-ib', 'aria-label': 'امسح المحادثة', onclick: async () => {
    if (!history.length) return;
    const ok = await ctx.confirm({ title: 'تمسح المحادثة؟', text: 'كل رسايل المدرب هتتمسح من الجهاز. أكلك المتسجّل مش هيتأثر.', confirmLabel: 'امسح المحادثة', danger: true });
    if (!ok) return;
    try { await ctx.db.batch(history.map((m) => ({ store: 'chat', type: 'delete', key: m.id }))); } catch { /* ignore */ }
    history.length = 0; drawAll();
  } }, I('trash'));

  el.textContent = '';
  el.append(h('header', { class: 'nu-top' }, back(ctx, 'nutrition'), h('div', { class: 'grow' }, h('h1', {}, 'المدرب'), h('p', {}, 'بيرد بالمصري ومش بيسجّل غير بموافقتك')), clear),
    h('div', { class: 'nu-body nu-coach' }, list,
      h('div', { class: 'nu-compose' }, h('label', { class: 'vh', for: 'nu-msg' }, 'رسالتك'), ta, send), note));
  drawAll();
  list.lastChild && list.lastChild.scrollIntoView({ block: 'nearest' });
}

// Coach chat UI, shared by #/coach and openCoachSheet(). Replies render as text nodes (bold + line breaks only).
import './coach.css';
import { h, raw, fill } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { portion } from '../../core/targets.js';
import { richTextNodes, searchFoods } from '../nutrition/logic.js';
import { loadChat, addChat, loadCatalog, loadUsage } from '../nutrition/data.js';
import { askCoach, errorText, hasKey } from './api.js';
import { actionCard } from './cards.js';
import { parseLogCommand } from './actions.js';
import { QUICK } from './prompts.js';

const I = (n) => raw(icon(n));

/** Skeleton shown while the coach is thinking (> 1 s waits). */
export const skeleton = (lines = 3) => h('div', { class: 'co-skel', role: 'status', 'aria-label': 'المدرب بيكتب…' }, ...Array.from({ length: lines }, (_, i) => h('i', { style: { width: `${92 - i * 18}%` } })));

/** Error line with a settings link when the key is missing. */
export function errorLine(e, onNav) {
  const p = h('p', { class: 'co-err', role: 'alert' }, errorText(e));
  if (e && e.code === 'no_key') p.append(' ', h('a', { href: '#/profile', onclick: () => onNav && onNav() }, 'افتح الإعدادات'));
  return p;
}

/** Local fast path (AI19): «ضيف 150 جرام صدر فراخ» → a log proposal from the user's own foods. No API call. */
export async function localProposal(ctx, text) {
  const cmd = parseLogCommand(text);
  if (!cmd) return null;
  const [{ list }, usage] = await Promise.all([loadCatalog(ctx.db), loadUsage(ctx.db, ctx.today()).catch(() => null)]);
  const food = searchFoods(list, cmd.query, { usage, limit: 1 })[0];
  if (!food) return null;
  let m; try { m = portion(food, cmd.grams); } catch { return null; }
  return { food, action: { type: 'log', section: cmd.section, items: [{ name: food.name, grams: cmd.grams, ...m }] } };
}

export async function mountChat(el, ctx, { intent = 'chat', attach = null, prompt = '', inSheet = false, close = null } = {}) {
  const history = await loadChat(ctx.db);
  let busy = false;
  const list = h('div', { class: 'co-list', role: 'log', 'aria-live': 'polite', 'aria-label': 'المحادثة' });
  const ta = h('textarea', { id: `co-msg${inSheet ? '-s' : ''}`, rows: '1', maxlength: '2000', placeholder: 'اسأل المدرب…', 'aria-label': 'رسالتك للمدرب' });
  const send = h('button', { type: 'button', class: 'co-send', 'aria-label': 'ابعت' }, I('back'));
  const note = h('p', { class: 'co-err', 'aria-live': 'assertive' });
  const nav = () => close && close();

  const bubble = (m) => h('div', { class: `co-msg ${m.role === 'user' ? 'me' : 'coach'}` },
    h('span', { class: 'vh' }, m.role === 'user' ? 'إنت: ' : 'المدرب: '), richTextNodes(document, m.content));

  let group = /nutrition|food/.test(intent) ? 'nutrition' : 'training';
  const chipsBox = h('div', { class: 'co-quick' });
  const drawChips = () => {
    chipsBox.textContent = '';
    const seg = h('div', { class: 'co-seg', role: 'tablist', 'aria-label': 'نوع الأسئلة' },
      ...[['training', 'تمرين'], ['nutrition', 'أكل']].map(([k, l]) => h('button', { type: 'button', role: 'tab', 'aria-selected': String(group === k), onclick: () => { group = k; drawChips(); } }, l)));
    chipsBox.append(seg, h('div', { class: 'chips co-chips' }, ...QUICK[group].map((q) => h('button', { type: 'button', class: 'chip', onclick: () => submit(q.prompt, q.intent) }, q.label))));
  };
  const drawAll = () => {
    list.textContent = '';
    if (!history.length) list.append(h('p', { class: 'co-hint' }, 'المدرب شايف تمرينك وأكلك ووزنك آخر 4 أسابيع. أي تسجيل أو تعديل بيحتاج موافقتك الأول.'));
    history.slice(-40).forEach((m) => list.appendChild(bubble(m)));
  };

  async function submit(text, chipIntent) {
    text = String(text ?? ta.value).trim();
    note.textContent = '';
    if (!text) { note.textContent = 'اكتب رسالتك الأول.'; ta.focus(); return; }
    if (busy) return;
    busy = true; send.disabled = true;
    const um = await addChat(ctx.db, 'user', text);
    history.push(um);
    if (list.querySelector('.co-hint') && history.length === 1) list.textContent = '';
    list.appendChild(bubble(um));
    ta.value = '';
    try {
      const local = chipIntent ? null : await localProposal(ctx, text);
      if (local) {
        const am = await addChat(ctx.db, 'assistant', `لقيت «${local.food.name}» في أكلاتك. راجع قبل التسجيل:`);
        history.push(am); list.append(bubble(am), actionCard(ctx, local.action, { said: text }));
        list.lastChild.scrollIntoView({ block: 'nearest' });
        return;
      }
      const wait = skeleton(); list.appendChild(wait); wait.scrollIntoView({ block: 'nearest' });
      try {
        const turns = history.slice(-10).map((m) => ({ role: m.role, content: m.content }));
        const r = await askCoach(ctx, { intent: chipIntent || intent, prompt: text, extra: { ...(attach || {}), history: turns } });
        const am = await addChat(ctx.db, 'assistant', r.text);
        history.push(am);
        wait.remove();
        list.appendChild(bubble(am));
        for (const a of r.actions) list.appendChild(actionCard(ctx, a, { said: text }));
        list.lastChild.scrollIntoView({ block: 'nearest' });
      } catch (e) {
        wait.remove();
        fill(note, errorLine(e, nav));
        ta.value = text; history.pop();
        try { await ctx.db.delete('chat', um.id); } catch { /* ignore */ }
        list.lastChild && list.lastChild.remove();
        if (!history.length) drawAll();
      }
    } finally { busy = false; send.disabled = false; }
  }
  send.addEventListener('click', () => submit());
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(); } });
  ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = `${Math.min(120, ta.scrollHeight)}px`; });

  // voice input (ar-EG) when the browser supports it
  const SR = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);
  let mic = null;
  if (SR) {
    mic = h('button', { type: 'button', class: 'co-mic', 'aria-label': 'اتكلم', 'aria-pressed': 'false' }, I('mic'));
    let rec = null;
    mic.addEventListener('click', () => {
      if (rec) { rec.stop(); return; }
      try {
        rec = new SR(); rec.lang = 'ar-EG'; rec.interimResults = false;
        mic.setAttribute('aria-pressed', 'true');
        rec.onresult = (ev) => { ta.value = `${ta.value} ${ev.results[0][0].transcript}`.trim(); ta.focus(); };
        rec.onend = () => { rec = null; mic.setAttribute('aria-pressed', 'false'); };
        rec.onerror = () => { note.textContent = 'ماقدرناش نسمعك. جرّب تاني أو اكتب.'; };
        rec.start();
      } catch { rec = null; mic.setAttribute('aria-pressed', 'false'); }
    });
  }

  const attachNote = attach && Object.keys(attach).length
    ? h('p', { class: 'co-attach' }, I('check'), attach.liveSession ? 'الجلسة الحالية مرفقة' : attach.session ? 'الجلسة مرفقة' : attach.exercise ? 'التمرين مرفق' : 'فيه بيانات مرفقة') : null;
  const keyNote = hasKey(ctx) ? null : h('p', { class: 'co-hint' }, 'محتاج مفتاح API عشان المدرب يرد. «ضيف 150 جرام …» شغالة من غيره. ', h('a', { href: '#/profile', onclick: nav }, 'حط المفتاح'));

  el.textContent = '';
  el.classList.add('co-wrap');
  el.append(...[attachNote, keyNote].filter(Boolean), list, chipsBox,
    h('div', { class: 'co-compose' }, h('label', { class: 'vh', for: ta.id }, 'رسالتك'), ta, mic, send), note);
  drawAll(); drawChips();
  list.lastChild && list.lastChild.scrollIntoView({ block: 'nearest' });
  if (prompt) submit(prompt, intent);
  return { submit };
}


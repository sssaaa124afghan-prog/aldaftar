// Coach chat UI, shared by #/coach and openCoachSheet(). Replies render as text nodes (bold + line breaks only).
import './coach.css';
import { h, raw, fill } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { portion } from '../../core/targets.js';
import { richTextNodes, searchFoods } from '../nutrition/logic.js';
import { loadChat, addChat, loadCatalog, loadUsage } from '../nutrition/data.js';
import { askCoach, errorText, hasKey, HISTORY_TURNS, EMPTY_REPLY } from './api.js';
import { actionCard } from './cards.js';
import { parseLogCommand, streamVisible } from './actions.js';
import { localFoodLog } from './foodlog.js';
import { voiceSupported, startVoice } from '../nutrition/voice.js';
import { speechEnv, speechMessage, fileContextHint } from '../../core/speech.js';
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

/**
 * Local fast path (AI19), no API call: «اكلت 150 جم كبدة و290 جم مكرونة» / «ضيف 150 جرام صدر فراخ» → a food.log proposal
 * when every item has an amount and a confident match in the user's foods; otherwise null (the coach model handles it).
 */
export async function localProposal(ctx, text) {
  const [{ list }, usage] = await Promise.all([loadCatalog(ctx.db), loadUsage(ctx.db, ctx.today()).catch(() => null)]);
  const multi = localFoodLog(text, list, { usage });
  if (multi) return { action: multi, say: multi.items.length > 1 ? `لقيت الـ ${multi.items.length} أكلات في أكلاتك. راجع وعدّل قبل التسجيل:` : 'لقيتها في أكلاتك. راجع قبل التسجيل:' };
  const cmd = parseLogCommand(text);
  if (!cmd) return null;
  const food = searchFoods(list, cmd.query, { usage, limit: 1 })[0];
  if (!food) return null;
  let m; try { m = portion(food, cmd.grams); } catch { return null; }
  return { food, say: `لقيت «${food.name}» في أكلاتك. راجع قبل التسجيل:`, action: { type: 'log', section: cmd.section, items: [{ name: food.name, grams: cmd.grams, ...m }] } };
}

export async function mountChat(el, ctx, { intent = 'chat', attach = null, prompt = '', inSheet = false, close = null } = {}) {
  const history = await loadChat(ctx.db);
  let busy = false;
  const list = h('div', { class: 'co-list', role: 'log', 'aria-live': 'polite', 'aria-label': 'المحادثة' });
  const ta = h('textarea', { id: `co-msg${inSheet ? '-s' : ''}`, rows: '1', maxlength: '2000', placeholder: 'اسأل المدرب…', 'aria-label': 'رسالتك للمدرب' });
  const send = h('button', { type: 'button', class: 'co-send', 'aria-label': 'ابعت' }, I('back'));
  const note = h('p', { class: 'co-err', 'aria-live': 'assertive' });
  const nav = () => close && close();

  const bubble = (m) => h('div', { class: `co-msg ${m.role === 'user' ? 'me' : 'coach'}`, dataset: { mid: m.id } },
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

  const typing = () => h('div', { class: 'co-msg coach co-live', role: 'status', 'aria-label': 'المدرب بيكتب…' }, h('span', { class: 'co-typing', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')));
  const scroll = () => { const l = list.lastChild; if (l && l.scrollIntoView) l.scrollIntoView({ block: 'nearest' }); };

  /** Ask the coach for `text` (already saved as the user's bubble `um`). Failure keeps the message and shows «حاول تاني». */
  async function ask(text, chipIntent, um) {
    const live = typing(); list.appendChild(live); scroll();
    let first = true;
    const onText = (v) => {
      if (first) { live.textContent = ''; live.append(h('span', { class: 'vh' }, 'المدرب: '), h('span', { class: 'co-stream' })); live.setAttribute('aria-busy', 'true'); first = false; }
      fill(live.querySelector('.co-stream'), richTextNodes(document, v));
    };
    const onRetry = (n, e) => { note.textContent = e && e.code === 'rate_limit' ? 'طلبات كتير ورا بعض، بحاول تاني…' : e && e.code === 'timeout' ? 'الرد اتأخر، بحاول تاني…' : 'الخدمة عليها ضغط، بحاول تاني…'; };
    try {
      const turns = history.slice(-HISTORY_TURNS).map((m) => ({ role: m.role, content: m.content }));
      const r = await askCoach(ctx, { intent: chipIntent || intent, prompt: text, extra: { ...(attach || {}), history: turns }, onText, onRetry });
      note.textContent = '';
      const am = await addChat(ctx.db, 'assistant', r.text || EMPTY_REPLY);
      history.push(am);
      live.replaceWith(bubble(am));
      for (const a of r.actions) list.appendChild(actionCard(ctx, a, { said: text }));
      for (const m of r.errors || []) list.appendChild(h('p', { class: 'co-err co-ignored', role: 'alert' }, m));
      scroll();
    } catch (e) {
      live.remove();
      note.textContent = '';
      const partial = e && e.partial ? streamVisible(e.partial) : '';
      if (partial) list.appendChild(h('div', { class: 'co-msg coach failed' }, richTextNodes(document, `${partial} …`)));
      const bub = list.querySelector(`[data-mid="${um.id}"]`);
      if (bub) bub.classList.add('failed');
      const retry = h('button', { type: 'button', class: 'btn sm co-retry-btn' }, 'حاول تاني');
      const box = h('div', { class: 'co-retry', role: 'alert' }, errorLine(e, nav), e && e.code === 'no_key' ? null : retry);
      retry.addEventListener('click', async () => {
        if (busy) return;
        box.remove(); if (partial) list.lastChild && list.lastChild.classList.contains('failed') && list.lastChild.remove();
        if (bub) bub.classList.remove('failed');
        busy = true; send.disabled = true;
        try { await ask(text, chipIntent, um); } finally { busy = false; send.disabled = false; }
      });
      list.appendChild(box); scroll();
    }
  }

  async function submit(text, chipIntent) {
    text = String(text ?? ta.value).trim();
    note.textContent = '';
    if (!text) { note.textContent = 'اكتب رسالتك الأول.'; ta.focus(); return; }
    if (busy) return;
    busy = true; send.disabled = true;
    try {
      const um = await addChat(ctx.db, 'user', text);
      history.push(um);
      if (list.querySelector('.co-hint') && history.length === 1) list.textContent = '';
      list.appendChild(bubble(um));
      ta.value = ''; ta.style.height = 'auto';
      const local = chipIntent ? null : await localProposal(ctx, text).catch(() => null);
      if (local) {
        const am = await addChat(ctx.db, 'assistant', local.say);
        history.push(am); list.append(bubble(am), actionCard(ctx, local.action, { said: text }));
        scroll();
        return;
      }
      await ask(text, chipIntent, um);
    } finally { busy = false; send.disabled = false; }
  }
  send.addEventListener('click', () => submit());
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(); } });
  ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = `${Math.min(120, ta.scrollHeight)}px`; });

  // voice input: shared core/speech.js (ar-EG → ar-SA, interim text, auto-stop after ~1.5 s of silence). The mic is always
  // there: where in-page speech can't work (iOS home-screen app, old browser) it focuses the field for the keyboard mic 🎤.
  const mic = h('button', { type: 'button', class: 'co-mic', 'aria-label': 'اتكلم', 'aria-pressed': 'false' }, I('mic'));
  const vstate = h('p', { class: 'co-vstate', role: 'status', 'aria-live': 'polite', hidden: true }, h('i', { 'aria-hidden': 'true' }), h('span'));
  const setV = (msg, heard = false) => { vstate.hidden = !msg; vstate.classList.toggle('heard', heard); vstate.lastChild.textContent = msg || ''; };
  let stopRec = null; let before = '';
  mic.addEventListener('click', () => {
    if (stopRec) { stopRec(); return; }
    note.textContent = '';
    if (!voiceSupported()) { setV(''); note.textContent = speechMessage(speechEnv().reason || 'unsupported'); ta.focus(); return; }
    before = ta.value.trim();
    const hint = fileContextHint();
    if (hint) note.textContent = hint;
    mic.setAttribute('aria-pressed', 'true'); mic.setAttribute('aria-label', 'وقّف التسجيل');
    setV('بسمعك… اتكلم');
    // started synchronously inside the tap (iOS refuses a recognizer started after an await)
    stopRec = startVoice({
      onState: (st) => { mic.classList.toggle('heard', st === 'speech'); if (st === 'speech') setV('سامعك…', true); },
      onInterim: (t) => { ta.value = `${before} ${t}`.trim(); setV('سامعك…', true); },
      onResult: (t) => { ta.value = `${before} ${t}`.trim(); ta.dispatchEvent(new Event('input')); ta.focus(); },
      onError: (m, code) => { note.textContent = m; if (code !== 'no-speech') ta.focus(); },
      onEnd: () => { stopRec = null; mic.setAttribute('aria-pressed', 'false'); mic.setAttribute('aria-label', 'اتكلم'); mic.classList.remove('heard'); setV(''); },
    });
  });

  const attachNote = attach && Object.keys(attach).length
    ? h('p', { class: 'co-attach' }, I('check'), attach.liveSession ? 'الجلسة الحالية مرفقة' : attach.session ? 'الجلسة مرفقة' : attach.exercise ? 'التمرين مرفق' : 'فيه بيانات مرفقة') : null;
  const keyNote = hasKey(ctx) ? null : h('p', { class: 'co-hint' }, 'محتاج مفتاح API عشان المدرب يرد. «ضيف 150 جرام …» شغالة من غيره. ', h('a', { href: '#/profile', onclick: nav }, 'حط المفتاح'));

  el.textContent = '';
  el.classList.add('co-wrap');
  el.append(...[attachNote, keyNote].filter(Boolean), list, chipsBox,
    h('div', { class: 'co-compose' }, h('label', { class: 'vh', for: ta.id }, 'رسالتك'), ta, mic, send), vstate, note);
  drawAll(); drawChips();
  list.lastChild && list.lastChild.scrollIntoView({ block: 'nearest' });
  if (prompt) submit(prompt, intent);
  return { submit };
}


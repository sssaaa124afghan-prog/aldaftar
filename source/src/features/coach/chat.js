// Coach chat UI, shared by #/coach and openCoachSheet(). Replies render as text nodes (bold + line breaks only).
import './coach.css';
import { h, raw, fill } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { portion } from '../../core/targets.js';
import { richTextNodes, searchFoods } from '../nutrition/logic.js';
import { loadChat, addChat, loadCatalog, loadUsage } from '../nutrition/data.js';
import { askCoach, errorText, hasKey, HISTORY_TURNS, EMPTY_REPLY } from './api.js';
import { actionCard, loggedLine } from './cards.js';
import { haptic } from '../../ui/anim.js';
import { streamVisible, stripLogClaims, isFoodAction } from './actions.js';
import { pickFoodLog, prepareLog, commitEntries, localAction, wantsFoodLog, successText, LOG_COPY, CONFIRM_KEY } from './autolog.js';
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
 * Local fast path (AI19), no API call: «اكلت 150 جم كبدة و290 جم مكرونة» / «ضيف 150 جرام صدر فراخ» → a food.log action
 * when every item has an amount and a confident match in the user's foods; otherwise null (the coach model handles it).
 */
export async function localProposal(ctx, text) {
  const [{ list }, usage] = await Promise.all([loadCatalog(ctx.db), loadUsage(ctx.db, ctx.today()).catch(() => null)]);
  const action = localAction(text, list, usage);
  return action ? { action } : null;
}

/** Chat turns for the model: app lines (kind 'app') are left out, old «سجلت» claims rewritten so the model never copies them. */
export const modelTurns = (history, n = HISTORY_TURNS) => history.filter((m) => m.kind !== 'app').slice(-n)
  .map((m) => ({ role: m.role, content: m.role === 'assistant' ? (stripLogClaims(m.content) || '…') : m.content }));

export async function mountChat(el, ctx, { intent = 'chat', attach = null, prompt = '', inSheet = false, close = null } = {}) {
  const history = await loadChat(ctx.db);
  let busy = false;
  const list = h('div', { class: 'co-list', role: 'log', 'aria-live': 'polite', 'aria-label': 'المحادثة' });
  const ta = h('textarea', { id: `co-msg${inSheet ? '-s' : ''}`, rows: '1', maxlength: '2000', placeholder: 'اسأل المدرب…', 'aria-label': 'رسالتك للمدرب' });
  const send = h('button', { type: 'button', class: 'co-send', 'aria-label': 'ابعت' }, I('back'));
  const note = h('p', { class: 'co-err', 'aria-live': 'assertive' });
  const nav = () => close && close();

  const bubble = (m) => (m.kind === 'app'
    ? h('div', { class: `co-msg app${m.ok ? ' ok' : ''}`, dataset: { mid: m.id } }, h('span', { class: 'vh' }, 'التطبيق: '), m.content)
    : h('div', { class: `co-msg ${m.role === 'user' ? 'me' : 'coach'}`, dataset: { mid: m.id } },
      h('span', { class: 'vh' }, m.role === 'user' ? 'إنت: ' : 'المدرب: '), richTextNodes(document, m.content)));

  // ───── food logging: the app writes, reads back, and only then says «اتسجل» ─────
  const logged = new Map(); // idempotency key (user message id) → verified result, for this view
  let catalogP = null;
  const catalog = () => (catalogP = catalogP || Promise.all([loadCatalog(ctx.db), loadUsage(ctx.db, ctx.today()).catch(() => null)])
    .then(([c, usage]) => ({ list: c.list, usage })).catch(() => { catalogP = null; return { list: [], usage: null }; }));
  const appNote = async (text, extra = {}) => { const m = await addChat(ctx.db, 'assistant', text, { kind: 'app', ...extra }); history.push(m); return m; };
  const notes = new Map(); // key → saved app note (kept in step with undo / edit so a reload never shows a stale «اتسجل»)
  const onLogged = (key) => async (res) => {
    logged.set(key, res);
    notes.set(key, await appNote(successText(res, ctx.today()), { ok: true, log: { day: res.day, ids: res.entries.map((e) => e.id) } }));
  };
  const onChange = (key) => async (kind, res) => {
    const m = notes.get(key);
    if (kind === 'undo') logged.delete(key); else logged.set(key, res);
    if (!m) return;
    const next = kind === 'undo' ? { ...m, content: `${LOG_COPY.undone}.`, ok: false, log: null } : { ...m, content: successText(res, ctx.today()), log: { day: res.day, ids: res.entries.map((e) => e.id) } };
    Object.assign(m, next);
    try { await ctx.db.put('chat', next); } catch { /* the on-screen line is right; the note is best-effort */ }
  };
  /** Apply one food.log decision (from pickFoodLog) for the user message `key`. Never claims success without a verified write. */
  async function runFoodLog(plan, key, said) {
    if (!plan) return;
    if (!plan.action) { const m = await appNote(LOG_COPY.fail); list.appendChild(bubble(m)); return; }
    if (logged.has(key)) { list.appendChild(loggedLine(ctx, logged.get(key), { key, said, onChange: onChange(key) })); return; } // replayed reply: no second write
    const confirmFirst = !!ctx.settings.get(CONFIRM_KEY) || !plan.asked;
    if (confirmFirst) { list.appendChild(actionCard(ctx, plan.action, { said, key, onLogged: onLogged(key), onChange: onChange(key) })); return; }
    const { list: foods, usage } = await catalog();
    const { day, entries } = prepareLog(plan.action, { catalog: foods, usage, now: new Date(), today: ctx.today() });
    if (!entries.length) { const m = await appNote(LOG_COPY.fail); list.appendChild(bubble(m)); return; }
    const attempt = async (slot) => {
      let res;
      try { res = await commitEntries(ctx.db, day, entries, key); }
      catch {
        const retry = h('button', { type: 'button', class: 'btn sm co-retry-btn' }, 'حاول تاني');
        const box = h('div', { class: 'co-retry co-wfail', role: 'alert' }, h('p', { class: 'co-err' }, LOG_COPY.writeFail), retry);
        retry.addEventListener('click', () => { retry.disabled = true; attempt(box); });
        if (slot) slot.replaceWith(box); else list.appendChild(box);
        scroll(); return;
      }
      ctx.emit('food:changed', { day });
      if (!res.dup) haptic();
      const line = loggedLine(ctx, res, { key, said, onChange: onChange(key) });
      if (slot) slot.replaceWith(line); else list.appendChild(line);
      if (res.dup) logged.set(key, res); else await onLogged(key)(res); // a retry that finds its rows already saved writes no new note
      scroll();
    };
    await attempt(null);
  }

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
    if (!history.length) list.append(h('p', { class: 'co-hint' }, 'المدرب شايف تمرينك وأكلك ووزنك آخر 4 أسابيع. الأكل اللي تقول إنك أكلته بيتسجّل على طول ومعاه «تراجع»، وأي تعديل تاني بيحتاج موافقتك.'));
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
      const turns = modelTurns(history);
      const r = await askCoach(ctx, { intent: chipIntent || intent, prompt: text, extra: { ...(attach || {}), history: turns }, onText, onRetry });
      note.textContent = '';
      const foodish = r.actions.some(isFoodAction) || (r.dropped || []).some((d) => d.type === 'food.log' || d.type === 'log') || wantsFoodLog(text);
      const { list: foods, usage } = foodish ? await catalog() : { list: [], usage: null };
      const plan = foodish ? pickFoodLog({ userText: text, actions: r.actions, dropped: r.dropped || [], catalog: foods, usage }) : null;
      const shown = stripLogClaims(r.text);
      if (shown) { const am = await addChat(ctx.db, 'assistant', shown); history.push(am); live.replaceWith(bubble(am)); } else live.remove();
      for (const a of r.actions) if (!isFoodAction(a)) list.appendChild(actionCard(ctx, a, { said: text }));
      // food errors are handled by the fallback / honest message below, not as a generic «ignored» line
      const errs = (r.errors || []).filter((m) => !(plan && /تسجيل أكل/.test(m)));
      for (const m of errs) list.appendChild(h('p', { class: 'co-err co-ignored', role: 'alert' }, m));
      await runFoodLog(plan, um.id, text);
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
      if (local) { // same verified pipeline as the model path (no API call)
        await runFoodLog({ action: local.action, source: 'local', asked: true }, um.id, text);
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


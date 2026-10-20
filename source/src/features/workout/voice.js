// Voice set logging for the live session (ar-EG first, Gulf / MSA tolerant).
// Pure parser on top of the nutrition number parser (parseFoodUtterance → word numbers, «ونص», «مية وعشرين»),
// plus a thin SpeechRecognition wrapper with a language fallback and a typed field «اكتبها» when speech is missing.
import { parseFoodUtterance, normalizeArabicNums, voiceSupported, VOICE_ERRORS } from '../nutrition/voice.js';
import { normalizeAr } from '../nutrition/logic.js';

export { voiceSupported };

export const LIMITS = Object.freeze({ wMin: 0, wMax: 500, rMin: 1, rMax: 100, rirMax: 10 });

const KG = new Set(['كيلو', 'كيلوجرام', 'كيلوغرام', 'كجم', 'كغ', 'كيلوات', 'كيلوهات', 'kg', 'kgs', 'kilo', 'كيلوز']);
const REP = new Set(['عده', 'عدات', 'عدد', 'عدّه', 'مره', 'مرات', 'تكرار', 'تكرارات', 'تكرارة', 'rep', 'reps', 'عداد']);
const REP_DUAL = new Set(['عدتين', 'مرتين', 'تكرارين']);
const SEP = new Set(['في', 'x', 'علي', 'ضرب', 'by']);
const BY = new Set(['ب', 'بوزن']);
const WKEY = new Set(['الوزن', 'وزن', 'الكيلو', 'بالوزن']);
const RKEY = new Set(['العدات', 'العده', 'العدد', 'التكرار', 'التكرارات', 'المرات']);
const RIRKEY = new Set(['rir', 'فاضل', 'فاضلي', 'فاضله', 'باقي', 'باقيلي', 'متبقي']);
const COMMIT = new Set(['سجل', 'سجلي', 'سجلها', 'اسجل', 'سجللي', 'سجلهالي', 'log']);
const DONE = new Set(['خلصت', 'خلصتها', 'خلصنا', 'خلاص', 'تم', 'تمام', 'done']);
const UNDO = new Set(['امسح', 'امسحها', 'تراجع', 'ارجع', 'رجع', 'الغي', 'الغيها', 'undo']);
const NEXT = new Set(['الجايه', 'الجاي', 'اللي بعده', 'بعده', 'التالي', 'next', 'التمرين الجاي', 'التمرين الجايه']);
const MULT = new Set(['ميه', 'مايه', 'مئه', 'الف']);
const REPEAT_RE = /(^|\s)(زي|زيي|نفس)\s+(اللي|الي|المره|المجموعه)(\s|$)|(^|\s)(كرر|كررها|كرريها|كرره|same|repeat)(\s|$)/;

const numCache = new Map();
/** Value of one number word via the nutrition parser (null when it is not a number). «ميه» needs a following token. */
function wordNum(t) {
  if (KG.has(t)) return null;
  if (!numCache.has(t)) {
    // only a real number phrase counts (the food parser also turns «كوب» / «حبة» into 1 piece)
    const p = parseFoodUtterance(`${t} x`);
    numCache.set(t, Number.isFinite(p.qty) && /^\d/.test(p.tokens[0] || '') ? p.qty : null);
  }
  return numCache.get(t);
}
const isDigit = (t) => /^\d+(?:\.\d+)?$/.test(t);
const isFrac = (t) => { const v = wordNum(t); return v !== null && v > 0 && v < 1; };
const isJoin = (t) => t.length > 1 && t[0] === 'و' && wordNum(t) !== null;

/** Tokens: digits kept as numbers (decimals intact), everything else through normalizeAr. */
export function tokenize(text) {
  const s = normalizeArabicNums(text).replace(/[×✕✖*]/g, ' x ').replace(/(\d)\s*[xX]\s*(\d)/g, '$1 x $2');
  const out = [];
  s.split(/(\d+(?:[.,]\d+)?)/).forEach((p, i) => {
    if (i % 2) { out.push(p.replace(',', '.')); return; }
    for (let t of normalizeAr(p).split(' ').filter(Boolean)) {
      // «بتمانين», «بـ80» → «ب» + number; «لـ» etc. are left alone
      if (t.length > 2 && t[0] === 'ب' && wordNum(t.slice(1)) !== null) { out.push('ب'); t = t.slice(1); }
      out.push(t);
    }
  });
  return out;
}

/** Number runs → items: {n:value} | {m:'kg'|'rep'|'sep'|'by'|'wk'|'rk'|'rir'} | {x:word}. */
function itemize(toks) {
  const items = [];
  let i = 0;
  while (i < toks.length) {
    const t = toks[i];
    if (REP_DUAL.has(t)) { items.push({ n: 2 }, { m: 'rep' }); i++; continue; }
    const startNum = isDigit(t) || (wordNum(t) !== null && !(t === 'و'));
    if (startNum) {
      let digits = isDigit(t) ? Number(t) : 0;
      const words = isDigit(t) ? [] : [t];
      let last = isDigit(t) ? digits : wordNum(t);
      i++;
      // continue the run only with «و…» joins, fractions, or a multiplier after a unit («تلات مية»)
      while (i < toks.length) {
        const u = toks[i];
        if (u === 'و' && i + 1 < toks.length && (wordNum(toks[i + 1]) !== null || isDigit(toks[i + 1]))) {
          if (isDigit(toks[i + 1])) { digits += Number(toks[i + 1]); i += 2; continue; }
          words.push('و' + toks[i + 1]); last = wordNum(toks[i + 1]); i += 2; continue;
        }
        if (isJoin(u) || isFrac(u)) { words.push(u); last = wordNum(u); i++; continue; }
        if (MULT.has(u) && last > 0 && last < 10) { words.push(u); last = 100; i++; continue; }
        break;
      }
      const wv = words.length ? parseFoodUtterance(`${words.join(' ')} x`).qty || 0 : 0;
      items.push({ n: Math.round((digits + wv) * 100) / 100 });
      continue;
    }
    if (KG.has(t)) items.push({ m: 'kg' });
    else if (REP.has(t)) items.push({ m: 'rep' });
    else if (SEP.has(t)) items.push({ m: 'sep' });
    else if (BY.has(t)) items.push({ m: 'by' });
    else if (WKEY.has(t)) items.push({ m: 'wk' });
    else if (RKEY.has(t)) items.push({ m: 'rk' });
    else if (RIRKEY.has(t)) items.push({ m: 'rir' });
    else items.push({ x: t });
    i++;
  }
  // «82 كيلو ونص» → the trailing half belongs to the weight
  for (let k = 2; k < items.length; k++) {
    const a = items[k];
    if (a.n !== undefined && a.n > 0 && a.n < 1 && items[k - 1].m === 'kg' && items[k - 2].n !== undefined) { items[k - 2].n += a.n; items.splice(k, 1); k--; }
  }
  return items;
}

const msgW = () => `الوزن لازم يكون بين ${LIMITS.wMin} و${LIMITS.wMax} كجم — قولها تاني.`;
const msgR = () => `العدّات لازم تكون من ${LIMITS.rMin} لـ ${LIMITS.rMax} — قولها تاني.`;
export const HELP = 'مافهمتش. قول مثلاً «80 في 8» أو «زي اللي فاتت».';

/**
 * parseSetCommand(text) → {kind, w?, r?, rir?, commit, error?}
 * kind: 'set' (w and/or r) | 'repeat' | 'done' | 'undo' | 'next' | 'invalid' (error set) | 'none'.
 * commit: the phrase itself asked to log («سجل…», «خلصت», «تم»).
 */
export function parseSetCommand(text) {
  const toks = tokenize(text);
  const joined = toks.join(' ');
  const commit = toks.some((t) => COMMIT.has(t) || DONE.has(t));
  const items = itemize(toks);
  const nums = items.filter((x) => x.n !== undefined);
  if (!toks.length) return { kind: 'none', commit: false, error: HELP };
  if (!nums.length) {
    if (toks.some((t) => UNDO.has(t))) return { kind: 'undo', commit: false };
    if (REPEAT_RE.test(joined)) return { kind: 'repeat', commit };
    if (NEXT.has(joined) || toks.some((t) => t === 'الجايه' || t === 'next' || t === 'التالي') || /(^|\s)(اللي|الي) بعده(\s|$)/.test(joined)) return { kind: 'next', commit: false };
    if (toks.some((t) => DONE.has(t))) return { kind: 'done', commit: true };
    return { kind: 'none', commit: false, error: HELP };
  }
  let w = null, r = null, rir = null;
  const used = new Set();
  items.forEach((it, k) => {
    if (it.n === undefined) return;
    const prev = items[k - 1]?.m, next = items[k + 1]?.m;
    if (prev === 'rir' && rir === null) { rir = it.n; used.add(k); return; }
    if (next === 'kg' && w === null) { w = it.n; used.add(k); used.add(k + 1); return; }
    if (next === 'rep' && r === null) { r = it.n; used.add(k); used.add(k + 1); return; }
    if ((prev === 'wk' || prev === 'by') && w === null) { w = it.n; used.add(k); return; }
    if ((prev === 'rk' || (prev === 'rep' && !used.has(k - 1))) && r === null) { r = it.n; used.add(k); return; }
    if (prev === 'kg' && !used.has(k - 1) && w === null) { w = it.n; used.add(k); return; }
  });
  const free = items.map((it, k) => ({ it, k })).filter(({ it, k }) => it.n !== undefined && !used.has(k));
  for (const { it } of free) {
    if (w === null && r === null && free.length === 1) {
      // a lone bare number is ambiguous («80») — ask once more, never guess
      return { kind: 'invalid', commit, error: 'قول الوزن والعدّات مع بعض، زي «80 في 8»، أو «الوزن 80».' };
    }
    if (w === null) w = it.n; else if (r === null) r = it.n; else return { kind: 'invalid', commit, error: HELP };
  }
  if (w !== null && !(w >= LIMITS.wMin && w <= LIMITS.wMax)) return { kind: 'invalid', commit, error: msgW() };
  if (r !== null && !(Number.isInteger(r) && r >= LIMITS.rMin && r <= LIMITS.rMax)) return { kind: 'invalid', commit, error: msgR() };
  if (rir !== null && !(Number.isInteger(rir) && rir >= 0 && rir <= LIMITS.rirMax)) return { kind: 'invalid', commit, error: 'الـ RIR من 0 لـ 10 — قولها تاني.' };
  if (w === null && r === null) {
    if (rir !== null) return { kind: 'set', rir, commit };
    return { kind: 'none', commit: false, error: HELP };
  }
  const out = { kind: 'set', commit };
  if (w !== null) out.w = w;
  if (r !== null) out.r = r;
  if (rir !== null) out.rir = rir;
  return out;
}

/** The first alternative that parses wins; otherwise the first one's error. */
export function parseBest(alts) {
  const list = (Array.isArray(alts) ? alts : [alts]).filter((a) => String(a ?? '').trim());
  let first = null;
  for (const a of list) {
    const c = parseSetCommand(a);
    if (c.kind !== 'none' && c.kind !== 'invalid') return { ...c, text: a };
    if (!first || (first.kind === 'none' && c.kind === 'invalid')) first = { ...c, text: a };
  }
  return first || { kind: 'none', commit: false, error: HELP, text: '' };
}

/**
 * resolveCommand(cmd, exercise, setIdx) → what the session should do with the CURRENT set:
 * {action:'fill', w, r, rir?, commit} | {action:'undo'} | {action:'next'} | {action:'error', msg}
 */
export function resolveCommand(cmd, e, j) {
  if (!cmd || cmd.kind === 'none' || cmd.kind === 'invalid') return { action: 'error', msg: cmd?.error || HELP };
  if (cmd.kind === 'undo') return { action: 'undo' };
  if (cmd.kind === 'next') return { action: 'next' };
  const t = e?.sets?.[j];
  if (!t) return { action: 'error', msg: 'مفيش مجموعة مفتوحة دلوقتي.' };
  if (cmd.kind === 'repeat') {
    const before = e.sets.slice(0, j).reverse().find((s) => s.done && +s.r > 0)
      || e.sets.filter((s) => s.done && +s.r > 0).sort((a, b) => (b.at || 0) - (a.at || 0))[0]
      || (e.prev && e.prev[j]) || null;
    if (!before) return { action: 'error', msg: 'مفيش مجموعة قبل كده نكرّرها — قول الوزن والعدّات.' };
    return { action: 'fill', w: +before.w || 0, r: +before.r, rir: null, commit: cmd.commit, repeat: true };
  }
  if (cmd.kind === 'done') {
    if (!(+t.r > 0)) return { action: 'error', msg: 'قول العدّات الأول، زي «العدات 8».' };
    return { action: 'fill', w: +t.w || 0, r: +t.r, rir: null, commit: true };
  }
  const w = cmd.w ?? (+t.w || 0), r = cmd.r ?? +t.r;
  if (cmd.commit && !(r > 0)) return { action: 'error', msg: 'قول العدّات الأول، زي «العدات 8».' };
  return { action: 'fill', w, r, rir: cmd.rir ?? null, commit: !!cmd.commit };
}

/** Coach bridge prefill, applied to the planned sets before the first render. Returns the number of sets changed. */
export function applyPrefill(live, pf) {
  if (!live || !pf || typeof pf !== 'object') return 0;
  let n = 0;
  for (const e of live.exercises || []) {
    const p = pf[e.exId] || (e.lib ? pf[e.lib] : null);
    if (!p || typeof p !== 'object') continue;
    const sets = Array.isArray(p.sets) ? p.sets : [];
    sets.forEach((x, k) => {
      const t = e.sets[k];
      if (!t || t.done || !x) return;
      const w = +x.w, r = +x.r;
      const okW = Number.isFinite(w) && w >= LIMITS.wMin && w <= LIMITS.wMax;
      const okR = Number.isInteger(r) && r >= LIMITS.rMin && r <= LIMITS.rMax;
      if (!okW && !okR) return;
      if (okW) t.w = Math.round(w * 100) / 100;
      if (okR) t.r = r;
      t.coach = true; n++;
    });
    const note = typeof p.note === 'string' ? p.note.trim().slice(0, 160) : '';
    if (note) e.planNote = [e.planNote, `اقتراح المدرب: ${note}`].filter(Boolean).join(' · ');
  }
  return n;
}

// ───────── browser speech (ar-EG → ar-SA → ar) ─────────
const LANGS = ['ar-EG', 'ar-SA', 'ar'];

/** listen({onResult(alts), onError(msg), onEnd}) → stop(). Retries the next language when one is not supported. */
export function listen({ onResult, onError, onEnd } = {}) {
  const SR = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);
  if (!SR) { onError?.('المتصفح ده مش بيدعم الإدخال بالصوت — اكتبها.'); onEnd?.(); return () => {}; }
  let rec = null, stopped = false, li = 0;
  const run = () => {
    rec = new SR();
    rec.lang = LANGS[li]; rec.interimResults = false; rec.maxAlternatives = 5; rec.continuous = false;
    let retry = false;
    rec.onresult = (e) => {
      const res = e.results && e.results[0];
      if (!res) return;
      const alts = [...res].map((a) => a && a.transcript).filter(Boolean);
      if (alts.length) onResult?.(alts);
    };
    rec.onerror = (e) => {
      if ((e.error === 'language-not-supported' || e.error === 'bad-grammar') && li < LANGS.length - 1 && !stopped) { retry = true; return; }
      if (e.error === 'aborted') return;
      onError?.(VOICE_ERRORS[e.error] || 'ماقدرناش نسمع دلوقتي — جرّب تاني أو اكتبها.');
    };
    rec.onend = () => { if (retry && !stopped) { li++; run(); return; } onEnd?.(); };
    try { rec.start(); } catch { onError?.('ماقدرناش نشغّل الميكروفون. جرّب تاني.'); onEnd?.(); }
  };
  run();
  return () => { stopped = true; try { rec && rec.abort(); } catch { /* ignore */ } };
}

/**
 * Voice UI for the session dock: a persistent mic button and a panel (status line, confirm chip, typed field).
 * createVoiceUI({h, ico, onInput(alts, {typed})}) → {mic, panel, chip(label, onOk, onCancel), say(msg), clear(), pending()}
 */
export function createVoiceUI({ h, ico, onInput }) {
  const speech = voiceSupported();
  let stop = null, chipState = null, msgT = 0;
  const status = h('p', { class: 'wk-vmsg', role: 'status', 'aria-live': 'polite', hidden: true });
  const chipEl = h('div', { class: 'wk-vchip', role: 'group', 'aria-label': 'تأكيد المجموعة', hidden: true });
  const field = h('input', { id: 'wk-vtype', class: 'wk-vin', type: 'text', autocomplete: 'off', enterkeyhint: 'done', placeholder: '80 في 8', dir: 'rtl' });
  const send = h('button', { type: 'button', class: 'wk-vsend', 'aria-label': 'سجّل اللي كتبته' }, ico('check'));
  const form = h('form', { class: 'wk-vform', hidden: true, onsubmit: (ev) => { ev.preventDefault(); submitTyped(); } },
    h('label', { for: 'wk-vtype' }, 'اكتبها'), field, send);
  send.addEventListener('click', (ev) => { ev.preventDefault(); submitTyped(); });
  const panel = h('div', { class: 'wk-vpanel' }, status, chipEl, form);
  const mic = h('button', { type: 'button', class: 'wk-mic', 'aria-label': 'سجّل بالصوت', 'aria-pressed': 'false', dataset: { fk: 'mic' } }, ico('mic'));
  // the app toast sits right above the dock: lift it over the panel while the panel shows (CSS var read in workout.css)
  const sync = () => {
    panel.hidden = status.hidden && chipEl.hidden && form.hidden;
    requestAnimationFrame(() => { try { document.documentElement.style.setProperty('--wk-vp', `${panel.hidden || !panel.isConnected ? 0 : panel.offsetHeight + 10}px`); } catch { /* ignore */ } });
  };
  function submitTyped() {
    const v = field.value.trim();
    if (!v) { say('اكتب زي «80 في 8» أو «زي اللي فاتت».'); field.focus(); return; }
    field.value = '';
    onInput?.([v], { typed: true });
  }
  function say(msg, ms = 4500) {
    clearTimeout(msgT);
    status.textContent = msg; status.hidden = !msg; sync();
    if (msg) msgT = setTimeout(() => { status.hidden = true; sync(); }, ms);
  }
  function setListening(on) {
    mic.setAttribute('aria-pressed', String(on)); mic.classList.toggle('on', on);
    mic.setAttribute('aria-label', on ? 'وقّف التسجيل بالصوت' : 'سجّل بالصوت');
  }
  mic.addEventListener('click', () => {
    if (!speech) {
      form.hidden = !form.hidden; sync();
      if (!form.hidden) { field.focus(); say('المتصفح ده مش بيسمع — اكتبها أو استخدم مايك الكيبورد.', 5000); }
      return;
    }
    if (stop) { const s = stop; stop = null; s(); setListening(false); return; }
    say('بسمعك… قول مثلاً «80 في 8»', 8000);
    setListening(true);
    stop = listen({
      onResult: (alts) => { status.hidden = true; sync(); onInput?.(alts, { typed: false }); },
      onError: (m) => { say(m); if (!speech) { form.hidden = false; sync(); } },
      onEnd: () => { stop = null; setListening(false); if (status.textContent.startsWith('بسمعك')) { status.hidden = true; sync(); } },
    });
  });
  function clearChip() { chipState = null; chipEl.textContent = ''; chipEl.hidden = true; sync(); }
  function chip(label, onOk, onCancel) {
    chipEl.textContent = '';
    chipState = { onOk, onCancel };
    const ok = h('button', { type: 'button', class: 'wk-vok', 'aria-label': `سجّل ${label}`, onclick: () => { const s = chipState; clearChip(); s?.onOk(); } }, ico('check'));
    const no = h('button', { type: 'button', class: 'wk-vno', 'aria-label': 'الغي', onclick: () => { const s = chipState; clearChip(); s?.onCancel(); } }, ico('x'));
    chipEl.append(h('span', {}, h('bdi', { dir: 'ltr', class: 'num' }, label), ' · تم؟'), ok, no);
    chipEl.hidden = false; status.hidden = true; sync();
    return ok;
  }
  /** «امسح» while a chip is open = ✕. */
  function cancelPending() { if (!chipState) return false; const s = chipState; clearChip(); s.onCancel(); return true; }
  sync();
  return {
    mic, panel, chip, say, cancelPending, speech,
    pending: () => !!chipState,
    clear: () => { clearChip(); status.hidden = true; sync(); },
    destroy: () => { clearTimeout(msgT); if (stop) { stop(); stop = null; } try { document.documentElement.style.removeProperty('--wk-vp'); } catch { /* ignore */ } },
  };
}

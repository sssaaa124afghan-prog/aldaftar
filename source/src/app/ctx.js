// ctx — the shell services every feature receives (see docs/frontend-contract.md).
import { h, focusables } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { raw, isSafe } from '../core/esc.js';
import { today as todayKey } from '../core/date.js';
import { getSecret, setSecret } from '../core/db.js';
import { DEFAULT_TRAINING_DAYS } from '../core/schema.js';
import { dayInfo } from './day.js';

// ───────── events ─────────
const handlers = new Map();
export function on(evt, fn) {
  if (!handlers.has(evt)) handlers.set(evt, new Set());
  handlers.get(evt).add(fn);
  return () => handlers.get(evt)?.delete(fn);
}
export function emit(evt, data) {
  for (const fn of [...(handlers.get(evt) || [])]) {
    try { fn(data); } catch (e) { console.warn('[ctx] handler failed', evt, e && e.message); }
  }
}

// ───────── settings (sync cache over IndexedDB; API key in the 'secrets' record, never exported) ─────────
const FIELD = { weekStart: 'weekStartDow' }; // ctx key → stored field in settings 'app'
const DEFAULTS = { theme: 'system', trainingDays: [...DEFAULT_TRAINING_DAYS], weekStart: 1, units: 'metric', anthropicKey: '' };

function makeSettings(db, app, key) {
  const cache = { ...app };
  let secret = key || '';
  let chain = Promise.resolve();
  return {
    get(k) {
      if (k === 'anthropicKey') return secret;
      const v = cache[FIELD[k] || k];
      return v === undefined ? (Array.isArray(DEFAULTS[k]) ? [...DEFAULTS[k]] : DEFAULTS[k]) : v;
    },
    /** set(key,val) → Promise (writes are queued; UI cache updates at once) */
    set(k, val) {
      if (k === 'anthropicKey') {
        secret = String(val || '').trim();
        chain = chain.then(() => setSecret(db, 'anthropicKey', secret));
      } else {
        cache[FIELD[k] || k] = val;
        const rec = { key: 'app', ...cache };
        chain = chain.then(() => db.put('settings', rec));
      }
      const p = chain.catch((e) => { console.warn('[settings] save failed', e && e.code); toast('ماقدرناش نحفظ الإعداد ده — جرّب تاني.'); });
      if (k === 'theme') applyTheme(val);
      emit('settings:changed', { key: k });
      return p;
    },
    all() { return { ...DEFAULTS, ...cache, weekStart: cache.weekStartDow ?? 1 }; },
  };
}

/** Electric Glass Pro is dark only. Kept for API compatibility: clears any stored light/dark choice. */
export function applyTheme() {
  delete document.documentElement.dataset.theme;
  try { localStorage.removeItem('ui.theme'); } catch { /* ignore */ }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = '#0D0B2E';
}

// ───────── toast (one at a time; optional action, e.g. Undo) ─────────
let toastHost; let toastTimer;
export function toast(text, { action, ms } = {}) {
  if (!toastHost) {
    toastHost = h('div', { class: 'toast-host', role: 'status', 'aria-live': 'polite' });
    document.body.appendChild(toastHost);
  }
  clearTimeout(toastTimer);
  toastHost.textContent = '';
  toastHost.dataset.t = String(Date.now());
  const el = h('div', { class: 'toast' }, h('span', {}, String(text)));
  const close = () => { el.classList.remove('in'); setTimeout(() => el.remove(), 220); };
  if (action && action.label) {
    el.appendChild(h('button', { type: 'button', onclick: async () => { close(); try { await action.run(); } catch (e) { console.warn(e); } } }, action.label));
  }
  toastHost.appendChild(el);
  requestAnimationFrame(() => el.classList.add('in'));
  toastTimer = setTimeout(close, ms || (action ? 6000 : 3200));
  return { close };
}

// ───────── bottom sheet (focus trap, Esc, scrim click, restores focus) ─────────
let sheetSeq = 0;
export function sheet({ title = '', body = '', actions = [], onClose } = {}) {
  const prev = document.activeElement;
  const id = `sh${++sheetSeq}`;
  const content = h('div', { class: 'sheet-body' });
  if (body instanceof Node) content.appendChild(body);
  else if (isSafe(body)) content.insertAdjacentHTML('beforeend', body.value);
  else if (body) content.appendChild(h('p', { class: 'lead' }, String(body)));
  const closeBtn = h('button', { type: 'button', class: 'ibtn', 'aria-label': 'إغلاق' }, raw(icon('x')));
  const card = h('div', { class: 'bsheet', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': id, tabindex: '-1' },
    h('div', { class: 'grab', 'aria-hidden': 'true' }),
    h('header', {}, h('h2', { id }, title), closeBtn),
    content);
  if (actions.length) {
    const acts = h('div', { class: 'acts' });
    for (const a of actions) {
      acts.appendChild(h('button', { type: 'button', class: `btn${a.ghost ? ' ghost' : ''}${a.danger ? ' danger' : ''}`, onclick: async () => {
        const keep = await a.run?.(api);
        if (keep !== true) api.close();
      } }, a.label));
    }
    card.appendChild(acts);
  }
  const scrim = h('div', { class: 'scrim' }, card);
  let closed = false;
  const inert = [...document.body.children].filter((c) => c !== scrim && !c.classList.contains('toast-host'));
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); api.close(); return; }
    if (e.key !== 'Tab') return;
    const f = focusables(card);
    if (!f.length) { e.preventDefault(); return; }
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  // a sheet belongs to the route it was opened on: the router fires app:route-leave {route} on a route change
  const openedOn = (location.hash.replace(/^#\/?/, '').split('?')[0].replace(/\/+$/, '')) || 'today';
  const onRoute = (e) => { if (!e || !e.detail || e.detail.route !== openedOn) api.close(); };
  const api = {
    el: card, body: content,
    close() {
      if (closed) return; closed = true;
      window.removeEventListener('app:route-leave', onRoute);
      document.removeEventListener('keydown', onKey, true);
      inert.forEach((c) => c.removeAttribute('inert'));
      scrim.classList.remove('in');
      setTimeout(() => scrim.remove(), 240);
      try { prev && prev.focus && prev.focus(); } catch { /* ignore */ }
      onClose?.();
    },
  };
  closeBtn.addEventListener('click', () => api.close());
  scrim.addEventListener('click', (e) => { if (e.target === scrim) api.close(); });
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('app:route-leave', onRoute);
  document.body.appendChild(scrim);
  inert.forEach((c) => c.setAttribute('inert', ''));
  requestAnimationFrame(() => {
    scrim.classList.add('in');
    const f = focusables(content)[0] || closeBtn;
    f.focus();
  });
  return api;
}

/** confirm → true (confirm) | false (cancel button) | dismissValue on Esc/scrim/×  (default false, backward compatible). */
export function confirm({ title, text = '', confirmLabel = 'تأكيد', cancelLabel = 'إلغاء', danger = false, dismissValue = false } = {}) {
  return new Promise((resolve) => {
    let answered = false;
    sheet({
      title, body: text,
      actions: [
        { label: confirmLabel, danger, run: () => { answered = true; resolve(true); } },
        { label: cancelLabel, ghost: true, run: () => { answered = true; resolve(false); } },
      ],
      onClose: () => { if (!answered) resolve(dismissValue); },
    });
  });
}

/** Build the ctx object once the DB is open. */
export async function createCtx(db, { go }) {
  let app = {};
  try { const r = await db.get('settings', 'app'); if (r) { const { key, ...rest } = r; app = rest; } } catch { /* defaults */ }
  const key = await getSecret(db, 'anthropicKey');
  const settings = makeSettings(db, app, key);
  applyTheme(settings.get('theme'));
  return {
    db, go, toast, sheet, confirm, settings, on, emit,
    today: () => todayKey(),
    /** extra: {day, type:'training'|'rest', target:{kcal,p,c,f}, overridden} for a day key */
    dayInfo: (day) => dayInfo(db, day || todayKey(), settings),
  };
}

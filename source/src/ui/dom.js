// Tiny DOM helpers. Text children become text nodes (never parsed as HTML).
// For markup use the `html` tagged template (escapes every interpolation) and mount with setHTML().
import { html, raw, escapeHTML, isSafe } from '../core/esc.js';

export { html, raw, escapeHTML };

/**
 * h('button', {class:'btn', onclick, 'aria-label':'..'}, 'text', childEl, html`<b>${x}</b>`)
 * attrs: class, style (string|object), dataset (object), on* (functions), boolean attrs, others as attributes.
 */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class' || k === 'className') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value' && 'value' in el) el.value = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    if (c instanceof Node) el.appendChild(c);
    else if (isSafe(c)) el.insertAdjacentHTML('beforeend', c.value);
    else el.appendChild(document.createTextNode(String(c)));
  }
}

/** Replace el's children like replaceChildren(), but skip null/undefined/false (replaceChildren would print «null»). */
export function fill(el, ...children) {
  el.textContent = '';
  append(el, children);
  return el;
}

/** Replace el's content with SafeHTML (from html``) — refuses plain strings. */
export function setHTML(el, safe) {
  if (!isSafe(safe)) throw new TypeError('setHTML needs html`` output');
  el.innerHTML = safe.value;
  return el;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Focusable descendants (for focus traps). */
export function focusables(root) {
  return $$('a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])', root)
    .filter((e) => e.offsetParent !== null || e === document.activeElement);
}

// HTML escaping. Every interpolation in `html` is escaped unless wrapped in raw().
// Use for any string that reaches innerHTML (AI replies, food names, imported data...).

const MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };

export function escapeHTML(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"'`]/g, (c) => MAP[c]);
}

class SafeHTML {
  constructor(s) { this.value = s; }
  toString() { return this.value; }
}

/** Explicit opt-in: mark a string as trusted HTML. Only for markup you wrote yourself. */
export const raw = (s) => new SafeHTML(s === null || s === undefined ? '' : String(s));

export const isSafe = (v) => v instanceof SafeHTML;

function render(v) {
  if (v === null || v === undefined || v === false) return '';
  if (v instanceof SafeHTML) return v.value;
  if (Array.isArray(v)) return v.map(render).join('');
  return escapeHTML(v);
}

/** Tagged template: html`<b>${name}</b>` → SafeHTML. Nested html`` results are not re-escaped. */
export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += render(values[i]) + strings[i + 1];
  return new SafeHTML(out);
}

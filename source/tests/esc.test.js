import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeHTML, html, raw, isSafe } from '../src/core/esc.js';

test('escapeHTML escapes all dangerous characters', () => {
  assert.equal(escapeHTML(`<img src=x onerror="alert('x')">&\``), '&lt;img src=x onerror=&quot;alert(&#39;x&#39;)&quot;&gt;&amp;&#96;');
  assert.equal(escapeHTML(null), '');
  assert.equal(escapeHTML(undefined), '');
  assert.equal(escapeHTML(0), '0');
  assert.equal(escapeHTML('صدور فراخ'), 'صدور فراخ');
});

test('html escapes interpolations by default', () => {
  const name = '<script>steal()</script>';
  const out = html`<b>${name}</b>`;
  assert.ok(isSafe(out));
  assert.equal(String(out), '<b>&lt;script&gt;steal()&lt;/script&gt;</b>');
});

test('raw() is an explicit opt-in and nested html is not double-escaped', () => {
  const inner = html`<i>${'a&b'}</i>`;
  assert.equal(String(html`<p>${inner}${raw('<br>')}</p>`), '<p><i>a&amp;b</i><br></p>');
});

test('arrays, null, false and numbers', () => {
  const items = ['<a>', 'b'];
  assert.equal(String(html`<ul>${items.map((i) => html`<li>${i}</li>`)}</ul>`), '<ul><li>&lt;a&gt;</li><li>b</li></ul>');
  assert.equal(String(html`${null}${undefined}${false}${0}`), '0');
  assert.equal(String(html`<x title="${'" onmouseover="x'}">`), '<x title="&quot; onmouseover=&quot;x">');
});

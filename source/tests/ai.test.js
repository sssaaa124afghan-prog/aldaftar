import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAIClient, buildContextSummary, prepareMessages, parsePhotoItems, AIError, MODELS, API_URL, systemText, systemBlocks } from '../src/core/ai.js';

const KEY = 'sk-ant-api03-TESTKEY-0123456789';

function mockFetch(response = { content: [{ type: 'text', text: 'تمام' }], model: MODELS.coach, stop_reason: 'end_turn' }, status = 200) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return { ok: status >= 200 && status < 300, status, json: async () => response };
  };
  fn.calls = calls;
  return fn;
}

const ctx = {
  profile: { name: 'Test User', job: 'Accountant at Example Co', employer: 'Example Co', location: 'Somewhere', email: 'a@b.c', age: 27, sex: 'male', heightCm: 173, weightKg: 75 },
  today: { day: '2026-10-19', type: 'training', workoutName: 'Upper A', targets: { kcal: 2600, p: 160, c: 330, f: 70 }, intake: { kcal: 508, p: 31.8, c: 41.6, f: 24.2 }, waterMl: 1500 },
  lastSession: { day: '2026-10-17', dayName: 'Lower A', durationMin: 55, exercises: [{ name: 'Back Squat', sets: [{ w: 80, r: 5 }] }] },
  week: { sessionsDone: 3, sessionsPlanned: 4, proteinDaysHit: 4, daysLogged: 6 },
};

test('chat request shape: URL, headers, model, last 10 messages, compact context', async () => {
  const f = mockFetch();
  const ai = createAIClient({ backoffMs: 1, getKey: () => KEY, fetch: f, isOnline: () => true });
  const history = Array.from({ length: 15 }, (_, i) => ({ role: i % 2 ? 'ai' : 'user', content: `m${i}` }));
  const r = await ai.chat(history, ctx);
  assert.equal(r.text, 'تمام');
  const { url, init, body } = f.calls[0];
  assert.equal(url, API_URL);
  assert.equal(url, 'https://api.anthropic.com/v1/messages');
  assert.equal(init.method, 'POST');
  assert.deepEqual(init.headers, {
    'x-api-key': KEY, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true', 'content-type': 'application/json',
  });
  assert.equal(body.model, 'claude-sonnet-5-5');
  assert.ok(body.max_tokens > 0);
  assert.ok(body.messages.length <= 10);
  assert.equal(body.messages[0].role, 'user');
  assert.equal(body.messages.at(-1).content, 'm14');
  assert.ok(body.messages.every((m) => m.role === 'user' || m.role === 'assistant'));
  const sys = systemText(body.system);
  assert.match(sys, /2600 kcal/);
  assert.match(sys, /Back Squat 80x5/);
  assert.match(sys, /sessions 3\/4/);
  // prompt caching: stable instructions + context block, each with an ephemeral breakpoint
  assert.ok(Array.isArray(body.system) && body.system.length === 2);
  assert.deepEqual(body.system.map((b) => b.cache_control), [{ type: 'ephemeral' }, { type: 'ephemeral' }]);
  assert.match(body.system[0].text, /personal strength and nutrition coach/);
  assert.ok(!/Data summary/.test(body.system[0].text));
  assert.match(body.system[1].text, /^Data summary:\n/);
  // privacy: no identifiers, and the key never in the body
  const wire = init.body;
  for (const bad of ['Test User', 'Accountant', 'Example Co', 'Somewhere', 'a@b.c', KEY]) assert.ok(!wire.includes(bad), bad);
});

test('context summary only uses whitelisted fields', () => {
  const s = buildContextSummary(ctx);
  assert.match(s, /age 27, male, 173 cm, 75 kg/);
  assert.ok(!/Test User|Example|Accountant|Somewhere/.test(s));
  assert.equal(buildContextSummary({}), '');
});

test('prepareMessages merges same-role turns and drops a leading assistant turn', () => {
  const m = prepareMessages([{ role: 'ai', content: 'hi' }, { role: 'user', content: 'a' }, { role: 'user', content: 'b' }, { role: 'assistant', content: 'c' }, { role: 'user', content: '  ' }]);
  assert.deepEqual(m, [{ role: 'user', content: 'a\n\nb' }, { role: 'assistant', content: 'c' }]);
});

test('photo request shape and strict JSON parsing', async () => {
  const f = mockFetch({ content: [{ type: 'text', text: 'Here you go:\n```json\n{"items":[{"name":"رز","grams":200,"kcal":260,"p":5.4,"c":56,"f":0.6},{"name":"فراخ","grams":"150","kcal":248,"p":46,"c":0,"f":5}, {"name":"","grams":10}]}\n```' }], model: MODELS.quick });
  const ai = createAIClient({ backoffMs: 1, getKey: async () => KEY, fetch: f, isOnline: () => true });
  const r = await ai.analyzeMealPhoto('data:image/jpeg;base64,/9j/AAAA', 'image/jpeg');
  assert.deepEqual(r.items, [{ name: 'رز', grams: 200, kcal: 260, p: 5.4, c: 56, f: 0.6 }, { name: 'فراخ', grams: 150, kcal: 248, p: 46, c: 0, f: 5 }]);
  const { body } = f.calls[0];
  assert.equal(body.model, 'claude-haiku-5-5');
  const [img, txt] = body.messages[0].content;
  assert.deepEqual(img, { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: '/9j/AAAA' } });
  assert.match(txt.text, /Return ONLY JSON/);
});

test('parsePhotoItems is defensive', () => {
  assert.deepEqual(parsePhotoItems('[{"name":"بيض","grams":100,"kcal":155,"p":13,"c":1,"f":11}]').length, 1);
  assert.deepEqual(parsePhotoItems('{"items":[]}'), []);
  assert.deepEqual(parsePhotoItems('{"items":[{"name":"x","grams":99999}]}'), []);
  for (const bad of ['no json here', '{"items": [', '{"foo":1}', null]) assert.throws(() => parsePhotoItems(bad), (e) => e.code === 'bad_response');
});

test('errors map to friendly Arabic, never raw English, never the key', async () => {
  const cases = [[401, 'bad_key'], [403, 'forbidden'], [429, 'rate_limit'], [529, 'overloaded'], [500, 'server'], [400, 'bad_request']];
  for (const [status, code] of cases) {
    const ai = createAIClient({ backoffMs: 1, getKey: () => KEY, fetch: mockFetch({ type: 'error', error: { type: 'x', message: 'invalid x-api-key' } }, status), isOnline: () => true });
    await assert.rejects(ai.chat([{ role: 'user', content: 'hi' }]), (e) => {
      assert.ok(e instanceof AIError);
      assert.equal(e.code, code);
      assert.match(e.message, /[؀-ۿ]/);
      assert.ok(!/[A-Za-z]{4,}/.test(e.message.replace(/API|JPG|PNG|WebP/g, '')), e.message);
      assert.ok(!e.message.includes(KEY));
      return true;
    });
  }
});

test('offline, network failure, timeout, missing key, bad image', async () => {
  const msg = [{ role: 'user', content: 'hi' }];
  await assert.rejects(createAIClient({ backoffMs: 1, getKey: () => KEY, fetch: mockFetch(), isOnline: () => false }).chat(msg), { code: 'offline' });
  await assert.rejects(createAIClient({ backoffMs: 1, getKey: () => KEY, fetch: async () => { throw new TypeError('Failed to fetch'); }, isOnline: () => true }).chat(msg), { code: 'network' });
  const slow = (url, init) => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
  await assert.rejects(createAIClient({ backoffMs: 1, getKey: () => KEY, fetch: slow, timeoutMs: 20, isOnline: () => true }).chat(msg), { code: 'timeout' });
  const f = mockFetch();
  await assert.rejects(createAIClient({ backoffMs: 1, getKey: () => '', fetch: f }).chat(msg), { code: 'no_key' });
  assert.equal(f.calls.length, 0);
  await assert.rejects(createAIClient({ backoffMs: 1, getKey: () => KEY, fetch: f }).chat([]), { code: 'empty_message' });
  await assert.rejects(createAIClient({ backoffMs: 1, getKey: () => KEY, fetch: f }).analyzeMealPhoto('AAAA', 'image/bmp'), { code: 'bad_image' });
});

test('the key is never logged', async () => {
  const seen = [];
  const orig = { log: console.log, warn: console.warn, error: console.error, info: console.info, debug: console.debug };
  for (const k of Object.keys(orig)) console[k] = (...a) => seen.push(a.join(' '));
  try {
    const ai = createAIClient({ backoffMs: 1, getKey: () => KEY, fetch: mockFetch({}, 401), isOnline: () => true });
    await ai.chat([{ role: 'user', content: 'hi' }]).catch(() => {});
  } finally { Object.assign(console, orig); }
  assert.ok(!seen.some((s) => s.includes(KEY)));
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(new URL('../src/core/ai.js', import.meta.url), 'utf8');
  assert.ok(!/console\./.test(src));
});

test('systemBlocks marks the stable prompt and the context block for prompt caching', () => {
  assert.equal(systemBlocks(''), undefined);
  assert.deepEqual(systemBlocks('Only rules'), [{ type: 'text', text: 'Only rules', cache_control: { type: 'ephemeral' } }]);
  const b = systemBlocks('Rules here\n\nData summary:\nBody: 75 kg');
  assert.equal(b.length, 2);
  assert.equal(b[0].text, 'Rules here');
  assert.equal(b[1].text, 'Data summary:\nBody: 75 kg');
  assert.ok(b.every((x) => x.cache_control.type === 'ephemeral'));
  const arr = [{ type: 'text', text: 'x' }];
  assert.equal(systemBlocks(arr), arr);
  assert.equal(systemText(b), 'Rules here\n\nData summary:\nBody: 75 kg');
});

// ── streaming (SSE) + retry ──
const sse = (events) => events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
const streamRes = (text, { chunks = 3, status = 200 } = {}) => {
  const parts = [];
  const body = sse([{ type: 'message_start', message: { model: MODELS.quick, usage: { input_tokens: 10 } } },
    ...Array.from(text.match(new RegExp(`[\\s\\S]{1,${Math.max(1, Math.ceil(text.length / chunks))}}`, 'g')) || [], (t) => ({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: t } })),
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 5 } }, { type: 'message_stop' }]);
  for (let i = 0; i < body.length; i += 37) parts.push(body.slice(i, i + 37)); // split mid-event on purpose
  const enc = new TextEncoder();
  return { ok: status < 300, status, headers: new Map([['content-type', 'text/event-stream']]),
    body: new ReadableStream({ start(c) { for (const p of parts) c.enqueue(enc.encode(p)); c.close(); } }) };
};

test('streaming: text deltas arrive in order, split chunks reassembled, stream:true sent', async () => {
  const seen = []; let body = null;
  const ai = createAIClient({ backoffMs: 1, getKey: () => KEY, isOnline: () => true, fetch: async (u, init) => { body = JSON.parse(init.body); return streamRes('أيوه ينفع، بس خلي التمرين خفيف قبل الفطار بساعة.'); } });
  const r = await ai.complete({ model: MODELS.quick, max_tokens: 300, stream: true, messages: [{ role: 'user', content: 'ينفع أتمرن صايم؟' }] }, { onText: (t) => seen.push(t) });
  assert.equal(body.stream, true);
  assert.equal(r.text, 'أيوه ينفع، بس خلي التمرين خفيف قبل الفطار بساعة.');
  assert.ok(seen.length >= 2 && seen[seen.length - 1] === r.text, `progressive ${seen.length}`);
  assert.equal(r.stopReason, 'end_turn'); assert.equal(r.model, MODELS.quick);
});

test('retry: 529 then 429 then success; retry-after honoured; no retry on 401 / after partial text', async () => {
  let n = 0; const retries = [];
  const seq = [() => ({ ok: false, status: 529, headers: new Map(), json: async () => ({ error: { type: 'overloaded_error' } }) }),
    () => ({ ok: false, status: 429, headers: new Map([['retry-after', '0.01']]), json: async () => ({ error: { type: 'rate_limit_error' } }) }),
    () => streamRes('تمام')];
  const ai = createAIClient({ backoffMs: 1, getKey: () => KEY, isOnline: () => true, fetch: async () => seq[n++]() });
  const r = await ai.complete({ model: 'm', stream: true, messages: [{ role: 'user', content: 'x' }] }, { onRetry: (a, e, w) => retries.push([a, e.code, w]) });
  assert.equal(r.text, 'تمام'); assert.equal(n, 3);
  assert.deepEqual(retries.map((x) => x.slice(0, 2)), [[1, 'overloaded'], [2, 'rate_limit']]);
  assert.equal(retries[1][2], 10);
  let k = 0;
  await assert.rejects(createAIClient({ backoffMs: 1, getKey: () => KEY, isOnline: () => true, fetch: async () => { k++; return { ok: false, status: 401, headers: new Map(), json: async () => ({}) }; } }).complete({ messages: [{ role: 'user', content: 'x' }] }), { code: 'bad_key' });
  assert.equal(k, 1);
  // overloaded error event mid-stream after some text → thrown with the partial text, not retried
  let m = 0; const enc = new TextEncoder();
  const mid = () => ({ ok: true, status: 200, headers: new Map([['content-type', 'text/event-stream']]), body: new ReadableStream({ start(c) { c.enqueue(enc.encode(sse([{ type: 'content_block_delta', delta: { type: 'text_delta', text: 'نص ' } }, { type: 'error', error: { type: 'overloaded_error' } }]))); c.close(); } }) });
  await assert.rejects(createAIClient({ backoffMs: 1, getKey: () => KEY, isOnline: () => true, fetch: async () => { m++; return mid(); } }).complete({ stream: true, messages: [{ role: 'user', content: 'x' }] }, { onText: () => {} }), (e) => e.code === 'overloaded' && e.partial === 'نص ');
  assert.equal(m, 1);
});

test('timeout: hung request retried once then a timeout error', async () => {
  let n = 0;
  const slow = (url, init) => { n++; return new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })))); };
  await assert.rejects(createAIClient({ backoffMs: 1, getKey: () => KEY, fetch: slow, timeoutMs: 20, isOnline: () => true }).complete({ messages: [{ role: 'user', content: 'x' }] }), { code: 'timeout' });
  assert.equal(n, 2);
});

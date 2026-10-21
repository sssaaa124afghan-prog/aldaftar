import test from 'node:test';
import assert from 'node:assert/strict';
import { speechEnv, speechMessage, listen, fileContextHint, LANGS } from '../../core/speech.js';

const IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1';
const win = (o = {}) => ({ navigator: { userAgent: o.ua || 'Chrome Android', standalone: o.standalone }, location: { protocol: o.proto || 'https:' }, isSecureContext: true,
  matchMedia: () => ({ matches: !!o.standalone }), webkitSpeechRecognition: o.SR === undefined ? class {} : o.SR });

test('env: iOS home-screen app has no usable speech; unsupported; file:// detected', () => {
  assert.equal(speechEnv(win({ ua: IOS })).supported, true);
  const st = speechEnv(win({ ua: IOS, standalone: true }));
  assert.equal(st.supported, false); assert.equal(st.reason, 'ios-standalone');
  assert.equal(speechEnv(win({ SR: null })).reason, 'unsupported');
  assert.equal(speechEnv(win({ proto: 'file:' })).fileCtx, true);
});

test('each error has its own Arabic message with what to do', () => {
  const ios = { ios: true }; const and = { ios: false };
  assert.match(speechMessage('not-allowed', ios), /الإعدادات › Safari › الميكروفون/);
  assert.match(speechMessage('not-allowed', and), /القفل/);
  assert.match(speechMessage('service-not-allowed', ios), /Siri والإملاء/);
  assert.match(speechMessage('audio-capture', ios), /Siri والإملاء/);
  assert.equal(speechMessage('no-speech', and), 'ماسمعتش حاجة، قرّب الموبايل وجرّب تاني');
  assert.match(speechMessage('network', and), /إنترنت/);
  assert.match(speechMessage('unsupported', and), /مايك الكيبورد 🎤/);
  assert.match(speechMessage('ios-standalone', ios), /مايك الكيبورد 🎤/);
  const all = ['not-allowed', 'service-not-allowed', 'audio-capture', 'no-speech', 'network', 'unsupported', 'ios-standalone'].map((c) => speechMessage(c, and));
  assert.equal(new Set(all).size, all.length, 'no shared catch-all line');
  const store = new Map(); const st = { getItem: (k) => store.get(k) || null, setItem: (k, v) => store.set(k, v) };
  assert.match(fileContextHint({ fileCtx: true }, st), /github\.io/); assert.equal(fileContextHint({ fileCtx: true }, st), null, 'one time only');
});

// Fake recognizer driven by a script of events.
function fakeEnv(script, { ios = false } = {}) {
  const made = [];
  class SR { constructor() { made.push(this); this.n = made.length - 1; } start() { this.started = true; const ev = script[this.n] || []; let t = 0; for (const [ms, fn] of ev) { t += ms; setTimeout(() => fn(this), t); } } stop() { this.stopped = true; setTimeout(() => this.onend && this.onend(), 5); } abort() {} }
  return { env: { SR, ios, supported: true, reason: null }, made };
}
const res = (txt, isFinal = true) => (r) => { const a = [{ transcript: txt }]; a.isFinal = isFinal; r.onresult({ resultIndex: 0, results: [a] }); };
const end = (r) => r.onend && r.onend();
const err = (code) => (r) => r.onerror && r.onerror({ error: code });

const run = (script, opts = {}) => new Promise((resolve) => {
  const out = { interim: [], result: null, error: null, states: [] };
  const { env, made } = fakeEnv(script, opts);
  listen({ onInterim: (t) => out.interim.push(t), onResult: (a) => { out.result = a; }, onError: (c, m) => { out.error = [c, m]; }, onState: (s) => out.states.push(s), onEnd: () => resolve({ ...out, made }) }, { env, silenceMs: 40, maxMs: 2000 });
});

test('listen: interim then auto-stop after silence; ar-EG first, interim + continuous set (not on iOS)', async () => {
  const o = await run([[[10, res('اكلت 150', false)], [10, res('اكلت 150 جم كبدة')]]]);
  assert.deepEqual(o.result, ['اكلت 150 جم كبدة']);
  assert.ok(o.interim.includes('اكلت 150'));
  assert.equal(o.made[0].lang, LANGS[0]); assert.equal(o.made[0].interimResults, true); assert.equal(o.made[0].continuous, true);
  assert.ok(o.made[0].stopped, 'stopped by the silence timer');
  const i = await run([[[10, res('80 في 8')], [5, end]]], { ios: true });
  assert.equal(i.made[0].continuous, false);
});

test('listen: iOS early end without result restarts once; no-speech / network / denied map to their messages', async () => {
  const o = await run([[[10, end]], [[10, res('سجل 80 في 8')], [5, end]]], { ios: true });
  assert.equal(o.made.length, 2); assert.deepEqual(o.result, ['سجل 80 في 8']);
  const n = await run([[[10, end]], [[10, end]]]);
  assert.equal(n.error[0], 'no-speech'); assert.equal(n.made.length, 2);
  const e1 = await run([[[10, err('no-speech')], [5, end]]]);
  assert.equal(e1.error[1], 'ماسمعتش حاجة، قرّب الموبايل وجرّب تاني'); assert.equal(e1.made.length, 1);
  const e2 = await run([[[10, err('network')], [5, end]]]); assert.equal(e2.error[0], 'network');
  const e3 = await run([[[10, err('not-allowed')], [5, end]]]); assert.equal(e3.error[0], 'not-allowed');
  const lang = await run([[[10, err('language-not-supported')], [5, end]], [[10, res('تمام')], [5, end]]]);
  assert.equal(lang.made[1].lang, 'ar-SA'); assert.deepEqual(lang.result, ['تمام']);
});

test('listen: unsupported / iOS standalone fail fast with the keyboard-mic hint', async () => {
  const o = await new Promise((r) => listen({ onError: (c, m) => r([c, m]) }, { env: { SR: class {}, reason: 'ios-standalone', ios: true } }));
  assert.equal(o[0], 'ios-standalone'); assert.match(o[1], /🎤/);
});

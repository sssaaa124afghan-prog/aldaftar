import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toneFor, TONES, TONE_BG, TONE_LABEL } from '../src/app/tone-data.js';

test('tone: each lifting day has its colour, before / during / after the session', () => {
  assert.equal(toneFor({ kind: 'training', dayId: 'upperA' }), 'sunrise');
  assert.equal(toneFor({ kind: 'training', dayId: 'lowerA' }), 'mint');
  assert.equal(toneFor({ kind: 'training', dayId: 'upperB' }), 'sky');
  assert.equal(toneFor({ kind: 'training', dayId: 'lowerB' }), 'berry');
  assert.equal(toneFor({ kind: 'active', dayId: 'upperA', live: { dayKey: 'lowerB' } }), 'berry');
  assert.equal(toneFor({ kind: 'done', dayId: 'lowerA', doneToday: { dayKey: 'upperB' } }), 'sky');
});

test('tone: boxing / cardio = fire, rest = gold, custom programs cycle by order', () => {
  assert.equal(toneFor({ kind: 'heart', cardio: 'boxing' }), 'fire');
  assert.equal(toneFor({ kind: 'heart' }), 'fire');
  assert.equal(toneFor({ kind: 'rest' }), 'gold');
  assert.equal(toneFor(null), 'gold');
  assert.equal(toneFor({ kind: 'training', dayId: 'push' }, ['pull', 'push', 'legs']), 'mint');
  assert.equal(toneFor({ kind: 'training', dayId: 'x5' }, ['a', 'b', 'c', 'd', 'x5']), 'sunrise');
});

test('tone: every tone has a ground and a name', () => {
  for (const t of TONES) { assert.match(TONE_BG[t], /^#[0-9A-F]{6}$/i); assert.ok(TONE_LABEL[t]); }
});

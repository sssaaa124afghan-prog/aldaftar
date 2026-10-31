import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeHealth, sleepHours } from '../src/app/health-data.js';

test('sleep units', () => {
  assert.equal(sleepHours(7.25), 7.3);
  assert.equal(sleepHours(435), 7.3);      // minutes
  assert.equal(sleepHours(26100), 7.3);    // seconds
  assert.equal(sleepHours(0), null);
});
test('normalize: ranges + nothing → null', () => {
  const d = normalizeHealth({ at: 5, steps: 7532.4, hr: 71.6, hrmax: 168, hravg: 141, rhr: 58, kcal: 412, sleep: 6.5 });
  assert.deepEqual(d, { at: 5, steps: 7532, activeKcal: 412, restingHr: 58, hr: 72, hrAvg: 141, hrMax: 168, sleepH: 6.5 });
  assert.equal(normalizeHealth({ at: 5, hr: 900 }), null);
});

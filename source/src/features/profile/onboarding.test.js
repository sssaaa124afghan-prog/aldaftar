import test from 'node:test';
import assert from 'node:assert/strict';
import { onboardingResult, OB_DEFAULTS } from './onboarding.js';

test('onboarding defaults (owner): 72 kg, 175 cm, Mon/Tue/Thu/Fri, returning → 2-week re-entry from today', () => {
  const r = onboardingResult({ kg: String(OB_DEFAULTS.kg), heightCm: '175', days: [...OB_DEFAULTS.trainingDays], returning: true, today: '2026-10-20' });
  assert.deepEqual(r.weight, { kg: 72 });
  assert.deepEqual(r.profile, { heightCm: 175, age: 27 });
  assert.deepEqual(r.settings.trainingDays, [1, 2, 4, 5]);
  assert.deepEqual(r.settings['wk.reentry'], { startDay: '2026-10-20', weeks: 2 });
  assert.equal(r.settings.onboarded, '2026-10-20');
});

test('onboarding: not returning → no re-entry; keeps an existing age; bad inputs are dropped, not guessed', () => {
  const r = onboardingResult({ kg: '٧٣٫٥', heightCm: 'x', days: [5, 1, 1, 9], returning: false, today: '2026-10-20', profile: { age: 31 } });
  assert.deepEqual(r.weight, { kg: 73.5 });
  assert.deepEqual(r.profile, {});
  assert.deepEqual(r.settings.trainingDays, [1, 5]);
  assert.equal('wk.reentry' in r.settings, false);
  assert.equal(onboardingResult({ kg: '7', heightCm: '', days: [], returning: false, today: '2026-10-20' }).weight, null);
});

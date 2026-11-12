import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromeState } from '../src/app/native-chrome.js';

const fake = ({ classes = [], cover = false, tab = 'workout', scheme = 'dark' } = {}) => {
  const root = { classList: { contains: (c) => classes.includes(c) }, style: { colorScheme: scheme }, dataset: { design: 'd' }, ownerDocument: { querySelector: () => (cover ? {} : null) } };
  const nav = { querySelector: () => (tab ? { dataset: { tab } } : null) };
  return [root, nav];
};

test('chrome: bar shows on tabs, hides for session / onboarding / sheets / typing', () => {
  assert.deepEqual(chromeState(...fake()), { tab: 'workout', bar: true, scheme: 'dark', design: 'd', tint: '' });
  assert.equal(chromeState(...fake({ classes: ['immersive'] })).bar, false);
  assert.equal(chromeState(...fake({ classes: ['ob-on'] })).bar, false);
  assert.equal(chromeState(...fake({ cover: true })).bar, false);
  assert.equal(chromeState(...fake(), { typing: true }).bar, false);
  assert.equal(chromeState(...fake({ tab: '', scheme: 'light' })).scheme, 'light');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSetCommand, parseBest, resolveCommand, applyPrefill, tokenize } from './voice.js';

const P = (t) => { const c = parseSetCommand(t); const o = { kind: c.kind, commit: c.commit }; for (const k of ['w', 'r', 'rir']) if (c[k] !== undefined) o[k] = c[k]; return o; };

test('weight × reps phrases (Egyptian / Gulf / digits)', () => {
  const cases = [
    ['سجل 80 في 8', { kind: 'set', commit: true, w: 80, r: 8 }],
    ['تمانين في تمانية', { kind: 'set', commit: false, w: 80, r: 8 }],
    ['ثمانين في ثمانية', { kind: 'set', commit: false, w: 80, r: 8 }],
    ['82 ونص في 6', { kind: 'set', commit: false, w: 82.5, r: 6 }],
    ['اتنين وتمانين ونص كيلو تمن عدات', { kind: 'set', commit: false, w: 82.5, r: 8 }],
    ['8 عدات بـ 80', { kind: 'set', commit: false, w: 80, r: 8 }],
    ['80 كيلو 8 مرات RIR 2', { kind: 'set', commit: false, w: 80, r: 8, rir: 2 }],
    ['80 في 8 فاضل اتنين', { kind: 'set', commit: false, w: 80, r: 8, rir: 2 }],
    ['٨٠ × ٨', { kind: 'set', commit: false, w: 80, r: 8 }],
    ['80x8', { kind: 'set', commit: false, w: 80, r: 8 }],
    ['80 X 8', { kind: 'set', commit: false, w: 80, r: 8 }],
    ['سجّل ٧٧٫٥ في ١٠', { kind: 'set', commit: true, w: 77.5, r: 10 }],
    ['82.5 في 6', { kind: 'set', commit: false, w: 82.5, r: 6 }],
    ['مية وعشرين في خمسة', { kind: 'set', commit: false, w: 120, r: 5 }],
    ['مية في عشرة', { kind: 'set', commit: false, w: 100, r: 10 }],
    ['ميتين في اتنين', { kind: 'set', commit: false, w: 200, r: 2 }],
    ['تلات مية في 2', { kind: 'set', commit: false, w: 300, r: 2 }],
    ['ستين وربع في اتناشر', { kind: 'set', commit: false, w: 60.25, r: 12 }],
    ['بتمانين تمن مرات', { kind: 'set', commit: false, w: 80, r: 8 }],
    ['عشرين كيلو عدتين', { kind: 'set', commit: false, w: 20, r: 2 }],
    ['82 كيلو ونص 6 عدات', { kind: 'set', commit: false, w: 82.5, r: 6 }],
    ['80 في 8 خلصت', { kind: 'set', commit: true, w: 80, r: 8 }],
  ];
  for (const [t, want] of cases) assert.deepEqual(P(t), want, t);
});

test('single field, commands, repeat', () => {
  assert.deepEqual(P('الوزن 85'), { kind: 'set', commit: false, w: 85 });
  assert.deepEqual(P('العدات 10'), { kind: 'set', commit: false, r: 10 });
  assert.deepEqual(P('85 كيلو'), { kind: 'set', commit: false, w: 85 });
  assert.deepEqual(P('عشر عدات'), { kind: 'set', commit: false, r: 10 });
  assert.deepEqual(P('زي اللي فاتت'), { kind: 'repeat', commit: false });
  assert.deepEqual(P('سجل زي اللي فاتت'), { kind: 'repeat', commit: true });
  assert.deepEqual(P('نفس المجموعة'), { kind: 'repeat', commit: false });
  for (const t of ['خلصت', 'تم', 'خلاص']) assert.deepEqual(P(t), { kind: 'done', commit: true }, t);
  for (const t of ['امسح', 'تراجع', 'الغيها']) assert.equal(P(t).kind, 'undo', t);
  for (const t of ['الجاية', 'الجاي', 'التمرين الجاي', 'اللي بعده']) assert.equal(P(t).kind, 'next', t);
});

test('implausible / ambiguous input → gentle Arabic message, never a guess', () => {
  for (const t of ['ستميه في 8', '600 في 5', '80 في 0', '80 في 150', '80 في 8 ونص']) {
    const c = parseSetCommand(t);
    assert.equal(c.kind, 'invalid', t); assert.match(c.error, /[؀-ۿ]/, t);
  }
  assert.equal(parseSetCommand('80').kind, 'invalid', 'a lone number is ambiguous');
  assert.equal(parseSetCommand('').kind, 'none');
  assert.equal(parseSetCommand('ازيك يا كوتش').kind, 'none');
  assert.equal(parseSetCommand('كوباية').kind, 'none', 'food unit words are not numbers');
  assert.equal(parseSetCommand('80 في 8 في 3').kind, 'invalid');
  assert.equal(P('0 في 12').w, 0, 'bodyweight 0 kg is allowed');
  assert.equal(P('500 في 1').w, 500);
  assert.equal(parseSetCommand('500.5 في 1').kind, 'invalid');
});

test('tokenize keeps decimals and splits glued digits', () => {
  assert.deepEqual(tokenize('بـ80'), ['ب', '80']);
  assert.deepEqual(tokenize('8عدات'), ['8', 'عدات']);
  assert.deepEqual(tokenize('٨٢٫٥×٦'), ['82.5', 'x', '6']);
});

test('parseBest picks the first alternative that parses', () => {
  const c = parseBest(['تمانين فيه تمانية', 'تمانين في تمانية']);
  assert.equal(c.kind, 'set'); assert.equal(c.w, 80); assert.equal(c.r, 8);
  assert.equal(parseBest(['هلا', '700 في 5']).kind, 'invalid', 'a specific error wins over «none»');
});

test('resolveCommand fills only the current set; repeat uses the previous set, then last time', () => {
  const e = { sets: [{ w: 80, r: 8, done: true, at: 1 }, { w: 82.5, r: 6, done: false }, { w: 82.5, r: 6, done: false }], prev: [{ w: 75, r: 10 }, { w: 77.5, r: 9 }, { w: 77.5, r: 8 }] };
  assert.deepEqual(resolveCommand(parseSetCommand('زي اللي فاتت'), e, 1), { action: 'fill', w: 80, r: 8, rir: null, commit: false, repeat: true });
  const fresh = { sets: [{ w: 60, r: 10, done: false }], prev: [{ w: 57.5, r: 10 }] };
  assert.equal(resolveCommand(parseSetCommand('زي اللي فاتت'), fresh, 0).w, 57.5);
  assert.equal(resolveCommand(parseSetCommand('زي اللي فاتت'), { sets: [{ w: 0, r: 8 }], prev: [] }, 0).action, 'error');
  assert.deepEqual(resolveCommand(parseSetCommand('الوزن 85'), e, 1), { action: 'fill', w: 85, r: 6, rir: null, commit: false });
  assert.deepEqual(resolveCommand(parseSetCommand('العدات 10'), e, 1), { action: 'fill', w: 82.5, r: 10, rir: null, commit: false });
  assert.deepEqual(resolveCommand(parseSetCommand('خلصت'), e, 1), { action: 'fill', w: 82.5, r: 6, rir: null, commit: true });
  assert.equal(resolveCommand(parseSetCommand('خلصت'), { sets: [{ w: 20, r: 0 }] }, 0).action, 'error');
  assert.equal(resolveCommand(parseSetCommand('امسح'), e, 1).action, 'undo');
  assert.equal(resolveCommand(parseSetCommand('الجاية'), e, 1).action, 'next');
  assert.equal(resolveCommand(parseSetCommand('80 في 8'), e, 9).action, 'error', 'no current set');
  assert.equal(resolveCommand(parseSetCommand('ستميه في 8'), e, 1).action, 'error');
  assert.equal(e.sets[2].w, 82.5, 'pure: nothing mutated');
});

test('applyPrefill: coach bridge weights land on open planned sets only, tagged; bad values ignored', () => {
  const live = { exercises: [
    { exId: 'a', sets: [{ w: 60, r: 8, done: true }, { w: 60, r: 8 }, { w: 60, r: 8 }] },
    { exId: 'b', lib: 'curl', sets: [{ w: 10, r: 12 }] },
    { exId: 'c', sets: [{ w: 30, r: 10 }] }] };
  const n = applyPrefill(live, { a: { sets: [{ w: 99, r: 9 }, { w: 62.5, r: 8 }, { w: 9999, r: 8 }, { w: 1, r: 1 }], note: 'خليك على RIR 2' }, curl: { sets: [{ w: 12, r: 'x' }] }, zzz: { sets: [{ w: 1, r: 1 }] } });
  assert.equal(n, 3);
  assert.deepEqual(live.exercises[0].sets.map((t) => [t.w, t.r, !!t.coach]), [[60, 8, false], [62.5, 8, true], [60, 8, true]]);
  assert.deepEqual([live.exercises[1].sets[0].w, live.exercises[1].sets[0].r, live.exercises[1].sets[0].coach], [12, 12, true]);
  assert.equal(live.exercises[2].sets[0].coach, undefined);
  assert.equal(live.exercises[0].sets.length, 3, 'never adds sets');
  assert.match(live.exercises[0].planNote, /اقتراح المدرب: خليك على RIR 2/);
  assert.equal(applyPrefill(live, null), 0);
  assert.equal(applyPrefill(live, 'nope'), 0);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryDB, saveData, loadData, getSecret, setSecret, writeSnapshot, safeParseJSON, STORES } from '../src/core/db.js';
import { emptyData } from '../src/core/schema.js';

test('memory adapter: put/get/getAll/delete/clear, values are copies', async () => {
  const db = createMemoryDB();
  const rec = { id: 'a', name: 'x' };
  await db.put('foods', rec);
  rec.name = 'mutated';
  assert.equal((await db.get('foods', 'a')).name, 'x');
  assert.equal((await db.getAll('foods')).length, 1);
  await db.delete('foods', 'a');
  assert.equal(await db.get('foods', 'a'), undefined);
  await assert.rejects(db.put('nope', { id: 1 }), { code: 'bad_store' });
  await assert.rejects(db.put('foods', { name: 'no id' }), { code: 'bad_record' });
});

test('batch is all-or-nothing', async () => {
  const db = createMemoryDB();
  await db.put('foods', { id: 'keep' });
  await assert.rejects(db.batch([{ store: 'foods', type: 'clear' }, { store: 'foods', type: 'put', value: { bad: 1 } }]));
  assert.equal((await db.getAll('foods')).length, 1);
});

test('saveData → loadData round trip; secrets live outside data', async () => {
  const db = createMemoryDB();
  const d = emptyData(new Date(2026, 9, 19));
  d.foods.push({ id: 'u1', name: 'شوفان', kcal: 380, p: 13, c: 66, f: 7, per: 100 });
  d.foodLog['2026-10-19'] = [{ id: 'e1', name: 'شوفان', kcal: 228, p: 7.8, c: 39.6, f: 4.2 }];
  d.sessions.push({ id: 's1', day: '2026-10-19', startedAt: '2026-10-19T05:00:00.000Z', exercises: [] });
  d.bodyweight.push({ day: '2026-10-19', kg: 75, src: 'manual', at: null });
  d.daily['2026-10-19'] = { waterMl: 1500 };
  d.meta.legacyRaw = { k: 'raw' };
  await saveData(db, d);
  await setSecret(db, 'anthropicKey', 'sk-ant-test-123456789');
  const { data, issues, empty } = await loadData(db);
  assert.equal(empty, false);
  assert.deepEqual(issues, []);
  assert.deepEqual(data.foodLog, d.foodLog);
  assert.deepEqual(data.foods, d.foods);
  assert.equal(data.daily['2026-10-19'].waterMl, 1500);
  assert.deepEqual(data.meta.legacyRaw, { k: 'raw' });
  assert.ok(!JSON.stringify(data).includes('sk-ant'));
  assert.equal(await getSecret(db, 'anthropicKey'), 'sk-ant-test-123456789');
  await setSecret(db, 'anthropicKey', '');
  assert.equal(await getSecret(db, 'anthropicKey'), '');
});

test('loadData skips bad records and reports them; it never writes defaults', async () => {
  const db = createMemoryDB();
  db._data.foods.set('x', 'not an object');
  db._data.sessions.set('s', { id: 's', day: '2026-10-19' });
  const before = JSON.stringify([...db._data.foods]);
  const { data, issues, empty } = await loadData(db);
  assert.equal(empty, true);
  assert.equal(data.sessions.length, 1);
  assert.deepEqual(issues, [{ store: 'foods', error: 'bad_record' }]);
  assert.equal(JSON.stringify([...db._data.foods]), before); // untouched
  assert.equal(db._data.meta.size, 0); // no defaults written
});

test('snapshots keep the last 3', async () => {
  const db = createMemoryDB();
  for (let i = 0; i < 5; i++) await writeSnapshot(db, emptyData(), { now: new Date(2026, 9, 19, 10, i) });
  assert.equal((await db.getAll('snapshots')).length, 3);
});

test('safeParseJSON never throws', () => {
  assert.equal(safeParseJSON('{bad').ok, false);
  assert.equal(safeParseJSON(null).ok, false);
  assert.deepEqual(safeParseJSON('{"a":1}').value, { a: 1 });
  assert.ok(Object.keys(STORES).includes('foodLog'));
});

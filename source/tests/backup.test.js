import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exportBackup, serializeBackup, importBackup, importBackupToDB, detectFormat, backupFileName } from '../src/core/backup.js';
import { migrateLegacy } from '../src/core/migrate.js';
import { createMemoryDB, saveData, loadData, setSecret } from '../src/core/db.js';
import { emptyData, APP_ID } from '../src/core/schema.js';
import { nutriFixture, gymFixture } from './fixtures.js';

const NOW = new Date(2026, 9, 19, 10, 0);
const full = () => migrateLegacy({ nutri: JSON.stringify(nutriFixture()), gym: JSON.stringify(gymFixture()) }, { now: NOW }).data;

test('export never includes an API key, wherever it hides', () => {
  const d = full();
  d.secrets = { anthropicKey: 'sk-ant-api03-SECRETSECRETSECRET' };
  d.settings.apiKey = 'sk-ant-api03-SECRETSECRETSECRET';
  d.chat.push({ id: 'c', role: 'user', content: 'my key is sk-ant-api03-SECRETSECRETSECRET', at: null });
  const text = serializeBackup(d, { now: NOW });
  assert.ok(!text.includes('SECRETSECRET'));
  assert.ok(!text.includes('gsk_'));
  const b = JSON.parse(text);
  assert.equal(b.app, APP_ID);
  assert.equal(b.schema, 1);
  assert.equal(b.includesSecrets, false);
  assert.equal(b.data.secrets, undefined);
  assert.equal(backupFileName(new Date(2026, 9, 19, 0, 30)), `${APP_ID}-backup-2026-10-19.json`); // local day
});

test('round trip: export → import into empty = same data', () => {
  const d = full();
  const res = importBackup(serializeBackup(d, { now: NOW }), null, { now: NOW });
  assert.equal(res.ok, true);
  assert.equal(res.format, 'v1');
  assert.deepEqual(res.data.foodLog, d.foodLog);
  assert.deepEqual(res.data.sessions, d.sessions);
  assert.deepEqual(res.data.bodyweight, d.bodyweight);
  assert.deepEqual(res.data.settings.trainingDays, d.settings.trainingDays);
  assert.equal(res.stats.added.sessions, 2);
});

test('merge by id/day: existing kept, new added, duplicates not doubled', () => {
  const existing = full();
  existing.foodLog['2026-10-19'] = [{ id: 'local:1', name: 'زبادي', kcal: 100, p: 10, c: 5, f: 3 }];
  existing.sessions.push({ id: 'local:s', day: '2026-10-19', exercises: [] });
  existing.foods[0].name = 'اسم معدّل';
  const incoming = full();
  incoming.foodLog['2026-10-17'].push({ id: 'other:9', name: 'موز', kcal: 105, p: 1.3, c: 27, f: 0.4 });
  incoming.sessions.push({ id: 'other:s', day: '2026-10-18', exercises: [] });
  incoming.bodyweight.push({ day: '2026-10-20', kg: 74, src: 'manual', at: '2026-10-20T05:00:00.000Z' });
  const res = importBackup(exportBackup(incoming, { now: NOW }), existing, { now: NOW });
  assert.equal(res.ok, true);
  assert.equal(res.data.foodLog['2026-10-17'].length, 3); // 2 existing + 1 new, no duplicates
  assert.equal(res.data.foodLog['2026-10-19'].length, 1); // untouched local day kept
  assert.equal(res.data.sessions.length, 4);
  assert.equal(res.data.foods[0].name, 'اسم معدّل'); // existing edit wins
  assert.equal(res.data.bodyweight.length, 4);
  assert.equal(res.stats.added.meals, 1);
  assert.equal(res.stats.duplicates.meals, 3);
});

test('re-importing the same legacy file twice does not duplicate', () => {
  const raw = nutriFixture();
  const a = importBackup(raw, null, { now: NOW });
  const b = importBackup(raw, a.data, { now: NOW });
  assert.equal(a.format, 'nutripro_raw');
  assert.deepEqual(b.data.foodLog, a.data.foodLog);
  assert.equal(b.stats.added.meals || 0, 0);
});

test('accepts all legacy formats', () => {
  const N = nutriFixture();
  const G = gymFixture();
  const cases = [
    [N, 'nutripro_raw', (d) => Object.keys(d.foodLog).length === 2],
    [G, 'sologym_raw', (d) => d.sessions.length === 2],
    [{ app: 'SoloGym', key: 'gymProAI_v12_fixed', ts: 1760000000000, data: G }, 'sologym_v21', (d) => d.sessions.length === 2],
    [{ _format: 'nutripro_foods_v1', _exported: '2026-10-01', _count: 2, foods: { u_whey: N.foods.u_whey, f1: N.foods.f1 } }, 'nutripro_foods_v1', (d) => d.foods.length === 2],
    [{ _format: 'nutripro_meals_v1', _exported: '2026-10-01', _count: 1, savedMeals: N.savedMeals }, 'nutripro_meals_v1', (d) => d.nutrition.savedMeals.sm1.items.length === 1],
    [{ _format: 'nutripro_gym_v1', _app: 'NutriPro AI', diary_entries: [{ date: '2026-10-17', name: 'بيض', qty: 4, unit: 'حبة', section: 'فطار', time: '08:10', nutrition: { calories: 280, protein: 24, carbohydrates: 2, fat: 20 } }], weight_log: [{ date: '2026-10-17', weight_kg: 75 }], daily_summaries: [] }, 'nutripro_gym_v1', (d) => d.foodLog['2026-10-17'][0].id === 'n:2026-10-17:0' && d.bodyweight.length === 1],
    [exportBackup(full(), { now: NOW }), 'v1', (d) => d.sessions.length === 2],
  ];
  for (const [obj, fmt, check] of cases) {
    assert.equal(detectFormat(obj), fmt);
    const r = importBackup(JSON.stringify(obj), null, { now: NOW });
    assert.equal(r.ok, true, fmt);
    assert.equal(r.format, fmt);
    assert.ok(check(r.data), `content check ${fmt}`);
    assert.ok(!JSON.stringify(r.data).includes('gsk_'), `no key leaked via ${fmt}`);
  }
});

test('nutripro_gym_v1 diary merges with the raw NutriPro migration without duplicates', () => {
  const a = importBackup(nutriFixture(), null, { now: NOW });
  const gymExport = { _format: 'nutripro_gym_v1', diary_entries: [
    { date: '2026-10-17', name: 'بيض', qty: 4, nutrition: { calories: 280, protein: 24, carbohydrates: 2, fat: 20 } },
    { date: '2026-10-17', name: 'شوفان', qty: 60, nutrition: { calories: 228, protein: 7.8, carbohydrates: 39.6, fat: 4.2 } }] };
  const b = importBackup(gymExport, a.data, { now: NOW });
  assert.equal(b.data.foodLog['2026-10-17'].length, 2);
});

test('bad inputs fail safely with Arabic messages and leave data untouched', () => {
  const existing = full();
  for (const [input, code] of [['', 'empty'], ['{oops', 'invalid_json'], ['date,name\n1,2', 'csv_unsupported'], ['{"hello":1}', 'unknown_format'],
    [JSON.stringify({ app: APP_ID, schema: 99, exportedAt: 'x', data: {} }), 'newer_schema']]) {
    const r = importBackup(input, existing);
    assert.equal(r.ok, false, code);
    assert.equal(r.error, code);
    assert.match(r.message, /[؀-ۿ]/);
    assert.equal(r.data, existing);
  }
});

test('v1 validation drops invalid records instead of rejecting the file', () => {
  const b = exportBackup(full(), { now: NOW });
  b.data.sessions.push({ noId: true });
  b.data.bodyweight.push({ day: 'bad', kg: 75 });
  b.data.foodLog['2026-10-17'].push({ name: 'no id' });
  const r = importBackup(b, null);
  assert.equal(r.ok, true);
  assert.equal(r.skipped.sessions, 1);
  assert.equal(r.skipped.weights, 1);
  assert.equal(r.skipped.meals, 1);
});

test('replace mode keeps meta (migration state) but swaps content', () => {
  const existing = full();
  existing.meta.migratedAt = '2026-10-19T06:00:00.000Z';
  const incoming = emptyData(NOW);
  incoming.sessions.push({ id: 'only', day: '2026-10-19', exercises: [] });
  const r = importBackup(exportBackup(incoming, { now: NOW }), existing, { mode: 'replace' });
  assert.equal(r.data.sessions.length, 1);
  assert.equal(r.data.meta.migratedAt, '2026-10-19T06:00:00.000Z');
});

test('importBackupToDB snapshots first, merges, never writes on failure; key not exported', async () => {
  const db = createMemoryDB();
  await saveData(db, full());
  await setSecret(db, 'anthropicKey', 'sk-ant-api03-KEEPMEOUTOFBACKUPS');
  const bad = await importBackupToDB(db, '{broken');
  assert.equal(bad.ok, false);
  assert.equal((await db.getAll('snapshots')).length, 0);
  const extra = emptyData(NOW);
  extra.sessions.push({ id: 'x:1', day: '2026-10-19', exercises: [] });
  const ok = await importBackupToDB(db, exportBackup(extra), { now: NOW });
  assert.equal(ok.ok, true);
  assert.equal((await db.getAll('snapshots')).length, 1);
  const { data } = await loadData(db);
  assert.equal(data.sessions.length, 3);
  assert.ok(!serializeBackup(data).includes('KEEPMEOUT'));
});

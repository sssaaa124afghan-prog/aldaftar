import { test } from 'node:test';
import assert from 'node:assert/strict';
import { migrateLegacy, runMigrationOnce, LEGACY_KEYS } from '../src/core/migrate.js';
import { createMemoryDB, loadData } from '../src/core/db.js';
import { nutriFixture, gymFixture } from './fixtures.js';

const NOW = new Date(2026, 9, 19, 10, 0);

function fakeStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    _m: m,
  };
}

test('NutriPro fields map to schema v1', () => {
  const { data, report } = migrateLegacy({ nutri: JSON.stringify(nutriFixture()) }, { now: NOW });
  assert.equal(report.ok, true);
  assert.equal(report.counts.meals, 3);
  assert.equal(report.counts.foodDays, 2);
  assert.equal(report.counts.foods, 4);
  assert.equal(report.counts.customFoods, 2); // u_whey, u_oats (f1, df_f2 are defaults)
  assert.equal(report.counts.savedMeals, 1);
  assert.deepEqual(Object.keys(data.foodLog).sort(), ['2026-10-17', '2026-10-18']);
  const egg = data.foodLog['2026-10-17'][0];
  assert.deepEqual(egg, { id: 'n:2026-10-17:0', name: 'بيض', qty: 4, unit: 'حبة', kcal: 280, p: 24, c: 2, f: 20, section: 'فطار', time: '08:10', src: 'nutri' });
  assert.equal(data.daily['2026-10-17'].waterMl, 1500); // 6 cups × 250
  assert.equal(data.foods.find((f) => f.id === 'u_whey').per, 1);
  assert.deepEqual(data.nutrition.dayTypeOverrides, { '2026-10-15': 'training' });
  assert.equal(data.nutrition.savedMeals.sm1.items[0].kcal, 280);
  assert.equal(data.settings.waterGoalCups, 10);
  assert.equal(data.settings.notifications.water, true);
  assert.equal(data.profile.age, 27);
  assert.equal(data.profile.birthYear, 1999);
  assert.equal(data.profile.heightCm, 173);
  assert.ok(report.dropped.nutri.includes('xp') && report.dropped.nutri.includes('profiles'));
  assert.ok(!('xp' in data) && !('game' in data));
  assert.ok(report.notes.some((n) => n.includes('UTC')));
  assert.ok(report.skipped.some((s) => s.what === 'log day' && s.id === 'not-a-date'));
  assert.ok(report.skipped.some((s) => s.what === 'meal'));
  // nothing lost: raw copy kept
  assert.ok(data.meta.legacyRaw[LEGACY_KEYS.nutri].includes('"xp":1234'));
});

test('Solo Gym fields map from RAW JSON, including the ones legacy loadD drops', () => {
  const { data, report } = migrateLegacy({ gym: JSON.stringify(gymFixture()) }, { now: NOW });
  assert.equal(report.ok, true);
  assert.equal(report.counts.sessions, 2);
  assert.equal(report.counts.sets, 7); // 3 + 3 + 1 (empty set not counted)
  const s1 = data.sessions[0];
  assert.equal(s1.id, 'g:1760650000000');
  assert.equal(s1.day, '2026-10-17'); // 21:30Z on the 16th = 01:30 Dubai on the 17th
  assert.equal(s1.exercises[0].sets.length, 3);
  assert.equal(data.training.deload.active, true);
  assert.equal(data.training.deload.start, '2026-10-13');
  assert.deepEqual(data.wellness.recoveryLog, [{ d: '2026-10-15' }]);
  assert.deepEqual(data.settings.trainingDays, [1, 2, 4, 5]);
  assert.equal(data.programs.activeProgram, 'ul');
  assert.equal(data.daily['2026-10-17'].waterMl, 3000);
  assert.deepEqual(data.daily['2026-10-17'].wellness, { sleep: 7, energy: 8, stress: 3 });
  assert.equal(data.chat[1].role, 'assistant');
  assert.equal(data.settings.soundOff, true);
  assert.equal(data.settings.notifications.workout, true);
  assert.equal(data.settings.ui.compact, true);
  // gamification-only fields dropped from data, kept in raw copy
  assert.ok(report.dropped.gym.includes('shadowArmy') && report.dropped.gym.includes('xp'));
  assert.ok(data.meta.legacyRaw[LEGACY_KEYS.gym].includes('Igris'));
  // privacy: employer/location not carried into the profile; obsolete keys redacted in raw copy
  assert.equal(data.profile.job, undefined);
  assert.equal(data.profile.location, undefined);
  assert.ok(!data.meta.legacyRaw[LEGACY_KEYS.gym].includes('gsk_abcdef'));
  assert.ok(!data.meta.legacyRaw[LEGACY_KEYS.gym].includes('AIzaSy'));
  assert.ok(!JSON.stringify(data).includes('gsk_abc'));
});

test('both sources: weights merged one per day, age conflict reported', () => {
  const { data, report } = migrateLegacy({ nutri: JSON.stringify(nutriFixture()), gym: JSON.stringify(gymFixture()) }, { now: NOW });
  assert.equal(report.counts.weights, 3);
  const w = Object.fromEntries(data.bodyweight.map((x) => [x.day, x]));
  assert.equal(w['2026-10-10'].kg, 75.4);
  assert.equal(w['2026-10-17'].kg, 74.6); // gym (timestamped, latest of the day) wins over NutriPro
  assert.equal(w['2026-10-19'].kg, 74.2); // 00:30 Dubai
  assert.deepEqual(report.conflicts.map((c) => c.field), ['age']);
  assert.equal(data.profile.age, 27);
  assert.equal(data.daily['2026-10-17'].waterMl, 3000); // max(6 cups=1500, 3 L)
  assert.equal(data.profile.name ?? '', '', 'name is never migrated (privacy)');
  assert.ok(!JSON.stringify(data.meta?.legacyRaw ?? '').includes('Test User'), 'raw copy has no name');
});

test('corrupted JSON: no data loss, raw copy kept, other source still migrates', () => {
  const good = JSON.stringify(gymFixture());
  const broken = JSON.stringify(nutriFixture()).slice(0, -5); // half-written save
  const { data, report } = migrateLegacy({ nutri: broken, gym: good }, { now: NOW });
  assert.equal(report.ok, false);
  assert.match(report.sources.nutri.error, /invalid_json/);
  assert.equal(report.sources.gym.parsed, true);
  assert.equal(data.meta.legacyRaw[LEGACY_KEYS.nutri], broken); // byte-for-byte
  assert.equal(report.counts.sessions, 2);
  assert.equal(data.meta.issues[0].source, 'nutri');
});

test('non-object JSON and empty input never throw', () => {
  assert.equal(migrateLegacy({ nutri: '42', gym: 'null' }).report.ok, false);
  const r = migrateLegacy({});
  assert.equal(r.report.ok, true);
  assert.equal(r.report.sources.nutri.present, false);
});

test('runMigrationOnce: reads keys, never deletes them, sets migratedAt, runs once', async () => {
  const nutri = JSON.stringify(nutriFixture());
  const gym = JSON.stringify(gymFixture());
  const storage = fakeStorage({ [LEGACY_KEYS.nutri]: nutri, [LEGACY_KEYS.gym]: gym, [LEGACY_KEYS.gymLastBackup]: '1760000000000', sgs_collapsed_cards: '["c1"]' });
  const db = createMemoryDB();
  const r1 = await runMigrationOnce(storage, db, { now: NOW });
  assert.equal(r1.status, 'migrated');
  assert.equal(r1.report.counts.sessions, 2);
  assert.equal(storage.getItem(LEGACY_KEYS.nutri), nutri);
  assert.equal(storage.getItem(LEGACY_KEYS.gym), gym);
  const { data } = await loadData(db);
  assert.equal(data.meta.migratedAt, NOW.toISOString());
  assert.equal(data.sessions.length, 2);
  assert.equal(Object.keys(data.foodLog).length, 2);
  assert.ok(data.meta.legacyRaw[LEGACY_KEYS.gym]);
  assert.deepEqual(data.settings.ui.collapsedCards, ['c1']);
  assert.ok(data.meta.legacyLastBackupAt);
  assert.equal(data.meta.lastBackupAt, null); // only a NEW-format backup sets this
  const r2 = await runMigrationOnce(storage, db, { now: NOW });
  assert.equal(r2.status, 'already');
});

test('runMigrationOnce with a corrupt key: partial, raw kept in DB, storage untouched', async () => {
  const broken = '{"ses":[{"id":1,"date":"2026-10-17T10:00:00Z"'; // truncated
  const storage = fakeStorage({ [LEGACY_KEYS.gym]: broken });
  const db = createMemoryDB();
  const r = await runMigrationOnce(storage, db, { now: NOW });
  assert.equal(r.status, 'partial');
  assert.equal(storage.getItem(LEGACY_KEYS.gym), broken);
  const { data } = await loadData(db);
  assert.equal(data.meta.legacyRaw[LEGACY_KEYS.gym], broken);
  assert.equal(data.sessions.length, 0);
});

test('runMigrationOnce merges into existing DB data instead of replacing it', async () => {
  const db = createMemoryDB();
  await db.batch([
    { store: 'meta', type: 'put', value: { key: 'meta', schema: 1, createdAt: NOW.toISOString(), migratedAt: null } },
    { store: 'sessions', type: 'put', value: { id: 'new:1', day: '2026-10-19', exercises: [] } },
  ]);
  const storage = fakeStorage({ [LEGACY_KEYS.gym]: JSON.stringify(gymFixture()) });
  await runMigrationOnce(storage, db, { now: NOW });
  const { data } = await loadData(db);
  assert.deepEqual(data.sessions.map((s) => s.id).sort(), ['g:1760650000000', 'g:1760736000000', 'new:1']);
});

test('runMigrationOnce: a storage that throws on read is reported, not fatal', async () => {
  const storage = { getItem() { throw new Error('SecurityError'); } };
  const r = await runMigrationOnce(storage, createMemoryDB(), { now: NOW });
  assert.equal(r.status, 'none');
  assert.ok(r.report.readErrors.length >= 2);
});

test('runMigrationOnce: a failing DB write returns error and does not touch storage', async () => {
  const nutri = JSON.stringify(nutriFixture());
  const storage = fakeStorage({ [LEGACY_KEYS.nutri]: nutri });
  const r = await runMigrationOnce(storage, createMemoryDB({ failWrites: true }), { now: NOW });
  assert.equal(r.status, 'error');
  assert.equal(r.error, 'quota');
  assert.equal(storage.getItem(LEGACY_KEYS.nutri), nutri);
});

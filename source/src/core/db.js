// Tiny IndexedDB wrapper (no library) + an in-memory adapter with the same API (tests, fallback).
// Rules: every storage call is wrapped; a read/parse failure NEVER triggers a write of defaults.

import { SCHEMA_VERSION, emptyData, clone, isObj } from './schema.js';

export const DB_NAME = 'fitness-companion';
export const DB_VERSION = 1; // IndexedDB version for schema v1

/** store name → keyPath */
export const STORES = Object.freeze({
  meta: 'key',         // 'meta', 'legacyRaw'
  settings: 'key',     // 'app', 'secrets' (secrets never exported)
  profile: 'key',      // 'me'
  kv: 'key',           // 'targets', 'training', 'nutrition', 'wellness'
  foods: 'id',
  foodLog: 'day',      // {day, entries:[]}
  sessions: 'id',      // index: day
  programs: 'key',     // 'current' {activeProgram, days, schedule}
  bodyweight: 'day',
  measurements: 'id',
  daily: 'day',        // {day, waterMl, wellness}
  chat: 'id',          // index: at
  snapshots: 'id',     // automatic pre-import snapshots (keep last 3)
});

export class StorageError extends Error {
  constructor(code, message, cause) { super(message || code); this.name = 'StorageError'; this.code = code; this.cause = cause; }
}

function wrapErr(e, fallback = 'tx_failed') {
  if (e instanceof StorageError) return e;
  const name = e && e.name;
  if (name === 'QuotaExceededError') return new StorageError('quota', 'storage full', e);
  if (name === 'VersionError') return new StorageError('version', 'database is newer than this app', e);
  return new StorageError(fallback, (e && e.message) || String(e), e);
}

/** JSON.parse that never throws. */
export function safeParseJSON(raw) {
  if (raw === null || raw === undefined) return { ok: false, value: null, error: 'empty' };
  try { return { ok: true, value: JSON.parse(raw), error: null }; }
  catch (e) { return { ok: false, value: null, error: (e && e.message) || 'parse error' }; }
}

/** Read a localStorage-like key without throwing. */
export function readStorageKey(storage, key) {
  try { return { raw: storage ? storage.getItem(key) : null, error: null }; }
  catch (e) { return { raw: null, error: (e && e.message) || 'storage error' }; }
}

// ───────────────────────── adapters ─────────────────────────

const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(wrapErr(r.error)); });

/** Open (and create/upgrade) the IndexedDB database. Resolves to an adapter. */
export function openDB({ name = DB_NAME, indexedDB = globalThis.indexedDB } = {}) {
  return new Promise((resolve, reject) => {
    if (!indexedDB) return reject(new StorageError('unavailable', 'IndexedDB not available'));
    let open;
    try { open = indexedDB.open(name, DB_VERSION); } catch (e) { return reject(wrapErr(e, 'unavailable')); }
    open.onupgradeneeded = () => {
      const idb = open.result;
      for (const [store, keyPath] of Object.entries(STORES)) {
        if (idb.objectStoreNames.contains(store)) continue;
        const os = idb.createObjectStore(store, { keyPath });
        if (store === 'sessions') os.createIndex('day', 'day');
        if (store === 'chat') os.createIndex('at', 'at');
      }
    };
    open.onblocked = () => reject(new StorageError('blocked', 'database upgrade blocked by another tab'));
    open.onerror = () => reject(wrapErr(open.error, 'unavailable'));
    open.onsuccess = () => resolve(idbAdapter(open.result));
  });
}

function idbAdapter(idb) {
  const run = async (stores, mode, fn) => {
    try {
      const tx = idb.transaction(stores, mode);
      const done = new Promise((res, rej) => {
        tx.oncomplete = () => res();
        tx.onerror = () => rej(wrapErr(tx.error));
        tx.onabort = () => rej(wrapErr(tx.error || new Error('aborted')));
      });
      done.catch(() => {}); // awaited below; avoid an unhandled rejection if fn throws first
      let out;
      try { out = await fn(tx); }
      catch (e) { try { tx.abort(); } catch { /* already finished */ } throw e; } // all-or-nothing

      await done;
      return out;
    } catch (e) { throw wrapErr(e); }
  };
  const check = (s) => { if (!STORES[s]) throw new StorageError('bad_store', `unknown store ${s}`); };
  return {
    kind: 'indexeddb',
    async get(store, key) { check(store); return run([store], 'readonly', (tx) => req(tx.objectStore(store).get(key))); },
    async getAll(store) { check(store); return run([store], 'readonly', (tx) => req(tx.objectStore(store).getAll())); },
    async count(store) { check(store); return run([store], 'readonly', (tx) => req(tx.objectStore(store).count())); },
    async put(store, value) { return this.batch([{ store, type: 'put', value }]); },
    async delete(store, key) { return this.batch([{ store, type: 'delete', key }]); },
    async clear(store) { return this.batch([{ store, type: 'clear' }]); },
    /** Atomic multi-store write: ops = [{store, type:'put'|'delete'|'clear', value?, key?}] */
    async batch(ops) {
      if (!ops.length) return;
      const stores = [...new Set(ops.map((o) => o.store))];
      stores.forEach(check);
      return run(stores, 'readwrite', (tx) => {
        for (const o of ops) {
          const os = tx.objectStore(o.store);
          if (o.type === 'put') os.put(o.value);
          else if (o.type === 'delete') os.delete(o.key);
          else if (o.type === 'clear') os.clear();
        }
      });
    },
    close() { try { idb.close(); } catch { /* ignore */ } },
  };
}

/** In-memory adapter with the same async API. Values are deep-cloned like IndexedDB does. */
export function createMemoryDB({ failWrites = false } = {}) {
  const data = Object.fromEntries(Object.keys(STORES).map((s) => [s, new Map()]));
  const check = (s) => { if (!STORES[s]) throw new StorageError('bad_store', `unknown store ${s}`); };
  return {
    kind: 'memory',
    _data: data,
    async get(store, key) { check(store); const v = data[store].get(key); return v === undefined ? undefined : structuredClone(v); },
    async getAll(store) { check(store); return [...data[store].values()].map((v) => structuredClone(v)); },
    async count(store) { check(store); return data[store].size; },
    async put(store, value) { return this.batch([{ store, type: 'put', value }]); },
    async delete(store, key) { return this.batch([{ store, type: 'delete', key }]); },
    async clear(store) { return this.batch([{ store, type: 'clear' }]); },
    async batch(ops) {
      if (failWrites) throw new StorageError('quota', 'storage full (simulated)');
      // stage on copies so the batch is all-or-nothing
      const staged = {};
      for (const o of ops) {
        check(o.store);
        const m = staged[o.store] || (staged[o.store] = new Map(data[o.store]));
        const kp = STORES[o.store];
        if (o.type === 'put') {
          if (!isObj(o.value) || o.value[kp] === undefined) throw new StorageError('bad_record', `record without ${kp} in ${o.store}`);
          m.set(o.value[kp], structuredClone(o.value));
        } else if (o.type === 'delete') m.delete(o.key);
        else if (o.type === 'clear') m.clear();
      }
      for (const [s, m] of Object.entries(staged)) data[s] = m;
    },
    close() {},
  };
}

// ───────────────────── data object ↔ stores ─────────────────────

/** Build the write ops for a data object. Secrets are never part of `data`. */
export function dataToOps(data, { replace = false } = {}) {
  const ops = [];
  const dataStores = ['meta', 'profile', 'kv', 'foods', 'foodLog', 'sessions', 'programs', 'bodyweight', 'measurements', 'daily', 'chat'];
  if (replace) dataStores.forEach((store) => ops.push({ store, type: 'clear' }));
  const { legacyRaw, ...meta } = data.meta || {};
  ops.push({ store: 'meta', type: 'put', value: { key: 'meta', ...clone(meta) } });
  if (legacyRaw && Object.keys(legacyRaw).length) ops.push({ store: 'meta', type: 'put', value: { key: 'legacyRaw', value: clone(legacyRaw) } });
  ops.push({ store: 'settings', type: 'put', value: { key: 'app', ...clone(data.settings || {}) } });
  ops.push({ store: 'profile', type: 'put', value: { key: 'me', ...clone(data.profile || {}) } });
  for (const k of ['targets', 'training', 'nutrition', 'wellness']) {
    if (data[k] !== undefined) ops.push({ store: 'kv', type: 'put', value: { key: k, value: clone(data[k]) } });
  }
  ops.push({ store: 'programs', type: 'put', value: { key: 'current', ...clone(data.programs || {}) } });
  for (const f of data.foods || []) ops.push({ store: 'foods', type: 'put', value: clone(f) });
  for (const [day, entries] of Object.entries(data.foodLog || {})) ops.push({ store: 'foodLog', type: 'put', value: { day, entries: clone(entries) } });
  for (const s of data.sessions || []) ops.push({ store: 'sessions', type: 'put', value: clone(s) });
  for (const w of data.bodyweight || []) ops.push({ store: 'bodyweight', type: 'put', value: clone(w) });
  for (const m of data.measurements || []) ops.push({ store: 'measurements', type: 'put', value: clone(m) });
  for (const [day, v] of Object.entries(data.daily || {})) ops.push({ store: 'daily', type: 'put', value: { day, ...clone(v) } });
  for (const c of data.chat || []) ops.push({ store: 'chat', type: 'put', value: clone(c) });
  return ops;
}

/** Persist a data object (upsert; `replace:true` clears data stores first, in the same transaction). */
export async function saveData(db, data, opts) {
  return db.batch(dataToOps(data, opts));
}

/**
 * Load the whole data object. Bad records are skipped and reported, never "repaired" by writing defaults.
 * Returns {data, issues, empty}.
 */
export async function loadData(db) {
  const data = emptyData();
  const issues = [];
  const all = async (store) => {
    try { return await db.getAll(store); }
    catch (e) { issues.push({ store, error: e.code || e.message }); return []; }
  };
  const good = (store, r, kp = STORES[store]) => {
    if (isObj(r) && r[kp] !== undefined) return true;
    issues.push({ store, error: 'bad_record' });
    return false;
  };
  const metaRecs = await all('meta');
  let empty = metaRecs.length === 0;
  for (const r of metaRecs) {
    if (!good('meta', r)) continue;
    if (r.key === 'meta') { const { key, ...m } = r; Object.assign(data.meta, m); }
    else if (r.key === 'legacyRaw') data.meta.legacyRaw = isObj(r.value) ? r.value : {};
  }
  for (const r of await all('settings')) if (good('settings', r) && r.key === 'app') { const { key, ...s } = r; Object.assign(data.settings, s); }
  for (const r of await all('profile')) if (good('profile', r) && r.key === 'me') { const { key, ...p } = r; Object.assign(data.profile, p); }
  for (const r of await all('kv')) if (good('kv', r) && ['targets', 'training', 'nutrition', 'wellness'].includes(r.key)) data[r.key] = r.value;
  for (const r of await all('programs')) if (good('programs', r) && r.key === 'current') { const { key, ...p } = r; data.programs = p; }
  data.foods = (await all('foods')).filter((r) => good('foods', r));
  for (const r of await all('foodLog')) if (good('foodLog', r)) data.foodLog[r.day] = Array.isArray(r.entries) ? r.entries : [];
  data.sessions = (await all('sessions')).filter((r) => good('sessions', r)).sort((a, b) => String(a.startedAt || a.day).localeCompare(String(b.startedAt || b.day)));
  data.bodyweight = (await all('bodyweight')).filter((r) => good('bodyweight', r)).sort((a, b) => a.day.localeCompare(b.day));
  data.measurements = (await all('measurements')).filter((r) => good('measurements', r));
  for (const r of await all('daily')) if (good('daily', r)) { const { day, ...v } = r; data.daily[day] = v; }
  data.chat = (await all('chat')).filter((r) => good('chat', r)).sort((a, b) => String(a.at || '').localeCompare(String(b.at || '')));
  if (data.meta.schema > SCHEMA_VERSION) issues.push({ store: 'meta', error: 'newer_schema' });
  return { data, issues, empty };
}

// ───────────────────── secrets (API key) ─────────────────────

export async function getSecret(db, name) {
  try { const r = await db.get('settings', 'secrets'); return (r && typeof r[name] === 'string') ? r[name] : ''; }
  catch { return ''; }
}

export async function setSecret(db, name, value) {
  const cur = (await db.get('settings', 'secrets').catch(() => null)) || { key: 'secrets' };
  if (value) cur[name] = String(value).trim(); else delete cur[name];
  return db.put('settings', cur);
}

// ───────────────────── snapshots (before import) ─────────────────────

export async function writeSnapshot(db, data, { keep = 3, now = new Date() } = {}) {
  const id = now.toISOString();
  const { legacyRaw, ...meta } = data.meta || {};
  await db.put('snapshots', { id, data: clone({ ...data, meta }) });
  const all = (await db.getAll('snapshots')).map((s) => s.id).sort();
  const extra = all.slice(0, Math.max(0, all.length - keep));
  if (extra.length) await db.batch(extra.map((key) => ({ store: 'snapshots', type: 'delete', key })));
  return id;
}

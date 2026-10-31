// iOS shell: one backup file a day, written when the app goes to the background (AutoBackup.swift keeps the last 14).
// Settings: 'backup.auto' (default on), 'backup.lastAuto' = {day, at, where, file}.
import { isNative, autoBackup } from '../core/native.js';
import { loadData } from '../core/db.js';
import { serializeBackup, backupFileName } from '../core/backup.js';

export const autoFileName = (now = new Date()) => backupFileName(now).replace('-backup-', '-auto-');

export async function runAutoBackup(ctx, { force = false } = {}) {
  if (!isNative() || (!force && ctx.settings.get('backup.auto') === false)) return null;
  const day = ctx.today();
  const last = ctx.settings.get('backup.lastAuto');
  if (!force && last && last.day === day) return last;
  const now = new Date();
  const { data } = await loadData(ctx.db);
  const res = await autoBackup(autoFileName(now), serializeBackup(data, { now }));
  if (!res || !res.ok) return null;
  const rec = { day, at: Date.now(), where: res.where, file: res.file };
  await ctx.settings.set('backup.lastAuto', rec);
  return rec;
}

export function initAutoBackup(ctx) {
  if (!isNative() || typeof document === 'undefined') return;
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') runAutoBackup(ctx).catch(() => {}); });
  setTimeout(() => runAutoBackup(ctx).catch(() => {}), 8000); // a day the app stays open still gets its file
}

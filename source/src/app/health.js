// iOS shell: watch data (Huawei Health › Apple Health › the «BD Health» shortcut › bardumbbell://health).
// The latest snapshot lives in settings 'health.snapshot'; 'health:changed' tells the screens.
import { isNative, onHealth, takeHealth } from '../core/native.js';
import { normalizeHealth } from './health-data.js';

export function initHealth(ctx) {
  if (!isNative()) return;
  const save = async (raw) => {
    const d = normalizeHealth(raw);
    if (!d) return;
    try { await ctx.settings.set('health.snapshot', d); } catch { /* best effort */ }
    ctx.emit('health:changed', d);
    try { ctx.toast('وصلت بيانات الساعة ✓'); } catch { /* ignore */ }
  };
  onHealth(save);
  const take = () => takeHealth().then((d) => d && save(d)).catch(() => {});
  take();
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') take(); });
}

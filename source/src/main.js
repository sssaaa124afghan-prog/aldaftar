import { initWidgets } from './app/widgets.js';
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import './styles/palettes.css';
import './styles/designs.css';
import { applyDesign } from './app/design.js';
import { openDB, createMemoryDB } from './core/db.js';
import { createCtx, toast } from './app/ctx.js';
import { startRouter, renderTabs, go, parseHash } from './app/router.js';
import { readMigrationGate } from './features/profile/migration.js';
import { setReduceMotion, setHaptics } from './ui/anim.js';
import { initAlerts, refreshWake } from './core/alerts.js';
import { initPush } from './core/push.js';

async function boot() {
  let db; let memory = false;
  try { db = await openDB(); } catch (e) { db = createMemoryDB(); memory = true; console.warn('[boot] IndexedDB unavailable, using memory', e && e.code); }
  const ctx = await createCtx(db, { go });
  const applyLook = () => applyDesign(ctx.settings.get('design'), ctx.settings.get('palette'));
  applyLook();
  // Profile › المظهر: «قلّل الحركة» (default off; the OS setting applies on its own) and «اهتزاز خفيف» (default on)
  const applyFeel = () => { setReduceMotion(ctx.settings.get('ui.reduceMotion') === true); setHaptics(ctx.settings.get('ui.haptics') !== false); };
  applyFeel();
  initWidgets(ctx); // iOS shell: home / lock-screen widgets (app/widgets.js)
  initAlerts(ctx.settings); // first tap anywhere unlocks WebAudio / <audio> (iOS); see core/alerts.js
  initPush(ctx); // lock-screen alert via the push Worker (Profile › «تنبيه والشاشة مقفولة»); no-op until enabled
  // a notification tap while the app is already open: the SW focuses this window and asks it to go to the screen
  if (navigator.serviceWorker) navigator.serviceWorker.addEventListener('message', (e) => {
    const d = e.data;
    if (d && d.type === 'open' && typeof d.url === 'string' && /^#\/[\w/-]*$/.test(d.url) && location.hash !== d.url) location.hash = d.url;
  });
  ctx.on('settings:changed', ({ key }) => { if (key === 'palette' || key === 'design') applyLook(); if (key === 'ui.reduceMotion' || key === 'ui.haptics') applyFeel(); if (key === 'wk.wakeLock') refreshWake(); });
  window.__ctx = import.meta.env.DEV ? ctx : undefined;
  const view = document.getElementById('view');
  const nav = document.getElementById('tabs');
  renderTabs(nav);
  // First run: show the migration confirmation (legacy apps on this origin) before anything else.
  if (!memory && parseHash().route !== 'profile/migrate' && (await readMigrationGate(db)) === 'pending') {
    history.replaceState(null, '', '#/profile/migrate');
  }
  startRouter({ view, nav, ctx });
  if (memory) toast('التخزين على الجهاز مش متاح — البيانات مش هتتحفظ بعد ما تقفل.');
  registerSW();
}

// Design + palette: src/app/design.js (Profile › المظهر). index.html applies the cached choice before first paint.

function registerSW() {
  if (!('serviceWorker' in navigator) || import.meta.env.DEV || location.protocol === 'file:') return;
  const reg = () => {
    // a new worker takes control (skipWaiting) → reload once into the new release
    const hadController = !!navigator.serviceWorker.controller;
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || reloaded) return;
      reloaded = true;
      if (/\/session/.test(location.hash)) { toast('فيه نسخة أحدث — هتتحدّث لما تقفل الحصة.', { ms: 6000 }); return; }
      location.reload();
    });
    navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).then((reg) => {
      if (reg.waiting) reg.waiting.postMessage('skipWaiting');
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        w && w.addEventListener('statechange', () => {
          if (w.state === 'installed' && navigator.serviceWorker.controller) w.postMessage('skipWaiting');
        });
      });
      // iOS keeps the home-screen app alive: look for a release every time it comes back to the front
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
    }).catch((e) => console.warn('[sw] register failed', e && e.message));
  };
  if (document.readyState === 'complete') reg(); else window.addEventListener('load', reg, { once: true });
}

boot();

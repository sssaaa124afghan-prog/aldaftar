import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import './styles/palettes.css';
import { openDB, createMemoryDB } from './core/db.js';
import { createCtx, toast } from './app/ctx.js';
import { startRouter, renderTabs, go, parseHash } from './app/router.js';
import { readMigrationGate } from './features/profile/migration.js';

async function boot() {
  let db; let memory = false;
  try { db = await openDB(); } catch (e) { db = createMemoryDB(); memory = true; console.warn('[boot] IndexedDB unavailable, using memory', e && e.code); }
  const ctx = await createCtx(db, { go });
  applyPalette(ctx.settings.get('palette'));
  ctx.on('settings:changed', ({ key }) => { if (key === 'palette') applyPalette(ctx.settings.get('palette')); });
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

// Optional colour palette (Profile → «ألوان البرنامج»). Unset/unknown = the default Electric Glass Pro look.
const PALETTE_BG = { emerald: '#03121A', ember: '#09090B', ocean: '#020A1C', sand: '#0D0906', aurora: '#090B0E' };
function applyPalette(id) {
  const root = document.documentElement;
  if (PALETTE_BG[id]) root.dataset.palette = id; else delete root.dataset.palette;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = PALETTE_BG[id] || '#0D0B2E';
}

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

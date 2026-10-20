// Hash router: #/<route>?k=v. Feature modules are lazy chunks found by glob (missing ones → quiet placeholder).
import { h, raw } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { needsOnboarding, markOnboardingSeen } from './onboarding-gate.js';
import { runTargetsMigration } from '../core/targets.js';

const loaders = import.meta.glob('../features/*/index.js');
const mods = new Map();

export const TABS = [
  { key: 'today', label: 'اليوم', icon: 'home' },
  { key: 'workout', label: 'التمرين', icon: 'dumbbell' },
  { key: 'nutrition', label: 'التغذية', icon: 'food' },
  { key: 'progress', label: 'التقدّم', icon: 'chart' },
  { key: 'profile', label: 'الملف', icon: 'user' },
];

export function parseHash(hash = location.hash) {
  const s = hash.replace(/^#\/?/, '');
  const [path, query = ''] = s.split('?');
  const params = Object.fromEntries(new URLSearchParams(query));
  return { route: path.replace(/\/+$/, '') || 'today', params };
}

export function href(route, params) {
  const q = params && Object.keys(params).length ? '?' + new URLSearchParams(params).toString() : '';
  return `#/${route}${q}`;
}

export function go(route, params) {
  const next = href(route, params);
  if (location.hash === next) window.dispatchEvent(new HashChangeEvent('hashchange'));
  else location.hash = next;
}

async function loadFeature(name) {
  if (mods.has(name)) return mods.get(name);
  const key = `../features/${name}/index.js`;
  if (!loaders[key]) return null;
  const m = await loaders[key]();
  mods.set(name, m);
  return m;
}

export function renderTabs(nav) {
  nav.textContent = '';
  for (const t of TABS) nav.appendChild(h('a', { href: href(t.key), dataset: { tab: t.key } }, raw(icon(t.icon)), t.label));
}

function markTab(nav, feature) {
  const ti = TABS.findIndex((t) => t.key === feature);
  nav.style.setProperty('--ti', String(Math.max(0, ti)));
  nav.dataset.ti = String(ti);
  for (const a of nav.querySelectorAll('a')) {
    if (a.dataset.tab === feature) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
}

/** startRouter({view, nav, getCtx}) — renders on every hash change. */
export function startRouter({ view, nav, ctx }) {
  let cleanup = null; let seq = 0; let first = true; let lastRoute = null;
  // targets v2 (lean-gain defaults 2850/2550/2350, height 175): once per install, no-op afterwards
  runTargetsMigration(ctx.db).then((r) => {
    if (!r) return;
    if (r.changed) ctx.emit('settings:changed', { key: 'targets' });
    if (r.toast) ctx.toast(r.toast, { ms: 8000 });
  }).catch((e) => console.warn('[boot] targets migration failed', e && e.message));
  async function render() {
    const my = ++seq;
    const cur = parseHash().route;
    if (lastRoute !== null && cur !== lastRoute) window.dispatchEvent(new CustomEvent('app:route-leave', { detail: { route: cur } })); // close open sheets
    lastRoute = cur;
    if (seq > 1) { const th = document.querySelector('.toast-host'); if (th && Date.now() - Number(th.dataset.t || 0) > 1500) th.textContent = ''; }
    let { route, params } = parseHash();
    // fresh install → first-run onboarding instead of Today (home-screen shortcuts with ?quick=1 go straight to their action)
    if (route === 'today' && !params.quick && await needsOnboarding(ctx)) {
      if (my !== seq) return;
      markOnboardingSeen(ctx);
      history.replaceState(null, '', '#/profile/welcome');
      route = 'profile/welcome'; params = {}; lastRoute = route;
    }
    const feature = route.split('/')[0];
    markTab(nav, feature);
    let fn = null;
    try {
      const m = await loadFeature(feature);
      if (m && m.routes) fn = m.routes[route] || (route === feature ? null : null) || m.routes[feature];
    } catch (e) {
      console.warn('[router] feature failed to load', feature, e && e.message);
    }
    if (my !== seq) return;
    if (typeof cleanup === 'function') { try { cleanup(); } catch { /* ignore */ } }
    cleanup = null;
    view.textContent = '';
    // enter animation: #view keeps .route-in; CSS animations start on the freshly inserted children,
    // so no class restart and no forced reflow (was `void view.offsetWidth`, 149 ms in Lighthouse).
    view.classList.add('route-in');
    view.dataset.route = route;
    if (!fn) {
      const tab = TABS.find((t) => t.key === feature);
      view.appendChild(h('header', { class: 'band' }, h('div', { class: 'grow' }, h('h1', {}, tab ? tab.label : 'الصفحة دي مش موجودة'))));
      view.appendChild(h('p', { class: 'placeholder' }, tab ? 'الجزء ده لسه بيتجهّز.' : 'ارجع لشاشة اليوم.'));
    } else {
      try { cleanup = await fn(view, ctx, params); }
      catch (e) {
        console.warn('[router] render failed', route, e);
        view.appendChild(h('p', { class: 'placeholder' }, 'حصلت مشكلة في عرض الشاشة دي. بياناتك محفوظة.'));
      }
    }
    syncCoachFab(route, ctx);
    if (!first) { window.scrollTo(0, 0); view.focus({ preventScroll: true }); }
    first = false;
  }
  window.addEventListener('hashchange', render);
  render();
  return { render };
}

// Floating «اسأل المدرب» button on every main screen (hidden where it would clash: live session, coach, migration).
let fab = null;
function syncCoachFab(route, ctx) {
  const hide = /^(coach|nutrition\/coach|workout\/session|workout\/recovery|profile\/migrate|profile\/welcome)/.test(route);
  if (!fab) {
    fab = h('button', { type: 'button', class: 'coach-fab', 'aria-label': 'اسأل المدرب', title: 'اسأل المدرب' });
    fab.innerHTML = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M8 9h8M8 13h5"/></svg><span>المدرب</span>';
    fab.addEventListener('click', () => import('../features/coach/api.js').then((a) => a.openCoachSheet(fab._ctx, { intent: 'chat' })).catch(() => { location.hash = '#/coach'; }));
    document.body.appendChild(fab);
  }
  fab._ctx = ctx;
  fab.hidden = hide;
  document.documentElement.classList.toggle('has-fab', !hide);
}

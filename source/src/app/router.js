// Hash router: #/<route>?k=v. Feature modules are lazy chunks found by glob (missing ones → quiet placeholder).
import { h, raw } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { needsOnboarding, markOnboardingSeen } from './onboarding-gate.js';
import { runTargetsMigration } from '../core/targets.js';
import { pinTrainingDays } from '../core/schema.js';
import { navDir, keyboardOpen, motionOK, revealBelowFold } from '../ui/motion.js';

const loaders = import.meta.glob('../features/*/index.js');
const mods = new Map();

export const TABS = [
  { key: 'today', label: 'اليوم', icon: 'home' },
  { key: 'workout', label: 'التمرين', icon: 'dumbbell' },
  { key: 'nutrition', label: 'الأكل', icon: 'food' },
  { key: 'progress', label: 'التقدّم', icon: 'chart' },
  { key: 'coach', label: 'المدرب', icon: 'msg' },
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

// Profile lives in Today's ⋯ menu (#/profile still works), so it lights the Today tab.
const TAB_OF = { profile: 'today' };
function markTab(nav, feature) {
  feature = TAB_OF[feature] || feature;
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
  // training-days default moved to plan v3: pin the old days for installs that never saved them and still run an older layout
  // (the first render waits for it, so Today never shows a day type from the wrong layout)
  const pinReady = ctx.settings && typeof ctx.settings.has === 'function' && !ctx.settings.has('trainingDays')
    ? Promise.resolve().then(() => ctx.db.get('programs', 'current')).then((rec) => {
      const pin = pinTrainingDays(rec);
      return pin ? ctx.settings.set('trainingDays', pin) : null;
    }).catch((e) => console.warn('[boot] training days pin failed', e && e.message))
    : null;
  async function render() {
    if (pinReady) await pinReady;
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
    const prev = view.dataset.route || null;
    let fn = null;
    try {
      const m = await loadFeature(feature);
      if (m && m.routes) fn = m.routes[route] || m.routes[feature];
    } catch (e) {
      console.warn('[router] feature failed to load', feature, e && e.message);
    }
    if (my !== seq) return;
    // directional motion: new view slides in from the side it lives on (tabs) or from the inline-end (push)
    const rtl = document.documentElement.dir !== 'ltr';
    const dir = !first && motionOK() && !keyboardOpen() ? navDir(prev, route, TABS.map((t) => t.key), rtl) : null;
    const swap = async () => {
      markTab(nav, feature);
      if (typeof cleanup === 'function') { try { cleanup(); } catch { /* ignore */ } }
      cleanup = null;
      view.textContent = '';
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
      syncChrome(route);
      if (!first) { window.scrollTo(0, 0); view.focus({ preventScroll: true }); }
    };
    if (dir) await transition(view, dir, swap, my);
    else await swap();
    first = false;
    if (my === seq) revealBelowFold(view);
  }
  window.addEventListener('hashchange', render);
  render();
  return { render };
}

// View Transitions API when present (Chromium, iOS 18+ Safari); otherwise a CSS class on #view's children.
// The tab bar and the coach button get their own transition names with no animation, so they stay still.
let vtSeq = 0;
async function transition(view, dir, swap) {
  const root = document.documentElement;
  const n = ++vtSeq;
  root.dataset.nav = dir;
  root.toggleAttribute('data-nav-scrolled', window.scrollY > 8); // old snapshot would show the wrong part of a scrolled page
  const done = () => { if (n === vtSeq) { delete root.dataset.nav; root.removeAttribute('data-nav-scrolled'); } };
  if (typeof document.startViewTransition === 'function') {
    let vt;
    try { vt = document.startViewTransition(swap); } catch { await swap(); done(); return; }
    vt.ready.catch(() => {});
    vt.finished.catch(() => {}).finally(done);
    await vt.updateCallbackDone.catch(() => {});
    return;
  }
  await swap();
  view.classList.remove('nav-in'); void view.offsetWidth; // restart (one reflow, only on navigation)
  view.classList.add('nav-in');
  setTimeout(() => { if (n === vtSeq) view.classList.remove('nav-in'); done(); }, 420);
}

// Live, full-screen routes hide the tab bar (session has its own dock; boxing is gloves-on). The coach is a tab now: no floating button.
function syncChrome(route) {
  document.documentElement.classList.toggle('immersive', /^workout\/(session|boxing)/.test(route));
}

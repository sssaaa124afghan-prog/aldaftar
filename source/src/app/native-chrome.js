// iOS shell: the tab bar is the system's own (NativeTabBar.swift, Liquid Glass on iOS 26+). The web bar is hidden and
// this module keeps the shell in step: which tab is current, and when the bar must get out of the way
// (session / boxing, onboarding, an open sheet or overlay, the keyboard).
import { isNative, post } from '../core/native.js';

/** Height the native bar covers at the bottom (bar + gap), for toasts. */
export const NATIVE_BAR_INSET = 92;

const COVER = '.scrim, .wk-rf, .vid-sheet';

export function chromeState(root, nav, { typing = false } = {}) {
  const cur = nav && nav.querySelector('a[aria-current]');
  const cl = root.classList;
  const covered = cl.contains('immersive') || cl.contains('ob-on') || typing || !!root.ownerDocument.querySelector(COVER);
  return { tab: cur ? cur.dataset.tab || '' : '', bar: !covered, scheme: root.style.colorScheme === 'light' ? 'light' : 'dark', design: root.dataset.design || '' };
}

export function initNativeChrome() {
  if (!isNative() || typeof document === 'undefined') return;
  const root = document.documentElement;
  const nav = document.getElementById('tabs');
  root.classList.add('native-tabs');
  let last = ''; let typing = false; let queued = false;
  const sync = () => {
    queued = false;
    const st = chromeState(root, nav, { typing });
    const key = JSON.stringify(st);
    if (key === last) return;
    last = key;
    post('chrome', st);
  };
  const soon = () => { if (!queued) { queued = true; requestAnimationFrame(sync); } };
  if (nav) new MutationObserver(soon).observe(nav, { attributes: true, subtree: true, attributeFilter: ['aria-current'] });
  new MutationObserver(soon).observe(root, { attributes: true, attributeFilter: ['class', 'data-design', 'style'] });
  new MutationObserver(soon).observe(document.body, { childList: true }); // sheets and overlays are body children
  const isField = (t) => t && (t.tagName === 'TEXTAREA' || t.isContentEditable || (t.tagName === 'INPUT' && !/^(checkbox|radio|range|button|submit|file|color)$/.test(t.type)));
  document.addEventListener('focusin', (e) => { if (isField(e.target)) { typing = true; soon(); } });
  document.addEventListener('focusout', () => { setTimeout(() => { typing = isField(document.activeElement); soon(); }, 60); });
  sync();
}

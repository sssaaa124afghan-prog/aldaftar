// App design layer: <html data-design="a|b|c|classic">. A/B/C are the council directions (src/styles/designs.css);
// «classic» is Electric Glass Pro with its 10 palettes (palettes.css). Default = E «ألوان اليوم» (light, the palette follows the day: src/app/tone.js); D «مدار» was the default in 1.10, B before.
// The choice lives in settings ('design') and is mirrored to localStorage so index.html can set it before first paint.
// Fonts: each design's subset woff2 files are inlined as data URLs in their own lazy chunk and registered with the
// FontFace API only when that design is active (font-display: swap, nothing waits on them).

import { TONE_BG } from './tone-data.js';

export const DESIGNS = [
  { id: 'e', name: 'ألوان اليوم', en: 'Day Colours', desc: 'فاتح ومبهج، واللون بيتغيّر لوحده مع يومك: لكل تمرين لون، والملاكمة ناري، والراحة ذهبي', bg: '#F6F7FB', scheme: 'light' },
  { id: 'd', name: 'مدار', en: 'Orbit', desc: 'أرضية فضاء غامقة بإضاءة باردة، دواير منوّرة وأرقام كبيرة، والبرتقالي للحاجة اللي تعملها دلوقتي', bg: '#05070C', scheme: 'dark' },
  { id: 'b', name: 'فولاذ وإشارة', en: 'Steel & Signal', desc: 'رمادي فولاذي وأزرق كوبالت، والبرتقالي للحاجة اللي تعملها دلوقتي بس', bg: '#1B2128', scheme: 'dark' },
  { id: 'a', name: 'جلسة الليل', en: 'Night Session', desc: 'أسود هادي وأزرق كهربائي واحد، أرقام كبيرة وجداول أكثف', bg: '#0B0D10', scheme: 'dark' },
  { id: 'c', name: 'نهار رياضي', en: 'Daylight Athletic', desc: 'أرضية فاتحة وحبر كحلي وعناوين ضخمة، والأزرق للحركة', bg: '#EDF0F4', scheme: 'light' },
];
export const CLASSIC = { id: 'classic', name: 'الكلاسيكي', en: 'Electric Glass Pro', desc: 'التصميم القديم الزجاجي مع الـ10 ألوان بتاعته', bg: '#0D0B2E', scheme: 'dark' };
export const DEFAULT_DESIGN = 'e';
const IDS = new Set(['a', 'b', 'c', 'd', 'e', 'classic']);
export const designId = (v) => (IDS.has(v) ? v : DEFAULT_DESIGN);
export const designOf = (id) => DESIGNS.find((d) => d.id === id) || (id === 'classic' ? CLASSIC : DESIGNS[0]);

// classic palettes keep their own ground colour for the status bar
const PALETTE_BG = { emerald: '#03121A', ember: '#09090B', ocean: '#020A1C', sand: '#0D0906', aurora: '#090B0E', steel: '#0E1116', navy: '#060C1A', racing: '#0B0C0F', tactical: '#0C0E09' };

const FONTS = { a: () => import('./fonts-a.js'), b: () => import('./fonts-b.js'), c: () => import('./fonts-c.js'), d: () => import('./fonts-b.js'), e: () => import('./fonts-b.js') }; // D and E use B's numerals
const loaded = new Set();
function loadFonts(id) {
  if (!FONTS[id] || loaded.has(id) || typeof FontFace !== 'function' || !document.fonts) return;
  loaded.add(id);
  FONTS[id]().then((m) => {
    for (const f of m.FACES) {
      try { document.fonts.add(new FontFace(f.family, `url(${f.src}) format("woff2")`, { weight: f.weight, unicodeRange: f.range, display: 'swap' })); } catch { /* skip one face */ }
    }
  }).catch(() => { loaded.delete(id); });
}

/** Register every design's fonts (the Profile picker previews all three in their own type). */
export function preloadDesignFonts() { for (const id of Object.keys(FONTS)) loadFonts(id); }

/** Apply a design (and, for classic, its palette) to <html>. Instant; safe to call repeatedly. */
export function applyDesign(id, palette) {
  const d = designOf(designId(id));
  const root = document.documentElement;
  root.dataset.design = d.id;
  root.classList.toggle('nd', d.id !== 'classic');
  if (d.id === 'classic' && PALETTE_BG[palette]) root.dataset.palette = palette; else delete root.dataset.palette;
  const tone = d.id === 'e' ? TONE_BG[root.dataset.tone] : null; // «ألوان اليوم»: the ground is the day's colour (tone.js keeps it in step)
  const bg = d.id === 'classic' ? (PALETTE_BG[palette] || d.bg) : tone || d.bg;
  root.style.background = bg;
  root.style.colorScheme = d.scheme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = bg;
  const cs = document.querySelector('meta[name="color-scheme"]');
  if (cs) cs.content = d.scheme;
  try { localStorage.setItem('ui.design', d.id); localStorage.setItem('ui.palette', palette || ''); } catch { /* private mode */ }
  loadFonts(d.id);
  return d;
}

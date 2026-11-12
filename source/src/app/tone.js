// «ألوان اليوم»: the palette follows today's plan (html[data-tone], styles in designs.css › E).
// Cached in localStorage so index.html paints the right colour before the app boots.
import { todayPlan } from '../features/workout/today-plan.js';
import { loadProgram } from '../features/workout/store.js';
import { toneFor, TONE_BG, TONES } from './tone-data.js';

function paint(tone, day) {
  const root = document.documentElement;
  if (!TONES.includes(tone)) return;
  if (root.dataset.tone !== tone) root.dataset.tone = tone;
  try { localStorage.setItem('ui.tone', tone); localStorage.setItem('ui.toneDay', day); } catch { /* private mode */ }
  if (root.dataset.design === 'e') {
    root.style.background = TONE_BG[tone];
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = TONE_BG[tone];
  }
}

export async function syncTone(ctx) {
  const day = ctx.today();
  const [plan, prog] = await Promise.all([todayPlan(ctx, day).catch(() => null), loadProgram(ctx.db).catch(() => null)]);
  const tone = toneFor(plan, prog && prog.program ? prog.program.order : []);
  paint(tone, day);
  return tone;
}

export function initTone(ctx) {
  if (typeof document === 'undefined') return;
  let t = 0;
  const run = () => { clearTimeout(t); t = 0; syncTone(ctx).catch(() => {}); };
  const soon = () => { clearTimeout(t); t = setTimeout(run, 300); };
  for (const ev of ['session:changed', 'settings:changed']) ctx.on(ev, soon);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') soon(); }); // a new day
  run();
}

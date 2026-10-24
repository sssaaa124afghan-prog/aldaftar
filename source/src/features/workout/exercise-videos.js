// «فيديو الأداء»: one short proper-form video per exercise of the active plan (ul4c v2) plus the Heart Day wall sit
// and the pelvic floor routine, curated from coaching channels (Jeff Nippard, Renaissance Periodization, Scott Herman,
// Squat University, Max Euceda, John Jewett, T-Nation, E3 Rehab, Michelle Kenway).
// Each entry was checked on VERIFIED with YouTube oEmbed (public, exists; title + channel copied from the response).
// Everything else gets a YouTube search link. Links only: no iframes, nothing loads until the owner taps.
// To re-check every id:  node scripts/check-videos.mjs
import { h, ico } from './view.js';
import { libById, findLib } from './exercises.js';

export const VERIFIED = '2026-10-24';
const v = (id, channel, title, dur) => Object.freeze({ id, channel, title, dur, verified: VERIFIED });

/** key (library id, or 'wallsit' / 'kegel') -> { id, channel, title, dur ('short' = YouTube Short), verified } */
export const VIDEOS = Object.freeze({
  "ex1": v("hWbUlkb5Ms4", "Jeff Nippard", "How To Bench Press With Perfect Technique (5 Steps)", "short"),
  "ex14": v("SqQxuEpXnF4", "Jeff Nippard", "Do You Have A Perfect Lat Pulldown? (Find Out)", "short"),
  "ex2": v("8iPEnn-ltC8", "ScottHermanFitness", "How To: Dumbbell Incline Chest Press", "2:43"),
  "exCSTB": v("Si5st8LOGnQ", "John Jewett", "Huge Upper Back | Chest Supported T-Bar Row Tip", "short"),
  "ex27": v("lq7eLC30b9w", "Renaissance Periodization", "Leaning Cable Lateral Raise", "0:10"),
  "exOCT": v("1u18yJELsh0", "Renaissance Periodization", "Cable Overhead Triceps Extension", "0:12"),
  "ex31": v("HhHHBj3qTJ4", "Max Euceda", "How to do the INCLINE DUMBBELL CURL! | 2 Minute Tutorial", "2:00"),
  "exRPD": v("5YK4bgzXDp0", "Renaissance Periodization", "Machine Reverse Flye", "0:14"),
  "ex64": v("YgIf-8yklUA", "Squat University", "Ab Wheel Roll-Out: Correct Form Mistakes!", "short"),
  "ex41": v("PPmvh7gBTi0", "Jeff Nippard", "Do You Have A Perfect Squat? (Find Out)", "short"),
  "ex23": v("-jFT4qHUXVw", "Renaissance Periodization", "PERFECTING your LATERAL RAISE", "short"),
  "ex48": v("Orxowest56U", "Renaissance Periodization", "Seated Leg Curl", "0:11"),
  "ex44": v("ztNBgrGy6FQ", "Jeff Nippard", "A Better Way To Do Leg Extensions", "short"),
  "exMHT": v("ZSPmIyX9RZs", "Renaissance Periodization", "Machine Hip Thrust", "0:11"),
  "ex65": v("7FwGZ8qY5OU", "Renaissance Periodization", "Hanging Straight Leg Raise", "0:09"),
  "ex51": v("N3awlEyTY98", "Renaissance Periodization", "Calf Machine", "0:12"),
  "ex81": v("qMtmHwaCmYI", "ScottHermanFitness", "How To: Seated Wrist Curl", "1:12"),
  "exRWC": v("FW7URAaC-vE", "ScottHermanFitness", "How To: Reverse Seated Wrist Curl", "1:14"),
  "exLID": v("B09ZkYsnKko", "Renaissance Periodization", "Low Incline Dumbbell Press", "0:12"),
  "ex22": v("qEwKCR5JCog", "ScottHermanFitness", "How To: Dumbbell Shoulder Press", "2:24"),
  "ex15": v("vwHG9Jfu4sw", "Max Euceda", "How to do the SEATED CABLE ROW! | 2 Minute Tutorial", "2:00"),
  "ex24": v("rep-qVOkqgk", "ScottHermanFitness", "How To: Face Pull", "2:43"),
  "exWCH": v("A5Y7XhrAwJM", "Testosterone Nation", "High to Low Cable Chop", "0:10"),
  "ex32": v("Ja6ZlIDONac", "Renaissance Periodization", "Machine Preacher Curl", "0:17"),
  "exROE": v("kqidUIf1eJE", "Renaissance Periodization", "Rope Overhead Triceps Extension", "0:13"),
  "ex47": v("d-hn_0sEpRQ", "Squat University", "How to Romanian Deadlift (RDL) WITHOUT Back Pain", "short"),
  "ex45b": v("rYgNArpwE7E", "Renaissance Periodization", "Hack Squat", "0:14"),
  "ex42": v("bwhl_9jN_3o", "Squat University", "The BEST Bulgarian Split Squat Tutorial", "short"),
  "ex62": v("x10ihjIYy8s", "ScottHermanFitness", "POV: Cable Ab Crunch Never Feels Right (60sec FIX)", "short"),
  "exADD": v("GmRSV_n2E_0", "ScottHermanFitness", "How To: Hip Adduction (Cybex)", "2:19"),
  "ex72": v("cJRVVxmytaM", "ScottHermanFitness", "How To: Dumbbell Shrugs", "1:42"),
  "wallsit": v("RG7z0P9qrLk", "E3 Rehab Exercise Library", "Wall Sit", "0:11"),
  "kegel": v("MJ7EfGu03-0", "Michelle Kenway", "Kegel Exercises for Men - Beginners Pelvic Floor Strengthening Guide", "6:35"),
});

const YT = 'https://www.youtube.com/';
export const watchUrl = (id) => `${YT}watch?v=${id}`;
export const searchUrl = (en) => `${YT}results?search_query=${encodeURIComponent(`${String(en || '').trim()} proper form`)}`;

function libOf(ex) {
  if (!ex) return null;
  if (typeof ex === 'string') return libById(ex) || findLib(ex);
  return (ex.lib && libById(ex.lib)) || (ex.id && libById(ex.id)) || findLib(ex.en || ex.name || ex.ar) || null;
}

/**
 * Any exercise-like value (library entry, plan item, session exercise, library id, or 'wallsit' / 'kegel')
 * -> { kind: 'video', url, id, channel, title, dur } | { kind: 'search', url, q } | null (no name at all).
 */
export function videoFor(ex) {
  if (typeof ex === 'string' && VIDEOS[ex]) { const c = VIDEOS[ex]; return { kind: 'video', url: watchUrl(c.id), ...c }; }
  const L = libOf(ex);
  const c = L && VIDEOS[L.id];
  if (c) return { kind: 'video', url: watchUrl(c.id), ...c };
  const en = (L && L.en) || (ex && typeof ex === 'object' && (ex.en || ex.name || ex.ar)) || (typeof ex === 'string' ? ex : '');
  const q = String(en).split('·')[0].trim();
  return q ? { kind: 'search', url: searchUrl(q), q } : null;
}

/** Short source line: the channel, or «بحث يوتيوب» for a search link. */
export const videoSource = (ex) => { const r = videoFor(ex); return !r ? '' : r.kind === 'video' ? r.channel : 'بحث يوتيوب'; };

/**
 * ▶ link that opens YouTube in a new tab (the YouTube app on iPhone). ≥ 44 px tap target.
 *  variant 'pill' (default): ▶ «فيديو الأداء» + channel · search: ▶ «دوّر على يوتيوب».
 *  variant 'icon': ▶ only (rows); show videoSource() next to it as the small text.
 */
export function videoLink(ex, { name = '', variant = 'pill', cls = '' } = {}) {
  const r = videoFor(ex);
  if (!r) return null;
  const nm = name || (typeof ex === 'object' && ex && (ex.ar || ex.name)) || '';
  const label = `فيديو الأداء: ${nm}${r.kind === 'search' ? ' · دوّر على يوتيوب' : ` · ${r.channel}`}`;
  const a = { class: `wk-vid${variant === 'icon' ? ' is-icon' : ''}${r.kind === 'search' ? ' is-search' : ''}${cls ? ' ' + cls : ''}`, href: r.url,
    target: '_blank', rel: 'noopener', 'aria-label': label, title: r.kind === 'video' ? `${r.title} · ${r.channel}` : null,
    onclick: (ev) => ev.stopPropagation() };
  if (variant === 'icon') return h('a', a, ico('play'));
  return h('a', a, ico('play'), h('span', {}, r.kind === 'video' ? 'فيديو الأداء' : 'دوّر على يوتيوب'),
    r.kind === 'video' ? h('small', { dir: 'ltr' }, r.channel) : null);
}

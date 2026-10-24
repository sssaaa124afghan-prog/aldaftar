// Re-checks every curated «فيديو الأداء» id with YouTube oEmbed (exists + public) and prints title/channel drift.
// node scripts/check-videos.mjs   (needs network; not part of npm test)
import { VIDEOS } from '../src/features/workout/exercise-videos.js';

let bad = 0;
for (const [k, c] of Object.entries(VIDEOS)) {
  const u = `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${c.id}`)}&format=json`;
  let o = null, st = 0;
  try { const r = await fetch(u); st = r.status; if (r.ok) o = await r.json(); } catch (e) { st = String(e.message || e); }
  if (!o) { bad++; console.log(`FAIL ${k} ${c.id} ${st}`); continue; }
  const drift = o.author_name !== c.channel ? ` (channel now: ${o.author_name})` : '';
  console.log(`ok   ${k} ${c.id} · ${o.author_name} · ${o.title}${drift}`);
}
process.exitCode = bad ? 1 : 0;

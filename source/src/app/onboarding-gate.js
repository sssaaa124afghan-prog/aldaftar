// First-run gate for the onboarding screen (#/profile/welcome). Only for a truly fresh install:
// no sessions and no weigh-ins yet (migrated users are routed there once by the migration screen instead).
// The migration gate in main.js runs first, so onboarding never hides the «انقل بياناتي» screen.
// Opening it marks 'ob.seen', so it is never shown twice (skip / leave = done; Profile keeps every field).
let decided = false;

export async function needsOnboarding(ctx) {
  if (decided) return false;
  if (ctx.settings.get('onboarded') || ctx.settings.get('ob.seen')) { decided = true; return false; }
  const all = async (s) => { try { return await ctx.db.getAll(s); } catch { return []; } };
  const [sessions, weights] = await Promise.all([all('sessions'), all('bodyweight')]);
  if (sessions.length || weights.length) { decided = true; return false; }
  return true;
}

export function markOnboardingSeen(ctx) {
  decided = true;
  try { ctx.settings.set('ob.seen', true); } catch { /* best effort */ }
}

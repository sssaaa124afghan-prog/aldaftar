// Keeps one server-side lock-screen alert (core/push.js) in step with a local timer.
// set(at) is cheap to call often: it only talks to the server when the end time really changed (±tolerance),
// and cancels only a job that is still in the future. All calls are fire-and-forget no-ops when push is off.
import { schedulePush, cancelPush } from '../../core/push.js';

export function pushSyncer(tag, { schedule = schedulePush, cancel = cancelPush, now = () => Date.now(), tolerance = 2000 } = {}) {
  let last = null; // end time of the job we armed, or null
  const fire = (fn) => { try { Promise.resolve(fn()).catch(() => {}); } catch { /* never throws */ } };
  return {
    /** at = epoch ms when the timer ends, or null/0 when no timer is running (paused, skipped, finished). */
    set(at) {
      const t = Number.isFinite(at) && at > now() + 1500 ? Math.round(at) : null;
      if (t === null) {
        if (last !== null && last > now()) fire(() => cancel(tag)); // already-fired jobs are gone on the server
        last = null;
        return;
      }
      if (last !== null && Math.abs(last - t) < tolerance) return;
      last = t;
      fire(() => schedule(t, tag));
    },
    clear() { this.set(null); },
    get armed() { return last; },
  };
}

/** The rest end time, or null when there is no rest or it is paused. */
export const restEndAt = (rest) => (rest && !Number.isFinite(rest.pausedLeft) && Number.isFinite(rest.endsAt) ? rest.endsAt : null);
